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

namespace {

codexbar_display::app::RuntimeContext runtimeCtx;
codexbar_display::esp8266::RendererESP8266 renderer;
ESP8266WebServer webServer(80);
DNSServer dnsServer;

constexpr int kMaxFrameBytes = 1024;
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
constexpr uint8_t kBootRecoveryThreshold = 3;
constexpr size_t kMaxAssetPathBytes = 96;
const char kSetupApSsid[] = "VibeTV-Setup";
const char kSetupHost[] = "vibetv.local";
const char kMdnsName[] = "vibetv";
const char kMdnsHost[] = "vibetv.local";

struct WifiCredentials {
  char ssid[kWifiSsidBytes] = {0};
  char password[kWifiPasswordBytes] = {0};
};

bool httpServerStarted = false;
bool setupMode = false;
bool waitStatusRendered = false;
bool otaUploadSucceeded = false;
String otaUploadError;
bool assetUploadSucceeded = false;
String assetUploadError;
String assetUploadPath;
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

void drawWaitingForCompanionStatus() {
  renderer.DrawConnectedSetupInstructions(runtimeCtx, kMdnsHost);
  waitStatusRendered = true;
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
    return "Check Mac Companion";
  }
  return message;
}

void markFrameAccepted(const codexbar_display::core::SerialConsumeEvent& event, const char* transport) {
  const bool redrawAfterStaleStatus = frameStaleStatusRendered;
  waitStatusRendered = false;
  frameStaleStatusRendered = false;
  lastFrameAcceptedAtMs = millis();
  renderer.OnFrameAccepted(runtimeCtx, event);
  if (redrawAfterStaleStatus) {
    runtimeCtx.screenDirty = true;
  }
  Serial.printf("frame_received transport=%s\n", transport);
}

const char* transportCapabilitiesJSON(const char* activeTransport) {
#ifdef CODEXBAR_DISPLAY_PROBE_ONLY
  if (activeTransport != nullptr && String(activeTransport) == "usb") {
    return "{\"display\":{\"widthPx\":240,\"heightPx\":240,\"colorDepthBits\":16},"
           "\"theme\":{\"supportsThemeSpecV1\":false,\"maxThemeSpecBytes\":0,\"maxThemePrimitives\":0,\"builtinThemes\":[]},"
           "\"transport\":{\"active\":\"usb\",\"supported\":[\"usb\",\"wifi\"]}}";
  }
  return "{\"display\":{\"widthPx\":240,\"heightPx\":240,\"colorDepthBits\":16},"
         "\"theme\":{\"supportsThemeSpecV1\":false,\"maxThemeSpecBytes\":0,\"maxThemePrimitives\":0,\"builtinThemes\":[]},"
         "\"transport\":{\"active\":\"wifi\",\"supported\":[\"usb\",\"wifi\"]}}";
#else
  if (activeTransport != nullptr && String(activeTransport) == "usb") {
    return "{\"display\":{\"widthPx\":240,\"heightPx\":240,\"colorDepthBits\":16},"
           "\"theme\":{\"supportsThemeSpecV1\":true,\"maxThemeSpecBytes\":1024,\"maxThemePrimitives\":32,"
           "\"builtinThemes\":[\"classic\",\"crt\",\"mini\"]},"
           "\"transport\":{\"active\":\"usb\",\"supported\":[\"usb\",\"wifi\"]}}";
  }
  return "{\"display\":{\"widthPx\":240,\"heightPx\":240,\"colorDepthBits\":16},"
         "\"theme\":{\"supportsThemeSpecV1\":true,\"maxThemeSpecBytes\":1024,\"maxThemePrimitives\":32,"
         "\"builtinThemes\":[\"classic\",\"crt\",\"mini\"]},"
         "\"transport\":{\"active\":\"wifi\",\"supported\":[\"usb\",\"wifi\"]}}";
#endif
}

