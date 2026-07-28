#pragma once

#include <stdint.h>

namespace codexbar_display {
namespace esp8266 {
namespace device_settings {

constexpr uint8_t kDefaultBrightnessPercent = 20;
constexpr uint8_t kMinBrightnessPercent = 1;
constexpr uint8_t kMaxBrightnessPercent = 100;

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
