#include <Arduino.h>
#include <DNSServer.h>
#include <EEPROM.h>
#include <ESP8266WebServer.h>
#include <ESP8266WiFi.h>
#include <WiFiUdp.h>
#include <LittleFS.h>
#include <MD5Builder.h>
#include <Updater.h>
#include <coredecls.h>
#include <time.h>

#include "../../firmware_shared/app_runtime.h"
#include "../../firmware_shared/app_transport.h"
#include "../../firmware_shared/theme_spec_renderer_core.h"
#include "asset_path_policy.h"
#include "cable_transfer_core.h"
#include "connected_setup_policy.h"
#include "device_settings.h"
#include "standby_settings.h"
#include "standby_state.h"
#include "screensaver_preview.h"
#include "wifi_security_policy.h"
#include "gif_asset_validator_file.h"
#include "renderer_esp8266.h"
#include "wifi_recovery_policy.h"
#include "wifi_setup_portal.h"

#ifndef CODEXBAR_DISPLAY_BOARD_ID
#define CODEXBAR_DISPLAY_BOARD_ID "esp8266-unknown"
#endif

#ifndef CODEXBAR_DISPLAY_FW_VERSION
#define CODEXBAR_DISPLAY_FW_VERSION "dev"
#endif

#if CODEXBAR_DISPLAY_THEME_SPEC_RENDERER
const char kThemeFeatureJSON[] = "[\"theme-spec-v1\",\"provider-slots-v1\",\"cable-transfer-v1\",\"cable-health-v1\"]";
#else
const char kThemeFeatureJSON[] = "[]";
#endif

