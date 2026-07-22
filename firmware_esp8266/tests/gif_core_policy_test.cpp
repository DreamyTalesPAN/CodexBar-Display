#include <cstdint>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <string>

#include "../src/gif_core_policy.h"
#include "../src/asset_path_policy.h"
#include "../src/connected_setup_policy.h"
#include "../src/theme_spec_runtime_policy.h"
#include "../src/wifi_security_policy.h"

namespace {

using codexbar_display::esp8266::GifCorePolicy;
using codexbar_display::esp8266::GifFailureGuardState;
using codexbar_display::esp8266::ThemeSpecRuntimePolicy;
using codexbar_display::esp8266::AssetPathPolicy;
using codexbar_display::esp8266::WifiSecurityPolicy;
using codexbar_display::esp8266::WifiOtaRecoveryRoute;
using codexbar_display::esp8266::WifiOtaRecoveryState;
using codexbar_display::esp8266::ConnectedSetupPolicy;

std::string readFile(const char* path);

bool expect(bool cond, const char* message) {
  if (!cond) {
    std::fprintf(stderr, "FAIL: %s\n", message);
    return false;
  }
  return true;
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

bool testWifiCredentialWritesAllowSetupOrCurrentToken() {
  if (!expect(
          WifiSecurityPolicy::AllowsCredentialWrite(true, false, false),
          "the setup access point must allow WiFi changes")) {
    return false;
  }
  if (!expect(
          WifiSecurityPolicy::AllowsCredentialWrite(false, true, true),
          "a paired device with its current token must allow WiFi changes")) {
    return false;
  }
  return expect(
      !WifiSecurityPolicy::AllowsCredentialWrite(false, false, false) &&
          !WifiSecurityPolicy::AllowsCredentialWrite(false, true, false),
      "station-mode writes without the current pairing token must remain denied");
}

bool testNoBootableStateMayBeWifiOtaUnrecoverable() {
  struct Case {
    const char* name;
    WifiOtaRecoveryState state;
    WifiOtaRecoveryRoute expected;
  };
  const Case cases[] = {
      {"home WiFi plus valid token", {true, false, true, true, true, false, true},
       WifiOtaRecoveryRoute::AuthenticatedUpload},
      {"home WiFi plus lost local token", {true, false, true, true, false, false, true},
       WifiOtaRecoveryRoute::PhysicalRecoveryThenPairThenUpload},
      {"home WiFi plus rejected local token", {true, false, true, true, false, false, true},
       WifiOtaRecoveryRoute::PhysicalRecoveryThenPairThenUpload},
      {"setup AP with paired device and lost token", {false, true, true, true, false, false, true},
       WifiOtaRecoveryRoute::PhysicalRecoveryThenPairThenUpload},
      {"fresh unpaired setup AP", {false, true, true, false, false, false, true},
       WifiOtaRecoveryRoute::SetupThenPairThenUpload},
      {"fresh unpaired SDK WiFi import", {true, false, true, false, false, true, true},
       WifiOtaRecoveryRoute::PairThenUpload},
      {"paired device after WiFi change", {true, false, true, true, true, false, true},
       WifiOtaRecoveryRoute::AuthenticatedUpload},
      {"open pairing window", {true, false, true, true, false, true, true},
       WifiOtaRecoveryRoute::PairThenUpload},
      {"closed pairing window", {true, false, true, true, false, false, true},
       WifiOtaRecoveryRoute::PhysicalRecoveryThenPairThenUpload},
      {"transient reconnect before setup fallback", {false, false, true, true, false, false, true},
       WifiOtaRecoveryRoute::PhysicalRecoveryThenPairThenUpload},
  };

  for (const Case& testCase : cases) {
    const WifiOtaRecoveryRoute actual = WifiSecurityPolicy::OtaRecoveryRoute(testCase.state);
    if (actual != testCase.expected || actual == WifiOtaRecoveryRoute::None) {
      std::fprintf(stderr, "OTA recovery case failed: %s\n", testCase.name);
      return expect(false, "no bootable state may be Wi-Fi OTA unrecoverable");
    }
  }

  const WifiOtaRecoveryState impossible = {false, false, false, true, false, false, false};
  const WifiOtaRecoveryState missingPhysicalRecovery = {true, false, true, true, false, false, false};
  return expect(
      WifiSecurityPolicy::OtaRecoveryRoute(impossible) == WifiOtaRecoveryRoute::None &&
          WifiSecurityPolicy::OtaRecoveryRoute(missingPhysicalRecovery) == WifiOtaRecoveryRoute::None,
      "no bootable state may be Wi-Fi OTA unrecoverable");
}

bool testFirmwareUploadAlwaysRequiresCurrentPairingToken() {
  if (!expect(
      WifiSecurityPolicy::AllowsFirmwareUpload(true, true) &&
          !WifiSecurityPolicy::AllowsFirmwareUpload(true, false) &&
          !WifiSecurityPolicy::AllowsFirmwareUpload(false, true) &&
          !WifiSecurityPolicy::AllowsFirmwareUpload(false, false),
      "firmware upload must never be open without the current pairing token")) {
    return false;
  }
  if (!expect(
          WifiSecurityPolicy::CountsAsPhysicalRecoveryReset(0) &&
              WifiSecurityPolicy::CountsAsPhysicalRecoveryReset(6),
          "only physical power and external resets may advance OTA recovery")) {
    return false;
  }
  for (uint32_t reason = 1; reason <= 5; ++reason) {
    if (!expect(
            !WifiSecurityPolicy::CountsAsPhysicalRecoveryReset(reason),
            "software, watchdog, exception and sleep resets must not advance OTA recovery")) {
      return false;
    }
  }
  return true;
}

bool testPairingHandlerReplacesTokenWithoutAuthGate(const char* mainPath) {
  const std::string mainSource = readFile(mainPath);
  const std::size_t handler = mainSource.find("void handlePairingAPI()");
  const std::size_t handlerEnd = mainSource.find("void handleAssetsList()", handler);
  const std::size_t tokenGeneration = mainSource.find("generateAuthToken()", handler);
  const std::size_t tokenSave = mainSource.find("saveDeviceAuthToken(token)", handler);
  return expect(
      handler != std::string::npos && handlerEnd != std::string::npos &&
          tokenGeneration < handlerEnd && tokenSave < handlerEnd &&
          mainSource.substr(handler, handlerEnd - handler).find("requestHasCurrentDeviceToken") == std::string::npos,
      "pairing must replace the token without requiring the previous token");
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

bool testWifiHelloReportsPairingWindowWithoutSecrets(const char* mainPath) {
  const std::string mainSource = readFile(mainPath);
  const std::size_t handler = mainSource.find("void handleHello()");
  const std::size_t handlerEnd = mainSource.find("bool isSafeAssetPath", handler);
  if (handler == std::string::npos || handlerEnd == std::string::npos) {
    return false;
  }
  const std::string helloHandler = mainSource.substr(handler, handlerEnd - handler);
  return expect(
      helloHandler.find("appendAuthStatusJSON(out)") != std::string::npos &&
          helloHandler.find("deviceAuthToken") == std::string::npos,
      "WiFi hello must report pairing status and window timing without exposing the token");
}

bool testFirstSetupPairingWindowIsThirtyMinutesAndOneUse(const char* mainPath) {
  const std::string mainSource = readFile(mainPath);
  const std::size_t duration = mainSource.find(
      "kPhysicalPairingWindowMs = 30UL * 60UL * 1000UL");
  const std::size_t markerConsumer = mainSource.find("consumePhysicalPairingSetupMarker()");
  const std::size_t markerClear = mainSource.find(
      "EEPROM.put(kPairingSetupMarkerOffset, static_cast<uint32_t>(0))",
      markerConsumer);
  const std::size_t pairHandler = mainSource.find("void handlePairingAPI()");
  const std::size_t windowConsumed = mainSource.find(
      "physicalPairingWindowExpiresAtMs = 0",
      pairHandler);
  const std::size_t saveHandler = mainSource.find("void handleSaveWifi()");
  const std::size_t unpairedSetup = mainSource.find(
      "!deviceAuthConfigured() || physicalPairingWindowOpen()",
      saveHandler);
  const std::size_t sdkImport = mainSource.find("bool connectToSdkWifiConfig()");
  const std::size_t sdkFirstPairing = mainSource.find(
      "const bool firstPairing = !deviceAuthConfigured()",
      sdkImport);
  const std::size_t sdkWindow = mainSource.find(
      "physicalPairingWindowExpiresAtMs = millis() + kPhysicalPairingWindowMs",
      sdkImport);
  return expect(
      duration != std::string::npos && markerConsumer != std::string::npos &&
          markerClear != std::string::npos && pairHandler != std::string::npos &&
          windowConsumed != std::string::npos && unpairedSetup != std::string::npos &&
          sdkFirstPairing != std::string::npos && sdkWindow > sdkFirstPairing,
      "first setup and confirmed physical recovery must preserve the time-bounded pairing window across WiFi save");
}

bool testEverySetupAccessPointUsesWritableSetupPage(const char* mainPath) {
  const std::string mainSource = readFile(mainPath);
  const std::size_t rootHandler = mainSource.find("void handleRoot()");
  const std::size_t rootEnd = mainSource.find("void redirectToSetupRoot()", rootHandler);
  const std::size_t captiveHandler = mainSource.find("void handleCaptivePortalProbe()");
  const std::size_t captiveEnd = mainSource.find("void handleSaveWifi()", captiveHandler);
  if (rootHandler == std::string::npos || rootEnd == std::string::npos ||
      captiveHandler == std::string::npos || captiveEnd == std::string::npos) {
    return false;
  }
  const std::string root = mainSource.substr(rootHandler, rootEnd - rootHandler);
  const std::string captive = mainSource.substr(captiveHandler, captiveEnd - captiveHandler);
  return expect(
      root.find("SendSetupPage(") != std::string::npos &&
          captive.find("SendSetupPage(") != std::string::npos &&
          mainSource.find("SendRecoveryPage(") == std::string::npos &&
          mainSource.find("physicalSetupAuthorized") == std::string::npos &&
          mainSource.find("startSetupAccessPoint(false)") == std::string::npos,
      "fresh setup and WiFi-failure setup must use the same writable setup page");
}

bool testSetupPortalIsReadyBeforeJoinInstructions(const char* mainPath) {
  const std::string mainSource = readFile(mainPath);
  const std::size_t start = mainSource.find("void startSetupAccessPoint()");
  const std::size_t end = mainSource.find("void maintainWifiConnection()", start);
  if (start == std::string::npos || end == std::string::npos) {
    return false;
  }
  const std::string body = mainSource.substr(start, end - start);
  const std::size_t clearError = body.find("ClearConnectionError(setupWifiState)");
  const std::size_t stopReconnect = body.find("WiFi.setAutoReconnect(false)");
  const std::size_t disconnect = body.find("WiFi.disconnect(false)");
  const std::size_t apOnly = body.find("WiFi.mode(WIFI_AP)");
  const std::size_t accessPoint = body.find("WiFi.softAP(kSetupApSsid)");
  const std::size_t dns = body.find("dnsServer.start(");
  const std::size_t http = body.find("startHttpServer()");
  const std::size_t joinInstructions = body.find("renderer.DrawSetupInstructions(");
  return expect(
      clearError < stopReconnect && stopReconnect < disconnect && disconnect < apOnly &&
          apOnly < accessPoint && accessPoint < dns && dns < http &&
          http < joinInstructions && body.find("scanSetupNetworks()") == std::string::npos,
      "setup display may invite joining only after the old STA attempt is stopped and AP, DNS, and HTTP are ready");
}

bool testCaptiveFirstResponseNeverBlocksOnWifiScan(const char* mainPath) {
  const std::string mainSource = readFile(mainPath);
  const std::size_t rootStart = mainSource.find("void handleRoot()");
  const std::size_t rootEnd = mainSource.find("void redirectToSetupRoot()", rootStart);
  const std::size_t probeStart = mainSource.find("void handleCaptivePortalProbe()");
  const std::size_t probeEnd = mainSource.find("void handleSaveWifi()", probeStart);
  const std::size_t scanStart = mainSource.find("void handleSetupWifiScan()");
  const std::size_t scanEnd = mainSource.find("void handleResetWifi()", scanStart);
  if (rootStart == std::string::npos || rootEnd == std::string::npos ||
      probeStart == std::string::npos || probeEnd == std::string::npos ||
      scanStart == std::string::npos || scanEnd == std::string::npos) {
    return false;
  }
  const std::string root = mainSource.substr(rootStart, rootEnd - rootStart);
  const std::string probe = mainSource.substr(probeStart, probeEnd - probeStart);
  const std::string scan = mainSource.substr(scanStart, scanEnd - scanStart);
  return expect(
      root.find("SendSetupPage(") != std::string::npos &&
          probe.find("SendSetupPage(") != std::string::npos &&
          root.find("scanSetupNetworks()") == std::string::npos &&
          probe.find("scanSetupNetworks()") == std::string::npos &&
          scan.find("scanSetupNetworks()") != std::string::npos,
      "iOS and other captive probes must get the normal setup form without a blocking scan; only Search again scans");
}

bool testAutomaticWifiFallbackNeverCarriesTheFailedSsid(const char* mainPath) {
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
  return expect(
      setup.find("startSetupAccessPoint()") != std::string::npos &&
          maintain.find("startSetupAccessPoint()") != std::string::npos &&
          setup.find("SetConnectionError(") == std::string::npos &&
          maintain.find("SetConnectionError(") == std::string::npos &&
          maintain.find("WiFi.SSID()") == std::string::npos,
      "automatic setup fallback must not show or prefill the failed SSID");
}

bool testWifiSavePreservesDeviceStateAndRetiresStaleSdkCredentials(const char* mainPath) {
  const std::string mainSource = readFile(mainPath);
  const std::size_t handler = mainSource.find("void handleSaveWifi()");
  const std::size_t handlerEnd = mainSource.find("void handleSetupWifiScan()", handler);
  const std::size_t save = mainSource.find("saveWifiCredentials(", handler);
  const std::size_t saveFailure = mainSource.find("if (!saveWifiCredentials(", handler);
  const std::size_t clearSdk = mainSource.find("clearSdkWifiCredentials();", handler);
  const std::size_t successResponse = mainSource.find(
      "webServer.send(200, \"text/html; charset=utf-8\"",
      handler);
  const std::size_t legacyImportGate = mainSource.find(
      "if (!wifiConnected && !hasSavedWifi)");
  if (handler == std::string::npos || handlerEnd == std::string::npos) {
    return false;
  }
  const std::string body = mainSource.substr(handler, handlerEnd - handler);
  return expect(
      save != std::string::npos && saveFailure != std::string::npos &&
          successResponse != std::string::npos && clearSdk > successResponse &&
          clearSdk < handlerEnd && legacyImportGate != std::string::npos &&
          body.find("saveDeviceAuthToken") == std::string::npos &&
          body.find("LittleFS") == std::string::npos &&
          body.find("saveDeviceSettings") == std::string::npos &&
          body.find("clearWifiCredentials") == std::string::npos,
      "WiFi save must preserve pairing, assets and settings and clear stale SDK credentials only after success");
}

bool testPhysicalRecoveryOnlyOpensPairingAndNeverErasesWifi(const char* mainPath) {
  const std::string mainSource = readFile(mainPath);
  const std::size_t trigger = mainSource.find("bool consumePhysicalRecoveryTrigger()");
  const std::size_t triggerEnd = mainSource.find("uint32_t incrementBootResetCounter()", trigger);
  const std::size_t setup = mainSource.find("void setup()");
  if (trigger == std::string::npos || triggerEnd == std::string::npos || setup == std::string::npos) {
    return false;
  }
  const std::string triggerBody = mainSource.substr(trigger, triggerEnd - trigger);
  return expect(
      triggerBody.find("CountsAsPhysicalRecoveryReset") != std::string::npos &&
          triggerBody.find("physical_recovery_triggered action=pairing_window") != std::string::npos &&
          triggerBody.find("clearWifiCredentials") == std::string::npos &&
          triggerBody.find("clearSdkWifiCredentials") == std::string::npos &&
          mainSource.find("consumePhysicalRecoveryTrigger()", setup) != std::string::npos &&
          mainSource.find("physicalPairingWindowExpiresAtMs =", setup) != std::string::npos,
      "physical OTA recovery may open pairing but must never erase WiFi or device state");
}

bool testRegisteredOtaEndpointsMatchAuthenticatedPolicy(const char* mainPath) {
  const std::string mainSource = readFile(mainPath);
  const std::size_t pageStart = mainSource.find("String updatePageHTML()");
  const std::size_t pageEnd = mainSource.find("void handleUpdatePage()", pageStart);
  const std::size_t multipart = mainSource.find("void handleOtaUpload(");
  const std::size_t multipartEnd = mainSource.find("void scheduleReboot(", multipart);
  const std::size_t multipartAuth = mainSource.find("requestHasValidOtaAuth()", multipart);
  const std::size_t multipartBegin = mainSource.find("Update.begin(", multipart);
  const std::size_t raw = mainSource.find("void handleRawOtaClient()");
  const std::size_t rawEnd = mainSource.find("void handleFrame()", raw);
  const std::size_t rawAuth = mainSource.find("WifiSecurityPolicy::AllowsFirmwareUpload", raw);
  const std::size_t rawBegin = mainSource.find("Update.begin(", raw);
  const std::size_t server = mainSource.find("void startHttpServer()");
  if (pageStart == std::string::npos || pageEnd == std::string::npos ||
      multipart == std::string::npos || multipartEnd == std::string::npos ||
      raw == std::string::npos || rawEnd == std::string::npos || server == std::string::npos) {
    return false;
  }
  const std::string page = mainSource.substr(pageStart, pageEnd - pageStart);
  const std::string registrations = mainSource.substr(server);
  return expect(
      multipartAuth > multipart && multipartAuth < multipartBegin && multipartBegin < multipartEnd &&
          rawAuth > raw && rawAuth < rawBegin && rawBegin < rawEnd &&
          registrations.find("webServer.on(\"/update\", HTTP_GET, handleUpdatePage)") != std::string::npos &&
          registrations.find("\"/update/firmware\"") != std::string::npos &&
          registrations.find("handleOtaUpload(U_FLASH, \"firmware\")") != std::string::npos &&
          registrations.find("\"/update/filesystem\"") != std::string::npos &&
          registrations.find("handleOtaUpload(U_FS, \"filesystem\")") != std::string::npos &&
          registrations.find("raw_ota_server_started port=8081 path=/update/firmware.raw") != std::string::npos &&
          page.find("deviceAuthToken") == std::string::npos &&
          page.find("tokenQuery") == std::string::npos &&
          page.find("Manual upload") == std::string::npos &&
          page.find("action='/update/firmware") == std::string::npos,
      "no bootable state may be Wi-Fi OTA unrecoverable");
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

bool testWifiHandlersAuthorizeBeforeStorageMutation(const char* mainPath) {
  const std::string mainSource = readFile(mainPath);
  const std::size_t saveHandler = mainSource.find("void handleSaveWifi()");
  const std::size_t saveAuthorization = mainSource.find("if (!authorizeWifiCredentialWrite())", saveHandler);
  const std::size_t saveMutation = mainSource.find("saveWifiCredentials(", saveHandler);
  const std::size_t resetHandler = mainSource.find("void handleResetWifi()");
  const std::size_t resetAuthorization = mainSource.find("if (!authorizeWifiCredentialWrite())", resetHandler);
  const std::size_t resetMutation = mainSource.find("clearWifiCredentials()", resetHandler);
  return expect(
      saveAuthorization != std::string::npos && saveMutation != std::string::npos &&
          saveAuthorization < saveMutation && resetAuthorization != std::string::npos &&
          resetMutation != std::string::npos && resetAuthorization < resetMutation,
      "WiFi handlers must authorize before changing credentials");
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
          ThemeSpecRuntimePolicy::CanAllocateCbaBuffer(24000, 12000, clippyBytes) &&
              !ThemeSpecRuntimePolicy::CanAllocateCbaBuffer(23000, 12000, clippyBytes) &&
              !ThemeSpecRuntimePolicy::CanAllocateCbaBuffer(30000, 10000, clippyBytes),
          "CBA allocation must preserve heap reserve and require one contiguous block")) {
    return false;
  }
  return expect(
      ThemeSpecRuntimePolicy::CanYieldAtDisplayTransactionDepth(0) &&
          !ThemeSpecRuntimePolicy::CanYieldAtDisplayTransactionDepth(1) &&
          !ThemeSpecRuntimePolicy::CanYieldAtDisplayTransactionDepth(2),
      "yield boundaries must require display transaction depth zero");
}

bool testRendererUsesResumableCbaAnimation(
    const char* themeSpecRendererPath,
    const char* displayRendererPath) {
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
              renderer.find("changedFields & themespec::kThemeSpecFieldActivity") != std::string::npos,
          "unfinished CBA work must resume quickly and activity switches must restart it")) {
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
          renderer.find("CanYieldAtDisplayTransactionDepth") != std::string::npos,
          "all explicit theme-renderer yields must be guarded by transaction depth")) {
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

bool testLegacyMiniThemeUsesLiveUsageMode(const char* mainPath) {
  const std::string mainSource = readFile(mainPath);
  if (!expect(
      mainSource.find("kLegacyDefaultThemeSpecPath = \"/themes/u/mini-cl-1-410a37.json\"") !=
              std::string::npos &&
          mainSource.find("raw.replace(\"\\\"v\\\":\\\"left\\\"\", \"\\\"v\\\":\\\"{usageMode}\\\"\")") !=
              std::string::npos,
      "legacy factory Mini specs must render the live usage mode after OTA")) {
    return false;
  }

  const std::size_t loadStart = mainSource.find("void loadDefaultStoredThemeSpecCache()");
  const std::size_t loadEnd = mainSource.find("#endif", loadStart);
  if (!expect(
          loadStart != std::string::npos && loadEnd != std::string::npos,
          "default ThemeSpec cache loader must remain discoverable")) {
    return false;
  }
  const std::string loader = mainSource.substr(loadStart, loadEnd - loadStart);
  const std::size_t active = loader.find("readActiveThemeSpecPath(activePath)");
  const std::size_t currentDefault = loader.find("loadStoredThemeSpecCacheFromPath(kDefaultThemeSpecPath)");
  const std::size_t previousDefault = loader.find("loadStoredThemeSpecCacheFromPath(kPreviousDefaultThemeSpecPath)");
  const std::size_t legacyDefault = loader.find("loadStoredThemeSpecCacheFromPath(kLegacyDefaultThemeSpecPath)");
  return expect(
      active != std::string::npos && currentDefault != std::string::npos &&
          previousDefault != std::string::npos && legacyDefault != std::string::npos &&
          active < currentDefault && currentDefault < previousDefault && previousDefault < legacyDefault,
      "OTA filesystems must fall back through current, 1.0.37, then 1.0.36 Mini specs");
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
          mainSource.find("WiFi.localIP().toString()") != std::string::npos &&
          mainSource.find("192.168.4.1") != std::string::npos,
      "firmware must expose setup and station endpoints by IP without mDNS");
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

}  // namespace

