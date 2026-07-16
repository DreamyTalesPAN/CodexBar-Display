#include <Arduino.h>
#include <DNSServer.h>
#include <EEPROM.h>
#include <ESP8266WebServer.h>
#include <ESP8266WiFi.h>
#include <WiFiUdp.h>
#include <LittleFS.h>
#include <Updater.h>

#include "../../firmware_shared/app_runtime.h"
#include "../../firmware_shared/app_transport.h"
#include "../../firmware_shared/theme_spec_renderer_core.h"
#include "boot_recovery_policy.h"
#include "frame_render_policy.h"
#include "gif_asset_validator_file.h"
#include "renderer_esp8266.h"

#ifndef CODEXBAR_DISPLAY_BOARD_ID
#define CODEXBAR_DISPLAY_BOARD_ID "esp8266-unknown"
#endif

#ifndef CODEXBAR_DISPLAY_FW_VERSION
#define CODEXBAR_DISPLAY_FW_VERSION "dev"
#endif

#if CODEXBAR_DISPLAY_THEME_SPEC_RENDERER
const char kThemeFeatureJSON[] = "[\"theme\",\"theme-spec-v1\"]";
#else
const char kThemeFeatureJSON[] = "[\"theme\"]";
#endif

namespace {

codexbar_display::app::RuntimeContext runtimeCtx;
codexbar_display::esp8266::RendererESP8266 renderer;
ESP8266WebServer webServer(80);
WiFiServer rawOtaServer(8081);
DNSServer dnsServer;

constexpr int kMaxFrameBytes = 2048;
constexpr uint16_t kDnsPort = 53;
constexpr uint32_t kWifiCredsMagic = 0x56544231UL;  // VTB1
constexpr uint32_t kBootRecoveryMagic = 0x56544252UL;  // VTBR
constexpr uint32_t kBootDiagnosticsMagic = 0x56544244UL;  // VTBD
constexpr size_t kWifiSsidBytes = 33;
constexpr size_t kWifiPasswordBytes = 65;
constexpr size_t kWifiCredsBytes = 4 + kWifiSsidBytes + kWifiPasswordBytes;
constexpr size_t kBootRecoveryOffset = kWifiCredsBytes;
constexpr size_t kBootRecoveryBytes = 6;
constexpr size_t kBootRecoveryCounterOffset = kBootRecoveryOffset + 4;
constexpr size_t kBootRecoveryUploadOffset = kBootRecoveryOffset + 5;
constexpr size_t kBootDiagnosticsOffset = kBootRecoveryOffset + kBootRecoveryBytes;
constexpr size_t kBootDiagnosticsBytes = 8;
constexpr size_t kBootResetCounterOffset = kBootDiagnosticsOffset + 4;
constexpr size_t kEepromBytes = kWifiCredsBytes + kBootRecoveryBytes + kBootDiagnosticsBytes;
constexpr unsigned long kWifiConnectTimeoutMs = 20000UL;
constexpr unsigned long kWifiReconnectRetryMs = 5000UL;
constexpr unsigned long kWifiReconnectFallbackMs = 120000UL;
constexpr unsigned long kRebootDelayMs = 750UL;
constexpr unsigned long kBootRecoveryStableMs = 30000UL;
constexpr unsigned long kFrameStaleWarningMs = 150000UL;
constexpr unsigned long kFirmwareUpdateNoticeToggleMs = 1500UL;
constexpr uint8_t kBootRecoveryThreshold = 3;
constexpr uint8_t kBootRecoveryUploadMarker = 0xA5;
constexpr size_t kMaxAssetPathBytes = 32;
constexpr size_t kMaxStoredThemeSpecBytes = 4096;
constexpr size_t kMaxThemeGifAssetBytes = codexbar_display::themespec::kMaxThemeSpecGifAssetBytes;
constexpr uint8_t kDefaultBrightnessPercent = 100;
constexpr uint8_t kMinBrightnessPercent = 10;
constexpr uint8_t kMaxBrightnessPercent = 100;
constexpr size_t kSetupWifiOptionsMaxBytes = 900;
constexpr uint8_t kSetupWifiMaxOptions = 10;
const char kSetupApSsid[] = "VibeTV-Setup";
const char kSetupAddress[] = "192.168.4.1";
const char kCustomerAppHost[] = "app.vibetv.shop";
const char kCustomerAppUrl[] = "https://app.vibetv.shop";
const char kDeviceSettingsPath[] = "/s";
const char kDeviceAuthTokenPath[] = "/auth";
const char kActiveThemeSpecPathFile[] = "/theme-active";
const char kAssetUploadTemporaryPath[] = "/.asset-upload.tmp";
const char kDeviceAuthHeader[] = "X-VibeTV-Token";
const char kFirmwareManifestUrl[] = "https://github.com/DreamyTalesPAN/CodexBar-Display/releases/latest/download/firmware-manifest.json";
constexpr uint8_t kFirmwareUpdateNoticeTextCount = 3;
constexpr uint8_t kFirmwareUpdateNoticeProviderPhase = 0;
constexpr uint8_t kFirmwareUpdateNoticeAvailablePhase = 1;
constexpr uint8_t kFirmwareUpdateNoticeAppPhase = 2;

String themeCapabilitiesJSON(bool enabled, bool compact = false) {
  String out;
  out.reserve(compact ? 180 : 260);
  if (!enabled) {
    return "{\"supportsThemeSpecV1\":false,\"maxThemeSpecBytes\":0,\"maxThemePrimitives\":0}";
  }
  out += "{\"supportsThemeSpecV1\":true,\"maxThemeSpecBytes\":2048,\"maxThemePrimitives\":";
  out += String(codexbar_display::themespec::kMaxCompiledThemeSpecPrimitives);
  if (!compact) {
    out += ",\"supportedPrimitiveTypes\":[\"text\",\"rect\",\"progress\",\"gif\",\"sprite\",\"pixels\"]";
    out += ",\"supportsStoredThemes\":true";
  }
  out += ",\"maxStoredThemeSpecBytes\":";
  out += String(kMaxStoredThemeSpecBytes);
  out += ",\"maxThemeGifAssets\":";
  out += String(codexbar_display::themespec::kMaxThemeSpecGifAssets);
  out += ",\"maxThemeGifBytes\":";
  out += String(codexbar_display::themespec::kMaxThemeSpecGifAssetBytes);
  out += ",\"maxThemeGifWidth\":";
  out += String(codexbar_display::themespec::kMaxThemeSpecGifWidth);
  out += ",\"maxThemeGifHeight\":";
  out += String(codexbar_display::themespec::kMaxThemeSpecGifHeight);
  out += ",\"maxThemeGifPixels\":";
  out += String(codexbar_display::themespec::kMaxThemeSpecGifPixels);
  out += ",\"maxThemeGifLzwBits\":";
  out += String(codexbar_display::esp8266::kMaxThemeGifLzwBits);
  out += "}";
  return out;
}

struct WifiCredentials {
  char ssid[kWifiSsidBytes] = {0};
  char password[kWifiPasswordBytes] = {0};
};

struct FirmwareUpdateState {
  bool available = false;
  String latestVersion;
  String lastStatus = "disabled";
  String lastError;
  unsigned long lastCheckedAtMs = 0;
  unsigned long nextCheckAtMs = 0;
  bool noticeVisible = false;
  uint8_t noticePhase = 0;
  unsigned long noticeLastToggleAtMs = 0;
};

struct OtaUploadDiagnostics {
  const char* target = "none";
  const char* status = "idle";
  String filename;
  String lastError;
  int command = -1;
  size_t contentLength = 0;
  size_t totalSize = 0;
  size_t maxSize = 0;
  size_t freeSketchSpace = 0;
  uint8_t updateError = UPDATE_ERROR_OK;
  unsigned long startedAtMs = 0;
  unsigned long endedAtMs = 0;
  unsigned long successCount = 0;
  unsigned long failureCount = 0;
};

struct RuntimeRenderDiagnostics {
  unsigned long fullCount = 0;
  unsigned long partialCount = 0;
  unsigned long animatedTickAttempts = 0;
  const char* lastKind = "none";
  const char* lastFullKind = "none";
  const char* lastPartialKind = "none";
  unsigned long lastDurationUs = 0;
  unsigned long lastAtMs = 0;
};

struct DeviceSettings {
  uint8_t brightnessPercent = kDefaultBrightnessPercent;
};

bool httpServerStarted = false;
bool rawOtaServerStarted = false;
bool setupMode = false;
bool waitStatusRendered = false;
bool otaUploadSucceeded = false;
bool otaUploadInProgress = false;
String otaUploadError;
bool assetUploadSucceeded = false;
bool assetUploadInProgress = false;
String assetUploadError;
String assetUploadPath;
size_t assetUploadBytesSeen = 0;
File assetUploadFile;
String activeThemeSpecPath;
String activeThemeSpecHash;
String setupWifiOptionsHTML;
bool rebootPending = false;
unsigned long rebootAtMs = 0;
bool bootRecoveryCounterNeedsClear = false;
unsigned long bootRecoveryClearAtMs = 0;
unsigned long lastFrameAcceptedAtMs = 0;
bool frameStaleStatusRendered = false;
bool captiveDnsStarted = false;
unsigned long wifiDisconnectedAtMs = 0;
unsigned long wifiReconnectAttemptAtMs = 0;
bool wifiReconnectStatusRendered = false;
FirmwareUpdateState firmwareUpdate;
bool firmwareUpdateNoticeDirty = false;
OtaUploadDiagnostics otaDiagnostics;
RuntimeRenderDiagnostics renderDiagnostics;
DeviceSettings deviceSettings;
String deviceAuthToken;
String bootID;
String bootResetReasonJSON;
uint32_t bootResetCounter = 0;

void addCorsHeaders();

#if CODEXBAR_DISPLAY_THEME_SPEC_RENDERER
constexpr const char* kDefaultThemeSpecPath = "/themes/u/mini-cl-1-410a37.json";
constexpr const char* kDefaultThemeSpecId = "mini-classic";
constexpr int kDefaultThemeSpecRev = 1;
#endif

void recordRenderFull(const char* kind, unsigned long durationUs) {
  renderDiagnostics.fullCount++;
  renderDiagnostics.lastKind = kind;
  renderDiagnostics.lastFullKind = kind;
  renderDiagnostics.lastDurationUs = durationUs;
  renderDiagnostics.lastAtMs = millis();
}

void recordRenderPartial(const char* kind, unsigned long durationUs) {
  renderDiagnostics.partialCount++;
  renderDiagnostics.lastKind = kind;
  renderDiagnostics.lastPartialKind = kind;
  renderDiagnostics.lastDurationUs = durationUs;
  renderDiagnostics.lastAtMs = millis();
}

void recordAnimatedTickAttempt() {
  renderDiagnostics.animatedTickAttempts++;
}

String jsonEscape(const String& raw) {
  String escaped;
  escaped.reserve(raw.length() + 8);
  for (size_t i = 0; i < raw.length(); ++i) {
    const char c = raw.charAt(i);
    switch (c) {
      case '\\':
        escaped += "\\\\";
        break;
      case '"':
        escaped += "\\\"";
        break;
      case '\n':
        escaped += "\\n";
        break;
      case '\r':
        escaped += "\\r";
        break;
      case '\t':
        escaped += "\\t";
        break;
      default:
        escaped += c;
        break;
    }
  }
  return escaped;
}

uint32_t fnv1a32(const String& raw) {
  uint32_t hash = 2166136261UL;
  for (size_t i = 0; i < raw.length(); ++i) {
    hash ^= static_cast<uint8_t>(raw[i]);
    hash *= 16777619UL;
  }
  return hash;
}

String hashHex8(const String& raw) {
  String out = String(fnv1a32(raw), HEX);
  while (out.length() < 8) {
    out = "0" + out;
  }
  return out;
}

void appendJSONNullableString(String& out, const String& value) {
  if (value.length() == 0) {
    out += "null";
    return;
  }
  out += "\"";
  out += jsonEscape(value);
  out += "\"";
}

uint8_t clampBrightnessPercent(int value) {
  if (value < kMinBrightnessPercent) {
    return kMinBrightnessPercent;
  }
  if (value > kMaxBrightnessPercent) {
    return kMaxBrightnessPercent;
  }
  return static_cast<uint8_t>(value);
}

void applyDeviceSettings() {
  if (renderer.SupportsBrightnessControl()) {
    renderer.ApplyBrightnessPercent(deviceSettings.brightnessPercent);
  }
}

bool loadDeviceSettings() {
  deviceSettings = DeviceSettings{};
  if (!LittleFS.begin() || !LittleFS.exists(kDeviceSettingsPath)) {
    applyDeviceSettings();
    return false;
  }
  File file = LittleFS.open(kDeviceSettingsPath, "r");
  if (!file) {
    applyDeviceSettings();
    return false;
  }
  const int brightness = file.read();
  file.close();
  if (brightness <= 0) {
    applyDeviceSettings();
    return false;
  }
  deviceSettings.brightnessPercent = clampBrightnessPercent(brightness);
  applyDeviceSettings();
  return true;
}

bool saveDeviceSettings() {
  if (!LittleFS.begin()) {
    return false;
  }
  File file = LittleFS.open(kDeviceSettingsPath, "w");
  if (!file) {
    return false;
  }
  const size_t written = file.write(&deviceSettings.brightnessPercent, 1);
  file.close();
  return written > 0;
}

bool validAuthToken(const String& value) {
  if (value.length() < 16 || value.length() > 64) {
    return false;
  }
  for (size_t i = 0; i < value.length(); ++i) {
    const char c = value.charAt(i);
    const bool ok =
        (c >= 'a' && c <= 'z') ||
        (c >= 'A' && c <= 'Z') ||
        (c >= '0' && c <= '9') ||
        c == '-' ||
        c == '_';
    if (!ok) {
      return false;
    }
  }
  return true;
}

String generateAuthToken() {
  uint32_t seed = ESP.getCycleCount() ^ micros() ^ (static_cast<uint32_t>(ESP.getChipId()) << 8);
  randomSeed(seed);
  String token;
  token.reserve(32);
  for (uint8_t i = 0; i < 4; ++i) {
    uint32_t value = static_cast<uint32_t>(random(0x10000)) << 16;
    value |= static_cast<uint32_t>(random(0x10000));
    char chunk[9];
    snprintf(chunk, sizeof(chunk), "%08lx", static_cast<unsigned long>(value));
    token += chunk;
  }
  return token;
}

bool loadDeviceAuthToken() {
  deviceAuthToken = "";
  if (!LittleFS.begin() || !LittleFS.exists(kDeviceAuthTokenPath)) {
    return false;
  }
  File file = LittleFS.open(kDeviceAuthTokenPath, "r");
  if (!file) {
    return false;
  }
  String token = file.readString();
  file.close();
  token.trim();
  if (!validAuthToken(token)) {
    return false;
  }
  deviceAuthToken = token;
  return true;
}

bool saveDeviceAuthToken(const String& token) {
  if (!validAuthToken(token) || !LittleFS.begin()) {
    return false;
  }
  File file = LittleFS.open(kDeviceAuthTokenPath, "w");
  if (!file) {
    return false;
  }
  file.print(token);
  file.close();
  deviceAuthToken = token;
  return true;
}

bool deviceAuthConfigured() {
  return deviceAuthToken.length() > 0;
}

String requestAuthToken() {
  String token = webServer.header(kDeviceAuthHeader);
  token.trim();
  if (token.length() == 0) {
    token = webServer.arg("token");
    token.trim();
  }
  return token;
}

bool requestHasValidAuth() {
  if (!deviceAuthConfigured()) {
    return true;
  }
  return requestAuthToken() == deviceAuthToken;
}

bool requireWriteAuth() {
  if (requestHasValidAuth()) {
    return true;
  }
  addCorsHeaders();
  webServer.sendHeader("WWW-Authenticate", "VibeTV token");
  webServer.send(401, "text/plain; charset=utf-8", "pairing token required");
  return false;
}

void appendAuthStatusJSON(String& out) {
  out += "\"auth\":{\"paired\":";
  out += deviceAuthConfigured() ? "true" : "false";
  out += ",\"tokenHeader\":\"";
  out += kDeviceAuthHeader;
  out += "\"}";
}

void appendBrightnessCapabilityJSON(String& out) {
  out += "{\"supported\":";
  out += renderer.SupportsBrightnessControl() ? "true" : "false";
  out += "}";
}

void appendSettingsJSON(String& out) {
  out += "\"settings\":{\"display\":{\"brightnessPercent\":";
  out += String(deviceSettings.brightnessPercent);
  out += "}}";
}

void markFirmwareUpdateNoticeDirty() {
  if (!codexbar_display::app::HasFrame(runtimeCtx) ||
      codexbar_display::app::CurrentFrame(runtimeCtx).hasError) {
    return;
  }
  if (!codexbar_display::app::CurrentFrame(runtimeCtx).hasThemeSpec) {
    return;
  }
  if (!runtimeCtx.screenDirty && !waitStatusRendered && !frameStaleStatusRendered) {
    firmwareUpdateNoticeDirty = true;
  } else {
    runtimeCtx.screenDirty = true;
  }
}

bool shouldShowFirmwareUpdateNotice() {
  return firmwareUpdate.available &&
         firmwareUpdate.noticeVisible &&
         !setupMode &&
         !waitStatusRendered &&
         !frameStaleStatusRendered &&
         codexbar_display::app::HasFrame(runtimeCtx) &&
         codexbar_display::app::CurrentFrame(runtimeCtx).hasThemeSpec &&
         !codexbar_display::app::CurrentFrame(runtimeCtx).hasError;
}

const char* currentFirmwareUpdateNoticeText() {
  if (firmwareUpdate.noticePhase >= kFirmwareUpdateNoticeTextCount) {
    firmwareUpdate.noticePhase = 0;
  }
  if (firmwareUpdate.noticePhase == kFirmwareUpdateNoticeAvailablePhase) {
    return "Update available";
  }
  if (firmwareUpdate.noticePhase == kFirmwareUpdateNoticeAppPhase) {
    return kCustomerAppHost;
  }

  const codexbar_display::core::Frame& frame = codexbar_display::app::CurrentFrame(runtimeCtx);
  if (runtimeCtx.topLineOverride.length()) {
    return runtimeCtx.topLineOverride.c_str();
  }
  if (frame.label.length()) {
    return frame.label.c_str();
  }
  if (frame.provider.length()) {
    return frame.provider.c_str();
  }
  return "Provider";
}

void drawFirmwareUpdateNotice() {
  if (!shouldShowFirmwareUpdateNotice()) {
    firmwareUpdateNoticeDirty = false;
    return;
  }
  renderer.DrawFirmwareUpdateNotice(runtimeCtx, currentFirmwareUpdateNoticeText());
  firmwareUpdateNoticeDirty = false;
}

void clearFirmwareUpdateNotice() {
  if (!firmwareUpdate.noticeVisible) {
    return;
  }
  firmwareUpdate.noticeVisible = false;
  firmwareUpdate.noticePhase = 0;
  firmwareUpdate.noticeLastToggleAtMs = 0;
  firmwareUpdateNoticeDirty = false;
  if (codexbar_display::app::HasFrame(runtimeCtx) &&
      !codexbar_display::app::CurrentFrame(runtimeCtx).hasError &&
      !waitStatusRendered &&
      !frameStaleStatusRendered) {
    runtimeCtx.screenDirty = true;
  }
}

void maintainFirmwareUpdateNotice() {
  if (!firmwareUpdate.available ||
      setupMode ||
      frameStaleStatusRendered ||
      !codexbar_display::app::HasFrame(runtimeCtx) ||
      !codexbar_display::app::CurrentFrame(runtimeCtx).hasThemeSpec ||
      codexbar_display::app::CurrentFrame(runtimeCtx).hasError) {
    clearFirmwareUpdateNotice();
    return;
  }
  if (!firmwareUpdate.noticeVisible) {
    return;
  }
  const unsigned long nowMs = millis();
  if (firmwareUpdate.noticeLastToggleAtMs == 0) {
    firmwareUpdate.noticeLastToggleAtMs = nowMs;
    return;
  }
  if ((nowMs - firmwareUpdate.noticeLastToggleAtMs) >= kFirmwareUpdateNoticeToggleMs) {
    firmwareUpdate.noticeLastToggleAtMs = nowMs;
    firmwareUpdate.noticePhase = (firmwareUpdate.noticePhase + 1) % kFirmwareUpdateNoticeTextCount;
    markFirmwareUpdateNoticeDirty();
  }
}

void applyFrameUpdateState() {
  if (!codexbar_display::app::HasFrame(runtimeCtx)) {
    return;
  }

  const codexbar_display::core::Frame& frame = codexbar_display::app::CurrentFrame(runtimeCtx);
  if (!frame.hasUpdateAvailable) {
    clearFirmwareUpdateNotice();
    return;
  }

  String nextStatus = frame.updateStatus;
  if (nextStatus.length() == 0) {
    nextStatus = frame.updateAvailable ? "update_available" : "current";
  }
  const bool changed = firmwareUpdate.available != frame.updateAvailable ||
                       firmwareUpdate.latestVersion != frame.updateLatestVersion ||
                       firmwareUpdate.lastStatus != nextStatus ||
                       firmwareUpdate.lastError != frame.updateLastError;
  firmwareUpdate.available = frame.updateAvailable;
  firmwareUpdate.latestVersion = frame.updateLatestVersion;
  firmwareUpdate.lastError = frame.updateLastError;
  firmwareUpdate.lastCheckedAtMs = millis();
  firmwareUpdate.nextCheckAtMs = 0;
  firmwareUpdate.lastStatus = nextStatus;

  if (!firmwareUpdate.available) {
    clearFirmwareUpdateNotice();
    return;
  }
  if (!firmwareUpdate.noticeVisible || changed) {
    firmwareUpdate.noticeVisible = true;
    firmwareUpdate.noticePhase = 0;
    firmwareUpdate.noticeLastToggleAtMs = millis();
    markFirmwareUpdateNoticeDirty();
  }
}

void drawWaitingForCompanionStatus() {
  const unsigned long renderStartUs = micros();
  renderer.DrawConnectedSetupInstructions(runtimeCtx, kCustomerAppHost, WiFi.localIP().toString());
  recordRenderFull("connected_setup", micros() - renderStartUs);
  waitStatusRendered = true;
}

void drawWifiConnectingStatus(const String& ssid) {
  const unsigned long renderStartUs = micros();
  renderer.DrawStatus(runtimeCtx, "VIBE TV", "Connecting WiFi", ssid);
  recordRenderFull("status", micros() - renderStartUs);
}

void drawWifiResetStatus(const String& line2) {
  const unsigned long renderStartUs = micros();
  renderer.DrawStatus(runtimeCtx, "VIBE TV RESET", "WiFi reset", line2);
  recordRenderFull("status", micros() - renderStartUs);
}

void drawUpdateStatus(const String& line2) {
  const unsigned long renderStartUs = micros();
  renderer.DrawStatus(runtimeCtx, "VIBE TV UPDATE", "Update running", line2);
  recordRenderFull("update_status", micros() - renderStartUs);
}

bool statusScreenLocked() {
  return otaUploadInProgress || rebootPending;
}

void resetWifiReconnectState() {
  wifiDisconnectedAtMs = 0;
  wifiReconnectAttemptAtMs = 0;
  wifiReconnectStatusRendered = false;
}

String displayErrorMessage(const String& message) {
  if (message == "runtime/codexbar-version" || message == "runtime/codexbar-parse") {
    return "Update Mac App";
  }
  if (message == "runtime/codexbar-binary") {
    return "Install Mac App";
  }
  if (message == "runtime/no-providers") {
    return "Open App";
  }
  if (message == "runtime/codexbar-cmd") {
    return "Open App";
  }
  if (message == "runtime/cycle-timeout") {
    return "Open App";
  }
  return "Open App";
}

void markFrameAccepted(const codexbar_display::core::SerialConsumeEvent& event, const char* transport) {
  if (statusScreenLocked()) {
    Serial.printf("frame_ignored transport=%s reason=status_screen_locked\n", transport);
    return;
  }

  const bool redrawAfterStatus = waitStatusRendered || frameStaleStatusRendered;
  waitStatusRendered = false;
  frameStaleStatusRendered = false;
  if (redrawAfterStatus) {
    // A setup or OTA status screen covers the whole display. Never apply a
    // partial ThemeSpec update on top of it; the first accepted frame must
    // rebuild the complete customer screen.
    runtimeCtx.screenDirty = true;
  }
  lastFrameAcceptedAtMs = millis();
  applyFrameUpdateState();
  if (event.themeSpecChanged) {
#if CODEXBAR_DISPLAY_THEME_SPEC_RENDERER
    if (codexbar_display::app::HasFrame(runtimeCtx) &&
        codexbar_display::app::CurrentFrame(runtimeCtx).hasThemeSpec) {
      const String& raw = codexbar_display::app::CurrentFrame(runtimeCtx).themeSpecRaw;
      if (raw.length() > 0) {
        activeThemeSpecHash = hashHex8(raw);
      }
    } else {
      activeThemeSpecPath = "";
      activeThemeSpecHash = "";
    }
#else
    activeThemeSpecPath = "";
    activeThemeSpecHash = "";
#endif
  }

  // Never render a WiFi frame from inside ESP8266WebServer::handleClient().
  // ThemeSpec partial rendering can decode assets and touch the TFT for long
  // enough to starve the WiFi stack or hardware watchdog. Marking the screen
  // dirty makes RendererESP8266::OnFrameAccepted skip its synchronous partial
  // path; the normal main-loop render block will draw the accepted frame on
  // the next iteration. USB keeps its existing low-latency partial path.
  const bool deferVisualRender =
      codexbar_display::esp8266::FrameRenderPolicy::ShouldDeferToMainLoop(
          transport != nullptr && strcmp(transport, "wifi") == 0,
          event.visualChanged);
  if (deferVisualRender) {
    runtimeCtx.screenDirty = true;
  }
  const bool maybeThemeSpecPartial = event.themeSpecPartialRender && !runtimeCtx.screenDirty;
  const unsigned long partialStartUs = maybeThemeSpecPartial ? micros() : 0;
  const unsigned long partialSuccessesBefore =
      maybeThemeSpecPartial ? renderer.DebugSnapshot().themeSpecPartialSuccesses : 0;
  renderer.OnFrameAccepted(runtimeCtx, event);
  if (maybeThemeSpecPartial) {
    const codexbar_display::esp8266::RendererDebugSnapshot snapshot = renderer.DebugSnapshot();
    if (snapshot.themeSpecPartialSuccesses > partialSuccessesBefore && !runtimeCtx.screenDirty) {
      recordRenderPartial("theme_spec_frame", micros() - partialStartUs);
    }
  }
  Serial.printf("frame_received transport=%s\n", transport);
}

const char* transportCapabilitiesJSON(const char* activeTransport, bool compact = false) {
  const bool isUsb = activeTransport != nullptr && strcmp(activeTransport, "usb") == 0;
  static String json;
  json = "{\"display\":{";
  if (!compact) {
    json += "\"widthPx\":240,\"heightPx\":240,\"colorDepthBits\":16,";
  }
  json += "\"brightness\":";
  appendBrightnessCapabilityJSON(json);
  json += "},\"theme\":";
#ifdef CODEXBAR_DISPLAY_PROBE_ONLY
  json += themeCapabilitiesJSON(false, compact);
#else
#if CODEXBAR_DISPLAY_THEME_SPEC_RENDERER
  json += themeCapabilitiesJSON(true, compact);
#else
  json += themeCapabilitiesJSON(false, compact);
#endif
#endif
  json += ",";
  appendAuthStatusJSON(json);
  json += ",\"transport\":{\"active\":\"";
  json += isUsb ? "usb" : "wifi";
  json += "\",\"supported\":[\"usb\",\"wifi\"]}}";
  return json.c_str();
}

codexbar_display::app::TransportConfig makeTransportConfig(const char* activeTransport) {
  codexbar_display::app::TransportConfig config;
  config.boardId = CODEXBAR_DISPLAY_BOARD_ID;
  config.firmwareVersion = CODEXBAR_DISPLAY_FW_VERSION;
#ifdef CODEXBAR_DISPLAY_PROBE_ONLY
  config.featuresJSON = "[]";
#else
  config.featuresJSON = kThemeFeatureJSON;
#endif
  config.capabilitiesJSON = transportCapabilitiesJSON(activeTransport);
  config.maxFrameBytes = kMaxFrameBytes;
  return config;
}

String htmlEscape(const String& raw) {
  String escaped;
  escaped.reserve(raw.length());
  for (size_t i = 0; i < raw.length(); ++i) {
    const char c = raw.charAt(i);
    switch (c) {
      case '&':
        escaped += "&amp;";
        break;
      case '<':
        escaped += "&lt;";
        break;
      case '>':
        escaped += "&gt;";
        break;
      case '"':
        escaped += "&quot;";
        break;
      default:
        escaped += c;
        break;
    }
  }
  return escaped;
}

String macInstallerCommand() {
  return F("curl -fsSL https://github.com/DreamyTalesPAN/CodexBar-Display/releases/latest/download/install.sh | bash");
}

String updateTargetURL() {
  return String("http://") + WiFi.localIP().toString();
}

String updateInstallCommand() {
  const String target = updateTargetURL();
  String command;
  command.reserve(260);
  command += macInstallerCommand();
  command += F(" -s -- --target ");
  command += target;
  command += F(" && codexbar-display install-update --confirm-live-update --target ");
  command += target;
  return command;
}

String updateStatusHTML(bool compact) {
  String html;
  html.reserve(700);
  if (firmwareUpdate.available) {
    html += compact ? F("<div class='update'>") : F("<section class='update'>");
    html += F("<strong>Firmware update available</strong>");
    html += F("<span>Installed: <code>");
    html += htmlEscape(String(CODEXBAR_DISPLAY_FW_VERSION));
    html += F("</code>");
    if (firmwareUpdate.latestVersion.length() > 0) {
      html += F(" / Latest: <code>");
      html += htmlEscape(firmwareUpdate.latestVersion);
      html += F("</code>");
    }
    html += F("</span><a class='update-link' href='/update'>Install update</a>");
    html += compact ? F("</div>") : F("</section>");
    return html;
  }

  if (!compact) {
    html += F("<section><h2>Firmware status</h2><p class='muted'>Installed: <code>");
    html += htmlEscape(String(CODEXBAR_DISPLAY_FW_VERSION));
    html += F("</code>");
    html += F("<br>Status: <code>");
    html += htmlEscape(firmwareUpdate.lastStatus);
    html += F("</code>");
    if (firmwareUpdate.lastError.length() > 0) {
      html += F("<br>Last check error: <code>");
      html += htmlEscape(firmwareUpdate.lastError);
      html += F("</code>");
    }
    html += F("</p></section>");
  }
  return html;
}

bool readWifiCredentials(WifiCredentials& creds) {
  EEPROM.begin(kEepromBytes);
  uint32_t magic = 0;
  EEPROM.get(0, magic);
  if (magic != kWifiCredsMagic) {
    return false;
  }

  for (size_t i = 0; i < kWifiSsidBytes; ++i) {
    creds.ssid[i] = static_cast<char>(EEPROM.read(4 + i));
  }
  creds.ssid[kWifiSsidBytes - 1] = '\0';
  for (size_t i = 0; i < kWifiPasswordBytes; ++i) {
    creds.password[i] = static_cast<char>(EEPROM.read(4 + kWifiSsidBytes + i));
  }
  creds.password[kWifiPasswordBytes - 1] = '\0';
  return String(creds.ssid).length() > 0;
}

void saveWifiCredentials(const String& ssid, const String& password) {
  EEPROM.begin(kEepromBytes);
  EEPROM.put(0, kWifiCredsMagic);
  for (size_t i = 0; i < kWifiSsidBytes; ++i) {
    EEPROM.write(4 + i, i < ssid.length() ? ssid.charAt(i) : 0);
  }
  for (size_t i = 0; i < kWifiPasswordBytes; ++i) {
    EEPROM.write(4 + kWifiSsidBytes + i, i < password.length() ? password.charAt(i) : 0);
  }
  EEPROM.commit();
}

void clearWifiCredentials() {
  EEPROM.begin(kEepromBytes);
  for (size_t i = 0; i < kWifiCredsBytes; ++i) {
    EEPROM.write(i, 0);
  }
  EEPROM.commit();
  Serial.println("wifi_credentials_cleared");
}

void clearSdkWifiCredentials() {
  WiFi.persistent(true);
  WiFi.mode(WIFI_STA);
  WiFi.disconnect(true);
  delay(150);
  WiFi.persistent(false);
  Serial.println("wifi_sdk_credentials_cleared");
}

uint8_t readBootRecoveryCounter() {
  EEPROM.begin(kEepromBytes);
  uint32_t magic = 0;
  EEPROM.get(kBootRecoveryOffset, magic);
  if (magic != kBootRecoveryMagic) {
    return 0;
  }
  return EEPROM.read(kBootRecoveryCounterOffset);
}

bool readBootRecoveryUploadActive() {
  EEPROM.begin(kEepromBytes);
  uint32_t magic = 0;
  EEPROM.get(kBootRecoveryOffset, magic);
  if (magic != kBootRecoveryMagic) {
    return false;
  }
  return EEPROM.read(kBootRecoveryUploadOffset) == kBootRecoveryUploadMarker;
}

void writeBootRecoveryState(uint8_t counter, bool uploadActive) {
  EEPROM.begin(kEepromBytes);
  EEPROM.put(kBootRecoveryOffset, kBootRecoveryMagic);
  EEPROM.write(kBootRecoveryCounterOffset, counter);
  EEPROM.write(kBootRecoveryUploadOffset, uploadActive ? kBootRecoveryUploadMarker : 0);
  EEPROM.commit();
}

void writeBootRecoveryCounter(uint8_t counter) {
  writeBootRecoveryState(counter, readBootRecoveryUploadActive());
}

void markBootRecoveryUploadActive(bool active) {
  const bool previous = readBootRecoveryUploadActive();
  if (previous == active) {
    return;
  }
  writeBootRecoveryState(readBootRecoveryCounter(), active);
}

void clearBootRecoveryCounter() {
  EEPROM.begin(kEepromBytes);
  for (size_t i = 0; i < kBootRecoveryBytes; ++i) {
    EEPROM.write(kBootRecoveryOffset + i, 0);
  }
  EEPROM.commit();
  bootRecoveryCounterNeedsClear = false;
  Serial.println("boot_recovery_counter_cleared");
}

uint32_t incrementBootResetCounter() {
  EEPROM.begin(kEepromBytes);
  uint32_t magic = 0;
  uint32_t counter = 0;
  EEPROM.get(kBootDiagnosticsOffset, magic);
  if (magic == kBootDiagnosticsMagic) {
    EEPROM.get(kBootResetCounterOffset, counter);
  }
  if (counter < 0xFFFFFFFFUL) {
    ++counter;
  }
  EEPROM.put(kBootDiagnosticsOffset, kBootDiagnosticsMagic);
  EEPROM.put(kBootResetCounterOffset, counter);
  EEPROM.commit();
  return counter;
}

bool consumeBootRecoveryTrigger() {
  if (readBootRecoveryUploadActive()) {
    clearBootRecoveryCounter();
    return false;
  }

  if (!codexbar_display::esp8266::BootRecoveryPolicy::CountsAsPhysicalReset(
          ESP.getResetInfoPtr()->reason)) {
    clearBootRecoveryCounter();
    return false;
  }

  uint8_t counter = readBootRecoveryCounter();
  if (counter < 255) {
    ++counter;
  }
  writeBootRecoveryCounter(counter);

  if (counter >= kBootRecoveryThreshold) {
    clearWifiCredentials();
    clearSdkWifiCredentials();
    clearBootRecoveryCounter();
    Serial.println("boot_recovery_triggered action=wifi_setup");
    drawWifiResetStatus("Starting setup");
    delay(1000);
    return true;
  }

  bootRecoveryCounterNeedsClear = true;
  bootRecoveryClearAtMs = millis() + kBootRecoveryStableMs;
  return false;
}

bool connectToSavedWifi(const WifiCredentials& creds) {
  Serial.printf("wifi_connect ssid=%s\n", creds.ssid);
  drawWifiConnectingStatus(creds.ssid);
  WiFi.mode(WIFI_STA);
  WiFi.begin(creds.ssid, creds.password);

  const unsigned long startedAt = millis();
  while (WiFi.status() != WL_CONNECTED && (millis() - startedAt) < kWifiConnectTimeoutMs) {
    delay(250);
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() != WL_CONNECTED) {
    Serial.printf("wifi_connect_failed status=%d\n", static_cast<int>(WiFi.status()));
    return false;
  }

  Serial.printf("wifi_connected ssid=%s ip=%s\n", creds.ssid, WiFi.localIP().toString().c_str());
  drawWaitingForCompanionStatus();
  return true;
}

bool connectToSdkWifiConfig() {
  WiFi.mode(WIFI_STA);
  const String ssid = WiFi.SSID();
  if (ssid.length() == 0) {
    Serial.println("wifi_sdk_config_missing");
    return false;
  }

  Serial.printf("wifi_sdk_connect ssid=%s\n", ssid.c_str());
  drawWifiConnectingStatus(ssid);
  WiFi.begin();

  const unsigned long startedAt = millis();
  while (WiFi.status() != WL_CONNECTED && (millis() - startedAt) < kWifiConnectTimeoutMs) {
    delay(250);
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() != WL_CONNECTED) {
    Serial.printf("wifi_sdk_connect_failed status=%d\n", static_cast<int>(WiFi.status()));
    return false;
  }

  const String password = WiFi.psk();
  if (ssid.length() < kWifiSsidBytes && password.length() < kWifiPasswordBytes) {
    saveWifiCredentials(ssid, password);
    Serial.printf("wifi_sdk_credentials_imported ssid=%s\n", ssid.c_str());
  }

  Serial.printf("wifi_connected source=sdk ssid=%s ip=%s\n", ssid.c_str(), WiFi.localIP().toString().c_str());
  drawWaitingForCompanionStatus();
  return true;
}

void scanSetupNetworks() {
  String options;
  int networks = -2;
  WiFi.mode(setupMode ? WIFI_AP_STA : WIFI_STA);
  WiFi.disconnect(false);
  delay(150);

  for (int attempt = 1; attempt <= 2; ++attempt) {
    networks = WiFi.scanNetworks(false, true);
    if (networks > 0) {
      break;
    }
    Serial.printf("wifi_setup_scan_empty attempt=%d networks=%d\n", attempt, networks);
    WiFi.scanDelete();
    delay(250);
    yield();
  }

  uint8_t optionCount = 0;
  for (int i = 0; i < networks; ++i) {
    const String ssid = WiFi.SSID(i);
    if (ssid.length() == 0) {
      continue;
    }
    String option;
    const String escapedSsid = htmlEscape(ssid);
    option.reserve(escapedSsid.length() + 40);
    option += "<option value=\"";
    option += escapedSsid;
    option += "\">";
    option += escapedSsid;
    option += " (";
    option += String(WiFi.RSSI(i));
    option += " dBm)</option>";
    if (options.length() + option.length() > kSetupWifiOptionsMaxBytes) {
      break;
    }
    options += option;
    ++optionCount;
    if (optionCount >= kSetupWifiMaxOptions) {
      break;
    }
  }
  WiFi.scanDelete();
  setupWifiOptionsHTML = options;
  Serial.printf("wifi_setup_scan networks=%d options=%u option_count=%u\n", networks, setupWifiOptionsHTML.length(), optionCount);
}

String setupPageHTML() {
  String html;
  html.reserve(2400);
  html += "<!doctype html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'>";
  html += "<title>VibeTV Setup</title><style>";
  html += "body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;margin:0;background:#101113;color:#f7f7f2}";
  html += "main{max-width:460px;margin:0 auto;padding:32px 20px}label{display:block;margin:18px 0 6px}";
  html += "select,input,button{box-sizing:border-box;width:100%;font:inherit;padding:12px;border-radius:8px;border:1px solid #555;background:#181a1d;color:#fff}";
  html += "button{margin-top:22px;background:#c7ff00;color:#111;border:0;font-weight:700}.muted{color:#aaa;line-height:1.4}";
  html += "</style></head><body><main><h1>VibeTV WiFi</h1>";
  html += "<p class='muted'>Choose your home WiFi and save. Keep your Mac on its normal WiFi. After restart, VibeTV shows the app address for your Mac.</p>";
  html += "<form method='post' action='/save'><label>Choose WiFi</label><select name='ssid'>";
  if (setupWifiOptionsHTML.length() > 0) {
    html += setupWifiOptionsHTML;
  } else {
    html += "<option value=''>No networks found</option>";
  }
  html += "</select><label>Enter SSID manually</label><input name='custom_ssid' maxlength='32' autocomplete='off' placeholder='WiFi name'>";
  html += "<label>Password</label><input name='password' type='password' maxlength='64' autocomplete='current-password'>";
  html += "<button type='submit'>Save</button></form>";
  html += "<p class='muted'>Setup address: http://";
  html += kSetupAddress;
  html += "</p></main></body></html>";
  return html;
}

String connectedPageHTML() {
  const String ip = WiFi.localIP().toString();
  const bool hasFrame = codexbar_display::app::HasFrame(runtimeCtx);

  String html;
  html.reserve(1500);
  html += F("<!doctype html><meta name=viewport content='width=device-width,initial-scale=1'><title>VibeTV</title><style>");
  html += F("body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;margin:24px;background:#0b0c0d;color:#f6f4ed}a{color:#c7ff00;font-weight:800}code,pre{background:#08090a;border:1px solid #30343a;padding:8px;display:block;white-space:pre-wrap;word-break:break-word}button,input{width:100%;font:inherit;margin-top:8px}button{padding:12px;background:#c7ff00;border:0;font-weight:900}section{border-top:1px solid #2b2f35;margin-top:16px;padding-top:12px}</style><h1>Vibe TV</h1>");
  html += F("<p>Connected<br><code>http://");
  html += ip;
  html += F("</code></p>");
  if (firmwareUpdate.available) {
    html += updateStatusHTML(true);
  }
  if (hasFrame) {
    html += F("<p>Live.</p>");
  } else {
    html += F("<section><h2>Next step</h2><p>Open <a href='");
    html += kCustomerAppUrl;
    html += F("'>");
    html += kCustomerAppHost;
    html += F("</a> on your Mac and follow the main button.</p></section>");
  }
  html += F("<p><a href='/health'>Status</a> <a href='/update'>Update</a></p>");
  const String tokenQuery = deviceAuthConfigured() ? String("?token=") + deviceAuthToken : String();
  if (renderer.SupportsBrightnessControl()) {
    html += F("<section><form method='post' action='/api/settings");
    html += tokenQuery;
    html += F("'><label>Bright</label><input name='b' type='range' min='10' max='100' value='");
    html += String(deviceSettings.brightnessPercent);
    html += F("'><button>OK</button></form></section>");
  }
  html += F("<section><h2>Pairing</h2>");
  if (deviceAuthConfigured()) {
    html += F("<p>Token</p><code>");
    html += htmlEscape(deviceAuthToken);
    html += F("</code><p class='muted'>Use this only when support asks for a pairing token.</p>");
    html += F("<form method='post' action='/api/pair'><button>Rotate token</button></form>");
  } else {
    html += F("<p class='muted'>Create a token before exposing theme controls to other devices on your network.</p>");
    html += F("<form method='post' action='/api/pair'><button>Create token</button></form>");
  }
  html += F("</section>");
  html += F("<form method='post' action='/reset-wifi' onsubmit=\"return confirm('Clear WiFi settings and restart setup?')\"><button>Reset WiFi</button></form>");
  return html;
}

void handleRoot() {
  webServer.keepAlive(false);
  if (setupMode) {
    if (setupWifiOptionsHTML.length() == 0) {
      scanSetupNetworks();
    }
    webServer.send(200, "text/html; charset=utf-8", setupPageHTML());
    return;
  }
  webServer.send(200, "text/html; charset=utf-8", connectedPageHTML());
}

void redirectToSetupRoot() {
  webServer.keepAlive(false);
  webServer.sendHeader("Location", String("http://") + kSetupAddress + "/", true);
  webServer.send(302, "text/plain; charset=utf-8", "");
}

void handleCaptivePortalProbe() {
  webServer.keepAlive(false);
  if (setupMode) {
    webServer.send(200, "text/html; charset=utf-8", setupPageHTML());
    return;
  }
  redirectToSetupRoot();
}

void handleSaveWifi() {
  webServer.keepAlive(false);
  String ssid = webServer.arg("custom_ssid");
  ssid.trim();
  if (ssid.length() == 0) {
    ssid = webServer.arg("ssid");
    ssid.trim();
  }
  String password = webServer.arg("password");
  if (ssid.length() == 0) {
    webServer.send(400, "text/plain; charset=utf-8", "SSID fehlt");
    return;
  }
  if (ssid.length() >= kWifiSsidBytes || password.length() >= kWifiPasswordBytes) {
    webServer.send(400, "text/plain; charset=utf-8", "SSID or password is too long");
    return;
  }

  saveWifiCredentials(ssid, password);
  Serial.printf("wifi_credentials_saved ssid=%s\n", ssid.c_str());
  webServer.send(200, "text/html; charset=utf-8", "<!doctype html><p>Saved. Vibe TV is restarting.</p>");
  delay(500);
  ESP.restart();
}

void handleResetWifi() {
  webServer.keepAlive(false);
  if (webServer.method() != HTTP_POST) {
    webServer.send(405, "text/plain; charset=utf-8", "method not allowed");
    return;
  }

  webServer.send(200, "text/html; charset=utf-8", "<!doctype html><p>WiFi settings cleared. Vibe TV is restarting setup.</p>");
  drawWifiResetStatus("Restarting");
  waitStatusRendered = true;
  delay(500);
  clearWifiCredentials();
  clearSdkWifiCredentials();
  clearBootRecoveryCounter();
  delay(250);
  ESP.restart();
}

void addCorsHeaders() {
  webServer.keepAlive(false);
  webServer.sendHeader("Access-Control-Allow-Origin", "*");
  webServer.sendHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  webServer.sendHeader("Access-Control-Allow-Headers", String("Content-Type,") + kDeviceAuthHeader);
}

void handleHello() {
  addCorsHeaders();
  if (requestAuthToken().length() > 0 && !requireWriteAuth()) {
    return;
  }

  String out;
  out.reserve(620);
  out += "{\"kind\":\"hello\",\"protocolVersion\":2,\"board\":\"";
  out += CODEXBAR_DISPLAY_BOARD_ID;
  out += "\",\"deviceId\":\"";
  out += ESP.getChipId();
  out += "\",\"networkMode\":\"";
  out += setupMode ? "setup" : "station";
  out += "\",\"firmware\":\"";
  out += CODEXBAR_DISPLAY_FW_VERSION;
  out += "\",\"maxFrameBytes\":";
  out += String(kMaxFrameBytes);
  out += ",\"capabilities\":{\"display\":{\"brightness\":";
  out += renderer.SupportsBrightnessControl() ? "{\"supported\":true}" : "{\"supported\":false}";
  out += "},\"theme\":";
#ifdef CODEXBAR_DISPLAY_PROBE_ONLY
  out += themeCapabilitiesJSON(false, true);
#else
#if CODEXBAR_DISPLAY_THEME_SPEC_RENDERER
  out += themeCapabilitiesJSON(true, true);
#else
  out += themeCapabilitiesJSON(false, true);
#endif
#endif
  out += ",\"transport\":{\"active\":\"wifi\"}}}";
  webServer.send(200, "application/json", out);
}

bool isSafeAssetPath(const String& path) {
  if (path.length() == 0 || path.length() >= kMaxAssetPathBytes || path.charAt(0) != '/') {
    return false;
  }
  if (path.indexOf("..") >= 0 || path.indexOf("//") >= 0) {
    return false;
  }
  if (path.endsWith("/")) {
    return false;
  }
  for (size_t i = 0; i < path.length(); ++i) {
    const char c = path.charAt(i);
    const bool ok =
        (c >= 'a' && c <= 'z') ||
        (c >= 'A' && c <= 'Z') ||
        (c >= '0' && c <= '9') ||
        c == '/' || c == '-' || c == '_' || c == '.';
    if (!ok) {
      return false;
    }
  }
  return true;
}

bool ensureAssetParentDirs(const String& path) {
  int slash = path.indexOf('/', 1);
  while (slash > 0) {
    const String dir = path.substring(0, slash);
    if (dir.length() > 1 && !LittleFS.exists(dir)) {
      if (!LittleFS.mkdir(dir)) {
        return false;
      }
    }
    slash = path.indexOf('/', slash + 1);
  }
  return true;
}

bool filesystemInfoJSON(String& out) {
  const bool mounted = LittleFS.begin();

  out += "\"filesystem\":{\"mounted\":";
  out += mounted ? "true" : "false";
  out += "}";
  return mounted;
}

String normalizedAssetListPath(const String& dirPath, const String& fileName) {
  if (fileName.startsWith("/")) {
    if (dirPath.length() > 1 && !fileName.startsWith(dirPath + "/")) {
      return dirPath + fileName;
    }
    return fileName;
  }
  if (dirPath.length() > 1) {
    return dirPath + "/" + fileName;
  }
  return "/" + fileName;
}

void appendAssetEntriesJSON(String& out, const String& dirPath, bool& first, String& seen, uint8_t depth) {
  if (depth > 4) {
    return;
  }
  Dir dir = LittleFS.openDir(dirPath);
  while (dir.next()) {
    const String path = normalizedAssetListPath(dirPath, dir.fileName());
    if (dir.isDirectory()) {
      appendAssetEntriesJSON(out, path, first, seen, depth + 1);
      continue;
    }
    const String seenToken = "|" + path + "|";
    if (seen.indexOf(seenToken) >= 0) {
      continue;
    }
    seen += seenToken;
    if (!first) {
      out += ",";
    }
    first = false;
    out += "{\"path\":\"";
    out += jsonEscape(path);
    out += "\",\"sizeBytes\":";
    out += String(dir.fileSize());
    out += "}";
  }
}

void appendAssetListJSON(String& out) {
  out += "\"assets\":[";
  bool first = true;
  if (LittleFS.begin()) {
    String seen;
    appendAssetEntriesJSON(out, "/", first, seen, 0);
    appendAssetEntriesJSON(out, "/themes", first, seen, 0);
    appendAssetEntriesJSON(out, "/themes/u", first, seen, 0);
    appendAssetEntriesJSON(out, "/themes/mini", first, seen, 0);
  }
  out += "]";
}

void handleHealth() {
  const codexbar_display::esp8266::RendererHealthSnapshot snapshot = renderer.HealthSnapshot();

  String out;
  out.reserve(896);
  out += "{\"ok\":true,\"firmware\":\"";
  out += jsonEscape(CODEXBAR_DISPLAY_FW_VERSION);
  out += "\",\"system\":{\"freeHeap\":";
  out += String(ESP.getFreeHeap());
  out += ",\"maxFreeBlock\":";
  out += String(ESP.getMaxFreeBlockSize());
  out += ",\"heapFragmentationPercent\":";
  out += String(ESP.getHeapFragmentation());
  out += ",\"bootId\":\"";
  out += jsonEscape(bootID);
  out += "\",\"uptimeMs\":";
  out += String(millis());
  out += ",\"resetCount\":";
  out += String(bootResetCounter);
  out += ",\"resetReason\":";
  out += bootResetReasonJSON;
  out += "},";
  const bool filesystemMounted = filesystemInfoJSON(out);
  out += ",\"display\":{\"activeTheme\":\"";
  out += jsonEscape(snapshot.activeTheme);
  out += "\",\"themeSpec\":{\"active\":";
  out += snapshot.themeSpecActive ? "true" : "false";
  out += ",\"path\":";
  appendJSONNullableString(out, activeThemeSpecPath);
  out += ",\"hash\":";
  appendJSONNullableString(out, activeThemeSpecHash);
  out += ",\"renderOk\":";
  out += snapshot.themeSpecRenderOk ? "true" : "false";
  out += ",\"renderError\":";
  appendJSONNullableString(out, snapshot.themeSpecRenderError);
  out += ",\"renderFailures\":";
  out += String(snapshot.themeSpecRenderFailures);
  out += ",\"cbaCompletedFrames\":";
  out += String(snapshot.cbaCompletedFrames);
  out += ",\"cbaLastFrameDurationMs\":";
  out += String(snapshot.cbaLastFrameDurationMs);
  out += ",\"cbaBufferBytes\":";
  out += String(snapshot.cbaBufferBytes);
  out += ",\"cbaBufferAllocationFailures\":";
  out += String(snapshot.cbaBufferAllocationFailures);
  out += ",\"cbaLastPushDurationUs\":";
  out += String(snapshot.cbaLastPushDurationUs);
  out += "},\"gif\":{\"activePath\":\"";
  out += jsonEscape(snapshot.gifActivePath);
  out += "\",\"filePresent\":";
  out += snapshot.gifFilePresent ? "true" : "false";
  out += ",\"decoderAllocated\":";
  out += snapshot.gifDecoderAllocated ? "true" : "false";
  out += ",\"decoderOpen\":";
  out += snapshot.gifDecoderOpen ? "true" : "false";
  out += ",\"lastError\":";
  appendJSONNullableString(out, snapshot.gifLastErrorStage);
  out += "}},\"render\":{\"fullCount\":";
  out += String(renderDiagnostics.fullCount);
  out += ",\"partialCount\":";
  out += String(renderDiagnostics.partialCount);
  out += ",\"lastKind\":\"";
  out += jsonEscape(renderDiagnostics.lastKind);
  out += "\"},";
  appendSettingsJSON(out);
  out += "}";

  (void)filesystemMounted;
  addCorsHeaders();
  webServer.send(200, "application/json", out);
}

bool persistDeviceSettings(const DeviceSettings& next) {
  const DeviceSettings previous = deviceSettings;
  deviceSettings = next;
  if (!saveDeviceSettings()) {
    deviceSettings = previous;
    applyDeviceSettings();
    return false;
  }
  applyDeviceSettings();
  return true;
}

void handleSettingsAPI() {
  addCorsHeaders();
  if (!requireWriteAuth()) {
    return;
  }
  DeviceSettings next = deviceSettings;
  const bool apiResponse = webServer.hasArg("api");
  if (webServer.hasArg("b")) {
    next.brightnessPercent = clampBrightnessPercent(webServer.arg("b").toInt());
  } else {
    webServer.send(400, "text/plain; charset=utf-8", "bad");
    return;
  }
  if (!persistDeviceSettings(next)) {
    webServer.send(500, "text/plain; charset=utf-8", "save failed");
    return;
  }
  if (!apiResponse && webServer.hasArg("b")) {
    webServer.sendHeader("Location", "/");
    webServer.send(303);
    return;
  }
  String out;
  out.reserve(80);
  out += "{\"ok\":true,";
  appendSettingsJSON(out);
  out += "}";
  webServer.send(200, "application/json", out);
}

void handlePairingAPI() {
  addCorsHeaders();
  const String token = generateAuthToken();
  if (!saveDeviceAuthToken(token)) {
    webServer.send(500, "text/plain; charset=utf-8", "pairing token save failed");
    return;
  }
  if (webServer.hasArg("api")) {
    String out;
    out.reserve(100);
    out += "{\"ok\":true,\"token\":\"";
    out += jsonEscape(token);
    out += "\"}";
    webServer.send(200, "application/json", out);
    return;
  }
  webServer.sendHeader("Location", "/");
  webServer.send(303);
}

void handleAssetsList() {
  String out;
  out.reserve(1200);
  out += "{";
  (void)filesystemInfoJSON(out);
  out += ",";
  appendAssetListJSON(out);
  out += "}";
  addCorsHeaders();
  webServer.send(200, "application/json", out);
}

void setAssetUploadError(const String& message) {
  if (assetUploadFile) {
    assetUploadFile.close();
  }
  if (assetUploadError.length() > 0) {
    return;
  }
  assetUploadError = message;
  Serial.printf("asset_upload_error path=%s message=%s\n", assetUploadPath.c_str(), assetUploadError.c_str());
}

void finishAssetUploadRequest() {
  if (assetUploadFile) {
    assetUploadFile.close();
  }
  markBootRecoveryUploadActive(false);
  assetUploadInProgress = false;
}

bool assetPathLooksGif(const String& path);

void discardPartialAssetUpload() {
  if (!LittleFS.begin() || !LittleFS.exists(kAssetUploadTemporaryPath)) {
    return;
  }
  if (LittleFS.remove(kAssetUploadTemporaryPath)) {
    Serial.printf("asset_upload_discarded path=%s\n", assetUploadPath.c_str());
  }
}

bool validateCompletedAssetUpload() {
  if (!assetPathLooksGif(assetUploadPath)) {
    return true;
  }
  codexbar_display::esp8266::GifValidationInfo info;
  const codexbar_display::esp8266::GifValidationError error =
      codexbar_display::esp8266::ValidateGifAssetFile(
          kAssetUploadTemporaryPath,
          codexbar_display::esp8266::kMaxThemeGifLzwBits,
          &info);
  if (error == codexbar_display::esp8266::GifValidationError::None) {
    return true;
  }
  setAssetUploadError(
      error == codexbar_display::esp8266::GifValidationError::LzwCodeSizeExceeded
          ? "gif requires unsupported LZW width"
          : "invalid gif");
  return false;
}

bool promoteCompletedAssetUpload() {
  // LittleFS rename is atomic and replaces an existing destination only after
  // the temporary file has been fully written and, for GIFs, validated.
  if (!LittleFS.rename(kAssetUploadTemporaryPath, assetUploadPath)) {
    setAssetUploadError("commit asset failed");
    return false;
  }
  return true;
}

String requestedAssetPath() {
  String path = webServer.arg("path");
  path.trim();
  if (path.length() == 0) {
    path = webServer.upload().filename;
    path.trim();
    const int lastSlash = path.lastIndexOf('/');
    if (lastSlash >= 0) {
      path = path.substring(lastSlash + 1);
    }
    const int lastBackslash = path.lastIndexOf('\\');
    if (lastBackslash >= 0) {
      path = path.substring(lastBackslash + 1);
    }
    if (path.length() > 0 && !path.startsWith("/")) {
      path = "/" + path;
    }
  }
  return path;
}

bool assetPathLooksGif(const String& path) {
  String lower = path;
  lower.toLowerCase();
  return lower.endsWith(".gif");
}

bool assetUploadContentLengthWouldExceedLimits(const HTTPUpload& upload) {
  if (!assetPathLooksGif(assetUploadPath)) {
    return false;
  }
  return upload.contentLength > 0 && upload.contentLength > kMaxThemeGifAssetBytes;
}

bool assetUploadBytesWouldExceedLimits(size_t nextChunkSize) {
  if (!assetPathLooksGif(assetUploadPath)) {
    return false;
  }
  return assetUploadBytesSeen + nextChunkSize > kMaxThemeGifAssetBytes;
}

void enterAssetUploadSafeMode() {
  firmwareUpdateNoticeDirty = false;
  frameStaleStatusRendered = false;
  renderer.ResetGifStateForAssetUpdate();
  close_all_fs();
  WiFiUDP::stopAll();
  WiFi.setSleepMode(WIFI_NONE_SLEEP);
  ESP.wdtFeed();
}

void handleAssetUpload() {
  HTTPUpload& upload = webServer.upload();

  if (upload.status == UPLOAD_FILE_START) {
    assetUploadSucceeded = false;
    assetUploadInProgress = true;
    assetUploadError = "";
    assetUploadPath = requestedAssetPath();
    assetUploadBytesSeen = 0;
    Serial.printf("asset_upload_start path=%s filename=%s content_length=%zu\n", assetUploadPath.c_str(), upload.filename.c_str(), upload.contentLength);

    if (!requestHasValidAuth()) {
      setAssetUploadError("unauthorized");
      return;
    }
    if (!isSafeAssetPath(assetUploadPath)) {
      setAssetUploadError("invalid asset path");
      return;
    }
    if (assetUploadPath == kAssetUploadTemporaryPath) {
      setAssetUploadError("reserved asset path");
      return;
    }
    if (assetUploadContentLengthWouldExceedLimits(upload)) {
      setAssetUploadError("gif asset too large");
      return;
    }
    markBootRecoveryUploadActive(true);
    enterAssetUploadSafeMode();
    if (!LittleFS.begin()) {
      setAssetUploadError("filesystem mount failed");
      return;
    }
    if (!ensureAssetParentDirs(assetUploadPath)) {
      setAssetUploadError("create parent directory failed");
      return;
    }
    if (LittleFS.exists(kAssetUploadTemporaryPath) && !LittleFS.remove(kAssetUploadTemporaryPath)) {
      setAssetUploadError("remove stale upload failed");
      return;
    }
    assetUploadFile = LittleFS.open(kAssetUploadTemporaryPath, "w");
    if (!assetUploadFile) {
      setAssetUploadError("open asset failed");
      return;
    }
  } else if (upload.status == UPLOAD_FILE_WRITE) {
    if (assetUploadError.length() > 0) {
      return;
    }
    if (assetUploadBytesWouldExceedLimits(upload.currentSize)) {
      setAssetUploadError("gif asset too large");
      yield();
      return;
    }
    if (!assetUploadFile) {
      setAssetUploadError("append asset failed");
      return;
    }
    if (assetUploadFile.write(upload.buf, upload.currentSize) != upload.currentSize) {
      setAssetUploadError("write asset failed");
    }
    assetUploadBytesSeen += upload.currentSize;
    ESP.wdtFeed();
  } else if (upload.status == UPLOAD_FILE_END) {
    if (assetUploadFile) {
      assetUploadFile.flush();
      assetUploadFile.close();
    }
    if (assetUploadError.length() == 0 &&
        validateCompletedAssetUpload() &&
        promoteCompletedAssetUpload()) {
      assetUploadSucceeded = true;
      Serial.printf("asset_upload_success path=%s bytes=%zu\n", assetUploadPath.c_str(), upload.totalSize);
    }
  } else if (upload.status == UPLOAD_FILE_ABORTED) {
    setAssetUploadError("upload aborted");
    finishAssetUploadRequest();
  }
  yield();
}

void handleAssetUploadResult() {
  if (assetUploadError == "unauthorized") {
    finishAssetUploadRequest();
    addCorsHeaders();
    webServer.sendHeader("WWW-Authenticate", "VibeTV token");
    webServer.send(401, "text/plain; charset=utf-8", "pairing token required");
    return;
  }
  if (!assetUploadSucceeded || assetUploadError.length() > 0) {
    const String error = assetUploadError.length() > 0 ? assetUploadError : "upload failed";
    discardPartialAssetUpload();
    finishAssetUploadRequest();
    addCorsHeaders();
    webServer.send(400, "text/plain; charset=utf-8", error);
    return;
  }

  String out;
  out.reserve(120);
  out += "{\"ok\":true,\"path\":\"";
  out += jsonEscape(assetUploadPath);
  out += "\"}";
  finishAssetUploadRequest();
  addCorsHeaders();
  webServer.send(200, "application/json", out);
}

void handleAssetDelete() {
  if (!requireWriteAuth()) {
    return;
  }
  String path = webServer.arg("path");
  path.trim();
  if (!isSafeAssetPath(path)) {
    addCorsHeaders();
    webServer.send(400, "text/plain; charset=utf-8", "invalid asset path");
    return;
  }
  if (!LittleFS.begin()) {
    addCorsHeaders();
    webServer.send(500, "text/plain; charset=utf-8", "filesystem mount failed");
    return;
  }
  if (!LittleFS.exists(path)) {
    addCorsHeaders();
    webServer.send(404, "text/plain; charset=utf-8", "asset not found");
    return;
  }
  if (path == activeThemeSpecPath) {
    addCorsHeaders();
    webServer.send(409, "text/plain; charset=utf-8", "asset is active");
    return;
  }
  renderer.ResetGifStateForAssetUpdate();
  if (!LittleFS.remove(path)) {
    addCorsHeaders();
    webServer.send(500, "text/plain; charset=utf-8", "asset delete failed");
    return;
  }
  Serial.printf("asset_deleted path=%s\n", path.c_str());
  addCorsHeaders();
  webServer.send(200, "application/json", "{\"ok\":true}");
}

#if CODEXBAR_DISPLAY_THEME_SPEC_RENDERER
bool readActiveThemeSpecPath(String& path) {
  path = "";
  if (!LittleFS.begin() || !LittleFS.exists(kActiveThemeSpecPathFile)) {
    return false;
  }
  File file = LittleFS.open(kActiveThemeSpecPathFile, "r");
  if (!file) {
    return false;
  }
  path = file.readString();
  file.close();
  path.trim();
  return isSafeAssetPath(path) && path.startsWith("/themes/");
}

bool saveActiveThemeSpecPath(const String& path) {
  if (!isSafeAssetPath(path) || !path.startsWith("/themes/")) {
    return false;
  }
  if (!LittleFS.begin()) {
    return false;
  }
  File file = LittleFS.open(kActiveThemeSpecPathFile, "w");
  if (!file) {
    return false;
  }
  const size_t written = file.print(path);
  file.close();
  return written == path.length();
}

bool readStoredThemeSpec(const String& path, String& raw, String& error) {
  if (!isSafeAssetPath(path) || !path.startsWith("/themes/")) {
    error = "invalid theme path";
    return false;
  }
  if (!LittleFS.begin()) {
    error = "filesystem mount failed";
    return false;
  }
  if (!LittleFS.exists(path)) {
    error = "theme file not found";
    return false;
  }

  File file = LittleFS.open(path, "r");
  if (!file) {
    error = "open theme file failed";
    return false;
  }
  const size_t size = file.size();
  if (size == 0 || size > kMaxStoredThemeSpecBytes) {
    file.close();
    error = "theme file too large";
    return false;
  }
  raw = file.readString();
  file.close();
  raw.trim();
  if (raw.length() == 0 || raw.length() > kMaxStoredThemeSpecBytes) {
    error = "theme file too large";
    return false;
  }
  return true;
}

bool themeSpecMetadata(const String& raw, String& themeId, int& themeRev, String& fallbackTheme, String& error) {
  JsonDocument filter;
  filter["themeId"] = true;
  filter["id"] = true;
  filter["themeRev"] = true;
  filter["rev"] = true;
  filter["fallbackTheme"] = true;
  filter["fb"] = true;

  JsonDocument doc;
  const DeserializationError err = deserializeJson(doc, raw, DeserializationOption::Filter(filter));
  if (err) {
    error = String("bad theme json: ") + err.c_str();
    return false;
  }
  JsonObjectConst spec = doc.as<JsonObjectConst>();
  if (spec.isNull()) {
    error = "theme json must be an object";
    return false;
  }

  const char* id = nullptr;
  if (spec["themeId"].is<const char*>()) {
    id = spec["themeId"].as<const char*>();
  } else if (spec["id"].is<const char*>()) {
    id = spec["id"].as<const char*>();
  }
  if (id != nullptr) {
    themeId = String(id);
    themeId.trim();
  }
  themeRev = static_cast<int>(spec["themeRev"] | spec["rev"] | 0);
  if (themeId.length() == 0 || themeRev <= 0) {
    error = "theme id/rev missing";
    return false;
  }

  const char* fallback = nullptr;
  if (spec["fallbackTheme"].is<const char*>()) {
    fallback = spec["fallbackTheme"].as<const char*>();
  } else if (spec["fb"].is<const char*>()) {
    fallback = spec["fb"].as<const char*>();
  }
  if (fallback != nullptr) {
    String normalized;
    if (codexbar_display::theme::NormalizeThemeName(String(fallback), normalized)) {
      fallbackTheme = normalized;
    }
  }
  return true;
}

void activateStoredThemeSpec(const String& path, const String& raw, const String& themeId, int themeRev, const String& fallbackTheme) {
  renderer.ResetGifStateForAssetUpdate();
  close_all_fs();

  const bool hadFrame = codexbar_display::app::HasFrame(runtimeCtx);
  const codexbar_display::core::Frame previous = runtimeCtx.runtime.current;
  codexbar_display::core::Frame next = hadFrame ? previous : codexbar_display::core::Frame{};

  next.hasError = false;
  next.error = "";
  next.clearThemeSpec = false;
  next.hasThemeSpec = true;
  next.themeSpecId = themeId;
  next.themeSpecRev = themeRev;
  next.themeSpecRaw = "";
  if (fallbackTheme.length() > 0) {
    next.hasTheme = true;
    next.theme = fallbackTheme;
  }

  runtimeCtx.runtime.cachedThemeId = themeId;
  runtimeCtx.runtime.cachedThemeRev = themeRev;
  runtimeCtx.runtime.cachedThemeSpecRaw = raw;
  runtimeCtx.runtime.current = next;
  runtimeCtx.runtime.hasFrame = true;
  runtimeCtx.runtime.resetBaseSecs = next.resetSecs;
  runtimeCtx.runtime.resetBaseMillis = millis();
  activeThemeSpecPath = path;
  activeThemeSpecHash = hashHex8(raw);

  codexbar_display::core::SerialConsumeEvent event;
  event.frameAccepted = true;
  event.hadFrame = hadFrame;
  event.themeSpecChanged = true;
  event.visualChanged = !hadFrame || codexbar_display::core::FrameVisualChanged(previous, next) || event.themeSpecChanged;
  event.themeChanged = hadFrame && codexbar_display::core::FrameThemeChanged(previous, next);
  markFrameAccepted(event, "theme");
}

bool activateStoredThemePath(const String& path, String& themeId, int& themeRev, String& error) {
  String raw;
  if (!readStoredThemeSpec(path, raw, error)) {
    return false;
  }

  String fallbackTheme;
  if (!themeSpecMetadata(raw, themeId, themeRev, fallbackTheme, error)) {
    return false;
  }
  if (!saveActiveThemeSpecPath(path)) {
    error = "save active theme failed";
    return false;
  }

  activateStoredThemeSpec(path, raw, themeId, themeRev, fallbackTheme);
  return true;
}

#endif

void handleThemeActive() {
#if CODEXBAR_DISPLAY_THEME_SPEC_RENDERER
  if (!requireWriteAuth()) {
    return;
  }
  const bool formMode = webServer.hasArg("path");
  String path = webServer.arg("path");
  if (!formMode) {
    String body = webServer.arg("plain");
    body.trim();
    if (body.length() == 0 || body.length() > 160) {
      addCorsHeaders();
      webServer.send(400, "text/plain; charset=utf-8", "invalid theme activation body");
      return;
    }

    JsonDocument doc;
    const DeserializationError err = deserializeJson(doc, body);
    if (err) {
      addCorsHeaders();
      webServer.send(400, "text/plain; charset=utf-8", "bad theme activation json");
      return;
    }
    path = String(doc["path"] | "");
  }
  path.trim();

  String themeId;
  int themeRev = 0;
  String error;
  if (!activateStoredThemePath(path, themeId, themeRev, error)) {
    addCorsHeaders();
    webServer.send(error == "theme file not found" ? 404 : 400, "text/plain; charset=utf-8", error);
    return;
  }

  if (formMode) {
    webServer.keepAlive(false);
    webServer.sendHeader("Location", "/");
    webServer.send(303);
    return;
  }

  String out;
  out.reserve(160);
  out += "{\"ok\":true,\"path\":\"";
  out += jsonEscape(path);
  out += "\",\"id\":\"";
  out += jsonEscape(themeId);
  out += "\",\"rev\":";
  out += String(themeRev);
  out += ",\"hash\":\"";
  out += jsonEscape(activeThemeSpecHash);
  out += "\"";
  out += "}";
  addCorsHeaders();
  webServer.send(200, "application/json", out);
#else
  addCorsHeaders();
  webServer.send(501, "text/plain; charset=utf-8", "theme spec renderer disabled");
#endif
}

#if CODEXBAR_DISPLAY_THEME_SPEC_RENDERER
bool loadStoredThemeSpecCacheFromPath(const String& path) {
  String error;
  String raw;
  if (!readStoredThemeSpec(path, raw, error)) {
    Serial.printf("theme_cache_load_failed path=%s err=%s\n", path.c_str(), error.c_str());
    return false;
  }

  String themeId;
  int themeRev = 0;
  String fallbackTheme;
  if (!themeSpecMetadata(raw, themeId, themeRev, fallbackTheme, error)) {
    Serial.printf("theme_cache_load_failed path=%s err=%s\n", path.c_str(), error.c_str());
    return false;
  }

  runtimeCtx.runtime.cachedThemeId = themeId;
  runtimeCtx.runtime.cachedThemeRev = themeRev;
  runtimeCtx.runtime.cachedThemeSpecRaw = raw;
  activeThemeSpecPath = path;
  activeThemeSpecHash = hashHex8(raw);
  Serial.printf("theme_cache_loaded path=%s id=%s rev=%d\n", path.c_str(), themeId.c_str(), themeRev);
  return true;
}

void loadDefaultStoredThemeSpecCache() {
  String activePath;
  if (readActiveThemeSpecPath(activePath) && loadStoredThemeSpecCacheFromPath(activePath)) {
    return;
  }
  if (loadStoredThemeSpecCacheFromPath(kDefaultThemeSpecPath)) {
    runtimeCtx.runtime.cachedThemeId = kDefaultThemeSpecId;
    runtimeCtx.runtime.cachedThemeRev = kDefaultThemeSpecRev;
  }
}
#endif

String updatePageHTML() {
  const String installCommand = updateInstallCommand();
  const String tokenQuery = deviceAuthConfigured() ? String("?token=") + deviceAuthToken : String();
  String html;
  html.reserve(1600);
  html += F("<!doctype html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'>");
  html += F("<title>VibeTV Update</title><style>");
  html += F(":root{color-scheme:dark}body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;margin:0;background:#0b0c0d;color:#f6f4ed}main{max-width:620px;margin:auto;padding:24px 18px}a,summary{color:#c7ff00;font-weight:800}h1{margin:16px 0}.muted{color:#a9adb3}.update,input,button,pre{border-radius:8px}.update{border:1px solid #6f8f00;padding:10px}.update-link{display:none}input,button{width:100%;font:inherit;padding:12px;margin-top:10px}button{background:#c7ff00;color:#111;border:0;font-weight:900}pre{white-space:pre-wrap;word-break:break-word;background:#08090a;border:1px solid #30343a;padding:12px}</style></head><body><main>");
  html += F("<h1>VibeTV Update</h1>");
  html += updateStatusHTML(false);
  html += F("<h2>Check with Mac</h2><p class='muted'>Copy this command into Terminal. It refreshes the Mac helper first, then installs firmware if needed.</p><pre id='cmd'>");
  html += htmlEscape(installCommand);
  html += F("</pre><textarea id='cmdFallback' readonly style='position:absolute;left:-9999px'></textarea><button type='button' onclick='copyCmd()' id='copyBtn'>Copy update command</button><details><summary>Manual upload</summary>");
  html += F("<form method='post' action='/update/firmware");
  html += tokenQuery;
  html += F("' enctype='multipart/form-data'>");
  html += F("<input type='file' name='firmware' accept='.bin,application/octet-stream' required>");
  html += F("<button type='submit'>Upload firmware</button></form>");
  html += F("</details>");
  html += F("<p class='muted'><a href='/'>Setup</a> | <a href='/health'>Status</a> | <a href='/assets'>Files</a></p>");
  html += F("<script>function copied(){document.getElementById('copyBtn').textContent='Copied';}function fallbackCopy(t){var a=document.getElementById('cmdFallback');a.value=t;a.focus();a.select();try{document.execCommand('copy');copied();}catch(e){window.prompt('Copy this command',t);}}function copyCmd(){var t=document.getElementById('cmd').textContent.trim();if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(t).then(copied,function(){fallbackCopy(t);});}else{fallbackCopy(t);}}</script></main></body></html>");
  return html;
}

void handleUpdatePage() {
  webServer.keepAlive(false);
  webServer.send(200, "text/html; charset=utf-8", updatePageHTML());
}

void setOtaError(const String& message) {
  otaUploadError = message;
  otaDiagnostics.status = "failed";
  otaDiagnostics.lastError = message;
  otaDiagnostics.updateError = Update.getError();
  otaDiagnostics.endedAtMs = millis();
  Serial.printf("ota_error message=%s\n", otaUploadError.c_str());
  if (Update.hasError()) {
    Update.printError(Serial);
  }
}

size_t otaMaxSizeForCommand(int command) {
  if (command == U_FS) {
    return static_cast<size_t>(FS_end - FS_start);
  }
  return static_cast<size_t>((ESP.getFreeSketchSpace() - 0x1000) & 0xFFFFF000);
}

void enterOtaSafeMode(int command) {
  (void)command;
  firmwareUpdateNoticeDirty = false;
  frameStaleStatusRendered = false;
  renderer.ResetGifStateForAssetUpdate();
  close_all_fs();
  WiFiUDP::stopAll();
  WiFi.setSleepMode(WIFI_NONE_SLEEP);
  ESP.wdtFeed();
}

void handleOtaUpload(int command, const char* target) {
  HTTPUpload& upload = webServer.upload();

  if (upload.status == UPLOAD_FILE_START) {
    otaUploadSucceeded = false;
    otaUploadInProgress = true;
    otaUploadError = "";
    const size_t maxSize = otaMaxSizeForCommand(command);
    otaDiagnostics.target = target;
    otaDiagnostics.status = "starting";
    otaDiagnostics.filename = upload.filename;
    otaDiagnostics.lastError = "";
    otaDiagnostics.command = command;
    otaDiagnostics.contentLength = upload.contentLength;
    otaDiagnostics.totalSize = 0;
    otaDiagnostics.maxSize = maxSize;
    otaDiagnostics.freeSketchSpace = ESP.getFreeSketchSpace();
    otaDiagnostics.updateError = UPDATE_ERROR_OK;
    otaDiagnostics.startedAtMs = millis();
    otaDiagnostics.endedAtMs = 0;
    Serial.printf(
        "ota_upload_start target=%s filename=%s content_length=%zu max_size=%zu free_sketch_space=%zu\n",
        target,
        upload.filename.c_str(),
        upload.contentLength,
        maxSize,
        otaDiagnostics.freeSketchSpace);
    const String targetLabel = command == U_FS ? "Loading display" : "Loading firmware";
    drawUpdateStatus(targetLabel);
    waitStatusRendered = true;
    if (!requestHasValidAuth()) {
      setOtaError("unauthorized");
      return;
    }
    markBootRecoveryUploadActive(true);
    enterOtaSafeMode(command);
    if (!Update.begin(maxSize, command)) {
      setOtaError(Update.getErrorString());
    } else {
      otaDiagnostics.status = "writing";
    }
  } else if (upload.status == UPLOAD_FILE_WRITE) {
    otaDiagnostics.totalSize = upload.totalSize + upload.currentSize;
    if (otaUploadError.length() == 0 && Update.write(upload.buf, upload.currentSize) != upload.currentSize) {
      setOtaError(Update.getErrorString());
    }
    ESP.wdtFeed();
  } else if (upload.status == UPLOAD_FILE_END) {
    otaDiagnostics.totalSize = upload.totalSize;
    if (otaUploadError.length() == 0 && Update.end(true)) {
      otaUploadSucceeded = true;
      otaDiagnostics.status = "succeeded";
      otaDiagnostics.updateError = UPDATE_ERROR_OK;
      otaDiagnostics.endedAtMs = millis();
      otaDiagnostics.successCount++;
      Serial.printf("ota_upload_success target=%s bytes=%zu\n", target, upload.totalSize);
    } else if (otaUploadError.length() == 0) {
      setOtaError(Update.getErrorString());
    }
  } else if (upload.status == UPLOAD_FILE_ABORTED) {
    Update.end();
    setOtaError("upload aborted");
    otaDiagnostics.totalSize = upload.totalSize;
    Serial.printf("ota_upload_aborted target=%s bytes=%zu\n", target, upload.totalSize);
  }
  yield();
}

void scheduleReboot(const char* reason) {
  rebootPending = true;
  rebootAtMs = millis() + kRebootDelayMs;
  Serial.printf("reboot_scheduled reason=%s delay_ms=%lu\n", reason, kRebootDelayMs);
}

void handleOtaResult(const char* target) {
  webServer.keepAlive(false);
  if (otaUploadError == "unauthorized") {
    otaUploadInProgress = false;
    markBootRecoveryUploadActive(false);
    otaDiagnostics.status = "failed";
    otaDiagnostics.lastError = otaUploadError;
    otaDiagnostics.updateError = Update.getError();
    otaDiagnostics.endedAtMs = millis();
    otaDiagnostics.failureCount++;
    addCorsHeaders();
    webServer.sendHeader("WWW-Authenticate", "VibeTV token");
    webServer.send(401, "text/plain; charset=utf-8", "pairing token required");
    return;
  }
  if (!otaUploadSucceeded || otaUploadError.length() > 0 || Update.hasError()) {
    otaUploadInProgress = false;
    markBootRecoveryUploadActive(false);
    const String error = otaUploadError.length() > 0 ? otaUploadError : Update.getErrorString();
    otaDiagnostics.status = "failed";
    otaDiagnostics.lastError = error;
    otaDiagnostics.updateError = Update.getError();
    otaDiagnostics.endedAtMs = millis();
    otaDiagnostics.failureCount++;
    Serial.printf("ota_upload_failed target=%s error=%s\n", target, error.c_str());
    webServer.send(500, "text/plain; charset=utf-8", "Update failed: " + error);
    return;
  }

  String html;
  html.reserve(500);
  html += "<!doctype html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'>";
  html += "<title>VibeTV Update</title></head><body style='font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;margin:32px'>";
  html += "<h1>Update successful</h1><p>";
  html += target;
  html += " was written. Vibe TV is restarting.</p></body></html>";
  webServer.send(200, "text/html; charset=utf-8", html);
  drawUpdateStatus("Restarting");
  waitStatusRendered = true;
  otaDiagnostics.status = "reboot_scheduled";
  scheduleReboot(target);
  otaUploadInProgress = false;
}

void sendRawOtaResponse(WiFiClient& client, int status, const char* statusText, const String& body) {
  client.print("HTTP/1.1 ");
  client.print(status);
  client.print(" ");
  client.print(statusText);
  client.print("\r\nConnection: close\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ");
  client.print(body.length());
  client.print("\r\n\r\n");
  client.print(body);
}

bool rawRequestLineIsFirmwarePost(const String& line) {
  return line.startsWith("POST /update/firmware.raw ") ||
         line.startsWith("POST /update/firmware.raw?") ||
         line.startsWith("PUT /update/firmware.raw ") ||
         line.startsWith("PUT /update/firmware.raw?");
}

String rawRequestToken(const String& line) {
  const int queryStart = line.indexOf("?token=");
  if (queryStart < 0) {
    return "";
  }
  int tokenStart = queryStart + 7;
  int tokenEnd = line.indexOf(' ', tokenStart);
  const int nextParam = line.indexOf('&', tokenStart);
  if (nextParam >= 0 && (tokenEnd < 0 || nextParam < tokenEnd)) {
    tokenEnd = nextParam;
  }
  if (tokenEnd < 0) {
    tokenEnd = line.length();
  }
  String token = line.substring(tokenStart, tokenEnd);
  token.trim();
  return token;
}

void handleRawOtaClient() {
  if (!rawOtaServerStarted || otaUploadInProgress || rebootPending) {
    return;
  }

  WiFiClient client = rawOtaServer.accept();
  if (!client) {
    return;
  }
  client.setTimeout(5000);

  String requestLine = client.readStringUntil('\n');
  requestLine.trim();
  if (!rawRequestLineIsFirmwarePost(requestLine)) {
    sendRawOtaResponse(client, 404, "Not Found", "not found");
    client.stop();
    return;
  }

  String rawToken = rawRequestToken(requestLine);
  size_t contentLength = 0;
  while (client.connected()) {
    String header = client.readStringUntil('\n');
    header.trim();
    if (header.length() == 0) {
      break;
    }
    String lower = header;
    lower.toLowerCase();
    if (lower.startsWith("content-length:")) {
      String value = header.substring(header.indexOf(':') + 1);
      value.trim();
      contentLength = static_cast<size_t>(value.toInt());
    } else if (lower.startsWith("x-vibetv-token:")) {
      rawToken = header.substring(header.indexOf(':') + 1);
      rawToken.trim();
    }
  }

  if (deviceAuthConfigured() && rawToken != deviceAuthToken) {
    sendRawOtaResponse(client, 401, "Unauthorized", "pairing token required");
    client.stop();
    return;
  }

  if (contentLength == 0) {
    sendRawOtaResponse(client, 411, "Length Required", "content-length required");
    client.stop();
    return;
  }

  otaUploadSucceeded = false;
  otaUploadInProgress = true;
  otaUploadError = "";
  const size_t maxSize = otaMaxSizeForCommand(U_FLASH);
  otaDiagnostics.target = "firmware_raw";
  otaDiagnostics.status = "starting";
  otaDiagnostics.filename = "raw";
  otaDiagnostics.lastError = "";
  otaDiagnostics.command = U_FLASH;
  otaDiagnostics.contentLength = contentLength;
  otaDiagnostics.totalSize = 0;
  otaDiagnostics.maxSize = maxSize;
  otaDiagnostics.freeSketchSpace = ESP.getFreeSketchSpace();
  otaDiagnostics.updateError = UPDATE_ERROR_OK;
  otaDiagnostics.startedAtMs = millis();
  otaDiagnostics.endedAtMs = 0;

  drawUpdateStatus("Loading firmware");
  waitStatusRendered = true;
  markBootRecoveryUploadActive(true);
  enterOtaSafeMode(U_FLASH);

  if (!Update.begin(maxSize, U_FLASH)) {
    setOtaError(Update.getErrorString());
  } else {
    otaDiagnostics.status = "writing";
  }

  uint8_t buffer[1024];
  size_t remaining = contentLength;
  unsigned long lastProgressMs = millis();
  while (remaining > 0 && otaUploadError.length() == 0) {
    const size_t want = remaining < sizeof(buffer) ? remaining : sizeof(buffer);
    const size_t got = client.readBytes(buffer, want);
    if (got == 0) {
      if (millis() - lastProgressMs > 10000UL) {
        setOtaError("raw upload timeout");
        break;
      }
      delay(1);
      continue;
    }
    lastProgressMs = millis();
    remaining -= got;
    otaDiagnostics.totalSize += got;
    if (Update.write(buffer, got) != got) {
      setOtaError(Update.getErrorString());
      break;
    }
    ESP.wdtFeed();
    delay(0);
  }

  if (otaUploadError.length() == 0 && Update.end(true)) {
    otaUploadSucceeded = true;
    otaDiagnostics.status = "succeeded";
    otaDiagnostics.updateError = UPDATE_ERROR_OK;
    otaDiagnostics.endedAtMs = millis();
    otaDiagnostics.successCount++;
    sendRawOtaResponse(client, 200, "OK", "ok");
    drawUpdateStatus("Restarting");
    waitStatusRendered = true;
    otaDiagnostics.status = "reboot_scheduled";
    scheduleReboot("firmware_raw");
  } else {
    markBootRecoveryUploadActive(false);
    if (otaUploadError.length() == 0) {
      setOtaError(Update.getErrorString());
    }
    otaDiagnostics.failureCount++;
    sendRawOtaResponse(client, 500, "Internal Server Error", "Update failed: " + otaUploadError);
  }
  otaUploadInProgress = false;
  client.stop();
}

void handleFrame() {
  if (!requireWriteAuth()) {
    return;
  }
  String rawBody = webServer.arg("plain");
  if (rawBody.length() == 0) {
    addCorsHeaders();
    webServer.send(400, "text/plain; charset=utf-8", "empty frame body");
    return;
  }
  if (rawBody.length() > kMaxFrameBytes) {
    addCorsHeaders();
    webServer.send(413, "text/plain; charset=utf-8", "frame body too large");
    return;
  }
  String body = rawBody;
  body.trim();
  if (body.length() == 0) {
    addCorsHeaders();
    webServer.send(400, "text/plain; charset=utf-8", "empty frame body");
    return;
  }
  if (body.indexOf('\n') >= 0 || body.indexOf('\r') >= 0) {
    addCorsHeaders();
    webServer.send(400, "text/plain; charset=utf-8", "expected one newline-delimited JSON frame");
    return;
  }

  codexbar_display::core::SerialConsumeEvent event;
  if (!codexbar_display::core::ConsumeFrameLine(runtimeCtx.runtime, body.c_str(), millis(), true, event) ||
      !event.frameAccepted) {
    addCorsHeaders();
    webServer.send(400, "text/plain; charset=utf-8", "frame was not accepted");
    return;
  }

  // Acknowledge before display work so a slow render cannot make the host retry
  // an already accepted frame.
  addCorsHeaders();
  webServer.send(200, "text/plain; charset=utf-8", "ok");
  markFrameAccepted(event, "wifi");
}

void startHttpServer() {
  if (httpServerStarted) {
    return;
  }
  webServer.on("/", HTTP_GET, handleRoot);
  webServer.on("/hotspot-detect.html", HTTP_GET, handleCaptivePortalProbe);
  webServer.on("/generate_204", HTTP_GET, handleCaptivePortalProbe);
  webServer.on("/gen_204", HTTP_GET, handleCaptivePortalProbe);
  webServer.on("/fwlink", HTTP_GET, handleCaptivePortalProbe);
  webServer.on("/connecttest.txt", HTTP_GET, handleCaptivePortalProbe);
  webServer.on("/ncsi.txt", HTTP_GET, handleCaptivePortalProbe);
  webServer.on("/save", HTTP_POST, handleSaveWifi);
  webServer.on("/reset-wifi", HTTP_POST, handleResetWifi);
  webServer.on("/hello", HTTP_GET, handleHello);
  webServer.on("/health", HTTP_GET, handleHealth);
  webServer.on("/api/settings", HTTP_POST, handleSettingsAPI);
  webServer.on("/api/pair", HTTP_POST, handlePairingAPI);
  webServer.on("/assets", HTTP_GET, handleAssetsList);
  webServer.on(
      "/assets",
      HTTP_POST,
      handleAssetUploadResult,
      handleAssetUpload);
  webServer.on("/assets", HTTP_DELETE, handleAssetDelete);
  webServer.on("/theme/active", HTTP_POST, handleThemeActive);
  webServer.on("/frame", HTTP_POST, handleFrame);
  webServer.on("/update", HTTP_GET, handleUpdatePage);
  webServer.on(
      "/update/firmware",
      HTTP_POST,
      []() {
        handleOtaResult("firmware");
      },
      []() {
        handleOtaUpload(U_FLASH, "firmware");
      });
  webServer.on(
      "/update/filesystem",
      HTTP_POST,
      []() {
        handleOtaResult("filesystem");
      },
      []() {
        handleOtaUpload(U_FS, "filesystem");
      });
  webServer.onNotFound([]() {
    if (webServer.method() == HTTP_OPTIONS) {
      addCorsHeaders();
      webServer.send(204, "text/plain", "");
      return;
    }
    if (setupMode) {
      handleCaptivePortalProbe();
      return;
    }
    webServer.send(404, "text/plain; charset=utf-8", "not found");
  });
  webServer.collectHeaders(kDeviceAuthHeader);
  webServer.begin();
  httpServerStarted = true;
  rawOtaServer.begin();
  rawOtaServer.setNoDelay(true);
  rawOtaServerStarted = true;
  Serial.println("http_server_started port=80");
  Serial.println("raw_ota_server_started port=8081 path=/update/firmware.raw");
}

void startSetupAccessPoint() {
  setupMode = true;
  resetWifiReconnectState();
  WiFi.mode(WIFI_AP_STA);
  WiFi.softAP(kSetupApSsid);
  Serial.printf("wifi_setup_ap ssid=VibeTV-Setup ip=%s\n", WiFi.softAPIP().toString().c_str());
  scanSetupNetworks();
  dnsServer.start(kDnsPort, "*", WiFi.softAPIP());
  captiveDnsStarted = true;
  Serial.printf("captive_dns_started port=%u ip=%s\n", kDnsPort, WiFi.softAPIP().toString().c_str());
  const unsigned long renderStartUs = micros();
  renderer.DrawSetupInstructions(runtimeCtx, kSetupApSsid, WiFi.softAPIP().toString());
  recordRenderFull("setup", micros() - renderStartUs);
  waitStatusRendered = true;
  startHttpServer();
}

void maintainWifiConnection() {
  if (setupMode || rebootPending) {
    return;
  }
  if (WiFi.status() == WL_CONNECTED) {
    if (wifiDisconnectedAtMs != 0) {
      Serial.printf("wifi_reconnected ip=%s\n", WiFi.localIP().toString().c_str());
      drawWaitingForCompanionStatus();
    }
    resetWifiReconnectState();
    return;
  }

  const unsigned long nowMs = millis();
  if (wifiDisconnectedAtMs == 0) {
    wifiDisconnectedAtMs = nowMs;
    wifiReconnectAttemptAtMs = 0;
    Serial.printf("wifi_disconnected status=%d fallback_ms=%lu\n",
                  static_cast<int>(WiFi.status()),
                  kWifiReconnectFallbackMs);
  }

  if (!wifiReconnectStatusRendered) {
    const unsigned long renderStartUs = micros();
    renderer.DrawStatus(runtimeCtx, "VIBE TV", "Reconnecting WiFi", "Please wait");
    recordRenderFull("status", micros() - renderStartUs);
    wifiReconnectStatusRendered = true;
  }

  if (wifiReconnectAttemptAtMs == 0 || (nowMs - wifiReconnectAttemptAtMs) >= kWifiReconnectRetryMs) {
    wifiReconnectAttemptAtMs = nowMs;
    WiFi.reconnect();
    Serial.printf("wifi_reconnect_attempt status=%d elapsed_ms=%lu\n",
                  static_cast<int>(WiFi.status()),
                  nowMs - wifiDisconnectedAtMs);
  }

  if ((nowMs - wifiDisconnectedAtMs) >= kWifiReconnectFallbackMs) {
    Serial.println("wifi_reconnect_failed action=setup_ap");
    const unsigned long renderStartUs = micros();
    renderer.DrawStatus(runtimeCtx, "VIBE TV SETUP", "WiFi unavailable", "Starting setup");
    recordRenderFull("status", micros() - renderStartUs);
    delay(750);
    startSetupAccessPoint();
  }
}

#ifdef CODEXBAR_DISPLAY_RUNTIME_BENCH
struct RuntimeBenchWindow {
  unsigned long windowStartMs = 0;
  unsigned long loopCount = 0;
  unsigned long renderCount = 0;
  unsigned long loopCpuMaxUs = 0;
  unsigned long renderMaxUs = 0;
};

RuntimeBenchWindow benchWindow;

void recordBench(unsigned long loopStartUs, bool rendered, unsigned long renderUs) {
  const unsigned long nowMs = millis();
  if (benchWindow.windowStartMs == 0) {
    benchWindow.windowStartMs = nowMs;
  }

  const unsigned long loopCpuUs = micros() - loopStartUs;
  benchWindow.loopCount++;
  if (loopCpuUs > benchWindow.loopCpuMaxUs) {
    benchWindow.loopCpuMaxUs = loopCpuUs;
  }

  if (rendered) {
    benchWindow.renderCount++;
    if (renderUs > benchWindow.renderMaxUs) {
      benchWindow.renderMaxUs = renderUs;
    }
  }

  if (nowMs - benchWindow.windowStartMs >= 60000UL) {
    Serial.printf(
        "bench board=%s loops=%lu renders=%lu loop_cpu_us_max=%lu render_us_max=%lu\n",
        CODEXBAR_DISPLAY_BOARD_ID,
        benchWindow.loopCount,
        benchWindow.renderCount,
        benchWindow.loopCpuMaxUs,
        benchWindow.renderMaxUs);

    benchWindow = {};
    benchWindow.windowStartMs = nowMs;
  }
}
#endif

}  // namespace

