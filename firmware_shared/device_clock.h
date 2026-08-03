#pragma once

// Device wall clock.
//
// The device gets its own UTC time over SNTP (UDP/123). SNTP delivers UTC only,
// so the local UTC offset is learned from the Companion clock while the Mac is
// reachable and persisted; the Companion also supplies the next offset
// transition. No timezone database or libc timezone functions are needed.
//
// Everything here is pure state math so it can be tested natively. The board
// only feeds it `time(nullptr)` and `millis()`.

#include <cstddef>
#include <cstdint>
#include <cstdio>

namespace codexbar_display {
namespace deviceclock {

// 2025-01-01T00:00:00Z. Anything below means SNTP has not answered yet and the
// system clock still holds its boot value.
constexpr int64_t kMinPlausibleEpoch = 1735689600;

// The Companion attaches a fresh clock string to every frame and sends at least
// every 60 s. Two minutes without one means the Mac is gone and its
// pre-formatted string is no longer current.
constexpr unsigned long kCompanionClockMaxAgeMs = 120000UL;

// Shown instead of a stale value when neither source is trustworthy.
constexpr const char* kUnknownTimeText = "--:--";
constexpr const char* kUnknownDateText = "--.--.----";

constexpr size_t kTimeTextSize = 6;
constexpr size_t kDateTextSize = 11;

// Real UTC offsets are whole quarter hours between -12:00 and +14:00.
constexpr int kMinUtcOffsetMinutes = -720;
constexpr int kMaxUtcOffsetMinutes = 840;

enum class Source : uint8_t {
  Unknown = 0,
  Device = 1,
  Companion = 2,
};

struct DeviceClock {
  bool synced = false;
  int64_t syncEpoch = 0;
  unsigned long syncMillis = 0;
  unsigned long syncCount = 0;
  bool hasUtcOffset = false;
  int16_t utcOffsetMinutes = 0;
  bool hasCompanionClock = false;
  unsigned long companionSeenAtMs = 0;
  bool hasUtcOffsetTransition = false;
  int64_t utcOffsetTransitionEpoch = 0;
  int16_t utcOffsetTransitionMinutes = 0;
};

inline int64_t UtcNow(const DeviceClock& clock, unsigned long nowMillis) {
  if (!clock.synced) {
    return 0;
  }
  const unsigned long elapsedMillis = nowMillis - clock.syncMillis;
  return clock.syncEpoch + static_cast<int64_t>(elapsedMillis / 1000UL);
}

// Feeds the system epoch (SNTP result). Returns true when this sample
// established or corrected the clock, which is also the "last sync" moment.
inline bool ObserveSystemEpoch(DeviceClock& clock, int64_t epoch, unsigned long nowMillis) {
  if (epoch < kMinPlausibleEpoch) {
    return false;
  }
  if (clock.synced) {
    const int64_t drift = epoch - UtcNow(clock, nowMillis);
    if (drift > -2 && drift < 2) {
      return false;
    }
  }
  clock.synced = true;
  clock.syncEpoch = epoch;
  clock.syncMillis = nowMillis;
  clock.syncCount++;
  return true;
}

inline bool UtcOffsetValid(int offsetMinutes) {
  return offsetMinutes >= kMinUtcOffsetMinutes &&
         offsetMinutes <= kMaxUtcOffsetMinutes &&
         (offsetMinutes % 15) == 0;
}

// Parses the Companion clock string `HH:MM` into minutes since local midnight.
inline bool ParseCompanionTime(const char* text, int& outMinutesOfDay) {
  if (text == nullptr) {
    return false;
  }
  if (text[0] < '0' || text[0] > '9' || text[1] < '0' || text[1] > '9' ||
      text[2] != ':' ||
      text[3] < '0' || text[3] > '9' || text[4] < '0' || text[4] > '9' ||
      text[5] != '\0') {
    return false;
  }
  const int hours = (text[0] - '0') * 10 + (text[1] - '0');
  const int minutes = (text[3] - '0') * 10 + (text[4] - '0');
  if (hours > 23 || minutes > 59) {
    return false;
  }
  outMinutesOfDay = hours * 60 + minutes;
  return true;
}

// Feeds the Companion clock and its validated current UTC offset from an
// accepted frame. The date remains a separate Companion fallback for display;
// no calendar math is needed on the device.
inline bool ObserveCompanionClock(
    DeviceClock& clock,
    const char* timeText,
    bool hasCurrentOffset,
    int currentOffsetMinutes,
    unsigned long nowMillis) {
  int localMinutesOfDay = 0;
  if (!ParseCompanionTime(timeText, localMinutesOfDay)) {
    return false;
  }
  clock.hasCompanionClock = true;
  clock.companionSeenAtMs = nowMillis;
  if (!clock.synced) {
    return false;
  }
  if (!hasCurrentOffset || !UtcOffsetValid(currentOffsetMinutes)) {
    return false;
  }
  if (clock.hasUtcOffset && clock.utcOffsetMinutes == currentOffsetMinutes) {
    return false;
  }
  clock.hasUtcOffset = true;
  clock.utcOffsetMinutes = static_cast<int16_t>(currentOffsetMinutes);
  return true;
}

inline bool RestoreUtcOffset(DeviceClock& clock, int offsetMinutes) {
  if (!UtcOffsetValid(offsetMinutes)) {
    return false;
  }
  clock.hasUtcOffset = true;
  clock.utcOffsetMinutes = static_cast<int16_t>(offsetMinutes);
  return true;
}

// The Companion provides only the next transition. The device stores it until
// its own SNTP epoch reaches the UTC instant, then consumes it exactly once.
inline bool ObserveUtcOffsetTransition(
    DeviceClock& clock,
    int64_t transitionEpoch,
    int offsetMinutes) {
  if (transitionEpoch < kMinPlausibleEpoch || !UtcOffsetValid(offsetMinutes)) {
    return false;
  }
  if (clock.hasUtcOffsetTransition &&
      clock.utcOffsetTransitionEpoch == transitionEpoch &&
      clock.utcOffsetTransitionMinutes == offsetMinutes) {
    return false;
  }
  clock.hasUtcOffsetTransition = true;
  clock.utcOffsetTransitionEpoch = transitionEpoch;
  clock.utcOffsetTransitionMinutes = static_cast<int16_t>(offsetMinutes);
  return true;
}

inline bool ClearUtcOffsetTransition(DeviceClock& clock) {
  if (!clock.hasUtcOffsetTransition) {
    return false;
  }
  clock.hasUtcOffsetTransition = false;
  clock.utcOffsetTransitionEpoch = 0;
  clock.utcOffsetTransitionMinutes = 0;
  return true;
}

inline bool ApplyDueUtcOffsetTransition(DeviceClock& clock, int64_t utcEpoch) {
  if (!clock.hasUtcOffsetTransition || utcEpoch < clock.utcOffsetTransitionEpoch) {
    return false;
  }
  clock.hasUtcOffset = true;
  clock.utcOffsetMinutes = clock.utcOffsetTransitionMinutes;
  ClearUtcOffsetTransition(clock);
  return true;
}

inline bool RestoreUtcOffsetTransition(
    DeviceClock& clock,
    int64_t transitionEpoch,
    int offsetMinutes) {
  return ObserveUtcOffsetTransition(clock, transitionEpoch, offsetMinutes);
}

// True when the device can name the local wall clock on its own.
inline bool LocalClockUsable(const DeviceClock& clock) {
  return clock.synced && clock.hasUtcOffset;
}

inline int64_t LocalNow(const DeviceClock& clock, unsigned long nowMillis) {
  if (!LocalClockUsable(clock)) {
    return 0;
  }
  return UtcNow(clock, nowMillis) + static_cast<int64_t>(clock.utcOffsetMinutes) * 60;
}

inline bool CompanionClockFresh(const DeviceClock& clock, unsigned long nowMillis) {
  return clock.hasCompanionClock &&
         (nowMillis - clock.companionSeenAtMs) <= kCompanionClockMaxAgeMs;
}

inline int64_t FloorDiv(int64_t value, int64_t divisor) {
  const int64_t quotient = value / divisor;
  return (value % divisor != 0 && ((value < 0) != (divisor < 0))) ? quotient - 1 : quotient;
}

// days -> civil date (Howard Hinnant's algorithm, epoch shifted to 0000-03-01).
inline void CivilFromDays(int64_t days, int& outYear, int& outMonth, int& outDay) {
  days += 719468;
  const int64_t era = FloorDiv(days, 146097);
  const int64_t dayOfEra = days - era * 146097;
  const int64_t yearOfEra =
      (dayOfEra - dayOfEra / 1460 + dayOfEra / 36524 - dayOfEra / 146096) / 365;
  const int64_t year = yearOfEra + era * 400;
  const int64_t dayOfYear = dayOfEra - (365 * yearOfEra + yearOfEra / 4 - yearOfEra / 100);
  const int64_t mp = (5 * dayOfYear + 2) / 153;
  outDay = static_cast<int>(dayOfYear - (153 * mp + 2) / 5 + 1);
  outMonth = static_cast<int>(mp < 10 ? mp + 3 : mp - 9);
  outYear = static_cast<int>(outMonth <= 2 ? year + 1 : year);
}

inline bool FormatLocalTime(const DeviceClock& clock, unsigned long nowMillis, char* out, size_t outSize) {
  if (out == nullptr || outSize < kTimeTextSize || !LocalClockUsable(clock)) {
    return false;
  }
  const int64_t local = LocalNow(clock, nowMillis);
  const int minutesOfDay = static_cast<int>(FloorDiv(local, 60) % 1440);
  std::snprintf(out, outSize, "%02d:%02d", minutesOfDay / 60, minutesOfDay % 60);
  return true;
}

inline bool FormatLocalDate(const DeviceClock& clock, unsigned long nowMillis, char* out, size_t outSize) {
  if (out == nullptr || outSize < kDateTextSize || !LocalClockUsable(clock)) {
    return false;
  }
  int year = 0;
  int month = 0;
  int day = 0;
  CivilFromDays(FloorDiv(LocalNow(clock, nowMillis), 86400), year, month, day);
  std::snprintf(out, outSize, "%02d.%02d.%04d", day, month, year);
  return true;
}

// Device clock first, fresh Companion string second, honest placeholder last.
inline Source ResolveTimeText(
    const DeviceClock& clock,
    unsigned long nowMillis,
    const char* companionText,
    char* out,
    size_t outSize) {
  if (FormatLocalTime(clock, nowMillis, out, outSize)) {
    return Source::Device;
  }
  if (companionText != nullptr && companionText[0] != '\0' && CompanionClockFresh(clock, nowMillis)) {
    std::snprintf(out, outSize, "%s", companionText);
    return Source::Companion;
  }
  std::snprintf(out, outSize, "%s", kUnknownTimeText);
  return Source::Unknown;
}

inline Source ResolveDateText(
    const DeviceClock& clock,
    unsigned long nowMillis,
    const char* companionText,
    char* out,
    size_t outSize) {
  if (FormatLocalDate(clock, nowMillis, out, outSize)) {
    return Source::Device;
  }
  if (companionText != nullptr && companionText[0] != '\0' && CompanionClockFresh(clock, nowMillis)) {
    std::snprintf(out, outSize, "%s", companionText);
    return Source::Companion;
  }
  std::snprintf(out, outSize, "%s", kUnknownDateText);
  return Source::Unknown;
}

inline const char* SourceName(Source source) {
  switch (source) {
    case Source::Device:
      return "device";
    case Source::Companion:
      return "companion";
    default:
      return "unknown";
  }
}

// Persisted UTC offset record appended to the device settings blob.
constexpr size_t kUtcOffsetRecordBytes = 3;

inline void EncodeUtcOffset(const DeviceClock& clock, uint8_t* out) {
  const uint16_t raw = static_cast<uint16_t>(clock.utcOffsetMinutes);
  out[0] = clock.hasUtcOffset ? 1 : 0;
  out[1] = static_cast<uint8_t>(raw & 0xFF);
  out[2] = static_cast<uint8_t>((raw >> 8) & 0xFF);
}

inline bool DecodeUtcOffset(const uint8_t* data, size_t len, int& outOffsetMinutes) {
  if (data == nullptr || len < kUtcOffsetRecordBytes || data[0] != 1) {
    return false;
  }
  const int16_t offset =
      static_cast<int16_t>(static_cast<uint16_t>(data[1]) | (static_cast<uint16_t>(data[2]) << 8));
  if (!UtcOffsetValid(offset)) {
    return false;
  }
  outOffsetMinutes = offset;
  return true;
}

// Appended after the existing settings record: epoch (little-endian uint64)
// followed by the offset that becomes active at that epoch (little-endian int16).
constexpr size_t kUtcOffsetTransitionRecordBytes = 10;

inline void EncodeUtcOffsetTransition(const DeviceClock& clock, uint8_t* out) {
  const uint64_t epoch = clock.hasUtcOffsetTransition
                             ? static_cast<uint64_t>(clock.utcOffsetTransitionEpoch)
                             : 0;
  for (size_t i = 0; i < 8; ++i) {
    out[i] = static_cast<uint8_t>((epoch >> (i * 8)) & 0xFF);
  }
  const uint16_t offset = static_cast<uint16_t>(
      clock.hasUtcOffsetTransition ? clock.utcOffsetTransitionMinutes : 0);
  out[8] = static_cast<uint8_t>(offset & 0xFF);
  out[9] = static_cast<uint8_t>((offset >> 8) & 0xFF);
}

inline bool DecodeUtcOffsetTransition(
    const uint8_t* data,
    size_t len,
    int64_t& outEpoch,
    int& outOffsetMinutes) {
  if (data == nullptr || len < kUtcOffsetTransitionRecordBytes) {
    return false;
  }
  uint64_t rawEpoch = 0;
  for (size_t i = 0; i < 8; ++i) {
    rawEpoch |= static_cast<uint64_t>(data[i]) << (i * 8);
  }
  const int16_t offset = static_cast<int16_t>(
      static_cast<uint16_t>(data[8]) | (static_cast<uint16_t>(data[9]) << 8));
  if (rawEpoch == 0 || rawEpoch > static_cast<uint64_t>(INT64_MAX) ||
      rawEpoch < static_cast<uint64_t>(kMinPlausibleEpoch) ||
      !UtcOffsetValid(offset)) {
    return false;
  }
  outEpoch = static_cast<int64_t>(rawEpoch);
  outOffsetMinutes = offset;
  return true;
}

}  // namespace deviceclock
}  // namespace codexbar_display
