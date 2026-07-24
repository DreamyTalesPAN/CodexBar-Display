#pragma once

#include <cstdint>

namespace codexbar_display {
namespace esp8266 {
namespace wifi_recovery {

constexpr uint32_t kRetryIntervalMs = 120000UL;
constexpr uint32_t kAttemptTimeoutMs = 20000UL;

enum class Action : uint8_t {
  None,
  StartAttempt,
  Timeout,
  Connected,
};

struct State {
  bool attemptInProgress = false;
  bool retryScheduled = false;
  uint32_t attemptStartedAtMs = 0;
  uint32_t retryDueAtMs = 0;
};

struct Inputs {
  uint32_t nowMs = 0;
  bool setupMode = false;
  bool credentialsAvailable = false;
  bool busy = false;
  bool connected = false;
};

inline uint32_t elapsedMs(uint32_t nowMs, uint32_t startedAtMs) {
  return nowMs - startedAtMs;
}

inline void EnterSetup(State& state, uint32_t nowMs) {
  state = {};
  state.retryScheduled = true;
  state.retryDueAtMs = nowMs + kRetryIntervalMs;
}

inline Action Tick(State& state, const Inputs& inputs) {
  if (!inputs.setupMode) {
    state = {};
    return Action::None;
  }

  if (inputs.busy) {
    return Action::None;
  }

  if (inputs.connected) {
    state = {};
    return Action::Connected;
  }

  if (state.attemptInProgress) {
    if (elapsedMs(inputs.nowMs, state.attemptStartedAtMs) < kAttemptTimeoutMs) {
      return Action::None;
    }
    state.attemptInProgress = false;
    state.retryScheduled = true;
    state.retryDueAtMs = inputs.nowMs + kRetryIntervalMs;
    return Action::Timeout;
  }

  if (!inputs.credentialsAvailable) {
    return Action::None;
  }

  if (state.retryScheduled && elapsedMs(inputs.nowMs, state.retryDueAtMs) >= 0x80000000UL) {
    return Action::None;
  }

  state.attemptInProgress = true;
  state.retryScheduled = false;
  state.attemptStartedAtMs = inputs.nowMs;
  return Action::StartAttempt;
}

}  // namespace wifi_recovery
}  // namespace esp8266
}  // namespace codexbar_display