codexbar_display::app::TransportConfig makeTransportConfig(const char* activeTransport) {
  codexbar_display::app::TransportConfig config;
  config.boardId = CODEXBAR_DISPLAY_BOARD_ID;
  config.firmwareVersion = CODEXBAR_DISPLAY_FW_VERSION;
#ifdef CODEXBAR_DISPLAY_PROBE_ONLY
  config.featuresJSON = "[]";
#else
  config.featuresJSON = "[\"theme\",\"theme-spec-v1\"]";
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
    clearBootRecoveryCounter();
    Serial.println("boot_recovery_triggered action=wifi_setup");
    renderer.DrawStatus(runtimeCtx, "VIBETV RESET", "WiFi cleared", "Setup starts");
    delay(1000);
    return true;
  }

  bootRecoveryCounterNeedsClear = true;
  bootRecoveryClearAtMs = millis() + kBootRecoveryStableMs;
  return false;
}

bool connectToSavedWifi(const WifiCredentials& creds) {
  Serial.printf("wifi_connect ssid=%s\n", creds.ssid);
  renderer.DrawStatus(runtimeCtx, "VIBETV", "Connecting WiFi", creds.ssid);
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
  renderer.DrawStatus(runtimeCtx, "VIBETV", "Connecting WiFi", ssid);
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
  String setupCommand;
  setupCommand.reserve(120);
  setupCommand += "curl -fsSL https://github.com/DreamyTalesPAN/CodexBar-Display/releases/latest/download/install.sh | bash";

  String html;
  html.reserve(2600);
  html += "<!doctype html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'>";
  html += "<title>VibeTV Setup</title><style>";
  html += "body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;margin:0;background:#101113;color:#f7f7f2}";
  html += "main{max-width:560px;margin:0 auto;padding:32px 20px}.card{border:1px solid #2c3036;border-radius:8px;padding:18px;background:#181a1d}";
  html += "h1{margin:0 0 10px}.muted{color:#aaa;line-height:1.45}.ok{color:#c7ff00;font-weight:700}";
  html += "code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}pre{white-space:pre-wrap;word-break:break-word;background:#0c0d0f;border:1px solid #333;border-radius:8px;padding:14px;color:#fff}";
  html += "button,a.button{box-sizing:border-box;display:block;width:100%;font:inherit;text-align:center;text-decoration:none;margin-top:14px;padding:13px;border-radius:8px;border:0;background:#c7ff00;color:#111;font-weight:800}";
  html += "a{color:#c7ff00}.secondary{background:#24272c;color:#f7f7f2;border:1px solid #3a3f47}</style></head><body><main>";
  html += "<p class='ok'>Vibe TV is connected</p><h1>Set up your Mac</h1>";
  html += "<p class='muted'>Open Terminal on your Mac, paste this command, and press Enter. It installs the Mac app and connects it to this Vibe TV.</p>";
  html += "<section class='card'><p class='muted'>Vibe TV address: <code>http://";
  html += kMdnsHost;
  html += "</code><br>Fallback IP: <code>http://";
  html += ip;
  html += "</code></p><pre id='cmd'>";
  html += htmlEscape(setupCommand);
  html += "</pre><textarea id='cmdFallback' readonly style='position:absolute;left:-9999px'></textarea>";
  html += "<button type='button' onclick='copyCmd()' id='copyBtn'>Copy Mac Setup Command</button></section>";
  html += "<a class='button secondary' href='/health'>Check Status</a>";
  html += "<p class='muted'>Advanced: <a href='/update'>Firmware update</a></p>";
  html += "<form method='post' action='/reset-wifi' onsubmit=\"return confirm('Clear WiFi settings and restart setup?')\">";
  html += "<button class='secondary' type='submit'>Reset WiFi Setup</button></form>";
  html += "<script>function copied(){document.getElementById('copyBtn').textContent='Copied';}";
  html += "function fallbackCopy(t){var a=document.getElementById('cmdFallback');a.value=t;a.focus();a.select();try{document.execCommand('copy');copied();}catch(e){window.prompt('Copy this command',t);}}";
  html += "function copyCmd(){var t=document.getElementById('cmd').textContent.trim();if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(t).then(copied,function(){fallbackCopy(t);});}else{fallbackCopy(t);}}</script>";
  html += "</body></html>";
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

  clearWifiCredentials();
  clearBootRecoveryCounter();
  webServer.send(200, "text/html; charset=utf-8", "<!doctype html><p>WiFi settings cleared. Vibe TV is restarting setup.</p>");
  renderer.DrawStatus(runtimeCtx, "VIBETV RESET", "WiFi cleared", "Restarting");
  waitStatusRendered = true;
  delay(500);
  ESP.restart();
}

