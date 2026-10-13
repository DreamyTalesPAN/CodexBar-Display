#include <cstdint>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <string>

#include "../src/gif_core_policy.h"
#include "../src/asset_path_policy.h"
#include "../src/connected_setup_policy.h"
#include "../src/theme_spec_runtime_policy.h"

namespace {

using codexbar_display::esp8266::GifCorePolicy;
using codexbar_display::esp8266::GifFailureGuardState;
using codexbar_display::esp8266::CbaContentionWatch;
using codexbar_display::esp8266::ThemeSpecRuntimePolicy;
using codexbar_display::esp8266::AssetPathPolicy;
using codexbar_display::esp8266::ConnectedSetupPolicy;

std::string readFile(const char* path);

bool expect(bool cond, const char* message) {
  if (!cond) {
    std::fprintf(stderr, "FAIL: %s\n", message);
    return false;
  }
  return true;
}

std::size_t countOccurrences(const std::string& value, const char* needle) {
  std::size_t count = 0;
  std::size_t offset = 0;
  const std::string target(needle);
  while ((offset = value.find(target, offset)) != std::string::npos) {
    ++count;
    offset += target.size();
  }
  return count;
}

// Body of the top-level function defined as `signature`, or "" if it is
// missing. Forward declarations are skipped.
std::string functionBody(const std::string& source, const char* signature) {
  const std::size_t start = source.find(std::string(signature) + " {");
  if (start == std::string::npos) {
    return "";
  }
  const std::size_t end = source.find("\n}\n", start);
  if (end == std::string::npos) {
    return "";
  }
  return source.substr(start, end - start);
}

bool testBackoffThresholdAndExpiry() {
  GifFailureGuardState guard;

  if (!expect(!GifCorePolicy::IsBlocked(guard, 0), "fresh guard must not be blocked")) {
    return false;
  }

  if (!expect(!GifCorePolicy::RecordFailure(guard, 100), "first failure must not enter backoff")) {
    return false;
  }
  if (!expect(guard.consecutiveFailures == 1, "first failure increments counter")) {
    return false;
  }

  if (!expect(!GifCorePolicy::RecordFailure(guard, 200), "second failure must not enter backoff")) {
    return false;
  }
  if (!expect(guard.consecutiveFailures == 2, "second failure increments counter")) {
    return false;
  }

  if (!expect(GifCorePolicy::RecordFailure(guard, 300), "third failure must enter backoff")) {
    return false;
  }
  if (!expect(guard.consecutiveFailures == 0, "counter resets after entering backoff")) {
    return false;
  }
  if (!expect(
          guard.backoffUntilMs == 300 + GifCorePolicy::kFailureBackoffMs,
          "backoff deadline must be now + fixed backoff")) {
    return false;
  }

  if (!expect(GifCorePolicy::IsBlocked(guard, 301), "guard should remain blocked before deadline")) {
    return false;
  }
  if (!expect(
          !GifCorePolicy::IsBlocked(guard, 300 + GifCorePolicy::kFailureBackoffMs),
          "guard should unblock at deadline")) {
    return false;
  }
  if (!expect(guard.backoffUntilMs == 0, "deadline must clear after unblock")) {
    return false;
  }

  return true;
}

bool testBackoffResetOnSuccess() {
  GifFailureGuardState guard;
  guard.consecutiveFailures = 2;
  guard.backoffUntilMs = 12345;

  GifCorePolicy::RecordSuccess(guard);

  if (!expect(guard.consecutiveFailures == 0, "success clears consecutive failure count")) {
    return false;
  }
  if (!expect(guard.backoffUntilMs == 0, "success clears backoff deadline")) {
    return false;
  }

  return true;
}

bool testFitContainPreservesAspectRatio() {
  const auto wideBox = GifCorePolicy::FitContain(10, 20, 160, 80, 80, 80);
  if (!expect(wideBox.x == 50, "square gif in wide box should be horizontally centered")) {
    return false;
  }
  if (!expect(wideBox.y == 20, "square gif in wide box should keep top edge")) {
    return false;
  }
  if (!expect(wideBox.width == 80 && wideBox.height == 80, "square gif in wide box should stay square")) {
    return false;
  }

  const auto tallBox = GifCorePolicy::FitContain(5, 7, 80, 160, 80, 40);
  if (!expect(tallBox.x == 5, "wide gif in tall box should keep left edge")) {
    return false;
  }
  if (!expect(tallBox.y == 67, "wide gif in tall box should be vertically centered")) {
    return false;
  }
  if (!expect(tallBox.width == 80 && tallBox.height == 40, "wide gif should keep aspect ratio")) {
    return false;
  }

  return true;
}

bool testAssetWritesStayInsideThemeNamespace() {
  const char* allowed[] = {
      "/themes/u/mini.json",
      "/themes/mini/mini.gif",
  };
  for (const char* path : allowed) {
    if (!expect(
            AssetPathPolicy::IsMutableThemeAsset(path, std::strlen(path)),
            "theme asset path must remain writable")) {
      return false;
    }
  }

  const char* blocked[] = {
      "/auth",
      "/s",
      "/theme-active",
      "/.asset-upload.tmp",
      "/foo",
      "/themes/",
      "/themes//bad.gif",
      "/themes/../auth",
      "/themes/u/bad?.gif",
  };
  for (const char* path : blocked) {
    if (!expect(
            !AssetPathPolicy::IsMutableThemeAsset(path, std::strlen(path)),
            "internal or malformed path must not be writable")) {
      return false;
    }
  }
  return true;
}

// Issue #489 / #404: the USB cable is the authorization. Only a legacy WiFi
// VibeTV -- early hardware that may have no USB data connection -- still
// pairs, takes WiFi details, switches connection mode and opens VibeTV-Setup
// over WiFi. Every other VibeTV answers those routes like unknown paths and
// never opens a network.
bool testWifiPairsAndTakesCredentialsOnlyOnLegacyWifi(const char* mainPath) {
  const std::string mainSource = readFile(mainPath);
  const std::string auth = functionBody(mainSource, "bool requestHasValidAuth()");
  const std::string reject = functionBody(mainSource, "bool rejectUnlessLegacyWifi()");
  const std::string setup = functionBody(mainSource, "void enterWifiSetup()");
  const std::string maintain = functionBody(mainSource, "void maintainWifiConnection()");
  const std::string scan = functionBody(mainSource, "bool scanSetupNetworks(bool automatic)");
  const std::string recovery = functionBody(mainSource, "void maintainWifiSetupRecovery()");
  const std::string accessPoint = functionBody(mainSource, "void startSetupAccessPoint()");
  const char* gatedHandlers[] = {
      "void handleCaptivePortalProbe()",
      "void handleSaveWifi()",
      "void handleSetupWifiScan()",
      "void handleResetWifi()",
      "void handlePairingAPI()",
      "void handleOtaResult()",
      "void handleConnectionModeSwitch()",
  };
  for (const char* signature : gatedHandlers) {
    const std::string handler = functionBody(mainSource, signature);
    const std::size_t gate = handler.find("if (rejectUnlessLegacyWifi())");
    if (!expect(
            gate != std::string::npos && gate < handler.find(';'),
            "every WiFi pairing, setup and update route must first reject a non-legacy VibeTV")) {
      std::fprintf(stderr, "  route: %s\n", signature);
      return false;
    }
  }
  const std::size_t legacySetup = setup.find("if (legacyWifiActive())");
  const std::size_t legacyRecovery = maintain.find("if (setupMode && legacyWifiActive())");
  return expect(
      auth.find("deviceAuthConfigured() && requestAuthToken() == deviceAuthToken") !=
              std::string::npos &&
          reject.find("if (legacyWifiActive())") != std::string::npos &&
          reject.find("404") != std::string::npos &&
          legacySetup != std::string::npos &&
          legacySetup < setup.find("startSetupAccessPoint();") &&
          countOccurrences(mainSource, "startSetupAccessPoint();") == 1 &&
          legacyRecovery != std::string::npos &&
          legacyRecovery < maintain.find("maintainWifiSetupRecovery();") &&
          countOccurrences(mainSource, "maintainWifiSetupRecovery();") == 1 &&
          countOccurrences(mainSource, "WiFi.softAP(") ==
              countOccurrences(accessPoint, "WiFi.softAP(") +
                  countOccurrences(recovery, "WiFi.softAP(") &&
          scan.find("const bool keepSetupAccessPoint = setupMode && legacyWifiActive();") !=
              std::string::npos &&
          scan.find("setupMode ? WIFI_AP_STA") == std::string::npos &&
          scan.find("if (setupMode) {") == std::string::npos,
      "only a legacy WiFi VibeTV may pair or take WiFi details over WiFi or open VibeTV-Setup; unpaired devices accept no WiFi write");
}

bool testCablePairingRequiresExactPhysicalIdentity(const char* mainPath) {
  const std::string mainSource = readFile(mainPath);
  const std::size_t handler = mainSource.find("bool handleSerialControlLine(const String& line)");
  const std::size_t handlerEnd = mainSource.find("void handleSerialInput()", handler);
  if (!expect(
          handler != std::string::npos && handlerEnd != std::string::npos,
          "serial control handler must remain discoverable")) {
    return false;
  }
  const std::string body = mainSource.substr(handler, handlerEnd - handler);
  const std::size_t pair = body.find("strcmp(op, \"pair\") == 0");
  const std::size_t identity = body.find("strcmp(expectedDeviceID, deviceID.c_str())", pair);
  const std::size_t existing = body.find("deviceAuthConfigured()", identity);
  const std::size_t generate = body.find("generateAuthToken()", existing);
  const std::size_t save = body.find("saveDeviceAuthToken(token)", generate);
  const std::size_t reply = body.find("emitSerialPairing(token)", save);
  return expect(
      pair != std::string::npos && identity != std::string::npos &&
          existing != std::string::npos && generate != std::string::npos &&
          save != std::string::npos && reply != std::string::npos &&
          pair < identity && identity < existing && existing < generate &&
          generate < save && save < reply,
      "Cable pairing must verify identity, reuse an existing token, and persist a new token before returning it");
}

bool testConnectedPageNeverRendersPairingSecret(const char* mainPath) {
  const std::string mainSource = readFile(mainPath);
  const std::size_t pageStart = mainSource.find("String connectedPageHTML()");
  const std::size_t pageEnd = mainSource.find("void handleRoot()", pageStart);
  if (pageStart == std::string::npos || pageEnd == std::string::npos) {
    return false;
  }
  const std::string page = mainSource.substr(pageStart, pageEnd - pageStart);
  return expect(
      page.find("deviceAuthToken") == std::string::npos &&
          page.find("/api/pair") == std::string::npos &&
          page.find("tokenQuery") == std::string::npos,
      "the unauthenticated device page must never render pairing secrets or rotation forms");
}

bool testWifiHelloReportsPairingStateWithoutSecrets(const char* mainPath) {
  const std::string mainSource = readFile(mainPath);
  const std::size_t handler = mainSource.find("void handleHello()");
  const std::size_t handlerEnd = mainSource.find("bool isSafeAssetPath", handler);
  const std::size_t transportCapabilities =
      mainSource.find("const char* transportCapabilitiesJSON");
  const std::size_t transportCapabilitiesEnd =
      mainSource.find("codexbar_display::app::TransportConfig makeTransportConfig", transportCapabilities);
  const std::size_t authStatus = mainSource.find("void appendAuthStatusJSON(String& out)");
  const std::size_t authStatusEnd = mainSource.find("void appendBrightnessJSON", authStatus);
  if (handler == std::string::npos || handlerEnd == std::string::npos ||
      transportCapabilities == std::string::npos ||
      transportCapabilitiesEnd == std::string::npos) {
    return false;
  }
  const std::string helloHandler = mainSource.substr(handler, handlerEnd - handler);
  const std::string capabilitiesBody = mainSource.substr(
      transportCapabilities, transportCapabilitiesEnd - transportCapabilities);
  const std::string authStatusBody = mainSource.substr(authStatus, authStatusEnd - authStatus);
  return expect(
      helloHandler.find("BuildDeviceHelloJSON") != std::string::npos &&
          helloHandler.find("makeTransportConfig(\"wifi\")") != std::string::npos &&
          capabilitiesBody.find("appendAuthStatusJSON(json)") != std::string::npos &&
          capabilitiesBody.find("deviceAuthToken") == std::string::npos &&
          authStatusBody.find("\\\"paired\\\"") != std::string::npos &&
          authStatusBody.find("\\\"tokenHeader\\\"") != std::string::npos &&
          authStatusBody.find("pairingWindow") == std::string::npos,
      "WiFi hello must report pairing status without a physical window or exposed token");
}

bool testLegacyRecoveryStorageStaysReservedWithoutRuntime(const char* mainPath) {
  const std::string mainSource = readFile(mainPath);
  return expect(
      mainSource.find("kLegacyRecoveryBytes = 6") != std::string::npos &&
          mainSource.find("kLegacyPairingMarkerBytes = 4") != std::string::npos &&
          mainSource.find(
              "EEPROM.put(kLegacyPairingMarkerOffset, static_cast<uint32_t>(0))") !=
              std::string::npos &&
          mainSource.find("physicalPairingWindow") == std::string::npos &&
          mainSource.find("consumePhysicalRecovery") == std::string::npos &&
          mainSource.find("pairing_window_open") == std::string::npos,
      "legacy EEPROM bytes must stay reserved while physical pairing recovery is removed");
}

bool testNetworkWorkPrecedesWifiRecovery(const char* mainPath) {
  const std::string mainSource = readFile(mainPath);
  const std::size_t loopStart = mainSource.find("void loop()");
  if (!expect(loopStart != std::string::npos, "firmware loop must remain discoverable")) {
    return false;
  }
  const std::string loop = mainSource.substr(loopStart);
  const std::size_t http = loop.find("webServer.handleClient();");
  const std::size_t recovery = loop.find("maintainWifiConnection();");
  return expect(
      http != std::string::npos && recovery != std::string::npos &&
          http < recovery && countOccurrences(loop, "webServer.handleClient();") == 1 &&
          loop.find("handleRawOtaClient();") == std::string::npos,
      "setup HTTP work must run once before WiFi recovery and duplicate raw OTA must stay removed");
}

bool testCableTransferOwnsSerialParserUntilCompletion(const char* mainPath) {
  const std::string mainSource = readFile(mainPath);
  const std::size_t start = mainSource.find("void handleSerialInput()");
  const std::size_t end = mainSource.find("bool isSafeAssetPath", start);
  if (!expect(
          start != std::string::npos && end != std::string::npos,
          "serial input handler must remain discoverable")) {
    return false;
  }
  const std::string body = mainSource.substr(start, end - start);
  const std::size_t control = body.find("handleSerialControlLine(line)");
  const std::size_t active = body.find("cableTransfer.flow.active");
  const std::size_t frame = body.find("ConsumeFrameLine(");
  return expect(
      control != std::string::npos && active != std::string::npos &&
          frame != std::string::npos && control < active && active < frame,
      "transfer control must be consumed before normal frames and an active transfer must block the frame parser");
}

bool testWifiSetupKeepsRetryingSavedNetwork(const char* mainPath) {
  const std::string mainSource = readFile(mainPath);
  const std::size_t start = mainSource.find("void maintainWifiConnection()");
  const std::size_t end = mainSource.find("#ifdef CODEXBAR_DISPLAY_RUNTIME_BENCH", start);
  if (start == std::string::npos || end == std::string::npos) {
    return false;
  }
  const std::string body = mainSource.substr(start, end - start);
  const std::size_t setupBranch = body.find("if (setupMode) {");
  const std::size_t connected = body.find("WiFi.status() == WL_CONNECTED", setupBranch);
  const std::size_t leaveSetup = body.find("setupMode = false;", connected);
  const std::size_t server = body.find("startHttpServer();", leaveSetup);
  const std::size_t retry = body.find("WiFi.begin(savedWifiCredentials.ssid", server);
  const std::size_t fallback = body.find("enterWifiSetup();", retry);
  return expect(
      setupBranch != std::string::npos && connected != std::string::npos &&
          leaveSetup != std::string::npos && server != std::string::npos &&
          retry != std::string::npos && fallback != std::string::npos &&
          body.find("setupWifiState.scanInProgress") != std::string::npos,
      "WiFi without a network must keep retrying the saved network and resume once connected");
}

// A WiFi upload that names its MD5 is checked against it before anything is
// validated or promoted, through the same check the Cable path uses (#60).
bool testUploadContentHashPolicy(const char* mainPath) {
  const std::string mainSource = readFile(mainPath);
  const std::size_t assetStart = mainSource.find("void handleAssetUpload()");
  const std::size_t assetEnd = mainSource.find("void handleAssetUploadResult()", assetStart);
  const std::size_t finishStart = mainSource.find("bool finishCableTransfer(");
  const std::size_t chunkStart = mainSource.find("bool writeCableTransferChunk(");
  if (!expect(
          assetStart != std::string::npos && assetEnd != std::string::npos && finishStart != std::string::npos &&
              chunkStart != std::string::npos,
          "upload handlers must remain discoverable")) {
    return false;
  }
  const std::string asset = mainSource.substr(assetStart, assetEnd - assetStart);
  const std::string chunk = mainSource.substr(chunkStart, finishStart - chunkStart);
  const std::string finish = mainSource.substr(finishStart, 600);
  const std::size_t start = asset.find("if (upload.status == UPLOAD_FILE_START)");
  const std::size_t decode = asset.find("decodeTransferHash(expectedHash.c_str(), transferExpectedHash)", start);
  const std::size_t begin = asset.find("transferHash.begin();", decode);
  const std::size_t write = asset.find("assetUploadFile.write(upload.buf, upload.currentSize)", begin);
  const std::size_t add = asset.find("transferHash.add(upload.buf,", write);
  const std::size_t end = asset.find("} else if (upload.status == UPLOAD_FILE_END) {", add);
  const std::size_t check = asset.find(
      "if (assetUploadError.length() == 0 && assetUploadHashExpected && !transferHashMatches()) {", end);
  const std::size_t promote = asset.find("validateCompletedAssetUpload() &&\n        promoteCompletedAssetUpload()", end);
  return expect(
      start != std::string::npos && decode != std::string::npos && begin != std::string::npos &&
          write != std::string::npos && add != std::string::npos && end != std::string::npos &&
          check != std::string::npos && promote != std::string::npos && check < promote &&
          countOccurrences(asset, "setAssetUploadError(\"asset hash mismatch\")") == 2 &&
          chunk.find("transferHash.add(decoded,") != std::string::npos &&
          finish.find("CanFinish(\n          cableTransfer.flow, transferHashMatches())") != std::string::npos,
      "WiFi uploads must hash what they write and refuse a mismatch before validating or promoting, "
      "through the same MD5 check as Cable transfers");
}

bool testUploadMutualExclusionPolicy(const char* mainPath) {
  const std::string mainSource = readFile(mainPath);
  const std::size_t cableStart = mainSource.find("bool startCableTransfer(");
  const std::size_t cableEnd = mainSource.find("bool writeCableTransferChunk(", cableStart);
  const std::size_t assetStart = mainSource.find("void handleAssetUpload()");
  const std::size_t assetEnd = mainSource.find("void handleAssetUploadResult()", assetStart);
  if (!expect(
          cableStart != std::string::npos && cableEnd != std::string::npos && assetStart != std::string::npos &&
              assetEnd != std::string::npos,
          "all upload handlers must remain discoverable")) {
    return false;
  }

  const std::string cableHandler = mainSource.substr(cableStart, cableEnd - cableStart);
  const std::size_t serialBusyStart = mainSource.find("bool serialRequestBusy()");
  const std::size_t serialBusyEnd = mainSource.find("bool handleSerialControlLine", serialBusyStart);
  const std::string serialBusy =
      serialBusyStart == std::string::npos || serialBusyEnd == std::string::npos
          ? std::string()
          : mainSource.substr(serialBusyStart, serialBusyEnd - serialBusyStart);
  const std::string assetHandler = mainSource.substr(assetStart, assetEnd - assetStart);
  const std::size_t assetStartEvent = assetHandler.find("if (upload.status == UPLOAD_FILE_START)");
  const std::size_t assetBusy =
      assetHandler.find("if (otaUploadInProgress || assetUploadInProgress || rebootPending)", assetStartEvent);
  const std::size_t assetSafeMode = assetHandler.find("enterAssetUploadSafeMode()", assetStartEvent);
  return expect(
      cableHandler.find("serialRequestBusy()") != std::string::npos &&
          serialBusy.find("cableTransfer.flow.active") != std::string::npos &&
          serialBusy.find("assetUploadInProgress") != std::string::npos &&
          serialBusy.find("otaUploadInProgress") != std::string::npos &&
          serialBusy.find("rebootPending") != std::string::npos && assetStartEvent != std::string::npos &&
          assetBusy != std::string::npos && assetSafeMode != std::string::npos && assetBusy < assetSafeMode,
      "Cable transfers and HTTP asset uploads must exclude each other before safe mode");
}

bool testAutomaticWifiFallbackPreservesSavedCredentials(const char* mainPath) {
  const std::string mainSource = readFile(mainPath);
  const std::size_t setupStart = mainSource.find("void setup()");
  const std::size_t setupEnd = mainSource.find("void loop()", setupStart);
  const std::size_t maintainStart = mainSource.find("void maintainWifiConnection()");
  const std::size_t maintainEnd = mainSource.find("#ifdef CODEXBAR_DISPLAY_RUNTIME_BENCH", maintainStart);
  if (setupStart == std::string::npos || setupEnd == std::string::npos ||
      maintainStart == std::string::npos || maintainEnd == std::string::npos) {
    return false;
  }
  const std::string setup = mainSource.substr(setupStart, setupEnd - setupStart);
  const std::string maintain = mainSource.substr(maintainStart, maintainEnd - maintainStart);
  // Only a unit fresh from the manufacturer firmware clears the SDK copy, and
  // only of the network it was flashed on (issue #489).
  const std::size_t freshGuard = setup.find("ShouldForgetFlashingWifi(");
  const std::size_t freshClear = setup.find("clearSdkWifiCredentials();");
  const std::size_t freshEnd = setup.find("} else if", freshGuard);
  return expect(
      setup.find("enterWifiSetup()") != std::string::npos &&
          maintain.find("enterWifiSetup()") != std::string::npos &&
          setup.find("clearWifiCredentials();") == std::string::npos &&
          freshGuard != std::string::npos && freshClear != std::string::npos &&
          freshEnd != std::string::npos && freshGuard < freshClear && freshClear < freshEnd &&
          setup.find("clearSdkWifiCredentials();", freshClear + 1) == std::string::npos &&
          maintain.find("clearWifiCredentials();") == std::string::npos &&
          maintain.find("clearSdkWifiCredentials();") == std::string::npos &&
          setup.find("connectionTransitionStartedAtMs = millis();") != std::string::npos &&
          maintain.find("WiFi.SSID()") == std::string::npos,
      "failed WiFi association must preserve saved credentials for retry or Cable rollback");
}

// Firmware arrives over the paired USB cable. Only a legacy WiFi VibeTV, which
// may have no USB data connection, still takes a paired WiFi update.
bool testWifiFirmwareUpdatesOnlyOnLegacyWifi(const char* mainPath) {
  const std::string mainSource = readFile(mainPath);
  const std::size_t cable = mainSource.find("bool startCableTransfer(");
  const std::size_t cableEnd = mainSource.find("bool writeCableTransferChunk(", cable);
  const std::size_t cableAuth = mainSource.find("deviceAuthConfigured()", cable);
  const std::size_t cableBegin = mainSource.find("Update.begin(", cable);
  const std::size_t server = mainSource.find("void startHttpServer()");
  if (cable == std::string::npos || cableEnd == std::string::npos || server == std::string::npos) {
    return false;
  }
  const std::string upload =
      functionBody(mainSource, "void handleOtaUpload()");
  const std::size_t legacyGate = upload.find("if (!legacyWifiActive()) {");
  const std::size_t uploadAuth = upload.find("if (!requestHasValidOtaAuth()) {");
  const std::size_t uploadBegin = upload.find("Update.begin(");
  return expect(
      cableAuth > cable && cableAuth < cableBegin && cableBegin < cableEnd &&
          legacyGate != std::string::npos && uploadAuth != std::string::npos &&
          uploadBegin != std::string::npos &&
          legacyGate < upload.find("webServer.upload();") && uploadAuth < uploadBegin &&
          countOccurrences(mainSource, "Update.begin(") == 2 &&
          countOccurrences(upload, "Update.begin(") == 1 &&
          mainSource.find("raw_ota_server_started") == std::string::npos &&
          mainSource.find("handleRawOtaClient") == std::string::npos,
      "firmware may only be written over the paired USB cable, or by a paired legacy WiFi VibeTV");
}

bool testPairingTokenUsesHardwareRandom(const char* mainPath) {
  const std::string mainSource = readFile(mainPath);
  const std::size_t start = mainSource.find("String generateAuthToken()");
  const std::size_t end = mainSource.find("bool loadDeviceAuthToken()", start);
  if (start == std::string::npos || end == std::string::npos) {
    return false;
  }
  const std::string body = mainSource.substr(start, end - start);
  return expect(
      body.find("uint8_t bytes[16];") != std::string::npos &&
          body.find("ESP.random(bytes, sizeof(bytes));") != std::string::npos &&
          body.find("randomSeed") == std::string::npos &&
          body.find("random(0x") == std::string::npos,
      "pairing token must be 128 bits from the hardware random number generator");
}

bool testFactoryResetIsCableOnlyAndErasesCustomerData(const char* mainPath) {
  const std::string mainSource = readFile(mainPath);
  const std::size_t resetStart = mainSource.find("void factoryResetAndRestart()");
  const std::size_t resetEnd = mainSource.find("bool handleSerialControlLine(", resetStart);
  const std::size_t handler = mainSource.find("bool handleSerialControlLine(const String& line)");
  const std::size_t handlerEnd = mainSource.find("void handleSerialInput()", handler);
  if (resetStart == std::string::npos || resetEnd == std::string::npos ||
      handler == std::string::npos || handlerEnd == std::string::npos) {
    return false;
  }
  const std::string reset = mainSource.substr(resetStart, resetEnd - resetStart);
  const std::string body = mainSource.substr(handler, handlerEnd - handler);
  const std::size_t op = body.find("strcmp(op, \"factory-reset\") == 0");
  const std::size_t identity = body.find("strcmp(expectedDeviceID, deviceID.c_str())", op);
  const std::size_t busy = body.find("serialRequestBusy()", identity);
  const std::size_t run = body.find("factoryResetAndRestart();", busy);
  const std::size_t eeprom = reset.find("EEPROM.write(i, 0);");
  const std::size_t commit = reset.find("EEPROM.commit()", eeprom);
  const std::size_t sdk = reset.find("ESP.eraseConfig()", commit);
  const std::size_t format = reset.find("LittleFS.format()", sdk);
  const std::size_t restart = reset.find("ESP.restart();", format);
  return expect(
      op != std::string::npos && identity != std::string::npos && busy != std::string::npos &&
          run != std::string::npos && op < identity && identity < busy && busy < run &&
          reset.find("i < kEepromBytes") != std::string::npos &&
          eeprom != std::string::npos && commit != std::string::npos && sdk != std::string::npos &&
          format != std::string::npos && restart != std::string::npos &&
          mainSource.find("factoryResetAndRestart();") == mainSource.rfind("factoryResetAndRestart();"),
      "factory reset must be a cable-only request that erases WiFi, token, settings and themes");
}

bool testEveryBootableEsp8266ProfileUsesAuthenticatedRuntime(const char* platformioPath) {
  const std::string config = readFile(platformioPath);
  return expect(
      config.find("bridge_minimal.cpp") == std::string::npos &&
          config.find("bridge_sdk_minimal.cpp") == std::string::npos &&
          config.find("CODEXBAR_DISPLAY_BRIDGE_MINIMAL") == std::string::npos &&
          config.find("CODEXBAR_DISPLAY_BRIDGE_SDK_MINIMAL") == std::string::npos,
      "no bootable state may be Wi-Fi OTA unrecoverable");
}

bool testAnimatedAssetScanYieldsEveryFourRows() {
  for (int row = 1; row <= 32; ++row) {
    const bool expected = (row % 4) == 0;
    if (!expect(
            ThemeSpecRuntimePolicy::ShouldYieldDuringAssetScan(row) == expected,
            "animated asset work must yield after every four rows")) {
      return false;
    }
  }
  return true;
}

bool testAnimatedFrameOffsetsAreIndexedOneFrameAtATime() {
  if (!expect(
          ThemeSpecRuntimePolicy::InitialAnimatedIndexedFrameCount(8) == 1,
          "animated asset load must expose only the first frame offset")) {
    return false;
  }
  if (!expect(
          ThemeSpecRuntimePolicy::AnimatedFrameOffsetAvailable(0, 8, 1) &&
              !ThemeSpecRuntimePolicy::AnimatedFrameOffsetAvailable(1, 8, 1),
          "only frame zero may be available after initial load")) {
    return false;
  }
  if (!expect(
          ThemeSpecRuntimePolicy::ShouldIndexNextAnimatedFrame(0, 8, 1) &&
              ThemeSpecRuntimePolicy::ShouldIndexNextAnimatedFrame(1, 8, 2),
          "each successful frame may publish at most its direct successor")) {
    return false;
  }
  return expect(
      !ThemeSpecRuntimePolicy::ShouldIndexNextAnimatedFrame(0, 8, 2) &&
          !ThemeSpecRuntimePolicy::ShouldIndexNextAnimatedFrame(7, 8, 8),
      "cached or final frames must not extend the offset index");
}

bool testEsp8266CbaCooperativeAnimationPolicy() {
  if (!expect(
          ThemeSpecRuntimePolicy::CbaWorkDue(false, false, false, 8, 3, 0, 0),
          "a fresh CBA activation must start frame zero")) {
    return false;
  }
  if (!expect(
          ThemeSpecRuntimePolicy::CbaWorkDue(false, true, true, 8, 3, 9999, 1),
          "an in-progress CBA frame must resume before its fps deadline")) {
    return false;
  }
  if (!expect(
          !ThemeSpecRuntimePolicy::CbaWorkDue(false, false, true, 8, 3, 1000, 999) &&
              ThemeSpecRuntimePolicy::CbaWorkDue(false, false, true, 8, 3, 1000, 1000),
          "a completed CBA frame must wait for its fps deadline")) {
    return false;
  }

  int row = 0;
  int ticks = 0;
  while (row < 17) {
    const int budget = ThemeSpecRuntimePolicy::CbaRowsForTick(row, 17);
    const int expectedBudget = row < 16 ? 8 : 1;
    if (!expect(budget == expectedBudget, "each CBA resume tick must stay within its row budget")) {
      return false;
    }
    row += budget;
    ticks += 1;
  }
  if (!expect(
          ticks == 3 && ThemeSpecRuntimePolicy::CbaRowsForTick(row, 17) == 0,
          "CBA row progress must resume without repeating completed rows")) {
    return false;
  }

  if (!expect(
          ThemeSpecRuntimePolicy::NextCbaFrameIndex(-1, 3) == 0 &&
              ThemeSpecRuntimePolicy::NextCbaFrameIndex(0, 3) == 1 &&
              ThemeSpecRuntimePolicy::NextCbaFrameIndex(2, 3) == 0,
          "CBA frames must start at zero, advance, and loop")) {
    return false;
  }
  if (!expect(
          ThemeSpecRuntimePolicy::CbaFrameDelayMs(4) == 250 &&
              ThemeSpecRuntimePolicy::CbaFrameDelayMs(0) == 0,
          "CBA frame delay must follow the asset fps")) {
    return false;
  }
  // A non-animating CBA never decodes a second frame, so demanding the full
  // frame table would keep /health broken forever after it recovers.
  if (!expect(
          ThemeSpecRuntimePolicy::CleanFramesRequiredForRecovery(4, 8) == 4 &&
              ThemeSpecRuntimePolicy::CleanFramesRequiredForRecovery(4, 0) == 1 &&
              ThemeSpecRuntimePolicy::CleanFramesRequiredForRecovery(1, 8) == 1 &&
              ThemeSpecRuntimePolicy::CleanFramesRequiredForRecovery(0, 0) == 1,
          "only an animating CBA may require a full frame table to recover")) {
    return false;
  }
  if (!expect(
          ThemeSpecRuntimePolicy::CbaBufferBytes(74, 74) == 10952 &&
              ThemeSpecRuntimePolicy::CbaBufferBytes(77, 77) == 11858 &&
              ThemeSpecRuntimePolicy::CbaBufferBytes(80, 80) == 12800 &&
              ThemeSpecRuntimePolicy::CbaBufferBytes(81, 1) == 0,
          "CBA buffer policy must cover Clippy and Claude within an 80x80 hard limit")) {
    return false;
  }
  const uint32_t clippyBytes = ThemeSpecRuntimePolicy::CbaBufferBytes(74, 74);
  if (!expect(
          ThemeSpecRuntimePolicy::CanAllocateCbaBuffer(19144, 12000, clippyBytes) &&
              !ThemeSpecRuntimePolicy::CanAllocateCbaBuffer(19143, 12000, clippyBytes) &&
              !ThemeSpecRuntimePolicy::CanAllocateCbaBuffer(30000, 10000, clippyBytes),
          "CBA allocation must preserve heap reserve and require one contiguous block")) {
    return false;
  }
  const uint32_t claudeBytes = ThemeSpecRuntimePolicy::CbaBufferBytes(77, 77);
  if (!expect(
          ThemeSpecRuntimePolicy::CanAllocateCbaBuffer(20432, 16424, claudeBytes) &&
              ThemeSpecRuntimePolicy::CanAnimate(20432 - claudeBytes, 16424 - claudeBytes) &&
              !ThemeSpecRuntimePolicy::CanAllocateCbaBuffer(20049, 16424, claudeBytes),
          "measured WiFi heap must fit Claude while retaining the animation minimum")) {
    return false;
  }
  return expect(
      ThemeSpecRuntimePolicy::CanCooperativelyYield(0, true) &&
          !ThemeSpecRuntimePolicy::CanCooperativelyYield(0, false) &&
          !ThemeSpecRuntimePolicy::CanCooperativelyYield(1, true) &&
          !ThemeSpecRuntimePolicy::CanCooperativelyYield(1, false),
      "yield boundaries must require transaction depth zero and a suspendable continuation");
}

bool testRendererUsesResumableCbaAnimation(
    const char* themeSpecRendererPath,
    const char* displayRendererPath,
    const char* sharedRendererPath) {
  const std::string renderer = readFile(themeSpecRendererPath);
  const std::size_t loadStart = renderer.find("bool loadAnimatedSpriteCache(");
  const std::size_t drawStart = renderer.find("bool drawAnimatedSpriteAsset(", loadStart);
  const std::size_t drawEnd = renderer.find("void drawSpriteAsset(", drawStart);
  if (!expect(
          loadStart != std::string::npos && drawStart != std::string::npos && drawEnd != std::string::npos,
          "animated sprite load and draw functions must remain discoverable")) {
    return false;
  }

  const std::string loadFunction = renderer.substr(loadStart, drawStart - loadStart);
  if (!expect(
          loadFunction.find("InitialAnimatedIndexedFrameCount") != std::string::npos &&
              loadFunction.find("for (int frame") == std::string::npos,
          "initial CBA load must publish frame zero without scanning every frame")) {
    return false;
  }

  const std::string drawFunction = renderer.substr(drawStart, drawEnd - drawStart);
  if (!expect(
          drawFunction.find("CbaRowsForTick") != std::string::npos &&
              drawFunction.find("decodeSpriteRleRowToBuffer") != std::string::npos &&
              drawFunction.find("drawSpriteRleRow") == std::string::npos &&
              drawFunction.find("cache.nextRowOffset") != std::string::npos &&
              drawFunction.find("cache.frameInProgress") != std::string::npos,
          "ESP8266 CBA frames must resume by row into the offscreen buffer")) {
    return false;
  }
  const std::string spriteFunction = renderer.substr(drawEnd, renderer.find("void resetAnimatedSpriteCaches", drawEnd) - drawEnd);
  if (!expect(
          spriteFunction.find("CbaWorkDue") != std::string::npos &&
              spriteFunction.find("file.close()") < spriteFunction.find("pushCompletedAnimatedSpriteFrame"),
          "CBA dispatch must close storage before its single completed-frame push")) {
    return false;
  }
  if (!expect(
          renderer.find("kThemeSpecAnimatedResumeTickMs") != std::string::npos &&
              renderer.find("(themespec::kThemeSpecFieldActivity | themespec::kThemeSpecFieldProvider)") != std::string::npos,
          "unfinished CBA work must resume quickly and activity/provider switches must restart it")) {
    return false;
  }

  const std::string displayRenderer = readFile(displayRendererPath);
  const std::size_t tickStart = displayRenderer.find("void RendererESP8266::TickActive(");
  const std::size_t tickEnd = displayRenderer.find("void RendererESP8266::DrawError(", tickStart);
  if (!expect(
          tickStart != std::string::npos && tickEnd != std::string::npos &&
              displayRenderer.substr(tickStart, tickEnd - tickStart).find("DisplayTransaction") == std::string::npos,
          "the resumable animation tick must not hold a global display transaction")) {
    return false;
  }
  if (!expect(
          renderer.find("CanCooperativelyYield") != std::string::npos &&
              renderer.find("can_yield()") != std::string::npos,
          "explicit theme-renderer yields must require a suspendable continuation")) {
    return false;
  }
  const std::string sharedRenderer = readFile(sharedRendererPath);
  if (!expect(
          sharedRenderer.find("inline void RenderYield()") != std::string::npos &&
              sharedRenderer.find("if (can_yield())") != std::string::npos,
          "shared ESP8266 render yields must require a suspendable continuation")) {
    return false;
  }
  const std::size_t pushImage = renderer.find("Tft().pushImage(");
  const std::size_t pushFunction = renderer.rfind("void pushCompletedAnimatedSpriteFrame(", pushImage);
  if (!expect(
          renderer.find("TFT_eSprite") == std::string::npos &&
              pushImage != std::string::npos &&
              renderer.find("Tft().pushImage(", pushImage + 1) == std::string::npos &&
              renderer.find("new (std::nothrow) uint16_t") != std::string::npos &&
              renderer.find("CanAllocateCbaBuffer") != std::string::npos,
          "CBA must use one guarded raw RGB565 buffer and exactly one atomic push path")) {
    return false;
  }
  if (!expect(
          pushFunction != std::string::npos &&
              renderer.find("ShouldIndexNextAnimatedFrame", pushImage) != std::string::npos &&
              renderer.find("cache.indexedFrameCount += 1", pushImage) != std::string::npos,
          "the next lazy CBA offset must be committed only after the completed frame push")) {
    return false;
  }
  if (!expect(
          renderer.find("const bool previousSwapBytes = Tft().getSwapBytes()") != std::string::npos &&
              renderer.find("Tft().setSwapBytes(true)", pushImage - 256) < pushImage &&
              renderer.find("Tft().setSwapBytes(previousSwapBytes)", pushImage) > pushImage,
          "raw RGB565 pushes must enable byte swapping and restore the previous TFT state")) {
    return false;
  }
  const std::size_t resetEnd = renderer.find("class ThemeSpecSink");
  const std::size_t resetStart = renderer.rfind("void resetAnimatedSpriteCaches(", resetEnd);
  if (!expect(
          resetStart != std::string::npos && resetEnd != std::string::npos &&
              renderer.substr(resetStart, resetEnd - resetStart).find("cbaFrameBufferOwner = nullptr") != std::string::npos &&
              renderer.substr(resetStart, resetEnd - resetStart).find("releaseCbaFrameBuffer") == std::string::npos,
          "activity/cache reset must clear the owner while retaining singleton capacity")) {
    return false;
  }
  return expect(
      renderer.find("cache.frameStartedAtMs + frameDelayMs") != std::string::npos,
      "CBA fps deadlines must be based on frame start rather than render completion");
}

std::string readFile(const char* path) {
  std::ifstream input(path);
  return std::string(
      std::istreambuf_iterator<char>(input),
      std::istreambuf_iterator<char>());
}

bool testDecoderAllocationStaysInsideRealPlayback(
    const char* themeSpecRendererPath,
    const char* gifCorePath) {
  const std::string renderer = readFile(themeSpecRendererPath);
  const std::string gifCore = readFile(gifCorePath);
  if (!expect(!renderer.empty(), "theme renderer source must be readable")) {
    return false;
  }
  if (!expect(!gifCore.empty(), "GIF core source must be readable")) {
    return false;
  }

  const std::size_t cacheStart = renderer.find("bool ensureThemeSpecSceneCached(");
  const std::size_t cacheEnd = renderer.find("bool readSpriteLine(", cacheStart);
  if (!expect(
          cacheStart != std::string::npos && cacheEnd != std::string::npos,
          "theme cache function must remain discoverable")) {
    return false;
  }
  const std::string cacheFunction = renderer.substr(cacheStart, cacheEnd - cacheStart);
  if (!expect(
          cacheFunction.find("EnsureDecoder(") == std::string::npos,
          "theme parsing must never allocate the GIF decoder")) {
    return false;
  }
  if (!expect(
          cacheFunction.find("GifCore().ReleaseMemory()") <
              cacheFunction.find("deserializeJson("),
          "theme changes must release GIF memory before parsing the next theme")) {
    return false;
  }

  const std::size_t validation = gifCore.find("ValidateGifAssetFile(");
  const std::size_t decoderAllocation = gifCore.find("if (!EnsureDecoder())", validation);
  if (!expect(
          validation != std::string::npos && decoderAllocation != std::string::npos &&
              validation < decoderAllocation,
          "decoder allocation must happen only after complete GIF profile validation")) {
    return false;
  }
  if (!expect(
          gifCore.find("if (!EnsureDecoder())", decoderAllocation + 1) == std::string::npos,
          "real GIF playback must be the only decoder allocation call site")) {
    return false;
  }
  return true;
}

bool testGifLoopResetStaysAtomic(const char* gifCorePath) {
  const std::string gifCore = readFile(gifCorePath);
  const std::size_t loopReset = gifCore.find("if (!played) {");
  const std::size_t loopResetEnd = gifCore.find("if (delayMs < 0)", loopReset);
  if (!expect(
          loopReset != std::string::npos && loopResetEnd != std::string::npos,
          "GIF loop reset must remain discoverable")) {
    return false;
  }
  const std::string resetBlock = gifCore.substr(loopReset, loopResetEnd - loopReset);
  const std::size_t transaction = resetBlock.find("display::DisplayTransaction transaction;");
  const std::size_t reset = resetBlock.find("decoder_->reset();");
  const std::size_t safeCheck = resetBlock.find("if (!firstFrameCoversCanvasOpaque_)");
  const std::size_t clear = resetBlock.find("ClearDrawRect(tft);");
  const std::size_t firstFrame = resetBlock.find("decoder_->playFrame(false, &delayMs, nullptr);");
  return expect(
      transaction != std::string::npos && reset != std::string::npos && safeCheck != std::string::npos &&
          clear != std::string::npos && firstFrame != std::string::npos &&
          transaction < reset && reset < safeCheck && safeCheck < clear && clear < firstFrame,
      "GIF loop clear must be conditional while reset and first frame stay in one transaction");
}

bool testFirmwareLoadsOnlyExplicitActiveTheme(const char* mainPath) {
  const std::string mainSource = readFile(mainPath);
  if (!expect(
      mainSource.find("kLegacyMiniThemeSpecPath = \"/themes/u/mini-cl-1-410a37.json\"") !=
              std::string::npos &&
          mainSource.find("raw.replace(\"\\\"v\\\":\\\"left\\\"\", \"\\\"v\\\":\\\"{usageMode}\\\"\")") !=
              std::string::npos,
      "explicitly active legacy Mini specs must render the live usage mode after OTA")) {
    return false;
  }

  const std::size_t loadStart = mainSource.find("void loadActiveStoredThemeSpecCache() {");
  const std::size_t loadEnd = mainSource.find("\n}", loadStart);
  if (!expect(
          loadStart != std::string::npos && loadEnd != std::string::npos,
          "active ThemeSpec cache loader must remain discoverable")) {
    return false;
  }
  const std::string loader = mainSource.substr(loadStart, loadEnd - loadStart);
  const std::size_t active = loader.find("readActiveThemeSpecPath(activePath)");
  return expect(
      active != std::string::npos &&
          loader.find("loadStoredThemeSpecCacheFromPath(activePath)") != std::string::npos &&
          loader.find("kDefaultThemeSpecPath") == std::string::npos &&
          loader.find("kPreviousDefaultThemeSpecPath") == std::string::npos &&
          loader.find("kLegacyDefaultThemeSpecPath") == std::string::npos,
      "firmware must load only the explicitly active ThemeSpec and otherwise show theme-missing");
}

bool testAssetHandlersUseThemeNamespacePolicy(const char* mainPath) {
  const std::string mainSource = readFile(mainPath);
  const std::size_t uploadValidation = mainSource.find("if (!isMutableThemeAssetPath(assetUploadPath))");
  const std::size_t temporaryOpen =
      mainSource.find("LittleFS.open(kAssetUploadTemporaryPath, \"w\")", uploadValidation);
  const std::size_t deleteHandler = mainSource.find("void handleAssetDelete()");
  const std::size_t deleteValidation = mainSource.find("if (!isMutableThemeAssetPath(path))", deleteHandler);
  const std::size_t deleteCall = mainSource.find("LittleFS.remove(path)", deleteValidation);
  return expect(
      uploadValidation != std::string::npos && temporaryOpen != std::string::npos &&
          uploadValidation < temporaryOpen && deleteValidation != std::string::npos &&
          deleteCall != std::string::npos && deleteValidation < deleteCall,
      "upload and delete handlers must enforce the theme namespace before filesystem writes");
}

bool testFirmwareUsesIPDiscoveryInsteadOfMdns(const char* mainPath) {
  const std::string mainSource = readFile(mainPath);
  return expect(
      mainSource.find("ESP8266mDNS") == std::string::npos &&
          mainSource.find("vibetv.local") == std::string::npos &&
          mainSource.find("MDNS.") == std::string::npos &&
          mainSource.find("WiFi.localIP().toString()") != std::string::npos,
      "firmware must expose station endpoints by IP without mDNS");
}

bool testConnectedSetupAddressPolicy() {
  return expect(
             ConnectedSetupPolicy::IsStationIPv4("172.30.12.34") &&
                 ConnectedSetupPolicy::IsStationIPv4("192.168.178.163"),
             "connected setup must accept readable station IPv4 addresses") &&
         expect(
             !ConnectedSetupPolicy::IsStationIPv4("") &&
                 !ConnectedSetupPolicy::IsStationIPv4("0.0.0.0") &&
                 !ConnectedSetupPolicy::IsStationIPv4("192.168.4.1") &&
                 !ConnectedSetupPolicy::IsStationIPv4("999.1.2.3") &&
                 !ConnectedSetupPolicy::IsStationIPv4("not-an-ip"),
             "connected setup must hide unavailable, AP-mode, and invalid IPv4 values");
}

bool testConnectedSetupRendererShowsSafeIpFallback(const char* rendererPath) {
  const std::string renderer = readFile(rendererPath);
  const std::size_t start = renderer.find("void RendererESP8266::DrawConnectedSetupInstructions(");
  const std::size_t end = renderer.find("\n}\n\n#ifndef CODEXBAR_DISPLAY_PROBE_ONLY", start);
  if (!expect(start != std::string::npos && end != std::string::npos, "connected setup renderer must remain testable")) {
    return false;
  }
  const std::string function = renderer.substr(start, end - start);
  return expect(
      function.find("ConnectedSetupPolicy::IsStationIPv4") != std::string::npos &&
          function.find("IP: ") != std::string::npos &&
          function.find("IP unavailable") != std::string::npos &&
          function.find("tft.print(ipLine)") != std::string::npos,
      "connected setup renderer must display a validated IP line and an unavailable state");
}

// Content hashes prove transported bytes, not renderability. Every uploaded
// sprite must pass the same semantic gate as a GIF before it is promoted.
bool testUploadedSpriteAssetsAreValidatedBeforePromotion(const char* mainPath) {
  const std::string mainSource = readFile(mainPath);
  const std::size_t start = mainSource.find("bool validateCompletedAssetUpload()");
  const std::size_t end = mainSource.find("bool promoteCompletedAssetUpload()", start);
  if (!expect(
          start != std::string::npos && end != std::string::npos,
          "the completed-upload validation gate must remain discoverable")) {
    return false;
  }
  const std::string gate = mainSource.substr(start, end - start);
  if (!expect(
          gate.find("assetPathLooksSprite") != std::string::npos &&
              gate.find("ValidateSpriteAssetFile") != std::string::npos &&
              gate.find("SpriteValidationErrorText") != std::string::npos,
          "CBI/CBA uploads must be semantically validated before promotion")) {
    return false;
  }
  // The sprite branch has to run before the GIF-only early return, otherwise
  // malformed sprites would pass through unchecked again.
  if (!expect(
          gate.find("assetPathLooksSprite") < gate.find("if (!assetPathLooksGif"),
          "the sprite gate must precede the GIF-only early return")) {
    return false;
  }
  // Animation scheduling keys off the destination suffix, so a well-formed
  // payload stored under the wrong extension renders nothing while the device
  // still reports healthy. The header and the suffix have to agree.
  if (!expect(
          gate.find("spriteInfo.animated != assetPathLooksAnimatedSprite(") != std::string::npos,
          "an uploaded sprite header must match its destination extension")) {
    return false;
  }
  // AssetPathLooksAnimated() compares ".cba" case-sensitively, so an uppercase
  // .CBA is never scheduled for animation. Matching case-insensitively here
  // would promote a payload that then renders nothing.
  const std::size_t animatedHelper =
      mainSource.find("bool assetPathLooksAnimatedSprite(const String& path) {");
  if (!expect(animatedHelper != std::string::npos, "the animated-suffix helper must remain discoverable")) {
    return false;
  }
  const std::string animatedBody = mainSource.substr(animatedHelper, 400);
  if (!expect(
          animatedBody.find("toLowerCase()") == std::string::npos &&
              animatedBody.find("path.endsWith(\".cba\")") != std::string::npos,
          "only the canonical lowercase .cba may be treated as animated")) {
    return false;
  }
  if (!expect(
          mainSource.find("committed = validateCompletedAssetUpload() && promoteCompletedAssetUpload()") !=
                  std::string::npos &&
              mainSource.find("validateCompletedAssetUpload() &&\n        promoteCompletedAssetUpload()") !=
                  std::string::npos,
          "both the Cable and HTTP upload paths must validate before promoting")) {
    return false;
  }
  return expect(
      mainSource.find("bool assetPathLooksSprite(const String& path)") != std::string::npos &&
          mainSource.find("\".cbi\"") != std::string::npos &&
          mainSource.find("\".cba\"") != std::string::npos,
      "sprite detection must cover both CBI and CBA extensions");
}

// A sprite that cannot be decoded must surface as an unhealthy render state
// with a stable code, not be silently skipped.
bool testSpriteDecodeFailuresReachRenderHealth(const char* themeSpecRendererPath) {
  const std::string renderer = readFile(themeSpecRendererPath);
  const std::size_t drawStart = renderer.find("void drawStaticSpriteAsset(");
  const std::size_t drawEnd = renderer.find("AnimatedSpriteCache* animatedSpriteCacheForPath(", drawStart);
  if (!expect(
          drawStart != std::string::npos && drawEnd != std::string::npos,
          "the static sprite draw path must remain discoverable")) {
    return false;
  }
  const std::string staticDraw = renderer.substr(drawStart, drawEnd - drawStart);
  if (!expect(
          countOccurrences(staticDraw, "markSpriteRenderFailed(") == 4 &&
              staticDraw.find("cbi_header_invalid") != std::string::npos &&
              staticDraw.find("cbi_palette_invalid") != std::string::npos &&
              staticDraw.find("cbi_truncated") != std::string::npos &&
              staticDraw.find("cbi_row_invalid") != std::string::npos,
          "every static sprite decode failure must set a stable diagnostic code")) {
    return false;
  }
  const std::size_t dispatchStart = renderer.find("void drawSpriteAsset(");
  const std::size_t dispatchEnd = renderer.find("void resetAnimatedSpriteCaches(", dispatchStart);
  if (!expect(
          dispatchStart != std::string::npos && dispatchEnd != std::string::npos,
          "the sprite dispatch path must remain discoverable")) {
    return false;
  }
  const std::string dispatch = renderer.substr(dispatchStart, dispatchEnd - dispatchStart);
  if (!expect(
          dispatch.find("sprite_asset_missing") != std::string::npos &&
              dispatch.find("sprite_header_unsupported") != std::string::npos &&
              dispatch.find("sprite_unreadable") != std::string::npos &&
              dispatch.find("cba_render_failed") != std::string::npos,
          "unreadable, missing, and unsupported sprites must set a diagnostic code")) {
    return false;
  }
  // Low heap is transient and keeps its own counter, so it must not inflate
  // renderFailures the way a broken asset does.
  if (!expect(
          renderer.find("setSpriteRenderError(\"low_heap_cba_buffer\"") != std::string::npos &&
              renderer.find("markSpriteRenderFailed(\"low_heap_cba_buffer\"") == std::string::npos,
          "transient low-heap sprite errors must not count as asset render failures")) {
    return false;
  }
  if (!expect(
          renderer.find("themeSpecRenderFailures += 1") != std::string::npos &&
              renderer.find("const char* ThemeSpecRenderErrorAsset()") != std::string::npos,
          "render health must expose the failing sprite asset for support")) {
    return false;
  }
  return expect(
      renderer.find("lastSpriteErrorAsset == assetPath") != std::string::npos &&
          renderer.find("lastSpriteErrorAsset == cache.path") != std::string::npos,
      "a sprite that decodes again must clear its own render error");
}

// Recovery must require proof that the failing asset decoded again. Dropping
// caches or skipping rows below a clip proves nothing, so neither may restore
// renderOk while the active sprite is still broken.
bool testSpriteRenderErrorsOnlyClearOnProvenDecode(const char* themeSpecRendererPath) {
  const std::string renderer = readFile(themeSpecRendererPath);
  const std::size_t resetStart = renderer.find("void resetAnimatedSpriteCaches() {");
  if (!expect(resetStart != std::string::npos, "the sprite cache reset must remain discoverable")) {
    return false;
  }
  const std::size_t resetEnd = renderer.find("\n}", resetStart);
  if (!expect(resetEnd != std::string::npos, "the sprite cache reset must be delimited")) {
    return false;
  }
  const std::string reset = renderer.substr(resetStart, resetEnd - resetStart);
  // resetAnimatedSpriteCaches() runs on every asset upload and on activity or
  // provider partial renders. Clearing the diagnostic there hides a broken
  // active sprite behind an unrelated upload.
  if (!expect(
          reset.find("clearSpriteRenderError()") == std::string::npos,
          "dropping animation caches must not clear the sprite render error")) {
    return false;
  }
  const std::size_t drawStart = renderer.find("void drawStaticSpriteAsset(");
  const std::size_t drawEnd = renderer.find("AnimatedSpriteCache* animatedSpriteCacheForPath(", drawStart);
  if (!expect(
          drawStart != std::string::npos && drawEnd != std::string::npos,
          "the static sprite draw path must remain discoverable")) {
    return false;
  }
  const std::string staticDraw = renderer.substr(drawStart, drawEnd - drawStart);
  // A clipped render deliberately stops before the last row. Falling through
  // to the success block would clear an error found in a row it never read.
  if (!expect(
          staticDraw.find("bool decodedEveryRow = true;") != std::string::npos &&
              staticDraw.find("decodedEveryRow = false;") != std::string::npos &&
              staticDraw.find("if (decodedEveryRow && lastSpriteErrorAsset == assetPath) {") != std::string::npos,
          "only a pass that decoded every row may clear a static sprite error")) {
    return false;
  }
  // A new theme no longer draws the old theme's assets, so its stale
  // diagnostic must not outlive the theme switch.
  if (!expect(
      renderer.find("ensureThemeSpecSceneCached") != std::string::npos &&
          renderer.find("clearSpriteRenderError();\n  GifCore().ReleaseMemory();") != std::string::npos,
      "switching themes must clear the previous theme's sprite diagnostic")) {
    return false;
  }
  // Corruption can sit in a later CBA frame while frame zero still decodes,
  // and a failure restarts the animation at frame zero. Clearing after one
  // frame would flip /health between ok and broken forever.
  if (!expect(
          renderer.find("int consecutiveCleanFrames = 0;") != std::string::npos &&
              renderer.find("ThemeSpecRuntimePolicy::CleanFramesRequiredForRecovery(") != std::string::npos,
          "a CBA must decode every frame before its render error is cleared")) {
    return false;
  }
  const std::size_t cancelStart = renderer.find("void cancelAnimatedSpriteFrame(AnimatedSpriteCache& cache) {");
  if (!expect(cancelStart != std::string::npos, "the animated frame cancel path must remain discoverable")) {
    return false;
  }
  // A transient "low heap" condition must never outrank a real decode failure
  // for the same asset, or /health blames memory for a broken sprite forever.
  const std::size_t markStart = renderer.find("void markSpriteRenderFailed(const char* code, const char* assetPath) {");
  if (!expect(markStart != std::string::npos, "the sprite failure path must remain discoverable")) {
    return false;
  }
  const std::size_t markEnd = renderer.find("\n}", markStart);
  if (!expect(markEnd != std::string::npos, "the sprite failure path must be delimited")) {
    return false;
  }
  const std::string mark = renderer.substr(markStart, markEnd - markStart);
  if (!expect(
          mark.find("lastSpriteErrorIsDecodeFailure) {") != std::string::npos &&
              mark.find("lastSpriteErrorIsDecodeFailure = true;") != std::string::npos,
          "a decode failure must supersede a transient error for the same asset")) {
    return false;
  }
  // A buffer allocation that failed never decoded the asset, so reporting a
  // decode failure would blame the asset for ordinary memory pressure and
  // inflate renderFailures.
  if (!expect(
          renderer.find("cbaBufferAllocationFailedThisAttempt = true;") != std::string::npos &&
              renderer.find("if (!cbaBufferAllocationFailedThisAttempt &&") != std::string::npos,
          "a failed CBA buffer allocation must not be reported as a decode failure")) {
    return false;
  }
  // Two tall CBAs share one frame buffer, so the second sprite finding it
  // occupied is deferred work rather than a corrupt asset.
  if (!expect(
          renderer.find("cbaBufferUnavailableThisAttempt = true;") != std::string::npos &&
              renderer.find("!cbaBufferUnavailableThisAttempt) {") != std::string::npos,
          "shared-buffer contention must not be reported as a decode failure")) {
    return false;
  }
  // Suppressing contention entirely would hide a theme whose sprites evict
  // each other forever, so persistent contention has to surface. Whether it
  // persisted is CbaContentionWatch's call (testCbaContentionWatch), fed with
  // the owner's row and the completed-frame count.
  if (!expect(
          renderer.find("cbaBufferContention.Observe(\n              cbaFrameBufferOwner, cbaFrameBufferOwner->nextRow, cbaCompletedFrames)") !=
                  std::string::npos &&
              renderer.find("setSpriteRenderError(\"cba_buffer_contention\"") != std::string::npos,
          "persistent shared-buffer contention must be reported as a transient error")) {
    return false;
  }
  // Taking the buffer is no progress: evicted sprites hand it over mid-frame
  // forever, and resetting the watch there hid that starvation (#472). Only
  // dropping every sprite cache starts a new count.
  const std::size_t prepareStart = renderer.find("bool prepareAnimatedSpriteBuffer(");
  const std::size_t prepareEnd = renderer.find("\n}\n", prepareStart);
  const std::size_t clearCachesStart = renderer.find("void resetAnimatedSpriteCaches() {");
  const std::size_t clearCachesEnd = renderer.find("\n}\n", clearCachesStart);
  if (!expect(prepareStart != std::string::npos && clearCachesStart != std::string::npos,
              "CBA buffer and cache reset paths must remain discoverable") ||
      !expect(renderer.substr(prepareStart, prepareEnd - prepareStart).find("cbaBufferContention = ") ==
                  std::string::npos,
              "acquiring the CBA buffer must not reset the contention watch") ||
      !expect(renderer.substr(clearCachesStart, clearCachesEnd - clearCachesStart).find("cbaBufferContention = CbaContentionWatch{};") !=
                  std::string::npos,
              "dropping the sprite caches must start a new contention count") ||
      !expect(countOccurrences(renderer, "cbaBufferContention") == 3,
              "only CbaContentionWatch may decide when contention progressed")) {
    return false;
  }
  const std::size_t transientStart = renderer.find("void setSpriteRenderError(const char* code, const char* assetPath) {");
  if (!expect(transientStart != std::string::npos, "the transient sprite error path must remain discoverable")) {
    return false;
  }
  const std::size_t transientEnd = renderer.find("\n}", transientStart);
  if (!expect(transientEnd != std::string::npos, "the transient sprite error path must be delimited")) {
    return false;
  }
  if (!expect(
          renderer.substr(transientStart, transientEnd - transientStart)
                  .find("lastSpriteErrorIsDecodeFailure = false;") != std::string::npos,
          "a transient sprite error must record itself as non-fatal")) {
    return false;
  }
  // Two animated sprites share one frame buffer, so B running out of heap
  // must not bury A's corrupt data behind ordinary memory pressure.
  if (!expect(
          renderer.substr(transientStart, transientEnd - transientStart)
                  .find("if (lastSpriteErrorIsDecodeFailure && lastAnimatedSpriteError[0] != '\\0') {") !=
              std::string::npos,
          "a transient error must not overwrite another asset's decode failure")) {
    return false;
  }
  const std::size_t cancelEnd = renderer.find("\n}", cancelStart);
  if (!expect(cancelEnd != std::string::npos, "the animated frame cancel path must be delimited")) {
    return false;
  }
  const std::string cancel = renderer.substr(cancelStart, cancelEnd - cancelStart);
  if (!expect(
          cancel.find("cache.consecutiveCleanFrames = 0;") != std::string::npos,
          "an aborted CBA frame must restart the clean-pass requirement")) {
    return false;
  }
  // The diagnostic names one asset path, so an error about a sprite the theme
  // no longer draws must not pin renderOk: false forever. Retirement requires
  // evidence that the asset is gone -- the scene no longer references it, or
  // the pass that re-selected sprites never drew it -- because a static-only
  // pass cannot prove a CBA decodes again.
  if (!expect(
          renderer.find("void retireSpriteRenderErrorIfAssetUnreferenced(") != std::string::npos &&
              renderer.find("themespec::CompiledThemeSpecReferencesAsset(scene, lastSpriteErrorAsset.c_str())") != std::string::npos &&
              renderer.find("retireSpriteRenderErrorIfAssetUnreferenced(cachedThemeSpecScene);") != std::string::npos,
          "a full redraw may retire an error only for an unreferenced asset")) {
    return false;
  }
  // A partial pass skips animated primitives and only draws the changed ones,
  // so it can never prove an asset is gone and must not retire anything.
  const std::size_t partialStart = renderer.find("bool RenderThemeSpecPartial(");
  const std::size_t partialEnd = renderer.find("bool RenderThemeSpecRegion(", partialStart);
  if (!expect(
          partialStart != std::string::npos && partialEnd != std::string::npos,
          "the partial render path must remain discoverable")) {
    return false;
  }
  const std::string partial = renderer.substr(partialStart, partialEnd - partialStart);
  if (!expect(
          partial.find("clearSpriteRenderError()") == std::string::npos &&
              partial.find("retireSpriteRenderErrorIfAssetUnreferenced") == std::string::npos,
          "a partial render must not retire a sprite diagnostic")) {
    return false;
  }
  // A replacement sprite that also fails must supersede the stale diagnostic,
  // or its failure stays invisible and the old error is retired as gone.
  return expect(
      renderer.find("lastAnimatedSpriteError[0] != '\\0' && lastSpriteErrorAsset == path") != std::string::npos,
      "a failure from a different asset must supersede a stale diagnostic");
}

}  // namespace

