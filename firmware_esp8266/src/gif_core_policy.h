#pragma once

#include <stdint.h>

namespace codexbar_display {
namespace esp8266 {

struct GifFailureGuardState {
  uint8_t consecutiveFailures = 0;
  unsigned long backoffUntilMs = 0;
};

struct GifDrawRect {
  int x = 0;
  int y = 0;
  int width = 0;
  int height = 0;
};

class GifCorePolicy {
 public:
  static constexpr unsigned long kFailureBackoffMs = 30000UL;
  static constexpr uint8_t kFailureThreshold = 3;

  static bool RecordFailure(
      GifFailureGuardState& guard,
      unsigned long nowMs,
      uint8_t threshold = kFailureThreshold,
      unsigned long backoffMs = kFailureBackoffMs) {
    if (threshold == 0) {
      threshold = 1;
    }

    if (guard.consecutiveFailures < 255) {
      ++guard.consecutiveFailures;
    }

    if (guard.consecutiveFailures < threshold) {
      return false;
    }

    guard.consecutiveFailures = 0;
    guard.backoffUntilMs = nowMs + backoffMs;
    return true;
  }

  static void RecordSuccess(GifFailureGuardState& guard) {
    guard.consecutiveFailures = 0;
    guard.backoffUntilMs = 0;
  }

  static bool IsBlocked(GifFailureGuardState& guard, unsigned long nowMs) {
    if (guard.backoffUntilMs == 0) {
      return false;
    }

    if (static_cast<long>(nowMs - guard.backoffUntilMs) >= 0) {
      guard.backoffUntilMs = 0;
      return false;
    }

    return true;
  }

  static GifDrawRect FitContain(
      int boxX,
      int boxY,
      int boxWidth,
      int boxHeight,
      int sourceWidth,
      int sourceHeight) {
    GifDrawRect rect;
    rect.x = boxX;
    rect.y = boxY;
    rect.width = sourceWidth;
    rect.height = sourceHeight;

    if (boxWidth <= 0 || boxHeight <= 0 || sourceWidth <= 0 || sourceHeight <= 0) {
      return rect;
    }

    rect.width = boxWidth;
    rect.height = (sourceHeight * boxWidth) / sourceWidth;
    if (rect.height <= 0) {
      rect.height = 1;
    }

    if (rect.height > boxHeight) {
      rect.height = boxHeight;
      rect.width = (sourceWidth * boxHeight) / sourceHeight;
      if (rect.width <= 0) {
        rect.width = 1;
      }
    }

    rect.x = boxX + ((boxWidth - rect.width) / 2);
    rect.y = boxY + ((boxHeight - rect.height) / 2);
    return rect;
  }

};

}  // namespace esp8266
}  // namespace codexbar_display