void handleHello() {
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

void appendAssetEntriesJSON(String& out, const String& dirPath, bool& first, uint8_t depth) {
  if (depth > 4) {
    return;
  }
  Dir dir = LittleFS.openDir(dirPath);
  while (dir.next()) {
    String path = dir.fileName();
    if (!path.startsWith("/")) {
      path = "/" + path;
    }
    if (dir.isDirectory()) {
      appendAssetEntriesJSON(out, path, first, depth + 1);
      continue;
    }
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
    appendAssetEntriesJSON(out, "/", first, 0);
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
  out += "\",\"wifi\":{\"mode\":\"";
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
  out += ",\"transport\":{\"active\":\"wifi\",\"supported\":[\"usb\",\"wifi\"],\"httpPort\":80,\"maxFrameBytes\":";
  out += String(kMaxFrameBytes);
  out += "}}";

  Serial.printf("health_requested ip=%s fs_mounted=%d\n", webServer.client().remoteIP().toString().c_str(), filesystemMounted ? 1 : 0);
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
    renderer.DrawStatus(runtimeCtx, "VIBETV ASSETS", "Upload running", assetUploadPath);
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
    webServer.send(400, "text/plain; charset=utf-8", error);
    return;
  }

  String out;
  out.reserve(120);
  out += "{\"ok\":true,\"path\":\"";
  out += jsonEscape(assetUploadPath);
  out += "\"}";
  webServer.send(200, "application/json", out);
}

void handleAssetDelete() {
  String path = webServer.arg("path");
  path.trim();
  if (!isSafeAssetPath(path)) {
    webServer.send(400, "text/plain; charset=utf-8", "invalid asset path");
    return;
  }
  if (!LittleFS.begin()) {
    webServer.send(500, "text/plain; charset=utf-8", "filesystem mount failed");
    return;
  }
  if (!LittleFS.exists(path)) {
    webServer.send(404, "text/plain; charset=utf-8", "asset not found");
    return;
  }
  if (!LittleFS.remove(path)) {
    webServer.send(500, "text/plain; charset=utf-8", "asset delete failed");
    return;
  }
  Serial.printf("asset_deleted path=%s\n", path.c_str());
  webServer.send(200, "application/json", "{\"ok\":true}");
}

String updatePageHTML() {
  String html;
  html.reserve(2200);
  html += "<!doctype html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'>";
  html += "<title>VibeTV Update</title><style>";
  html += "body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;margin:0;background:#101113;color:#f7f7f2}";
  html += "main{max-width:520px;margin:0 auto;padding:32px 20px}section{border-top:1px solid #333;padding:22px 0}";
  html += "input,button{box-sizing:border-box;width:100%;font:inherit;padding:12px;border-radius:8px;border:1px solid #555;background:#181a1d;color:#fff}";
  html += "button{margin-top:12px;background:#c7ff00;color:#111;border:0;font-weight:700}.muted{color:#aaa;line-height:1.4}";
  html += "code{background:#181a1d;padding:2px 5px;border-radius:4px}</style></head><body><main>";
  html += "<h1>VibeTV Update</h1><p class='muted'>Upload a matching ESP8266 binary. The device restarts after a successful upload.</p>";
  html += "<section><h2>Firmware</h2><p class='muted'><code>firmware.bin</code> is written to the sketch slot.</p>";
  html += "<form method='post' action='/update/firmware' enctype='multipart/form-data'>";
  html += "<input type='file' name='firmware' accept='.bin,application/octet-stream' required>";
  html += "<button type='submit'>Upload firmware</button></form></section>";
  html += "<section><h2>LittleFS</h2><p class='muted'><code>littlefs.bin</code> replaces the filesystem partition.</p>";
  html += "<form method='post' action='/update/filesystem' enctype='multipart/form-data'>";
  html += "<input type='file' name='filesystem' accept='.bin,application/octet-stream' required>";
  html += "<button type='submit'>Upload LittleFS</button></form></section>";
  html += "<section><h2>Assets</h2><p class='muted'>Upload individual theme files to the filesystem.</p>";
  html += "<form method='post' action='/assets' enctype='multipart/form-data'>";
  html += "<input name='path' placeholder='/themes/example/asset.gif' required>";
  html += "<input type='file' name='asset' accept='.gif,.jpg,.jpeg,.png,.json,application/octet-stream' required>";
  html += "<button type='submit'>Upload asset</button></form></section>";
  html += "<p class='muted'><a href='/health'>Health JSON</a> · <a href='/assets'>Assets JSON</a></p></main></body></html>";
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
    otaUploadError = "";
    const size_t maxSize = otaMaxSizeForCommand(command);
    Serial.printf(
        "ota_upload_start target=%s filename=%s content_length=%zu max_size=%zu\n",
        target,
        upload.filename.c_str(),
        upload.contentLength,
        maxSize);
    renderer.DrawStatus(runtimeCtx, "VIBETV UPDATE", target, "Upload running");
    waitStatusRendered = true;

    if (command == U_FS) {
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
    renderer.DrawStatus(runtimeCtx, "VIBETV UPDATE", target, "Restarting");
  waitStatusRendered = true;
  scheduleReboot(target);
}

void handleFrame() {
  String rawBody = webServer.arg("plain");
  if (rawBody.length() == 0) {
    webServer.send(400, "text/plain; charset=utf-8", "empty frame body");
    return;
  }
  if (rawBody.length() > kMaxFrameBytes) {
    webServer.send(413, "text/plain; charset=utf-8", "frame body too large");
    return;
  }
  String body = rawBody;
  body.trim();
  if (body.length() == 0) {
    webServer.send(400, "text/plain; charset=utf-8", "empty frame body");
    return;
  }
  if (body.indexOf('\n') >= 0 || body.indexOf('\r') >= 0) {
    webServer.send(400, "text/plain; charset=utf-8", "expected one newline-delimited JSON frame");
    return;
  }

  codexbar_display::core::SerialConsumeEvent event;
  if (!codexbar_display::core::ConsumeFrameLine(runtimeCtx.runtime, body.c_str(), millis(), true, event) ||
      !event.frameAccepted) {
    webServer.send(400, "text/plain; charset=utf-8", "frame was not accepted");
    return;
  }

  markFrameAccepted(event, "wifi");
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
  renderer.DrawSetupInstructions(runtimeCtx, kSetupApSsid, kSetupHost);
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
  renderer.DrawSplash(runtimeCtx);
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

  if (codexbar_display::app::HasFrame(runtimeCtx) &&
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

  if (runtimeCtx.screenDirty) {
    const unsigned long renderStartUs = micros();
#ifdef CODEXBAR_DISPLAY_PROBE_ONLY
    renderer.DrawUsage(runtimeCtx);
#else
    if (!codexbar_display::app::HasFrame(runtimeCtx)) {
      renderer.DrawSplash(runtimeCtx);
    } else if (codexbar_display::app::CurrentFrame(runtimeCtx).hasError) {
      renderer.DrawError(runtimeCtx, displayErrorMessage(codexbar_display::app::CurrentFrame(runtimeCtx).error));
    } else {
      renderer.DrawUsage(runtimeCtx);
    }
#endif
    rendered = true;
    renderDurationUs = micros() - renderStartUs;
    runtimeCtx.screenDirty = false;
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