int main(int argc, char** argv) {
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
  if (!testWifiCredentialWritesAllowSetupOrCurrentToken()) {
    return 1;
  }
  if (!testNoBootableStateMayBeWifiOtaUnrecoverable()) {
    return 1;
  }
  if (!testFirmwareUploadAlwaysRequiresCurrentPairingToken()) {
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
  if (!expect(argc == 6, "source paths are required for firmware policy tests")) {
    return 1;
  }
  if (!testRendererUsesResumableCbaAnimation(argv[1], argv[4])) {
    return 1;
  }
  if (!testDecoderAllocationStaysInsideRealPlayback(argv[1], argv[2])) {
    return 1;
  }
  if (!testGifLoopResetStaysAtomic(argv[2])) {
    return 1;
  }
  if (!testLegacyMiniThemeUsesLiveUsageMode(argv[3])) {
    return 1;
  }
  if (!testAssetHandlersUseThemeNamespacePolicy(argv[3])) {
    return 1;
  }
  if (!testWifiHandlersAuthorizeBeforeStorageMutation(argv[3])) {
    return 1;
  }
  if (!testPairingHandlerReplacesTokenWithoutAuthGate(argv[3])) {
    return 1;
  }
  if (!testConnectedPageNeverRendersPairingSecret(argv[3])) {
    return 1;
  }
  if (!testWifiHelloReportsPairingWindowWithoutSecrets(argv[3])) {
    return 1;
  }
  if (!testFirstSetupPairingWindowIsThirtyMinutesAndOneUse(argv[3])) {
    return 1;
  }
  if (!testEverySetupAccessPointUsesWritableSetupPage(argv[3])) {
    return 1;
  }
  if (!testSetupPortalIsReadyBeforeJoinInstructions(argv[3])) {
    return 1;
  }
  if (!testCaptiveFirstResponseNeverBlocksOnWifiScan(argv[3])) {
    return 1;
  }
  if (!testAutomaticWifiFallbackNeverCarriesTheFailedSsid(argv[3])) {
    return 1;
  }
  if (!testWifiSavePreservesDeviceStateAndRetiresStaleSdkCredentials(argv[3])) {
    return 1;
  }
  if (!testPhysicalRecoveryOnlyOpensPairingAndNeverErasesWifi(argv[3])) {
    return 1;
  }
  if (!testRegisteredOtaEndpointsMatchAuthenticatedPolicy(argv[3])) {
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

  std::printf("ok: gif_core_policy_test\n");
  return 0;
}
