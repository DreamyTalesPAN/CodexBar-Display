#pragma once

#include <cstddef>
#include <cstdint>

namespace codexbar_display {
namespace usage_window_contract {

// The host trims frames to this device-advertised limit.
constexpr size_t kMaxWindows = 3;

// CodexBar's words for a window's pace (usage-pace-v1): the wire state tokens
// at 1..3, then whether the current pace lasts until the window's reset.
constexpr uint8_t kPaceRunsOut = 4;
constexpr uint8_t kPaceLasts = 5;
inline const char* PaceText(uint8_t index) {
  static const char* const kTexts[] = {"", "reserve", "on pace", "deficit", "runs out", "lasts until reset"};
  return index <= kPaceLasts ? kTexts[index] : "";
}

// CodexBar's pace for one usage window. state 0: the host sent none.
struct Pace {
  int16_t delta = 0;  // CodexBar deltaPercent: < 0 in reserve, > 0 in deficit
  uint8_t state = 0;  // PaceText 1..3
  uint8_t lasts = 0;  // 0 when CodexBar projects nothing, else kPaceRunsOut/kPaceLasts

  bool operator!=(const Pace& other) const {
    return delta != other.delta || state != other.state || lasts != other.lasts;
  }
};

}  // namespace usage_window_contract
}  // namespace codexbar_display
