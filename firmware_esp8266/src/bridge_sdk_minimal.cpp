#include <Arduino.h>
#include <ESP8266WiFi.h>
#include <Updater.h>

#ifndef CODEXBAR_DISPLAY_BRIDGE_SDK_MINIMAL
#error "bridge_sdk_minimal.cpp must only be built for CODEXBAR_DISPLAY_BRIDGE_SDK_MINIMAL"
#endif

namespace {

WiFiServer rawOtaServer(8081);

void sendResponse(WiFiClient& client, int status, const char* statusText, const char* body) {
  size_t len = strlen(body);
  client.print("HTTP/1.1 ");
  client.print(status);
  client.print(" ");
  client.print(statusText);
  client.print("\r\nConnection: close\r\nContent-Type: text/plain\r\nContent-Length: ");
  client.print(len);
  client.print("\r\n\r\n");
  client.write(reinterpret_cast<const uint8_t*>(body), len);
}

void handleRawOtaClient() {
  WiFiClient client = rawOtaServer.accept();
  if (!client) {
    return;
  }
  client.setTimeout(5000);
  String line = client.readStringUntil('\n');
  line.trim();
  if (!line.startsWith("POST /update/firmware.raw ") && !line.startsWith("PUT /update/firmware.raw ")) {
    sendResponse(client, 404, "Not Found", "not found");
    client.stop();
    return;
  }

  size_t contentLength = 0;
  while (client.connected()) {
    line = client.readStringUntil('\n');
    line.trim();
    if (line.length() == 0) {
      break;
    }
    line.toLowerCase();
    if (line.startsWith("content-length:")) {
      contentLength = static_cast<size_t>(line.substring(line.indexOf(':') + 1).toInt());
    }
  }
  if (contentLength == 0) {
    sendResponse(client, 411, "Length Required", "length required");
    client.stop();
    return;
  }

  const size_t maxSize = static_cast<size_t>((ESP.getFreeSketchSpace() - 0x1000) & 0xFFFFF000);
  if (!Update.begin(maxSize, U_FLASH)) {
    sendResponse(client, 500, "Internal Server Error", "begin failed");
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
      if (millis() - lastProgressMs > 10000UL) {
        Update.end();
        sendResponse(client, 408, "Request Timeout", "timeout");
        client.stop();
        return;
      }
      delay(1);
      continue;
    }
    remaining -= got;
    lastProgressMs = millis();
    if (Update.write(buffer, got) != got) {
      Update.end();
      sendResponse(client, 500, "Internal Server Error", "write failed");
      client.stop();
      return;
    }
    ESP.wdtFeed();
    delay(0);
  }

  if (!Update.end(true)) {
    sendResponse(client, 500, "Internal Server Error", "end failed");
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
  delay(50);
  WiFi.mode(WIFI_STA);
  WiFi.setSleepMode(WIFI_NONE_SLEEP);
  WiFi.begin();
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 20000UL) {
    delay(100);
    ESP.wdtFeed();
  }
  if (WiFi.status() == WL_CONNECTED) {
    rawOtaServer.begin();
    rawOtaServer.setNoDelay(true);
  }
}

void loop() {
  if (WiFi.status() == WL_CONNECTED) {
    handleRawOtaClient();
  }
  delay(1);
}