// Replays the renderer's sharing of one CBA frame buffer between sprites held
// in two round-robin cache slots, as animatedSpriteCacheForPath() and
// prepareAnimatedSpriteBuffer() do, and reports whether contention was ever
// published.
bool cbaContentionPublished(int spriteCount, int spriteHeight, int ticks) {
  constexpr int kSlots = 2;
  struct Slot {
    int sprite = -1;
    int nextRow = 0;
  } slots[kSlots];
  int nextSlot = 0;
  const Slot* owner = nullptr;
  unsigned long completedFrames = 0;
  CbaContentionWatch watch;
  bool published = false;
  for (int tick = 0; tick < ticks; ++tick) {
    for (int sprite = 0; sprite < spriteCount; ++sprite) {
      Slot* slot = nullptr;
      for (Slot& candidate : slots) {
        if (candidate.sprite == sprite) {
          slot = &candidate;
        }
      }
      if (slot == nullptr) {
        for (Slot& candidate : slots) {
          if (slot == nullptr && candidate.sprite < 0) {
            slot = &candidate;
          }
        }
      }
      if (slot == nullptr) {
        slot = &slots[nextSlot];
        nextSlot = (nextSlot + 1) % kSlots;
      }
      if (slot->sprite != sprite) {
        // Eviction drops the old sprite's frame and its claim on the buffer.
        if (owner == slot) {
          owner = nullptr;
        }
        *slot = Slot{};
        slot->sprite = sprite;
      }
      if (owner != nullptr && owner != slot) {
        published = watch.Observe(owner, owner->nextRow, completedFrames) || published;
        continue;
      }
      owner = slot;
      slot->nextRow += ThemeSpecRuntimePolicy::CbaRowsForTick(slot->nextRow, spriteHeight);
      if (slot->nextRow >= spriteHeight) {
        ++completedFrames;
        slot->nextRow = 0;
        owner = nullptr;
      }
    }
  }
  return published;
}

