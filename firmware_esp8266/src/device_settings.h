#pragma once

#include <stdint.h>

namespace codexbar_display {
namespace esp8266 {
namespace device_settings {

constexpr uint8_t kDefaultBrightnessPercent = 20;
constexpr uint8_t kMinBrightnessPercent = 1;
constexpr uint8_t kMaxBrightnessPercent = 100;

enum class ConnectionMode : uint8_t {
  kUnspecified = 0,
  kCable = 1,
  kWifi = 2,
  kLegacyWifiOnly = 3,
};

inline ConnectionMode DecodeConnectionMode(int value) {
  switch (value) {
    case static_cast<int>(ConnectionMode::kCable):
      return ConnectionMode::kCable;
    case static_cast<int>(ConnectionMode::kWifi):
      return ConnectionMode::kWifi;
    case static_cast<int>(ConnectionMode::kLegacyWifiOnly):
      return ConnectionMode::kLegacyWifiOnly;
    default:
      return ConnectionMode::kUnspecified;
  }
}

inline ConnectionMode ResolveInitialConnectionMode(
    ConnectionMode stored,
    bool hasLegacyState) {
  if (stored != ConnectionMode::kUnspecified) {
    return stored;
  }
  return hasLegacyState ? ConnectionMode::kLegacyWifiOnly : ConnectionMode::kCable;
}

inline bool UsesWifi(ConnectionMode mode) {
  return mode == ConnectionMode::kWifi || mode == ConnectionMode::kLegacyWifiOnly;
}

inline bool SupportsCable(ConnectionMode mode) {
  return mode == ConnectionMode::kCable || mode == ConnectionMode::kWifi;
}

inline const char* ConnectionModeName(ConnectionMode mode) {
  switch (mode) {
    case ConnectionMode::kCable:
      return "cable";
    case ConnectionMode::kWifi:
      return "wifi";
    case ConnectionMode::kLegacyWifiOnly:
      return "legacy-wifi-only";
    default:
      return "unspecified";
  }
}

inline uint8_t ClampBrightnessPercent(int value) {
  if (value < kMinBrightnessPercent) {
    return kMinBrightnessPercent;
  }
  if (value > kMaxBrightnessPercent) {
    return kMaxBrightnessPercent;
  }
  return static_cast<uint8_t>(value);
}

// Decodes the single brightness byte persisted in the device settings file.
// Negative values mean the byte could not be read; zero is not a usable
// brightness. Both fall back to the factory default instead of the minimum, so
// a missing or unreadable setting starts the VibeTV at its default brightness.
inline uint8_t BrightnessFromPersistedByte(int value) {
  if (value <= 0) {
    return kDefaultBrightnessPercent;
  }
  return ClampBrightnessPercent(value);
}

}  // namespace device_settings
}  // namespace esp8266
}  // namespace codexbar_display
