#pragma once

#include <cstddef>
#include <cstdint>

namespace codexbar_display {
namespace usage_window_contract {

// The host trims frames to this device-advertised limit.
constexpr size_t kMaxWindows = 3;

// Percent values are clamped to 0..100 before they are drawn or sent.
inline int ClampPct(int value) {
  if (value < 0) {
    return 0;
  }
  if (value > 100) {
    return 100;
  }
  return value;
}

// CodexBar's pace state tokens (usage-pace-v1), as the wire carries them. A
// pace's state is the index here; 0 means the host sent none.
constexpr uint8_t kPaceReserve = 1;
constexpr uint8_t kPaceOnPace = 2;
constexpr uint8_t kPaceDeficit = 3;
inline const char* PaceState(uint8_t state) {
  static const char* const kStates[] = {"", "reserve", "on pace", "deficit"};
  return state <= kPaceDeficit ? kStates[state] : "";
}

// How far a pace bar's plan tick reaches beyond the bar or ring it marks.
constexpr int kPaceTickOverhang = 3;

// What CodexBar projects for a window's quota; 0: nothing.
constexpr uint8_t kPaceRunsOut = 1;
constexpr uint8_t kPaceLastsToReset = 2;

// CodexBar's pace for one usage window.
struct Pace {
  int16_t delta = 0;  // CodexBar deltaPercent: < 0 in reserve, > 0 in deficit
  uint8_t state = 0;  // kPaceReserve..kPaceDeficit, 0: the host sent none
  uint8_t lasts = 0;  // kPaceRunsOut / kPaceLastsToReset, 0: projects nothing

  bool operator!=(const Pace& other) const {
    return delta != other.delta || state != other.state || lasts != other.lasts;
  }
};

}  // namespace usage_window_contract
}  // namespace codexbar_display