namespace {

codexbar_display::app::RuntimeContext runtimeCtx;
codexbar_display::esp8266::RendererESP8266 renderer;
ESP8266WebServer webServer(80);
DNSServer dnsServer;

constexpr int kMaxFrameBytes = 2048;
constexpr uint16_t kDnsPort = 53;
constexpr uint32_t kWifiCredsMagic = 0x56544231UL;  // VTB1
constexpr uint32_t kBootDiagnosticsMagic = 0x56544244UL;  // VTBD
constexpr size_t kWifiSsidBytes = 33;
constexpr size_t kWifiPasswordBytes = 65;
constexpr size_t kWifiCredsBytes = 4 + kWifiSsidBytes + kWifiPasswordBytes;
// Keep the legacy recovery bytes reserved so firmware updates do not move the
// boot diagnostics or overwrite settings stored by firmware 1.0.38.
constexpr size_t kLegacyRecoveryOffset = kWifiCredsBytes;
constexpr size_t kLegacyRecoveryBytes = 6;
constexpr size_t kBootDiagnosticsOffset = kLegacyRecoveryOffset + kLegacyRecoveryBytes;
constexpr size_t kBootDiagnosticsBytes = 8;
constexpr size_t kBootResetCounterOffset = kBootDiagnosticsOffset + 4;
constexpr size_t kLegacyPairingMarkerOffset = kBootDiagnosticsOffset + kBootDiagnosticsBytes;
constexpr size_t kLegacyPairingMarkerBytes = 4;
constexpr size_t kEepromBytes =
    kWifiCredsBytes + kLegacyRecoveryBytes + kBootDiagnosticsBytes + kLegacyPairingMarkerBytes;
constexpr unsigned long kWifiConnectTimeoutMs = 20000UL;
constexpr unsigned long kWifiReconnectRetryMs = 5000UL;
constexpr unsigned long kWifiReconnectFallbackMs = 120000UL;
constexpr unsigned long kRebootDelayMs = 750UL;
constexpr unsigned long kFrameStaleWarningMs = 150000UL;
// SNTP answers within a few seconds of the WiFi link coming up and keeps the
// system clock corrected on its own afterwards, so this is only a sampling
// interval, not a retry loop.
constexpr unsigned long kDeviceClockPollMs = 2000UL;
constexpr unsigned long kFirmwareUpdateNoticeToggleMs = 1500UL;
constexpr unsigned long kCableTransferTimeoutMs = 15000UL;
constexpr size_t kCableTransferChunkBytes = 128;
constexpr size_t kMaxStoredThemeSpecBytes = 4096;
constexpr size_t kMaxThemeGifAssetBytes = codexbar_display::themespec::kMaxThemeSpecGifAssetBytes;
constexpr uint8_t kDefaultBrightnessPercent =
    codexbar_display::esp8266::device_settings::kDefaultBrightnessPercent;
constexpr uint8_t kMinBrightnessPercent =
    codexbar_display::esp8266::device_settings::kMinBrightnessPercent;
constexpr uint8_t kMaxBrightnessPercent =
    codexbar_display::esp8266::device_settings::kMaxBrightnessPercent;
const char kSetupApSsid[] = "VibeTV-Setup";
const char kSetupAddress[] = "192.168.4.1";
const char kCustomerAppHost[] = "app.vibetv.shop";
const char kCustomerAppUrl[] = "https://app.vibetv.shop";
const char kDeviceSettingsPath[] = "/s";
const char kDeviceSettingsTemporaryPath[] = "/s.tmp";
const char kConnectionTransitionPath[] = "/cm";
const char kConnectionTransitionTemporaryPath[] = "/cm.tmp";
// The device settings record stays append-only: brightness byte, learned UTC
// offset, standby, then optional next UTC-offset transitions. A shorter file is
// an older record, so every reader must length-check its own section instead of
// assuming the full size.
constexpr size_t kStandbyRecordOffset = 1 + codexbar_display::deviceclock::kUtcOffsetRecordBytes;
constexpr size_t kClockTransitionRecordOffset =
    kStandbyRecordOffset + codexbar_display::esp8266::standby::kRecordBytes;
constexpr size_t kConnectionModeRecordOffset =
    kClockTransitionRecordOffset +
    codexbar_display::deviceclock::kUtcOffsetTransitionRecordBytes;
constexpr size_t kDeviceSettingsRecordBytes =
    kConnectionModeRecordOffset + 1;
const char kResetTrustHandoverPath[] = "/rt";
const char kDeviceAuthTokenPath[] = "/auth";
const char kActiveThemeSpecPathFile[] = "/theme-active";
const char kAssetUploadTemporaryPath[] = "/.asset-upload.tmp";
const char kDeviceAuthHeader[] = "X-VibeTV-Token";
// Customer copy for the update notice. The installed VibeTV Mac App is the
// only supported update destination; never point customers at a hosted URL.
const char kFirmwareUpdateAvailableText[] = "Update available";
const char kFirmwareUpdateMacAppText[] = "Open VibeTV Mac App";
constexpr unsigned long kFirmwareUpdateOverlayVisibleMs = 30000UL;
constexpr unsigned long kFirmwareUpdateOverlayHiddenMs = 60000UL;
constexpr unsigned long kFirmwareUpdateSurfaceRecheckMs = 1000UL;

String themeCapabilitiesJSON(bool enabled, bool compact = false) {
  String out;
  out.reserve(compact ? 180 : 260);
  if (!enabled) {
    return "{\"supportsThemeSpecV1\":false,\"supportsUsageSlotsV1\":false,\"supportsUsageWindowsV1\":false,\"supportsProviderSlotsV1\":false,\"maxUsageWindows\":0,\"maxThemeSpecBytes\":0,\"maxThemePrimitives\":0}";
  }
  out += "{\"supportsThemeSpecV1\":true,\"supportsUsageSlotsV1\":true,\"supportsUsageWindowsV1\":true,\"supportsProviderSlotsV1\":true,\"maxUsageWindows\":";
  out += String(codexbar_display::core::kAdvertisedMaxUsageWindows);
  out += ",\"maxThemeSpecBytes\":2048,\"maxThemePrimitives\":";
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
  // Frame-driven gate: true while the Mac App reports an available update.
  // Cleared when a frame arrives without update info or with a current
  // firmware, which also removes the notice.
  bool noticeEnabled = false;
  codexbar_display::updatenotice::State notice;
  unsigned long noticeSurfaceCheckedAtMs = 0;
};

struct RuntimeRenderDiagnostics {
  unsigned long fullCount = 0;
  unsigned long partialCount = 0;
  const char* lastKind = "none";
};

namespace standby = codexbar_display::esp8266::standby;
namespace screensaver_preview = codexbar_display::esp8266::screensaver_preview;
namespace device_settings = codexbar_display::esp8266::device_settings;

struct DeviceSettings {
  uint8_t brightnessPercent = kDefaultBrightnessPercent;
  standby::Settings standby;
  codexbar_display::esp8266::device_settings::ConnectionMode connectionMode =
      codexbar_display::esp8266::device_settings::ConnectionMode::kUnspecified;
};

enum class CableTransferSink : uint8_t {
  kNone = 0,
  kAsset = 1,
  kFirmware = 2,
};

enum class CableTransferActivation : uint8_t {
  kNone = 0,
  kTheme = 1,
  kScreensaver = 2,
};

struct CableTransferState {
  codexbar_display::esp8266::cable_transfer::State flow;
  CableTransferSink sink = CableTransferSink::kNone;
  CableTransferActivation activation = CableTransferActivation::kNone;
  MD5Builder hash;
  uint8_t expectedHash[16] = {};
};

namespace deviceclock = codexbar_display::deviceclock;

unsigned long nextDeviceClockPollAtMs = 0;
char renderedClockTime[deviceclock::kTimeTextSize] = {};
char renderedClockDate[deviceclock::kDateTextSize] = {};

bool httpServerStarted = false;
bool setupMode = false;
bool waitStatusRendered = false;
String lastConnectedSetupIp;
bool otaUploadSucceeded = false;
bool otaUploadInProgress = false;
bool otaUploadNeedsReboot = false;
String otaUploadError;
bool assetUploadSucceeded = false;
bool assetUploadInProgress = false;
String assetUploadError;
String assetUploadPath;
size_t assetUploadBytesSeen = 0;
File assetUploadFile;
String activeThemeSpecPath;
String activeThemeSpecHash;
standby::State standbyState;
// Captured when standby takes the screen, so the way back is the theme that was
// really drawn. There is no second resident ThemeSpec slot: both directions
// reload from LittleFS, which #277 measured at 250-420 ms.
String standbyLiveThemePath;
screensaver_preview::State screensaverPreviewState;
// Same contract as standbyLiveThemePath: rendering any stored spec reassigns
// activeThemeSpecPath (commitStoredThemeSpec), so the preview captures the
// really-drawn live theme before it takes the screen.
String screensaverPreviewLivePath;
codexbar_display::esp8266::wifi_setup::State setupWifiState;
WifiCredentials savedWifiCredentials;
bool savedWifiCredentialsAvailable = false;
codexbar_display::esp8266::wifi_recovery::State wifiSetupRecoveryState;
bool rebootPending = false;
void applyWifiInteropPhyMode();
void scheduleReboot(const char* reason);
unsigned long rebootAtMs = 0;
unsigned long lastFrameAcceptedAtMs = 0;
bool pendingHttpRender = false;
codexbar_display::core::SerialConsumeEvent pendingHttpRenderEvent;
bool frameStaleStatusRendered = false;
bool captiveDnsStarted = false;
unsigned long wifiDisconnectedAtMs = 0;
unsigned long wifiReconnectAttemptAtMs = 0;
bool wifiReconnectStatusRendered = false;
FirmwareUpdateState firmwareUpdate;
bool firmwareUpdateNoticeDirty = false;
RuntimeRenderDiagnostics renderDiagnostics;
DeviceSettings deviceSettings;
bool deviceSettingsRecordAvailable = false;
device_settings::ConnectionTransition connectionTransition;
bool connectionTransitionPending = false;
unsigned long connectionTransitionStartedAtMs = 0;
String deviceAuthToken;
String deviceID;
String bootID;
String bootResetReasonJSON;
uint32_t bootResetCounter = 0;
CableTransferState cableTransfer;

void addCorsHeaders();
void resetWifiReconnectState();
void startHttpServer();
bool handleCableTransferRequest(JsonDocument& doc, const char* op);
void maintainCableTransfer();

#if CODEXBAR_DISPLAY_THEME_SPEC_RENDERER
constexpr const char* kLegacyMiniThemeSpecPath = "/themes/u/mini-cl-1-410a37.json";
constexpr const char* kLegacyMiniGIFPath = "/themes/mini/mini.gif";
#endif

void recordRenderFull(const char* kind, unsigned long durationUs) {
  (void)durationUs;
  renderDiagnostics.fullCount++;
  renderDiagnostics.lastKind = kind;
}

void recordRenderPartial(const char* kind, unsigned long durationUs) {
  (void)durationUs;
  renderDiagnostics.partialCount++;
  renderDiagnostics.lastKind = kind;
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
  return codexbar_display::esp8266::device_settings::ClampBrightnessPercent(value);
}

// Single place that decides how bright the panel is, so entering standby,
// waking up and editing either brightness value all go through one path.
void applyDeviceSettings() {
  if (renderer.SupportsBrightnessControl()) {
    renderer.ApplyBrightnessPercent(standbyState.active
                                        ? deviceSettings.standby.brightnessPercent
                                        : deviceSettings.brightnessPercent);
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
  uint8_t record[kDeviceSettingsRecordBytes] = {};
  const int readBytes = file.read(record, sizeof(record));
  file.close();
  const int brightness = readBytes >= 1 ? record[0] : -1;
  deviceSettings.brightnessPercent =
      codexbar_display::esp8266::device_settings::BrightnessFromPersistedByte(brightness);
  // Records written before the device clock existed only hold the brightness
  // byte; the clock then simply relearns the offset from the next frame.
  int offsetMinutes = 0;
  if (readBytes >= 1 &&
      deviceclock::DecodeUtcOffset(record + 1, static_cast<size_t>(readBytes) - 1, offsetMinutes)) {
    deviceclock::RestoreUtcOffset(runtimeCtx.clock, offsetMinutes);
  }
  // Records written before standby existed stop here, which leaves the standby
  // factory defaults in place.
  if (readBytes > static_cast<int>(kStandbyRecordOffset)) {
    standby::Decode(record + kStandbyRecordOffset,
                    static_cast<size_t>(readBytes) - kStandbyRecordOffset,
                    deviceSettings.standby);
  }
  if (readBytes > static_cast<int>(kClockTransitionRecordOffset)) {
    int64_t transitionEpoch = 0;
    int transitionOffsetMinutes = 0;
    int64_t followingTransitionEpoch = 0;
    int followingTransitionOffsetMinutes = 0;
    if (deviceclock::DecodeUtcOffsetTransition(
            record + kClockTransitionRecordOffset,
            static_cast<size_t>(readBytes) - kClockTransitionRecordOffset,
            transitionEpoch,
            transitionOffsetMinutes,
            &followingTransitionEpoch,
            &followingTransitionOffsetMinutes)) {
      deviceclock::RestoreUtcOffsetTransition(
          runtimeCtx.clock,
          transitionEpoch,
          transitionOffsetMinutes,
          followingTransitionEpoch,
          followingTransitionOffsetMinutes);
    }
  }
  if (readBytes > static_cast<int>(kConnectionModeRecordOffset)) {
    deviceSettings.connectionMode =
        codexbar_display::esp8266::device_settings::DecodeConnectionMode(
            record[kConnectionModeRecordOffset]);
  }
  applyDeviceSettings();
  return readBytes > 0;
}

bool saveDeviceSettings() {
  if (!LittleFS.begin()) {
    return false;
  }
  File file = LittleFS.open(kDeviceSettingsTemporaryPath, "w");
  if (!file) {
    return false;
  }
  uint8_t record[kDeviceSettingsRecordBytes] = {};
  record[0] = deviceSettings.brightnessPercent;
  deviceclock::EncodeUtcOffset(runtimeCtx.clock, record + 1);
  standby::Encode(deviceSettings.standby, record + kStandbyRecordOffset);
  deviceclock::EncodeUtcOffsetTransition(
      runtimeCtx.clock, record + kClockTransitionRecordOffset);
  record[kConnectionModeRecordOffset] =
      static_cast<uint8_t>(deviceSettings.connectionMode);
  const size_t written = file.write(record, sizeof(record));
  file.close();
  if (written != sizeof(record)) {
    LittleFS.remove(kDeviceSettingsTemporaryPath);
    return false;
  }
  if (!LittleFS.rename(kDeviceSettingsTemporaryPath, kDeviceSettingsPath)) {
    LittleFS.remove(kDeviceSettingsTemporaryPath);
    return false;
  }
  return true;
}

bool clearConnectionTransition() {
  if (!LittleFS.begin()) {
    return false;
  }
  if (LittleFS.exists(kConnectionTransitionTemporaryPath)) {
    LittleFS.remove(kConnectionTransitionTemporaryPath);
  }
  if (LittleFS.exists(kConnectionTransitionPath) &&
      !LittleFS.remove(kConnectionTransitionPath)) {
    return false;
  }
  connectionTransition = {};
  connectionTransitionPending = false;
  connectionTransitionStartedAtMs = 0;
  return true;
}

bool saveConnectionTransition(const device_settings::ConnectionTransition& transition) {
  if (!LittleFS.begin()) {
    return false;
  }
  File file = LittleFS.open(kConnectionTransitionTemporaryPath, "w");
  if (!file) {
    return false;
  }
  uint8_t record[device_settings::kConnectionTransitionRecordBytes] = {};
  device_settings::EncodeConnectionTransition(transition, record);
  const size_t written = file.write(record, sizeof(record));
  file.close();
  if (written != sizeof(record)) {
    LittleFS.remove(kConnectionTransitionTemporaryPath);
    return false;
  }
  if (!LittleFS.rename(kConnectionTransitionTemporaryPath, kConnectionTransitionPath)) {
    LittleFS.remove(kConnectionTransitionTemporaryPath);
    return false;
  }
  return true;
}

bool loadConnectionTransition() {
  connectionTransition = {};
  connectionTransitionPending = false;
  connectionTransitionStartedAtMs = 0;
  if (!LittleFS.begin() || !LittleFS.exists(kConnectionTransitionPath)) {
    return false;
  }
  File file = LittleFS.open(kConnectionTransitionPath, "r");
  if (!file) {
    return false;
  }
  uint8_t record[device_settings::kConnectionTransitionRecordBytes] = {};
  const int readBytes = file.read(record, sizeof(record));
  file.close();
  if (!device_settings::DecodeConnectionTransition(
          record, static_cast<size_t>(readBytes), connectionTransition) ||
      deviceSettings.connectionMode != connectionTransition.target) {
    Serial.println("connection_mode_transition_discarded reason=invalid_or_incomplete");
    (void)clearConnectionTransition();
    return false;
  }
  connectionTransitionPending = true;
  connectionTransitionStartedAtMs = millis();
  Serial.printf(
      "connection_mode_transition_loaded from=%s to=%s confirmation_ms=%lu\n",
      device_settings::ConnectionModeName(connectionTransition.previous),
      device_settings::ConnectionModeName(connectionTransition.target),
      device_settings::kConnectionTransitionConfirmationMs);
  return true;
}

device_settings::ConnectionMode requestedConnectionMode(const String& name) {
  if (name == "cable") {
    return device_settings::ConnectionMode::kCable;
  }
  if (name == "wifi") {
    return device_settings::ConnectionMode::kWifi;
  }
  return device_settings::ConnectionMode::kUnspecified;
}

bool beginConnectionTransition(
    device_settings::ConnectionMode target,
    String& error) {
  const device_settings::ConnectionMode previous = deviceSettings.connectionMode;
  if (connectionTransitionPending) {
    error = "connection mode transition already pending";
    return false;
  }
  if (!device_settings::CanBeginConnectionTransition(previous, target)) {
    error = previous == device_settings::ConnectionMode::kLegacyWifiOnly
                ? "Cable is not supported on this migrated device"
                : "invalid connection mode transition";
    return false;
  }

  const device_settings::ConnectionTransition transition{previous, target};
  if (!saveConnectionTransition(transition)) {
    error = "failed to persist connection mode transition";
    return false;
  }
  deviceSettings.connectionMode = target;
  if (!saveDeviceSettings()) {
    deviceSettings.connectionMode = previous;
    (void)clearConnectionTransition();
    error = "failed to persist connection mode";
    return false;
  }
  connectionTransition = transition;
  connectionTransitionPending = true;
  connectionTransitionStartedAtMs = millis();
  Serial.printf(
      "connection_mode_transition_started from=%s to=%s\n",
      device_settings::ConnectionModeName(previous),
      device_settings::ConnectionModeName(target));
  return true;
}

bool confirmConnectionTransition(const String& expectedDeviceID, String& status) {
  if (expectedDeviceID != deviceID) {
    status = "deviceId does not match";
    return false;
  }
  if (!connectionTransitionPending) {
    status = "stable";
    return true;
  }
  if (!clearConnectionTransition()) {
    status = "failed to persist connection mode confirmation";
    return false;
  }
  status = "confirmed";
  Serial.printf(
      "connection_mode_transition_confirmed mode=%s\n",
      device_settings::ConnectionModeName(deviceSettings.connectionMode));
  return true;
}

bool rollbackConnectionTransition(const char* reason) {
  if (!connectionTransitionPending) {
    return true;
  }
  const device_settings::ConnectionMode failedTarget = connectionTransition.target;
  deviceSettings.connectionMode = connectionTransition.previous;
  if (!saveDeviceSettings()) {
    deviceSettings.connectionMode = failedTarget;
    connectionTransitionStartedAtMs = millis();
    Serial.printf("connection_mode_rollback_failed reason=%s\n", reason);
    return false;
  }
  (void)clearConnectionTransition();
  Serial.printf(
      "connection_mode_rolled_back failed=%s restored=%s reason=%s\n",
      device_settings::ConnectionModeName(failedTarget),
      device_settings::ConnectionModeName(deviceSettings.connectionMode),
      reason);
  scheduleReboot("connection_mode_rollback");
  return true;
}

void maintainConnectionTransition() {
  if (!connectionTransitionPending || rebootPending) {
    return;
  }
  if ((millis() - connectionTransitionStartedAtMs) >=
      device_settings::ConnectionTransitionTimeoutMs(setupMode)) {
    (void)rollbackConnectionTransition("confirmation_timeout");
  }
}

bool resolveInitialConnectionMode(bool hasLegacyState) {
  using codexbar_display::esp8266::device_settings::ConnectionMode;
  using codexbar_display::esp8266::device_settings::ResolveInitialConnectionMode;

  const ConnectionMode resolved =
      ResolveInitialConnectionMode(deviceSettings.connectionMode, hasLegacyState);
  if (resolved == deviceSettings.connectionMode) {
    return true;
  }
  deviceSettings.connectionMode = resolved;
  if (!saveDeviceSettings()) {
    Serial.printf(
        "connection_mode_persist_failed mode=%s\n",
        codexbar_display::esp8266::device_settings::ConnectionModeName(resolved));
    return false;
  }
  Serial.printf(
      "connection_mode_migrated mode=%s legacy_state=%d\n",
      codexbar_display::esp8266::device_settings::ConnectionModeName(resolved),
      hasLegacyState ? 1 : 0);
  return true;
}

// Reset-deadline handover across a self-initiated restart.
//
// Written only in the moment the firmware decides to reboot, and consumed once
// on the next boot. That is two LittleFS writes per deliberate restart and none
// per frame, so a ticking countdown never touches flash.
//
// Without a wall clock the device cannot measure how long it was powerless, so
// the record is only honoured after a software restart, where the gap is the
// firmware's own boot. Any other reset reason drops it.
void persistResetTrustForRestart() {
  if (!LittleFS.begin()) {
    return;
  }
  const String record = codexbar_display::core::EncodeResetTrustRecord(runtimeCtx.runtime.reset, millis());
  if (record.length() == 0) {
    LittleFS.remove(kResetTrustHandoverPath);
    return;
  }
  File file = LittleFS.open(kResetTrustHandoverPath, "w");
  if (!file) {
    return;
  }
  file.print(record);
  file.close();
}

void restoreResetTrustAfterRestart() {
  if (!LittleFS.begin() || !LittleFS.exists(kResetTrustHandoverPath)) {
    return;
  }
  String record;
  File file = LittleFS.open(kResetTrustHandoverPath, "r");
  if (file) {
    record = file.readString();
    file.close();
  }
  LittleFS.remove(kResetTrustHandoverPath);

  const rst_info* resetInfo = ESP.getResetInfoPtr();
  if (resetInfo == nullptr || resetInfo->reason != REASON_SOFT_RESTART) {
    return;
  }
  codexbar_display::core::ResetTrustState restored;
  if (codexbar_display::core::DecodeResetTrustRecord(
          record,
          codexbar_display::core::kResetRestartDowntimeSecs,
          millis(),
          restored)) {
    runtimeCtx.runtime.reset = restored;
  }
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

bool requestHasCurrentDeviceToken() {
  return deviceAuthConfigured() && requestAuthToken() == deviceAuthToken;
}

bool requestHasValidOtaAuth() {
  return codexbar_display::esp8266::WifiSecurityPolicy::AllowsFirmwareUpload(
      deviceAuthConfigured(),
      requestHasCurrentDeviceToken());
}

bool authorizeWifiCredentialWrite() {
  if (codexbar_display::esp8266::WifiSecurityPolicy::AllowsCredentialWrite(
          setupMode,
          deviceAuthConfigured(),
          requestHasCurrentDeviceToken())) {
    return true;
  }
  addCorsHeaders();
  if (deviceAuthConfigured()) {
    webServer.sendHeader("WWW-Authenticate", "VibeTV token");
    webServer.send(401, "text/plain; charset=utf-8", "pairing token required");
  } else {
    webServer.send(403, "text/plain; charset=utf-8", "physical setup confirmation required");
  }
  return false;
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
  if (!renderer.SupportsBrightnessControl()) {
    out += "{\"supported\":false}";
    return;
  }
  out += "{\"supported\":true,\"minPercent\":";
  out += String(kMinBrightnessPercent);
  out += ",\"maxPercent\":";
  out += String(kMaxBrightnessPercent);
  out += "}";
}

// Standby needs a second ThemeSpec slot, so a build without the ThemeSpec
// renderer cannot support it. Hosts must read this instead of assuming that a
// given firmware version implies standby support.
void appendStandbyCapabilityJSON(String& out) {
#if CODEXBAR_DISPLAY_THEME_SPEC_RENDERER
  out += "{\"supported\":true,\"minTimeoutMinutes\":";
  out += String(standby::kMinTimeoutMinutes);
  out += ",\"maxTimeoutMinutes\":";
  out += String(standby::kMaxTimeoutMinutes);
  out += ",\"defaultTimeoutMinutes\":";
  out += String(standby::kDefaultTimeoutMinutes);
  out += ",\"screensaverSlot\":true}";
#else
  out += "{\"supported\":false}";
#endif
}

// Live standby state, kept out of the HTTP handler so the USB status channel
// (#301) can emit the same shape. It must never go into hello, which is a boot
// snapshot emitted once in setup().
void appendStandbyStateJSON(String& out) {
  out += "\"standby\":{\"active\":";
  out += standbyState.active ? "true" : "false";
  out += ",\"idleSecs\":";
  out += String((millis() - standbyState.lastActivityMs) / 1000UL);
  // While standby draws the screensaver, display.themeSpec.path is the
  // screensaver, not the live slot. A host that restores the live theme has to
  // read this instead, or it would write the screensaver into the live slot.
  // The post-install preview borrows the screen the same way and holds the same
  // way back, so whichever of the two owns it reports it here.
  out += ",\"liveThemePath\":";
  appendJSONNullableString(out, standbyLiveThemePath.length() > 0
                                    ? standbyLiveThemePath
                                    : screensaverPreviewLivePath);
  out += "}";
}

void appendSettingsJSON(String& out) {
  out += "\"settings\":{\"display\":{\"brightnessPercent\":";
  out += String(deviceSettings.brightnessPercent);
  out += "},\"standby\":{\"enabled\":";
  out += deviceSettings.standby.enabled ? "true" : "false";
  out += ",\"timeoutMinutes\":";
  out += String(deviceSettings.standby.timeoutMinutes);
  out += ",\"brightnessPercent\":";
  out += String(deviceSettings.standby.brightnessPercent);
  out += ",\"screensaverPath\":";
  if (standby::HasScreensaver(deviceSettings.standby)) {
    out += "\"";
    out += jsonEscape(String(deviceSettings.standby.screensaverPath));
    out += "\"";
  } else {
    out += "null";
  }
  out += "}}";
}

// Clock state is a diagnostic: it must show whether the displayed time is the
// device's own, a still-current Companion string, or nothing trustworthy.
void appendClockJSON(String& out) {
  const unsigned long nowMs = millis();
  char timeText[deviceclock::kTimeTextSize];
  char dateText[deviceclock::kDateTextSize];
  const deviceclock::Source source =
      codexbar_display::app::ClockTimeText(runtimeCtx, nowMs, timeText, sizeof(timeText));
  codexbar_display::app::ClockDateText(runtimeCtx, nowMs, dateText, sizeof(dateText));

  out += "\"clock\":{\"synced\":";
  out += runtimeCtx.clock.synced ? "true" : "false";
  out += ",\"source\":\"";
  out += deviceclock::SourceName(source);
  out += "\",\"epoch\":";
  out += String(static_cast<long>(deviceclock::UtcNow(runtimeCtx.clock, nowMs)));
  out += ",\"utcOffsetMinutes\":";
  if (runtimeCtx.clock.hasUtcOffset) {
    out += String(static_cast<int>(runtimeCtx.clock.utcOffsetMinutes));
  } else {
    out += "null";
  }
  out += ",\"lastSyncAgeMs\":";
  if (runtimeCtx.clock.synced) {
    out += String(nowMs - runtimeCtx.clock.syncMillis);
  } else {
    out += "null";
  }
  out += ",\"syncCount\":";
  out += String(runtimeCtx.clock.syncCount);
  out += ",\"time\":\"";
  out += timeText;
  out += "\",\"date\":\"";
  out += dateText;
  out += "\"},";
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
  return firmwareUpdate.noticeEnabled &&
         firmwareUpdate.notice.visible &&
         !setupMode &&
         !waitStatusRendered &&
         !frameStaleStatusRendered &&
         codexbar_display::app::HasFrame(runtimeCtx) &&
         codexbar_display::app::CurrentFrame(runtimeCtx).hasThemeSpec &&
         !codexbar_display::app::CurrentFrame(runtimeCtx).hasError;
}

const char* currentFirmwareUpdateNoticeText() {
  switch (codexbar_display::updatenotice::CurrentPhase(firmwareUpdate.notice)) {
    case codexbar_display::updatenotice::Phase::Available:
      return kFirmwareUpdateAvailableText;
    case codexbar_display::updatenotice::Phase::MacApp:
      return kFirmwareUpdateMacAppText;
    case codexbar_display::updatenotice::Phase::Provider:
      break;
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

void restoreFirmwareUpdateNoticeSurface() {
  if (!codexbar_display::app::HasFrame(runtimeCtx) ||
      codexbar_display::app::CurrentFrame(runtimeCtx).hasError ||
      waitStatusRendered ||
      frameStaleStatusRendered) {
    return;
  }
  if (!renderer.ClearFirmwareUpdateNoticeSurface(runtimeCtx)) {
    runtimeCtx.screenDirty = true;
  }
}

void clearFirmwareUpdateNotice() {
  const codexbar_display::updatenotice::TickResult result =
      codexbar_display::updatenotice::Deactivate(firmwareUpdate.notice);
  firmwareUpdateNoticeDirty = false;
  if (result.restore) {
    restoreFirmwareUpdateNoticeSurface();
  }
}

void maintainFirmwareUpdateNotice() {
  if (!firmwareUpdate.noticeEnabled ||
      setupMode ||
      frameStaleStatusRendered ||
      !codexbar_display::app::HasFrame(runtimeCtx) ||
      !codexbar_display::app::CurrentFrame(runtimeCtx).hasThemeSpec ||
      codexbar_display::app::CurrentFrame(runtimeCtx).hasError) {
    clearFirmwareUpdateNotice();
    return;
  }

  const unsigned long nowMs = millis();
  // Surface detection walks the ThemeSpec, so re-check it at most once per
  // second: once to activate the notice, afterwards to follow theme changes.
  if (firmwareUpdate.noticeSurfaceCheckedAtMs == 0 ||
      (nowMs - firmwareUpdate.noticeSurfaceCheckedAtMs) >= kFirmwareUpdateSurfaceRecheckMs) {
    firmwareUpdate.noticeSurfaceCheckedAtMs = nowMs == 0 ? 1 : nowMs;
    const codexbar_display::updatenotice::TickResult activated =
        codexbar_display::updatenotice::Activate(
            firmwareUpdate.notice, renderer.FirmwareUpdateNoticeSurface(runtimeCtx), nowMs);
    if (activated.restore) {
      restoreFirmwareUpdateNoticeSurface();
    }
    if (activated.draw) {
      markFirmwareUpdateNoticeDirty();
    }
  }

  codexbar_display::updatenotice::Config config;
  config.phaseToggleMs = kFirmwareUpdateNoticeToggleMs;
  config.overlayVisibleMs = kFirmwareUpdateOverlayVisibleMs;
  config.overlayHiddenMs = kFirmwareUpdateOverlayHiddenMs;
  const codexbar_display::updatenotice::TickResult ticked =
      codexbar_display::updatenotice::Tick(firmwareUpdate.notice, config, nowMs);
  if (ticked.restore) {
    restoreFirmwareUpdateNoticeSurface();
  }
  if (ticked.draw) {
    markFirmwareUpdateNoticeDirty();
  }
}

void applyFrameUpdateState() {
  if (!codexbar_display::app::HasFrame(runtimeCtx)) {
    return;
  }

  const codexbar_display::core::Frame& frame = codexbar_display::app::CurrentFrame(runtimeCtx);
  if (!frame.hasUpdateAvailable) {
    firmwareUpdate.noticeEnabled = false;
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
  firmwareUpdate.lastStatus = nextStatus;

  if (!firmwareUpdate.available) {
    firmwareUpdate.noticeEnabled = false;
    clearFirmwareUpdateNotice();
    return;
  }
  if (changed) {
    // Restart the notice cycle for a new update state; the next maintain pass
    // re-activates it on the current theme's surface.
    clearFirmwareUpdateNotice();
    firmwareUpdate.noticeSurfaceCheckedAtMs = 0;
  }
  firmwareUpdate.noticeEnabled = true;
}

void drawWaitingForCompanionStatus() {
  String stationIp = WiFi.localIP().toString();
  if (WiFi.status() != WL_CONNECTED ||
      !codexbar_display::esp8266::ConnectedSetupPolicy::IsStationIPv4(stationIp.c_str())) {
    stationIp = "";
  }
  const unsigned long renderStartUs = micros();
  renderer.DrawConnectedSetupInstructions(runtimeCtx, kCustomerAppHost, stationIp);
  recordRenderFull("connected_setup", micros() - renderStartUs);
  lastConnectedSetupIp = stationIp;
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

bool wifiSetupRecoveryBusy() {
  return statusScreenLocked() || assetUploadInProgress || setupWifiState.scanInProgress;
}

void finishWifiSetupRecovery() {
  if (captiveDnsStarted) {
    dnsServer.stop();
    captiveDnsStarted = false;
    Serial.println("captive_dns_stopped reason=wifi_reconnected");
  }
  WiFi.softAPdisconnect(true);
  WiFi.mode(WIFI_STA);
  setupMode = false;
  resetWifiReconnectState();
  startHttpServer();
  drawWaitingForCompanionStatus();
  Serial.printf("wifi_setup_retry_connected ip=%s\n", WiFi.localIP().toString().c_str());
}

void maintainWifiSetupRecovery() {
  const unsigned long nowMs = millis();
  codexbar_display::esp8266::wifi_recovery::Inputs inputs;
  inputs.nowMs = static_cast<uint32_t>(nowMs);
  inputs.setupMode = setupMode;
  inputs.credentialsAvailable = savedWifiCredentialsAvailable;
  inputs.busy = wifiSetupRecoveryBusy();
  inputs.connected = WiFi.status() == WL_CONNECTED;

  const codexbar_display::esp8266::wifi_recovery::Action action =
      codexbar_display::esp8266::wifi_recovery::Tick(wifiSetupRecoveryState, inputs);
  switch (action) {
    case codexbar_display::esp8266::wifi_recovery::Action::StartAttempt:
      WiFi.mode(WIFI_AP_STA);
      applyWifiInteropPhyMode();
      WiFi.begin(savedWifiCredentials.ssid, savedWifiCredentials.password);
      Serial.printf("wifi_setup_retry_started ssid=%s\n", savedWifiCredentials.ssid);
      break;
    case codexbar_display::esp8266::wifi_recovery::Action::Timeout:
      WiFi.disconnect(false);
      WiFi.mode(WIFI_AP_STA);
      applyWifiInteropPhyMode();
      WiFi.softAP(kSetupApSsid);
      Serial.printf("wifi_setup_retry_failed status=%d next_retry_ms=%lu\n",
                    static_cast<int>(WiFi.status()),
                    static_cast<unsigned long>(
                        codexbar_display::esp8266::wifi_recovery::kRetryIntervalMs));
      break;
    case codexbar_display::esp8266::wifi_recovery::Action::Connected:
      finishWifiSetupRecovery();
      break;
    case codexbar_display::esp8266::wifi_recovery::Action::None:
      break;
  }
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

void renderAcceptedFrame(const codexbar_display::core::SerialConsumeEvent& event) {
  const bool maybeThemeSpecPartial = event.themeSpecPartialRender && !runtimeCtx.screenDirty;
  const unsigned long partialStartUs = maybeThemeSpecPartial ? micros() : 0;
  const unsigned long partialSuccessesBefore =
      maybeThemeSpecPartial ? renderer.DebugSnapshot().themeSpecPartialSuccesses : 0;
  renderer.OnFrameAccepted(runtimeCtx, event);
  if (shouldShowFirmwareUpdateNotice()) {
    // A frame-driven partial repaint may have painted theme content over the
    // visible notice (label line or overlay bar); re-assert it next loop.
    markFirmwareUpdateNoticeDirty();
  }
  if (maybeThemeSpecPartial) {
    const codexbar_display::esp8266::RendererDebugSnapshot snapshot = renderer.DebugSnapshot();
    if (snapshot.themeSpecPartialSuccesses > partialSuccessesBefore && !runtimeCtx.screenDirty) {
      recordRenderPartial("theme_spec_frame", micros() - partialStartUs);
    }
  }
}

void maintainDeviceClock() {
  const unsigned long nowMs = millis();
  if (static_cast<long>(nowMs - nextDeviceClockPollAtMs) < 0) {
    return;
  }
  nextDeviceClockPollAtMs = nowMs + kDeviceClockPollMs;

  const time_t systemEpoch = time(nullptr);
  if (deviceclock::ObserveSystemEpoch(runtimeCtx.clock, static_cast<int64_t>(systemEpoch), nowMs)) {
    Serial.printf("clock_synced epoch=%ld utc_offset_known=%d\n",
                  static_cast<long>(systemEpoch),
                  runtimeCtx.clock.hasUtcOffset ? 1 : 0);
  }

  if (deviceclock::ApplyDueUtcOffsetTransition(
          runtimeCtx.clock, deviceclock::UtcNow(runtimeCtx.clock, nowMs))) {
    Serial.printf("clock_utc_offset_transition_applied minutes=%d\n",
                  static_cast<int>(runtimeCtx.clock.utcOffsetMinutes));
    saveDeviceSettings();
  }

  char timeText[deviceclock::kTimeTextSize];
  char dateText[deviceclock::kDateTextSize];
  codexbar_display::app::ClockTimeText(runtimeCtx, nowMs, timeText, sizeof(timeText));
  codexbar_display::app::ClockDateText(runtimeCtx, nowMs, dateText, sizeof(dateText));
  if (strcmp(timeText, renderedClockTime) == 0 && strcmp(dateText, renderedClockDate) == 0) {
    return;
  }
  strcpy(renderedClockTime, timeText);
  strcpy(renderedClockDate, dateText);

  if (setupMode ||
      waitStatusRendered ||
      frameStaleStatusRendered ||
      runtimeCtx.screenDirty ||
      !codexbar_display::app::HasFrame(runtimeCtx) ||
      codexbar_display::app::CurrentFrame(runtimeCtx).hasError) {
    return;
  }
  const unsigned long renderStartUs = micros();
  if (renderer.DrawClock(runtimeCtx)) {
    recordRenderPartial("clock", micros() - renderStartUs);
  }
}

bool acceptedFrameRenderDeferredForTransport(const char* transport) {
  if (transport == nullptr) {
    return false;
  }
  return strcmp(transport, "wifi") == 0 ||
         strcmp(transport, "theme") == 0;
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
  // Loading a stored ThemeSpec is an internal screen transition. In
  // particular, entering standby must not count as fresh customer usage or the
  // next loop immediately exits standby and restores the live theme again.
  // Real Wi-Fi and USB usage frames still reset the idle timer as before.
  //
  // The activity clock reads the frame's own `activity` verdict rather than
  // inferring one from usage percentages. Percentages are whole numbers, so a
  // customer coding against a weekly quota can work for a long time before the
  // value ticks over, and standby would keep the screensaver up while they
  // type. The Companion already decides this honestly, with its own hold and
  // idle-evidence rules; the device just uses that answer.
  if (event.reportsWorking && strcmp(transport, "theme") != 0) {
    standby::NoteUsageActivity(standbyState, lastFrameAcceptedAtMs);
  }
  // SNTP delivers UTC only. The Companion supplies the current local date/time
  // for fallback display, its current offset, and the next two transitions;
  // the device stores and consumes those against its own SNTP epoch.
  const codexbar_display::core::Frame& currentFrame =
      codexbar_display::app::CurrentFrame(runtimeCtx);
  const bool clockOffsetChanged = deviceclock::ObserveCompanionClock(
      runtimeCtx.clock,
      currentFrame.timeText.c_str(),
      currentFrame.hasClockSchedule,
      static_cast<int>(currentFrame.clockOffsetMinutes),
      lastFrameAcceptedAtMs);
  bool clockScheduleChanged = false;
  if (currentFrame.hasClockSchedule && currentFrame.clockTransitionEpoch > 0) {
    clockScheduleChanged = deviceclock::ObserveUtcOffsetTransition(
        runtimeCtx.clock,
        currentFrame.clockTransitionEpoch,
        currentFrame.clockTransitionOffsetMinutes,
        currentFrame.clockFollowingTransitionEpoch,
        currentFrame.clockFollowingTransitionOffsetMinutes);
  } else if (currentFrame.hasClockSchedule) {
    // A valid current offset without a next transition explicitly retires a
    // previously persisted schedule (for example after leaving DST).
    clockScheduleChanged = deviceclock::ClearUtcOffsetTransition(runtimeCtx.clock);
  }
  const bool clockTransitionApplied = deviceclock::ApplyDueUtcOffsetTransition(
      runtimeCtx.clock, deviceclock::UtcNow(runtimeCtx.clock, lastFrameAcceptedAtMs));
  if (clockTransitionApplied) {
    Serial.printf("clock_utc_offset_transition_applied minutes=%d\n",
                  static_cast<int>(runtimeCtx.clock.utcOffsetMinutes));
  }
  if (clockOffsetChanged) {
    Serial.printf("clock_utc_offset_learned minutes=%d\n",
                  static_cast<int>(runtimeCtx.clock.utcOffsetMinutes));
  }
  if (clockOffsetChanged || clockScheduleChanged || clockTransitionApplied) {
    saveDeviceSettings();
  }
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

  const bool deferRender = acceptedFrameRenderDeferredForTransport(transport);
  if (deferRender && event.visualChanged) {
    // ESP8266WebServer invokes WiFi frame and theme activation callbacks from
    // handleClient(). Keep display work out of those callbacks so HTTP can ACK.
    pendingHttpRenderEvent = event;
    pendingHttpRender = true;
  } else if (!deferRender) {
    renderAcceptedFrame(event);
  }
  Serial.printf("frame_received transport=%s\n", transport);
}

const char* transportCapabilitiesJSON(const char* activeTransport, bool compact = false) {
  const bool isUsb = activeTransport != nullptr && strcmp(activeTransport, "usb") == 0;
  const bool supportsCable =
      codexbar_display::esp8266::device_settings::SupportsCable(
          deviceSettings.connectionMode);
  static String json;
  json = "{\"display\":{";
  if (!compact) {
    json += "\"widthPx\":240,\"heightPx\":240,\"colorDepthBits\":16,";
  }
  json += "\"brightness\":";
  appendBrightnessCapabilityJSON(json);
  json += "},\"standby\":";
  appendStandbyCapabilityJSON(json);
  json += ",\"theme\":";
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
  json += "\",\"supported\":[";
  if (supportsCable) {
    json += "\"usb\",";
  }
  json += "\"wifi\"],\"mode\":\"";
  json += codexbar_display::esp8266::device_settings::ConnectionModeName(
      deviceSettings.connectionMode);
  json += "\",\"transitionPending\":";
  json += connectionTransitionPending ? "true" : "false";
  if (connectionTransitionPending) {
    json += ",\"transitionFrom\":\"";
    json += device_settings::ConnectionModeName(connectionTransition.previous);
    json += "\",\"transitionTo\":\"";
    json += device_settings::ConnectionModeName(connectionTransition.target);
    json += "\"";
  }
  json += "}}";
  return json.c_str();
}

codexbar_display::app::TransportConfig makeTransportConfig(const char* activeTransport) {
  codexbar_display::app::TransportConfig config;
  config.boardId = CODEXBAR_DISPLAY_BOARD_ID;
  config.firmwareVersion = CODEXBAR_DISPLAY_FW_VERSION;
  config.deviceId = deviceID.c_str();
  config.networkMode =
      codexbar_display::esp8266::device_settings::UsesWifi(
          deviceSettings.connectionMode)
          ? (setupMode ? "setup" : "station")
          : "off";
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
  return codexbar_display::esp8266::wifi_setup::HtmlEscape(raw);
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

bool saveWifiCredentials(const String& ssid, const String& password) {
  EEPROM.begin(kEepromBytes);
  EEPROM.put(0, kWifiCredsMagic);
  for (size_t i = 0; i < kWifiSsidBytes; ++i) {
    EEPROM.write(4 + i, i < ssid.length() ? ssid.charAt(i) : 0);
  }
  for (size_t i = 0; i < kWifiPasswordBytes; ++i) {
    EEPROM.write(4 + kWifiSsidBytes + i, i < password.length() ? password.charAt(i) : 0);
  }
  // Clear any marker left by 1.0.38. New firmware never needs a physical
  // pairing window, but the bytes stay reserved for storage compatibility.
  EEPROM.put(kLegacyPairingMarkerOffset, static_cast<uint32_t>(0));
  return EEPROM.commit();
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

// The ESP8266 NONOS WiFi stack cannot receive 802.11n A-MSDU aggregates.
// APs (hardware-proven: FRITZ!Box 7530) intermittently aggregate TCP/UDP
// frames above ~200 bytes payload, which the device then drops wholesale:
// HTTP bodies over one segment, asset uploads, and RAW OTA acks all stall
// while small frames and ICMP keep working. Forcing 802.11g disables
// aggregation entirely; verified A/B/A/B on hardware device 14799300.
void applyWifiInteropPhyMode() {
  if (!WiFi.setPhyMode(WIFI_PHY_MODE_11G)) {
    Serial.println("wifi_phy_mode_11g_failed");
  }
}

bool connectToSavedWifi(const WifiCredentials& creds) {
  Serial.printf("wifi_connect ssid=%s\n", creds.ssid);
  drawWifiConnectingStatus(creds.ssid);
  WiFi.mode(WIFI_STA);
  applyWifiInteropPhyMode();
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
  applyWifiInteropPhyMode();
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
  if (ssid.length() < kWifiSsidBytes && password.length() < kWifiPasswordBytes &&
      saveWifiCredentials(ssid, password)) {
    Serial.printf("wifi_sdk_credentials_imported ssid=%s\n", ssid.c_str());
  }
  Serial.printf(
      "wifi_connected source=sdk ssid=%s ip=%s\n",
      ssid.c_str(),
      WiFi.localIP().toString().c_str());
  drawWaitingForCompanionStatus();
  return true;
}

bool scanSetupNetworks(bool automatic) {
  using namespace codexbar_display::esp8266::wifi_setup;
  const bool started = automatic ? BeginAutomaticScan(setupWifiState) : BeginScan(setupWifiState);
  if (!started) {
    Serial.printf(
        "wifi_setup_scan_ignored reason=%s\n",
        automatic ? "automatic_already_started" : "already_running");
    return false;
  }
  const bool recoveryAttemptInterrupted = automatic && wifiSetupRecoveryState.attemptInProgress;

  Serial.println("wifi_setup_scan_started");
  int networks = -2;
  WiFi.mode(setupMode ? WIFI_AP_STA : WIFI_STA);
  WiFi.setAutoReconnect(false);
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

  for (int i = 0; i < networks; ++i) {
    AddScanResult(setupWifiState, WiFi.SSID(i), WiFi.RSSI(i), WiFi.channel(i));
  }
  WiFi.scanDelete();
  FinishScan(setupWifiState, networks);
  if (recoveryAttemptInterrupted) {
    codexbar_display::esp8266::wifi_recovery::RescheduleAfterInterruption(
        wifiSetupRecoveryState,
        static_cast<uint32_t>(millis()));
    Serial.println("wifi_setup_recovery_rescheduled reason=automatic_scan");
  }
  if (setupMode) {
    WiFi.mode(WIFI_AP);
  }
  Serial.printf(
      "wifi_setup_scan_finished networks=%d visible=%u state=%u\n",
      networks,
      setupWifiState.networkCount,
      static_cast<unsigned int>(setupWifiState.scanStatus));
  return true;
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
  html += F("<section><h2>Pairing</h2>");
  if (deviceAuthConfigured()) {
    html += F("<p class='muted'>Paired. Manage this VibeTV in Control Center.</p>");
  } else {
    html += F("<p class='muted'>Open Control Center to finish pairing after Wi-Fi setup.</p>");
  }
  html += F("</section>");
  return html;
}

void handleRoot() {
  webServer.keepAlive(false);
  if (setupMode) {
    codexbar_display::esp8266::wifi_setup::SendSetupPage(
        webServer,
        setupWifiState,
        codexbar_display::esp8266::wifi_setup::kSupportUrl,
        kSetupAddress);
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
    codexbar_display::esp8266::wifi_setup::SendSetupPage(
        webServer,
        setupWifiState,
        codexbar_display::esp8266::wifi_setup::kSupportUrl,
        kSetupAddress);
    return;
  }
  redirectToSetupRoot();
}

void handleSaveWifi() {
  webServer.keepAlive(false);
  if (!authorizeWifiCredentialWrite()) {
    return;
  }
  String ssid = webServer.arg("custom_ssid");
  ssid.trim();
  if (ssid.length() == 0) {
    ssid = webServer.arg("ssid");
    ssid.trim();
  }
  String password = webServer.arg("password");
  if (ssid.length() == 0) {
    codexbar_display::esp8266::wifi_setup::SetConnectionError(
        setupWifiState,
        codexbar_display::esp8266::wifi_setup::ConnectionError::MissingSsid);
    codexbar_display::esp8266::wifi_setup::SendSetupPage(
        webServer,
        setupWifiState,
        codexbar_display::esp8266::wifi_setup::kSupportUrl,
        kSetupAddress,
        400);
    return;
  }
  if (ssid.length() >= kWifiSsidBytes || password.length() >= kWifiPasswordBytes) {
    codexbar_display::esp8266::wifi_setup::SetConnectionError(
        setupWifiState,
        codexbar_display::esp8266::wifi_setup::ConnectionError::InvalidCredentials);
    codexbar_display::esp8266::wifi_setup::SendSetupPage(
        webServer,
        setupWifiState,
        codexbar_display::esp8266::wifi_setup::kSupportUrl,
        kSetupAddress,
        400);
    return;
  }

  codexbar_display::esp8266::wifi_setup::ClearConnectionError(setupWifiState);
  if (!saveWifiCredentials(ssid, password)) {
    webServer.send(500, "text/plain; charset=utf-8", "WiFi settings could not be saved");
    return;
  }
  Serial.printf("wifi_credentials_saved ssid=%s\n", ssid.c_str());
  webServer.send(200, "text/html; charset=utf-8", "<!doctype html><p>Saved. Vibe TV is restarting.</p>");
  delay(500);
  clearSdkWifiCredentials();
  persistResetTrustForRestart();
  ESP.restart();
}

void handleSetupWifiScan() {
  webServer.keepAlive(false);
  if (!setupMode) {
    redirectToSetupRoot();
    return;
  }

  codexbar_display::esp8266::wifi_setup::ClearConnectionError(setupWifiState);
  const bool automatic = webServer.arg("automatic") == "1";
  scanSetupNetworks(automatic);
  webServer.sendHeader("Location", "/", true);
  webServer.send(303, "text/plain; charset=utf-8", "");
}

void handleResetWifi() {
  webServer.keepAlive(false);
  if (webServer.method() != HTTP_POST) {
    webServer.send(405, "text/plain; charset=utf-8", "method not allowed");
    return;
  }

  if (!authorizeWifiCredentialWrite()) {
    return;
  }

  webServer.send(200, "text/html; charset=utf-8", "<!doctype html><p>WiFi settings cleared. Vibe TV is restarting setup.</p>");
  drawWifiResetStatus("Restarting");
  waitStatusRendered = true;
  delay(500);
  clearWifiCredentials();
  clearSdkWifiCredentials();
  delay(250);
  persistResetTrustForRestart();
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

  const String out = codexbar_display::app::BuildDeviceHelloJSON(
      makeTransportConfig("wifi"));
  webServer.send(200, "application/json", out);
}

bool parseConnectionModeRequest(
    device_settings::ConnectionMode& mode,
    String& expectedDeviceID,
    String& error) {
  JsonDocument doc;
  if (deserializeJson(doc, webServer.arg("plain"))) {
    error = "invalid JSON body";
    return false;
  }
  expectedDeviceID = String(doc["deviceId"] | "");
  mode = requestedConnectionMode(String(doc["mode"] | ""));
  if (expectedDeviceID != deviceID) {
    error = "deviceId does not match";
    return false;
  }
  if (mode == device_settings::ConnectionMode::kUnspecified) {
    error = "mode must be cable or wifi";
    return false;
  }
  return true;
}

void handleConnectionModeSwitch() {
  addCorsHeaders();
  if (!requireWriteAuth()) {
    return;
  }
  device_settings::ConnectionMode target =
      device_settings::ConnectionMode::kUnspecified;
  String expectedDeviceID;
  String error;
  if (!parseConnectionModeRequest(target, expectedDeviceID, error) ||
      !beginConnectionTransition(target, error)) {
    webServer.send(400, "text/plain; charset=utf-8", error);
    return;
  }
  String out;
  out.reserve(180);
  out += "{\"ok\":true,\"deviceId\":\"";
  out += deviceID;
  out += "\",\"mode\":\"";
  out += device_settings::ConnectionModeName(target);
  out += "\",\"confirmationRequired\":true}";
  webServer.send(202, "application/json", out);
  scheduleReboot("connection_mode_switch");
}

void handleConnectionModeConfirmation() {
  addCorsHeaders();
  if (!requireWriteAuth()) {
    return;
  }
  JsonDocument doc;
  if (deserializeJson(doc, webServer.arg("plain"))) {
    webServer.send(400, "text/plain; charset=utf-8", "invalid JSON body");
    return;
  }
  String status;
  if (!confirmConnectionTransition(String(doc["deviceId"] | ""), status)) {
    webServer.send(409, "text/plain; charset=utf-8", status);
    return;
  }
  String out = "{\"ok\":true,\"deviceId\":\"";
  out += deviceID;
  out += "\",\"mode\":\"";
  out += device_settings::ConnectionModeName(deviceSettings.connectionMode);
  out += "\",\"status\":\"";
  out += status;
  out += "\"}";
  webServer.send(200, "application/json", out);
}

void emitSerialStatus() {
  String out;
  out.reserve(240);
  out += "{\"kind\":\"status\",\"deviceId\":\"";
  out += deviceID;
  out += "\",\"board\":\"";
  out += CODEXBAR_DISPLAY_BOARD_ID;
  out += "\",\"firmware\":\"";
  out += CODEXBAR_DISPLAY_FW_VERSION;
  out += "\",\"connectionMode\":\"";
  out += codexbar_display::esp8266::device_settings::ConnectionModeName(
      deviceSettings.connectionMode);
  out += "\",\"transitionPending\":";
  out += connectionTransitionPending ? "true" : "false";
  out += ",\"transport\":\"usb\",\"hasFrame\":";
  out += codexbar_display::app::HasFrame(runtimeCtx) ? "true" : "false";
  out += "}";
  Serial.println(out);
}

void emitSerialError(const char* code) {
  String out = "{\"kind\":\"error\",\"code\":\"";
  out += code;
  out += "\"}";
  Serial.println(out);
}

void emitSerialPairing(const String& token) {
  String out = "{\"kind\":\"pairing\",\"status\":\"paired\",\"deviceId\":\"";
  out += deviceID;
  out += "\",\"token\":\"";
  out += jsonEscape(token);
  out += "\"}";
  Serial.println(out);
}

void emitSerialConnectionMode(
    const String& status,
    device_settings::ConnectionMode mode,
    bool confirmationRequired) {
  String out = "{\"kind\":\"connection-mode\",\"status\":\"";
  out += status;
  out += "\",\"deviceId\":\"";
  out += deviceID;
  out += "\",\"mode\":\"";
  out += device_settings::ConnectionModeName(mode);
  if (confirmationRequired) {
    out += "\",\"confirmationRequired\":true}";
  } else {
    out += "\"}";
  }
  Serial.println(out);
}

struct DeviceSettingsPatch {
  bool hasBrightness = false;
  int brightnessPercent = 0;
  bool hasStandbyEnabled = false;
  bool standbyEnabled = false;
  bool hasStandbyTimeout = false;
  int standbyTimeoutMinutes = 0;
  bool hasStandbyBrightness = false;
  int standbyBrightnessPercent = 0;
  bool hasScreensaverPath = false;
  String screensaverPath;
};

bool applyDeviceSettingsPatch(const DeviceSettingsPatch& patch, String& error);
String healthJSON();

bool handleSerialControlLine(const String& line) {
  JsonDocument doc;
  if (deserializeJson(doc, line)) {
    return false;
  }
  const char* kind = doc["kind"] | "";
  if (strcmp(kind, "request") != 0) {
    return false;
  }

  const char* op = doc["op"] | "";
  if (strncmp(op, "transfer-", 9) == 0) {
    return handleCableTransferRequest(doc, op);
  }
  if (strcmp(op, "hello") == 0) {
    codexbar_display::app::EmitDeviceHello(makeTransportConfig("usb"));
  } else if (strcmp(op, "status") == 0) {
    emitSerialStatus();
  } else if (strcmp(op, "health") == 0) {
    const char* expectedDeviceID = doc["deviceId"] | "";
    if (strcmp(expectedDeviceID, deviceID.c_str()) != 0 ||
        cableTransfer.flow.active || otaUploadInProgress ||
        assetUploadInProgress || rebootPending) {
      emitSerialError("health-rejected");
    } else {
      String out = "{\"kind\":\"health\",\"deviceId\":\"";
      out += deviceID;
      out += "\",\"health\":";
      out += healthJSON();
      out += "}";
      Serial.println(out);
    }
  } else if (strcmp(op, "pair") == 0) {
    const char* expectedDeviceID = doc["deviceId"] | "";
    if (strcmp(expectedDeviceID, deviceID.c_str()) != 0 ||
        cableTransfer.flow.active || otaUploadInProgress ||
        assetUploadInProgress || rebootPending) {
      emitSerialError("pairing-rejected");
    } else {
      const bool alreadyPaired = deviceAuthConfigured();
      const String token = alreadyPaired ? deviceAuthToken : generateAuthToken();
      if (!alreadyPaired && !saveDeviceAuthToken(token)) {
        emitSerialError("pairing-rejected");
      } else {
        emitSerialPairing(token);
      }
    }
  } else if (strcmp(op, "set-connection-mode") == 0) {
    const char* expectedDeviceID = doc["deviceId"] | "";
    const device_settings::ConnectionMode target =
        requestedConnectionMode(String(doc["mode"] | ""));
    String error;
    if (strcmp(expectedDeviceID, deviceID.c_str()) != 0) {
      error = "deviceId does not match";
    } else if (!beginConnectionTransition(target, error)) {
      // beginConnectionTransition supplies the customer-safe reason.
    }
    if (error.length() > 0) {
      emitSerialError("connection-mode-rejected");
    } else {
      emitSerialConnectionMode("switching", target, true);
      scheduleReboot("connection_mode_switch");
    }
  } else if (strcmp(op, "confirm-connection-mode") == 0) {
    String status;
    if (!confirmConnectionTransition(String(doc["deviceId"] | ""), status)) {
      emitSerialError("connection-mode-confirmation-rejected");
    } else {
      emitSerialConnectionMode(status, deviceSettings.connectionMode, false);
    }
  } else if (strcmp(op, "settings") == 0) {
    const char* expectedDeviceID = doc["deviceId"] | "";
    String error;
    bool rejected = strcmp(expectedDeviceID, deviceID.c_str()) != 0;
    const char* settingsKey = "settings";
    const JsonVariantConst settings = doc[settingsKey];
    if (!rejected && !settings.isNull()) {
      DeviceSettingsPatch patch;
      const char* brightnessPercent = "brightnessPercent";
      const JsonVariantConst brightness = settings[brightnessPercent];
      if (!brightness.isNull()) {
        patch.hasBrightness = true;
        patch.brightnessPercent = brightness.as<int>();
      }
      const char* standby = "standby";
      const JsonVariantConst standbyPatch = settings[standby];
      if (!standbyPatch.isNull()) {
        const char* enabled = "enabled";
        const JsonVariantConst standbyEnabled = standbyPatch[enabled];
        if (!standbyEnabled.isNull()) {
          patch.hasStandbyEnabled = true;
          patch.standbyEnabled = standbyEnabled.as<bool>();
        }
        const char* timeoutMinutes = "timeoutMinutes";
        const JsonVariantConst standbyTimeout = standbyPatch[timeoutMinutes];
        if (!standbyTimeout.isNull()) {
          patch.hasStandbyTimeout = true;
          patch.standbyTimeoutMinutes = standbyTimeout.as<int>();
        }
        const JsonVariantConst standbyBrightness = standbyPatch[brightnessPercent];
        if (!standbyBrightness.isNull()) {
          patch.hasStandbyBrightness = true;
          patch.standbyBrightnessPercent = standbyBrightness.as<int>();
        }
        const char* screensaverPath = "screensaverPath";
        const JsonVariantConst standbyScreensaver = standbyPatch[screensaverPath];
        if (!standbyScreensaver.isNull()) {
          patch.hasScreensaverPath = true;
          patch.screensaverPath = String(standbyScreensaver | "");
        }
      }
      rejected = !applyDeviceSettingsPatch(patch, error);
    }
    if (rejected) {
      emitSerialError("settings-rejected");
    } else {
      String out = "{\"kind\":\"settings\",\"deviceId\":\"";
      out += deviceID;
      out += "\",";
      appendSettingsJSON(out);
      out += "}";
      Serial.println(out);
    }
  } else if (strcmp(op, "configure-wifi") == 0) {
    const char* expectedDeviceID = doc["deviceId"] | "";
    String ssid = String(doc["ssid"] | "");
    const String password = String(doc["password"] | "");
    ssid.trim();
    String error;
    const device_settings::ConnectionMode target =
        device_settings::ConnectionMode::kWifi;
    bool rejected = strcmp(expectedDeviceID, deviceID.c_str()) != 0 ||
                    ssid.length() == 0 ||
                    ssid.length() >= kWifiSsidBytes ||
                    password.length() >= kWifiPasswordBytes ||
                    deviceSettings.connectionMode !=
                        device_settings::ConnectionMode::kCable;
    if (!rejected && !saveWifiCredentials(ssid, password)) {
      rejected = true;
    }
    if (!rejected && !beginConnectionTransition(target, error)) {
      rejected = true;
    }
    if (rejected) {
      emitSerialError("wifi-configuration-rejected");
    } else {
      emitSerialConnectionMode("switching", target, true);
      scheduleReboot("wifi_credentials_saved");
    }
  } else {
    emitSerialError("unsupported-request");
  }
  return true;
}

void handleSerialInput() {
  String line;
  if (!codexbar_display::app::ReadSerialLine(runtimeCtx, line)) {
    return;
  }
  if (handleSerialControlLine(line)) {
    return;
  }
  if (cableTransfer.flow.active) {
    emitSerialError("transfer-active");
    return;
  }
  if (!codexbar_display::esp8266::device_settings::SupportsCable(
          deviceSettings.connectionMode) ||
      deviceSettings.connectionMode !=
          codexbar_display::esp8266::device_settings::ConnectionMode::kCable) {
    return;
  }

  codexbar_display::core::SerialConsumeEvent event;
  if (codexbar_display::core::ConsumeFrameLine(
          runtimeCtx.runtime, line.c_str(), millis(), event) &&
      event.frameAccepted) {
    markFrameAccepted(event, "usb");
  }
}

bool isSafeAssetPath(const String& path) {
  return codexbar_display::esp8266::AssetPathPolicy::IsSafeSyntax(path.c_str(), path.length());
}

bool isMutableThemeAssetPath(const String& path) {
  return codexbar_display::esp8266::AssetPathPolicy::IsMutableThemeAsset(path.c_str(), path.length());
}

bool isLiveThemeSpecPath(const String& path) {
  return codexbar_display::esp8266::AssetPathPolicy::IsLiveThemeSpecPath(path.c_str(), path.length());
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
    if (!isMutableThemeAssetPath(path)) {
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

// Diagnostics for the reset countdown. There is no wall clock, so "last fresh"
// is reported as the age of the basis instead of a timestamp.
void appendResetTrustJSON(String& out) {
  namespace core = codexbar_display::core;
  const core::ResetTrustState& state = runtimeCtx.runtime.reset;
  const unsigned long now = millis();
  out += F("\"reset\":{\"trust\":\"");
  out += core::ResetTrustName(core::CurrentResetTrust(state, now));
  out += F("\",\"deadlineSecs\":");
  out += String(static_cast<long>(core::CurrentRemainingSecs(runtimeCtx.runtime, now)));
  out += F(",\"trustSecs\":");
  out += String(static_cast<long>(core::ResetTrustBudgetSecs(state, now)));
  out += F(",\"basisAgeSecs\":");
  out += String(static_cast<long>(core::ResetBasisAgeSecs(state, now)));
  out += F(",\"source\":");
  appendJSONNullableString(out, state.source);
  out += F("},");
}

String healthJSON() {
  const codexbar_display::esp8266::RendererHealthSnapshot snapshot = renderer.HealthSnapshot();

  String out;
  // Sized for the full payload: #280 added the clock block, #279 the reset
  // trust block and #284 the standby state, and growing this String mid-build
  // fragments a tight heap.
  out.reserve(1344);
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
  out += "},\"wifi\":{\"rssi\":";
  out += String(WiFi.RSSI());
  out += ",\"channel\":";
  out += String(WiFi.channel());
  out += ",\"phyMode\":\"";
  switch (WiFi.getPhyMode()) {
    case WIFI_PHY_MODE_11B: out += "11b"; break;
    case WIFI_PHY_MODE_11G: out += "11g"; break;
    default: out += "11n"; break;
  }
  out += "\",\"sleepMode\":\"";
  switch (WiFi.getSleepMode()) {
    case WIFI_NONE_SLEEP: out += "none"; break;
    case WIFI_LIGHT_SLEEP: out += "light"; break;
    default: out += "modem"; break;
  }
  out += "\"},";
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
  appendClockJSON(out);
  appendResetTrustJSON(out);
  appendStandbyStateJSON(out);
  out += ",";
  appendSettingsJSON(out);
  out += "}";

  (void)filesystemMounted;
  return out;
}

void handleHealth() {
  const String out = healthJSON();
  addCorsHeaders();
  webServer.send(200, "application/json", out);
}

// Records which stored ThemeSpec the screensaver slot points at. Loading it
// into the second render slot is the standby state machine's job; this only
// validates and stores the reference. An empty path clears the selection.
#if CODEXBAR_DISPLAY_THEME_SPEC_RENDERER
bool readValidatedStoredThemeSpec(
    const String& path,
    String& raw,
    String& themeId,
    int& themeRev,
    String& error);
#endif

bool setStandbyScreensaverPath(standby::Settings& target, const String& rawPath, String& error) {
  String path = rawPath;
  path.trim();
  if (path.length() == 0) {
    standby::ClearScreensaverPath(target);
    return true;
  }
  if (!isSafeAssetPath(path) ||
      !standby::ScreensaverPathValid(path.c_str(), path.length())) {
    error = "invalid screensaver path";
    return false;
  }
#if CODEXBAR_DISPLAY_THEME_SPEC_RENDERER
  String raw;
  String themeId;
  int themeRev = 0;
  if (!readValidatedStoredThemeSpec(path, raw, themeId, themeRev, error)) {
    if (error == "theme file not found") {
      error = "screensaver file not found";
    }
    return false;
  }
#else
  if (!LittleFS.begin()) {
    error = "filesystem mount failed";
    return false;
  }
  if (!LittleFS.exists(path)) {
    error = "screensaver file not found";
    return false;
  }
#endif
  if (!standby::SetScreensaverPath(target, path.c_str(), path.length())) {
    error = "invalid screensaver path";
    return false;
  }
  return true;
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

bool applyDeviceSettingsPatch(const DeviceSettingsPatch& patch, String& error) {
  DeviceSettings next = deviceSettings;
  bool changed = false;
  if (patch.hasBrightness) {
    next.brightnessPercent = clampBrightnessPercent(patch.brightnessPercent);
    changed = true;
  }
  if (patch.hasStandbyEnabled) {
    next.standby.enabled = patch.standbyEnabled;
    changed = true;
  }
  if (patch.hasStandbyTimeout) {
    next.standby.timeoutMinutes = standby::ClampTimeoutMinutes(patch.standbyTimeoutMinutes);
    changed = true;
  }
  if (patch.hasStandbyBrightness) {
    next.standby.brightnessPercent =
        standby::ClampBrightnessPercent(patch.standbyBrightnessPercent);
    changed = true;
  }
  if (patch.hasScreensaverPath) {
    if (!setStandbyScreensaverPath(next.standby, patch.screensaverPath, error)) {
      return false;
    }
    changed = true;
  }
  if (!changed) {
    error = "no settings supplied";
    return false;
  }
  if (!persistDeviceSettings(next)) {
    error = "save failed";
    return false;
  }
  return true;
}

void handleSettingsAPI() {
  addCorsHeaders();
  if (!requireWriteAuth()) {
    return;
  }
  const bool apiResponse = webServer.hasArg("api");
  DeviceSettingsPatch patch;
  if (webServer.hasArg("b")) {
    patch.hasBrightness = true;
    patch.brightnessPercent = webServer.arg("b").toInt();
  }
  if (webServer.hasArg("sb")) {
    patch.hasStandbyEnabled = true;
    patch.standbyEnabled = webServer.arg("sb").toInt() != 0;
  }
  if (webServer.hasArg("st")) {
    patch.hasStandbyTimeout = true;
    patch.standbyTimeoutMinutes = webServer.arg("st").toInt();
  }
  if (webServer.hasArg("sbr")) {
    patch.hasStandbyBrightness = true;
    patch.standbyBrightnessPercent = webServer.arg("sbr").toInt();
  }
  if (webServer.hasArg("ss")) {
    patch.hasScreensaverPath = true;
    patch.screensaverPath = webServer.arg("ss");
  }
  String error;
  if (!applyDeviceSettingsPatch(patch, error)) {
    webServer.send(error == "save failed" ? 500 : 400, "text/plain; charset=utf-8", error);
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
    if (otaUploadInProgress || assetUploadInProgress || rebootPending) {
      assetUploadSucceeded = false;
      assetUploadInProgress = true;
      assetUploadError = "another upload is active";
      return;
    }
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
    if (!isMutableThemeAssetPath(assetUploadPath)) {
      setAssetUploadError("invalid asset path");
      return;
    }
    if (assetUploadContentLengthWouldExceedLimits(upload)) {
      setAssetUploadError("gif asset too large");
      return;
    }
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

bool storedThemeSpecReferencesAsset(const String& themeSpecPath, const String& assetPath);

void handleAssetDelete() {
  if (!requireWriteAuth()) {
    return;
  }
  String path = webServer.arg("path");
  path.trim();
  if (!isMutableThemeAssetPath(path)) {
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
  // Every path that owns the screen, or holds the way back to it, protects the
  // assets its spec references and not just the spec file: a sprite deleted
  // while standby or the post-install preview is up comes back as a silent
  // hole on wake. Empty paths short-circuit inside
  // storedThemeSpecReferencesAsset, so the standby and preview lookups cost
  // nothing while neither holds the screen.
  const String configuredScreensaverPath(deviceSettings.standby.screensaverPath);
  if (path == activeThemeSpecPath || path == standbyLiveThemePath ||
      path == screensaverPreviewLivePath ||
      path == configuredScreensaverPath ||
      storedThemeSpecReferencesAsset(configuredScreensaverPath, path) ||
      storedThemeSpecReferencesAsset(activeThemeSpecPath, path) ||
      storedThemeSpecReferencesAsset(standbyLiveThemePath, path) ||
      storedThemeSpecReferencesAsset(screensaverPreviewLivePath, path)) {
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
  return isLiveThemeSpecPath(path);
}

bool saveActiveThemeSpecPath(const String& path) {
  if (!isLiveThemeSpecPath(path)) {
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

  // Devices upgraded from 1.0.36 can still have this explicitly active Mini
  // spec. Keep its label compatibility without treating it as a boot fallback.
  if (path == kLegacyMiniThemeSpecPath) {
    raw.replace("\"v\":\"left\"", "\"v\":\"{usageMode}\"");
  }
  if (raw.length() == 0 || raw.length() > kMaxStoredThemeSpecBytes) {
    error = "theme file too large";
    return false;
  }
  return true;
}

bool themeSpecMetadata(const String& raw, String& themeId, int& themeRev, String& error) {
  JsonDocument filter;
  filter["themeId"] = true;
  filter["id"] = true;
  filter["themeRev"] = true;
  filter["rev"] = true;

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

  return true;
}

bool prepareStoredThemeSpec(
    const String& raw,
    const String& themeId,
    int themeRev,
    codexbar_display::core::RuntimeState& nextRuntime,
    codexbar_display::core::SerialConsumeEvent& event) {
  nextRuntime = runtimeCtx.runtime;
  return codexbar_display::core::RestoreStoredThemeSpecFrame(
      nextRuntime, themeId, themeRev, raw, millis(), event);
}

void commitStoredThemeSpec(
    const String& path,
    const String& raw,
    const codexbar_display::core::RuntimeState& nextRuntime,
    const codexbar_display::core::SerialConsumeEvent& event) {
  runtimeCtx.runtime = nextRuntime;
  renderer.ResetGifStateForAssetUpdate();
  activeThemeSpecPath = path;
  activeThemeSpecHash = hashHex8(raw);
  markFrameAccepted(event, "theme");
}

bool readValidatedStoredThemeSpec(
    const String& path,
    String& raw,
    String& themeId,
    int& themeRev,
    String& error) {
  if (!readStoredThemeSpec(path, raw, error)) {
    return false;
  }
  if (!themeSpecMetadata(raw, themeId, themeRev, error)) {
    return false;
  }
  JsonDocument doc;
  codexbar_display::themespec::CompiledThemeSpec scene;
  const bool renderable = codexbar_display::themespec::CompileThemeSpec(raw.c_str(), doc, scene);
  codexbar_display::themespec::ReleaseCompiledThemeSpec(scene);
  if (!renderable) {
    error = "theme spec has no renderable content";
    return false;
  }
  return true;
}

void activateStoredThemeSpec(const String& path, const String& raw, const String& themeId, int themeRev) {
  codexbar_display::core::SerialConsumeEvent event;
  if (!codexbar_display::core::RestoreStoredThemeSpecFrame(
          runtimeCtx.runtime, themeId, themeRev, raw, millis(), event)) {
    return;
  }
  renderer.ResetGifStateForAssetUpdate();
  activeThemeSpecPath = path;
  activeThemeSpecHash = hashHex8(raw);
  markFrameAccepted(event, "theme");
}

// `persist` is false for standby transitions: the customer's live theme choice
// must survive the screensaver, and a flash write per transition would be wear
// for nothing.
bool activateStoredThemePath(
    const String& path, bool persist, String& themeId, int& themeRev, String& error) {
  String raw;
  if (!readValidatedStoredThemeSpec(path, raw, themeId, themeRev, error)) {
    return false;
  }
  codexbar_display::core::RuntimeState nextRuntime;
  codexbar_display::core::SerialConsumeEvent event;
  if (!prepareStoredThemeSpec(raw, themeId, themeRev, nextRuntime, event)) {
    error = "theme spec not renderable";
    return false;
  }
  if (persist && !saveActiveThemeSpecPath(path)) {
    error = "save active theme failed";
    return false;
  }
  commitStoredThemeSpec(path, raw, nextRuntime, event);
  return true;
}

bool renderStoredThemeSpecForStandby(const String& path) {
  String themeId;
  int themeRev = 0;
  String error;
  if (activateStoredThemePath(path, false, themeId, themeRev, error)) {
    return true;
  }
  Serial.printf("standby_load_failed path=%s err=%s\n", path.c_str(), error.c_str());
  return false;
}

#endif

bool storedThemeSpecReferencesAsset(const String& themeSpecPath, const String& assetPath) {
#if CODEXBAR_DISPLAY_THEME_SPEC_RENDERER
  if (themeSpecPath.length() == 0 || assetPath.length() == 0) {
    return false;
  }
  String raw;
  String error;
  if (!readStoredThemeSpec(themeSpecPath, raw, error)) {
    return false;
  }
  JsonDocument doc;
  codexbar_display::themespec::CompiledThemeSpec scene;
  const bool compiled = codexbar_display::themespec::CompileThemeSpec(raw.c_str(), doc, scene);
  const bool referenced = compiled &&
      codexbar_display::themespec::CompiledThemeSpecReferencesAsset(scene, assetPath.c_str());
  codexbar_display::themespec::ReleaseCompiledThemeSpec(scene);
  return referenced;
#else
  (void)themeSpecPath;
  (void)assetPath;
  return false;
#endif
}

#if CODEXBAR_DISPLAY_THEME_SPEC_RENDERER
bool findObsoleteThemeSlotAsset(
    const String& directory,
    const String& slotPrefix,
    const String& activeSpecPath,
    const codexbar_display::themespec::CompiledThemeSpec& scene,
    String& obsoletePath,
    uint8_t depth) {
  if (depth > 4) {
    return false;
  }
  Dir dir = LittleFS.openDir(directory);
  while (dir.next()) {
    const String path = normalizedAssetListPath(directory, dir.fileName());
    if (dir.isDirectory()) {
      if (findObsoleteThemeSlotAsset(
              path, slotPrefix, activeSpecPath, scene, obsoletePath, depth + 1)) {
        return true;
      }
      continue;
    }
    if (path.startsWith(slotPrefix) && path != activeSpecPath &&
        !codexbar_display::themespec::CompiledThemeSpecReferencesAsset(
            scene, path.c_str())) {
      obsoletePath = path;
      return true;
    }
  }
  return false;
}

// Cable owns the whole install while the serial port is locked, so the device
// can safely sweep the selected slot immediately after activation. Finding one
// file per pass lets the directory iterator go out of scope before removal.
void cleanupCableThemeSlot(
    const String& activeSpecPath,
    CableTransferActivation activation) {
  if (activation == CableTransferActivation::kNone || !LittleFS.begin()) {
    return;
  }
  if (activation == CableTransferActivation::kScreensaver &&
      (standbyState.active || screensaverPreviewState.showing)) {
    return;
  }
  String raw;
  String error;
  JsonDocument doc;
  codexbar_display::themespec::CompiledThemeSpec scene;
  if (!readStoredThemeSpec(activeSpecPath, raw, error) ||
      !codexbar_display::themespec::CompileThemeSpec(raw.c_str(), doc, scene)) {
    codexbar_display::themespec::ReleaseCompiledThemeSpec(scene);
    return;
  }
  const String slotPrefix = activation == CableTransferActivation::kScreensaver
      ? "/themes/s/"
      : "/themes/u/";
  const String slotDirectory = slotPrefix.substring(0, slotPrefix.length() - 1);

  if (activation == CableTransferActivation::kTheme &&
      LittleFS.exists(kLegacyMiniGIFPath) &&
      !codexbar_display::themespec::CompiledThemeSpecReferencesAsset(
          scene, kLegacyMiniGIFPath)) {
    LittleFS.remove(kLegacyMiniGIFPath);
  }

  while (true) {
    String obsoletePath;
    if (!findObsoleteThemeSlotAsset(
            slotDirectory, slotPrefix, activeSpecPath, scene, obsoletePath, 0)) {
      break;
    }
    if (!LittleFS.remove(obsoletePath)) {
      break;
    }
    ESP.wdtFeed();
  }
  codexbar_display::themespec::ReleaseCompiledThemeSpec(scene);
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
  if (!activateStoredThemePath(path, true, themeId, themeRev, error)) {
    addCorsHeaders();
    webServer.send(error == "theme file not found" ? 404 : 400, "text/plain; charset=utf-8", error);
    return;
  }
  // The customer just picked the live theme, so it is now the screen standby
  // has to hand back — and standby ends here rather than dimming that choice.
  // A running preview loses its claim with it: the newly activated theme is
  // already on screen, so there is nothing to restore, and its deadline must
  // not repaint the previously captured theme over this choice.
  screensaver_preview::Cancel(screensaverPreviewState);
  screensaverPreviewLivePath = "";
  standbyLiveThemePath = "";
  standbyState.active = false;
  standby::NoteUsageActivity(standbyState, millis());
  applyDeviceSettings();

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

// Selects which stored ThemeSpec the screensaver slot points at. Mirrors the
// /theme/active contract but touches a different, independent slot: it never
// changes the live theme and never renders anything. Standby rendering is the
// state machine's job.
void handleScreensaverActive() {
#if CODEXBAR_DISPLAY_THEME_SPEC_RENDERER
  addCorsHeaders();
  if (!requireWriteAuth()) {
    return;
  }
  String body = webServer.arg("plain");
  body.trim();
  if (body.length() == 0 || body.length() > 160) {
    webServer.send(400, "text/plain; charset=utf-8", "invalid screensaver activation body");
    return;
  }

  JsonDocument doc;
  const DeserializationError err = deserializeJson(doc, body);
  if (err) {
    webServer.send(400, "text/plain; charset=utf-8", "bad screensaver activation json");
    return;
  }
  String path = String(doc["path"] | "");
  path.trim();

  DeviceSettings next = deviceSettings;
  String error;
  if (!setStandbyScreensaverPath(next.standby, path, error)) {
    webServer.send(error == "screensaver file not found" ? 404 : 400,
                   "text/plain; charset=utf-8", error);
    return;
  }
  if (!persistDeviceSettings(next)) {
    webServer.send(500, "text/plain; charset=utf-8", "save failed");
    return;
  }
  // Never rendered here: ESP8266WebServer runs handlers inside handleClient(),
  // where display work does not belong. The loop shows the preview.
  //
  // Clearing the slot is deliberately NOT cancelled here. An install clears the
  // selection before it overwrites the pack's files, and cancelling would drop
  // `showing` — the loop could then never hand the screen back, leaving the
  // screensaver up while its files are rewritten. Left alone, the empty slot
  // reads as a veto in maintainScreensaverPreview, which restores properly.
  if (standby::HasScreensaver(deviceSettings.standby)) {
    screensaver_preview::NoteSelection(screensaverPreviewState);
  }

  String out;
  out.reserve(120);
  out += "{\"ok\":true,\"path\":";
  if (standby::HasScreensaver(deviceSettings.standby)) {
    out += "\"";
    out += jsonEscape(String(deviceSettings.standby.screensaverPath));
    out += "\"";
  } else {
    out += "null";
  }
  out += "}";
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
  if (!themeSpecMetadata(raw, themeId, themeRev, error)) {
    Serial.printf("theme_cache_load_failed path=%s err=%s\n", path.c_str(), error.c_str());
    return false;
  }

  activateStoredThemeSpec(path, raw, themeId, themeRev);
  Serial.printf("theme_cache_loaded path=%s id=%s rev=%d\n", path.c_str(), themeId.c_str(), themeRev);
  return true;
}

void loadActiveStoredThemeSpecCache() {
  String activePath;
  if (!readActiveThemeSpecPath(activePath)) {
    return;
  }
  (void)loadStoredThemeSpecCacheFromPath(activePath);
}

// Standby only takes a screen it can hand back. Setup and error frames stay
// where they are, and without a stored live theme there would be no way home.
// The connected "Open App" screen is intentionally not a veto: replacing it
// while the Mac is off is the screensaver's main job.
bool standbyReady() {
  return !setupMode &&
         !codexbar_display::app::CurrentFrame(runtimeCtx).hasError &&
         activeThemeSpecPath.length() > 0;
}

// Hands the screen back to the theme a screensaver preview replaced and drops
// the captured path. Rendering is skipped when that theme is already up.
void restoreScreensaverPreviewLiveTheme() {
  if (screensaverPreviewLivePath.length() > 0 &&
      screensaverPreviewLivePath != activeThemeSpecPath) {
    renderStoredThemeSpecForStandby(screensaverPreviewLivePath);
  }
  screensaverPreviewLivePath = "";
}
#endif

// Shows a freshly selected screensaver once, for a bounded moment, then hands
// the screen back to the live theme. Decided in the loop, never in an HTTP
// handler, mirroring maintainStandby. The loaded spec keeps receiving live
// field updates while it is up — same contract as standby rendering.
void maintainScreensaverPreview() {
#if CODEXBAR_DISPLAY_THEME_SPEC_RENDERER
  const bool hasError = codexbar_display::app::HasFrame(runtimeCtx) &&
                        codexbar_display::app::CurrentFrame(runtimeCtx).hasError;
  const bool statusSurfaceVisible = setupMode || waitStatusRendered;
  const String screensaverPath(deviceSettings.standby.screensaverPath);
  // "Already on screen" only means "nothing to preview" BEFORE the preview
  // owns the display: once it does, activeThemeSpecPath points at the
  // screensaver itself and must not veto its own preview.
  const bool selectionUnpreviewable =
      screensaverPath.length() == 0 || activeThemeSpecPath.length() == 0 ||
      (!screensaverPreviewState.showing &&
       screensaverPath == activeThemeSpecPath);
  // Standby, error frames, and setup/status surfaces own the display and share
  // one deferred way back: standbyLiveThemePath, which maintainStandby paints
  // as soon as the blocker clears. Repainting the live theme here instead
  // would erase the screen they just took.
  const bool blockerOwnsDisplay =
      standbyState.active || hasError || statusSurfaceVisible;
  // A disabled screensaver toggle is a customer promise: nothing screensaver-
  // shaped appears, so it also vetoes (and, while showing, immediately ends)
  // the post-install preview.
  const bool blocked = !deviceSettings.standby.enabled || blockerOwnsDisplay ||
                       selectionUnpreviewable;
  const screensaver_preview::Action action = screensaver_preview::Tick(
      screensaverPreviewState, blocked, millis());
  if (action == screensaver_preview::Action::Show) {
    // A reselection mid-preview keeps the first captured path: by now
    // activeThemeSpecPath is the screensaver that is being previewed.
    const String livePath = screensaverPreviewLivePath.length() > 0
                                ? screensaverPreviewLivePath
                                : activeThemeSpecPath;
    if (renderStoredThemeSpecForStandby(screensaverPath)) {
      screensaverPreviewLivePath = livePath;
      Serial.printf("screensaver_preview shown path=%s\n", screensaverPath.c_str());
    } else {
      // Nothing new is on screen, but a preview replacing another one still
      // holds a live theme that has to come back.
      screensaver_preview::Cancel(screensaverPreviewState);
      restoreScreensaverPreviewLiveTheme();
    }
  } else if (action == screensaver_preview::Action::Restore) {
    Serial.printf("screensaver_preview restored path=%s\n", screensaverPreviewLivePath.c_str());
    if (blockerOwnsDisplay) {
      standbyLiveThemePath = screensaverPreviewLivePath;
      screensaverPreviewLivePath = "";
    } else {
      restoreScreensaverPreviewLiveTheme();
    }
  }
#endif
}

// Decided in the loop, never in an HTTP handler: ESP8266WebServer runs those
// inside handleClient(), where display work does not belong.
void maintainStandby() {
#if CODEXBAR_DISPLAY_THEME_SPEC_RENDERER
  const unsigned long nowMs = millis();
  const bool hasError = codexbar_display::app::HasFrame(runtimeCtx) &&
                        codexbar_display::app::CurrentFrame(runtimeCtx).hasError;
  // Setup instructions and status screens behave like error frames here: a
  // customer looking at WiFi setup must never have it replaced by the saved
  // live theme. The path is kept, so the deferred restore below runs as soon
  // as the surface clears.
  const bool statusSurfaceVisible = setupMode || waitStatusRendered;
  if (!standbyState.active && !hasError && !statusSurfaceVisible &&
      standbyLiveThemePath.length() > 0) {
    if (standbyLiveThemePath == activeThemeSpecPath ||
        renderStoredThemeSpecForStandby(standbyLiveThemePath)) {
      standbyLiveThemePath = "";
    }
  }
  const standby::Transition transition =
      standby::Tick(standbyState, deviceSettings.standby, standbyReady(), nowMs);
  if (transition == standby::Transition::None) {
    return;
  }
  if (transition == standby::Transition::Enter) {
    const String livePath = activeThemeSpecPath;
    const String screensaverPath(deviceSettings.standby.screensaverPath);
    // Selecting the live theme as the screensaver only changes brightness.
    // Reloading the identical ThemeSpec would schedule a redundant full render
    // and can starve the ESP8266 Wi-Fi stack long enough to trip its watchdog.
    if (screensaverPath != livePath && !renderStoredThemeSpecForStandby(screensaverPath)) {
      // A deleted screensaver must not dim the panel or reopen the file every
      // loop. Sit out another full timeout before trying again.
      standbyState.active = false;
      standby::NoteUsageActivity(standbyState, nowMs);
      return;
    }
    standbyLiveThemePath = livePath;
  } else {
    // An error frame or a setup/status surface caused this exit and must
    // remain visible. Restoring the saved live ThemeSpec here would overwrite
    // it before the customer has seen it.
    if (!hasError && !statusSurfaceVisible && standbyLiveThemePath.length() > 0 &&
        standbyLiveThemePath != activeThemeSpecPath) {
      renderStoredThemeSpecForStandby(standbyLiveThemePath);
    }
    if (!hasError && !statusSurfaceVisible) {
      standbyLiveThemePath = "";
    }
  }
  applyDeviceSettings();
  Serial.printf("standby active=%d\n", standbyState.active ? 1 : 0);
#endif
}


void handleUpdatePage() {
  webServer.keepAlive(false);
  webServer.send(
      200,
      "text/html; charset=utf-8",
      F("<!doctype html><meta name='viewport' content='width=device-width,initial-scale=1'><title>VibeTV Update</title><h1>VibeTV Update</h1><p>Open the VibeTV App on your Mac to check and install updates.</p><p><a href='/'>Back</a></p>"));
}

void setOtaError(const String& message) {
  otaUploadError = message;
  Serial.printf("ota_error message=%s\n", otaUploadError.c_str());
  if (Update.hasError()) {
    Update.printError(Serial);
  }
}

void resetOtaUpdaterAfterFailure() {
  if (Update.isRunning()) {
    Update.end(false);
  }
  Update.clearError();
}

size_t otaMaxSizeForCommand(int command) {
  if (command == U_FS) {
    return static_cast<size_t>(FS_end - FS_start);
  }
  return static_cast<size_t>((ESP.getFreeSketchSpace() - 0x1000) & 0xFFFFF000);
}

void enterOtaSafeMode(int command, WiFiClient* otaClient) {
  (void)command;
  firmwareUpdateNoticeDirty = false;
  frameStaleStatusRendered = false;
  renderer.ResetGifStateForAssetUpdate();
  close_all_fs();
  WiFiUDP::stopAll();
  if (otaClient != nullptr) {
    WiFiClient::stopAllExcept(otaClient);
  } else {
    WiFiClient::stopAll();
  }
  WiFi.setSleepMode(WIFI_NONE_SLEEP);
  ESP.wdtFeed();
}

void handleOtaUpload(int command, const char* target) {
  HTTPUpload& upload = webServer.upload();

  if (upload.status == UPLOAD_FILE_START) {
    if (assetUploadInProgress || otaUploadInProgress || rebootPending) {
      otaUploadSucceeded = false;
      otaUploadInProgress = true;
      otaUploadNeedsReboot = false;
      otaUploadError = "another upload is active";
      return;
    }
    otaUploadSucceeded = false;
    otaUploadInProgress = true;
    otaUploadNeedsReboot = false;
    otaUploadError = "";
    const size_t maxSize = otaMaxSizeForCommand(command);
    Serial.printf(
        "ota_upload_start target=%s filename=%s content_length=%zu max_size=%zu free_sketch_space=%zu\n",
        target,
        upload.filename.c_str(),
        upload.contentLength,
        maxSize,
        ESP.getFreeSketchSpace());
    if (!requestHasValidOtaAuth()) {
      setOtaError("unauthorized");
      return;
    }
    enterOtaSafeMode(command, &webServer.client());
    otaUploadNeedsReboot = true;
    const String targetLabel = command == U_FS ? "Loading display" : "Loading firmware";
    drawUpdateStatus(targetLabel);
    waitStatusRendered = true;
    if (!Update.begin(maxSize, command)) {
      setOtaError(Update.getErrorString());
      resetOtaUpdaterAfterFailure();
    }
  } else if (upload.status == UPLOAD_FILE_WRITE) {
    if (otaUploadError.length() == 0 && Update.write(upload.buf, upload.currentSize) != upload.currentSize) {
      setOtaError(Update.getErrorString());
      resetOtaUpdaterAfterFailure();
    }
    ESP.wdtFeed();
  } else if (upload.status == UPLOAD_FILE_END) {
    if (otaUploadError.length() == 0 && Update.end(true)) {
      otaUploadSucceeded = true;
      Serial.printf("ota_upload_success target=%s bytes=%zu\n", target, upload.totalSize);
    } else if (otaUploadError.length() == 0) {
      setOtaError(Update.getErrorString());
      resetOtaUpdaterAfterFailure();
    }
  } else if (upload.status == UPLOAD_FILE_ABORTED) {
    setOtaError("upload aborted");
    resetOtaUpdaterAfterFailure();
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
    otaUploadNeedsReboot = false;
    addCorsHeaders();
    webServer.sendHeader("WWW-Authenticate", "VibeTV token");
    webServer.send(401, "text/plain; charset=utf-8", "pairing token required");
    return;
  }
  if (!otaUploadSucceeded || otaUploadError.length() > 0 || Update.hasError()) {
    otaUploadInProgress = false;
    const String error = otaUploadError.length() > 0 ? otaUploadError : Update.getErrorString();
    Serial.printf("ota_upload_failed target=%s error=%s\n", target, error.c_str());
    webServer.send(500, "text/plain; charset=utf-8", "Update failed: " + error);
    if (otaUploadNeedsReboot) {
      scheduleReboot("ota_failure");
    }
    otaUploadNeedsReboot = false;
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
  scheduleReboot(target);
  otaUploadInProgress = false;
  otaUploadNeedsReboot = false;
}

int hexNibble(char value) {
  if (value >= '0' && value <= '9') {
    return value - '0';
  }
  if (value >= 'a' && value <= 'f') {
    return value - 'a' + 10;
  }
  if (value >= 'A' && value <= 'F') {
    return value - 'A' + 10;
  }
  return -1;
}

bool decodeTransferHash(const char* encoded, uint8_t* out) {
  constexpr size_t kHashBytes = 16;
  if (encoded == nullptr || out == nullptr || strlen(encoded) != kHashBytes * 2) {
    return false;
  }
  for (size_t i = 0; i < kHashBytes; ++i) {
    const int high = hexNibble(encoded[i * 2]);
    const int low = hexNibble(encoded[i * 2 + 1]);
    if (high < 0 || low < 0) {
      return false;
    }
    out[i] = static_cast<uint8_t>((high << 4) | low);
  }
  return true;
}

uint32_t chunkChecksum(const uint8_t* data, size_t length) {
  MD5Builder context;
  uint8_t digest[16];
  context.begin();
  context.add(data, static_cast<uint16_t>(length));
  context.calculate();
  context.getBytes(digest);
  return (static_cast<uint32_t>(digest[0]) << 24) |
         (static_cast<uint32_t>(digest[1]) << 16) |
         (static_cast<uint32_t>(digest[2]) << 8) |
         static_cast<uint32_t>(digest[3]);
}

bool parseChunkChecksum(const char* encoded, uint32_t& checksum) {
  if (encoded == nullptr || strlen(encoded) != 8) {
    return false;
  }
  checksum = 0;
  for (size_t i = 0; i < 8; ++i) {
    const int nibble = hexNibble(encoded[i]);
    if (nibble < 0) {
      return false;
    }
    checksum = (checksum << 4) | static_cast<uint32_t>(nibble);
  }
  return true;
}

void emitCableTransferReply(const char* status) {
  String out = "{\"kind\":\"transfer\",\"status\":\"";
	out += status;
	out += "\",\"next\":";
	out += String(cableTransfer.flow.nextSequence);
  out += "}";
  Serial.println(out);
}

void resetCableTransfer(bool discard) {
	if (!cableTransfer.flow.active) {
    return;
  }
  if (cableTransfer.sink == CableTransferSink::kAsset) {
    if (assetUploadFile) {
      assetUploadFile.close();
    }
    if (discard) {
      discardPartialAssetUpload();
    }
    finishAssetUploadRequest();
    assetUploadSucceeded = false;
  } else if (cableTransfer.sink == CableTransferSink::kFirmware) {
    if (discard) {
      resetOtaUpdaterAfterFailure();
    }
    otaUploadInProgress = false;
    otaUploadNeedsReboot = false;
    otaUploadSucceeded = false;
  }
  cableTransfer = CableTransferState{};
}

bool startCableTransfer(JsonDocument& doc) {
  const char* expectedDeviceID = doc["deviceId"] | "";
  const char* token = doc["token"] | "";
  const char* sink = doc["sink"] | "";
  const char* activation = doc["activate"] | "";
  const char* expectedHash = doc["hash"] | "";
	const int expectedBytesValue = doc["bytes"] | 0;
	const size_t expectedBytes = expectedBytesValue > 0
	    ? static_cast<size_t>(expectedBytesValue)
	    : 0;
  String destination = String(doc["path"] | "");
  destination.trim();
	if (cableTransfer.flow.active || otaUploadInProgress || assetUploadInProgress ||
      rebootPending || strcmp(expectedDeviceID, deviceID.c_str()) != 0 ||
      !deviceAuthConfigured() || strcmp(token, deviceAuthToken.c_str()) != 0 ||
      expectedBytes == 0) {
    emitSerialError("transfer-rejected");
    return true;
  }

  CableTransferSink target = CableTransferSink::kNone;
  CableTransferActivation targetActivation = CableTransferActivation::kNone;
  if (strcmp(sink, "asset") == 0 && isMutableThemeAssetPath(destination)) {
    target = CableTransferSink::kAsset;
    if (activation[0] == '\0') {
      targetActivation = CableTransferActivation::kNone;
    } else if (strcmp(activation, "theme") == 0) {
      targetActivation = CableTransferActivation::kTheme;
    } else if (strcmp(activation, "screensaver") == 0) {
      targetActivation = CableTransferActivation::kScreensaver;
    } else {
      target = CableTransferSink::kNone;
    }
  } else if (strcmp(sink, "firmware") == 0 &&
             activation[0] == '\0' &&
             expectedBytes <= otaMaxSizeForCommand(U_FLASH)) {
    target = CableTransferSink::kFirmware;
  }
  uint8_t expectedDigest[16];
  if (target == CableTransferSink::kNone ||
      !decodeTransferHash(expectedHash, expectedDigest)) {
    emitSerialError("transfer-rejected");
    return true;
  }

  codexbar_display::esp8266::cable_transfer::Begin(
      cableTransfer.flow, expectedBytes, millis());
  cableTransfer.sink = target;
  cableTransfer.activation = targetActivation;
  memcpy(cableTransfer.expectedHash, expectedDigest, sizeof(expectedDigest));
  cableTransfer.hash.begin();

  if (target == CableTransferSink::kAsset) {
    assetUploadSucceeded = false;
    assetUploadInProgress = true;
    assetUploadError = "";
    assetUploadPath = destination;
    assetUploadBytesSeen = 0;
    enterAssetUploadSafeMode();
    if ((assetPathLooksGif(assetUploadPath) &&
         expectedBytes > kMaxThemeGifAssetBytes) ||
        !LittleFS.begin() ||
        !ensureAssetParentDirs(assetUploadPath) ||
        (LittleFS.exists(kAssetUploadTemporaryPath) &&
         !LittleFS.remove(kAssetUploadTemporaryPath))) {
      resetCableTransfer(true);
      emitSerialError("transfer-rejected");
      return true;
    }
    assetUploadFile = LittleFS.open(kAssetUploadTemporaryPath, "w");
    if (!assetUploadFile) {
      resetCableTransfer(true);
      emitSerialError("transfer-rejected");
      return true;
    }
  } else {
    otaUploadSucceeded = false;
    otaUploadInProgress = true;
    otaUploadNeedsReboot = true;
    otaUploadError = "";
    enterOtaSafeMode(U_FLASH, nullptr);
    drawUpdateStatus("Loading firmware");
    waitStatusRendered = true;
    if (!Update.begin(expectedBytes, U_FLASH)) {
      resetCableTransfer(true);
      emitSerialError("transfer-rejected");
      return true;
    }
  }
  emitCableTransferReply("ready");
  return true;
}

bool writeCableTransferChunk(JsonDocument& doc) {
  const int sequence = doc["seq"] | -1;
  const char* encoded = doc["data"] | "";
  const char* encodedChecksum = doc["checksum"] | "";
  uint32_t expectedChecksum = 0;
  if (!cableTransfer.flow.active ||
      !parseChunkChecksum(encodedChecksum, expectedChecksum)) {
    emitSerialError("transfer-rejected");
    return true;
  }
  const size_t encodedBytes = strlen(encoded);
  if (encodedBytes == 0 || encodedBytes > kCableTransferChunkBytes * 2 ||
      encodedBytes % 2 != 0) {
    emitSerialError("transfer-rejected");
    return true;
  }

  uint8_t decoded[kCableTransferChunkBytes];
  const size_t decodedBytes = encodedBytes / 2;
  for (size_t i = 0; i < decodedBytes; ++i) {
    const int high = hexNibble(encoded[i * 2]);
    const int low = hexNibble(encoded[i * 2 + 1]);
    if (high < 0 || low < 0) {
      emitSerialError("transfer-rejected");
      return true;
    }
    decoded[i] = static_cast<uint8_t>((high << 4) | low);
  }
  const auto decision = codexbar_display::esp8266::cable_transfer::CheckChunk(
      cableTransfer.flow,
      sequence,
      decodedBytes,
      expectedChecksum,
      chunkChecksum(decoded, decodedBytes));
  if (decision == codexbar_display::esp8266::cable_transfer::ChunkDecision::kDuplicate) {
    emitCableTransferReply("chunk");
    return true;
  }
  if (decision != codexbar_display::esp8266::cable_transfer::ChunkDecision::kAccept) {
    emitSerialError("transfer-rejected");
    return true;
  }

  const size_t bytes = decodedBytes;
  bool wrote = false;
  if (cableTransfer.sink == CableTransferSink::kAsset) {
    wrote = assetUploadFile && assetUploadFile.write(decoded, bytes) == bytes;
    assetUploadBytesSeen += wrote ? bytes : 0;
  } else if (cableTransfer.sink == CableTransferSink::kFirmware) {
    wrote = Update.write(decoded, bytes) == bytes;
  }
  if (!wrote) {
    resetCableTransfer(true);
    emitSerialError("transfer-rejected");
    return true;
  }

  cableTransfer.hash.add(decoded, static_cast<uint16_t>(bytes));
  codexbar_display::esp8266::cable_transfer::AcceptChunk(
      cableTransfer.flow, bytes, expectedChecksum, millis());
  ESP.wdtFeed();
  emitCableTransferReply("chunk");
  return true;
}

bool finishCableTransfer(JsonDocument& doc) {
  if (!cableTransfer.flow.active) {
    emitSerialError("transfer-rejected");
    return true;
  }
  uint8_t actualDigest[16];
  cableTransfer.hash.calculate();
  cableTransfer.hash.getBytes(actualDigest);
  if (!codexbar_display::esp8266::cable_transfer::CanFinish(
          cableTransfer.flow,
          memcmp(actualDigest, cableTransfer.expectedHash, sizeof(actualDigest)) == 0)) {
    resetCableTransfer(true);
    emitSerialError("transfer-rejected");
    return true;
  }

  bool committed = false;
  if (cableTransfer.sink == CableTransferSink::kAsset) {
    assetUploadFile.flush();
    assetUploadFile.close();
    committed = validateCompletedAssetUpload() && promoteCompletedAssetUpload();
    if (committed && cableTransfer.activation == CableTransferActivation::kTheme) {
      String themeID;
      String error;
      int themeRevision = 0;
      committed = activateStoredThemePath(
          assetUploadPath, true, themeID, themeRevision, error);
      if (committed) {
        screensaver_preview::Cancel(screensaverPreviewState);
        screensaverPreviewLivePath = "";
        standbyLiveThemePath = "";
        standbyState.active = false;
        standby::NoteUsageActivity(standbyState, millis());
        applyDeviceSettings();
      }
    } else if (committed &&
               cableTransfer.activation == CableTransferActivation::kScreensaver) {
      DeviceSettings next = deviceSettings;
      String error;
      committed = setStandbyScreensaverPath(next.standby, assetUploadPath, error) &&
                  persistDeviceSettings(next);
      if (committed) {
        screensaver_preview::NoteSelection(screensaverPreviewState);
      }
    }
    assetUploadSucceeded = committed;
#if CODEXBAR_DISPLAY_THEME_SPEC_RENDERER
    if (committed && cableTransfer.activation != CableTransferActivation::kNone) {
      cleanupCableThemeSlot(assetUploadPath, cableTransfer.activation);
    }
#endif
  } else if (cableTransfer.sink == CableTransferSink::kFirmware) {
    committed = Update.end(false);
    otaUploadSucceeded = committed;
  }
  if (!committed) {
    resetCableTransfer(true);
    emitSerialError("transfer-rejected");
    return true;
  }

  const CableTransferSink completedSink = cableTransfer.sink;
  emitCableTransferReply("complete");
  if (completedSink == CableTransferSink::kAsset) {
    finishAssetUploadRequest();
  } else {
    otaUploadInProgress = false;
    otaUploadNeedsReboot = false;
    cableTransfer = CableTransferState{};
    Serial.flush();
    delay(100);
    persistResetTrustForRestart();
    ESP.restart();
    return true;
  }
  cableTransfer = CableTransferState{};
  return true;
}

bool handleCableTransferRequest(JsonDocument& doc, const char* op) {
  if (strcmp(op, "transfer-start") == 0) {
    return startCableTransfer(doc);
  }
  if (strcmp(op, "transfer-chunk") == 0) {
    return writeCableTransferChunk(doc);
  }
  if (strcmp(op, "transfer-finish") == 0) {
    return finishCableTransfer(doc);
  }
  if (strcmp(op, "transfer-abort") == 0) {
    if (cableTransfer.flow.active) {
      resetCableTransfer(true);
      emitCableTransferReply("aborted");
      cableTransfer = CableTransferState{};
    } else {
      emitSerialError("transfer-rejected");
    }
    return true;
  }
  emitSerialError("unsupported-request");
  return true;
}

void maintainCableTransfer() {
  if (codexbar_display::esp8266::cable_transfer::Expired(
          cableTransfer.flow, millis(), kCableTransferTimeoutMs)) {
    resetCableTransfer(true);
  }
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
  if (!codexbar_display::core::ConsumeFrameLine(runtimeCtx.runtime, body.c_str(), millis(), event) ||
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
  webServer.on("/scan", HTTP_POST, handleSetupWifiScan);
  webServer.on("/reset-wifi", HTTP_POST, handleResetWifi);
  webServer.on("/hello", HTTP_GET, handleHello);
  webServer.on("/health", HTTP_GET, handleHealth);
  webServer.on("/api/settings", HTTP_POST, handleSettingsAPI);
  webServer.on("/api/connection-mode", HTTP_POST, handleConnectionModeSwitch);
  webServer.on(
      "/api/connection-mode/confirm",
      HTTP_POST,
      handleConnectionModeConfirmation);
  webServer.on("/api/pair", HTTP_POST, handlePairingAPI);
  webServer.on("/assets", HTTP_GET, handleAssetsList);
  webServer.on(
      "/assets",
      HTTP_POST,
      handleAssetUploadResult,
      handleAssetUpload);
  webServer.on("/assets", HTTP_DELETE, handleAssetDelete);
  webServer.on("/theme/active", HTTP_POST, handleThemeActive);
  webServer.on("/screensaver/active", HTTP_POST, handleScreensaverActive);
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
  Serial.println("http_server_started port=80");
}

void startSetupAccessPoint() {
  setupMode = true;
  pendingHttpRender = false;
  resetWifiReconnectState();
  codexbar_display::esp8266::wifi_recovery::EnterSetup(
      wifiSetupRecoveryState,
      static_cast<uint32_t>(millis()));
  codexbar_display::esp8266::wifi_setup::ResetPortalState(setupWifiState);
  WiFi.setAutoReconnect(false);
  WiFi.disconnect(false);
  WiFi.mode(WIFI_AP_STA);
  applyWifiInteropPhyMode();
  WiFi.softAP(kSetupApSsid);
  Serial.printf("wifi_setup_ap ssid=VibeTV-Setup ip=%s\n", WiFi.softAPIP().toString().c_str());
  dnsServer.start(kDnsPort, "*", WiFi.softAPIP());
  captiveDnsStarted = true;
  Serial.printf("captive_dns_started port=%u ip=%s\n", kDnsPort, WiFi.softAPIP().toString().c_str());
  startHttpServer();
  const unsigned long renderStartUs = micros();
  renderer.DrawSetupInstructions(runtimeCtx, kSetupApSsid, WiFi.softAPIP().toString());
  recordRenderFull("setup", micros() - renderStartUs);
  waitStatusRendered = true;
}

void maintainWifiConnection() {
  if (!codexbar_display::esp8266::device_settings::UsesWifi(
          deviceSettings.connectionMode)) {
    return;
  }
  if (setupMode) {
    maintainWifiSetupRecovery();
    return;
  }
  if (rebootPending) {
    return;
  }
  if (WiFi.status() == WL_CONNECTED) {
    if (wifiDisconnectedAtMs != 0) {
      Serial.printf("wifi_reconnected ip=%s\n", WiFi.localIP().toString().c_str());
      drawWaitingForCompanionStatus();
    } else if (waitStatusRendered) {
      String stationIp = WiFi.localIP().toString();
      if (!codexbar_display::esp8266::ConnectedSetupPolicy::IsStationIPv4(stationIp.c_str())) {
        stationIp = "";
      }
      if (stationIp != lastConnectedSetupIp) {
        Serial.printf("wifi_station_ip_changed ip=%s\n", stationIp.c_str());
        drawWaitingForCompanionStatus();
      }
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
  // A complete Cable frame can arrive while the display is busy decoding an
  // animated GIF. The ESP8266 default UART buffer is only 256 bytes, so size
  // the ring for the frame contract (plus its otherwise unusable sentinel
  // slot) before the UART allocates it.
  Serial.setRxBufferSize(kMaxFrameBytes + 1);
  Serial.begin(115200);
  delay(200);
  bootResetReasonJSON = "\"";
  bootResetReasonJSON += jsonEscape(ESP.getResetReason());
  bootResetReasonJSON += "\"";
  bootResetCounter = incrementBootResetCounter();
  deviceID = String(ESP.getChipId());
  bootID = String(ESP.getChipId(), HEX);
  bootID += "-";
  bootID += String(bootResetCounter);
  bootID += "-";
  bootID += String(ESP.getCycleCount(), HEX);
  renderer.Setup(runtimeCtx);
  deviceSettingsRecordAvailable = loadDeviceSettings();
  loadDeviceAuthToken();
  bool hasSavedWifi = readWifiCredentials(savedWifiCredentials);
  bool wifiConnected = false;
  if (codexbar_display::esp8266::device_settings::ShouldImportLegacySdkWifi(
          deviceSettings.connectionMode, hasSavedWifi)) {
    wifiConnected = connectToSdkWifiConfig();
    if (wifiConnected) {
      hasSavedWifi = readWifiCredentials(savedWifiCredentials);
    }
  }
  savedWifiCredentialsAvailable = hasSavedWifi;
  const bool hasLegacyState =
      deviceSettingsRecordAvailable || hasSavedWifi || wifiConnected ||
      deviceAuthConfigured();
  (void)resolveInitialConnectionMode(hasLegacyState);
  (void)loadConnectionTransition();
  Serial.printf(
      "connection_mode_loaded mode=%s cable_supported=%d\n",
      codexbar_display::esp8266::device_settings::ConnectionModeName(
          deviceSettings.connectionMode),
      codexbar_display::esp8266::device_settings::SupportsCable(
          deviceSettings.connectionMode)
          ? 1
          : 0);
  restoreResetTrustAfterRestart();
#if CODEXBAR_DISPLAY_THEME_SPEC_RENDERER
  loadActiveStoredThemeSpecCache();
#endif
  const unsigned long startupRenderStartUs = micros();
  renderer.DrawStatus(runtimeCtx, "VIBE TV", "Starting", "Please wait");
  recordRenderFull("status", micros() - startupRenderStartUs);
  if (deviceSettings.connectionMode ==
      codexbar_display::esp8266::device_settings::ConnectionMode::kCable) {
    codexbar_display::app::EmitDeviceHello(makeTransportConfig("usb"));
  }

#ifdef CODEXBAR_DISPLAY_PROBE_ONLY
  Serial.println("codexbar_display_ready_probe");
#else
  Serial.println("codexbar_display_ready_display");
#endif

  if (!codexbar_display::esp8266::device_settings::UsesWifi(
          deviceSettings.connectionMode)) {
    setupMode = false;
    WiFi.persistent(false);
    WiFi.setAutoReconnect(false);
    WiFi.disconnect(false);
    WiFi.mode(WIFI_OFF);
    const unsigned long renderStartUs = micros();
    renderer.DrawStatus(runtimeCtx, "VIBE TV", "Cable connected", "Open VibeTV App");
    recordRenderFull("cable_setup", micros() - renderStartUs);
    waitStatusRendered = true;
    Serial.println("connection_mode_ready mode=cable radio=off");
    return;
  }

  if (!wifiConnected && hasSavedWifi) {
    wifiConnected = connectToSavedWifi(savedWifiCredentials);
  }
  if (wifiConnected) {
    setupMode = false;
    // SNTP over UDP/123 in UTC. The local offset is applied by the device
    // clock, not by the C library, so no timezone database is linked in.
    // lwIP keeps the system clock corrected without any retry code here.
    configTime(0, 0, "pool.ntp.org");
    startHttpServer();
  } else if (connectionTransitionPending) {
    if (hasSavedWifi) {
      clearWifiCredentials();
      clearSdkWifiCredentials();
      savedWifiCredentialsAvailable = false;
    }
    connectionTransitionStartedAtMs = millis();
    Serial.printf(
        "connection_mode_transition_setup mode=wifi timeout_ms=%lu\n",
        device_settings::kConnectionTransitionSetupMs);
    startSetupAccessPoint();
  } else {
    startSetupAccessPoint();
  }
}

void loop() {
  const unsigned long loopStartUs = micros();
  bool rendered = false;
  unsigned long renderDurationUs = 0;

  if (pendingHttpRender) {
    const codexbar_display::core::SerialConsumeEvent event = pendingHttpRenderEvent;
    pendingHttpRender = false;
    renderAcceptedFrame(event);
  }

  handleSerialInput();
  maintainCableTransfer();

  if (httpServerStarted) {
    webServer.handleClient();
  }
  maintainConnectionTransition();
  maintainWifiConnection();
  if (!otaUploadInProgress && !assetUploadInProgress) {
    maintainDeviceClock();
  }
  if (!otaUploadInProgress) {
    maintainFirmwareUpdateNotice();
  }

  if (otaUploadInProgress || assetUploadInProgress) {
    delay(1);
    return;
  }

  maintainStandby();
  maintainScreensaverPreview();

  if (!waitStatusRendered &&
      codexbar_display::app::HasFrame(runtimeCtx) &&
      !codexbar_display::app::CurrentFrame(runtimeCtx).hasError &&
      !runtimeCtx.screenDirty &&
      !frameStaleStatusRendered) {
    renderer.TickActive(runtimeCtx);
    const int64_t remain = codexbar_display::app::CurrentRemainingSecs(runtimeCtx, millis());
    bool countdownMinuteChanged = false;
    if (remain != runtimeCtx.lastRenderedSecs) {
      if (codexbar_display::core::RemainingMinuteBucketChanged(
              remain, runtimeCtx.lastRenderedMinuteBucket)) {
        countdownMinuteChanged = true;
      } else {
        runtimeCtx.lastRenderedSecs = remain;
      }
    }
    for (size_t i = 0; i < codexbar_display::core::kMaxUsageWindows; ++i) {
      const int64_t slotRemain =
          codexbar_display::app::CurrentUsageWindowRemainingSecs(runtimeCtx, i, millis());
      if (slotRemain == runtimeCtx.lastRenderedUsageWindowSecs[i]) {
        continue;
      }
      if (codexbar_display::core::RemainingMinuteBucketChanged(
              slotRemain, runtimeCtx.lastRenderedUsageWindowMinuteBuckets[i])) {
        countdownMinuteChanged = true;
      } else {
        runtimeCtx.lastRenderedUsageWindowSecs[i] = slotRemain;
      }
    }
    // Provider slots count down locally too. A screensaver bound to them —
    // Night Clock does exactly that — would otherwise sit at the last received
    // value for as long as the Mac stays away.
    for (size_t i = 0; i < codexbar_display::core::kMaxProviderSlots; ++i) {
      const int64_t slotRemain =
          codexbar_display::app::CurrentProviderSlotRemainingSecs(runtimeCtx, i, millis());
      if (slotRemain == runtimeCtx.lastRenderedProviderSlotSecs[i]) {
        continue;
      }
      if (codexbar_display::core::RemainingMinuteBucketChanged(
              slotRemain, runtimeCtx.lastRenderedProviderSlotMinuteBuckets[i])) {
        countdownMinuteChanged = true;
      } else {
        runtimeCtx.lastRenderedProviderSlotSecs[i] = slotRemain;
      }
    }
    if (countdownMinuteChanged) {
#ifdef CODEXBAR_DISPLAY_PROBE_ONLY
      runtimeCtx.screenDirty = true;
#else
      const unsigned long renderStartUs = micros();
      renderer.DrawReset(runtimeCtx, remain);
      drawFirmwareUpdateNotice();
      recordRenderPartial("reset", micros() - renderStartUs);
#endif
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

  if (captiveDnsStarted) {
    dnsServer.processNextRequest();
  }
  if (rebootPending && static_cast<long>(millis() - rebootAtMs) >= 0) {
    Serial.println("reboot_now");
    delay(100);
    persistResetTrustForRestart();
    ESP.restart();
  }

#if CODEXBAR_DISPLAY_THEME_SPEC_RENDERER
  delay(renderer.AnimationWorkPending() ? 1 : 20);
#else
  delay(20);
#endif
}
