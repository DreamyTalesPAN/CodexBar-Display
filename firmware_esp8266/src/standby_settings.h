#pragma once

#include <stddef.h>
#include <stdint.h>
#include <string.h>

#include "device_settings.h"

namespace codexbar_display {
namespace esp8266 {
namespace standby {

// Standby configuration only. Deciding when the device is idle and what it
// renders belongs to the standby state machine, not here. This header is pure
// state math so it stays natively testable, per docs/firmware-guardrails.md.

constexpr uint8_t kDefaultTimeoutMinutes = 10;
constexpr uint8_t kMinTimeoutMinutes = 1;
constexpr uint8_t kMaxTimeoutMinutes = 240;

// The screensaver runs for hours at a time, so it gets its own dim default
// instead of inheriting the live brightness.
constexpr uint8_t kDefaultBrightnessPercent = 20;

// Screensaver slot references use the dedicated ThemeSpec directory.
constexpr size_t kMaxScreensaverPathLen = 63;
constexpr size_t kScreensaverPathSize = kMaxScreensaverPathLen + 1;

// Marker, flags, timeout, brightness, path length, then the padded path.
constexpr size_t kRecordBytes = 5 + kMaxScreensaverPathLen;
constexpr uint8_t kRecordMarker = 1;

constexpr char kScreensaverPathPrefix[] = "/themes/s/";
constexpr size_t kScreensaverPathPrefixLen = sizeof(kScreensaverPathPrefix) - 1;

struct Settings {
  bool enabled = false;
  uint8_t timeoutMinutes = kDefaultTimeoutMinutes;
  uint8_t brightnessPercent = kDefaultBrightnessPercent;
  // Empty means no screensaver is selected yet.
  char screensaverPath[kScreensaverPathSize] = {};
};

inline uint8_t ClampTimeoutMinutes(int value) {
  if (value < kMinTimeoutMinutes) {
    return kMinTimeoutMinutes;
  }
  if (value > kMaxTimeoutMinutes) {
    return kMaxTimeoutMinutes;
  }
  return static_cast<uint8_t>(value);
}

inline uint8_t ClampBrightnessPercent(int value) {
  return device_settings::ClampBrightnessPercent(value);
}

// Syntax only. The caller still runs the shared asset path policy and checks
// that the file exists before storing a path.
inline bool ScreensaverPathValid(const char* path, size_t len) {
  if (path == nullptr || len == 0 || len > kMaxScreensaverPathLen) {
    return false;
  }
  if (len <= kScreensaverPathPrefixLen) {
    return false;
  }
  if (memcmp(path, kScreensaverPathPrefix, kScreensaverPathPrefixLen) != 0) {
    return false;
  }
  for (size_t i = 0; i < len; ++i) {
    const unsigned char ch = static_cast<unsigned char>(path[i]);
    if (ch < 0x20 || ch > 0x7E) {
      return false;
    }
  }
  if (strstr(path, "..") != nullptr) {
    return false;
  }
  return true;
}

inline void ClearScreensaverPath(Settings& settings) {
  memset(settings.screensaverPath, 0, sizeof(settings.screensaverPath));
}

inline bool HasScreensaver(const Settings& settings) {
  return settings.screensaverPath[0] != '\0';
}

// An empty path clears the slot reference and is accepted. Anything else must
// be a valid stored ThemeSpec path.
inline bool SetScreensaverPath(Settings& settings, const char* path, size_t len) {
  if (path == nullptr || len == 0) {
    ClearScreensaverPath(settings);
    return true;
  }
  if (!ScreensaverPathValid(path, len)) {
    return false;
  }
  ClearScreensaverPath(settings);
  memcpy(settings.screensaverPath, path, len);
  settings.screensaverPath[len] = '\0';
  return true;
}

inline void Encode(const Settings& settings, uint8_t* out) {
  memset(out, 0, kRecordBytes);
  out[0] = kRecordMarker;
  out[1] = settings.enabled ? 1 : 0;
  out[2] = settings.timeoutMinutes;
  out[3] = settings.brightnessPercent;
  const size_t pathLen = strnlen(settings.screensaverPath, kMaxScreensaverPathLen);
  out[4] = static_cast<uint8_t>(pathLen);
  if (pathLen > 0) {
    memcpy(out + 5, settings.screensaverPath, pathLen);
  }
}

// Returns false for a missing or foreign record, which leaves the caller with
// factory defaults. A record that carries an unusable path still decodes: the
// customer keeps their timeout and brightness and only loses the selection.
inline bool Decode(const uint8_t* data, size_t len, Settings& out) {
  if (data == nullptr || len < kRecordBytes || data[0] != kRecordMarker) {
    return false;
  }
  out = Settings{};
  out.enabled = data[1] != 0;
  out.timeoutMinutes = ClampTimeoutMinutes(data[2]);
  out.brightnessPercent = ClampBrightnessPercent(data[3]);

  const size_t pathLen = data[4];
  if (pathLen == 0 || pathLen > kMaxScreensaverPathLen) {
    return true;
  }
  char path[kScreensaverPathSize] = {};
  memcpy(path, data + 5, pathLen);
  path[pathLen] = '\0';
  if (ScreensaverPathValid(path, pathLen)) {
    memcpy(out.screensaverPath, path, pathLen + 1);
  }
  return true;
}

}  // namespace standby
}  // namespace esp8266
}  // namespace codexbar_display
