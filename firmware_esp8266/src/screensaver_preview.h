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
// back) and reports it as `blocked`.

constexpr unsigned long kPreviewDurationMs = 10000UL;

struct State {
  bool pending = false;
  bool showing = false;
  unsigned long showUntilMs = 0;
};

enum class Action : uint8_t { None, Show, Restore };

// A (re)selection arms exactly one preview. Selecting again while a preview
// is on screen restarts the window with the new choice.
inline void NoteSelection(State& state) {
  state.pending = true;
  state.showing = false;
  state.showUntilMs = 0;
}

inline void Cancel(State& state) {
  state = State{};
}

// `blockerOwnsRestore` is true only when the blocker has its own way back to
// the live theme (standby saves and restores the live path itself). Every
// other blocker just vetoes the preview — a preview already on screen must
// then hand the screen back immediately, or the loaded spec would silently
// stay the screensaver with nobody left to restore the live theme.
inline Action Tick(State& state, bool blocked, bool blockerOwnsRestore, unsigned long nowMs) {
  if (blocked) {
    const bool restore = state.showing && !blockerOwnsRestore;
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