bool testCbaContentionWatch() {
  // Three sprites taller than one chunk keep evicting each other from two
  // slots, so no frame ever completes (#472).
  if (!expect(cbaContentionPublished(3, 24, 60),
              "three tall CBAs that never finish a frame must publish contention")) {
    return false;
  }
  // A 480-row sprite needs 60 resume ticks per frame while another waits;
  // that is ordinary animation, not starvation.
  if (!expect(!cbaContentionPublished(2, 480, 600),
              "a tall owner that keeps decoding rows must not publish contention")) {
    return false;
  }
  // Short sprites finish within one chunk, so the buffer is free again.
  if (!expect(!cbaContentionPublished(3, 8, 600),
              "sprites that complete frames must not publish contention")) {
    return false;
  }
  // A stuck owner is starvation even without evictions.
  CbaContentionWatch watch;
  int stuckRow = 8;
  bool published = false;
  for (unsigned int i = 0; i <= CbaContentionWatch::kStreakLimit; ++i) {
    published = watch.Observe(&stuckRow, stuckRow, 0);
  }
  if (!expect(published, "an owner that stops decoding must publish contention")) {
    return false;
  }
  return expect(!watch.Observe(&stuckRow, stuckRow, 1),
                "a completed frame must clear the contention streak");
}

int main(int argc, char** argv) {
  if (!testCbaContentionWatch()) {
    return 1;
  }
  if (!testBackoffThresholdAndExpiry()) {
    return 1;
  }
  if (!testBackoffResetOnSuccess()) {
    return 1;
  }
  if (!testFitContainPreservesAspectRatio()) {
    return 1;
  }
  if (!testAssetWritesStayInsideThemeNamespace()) {
    return 1;
  }
  if (!testAnimatedAssetScanYieldsEveryFourRows()) {
    return 1;
  }
  if (!testAnimatedFrameOffsetsAreIndexedOneFrameAtATime()) {
    return 1;
  }
  if (!testEsp8266CbaCooperativeAnimationPolicy()) {
    return 1;
  }
  if (!expect(argc == 7, "source paths are required for firmware policy tests")) {
    return 1;
  }
  if (!testRendererUsesResumableCbaAnimation(argv[1], argv[4], argv[6])) {
    return 1;
  }
  if (!testDecoderAllocationStaysInsideRealPlayback(argv[1], argv[2])) {
    return 1;
  }
  if (!testGifLoopResetStaysAtomic(argv[2])) {
    return 1;
  }
  if (!testFirmwareLoadsOnlyExplicitActiveTheme(argv[3])) {
    return 1;
  }
  if (!testAssetHandlersUseThemeNamespacePolicy(argv[3])) {
    return 1;
  }
  if (!testWifiPairsAndTakesCredentialsOnlyOnLegacyWifi(argv[3])) {
    return 1;
  }
  if (!testCablePairingRequiresExactPhysicalIdentity(argv[3])) {
    return 1;
  }
  if (!testConnectedPageNeverRendersPairingSecret(argv[3])) {
    return 1;
  }
  if (!testWifiHelloReportsPairingStateWithoutSecrets(argv[3])) {
    return 1;
  }
  if (!testLegacyRecoveryStorageStaysReservedWithoutRuntime(argv[3])) {
    return 1;
  }
  if (!testNetworkWorkPrecedesWifiRecovery(argv[3])) {
    return 1;
  }
  if (!testCableTransferOwnsSerialParserUntilCompletion(argv[3])) {
    return 1;
  }
  if (!testWifiSetupKeepsRetryingSavedNetwork(argv[3])) {
    return 1;
  }
  if (!testUploadMutualExclusionPolicy(argv[3])) {
    return 1;
  }
  if (!testUploadContentHashPolicy(argv[3])) {
    return 1;
  }
  if (!testAutomaticWifiFallbackPreservesSavedCredentials(argv[3])) {
    return 1;
  }
  if (!testWifiFirmwareUpdatesOnlyOnLegacyWifi(argv[3])) {
    return 1;
  }
  if (!testPairingTokenUsesHardwareRandom(argv[3])) {
    return 1;
  }
  if (!testFactoryResetIsCableOnlyAndErasesCustomerData(argv[3])) {
    return 1;
  }
  if (!testEveryBootableEsp8266ProfileUsesAuthenticatedRuntime(argv[5])) {
    return 1;
  }
  if (!testFirmwareUsesIPDiscoveryInsteadOfMdns(argv[3])) {
    return 1;
  }
  if (!testConnectedSetupAddressPolicy()) {
    return 1;
  }
  if (!testConnectedSetupRendererShowsSafeIpFallback(argv[4])) {
    return 1;
  }
  if (!testUploadedSpriteAssetsAreValidatedBeforePromotion(argv[3])) {
    return 1;
  }
  if (!testSpriteDecodeFailuresReachRenderHealth(argv[1])) {
    return 1;
  }
  if (!testSpriteRenderErrorsOnlyClearOnProvenDecode(argv[1])) {
    return 1;
  }

  std::printf("ok: gif_core_policy_test\n");
  return 0;
}
