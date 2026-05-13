#include <Arduino.h>
#include <DNSServer.h>
#include <EEPROM.h>
#include <ESP8266mDNS.h>
#include <ESP8266WebServer.h>
#include <ESP8266WiFi.h>
#include <LittleFS.h>
#include <Updater.h>

#include "../../firmware_shared/app_runtime.h"
#include "../../firmware_shared/app_transport.h"
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
DNSServer dnsServer;

constexpr int kMaxFrameBytes = 2048;
constexpr uint16_t kDnsPort = 53;
constexpr uint32_t kWifiCredsMagic = 0x56544231UL;  // VTB1
constexpr uint32_t kBootRecoveryMagic = 0x56544252UL;  // VTBR
constexpr size_t kWifiSsidBytes = 33;
constexpr size_t kWifiPasswordBytes = 65;
constexpr size_t kWifiCredsBytes = 4 + kWifiSsidBytes + kWifiPasswordBytes;
constexpr size_t kBootRecoveryOffset = kWifiCredsBytes;
constexpr size_t kBootRecoveryBytes = 5;
constexpr size_t kEepromBytes = kWifiCredsBytes + kBootRecoveryBytes;
constexpr unsigned long kWifiConnectTimeoutMs = 20000UL;
constexpr unsigned long kWifiReconnectRetryMs = 5000UL;
constexpr unsigned long kWifiReconnectFallbackMs = 120000UL;
constexpr unsigned long kRebootDelayMs = 750UL;
constexpr unsigned long kBootRecoveryStableMs = 30000UL;
constexpr unsigned long kFrameStaleWarningMs = 150000UL;
constexpr unsigned long kFirmwareUpdateNoticeToggleMs = 1500UL;
constexpr uint8_t kBootRecoveryThreshold = 3;
constexpr size_t kMaxAssetPathBytes = 32;
constexpr size_t kMaxStoredThemeSpecBytes = 4096;
const char kSetupApSsid[] = "VibeTV-Setup";
const char kSetupHost[] = "vibetv.local";
const char kMdnsName[] = "vibetv";
const char kMdnsHost[] = "vibetv.local";
const char kFirmwareManifestUrl[] = "https://github.com/DreamyTalesPAN/CodexBar-Display/releases/latest/download/firmware-manifest.json";
const char* const kFirmwareUpdateNoticeTexts[] = {
    "Update Available:",
    "vibetv.local",
};
constexpr uint8_t kFirmwareUpdateNoticeTextCount =
    sizeof(kFirmwareUpdateNoticeTexts) / sizeof(kFirmwareUpdateNoticeTexts[0]);

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

bool httpServerStarted = false;
bool setupMode = false;
bool waitStatusRendered = false;
bool otaUploadSucceeded = false;
bool otaUploadInProgress = false;
String otaUploadError;
bool assetUploadSucceeded = false;
String assetUploadError;
String assetUploadPath;
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
bool mdnsStarted = false;
unsigned long wifiDisconnectedAtMs = 0;
unsigned long wifiReconnectAttemptAtMs = 0;
bool wifiReconnectStatusRendered = false;
FirmwareUpdateState firmwareUpdate;
bool firmwareUpdateTopLineDirty = false;

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

void markFirmwareUpdateNoticeDirty() {
  if (!codexbar_display::app::HasFrame(runtimeCtx) ||
      codexbar_display::app::CurrentFrame(runtimeCtx).hasError) {
    return;
  }
  if (!runtimeCtx.screenDirty && !waitStatusRendered && !frameStaleStatusRendered) {
    firmwareUpdateTopLineDirty = true;
  } else {
    runtimeCtx.screenDirty = true;
  }
}

void applyFirmwareUpdateNoticePhase() {
  if (firmwareUpdate.noticePhase == 0 ||
      firmwareUpdate.noticePhase > kFirmwareUpdateNoticeTextCount) {
    runtimeCtx.topLineOverride = "";
    firmwareUpdate.noticeVisible = false;
    firmwareUpdate.noticePhase = 0;
    return;
  }
  runtimeCtx.topLineOverride = kFirmwareUpdateNoticeTexts[firmwareUpdate.noticePhase - 1];
  firmwareUpdate.noticeVisible = true;
}

void clearFirmwareUpdateNotice() {
  if (runtimeCtx.topLineOverride.length() == 0 && !firmwareUpdate.noticeVisible) {
    return;
  }
  runtimeCtx.topLineOverride = "";
  firmwareUpdate.noticeVisible = false;
  firmwareUpdate.noticePhase = 0;
  firmwareUpdate.noticeLastToggleAtMs = millis();
  markFirmwareUpdateNoticeDirty();
}

