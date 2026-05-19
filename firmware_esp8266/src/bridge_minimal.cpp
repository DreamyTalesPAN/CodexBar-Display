#include <Arduino.h>
#include <EEPROM.h>
#include <ESP8266WiFi.h>
#include <WiFiUdp.h>
#include <Updater.h>

#ifndef CODEXBAR_DISPLAY_BRIDGE_MINIMAL
#error "bridge_minimal.cpp must only be built for CODEXBAR_DISPLAY_BRIDGE_MINIMAL"
#endif

namespace {

constexpr uint32_t kWifiCredsMagic = 0x56544231UL;
constexpr size_t kWifiSsidBytes = 33;
constexpr size_t kWifiPasswordBytes = 65;
constexpr size_t kWifiCredsBytes = 4 + kWifiSsidBytes + kWifiPasswordBytes;
constexpr size_t kBootRecoveryBytes = 5;
constexpr size_t kEepromBytes = kWifiCredsBytes + kBootRecoveryBytes;
constexpr unsigned long kWifiConnectTimeoutMs = 20000UL;
constexpr unsigned long kRawReadTimeoutMs = 10000UL;

struct WifiCredentials {
  char ssid[kWifiSsidBytes] = {0};
  char password[kWifiPasswordBytes] = {0};
};

WiFiServer statusServer(80);
WiFiServer rawOtaServer(8081);

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
  return creds.ssid[0] != '\0';
}

bool connectWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.setSleepMode(WIFI_NONE_SLEEP);

  WifiCredentials creds;
  if (readWifiCredentials(creds)) {
    Serial.printf("bridge_wifi_connect ssid=%s\n", creds.ssid);
    WiFi.begin(creds.ssid, creds.password);
  } else {
    Serial.println("bridge_wifi_connect source=sdk");
    WiFi.begin();
  }

  const unsigned long startedAt = millis();
  while (WiFi.status() != WL_CONNECTED && (millis() - startedAt) < kWifiConnectTimeoutMs) {
    delay(100);
    ESP.wdtFeed();
  }
  Serial.printf("bridge_wifi_status status=%d ip=%s\n", static_cast<int>(WiFi.status()), WiFi.localIP().toString().c_str());
  return WiFi.status() == WL_CONNECTED;
}

void sendResponse(WiFiClient& client, int status, const char* statusText, const String& body) {
  client.print("HTTP/1.1 ");
  client.print(status);
  client.print(" ");
  client.print(statusText);
  client.print("\r\nConnection: close\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ");
  client.print(body.length());
  client.print("\r\n\r\n");
  client.print(body);
}

void handleStatusClient() {
  WiFiClient client = statusServer.accept();
  if (!client) {
    return;
  }
  client.setTimeout(1000);
  const String requestLine = client.readStringUntil('\n');
  (void)requestLine;
  while (client.connected()) {
    String header = client.readStringUntil('\n');
    header.trim();
    if (header.length() == 0) {
      break;
    }
  }
  String body;
  body.reserve(220);
  body += "{\"ok\":true,\"mode\":\"minimal-bridge\",\"ip\":\"";
  body += WiFi.localIP().toString();
  body += "\",\"sketchMD5\":\"";
  body += ESP.getSketchMD5();
  body += "\",\"rawFirmwareUrl\":\"http://";
  body += WiFi.localIP().toString();
  body += ":8081/update/firmware.raw\"}";
  sendResponse(client, 200, "OK", body);
  client.stop();
}

bool requestLineIsRawFirmware(const String& line) {
  return line.startsWith("POST /update/firmware.raw ") ||
         line.startsWith("PUT /update/firmware.raw ");
}

void handleRawOtaClient() {
  WiFiClient client = rawOtaServer.accept();
  if (!client) {
    return;
  }
  client.setTimeout(5000);

  String requestLine = client.readStringUntil('\n');
  requestLine.trim();
  if (!requestLineIsRawFirmware(requestLine)) {
    sendResponse(client, 404, "Not Found", "not found");
    client.stop();
    return;
  }

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
    }
  }

  if (contentLength == 0) {
    sendResponse(client, 411, "Length Required", "content-length required");
    client.stop();
    return;
  }

  WiFiUDP::stopAll();
  const size_t maxSize = static_cast<size_t>((ESP.getFreeSketchSpace() - 0x1000) & 0xFFFFF000);
  if (!Update.begin(maxSize, U_FLASH)) {
    sendResponse(client, 500, "Internal Server Error", Update.getErrorString());
    client.stop();
    return;
  }

  uint8_t buffer[1024];
  size_t remaining = contentLength;
  unsigned long lastProgressMs = millis();
  while (remaining > 0) {
    const size_t want = remaining < sizeof(buffer) ? remaining : sizeof(buffer);
    const size_t got = client.readBytes(buffer, want);
    if (got == 0) {
      if (millis() - lastProgressMs > kRawReadTimeoutMs) {
        Update.end();
        sendResponse(client, 408, "Request Timeout", "raw upload timeout");
        client.stop();
        return;
      }
      delay(1);
      continue;
    }
    lastProgressMs = millis();
    remaining -= got;
    if (Update.write(buffer, got) != got) {
      const String error = Update.getErrorString();
      Update.end();
      sendResponse(client, 500, "Internal Server Error", error);
      client.stop();
      return;
    }
    ESP.wdtFeed();
    delay(0);
  }

  if (!Update.end(true)) {
    sendResponse(client, 500, "Internal Server Error", Update.getErrorString());
    client.stop();
    return;
  }
  sendResponse(client, 200, "OK", "ok");
  client.stop();
  delay(250);
  ESP.restart();
}

}  // namespace

void setup() {
  Serial.begin(115200);
  delay(100);
  Serial.println("codexbar_display_minimal_bridge");
  if (connectWifi()) {
    statusServer.begin();
    rawOtaServer.begin();
    statusServer.setNoDelay(true);
    rawOtaServer.setNoDelay(true);
    Serial.println("bridge_raw_ota_started port=8081 path=/update/firmware.raw");
  }
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    delay(100);
    return;
  }
  handleStatusClient();
  handleRawOtaClient();
  delay(1);
}
