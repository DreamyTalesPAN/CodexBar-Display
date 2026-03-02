#pragma once

#include <stdint.h>
#include <string.h>

namespace vibeblock {
namespace esp8266 {

struct GifFailureGuardState {
  uint8_t consecutiveFailures = 0;
  unsigned long backoffUntilMs = 0;
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

  static bool RequestChanged(
      const char* currentPath,
      uint8_t currentLayout,
      uint8_t currentSlot,
      const char* requestedPath,
      uint8_t requestedLayout,
      uint8_t requestedSlot) {
    const char* current = currentPath != nullptr ? currentPath : "";
    const char* requested = requestedPath != nullptr ? requestedPath : "";

    if (strcmp(current, requested) != 0) {
      return true;
    }
    if (currentLayout != requestedLayout) {
      return true;
    }
    if (currentSlot != requestedSlot) {
      return true;
    }
    return false;
  }
};

}  // namespace esp8266
}  // namespace vibeblock