void maintainFirmwareUpdateNotice() {
  if (!firmwareUpdate.available ||
      setupMode ||
      frameStaleStatusRendered ||
      !codexbar_display::app::HasFrame(runtimeCtx) ||
      codexbar_display::app::CurrentFrame(runtimeCtx).hasError ||
      codexbar_display::app::CurrentFrame(runtimeCtx).hasThemeSpec) {
    clearFirmwareUpdateNotice();
    return;
  }

  const unsigned long nowMs = millis();
  if (firmwareUpdate.noticeLastToggleAtMs == 0) {
    firmwareUpdate.noticeLastToggleAtMs = nowMs;
    return;
  }
  if ((nowMs - firmwareUpdate.noticeLastToggleAtMs) < kFirmwareUpdateNoticeToggleMs) {
    return;
  }

  firmwareUpdate.noticeLastToggleAtMs = nowMs;
  firmwareUpdate.noticePhase =
      (firmwareUpdate.noticePhase + 1) % (kFirmwareUpdateNoticeTextCount + 1);
  applyFirmwareUpdateNoticePhase();
  markFirmwareUpdateNoticeDirty();
}

void applyFrameUpdateState() {
  if (!codexbar_display::app::HasFrame(runtimeCtx)) {
    return;
  }

  const codexbar_display::core::Frame& frame = codexbar_display::app::CurrentFrame(runtimeCtx);
  if (!frame.hasUpdateAvailable) {
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
  if (frame.hasThemeSpec) {
    clearFirmwareUpdateNotice();
    return;
  }
  if (changed) {
    firmwareUpdate.noticeVisible = true;
    firmwareUpdate.noticePhase = 1;
    firmwareUpdate.noticeLastToggleAtMs = millis();
    applyFirmwareUpdateNoticePhase();
    runtimeCtx.screenDirty = true;
  }
}

void drawWaitingForCompanionStatus() {
  renderer.DrawConnectedSetupInstructions(runtimeCtx, kMdnsHost, WiFi.localIP().toString());
  waitStatusRendered = true;
}

void drawWifiConnectingStatus(const String& ssid) {
  renderer.DrawStatus(runtimeCtx, "VIBE TV", "Connecting WiFi", ssid);
}

void drawWifiResetStatus(const String& line2) {
  renderer.DrawStatus(runtimeCtx, "VIBE TV RESET", "WiFi reset", line2);
}

void drawUpdateStatus(const String& line2) {
  renderer.DrawStatus(runtimeCtx, "VIBE TV UPDATE", "Update running", line2);
}

bool statusScreenLocked() {
  return otaUploadInProgress || rebootPending;
}

void resetWifiReconnectState() {
  wifiDisconnectedAtMs = 0;
  wifiReconnectAttemptAtMs = 0;
  wifiReconnectStatusRendered = false;
}

void startMdnsResponder(const IPAddress& address) {
  if (mdnsStarted) {
    return;
  }
  if (!MDNS.begin(kMdnsName, address)) {
    Serial.printf("mdns_start_failed host=%s ip=%s\n", kMdnsHost, address.toString().c_str());
    return;
  }
  MDNS.addService("http", "tcp", 80);
  mdnsStarted = true;
  Serial.printf("mdns_started host=%s ip=%s service=http\n", kMdnsHost, address.toString().c_str());
}

String displayErrorMessage(const String& message) {
  if (message == "runtime/codexbar-version" || message == "runtime/codexbar-parse") {
    return "Update Mac App";
  }
  if (message == "runtime/codexbar-binary") {
    return "Install Mac App";
  }
  if (message == "runtime/no-providers") {
    return "Open Mac App";
  }
  if (message == "runtime/codexbar-cmd") {
    return "Check Mac App";
  }
  if (message == "runtime/cycle-timeout") {
    return "Check Mac App";
  }
  return "Check Mac App";
}

void markFrameAccepted(const codexbar_display::core::SerialConsumeEvent& event, const char* transport) {
  if (statusScreenLocked()) {
    Serial.printf("frame_ignored transport=%s reason=status_screen_locked\n", transport);
    return;
  }

  const bool redrawAfterStaleStatus = frameStaleStatusRendered;
  waitStatusRendered = false;
  frameStaleStatusRendered = false;
  lastFrameAcceptedAtMs = millis();
  applyFrameUpdateState();
  if (event.themeSpecChanged) {
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
  }
  renderer.OnFrameAccepted(runtimeCtx, event);
  if (redrawAfterStaleStatus) {
    runtimeCtx.screenDirty = true;
  }
  Serial.printf("frame_received transport=%s\n", transport);
}

const char* transportCapabilitiesJSON(const char* activeTransport) {
  const bool isUsb = activeTransport != nullptr && strcmp(activeTransport, "usb") == 0;
#ifdef CODEXBAR_DISPLAY_PROBE_ONLY
  if (isUsb) {
    return "{\"display\":{\"widthPx\":240,\"heightPx\":240,\"colorDepthBits\":16},"
           "\"theme\":{\"supportsThemeSpecV1\":false,\"maxThemeSpecBytes\":0,\"maxThemePrimitives\":0},"
           "\"transport\":{\"active\":\"usb\",\"supported\":[\"usb\",\"wifi\"]}}";
  }
  return "{\"display\":{\"widthPx\":240,\"heightPx\":240,\"colorDepthBits\":16},"
         "\"theme\":{\"supportsThemeSpecV1\":false,\"maxThemeSpecBytes\":0,\"maxThemePrimitives\":0},"
         "\"transport\":{\"active\":\"wifi\",\"supported\":[\"usb\",\"wifi\"]}}";
#else
  if (isUsb) {
#if CODEXBAR_DISPLAY_THEME_SPEC_RENDERER
    return "{\"display\":{\"widthPx\":240,\"heightPx\":240,\"colorDepthBits\":16},"
           "\"theme\":{\"supportsThemeSpecV1\":true,\"maxThemeSpecBytes\":2048,\"maxThemePrimitives\":32,\"supportsStoredThemes\":true,\"maxStoredThemeSpecBytes\":4096},"
           "\"transport\":{\"active\":\"usb\",\"supported\":[\"usb\",\"wifi\"]}}";
#else
    return "{\"display\":{\"widthPx\":240,\"heightPx\":240,\"colorDepthBits\":16},"
           "\"theme\":{\"supportsThemeSpecV1\":false,\"maxThemeSpecBytes\":0,\"maxThemePrimitives\":0},"
           "\"transport\":{\"active\":\"usb\",\"supported\":[\"usb\",\"wifi\"]}}";
#endif
  }
#if CODEXBAR_DISPLAY_THEME_SPEC_RENDERER
  return "{\"display\":{\"widthPx\":240,\"heightPx\":240,\"colorDepthBits\":16},"
         "\"theme\":{\"supportsThemeSpecV1\":true,\"maxThemeSpecBytes\":2048,\"maxThemePrimitives\":32,\"supportsStoredThemes\":true,\"maxStoredThemeSpecBytes\":4096},"
         "\"transport\":{\"active\":\"wifi\",\"supported\":[\"usb\",\"wifi\"]}}";
#else
  return "{\"display\":{\"widthPx\":240,\"heightPx\":240,\"colorDepthBits\":16},"
         "\"theme\":{\"supportsThemeSpecV1\":false,\"maxThemeSpecBytes\":0,\"maxThemePrimitives\":0},"
         "\"transport\":{\"active\":\"wifi\",\"supported\":[\"usb\",\"wifi\"]}}";
#endif
#endif
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
  return String("http://") + kMdnsHost;
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
  return EEPROM.read(kBootRecoveryOffset + 4);
}

void writeBootRecoveryCounter(uint8_t counter) {
  EEPROM.begin(kEepromBytes);
  EEPROM.put(kBootRecoveryOffset, kBootRecoveryMagic);
  EEPROM.write(kBootRecoveryOffset + 4, counter);
  EEPROM.commit();
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

bool consumeBootRecoveryTrigger() {
  uint8_t counter = readBootRecoveryCounter();
  if (counter < 255) {
    ++counter;
  }
  writeBootRecoveryCounter(counter);
  Serial.printf("boot_recovery_counter value=%u threshold=%u\n", counter, kBootRecoveryThreshold);

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
  WiFi.mode(WIFI_STA);
  WiFi.disconnect();
  delay(150);
  const int networks = WiFi.scanNetworks();
  for (int i = 0; i < networks; ++i) {
    const String ssid = WiFi.SSID(i);
    if (ssid.length() == 0) {
      continue;
    }
    options += "<option value=\"";
    options += htmlEscape(ssid);
    options += "\">";
    options += htmlEscape(ssid);
    options += " (";
    options += String(WiFi.RSSI(i));
    options += " dBm)</option>";
  }
  WiFi.scanDelete();
  setupWifiOptionsHTML = options;
  Serial.printf("wifi_setup_scan networks=%d options=%u\n", networks, setupWifiOptionsHTML.length());
}

String setupPageHTML() {
  String html;
  html.reserve(1600);
  html += "<!doctype html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'>";
  html += "<title>VibeTV Setup</title><style>";
  html += "body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;margin:0;background:#101113;color:#f7f7f2}";
  html += "main{max-width:460px;margin:0 auto;padding:32px 20px}label{display:block;margin:18px 0 6px}";
  html += "select,input,button{box-sizing:border-box;width:100%;font:inherit;padding:12px;border-radius:8px;border:1px solid #555;background:#181a1d;color:#fff}";
  html += "button{margin-top:22px;background:#c7ff00;color:#111;border:0;font-weight:700}.muted{color:#aaa;line-height:1.4}";
  html += "</style></head><body><main><h1>VibeTV Setup</h1>";
  html += "<p class='muted'>Choose your home WiFi and save the connection. Vibe TV restarts after saving.</p>";
  html += "<form method='post' action='/save'><label>Choose WiFi</label><select name='ssid'>";
  html += setupWifiOptionsHTML.length() > 0 ? setupWifiOptionsHTML : "<option value=''>No networks found</option>";
  html += "</select><label>Enter SSID manually</label><input name='custom_ssid' maxlength='32' autocomplete='off' placeholder='WiFi name'>";
  html += "<label>Password</label><input name='password' type='password' maxlength='64' autocomplete='current-password'>";
  html += "<button type='submit'>Save</button></form>";
  html += "<p class='muted'>Setup address: http://";
  html += kSetupHost;
  html += "<br>Fallback: http://192.168.4.1</p></main></body></html>";
  return html;
}

String connectedPageHTML() {
  const String ip = WiFi.localIP().toString();
  const bool hasFrame = codexbar_display::app::HasFrame(runtimeCtx);
  const String setupCommand = macInstallerCommand();

  String html;
  html.reserve(3600);
  html += F("<!doctype html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'>");
  html += F("<title>VibeTV Setup</title><style>");
  html += F(":root{color-scheme:dark;--bg:#0b0c0d;--panel:#15171a;--line:#2b2f35;--text:#f6f4ed;--muted:#a9adb3;--signal:#c7ff00}");
  html += F("*{box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;margin:0;background:var(--bg);color:var(--text)}");
  html += F("main{max-width:620px;margin:0 auto;padding:28px 20px 34px}.device,.step{border-top:1px solid var(--line);padding-top:14px;margin-top:14px}");
  html += F(".brand,.pill,.step-title{font-weight:900}.pill,.update strong,a{color:var(--signal)}h1{font-size:36px;line-height:1.05;margin:22px 0 10px}.lead,.muted,.step{color:var(--muted);line-height:1.45}");
  html += F(".update{border:1px solid #6f8f00;background:#1b2400;border-radius:8px;padding:12px;margin-top:12px;color:#f1ffd0}.update-link{display:inline-block;margin-top:8px}");
  html += F("code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}pre{white-space:pre-wrap;word-break:break-word;background:#08090a;border:1px solid #30343a;border-radius:8px;padding:14px;color:#fff}");
  html += F("button{width:100%;min-height:46px;border:0;border-radius:8px;background:var(--signal);color:#111;font:inherit;font-weight:900}.tools{display:flex;flex-wrap:wrap;gap:12px;margin-top:18px}.reset{color:var(--muted);background:transparent;border:0;padding:0;text-decoration:underline;width:auto;min-height:0}</style></head><body><main>");
  html += F("<div class='brand'>Vibe TV</div><section class='device'><div class='pill'>Connected</div><p class='muted'>Address: <code>http://");
  html += kMdnsHost;
  html += F("</code><br>Fallback IP: <code>http://");
  html += ip;
  html += F("</code></p>");
  html += updateStatusHTML(true);
  html += F("</section>");
  if (hasFrame) {
    html += F("<h1>Vibe TV is live.</h1><p class='lead'>Your Mac is sending workflow signals.</p>");
  } else {
    html += F("<h1>Finish Mac setup.</h1><p class='lead'>Copy the command, paste it in Terminal, then wait for live signals.</p><section><div class='step'><span class='step-title'>1. Copy command</span><pre id='cmd'>");
    html += htmlEscape(setupCommand);
    html += F("</pre><textarea id='cmdFallback' readonly style='position:absolute;left:-9999px'></textarea><button type='button' onclick='copyCmd()' id='copyBtn'>Copy setup command</button></div>");
    html += F("<div class='step'><span class='step-title'>2. Paste in Terminal</span>Open Terminal, paste, press Enter.</div><div class='step'><span class='step-title'>3. Wait</span>This page changes when frames arrive.</div></section>");
  }
  html += F("<div class='tools'><a href='/health'>Device status</a><a href='/update'>Firmware update</a><form method='post' action='/reset-wifi' onsubmit=\"return confirm('Clear WiFi settings and restart setup?')\"><button class='reset' type='submit'>Reset WiFi</button></form></div>");
  html += F("<script>function copied(){document.getElementById('copyBtn').textContent='Copied';}function fallbackCopy(t){var a=document.getElementById('cmdFallback');a.value=t;a.focus();a.select();try{document.execCommand('copy');copied();}catch(e){window.prompt('Copy this command',t);}}function copyCmd(){var t=document.getElementById('cmd').textContent.trim();if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(t).then(copied,function(){fallbackCopy(t);});}else{fallbackCopy(t);}}</script></body></html>");
  return html;
}

void handleRoot() {
  if (setupMode) {
    webServer.send(200, "text/html; charset=utf-8", setupPageHTML());
    return;
  }
  webServer.send(200, "text/html; charset=utf-8", connectedPageHTML());
}

void redirectToSetupRoot() {
  webServer.sendHeader("Location", String("http://") + kSetupHost + "/", true);
  webServer.send(302, "text/plain; charset=utf-8", "");
}

void handleCaptivePortalProbe() {
  if (setupMode) {
    webServer.send(200, "text/html; charset=utf-8", setupPageHTML());
    return;
  }
  redirectToSetupRoot();
}

void handleSaveWifi() {
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
  webServer.sendHeader("Access-Control-Allow-Origin", "*");
  webServer.sendHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  webServer.sendHeader("Access-Control-Allow-Headers", "Content-Type");
  webServer.sendHeader("Access-Control-Max-Age", "86400");
}

void handleHello() {
  addCorsHeaders();
  webServer.send(200, "application/json", codexbar_display::app::BuildDeviceHelloJSON(makeTransportConfig("wifi")));
}

String wifiModeName() {
  switch (WiFi.getMode()) {
    case WIFI_OFF:
      return "off";
    case WIFI_STA:
      return "station";
    case WIFI_AP:
      return "access_point";
    case WIFI_AP_STA:
      return "ap_station";
    default:
      return "unknown";
  }
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

void appendRendererDebugJSON(String& out) {
  const codexbar_display::esp8266::RendererDebugSnapshot snapshot = renderer.DebugSnapshot();
  out += "\"display\":{\"activeTheme\":\"";
  out += jsonEscape(snapshot.activeTheme);
  out += "\",\"themeSpec\":{\"active\":";
  out += snapshot.themeSpecActive ? "true" : "false";
  out += ",\"id\":";
  appendJSONNullableString(out, snapshot.themeSpecId);
  out += ",\"rev\":";
  out += String(snapshot.themeSpecRev);
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
  out += "},\"gif\":{\"activePath\":\"";
  out += jsonEscape(snapshot.gifActivePath);
  out += "\",\"filePresent\":";
  out += snapshot.gifFilePresent ? "true" : "false";
  out += ",\"fileOpen\":";
  out += snapshot.gifFileOpen ? "true" : "false";
  out += ",\"decoderOpen\":";
  out += snapshot.gifDecoderOpen ? "true" : "false";
  out += ",\"blocked\":";
  out += snapshot.gifBlocked ? "true" : "false";
  out += ",\"consecutiveFailures\":";
  out += String(snapshot.gifConsecutiveFailures);
  out += ",\"backoffRemainingMs\":";
  out += String(snapshot.gifBackoffRemainingMs);
  out += ",\"lastError\":";
  if (snapshot.gifLastErrorStage.length() == 0) {
    out += "null";
  } else {
    out += "{\"path\":\"";
    out += jsonEscape(snapshot.gifLastErrorPath);
    out += "\",\"stage\":\"";
    out += jsonEscape(snapshot.gifLastErrorStage);
    out += "\",\"failures\":";
    out += String(snapshot.gifLastErrorFailures);
    out += ",\"ageMs\":";
    out += String(snapshot.gifLastErrorAgeMs);
    out += "}";
  }
  out += "}}";
}

void appendFirmwareUpdateJSON(String& out) {
  out += "\"update\":{\"available\":";
  out += firmwareUpdate.available ? "true" : "false";
  out += ",\"latestVersion\":";
  appendJSONNullableString(out, firmwareUpdate.latestVersion);
  out += ",\"manifestUrl\":\"";
  out += jsonEscape(kFirmwareManifestUrl);
  out += "\",\"lastCheckedAtMs\":";
  out += String(firmwareUpdate.lastCheckedAtMs);
  out += ",\"nextCheckAtMs\":";
  out += String(firmwareUpdate.nextCheckAtMs);
  out += ",\"status\":\"";
  out += jsonEscape(firmwareUpdate.lastStatus);
  out += "\",\"lastError\":";
  appendJSONNullableString(out, firmwareUpdate.lastError);
  out += "}";
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
  const bool wifiConnected = WiFi.status() == WL_CONNECTED;

  String out;
  out.reserve(900);
  out += "{\"ok\":true";
  out += ",\"firmware\":\"";
  out += jsonEscape(CODEXBAR_DISPLAY_FW_VERSION);
  out += "\",\"board\":\"";
  out += jsonEscape(CODEXBAR_DISPLAY_BOARD_ID);
  out += "\",\"system\":{\"freeHeap\":";
  out += String(ESP.getFreeHeap());
  out += ",\"resetReason\":\"";
  out += jsonEscape(ESP.getResetReason());
  out += "\"";
  out += "},\"wifi\":{\"mode\":\"";
  out += wifiModeName();
  out += "\",\"connected\":";
  out += wifiConnected ? "true" : "false";
  out += ",\"ip\":\"";
  out += wifiConnected ? WiFi.localIP().toString() : "";
  out += "\",\"softApIp\":\"";
  out += (setupMode || WiFi.getMode() == WIFI_AP || WiFi.getMode() == WIFI_AP_STA) ? WiFi.softAPIP().toString() : "";
  out += "\",\"rssi\":";
  out += wifiConnected ? String(WiFi.RSSI()) : "0";
  out += "},";
  const bool filesystemMounted = filesystemInfoJSON(out);
  out += ",";
  appendRendererDebugJSON(out);
  out += ",";
  appendFirmwareUpdateJSON(out);
  out += ",\"transport\":{\"active\":\"wifi\",\"supported\":[\"usb\",\"wifi\"],\"httpPort\":80,\"maxFrameBytes\":";
  out += String(kMaxFrameBytes);
  out += "}}";

  Serial.printf("health_requested ip=%s fs_mounted=%d\n", webServer.client().remoteIP().toString().c_str(), filesystemMounted ? 1 : 0);
  addCorsHeaders();
  webServer.send(200, "application/json", out);
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
  assetUploadError = message;
  Serial.printf("asset_upload_error path=%s message=%s\n", assetUploadPath.c_str(), assetUploadError.c_str());
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

void handleAssetUpload() {
  HTTPUpload& upload = webServer.upload();

  if (upload.status == UPLOAD_FILE_START) {
    assetUploadSucceeded = false;
    assetUploadError = "";
    assetUploadPath = requestedAssetPath();
    Serial.printf("asset_upload_start path=%s filename=%s content_length=%zu\n", assetUploadPath.c_str(), upload.filename.c_str(), upload.contentLength);
    drawUpdateStatus("Loading display");
    renderer.ResetGifStateForAssetUpdate();
    waitStatusRendered = true;

    if (!isSafeAssetPath(assetUploadPath)) {
      setAssetUploadError("invalid asset path");
      return;
    }
    if (!LittleFS.begin()) {
      setAssetUploadError("filesystem mount failed");
      return;
    }
    if (!ensureAssetParentDirs(assetUploadPath)) {
      setAssetUploadError("create parent directory failed");
      return;
    }
    if (LittleFS.exists(assetUploadPath)) {
      LittleFS.remove(assetUploadPath);
    }
    File file = LittleFS.open(assetUploadPath, "w");
    if (!file) {
      setAssetUploadError("open asset failed");
      return;
    }
    file.close();
  } else if (upload.status == UPLOAD_FILE_WRITE) {
    if (assetUploadError.length() > 0) {
      return;
    }
    File file = LittleFS.open(assetUploadPath, "a");
    if (!file) {
      setAssetUploadError("append asset failed");
      return;
    }
    if (file.write(upload.buf, upload.currentSize) != upload.currentSize) {
      setAssetUploadError("write asset failed");
    }
    file.close();
  } else if (upload.status == UPLOAD_FILE_END) {
    if (assetUploadError.length() == 0) {
      assetUploadSucceeded = true;
      Serial.printf("asset_upload_success path=%s bytes=%zu\n", assetUploadPath.c_str(), upload.totalSize);
    }
  } else if (upload.status == UPLOAD_FILE_ABORTED) {
    setAssetUploadError("upload aborted");
  }
  yield();
}

void handleAssetUploadResult() {
  if (!assetUploadSucceeded || assetUploadError.length() > 0) {
    const String error = assetUploadError.length() > 0 ? assetUploadError : "upload failed";
    addCorsHeaders();
    webServer.send(400, "text/plain; charset=utf-8", error);
    return;
  }

  String out;
  out.reserve(120);
  out += "{\"ok\":true,\"path\":\"";
  out += jsonEscape(assetUploadPath);
  out += "\"}";
  addCorsHeaders();
  webServer.send(200, "application/json", out);
}

void handleAssetDelete() {
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
  const bool hadFrame = codexbar_display::app::HasFrame(runtimeCtx);
  const codexbar_display::core::Frame previous = runtimeCtx.runtime.current;
  codexbar_display::core::Frame next = hadFrame ? previous : codexbar_display::core::Frame{};

  if (!hadFrame) {
    next.provider = "codex";
    next.label = "Codex";
  }
  next.hasError = false;
  next.error = "";
  next.clearThemeSpec = false;
  next.hasThemeSpec = true;
  next.themeSpecId = themeId;
  next.themeSpecRev = themeRev;
  next.themeSpecRaw = raw;
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
#endif

void handleThemeActive() {
#if CODEXBAR_DISPLAY_THEME_SPEC_RENDERER
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
  String path = String(doc["path"] | "");
  path.trim();

  String raw;
  String error;
  if (!readStoredThemeSpec(path, raw, error)) {
    addCorsHeaders();
    webServer.send(error == "theme file not found" ? 404 : 400, "text/plain; charset=utf-8", error);
    return;
  }

  String themeId;
  int themeRev = 0;
  String fallbackTheme;
  if (!themeSpecMetadata(raw, themeId, themeRev, fallbackTheme, error)) {
    addCorsHeaders();
    webServer.send(400, "text/plain; charset=utf-8", error);
    return;
  }

  activateStoredThemeSpec(path, raw, themeId, themeRev, fallbackTheme);

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

String updatePageHTML() {
  const String installCommand = updateInstallCommand();
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
  html += F("<form method='post' action='/update/firmware' enctype='multipart/form-data'>");
  html += F("<input type='file' name='firmware' accept='.bin,application/octet-stream' required>");
  html += F("<button type='submit'>Upload firmware</button></form>");
  html += F("</details>");
  html += F("<p class='muted'><a href='/'>Setup</a> | <a href='/health'>Status</a> | <a href='/assets'>Files</a></p>");
  html += F("<script>function copied(){document.getElementById('copyBtn').textContent='Copied';}function fallbackCopy(t){var a=document.getElementById('cmdFallback');a.value=t;a.focus();a.select();try{document.execCommand('copy');copied();}catch(e){window.prompt('Copy this command',t);}}function copyCmd(){var t=document.getElementById('cmd').textContent.trim();if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(t).then(copied,function(){fallbackCopy(t);});}else{fallbackCopy(t);}}</script></main></body></html>");
  return html;
}

void handleUpdatePage() {
  webServer.send(200, "text/html; charset=utf-8", updatePageHTML());
}

void setOtaError(const String& message) {
  otaUploadError = message;
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

void handleOtaUpload(int command, const char* target) {
  HTTPUpload& upload = webServer.upload();

  if (upload.status == UPLOAD_FILE_START) {
    otaUploadSucceeded = false;
    otaUploadInProgress = true;
    otaUploadError = "";
    const size_t maxSize = otaMaxSizeForCommand(command);
    Serial.printf(
        "ota_upload_start target=%s filename=%s content_length=%zu max_size=%zu\n",
        target,
        upload.filename.c_str(),
        upload.contentLength,
        maxSize);
    const String targetLabel = command == U_FS ? "Loading display" : "Loading firmware";
    drawUpdateStatus(targetLabel);
    waitStatusRendered = true;

    if (command == U_FS) {
      renderer.ResetGifStateForAssetUpdate();
      close_all_fs();
    }
    if (!Update.begin(maxSize, command)) {
      setOtaError(Update.getErrorString());
    }
  } else if (upload.status == UPLOAD_FILE_WRITE) {
    if (otaUploadError.length() == 0 && Update.write(upload.buf, upload.currentSize) != upload.currentSize) {
      setOtaError(Update.getErrorString());
    }
  } else if (upload.status == UPLOAD_FILE_END) {
    if (otaUploadError.length() == 0 && Update.end(true)) {
      otaUploadSucceeded = true;
      Serial.printf("ota_upload_success target=%s bytes=%zu\n", target, upload.totalSize);
    } else if (otaUploadError.length() == 0) {
      setOtaError(Update.getErrorString());
    }
  } else if (upload.status == UPLOAD_FILE_ABORTED) {
    Update.end();
    setOtaError("upload aborted");
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
  if (!otaUploadSucceeded || otaUploadError.length() > 0 || Update.hasError()) {
    otaUploadInProgress = false;
    const String error = otaUploadError.length() > 0 ? otaUploadError : Update.getErrorString();
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
  scheduleReboot(target);
  otaUploadInProgress = false;
}

void handleFrame() {
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

  markFrameAccepted(event, "wifi");
  addCorsHeaders();
  webServer.send(200, "text/plain; charset=utf-8", "ok");
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
  webServer.begin();
  httpServerStarted = true;
  Serial.println("http_server_started port=80");
}

void startSetupAccessPoint() {
  setupMode = true;
  resetWifiReconnectState();
  scanSetupNetworks();
  WiFi.mode(WIFI_AP);
  WiFi.softAP(kSetupApSsid);
  Serial.printf("wifi_setup_ap ssid=VibeTV-Setup ip=%s\n", WiFi.softAPIP().toString().c_str());
  dnsServer.start(kDnsPort, "*", WiFi.softAPIP());
  captiveDnsStarted = true;
  Serial.printf("captive_dns_started port=%u host=%s ip=%s\n", kDnsPort, kSetupHost, WiFi.softAPIP().toString().c_str());
  renderer.DrawSetupInstructions(runtimeCtx, kSetupApSsid, WiFi.softAPIP().toString());
  waitStatusRendered = true;
  startHttpServer();
  startMdnsResponder(WiFi.softAPIP());
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
    renderer.DrawStatus(runtimeCtx, "VIBE TV", "Reconnecting WiFi", "Please wait");
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
    renderer.DrawStatus(runtimeCtx, "VIBE TV SETUP", "WiFi unavailable", "Starting setup");
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

  renderer.Setup(runtimeCtx);
  renderer.DrawStatus(runtimeCtx, "VIBE TV", "Starting", "Please wait");
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
    startMdnsResponder(WiFi.localIP());
  } else if (!forceSetupMode && connectToSdkWifiConfig()) {
    setupMode = false;
    startHttpServer();
    startMdnsResponder(WiFi.localIP());
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
  maintainFirmwareUpdateNotice();

  if (firmwareUpdateTopLineDirty &&
      !waitStatusRendered &&
      codexbar_display::app::HasFrame(runtimeCtx) &&
      !codexbar_display::app::CurrentFrame(runtimeCtx).hasError &&
      !runtimeCtx.screenDirty &&
      !frameStaleStatusRendered) {
    const unsigned long renderStartUs = micros();
    if (renderer.DrawTopLine(runtimeCtx)) {
      rendered = true;
      renderDurationUs = micros() - renderStartUs;
      firmwareUpdateTopLineDirty = false;
    } else {
      firmwareUpdateTopLineDirty = false;
      runtimeCtx.screenDirty = true;
    }
  }

  if (!waitStatusRendered &&
      codexbar_display::app::HasFrame(runtimeCtx) &&
      !codexbar_display::app::CurrentFrame(runtimeCtx).hasError &&
      !runtimeCtx.screenDirty &&
      !frameStaleStatusRendered) {
    renderer.TickActive(runtimeCtx);
    const int64_t remain = codexbar_display::app::CurrentRemainingSecs(runtimeCtx, millis());
    if (remain != runtimeCtx.lastRenderedSecs) {
      const int64_t minuteBucket = remain / 60;
      if (minuteBucket != runtimeCtx.lastRenderedMinuteBucket) {
#ifdef CODEXBAR_DISPLAY_PROBE_ONLY
        runtimeCtx.screenDirty = true;
#else
        renderer.DrawReset(runtimeCtx, remain);
#endif
      } else {
        runtimeCtx.lastRenderedSecs = remain;
      }
    }
  }

  if (!setupMode &&
      !waitStatusRendered &&
      codexbar_display::app::HasFrame(runtimeCtx) &&
      !codexbar_display::app::CurrentFrame(runtimeCtx).hasError &&
      !runtimeCtx.screenDirty &&
      !frameStaleStatusRendered &&
      lastFrameAcceptedAtMs > 0 &&
      (millis() - lastFrameAcceptedAtMs) > kFrameStaleWarningMs) {
    renderer.DrawStatus(runtimeCtx, "VIBE TV", "Check Mac App", "No fresh data");
    frameStaleStatusRendered = true;
  }

  if (!codexbar_display::app::HasFrame(runtimeCtx) && !runtimeCtx.screenDirty && !waitStatusRendered) {
    renderer.TickSplash(runtimeCtx);
  }

  if (runtimeCtx.screenDirty && !waitStatusRendered) {
    const unsigned long renderStartUs = micros();
#ifdef CODEXBAR_DISPLAY_PROBE_ONLY
    renderer.DrawUsage(runtimeCtx);
#else
    if (!codexbar_display::app::HasFrame(runtimeCtx)) {
      renderer.DrawSplash(runtimeCtx);
    } else if (codexbar_display::app::CurrentFrame(runtimeCtx).hasError) {
      renderer.DrawStatus(
          runtimeCtx,
          "VIBE TV",
          displayErrorMessage(codexbar_display::app::CurrentFrame(runtimeCtx).error),
          "On your Mac");
    } else {
      renderer.DrawUsage(runtimeCtx);
    }
#endif
    rendered = true;
    renderDurationUs = micros() - renderStartUs;
    runtimeCtx.screenDirty = false;
    firmwareUpdateTopLineDirty = false;
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
  if (captiveDnsStarted) {
    dnsServer.processNextRequest();
  }
  if (mdnsStarted) {
    MDNS.update();
  }
  if (rebootPending && static_cast<long>(millis() - rebootAtMs) >= 0) {
    Serial.println("reboot_now");
    delay(100);
    ESP.restart();
  }

  if (bootRecoveryCounterNeedsClear && static_cast<long>(millis() - bootRecoveryClearAtMs) >= 0) {
    clearBootRecoveryCounter();
  }

  delay(20);
}
