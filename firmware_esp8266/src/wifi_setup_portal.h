#pragma once

#include <Arduino.h>
#include <ESP8266WebServer.h>

namespace codexbar_display {
namespace esp8266 {
namespace wifi_setup {

constexpr size_t kMaxSsidBytes = 33;
constexpr uint8_t kMaxNetworks = 10;
constexpr size_t kMaxOptionsHtmlBytes = 900;
extern const char kSupportUrl[];

enum class ScanStatus : uint8_t {
  NotStarted,
  Scanning,
  Ready,
  Empty,
  Failed,
};

enum class ConnectionError : uint8_t {
  None,
  MissingSsid,
  InvalidCredentials,
  WrongPassword,
  NetworkNotFound,
  ConnectionFailed,
};

struct Network {
  char ssid[kMaxSsidBytes] = {0};
  int16_t rssi = -100;
};

struct State {
  Network networks[kMaxNetworks];
  uint8_t networkCount = 0;
  ScanStatus scanStatus = ScanStatus::NotStarted;
  bool scanInProgress = false;
  ConnectionError connectionError = ConnectionError::None;
  char attemptedSsid[kMaxSsidBytes] = {0};
};

bool BeginScan(State& state);
bool AddScanResult(State& state, const String& ssid, int32_t rssi, int32_t channel);
void FinishScan(State& state, int rawNetworkCount);
const char* SignalLabel(int32_t rssi);

ConnectionError ConnectionErrorFromWifiStatus(int status);
void SetConnectionError(State& state, ConnectionError error, const String& attemptedSsid = String());
void ClearConnectionError(State& state);

String HtmlEscape(const String& raw);
String BuildNetworkOptionsHTML(const State& state);
void SendSetupPage(
    ESP8266WebServer& server,
    const State& state,
    const char* supportUrl,
    const char* setupAddress,
    const char* setupToken,
    int statusCode = 200);
void SendRecoveryPage(
    ESP8266WebServer& server,
    const char* supportUrl,
    const char* setupAddress,
    int statusCode = 200);

}  // namespace wifi_setup
}  // namespace esp8266
}  // namespace codexbar_display
