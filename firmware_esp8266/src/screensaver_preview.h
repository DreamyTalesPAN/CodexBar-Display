#pragma once

#include <stdint.h>

namespace codexbar_display {
namespace esp8266 {
namespace screensaver_preview {

// After a screensaver selection the customer sees their choice once, for a
// bounded moment, before the live theme returns. Pure state math, no board
// calls, so it stays natively testable per docs/firmware-guardrails.md. What a
// transition renders is the caller's job; the caller also owns every veto
// (standby active, setup/status surface, error frame, no live theme to hand
// back), reports it as `blocked`, and decides how to act on `Restore` — paint
// the live theme now, or hand the way back to whoever owns the screen.

constexpr unsigned long kPreviewDurationMs = 10000UL;

struct State {
  bool pending = false;
  bool showing = false;
  unsigned long showUntilMs = 0;
};

enum class Action : uint8_t { None, Show, Restore };

// A (re)selection arms exactly one preview. Selecting again while a preview
// is on screen restarts the window with the new choice, so `showing` stays
// set: that screensaver still owns the display, and the caller still holds the
// one live path it has to hand back.
inline void NoteSelection(State& state) {
  state.pending = true;
  state.showUntilMs = 0;
}

inline void Cancel(State& state) {
  state = State{};
}

inline Action Tick(State& state, bool blocked, unsigned long nowMs) {
  if (blocked) {
    // A preview that owns the display always reports the way back, whatever
    // the veto was: the loaded spec would otherwise silently stay the live
    // screen with nobody left to restore the customer's theme.
    const bool restore = state.showing;
    if (state.pending || state.showing) {
      state = State{};
    }
    return restore ? Action::Restore : Action::None;
  }
  if (state.pending) {
    state.pending = false;
    state.showing = true;
    state.showUntilMs = nowMs + kPreviewDurationMs;
    return Action::Show;
  }
  if (state.showing &&
      static_cast<long>(nowMs - state.showUntilMs) >= 0) {
    state = State{};
    return Action::Restore;
  }
  return Action::None;
}

}  // namespace screensaver_preview
}  // namespace esp8266
}  // namespace codexbar_display
