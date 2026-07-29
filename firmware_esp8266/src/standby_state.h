#pragma once

#include <stdint.h>

#include "standby_settings.h"

namespace codexbar_display {
namespace esp8266 {
namespace standby {

// When the device is idle and when it wakes again. Pure state math, no board
// calls, so it stays natively testable per docs/firmware-guardrails.md. What a
// transition renders is the caller's job.
//
// The only activity signal is a frame whose usage values changed. That one
// timer covers both "the Mac is off" (no frames at all) and "the Mac is on but
// nobody is coding" (frames arrive, values stand still) without telling the two
// cases apart, so the Companion decides nothing.

struct State {
  bool active = false;
  unsigned long lastActivityMs = 0;
};

enum class Transition : uint8_t { None, Enter, Exit };

inline unsigned long TimeoutMs(const Settings& settings) {
  return static_cast<unsigned long>(settings.timeoutMinutes) * 60UL * 1000UL;
}

inline void NoteUsageActivity(State& state, unsigned long nowMs) {
  state.lastActivityMs = nowMs;
}

// `ready` is the caller's veto: false while the device cannot hand its screen
// over, for example in WiFi setup or without a live theme it could restore.
//
// Standby is derived, never latched, so an empty screensaver slot, a disabled
// setting or a lost veto all end standby through the same path that a resumed
// frame does.
inline Transition Tick(State& state, const Settings& settings, bool ready, unsigned long nowMs) {
  const bool idle = (nowMs - state.lastActivityMs) >= TimeoutMs(settings);
  const bool wanted = settings.enabled && HasScreensaver(settings) && ready && idle;
  if (wanted == state.active) {
    return Transition::None;
  }
  state.active = wanted;
  return wanted ? Transition::Enter : Transition::Exit;
}

}  // namespace standby
}  // namespace esp8266
}  // namespace codexbar_display