void setup() {
  Serial.begin(115200);
  delay(200);
  bootResetReasonJSON = "\"";
  bootResetReasonJSON += jsonEscape(ESP.getResetReason());
  bootResetReasonJSON += "\"";
  bootResetCounter = incrementBootResetCounter();
  bootID = String(ESP.getChipId(), HEX);
  bootID += "-";
  bootID += String(bootResetCounter);
  bootID += "-";
  bootID += String(ESP.getCycleCount(), HEX);
  renderer.Setup(runtimeCtx);
  loadDeviceSettings();
  loadDeviceAuthToken();
#if CODEXBAR_DISPLAY_THEME_SPEC_RENDERER
  loadDefaultStoredThemeSpecCache();
#endif
  const unsigned long startupRenderStartUs = micros();
  renderer.DrawStatus(runtimeCtx, "VIBE TV", "Starting", "Please wait");
  recordRenderFull("status", micros() - startupRenderStartUs);
  const bool forceSetupMode = consumeBootRecoveryTrigger();

  codexbar_display::app::EmitDeviceHello(makeTransportConfig("usb"));

#ifdef CODEXBAR_DISPLAY_PROBE_ONLY
  Serial.println("codexbar_display_ready_probe");
#else
  Serial.println("codexbar_display_ready_display");
#endif

  WifiCredentials creds;
  if (!forceSetupMode && readWifiCredentials(creds) && connectToSavedWifi(creds)) {
    setupMode = false;
    startHttpServer();
  } else if (!forceSetupMode && connectToSdkWifiConfig()) {
    setupMode = false;
    startHttpServer();
  } else {
    startSetupAccessPoint();
  }
}

