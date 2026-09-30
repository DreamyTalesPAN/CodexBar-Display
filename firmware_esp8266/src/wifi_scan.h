#pragma once

#include <Arduino.h>
#include <cstring>

// Result of one WiFi network scan for the Mac App's Cable WiFi setup.
namespace codexbar_display {
namespace esp8266 {
namespace wifi_scan {

constexpr size_t kMaxSsidBytes = 33;
constexpr uint8_t kMaxNetworks = 10;

enum class ScanStatus : uint8_t {
  NotStarted,
  Scanning,
  Ready,
  Empty,
  Failed,
};

struct Network {
  char ssid[kMaxSsidBytes] = {0};
  int16_t rssi = -100;
  bool encrypted = true;
};

struct State {
  Network networks[kMaxNetworks];
  uint8_t networkCount = 0;
  ScanStatus scanStatus = ScanStatus::NotStarted;
  bool scanInProgress = false;
};

inline void CopySsid(char* target, const String& ssid) {
  const size_t length = ssid.length() < (kMaxSsidBytes - 1) ? ssid.length() : (kMaxSsidBytes - 1);
  memcpy(target, ssid.c_str(), length);
  target[length] = '\0';
}

inline int CompareNetworks(const Network& left, const Network& right) {
  if (left.rssi != right.rssi) {
    return left.rssi > right.rssi ? -1 : 1;
  }
  return strcmp(left.ssid, right.ssid);
}

inline void SortNetworks(State& state) {
  for (uint8_t i = 1; i < state.networkCount; ++i) {
    Network current = state.networks[i];
    int j = static_cast<int>(i) - 1;
    while (j >= 0 && CompareNetworks(current, state.networks[j]) < 0) {
      state.networks[j + 1] = state.networks[j];
      --j;
    }
    state.networks[j + 1] = current;
  }
}

inline bool BeginScan(State& state) {
  if (state.scanInProgress) {
    return false;
  }
  state.scanInProgress = true;
  state.scanStatus = ScanStatus::Scanning;
  state.networkCount = 0;
  return true;
}

// Keeps the ten strongest 2.4 GHz networks, one entry per SSID.
inline bool AddScanResult(
    State& state,
    const String& ssid,
    int32_t rssi,
    int32_t channel,
    bool encrypted = true) {
  if (!state.scanInProgress || ssid.length() == 0 || ssid.length() >= kMaxSsidBytes || channel < 1 || channel > 14) {
    return false;
  }

  for (uint8_t i = 0; i < state.networkCount; ++i) {
    if (ssid == state.networks[i].ssid) {
      if (rssi > state.networks[i].rssi) {
        state.networks[i].rssi = static_cast<int16_t>(rssi);
        state.networks[i].encrypted = encrypted;
        SortNetworks(state);
      }
      return true;
    }
  }

  if (state.networkCount < kMaxNetworks) {
    Network& network = state.networks[state.networkCount++];
    CopySsid(network.ssid, ssid);
    network.rssi = static_cast<int16_t>(rssi);
    network.encrypted = encrypted;
    SortNetworks(state);
    return true;
  }

  Network candidate;
  CopySsid(candidate.ssid, ssid);
  candidate.rssi = static_cast<int16_t>(rssi);
  candidate.encrypted = encrypted;
  if (CompareNetworks(candidate, state.networks[state.networkCount - 1]) >= 0) {
    return false;
  }
  state.networks[state.networkCount - 1] = candidate;
  SortNetworks(state);
  return true;
}

inline void FinishScan(State& state, int rawNetworkCount) {
  state.scanInProgress = false;
  if (rawNetworkCount < 0) {
    state.scanStatus = ScanStatus::Failed;
  } else if (state.networkCount == 0) {
    state.scanStatus = ScanStatus::Empty;
  } else {
    state.scanStatus = ScanStatus::Ready;
  }
}

}  // namespace wifi_scan
}  // namespace esp8266
}  // namespace codexbar_display
