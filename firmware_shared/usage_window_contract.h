#pragma once

#include <cstddef>

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

}  // namespace usage_window_contract
}  // namespace codexbar_display
