#pragma once

#include <stdint.h>

namespace codexbar_display {
namespace updatenotice {

// Firmware update notices never trigger hardware writes. This policy only
// decides when the customer-facing availability notice is visible and which
// short text phase it shows; the VibeTV Mac App owns the actual update flow.
enum class Surface : uint8_t {
  None = 0,
  // Theme has a label binding: the notice text replaces the label line and
  // stays visible (rotating) while an update is available.
  Label,
  // Theme has no label binding: a top overlay bar is shown in bounded
  // visible/hidden windows so custom themes stay mostly uncovered.
  Overlay,
};

enum class Phase : uint8_t {
  Provider = 0,
  Available,
  MacApp,
};

struct Config {
  unsigned long phaseToggleMs = 1500UL;
  unsigned long overlayVisibleMs = 10000UL;
  unsigned long overlayHiddenMs = 60000UL;
};

struct State {
  bool active = false;
  bool visible = false;
  Surface surface = Surface::None;
  uint8_t phaseIndex = 0;
  unsigned long phaseChangedAtMs = 0;
  unsigned long windowChangedAtMs = 0;
};

struct TickResult {
  // Redraw the notice with the current phase text.
  bool draw = false;
  // The notice left the screen; repaint the area it covered.
  bool restore = false;
};

inline uint8_t PhaseCount(Surface surface) {
  return surface == Surface::Label ? 3 : 2;
}

inline Phase CurrentPhase(const State& state) {
  if (state.surface == Surface::Label) {
    switch (state.phaseIndex % 3) {
      case 0:
        return Phase::Provider;
      case 1:
        return Phase::Available;
      default:
        return Phase::MacApp;
    }
  }
  return (state.phaseIndex % 2) == 0 ? Phase::Available : Phase::MacApp;
}

inline TickResult Activate(State& state, Surface surface, unsigned long nowMs) {
  TickResult result;
  if (surface == Surface::None) {
    if (state.visible) {
      result.restore = true;
    }
    state = State{};
    return result;
  }
  if (state.active && state.surface == surface) {
    return result;
  }
  if (state.visible && state.surface != surface) {
    result.restore = true;
  }
  state.active = true;
  state.surface = surface;
  state.visible = true;
  state.phaseIndex = 0;
  state.phaseChangedAtMs = nowMs;
  state.windowChangedAtMs = nowMs;
  result.draw = true;
  return result;
}

inline TickResult Deactivate(State& state) {
  TickResult result;
  result.restore = state.visible;
  state = State{};
  return result;
}

inline TickResult Tick(State& state, const Config& config, unsigned long nowMs) {
  TickResult result;
  if (!state.active) {
    return result;
  }

  if (state.surface == Surface::Overlay) {
    if (state.visible &&
        (nowMs - state.windowChangedAtMs) >= config.overlayVisibleMs) {
      state.visible = false;
      state.windowChangedAtMs = nowMs;
      result.restore = true;
      return result;
    }
    if (!state.visible) {
      if ((nowMs - state.windowChangedAtMs) >= config.overlayHiddenMs) {
        state.visible = true;
        state.phaseIndex = 0;
        state.phaseChangedAtMs = nowMs;
        state.windowChangedAtMs = nowMs;
        result.draw = true;
      }
      return result;
    }
  }

  if (state.visible &&
      (nowMs - state.phaseChangedAtMs) >= config.phaseToggleMs) {
    state.phaseChangedAtMs = nowMs;
    state.phaseIndex = static_cast<uint8_t>((state.phaseIndex + 1) % PhaseCount(state.surface));
    result.draw = true;
  }
  return result;
}

}  // namespace updatenotice
}  // namespace codexbar_display