void loop() {
  const unsigned long loopStartUs = micros();
  bool rendered = false;
  unsigned long renderDurationUs = 0;

  codexbar_display::core::SerialConsumeEvent event;
  if (codexbar_display::app::ConsumeSerial(runtimeCtx, true, millis(), event)) {
    markFrameAccepted(event, "usb");
  }

  maintainWifiConnection();
  if (!otaUploadInProgress) {
    maintainFirmwareUpdateNotice();
  }

  if (otaUploadInProgress || assetUploadInProgress) {
    if (httpServerStarted) {
      webServer.handleClient();
    }
    delay(1);
    return;
  }

  if (!waitStatusRendered &&
      codexbar_display::app::HasFrame(runtimeCtx) &&
      !codexbar_display::app::CurrentFrame(runtimeCtx).hasError &&
      !runtimeCtx.screenDirty &&
      !frameStaleStatusRendered) {
    renderer.TickActive(runtimeCtx);
    recordAnimatedTickAttempt();
    const int64_t remain = codexbar_display::app::CurrentRemainingSecs(runtimeCtx, millis());
    if (remain != runtimeCtx.lastRenderedSecs) {
      const int64_t minuteBucket = remain / 60;
      if (minuteBucket != runtimeCtx.lastRenderedMinuteBucket) {
#ifdef CODEXBAR_DISPLAY_PROBE_ONLY
        runtimeCtx.screenDirty = true;
#else
        const unsigned long renderStartUs = micros();
        renderer.DrawReset(runtimeCtx, remain);
        drawFirmwareUpdateNotice();
        recordRenderPartial("reset", micros() - renderStartUs);
#endif
      } else {
        runtimeCtx.lastRenderedSecs = remain;
      }
    }
  }

  if (firmwareUpdateNoticeDirty &&
      !waitStatusRendered &&
      codexbar_display::app::HasFrame(runtimeCtx) &&
      !codexbar_display::app::CurrentFrame(runtimeCtx).hasError &&
      !runtimeCtx.screenDirty &&
      !frameStaleStatusRendered) {
    const unsigned long renderStartUs = micros();
    drawFirmwareUpdateNotice();
    rendered = true;
    renderDurationUs = micros() - renderStartUs;
    recordRenderPartial("update_notice", renderDurationUs);
  }

  if (!setupMode &&
      !waitStatusRendered &&
      codexbar_display::app::HasFrame(runtimeCtx) &&
      !codexbar_display::app::CurrentFrame(runtimeCtx).hasError &&
      !codexbar_display::app::CurrentFrame(runtimeCtx).hasThemeSpec &&
      !runtimeCtx.screenDirty &&
      !frameStaleStatusRendered &&
      lastFrameAcceptedAtMs > 0 &&
      (millis() - lastFrameAcceptedAtMs) > kFrameStaleWarningMs) {
    const unsigned long renderStartUs = micros();
    renderer.DrawStatus(runtimeCtx, "VIBE TV", "Open App", kCustomerAppHost);
    recordRenderFull("status", micros() - renderStartUs);
    frameStaleStatusRendered = true;
  }

  if (!codexbar_display::app::HasFrame(runtimeCtx) && !runtimeCtx.screenDirty && !waitStatusRendered) {
    renderer.TickSplash(runtimeCtx);
  }

  if (runtimeCtx.screenDirty && !waitStatusRendered && !renderer.ShouldDeferDirtyRender(runtimeCtx)) {
    const unsigned long renderStartUs = micros();
    const char* fullKind = "usage";
    bool keepDirty = false;
#ifdef CODEXBAR_DISPLAY_PROBE_ONLY
    renderer.DrawUsage(runtimeCtx);
#else
    if (!codexbar_display::app::HasFrame(runtimeCtx)) {
      fullKind = "splash";
      renderer.DrawSplash(runtimeCtx);
    } else if (codexbar_display::app::CurrentFrame(runtimeCtx).hasError) {
      fullKind = "error";
      renderer.DrawStatus(
          runtimeCtx,
          "VIBE TV",
          displayErrorMessage(codexbar_display::app::CurrentFrame(runtimeCtx).error),
          kCustomerAppHost);
    } else {
      fullKind = codexbar_display::app::CurrentFrame(runtimeCtx).hasThemeSpec ? "theme_spec_usage" : "usage";
      renderer.DrawUsage(runtimeCtx);
      if (codexbar_display::app::CurrentFrame(runtimeCtx).hasThemeSpec &&
          !renderer.DebugSnapshot().themeSpecRenderOk) {
        keepDirty = true;
      }
    }
#endif
    rendered = true;
    renderDurationUs = micros() - renderStartUs;
    drawFirmwareUpdateNotice();
    renderDurationUs = micros() - renderStartUs;
    recordRenderFull(fullKind, renderDurationUs);
    if (!keepDirty) {
      runtimeCtx.screenDirty = false;
      firmwareUpdateNoticeDirty = false;
    }
  }

#ifdef CODEXBAR_DISPLAY_RUNTIME_BENCH
  recordBench(loopStartUs, rendered, renderDurationUs);
#else
  (void)loopStartUs;
  (void)rendered;
  (void)renderDurationUs;
#endif

  if (httpServerStarted) {
    webServer.handleClient();
  }
  handleRawOtaClient();
  if (captiveDnsStarted) {
    dnsServer.processNextRequest();
  }
  if (rebootPending && static_cast<long>(millis() - rebootAtMs) >= 0) {
    Serial.println("reboot_now");
    delay(100);
    ESP.restart();
  }

  if (bootRecoveryCounterNeedsClear && static_cast<long>(millis() - bootRecoveryClearAtMs) >= 0) {
    clearBootRecoveryCounter();
  }

#if CODEXBAR_DISPLAY_THEME_SPEC_RENDERER
  delay(renderer.AnimationWorkPending() ? 1 : 20);
#else
  delay(20);
#endif
}
