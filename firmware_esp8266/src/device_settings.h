#pragma once

#include <stddef.h>
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

constexpr size_t kConnectionTransitionRecordBytes = 5;
constexpr unsigned long kConnectionTransitionConfirmationMs = 60000UL;

struct ConnectionTransition {
  ConnectionMode previous = ConnectionMode::kUnspecified;
  ConnectionMode target = ConnectionMode::kUnspecified;
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

// Decides the connection mode at boot (issue #489). `classified` is true once
// this firmware generation has saved the settings record. `setUpByOlderFirmware`
// is true when older VibeTV firmware left saved WiFi or a pairing token; a unit
// fresh from the manufacturer firmware has neither.
//
// A VibeTV that arrives from older VibeTV firmware may have no USB data
// connection at all (early hardware). It keeps the legacy WiFi behaviour --
// WiFi updates, WiFi pairing and the VibeTV-Setup network -- until its first
// request over the USB cable (ModeAfterCableContact). Every other VibeTV,
// including a fresh one, is set up and changed only over the cable.
inline ConnectionMode ResolveInitialConnectionMode(
    ConnectionMode stored,
    bool setUpByOlderFirmware,
    bool classified) {
  if (stored == ConnectionMode::kCable ||
      stored == ConnectionMode::kLegacyWifiOnly) {
    return stored;
  }
  if (!classified && setUpByOlderFirmware) {
    return ConnectionMode::kLegacyWifiOnly;
  }
  return ConnectionMode::kWifi;
}

// A request over the USB cable proves the data connection, so a legacy WiFi
// VibeTV follows the cable-only rules from then on.
inline ConnectionMode ModeAfterCableContact(ConnectionMode mode) {
  return mode == ConnectionMode::kLegacyWifiOnly ? ConnectionMode::kWifi : mode;
}

inline bool ShouldImportLegacySdkWifi(
    ConnectionMode stored,
    bool hasSavedWifi) {
  // WiFi mode may already be persisted after a boot without the old router.
  // The imported credentials, not the mode, mark a completed import. Cable
  // never starts WiFi; a deliberate WiFi reset also clears the SDK store.
  return !hasSavedWifi && stored != ConnectionMode::kCable;
}

// A unit fresh from the manufacturer firmware may still hold the network it
// was flashed on in the SDK store. It forgets that network instead of joining
// it, so its setup waits for the USB cable (issue #489).
inline bool ShouldForgetFlashingWifi(bool setUpByOlderFirmware, bool classified) {
  return !setUpByOlderFirmware && !classified;
}

inline bool UsesWifi(ConnectionMode mode) {
  return mode == ConnectionMode::kWifi || mode == ConnectionMode::kLegacyWifiOnly;
}

inline bool SupportsCable(ConnectionMode mode) {
  return mode == ConnectionMode::kCable || mode == ConnectionMode::kWifi;
}

inline bool IsSwitchableConnectionMode(ConnectionMode mode) {
  return mode == ConnectionMode::kCable || mode == ConnectionMode::kWifi;
}

inline bool CanBeginConnectionTransition(ConnectionMode current, ConnectionMode target) {
  return IsSwitchableConnectionMode(current) &&
         IsSwitchableConnectionMode(target) &&
         current != target;
}

inline bool CanConfigureWifiOverCable(ConnectionMode mode, bool setupMode) {
  return mode == ConnectionMode::kCable ||
         (mode == ConnectionMode::kWifi && setupMode);
}

inline void EncodeConnectionTransition(
    const ConnectionTransition& transition,
    uint8_t* record) {
  record[0] = 'C';
  record[1] = 'M';
  record[2] = 1;
  record[3] = static_cast<uint8_t>(transition.previous);
  record[4] = static_cast<uint8_t>(transition.target);
}

inline bool DecodeConnectionTransition(
    const uint8_t* record,
    size_t length,
    ConnectionTransition& transition) {
  if (record == nullptr || length != kConnectionTransitionRecordBytes ||
      record[0] != 'C' || record[1] != 'M' || record[2] != 1) {
    return false;
  }
  const ConnectionMode previous = DecodeConnectionMode(record[3]);
  const ConnectionMode target = DecodeConnectionMode(record[4]);
  if (!CanBeginConnectionTransition(previous, target)) {
    return false;
  }
  transition.previous = previous;
  transition.target = target;
  return true;
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
