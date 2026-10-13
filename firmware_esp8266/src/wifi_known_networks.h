#pragma once

#include <cstddef>
#include <cstdint>
#include <cstring>

namespace codexbar_display {
namespace esp8266 {
namespace wifi_known {

// The current network keeps its VTB1 record in EEPROM, which older firmware
// still reads. These are the networks it replaced, most recently used first,
// so VibeTV can rejoin them when it moves without new credentials (#187).
constexpr size_t kMaxNetworks = 4;
constexpr size_t kSsidBytes = 33;
constexpr size_t kPasswordBytes = 65;
constexpr uint32_t kMagic = 0x56545731UL;  // VTW1
struct Network {
  char ssid[kSsidBytes] = {0};
  char password[kPasswordBytes] = {0};
};

struct List {
  uint8_t count = 0;
  Network items[kMaxNetworks];
};

// The stored record is the magic followed by the list itself.
constexpr size_t kEncodedBytes = sizeof(kMagic) + sizeof(List);

inline bool SameSsid(const Network& network, const char* ssid) {
  return ssid != nullptr && std::strncmp(network.ssid, ssid, kSsidBytes) == 0;
}

inline bool Forget(List& list, const char* ssid) {
  for (uint8_t i = 0; i < list.count; ++i) {
    if (SameSsid(list.items[i], ssid)) {
      for (uint8_t j = i; j + 1 < list.count; ++j) {
        list.items[j] = list.items[j + 1];
      }
      list.items[--list.count] = Network{};
      return true;
    }
  }
  return false;
}

// Puts the network first. The same SSID is replaced rather than repeated, and
// when the list is full the least recently used network drops out.
inline bool Remember(List& list, const char* ssid, const char* password) {
  if (ssid == nullptr || ssid[0] == '\0' || std::strlen(ssid) >= kSsidBytes ||
      password == nullptr || std::strlen(password) >= kPasswordBytes) {
    return false;
  }
  Forget(list, ssid);
  const uint8_t kept = list.count < kMaxNetworks ? list.count : kMaxNetworks - 1;
  for (uint8_t i = kept; i > 0; --i) {
    list.items[i] = list.items[i - 1];
  }
  list.items[0] = Network{};
  std::memcpy(list.items[0].ssid, ssid, std::strlen(ssid));
  std::memcpy(list.items[0].password, password, std::strlen(password));
  list.count = static_cast<uint8_t>(kept + 1);
  return true;
}

inline void Encode(const List& list, uint8_t* out) {
  std::memcpy(out, &kMagic, sizeof(kMagic));
  std::memcpy(out + sizeof(kMagic), &list, sizeof(List));
}

inline bool Decode(const uint8_t* data, size_t size, List& out) {
  out = List{};
  uint32_t magic = 0;
  if (data == nullptr || size != kEncodedBytes) {
    return false;
  }
  std::memcpy(&magic, data, sizeof(magic));
  List decoded;
  std::memcpy(&decoded, data + sizeof(magic), sizeof(List));
  if (magic != kMagic || decoded.count > kMaxNetworks) {
    return false;
  }
  for (uint8_t i = 0; i < decoded.count; ++i) {
    const Network& network = decoded.items[i];
    if (network.ssid[0] == '\0' || network.ssid[kSsidBytes - 1] != '\0' ||
        network.password[kPasswordBytes - 1] != '\0') {
      return false;
    }
  }
  out = decoded;
  return true;
}

constexpr int32_t kNotSeen = INT32_MIN;

// Which remembered networks to try, strongest signal first. seenRssi[i] is the
// best signal the scan saw for items[i], or kNotSeen. Returns how many of
// order[] were filled.
inline uint8_t Candidates(const List& list, const int32_t* seenRssi, uint8_t* order) {
  uint8_t count = 0;
  for (uint8_t i = 0; i < list.count; ++i) {
    if (seenRssi[i] == kNotSeen) {
      continue;
    }
    uint8_t at = count++;
    while (at > 0 && seenRssi[order[at - 1]] < seenRssi[i]) {
      order[at] = order[at - 1];
      --at;
    }
    order[at] = i;
  }
  return count;
}

}  // namespace wifi_known
}  // namespace esp8266
}  // namespace codexbar_display
