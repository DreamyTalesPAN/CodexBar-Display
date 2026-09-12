#pragma once

#include <stddef.h>
#include <stdint.h>

namespace codexbar_display::esp8266::cable_transfer {

struct State {
  bool active = false;
  size_t expectedBytes = 0;
  size_t receivedBytes = 0;
  int nextSequence = 0;
  uint32_t lastChecksum = 0;
  unsigned long lastActivityAtMs = 0;
};

enum class ChunkDecision : uint8_t {
  kReject = 0,
  kDuplicate = 1,
  kAccept = 2,
};

inline void Begin(State& state, size_t expectedBytes, unsigned long nowMs) {
  state = State{};
  state.active = expectedBytes > 0;
  state.expectedBytes = expectedBytes;
  state.lastActivityAtMs = nowMs;
}

inline ChunkDecision CheckChunk(
    const State& state,
    int sequence,
    size_t bytes,
    uint32_t expectedChecksum,
    uint32_t actualChecksum) {
  if (!state.active) {
    return ChunkDecision::kReject;
  }
  if (sequence + 1 == state.nextSequence &&
      expectedChecksum == state.lastChecksum) {
    return ChunkDecision::kDuplicate;
  }
  if (sequence != state.nextSequence || bytes == 0 ||
      state.receivedBytes + bytes > state.expectedBytes ||
      expectedChecksum != actualChecksum) {
    return ChunkDecision::kReject;
  }
  return ChunkDecision::kAccept;
}

inline void AcceptChunk(
    State& state,
    size_t bytes,
    uint32_t checksum,
    unsigned long nowMs) {
  state.receivedBytes += bytes;
  state.nextSequence++;
  state.lastChecksum = checksum;
  state.lastActivityAtMs = nowMs;
}

inline bool CanFinish(const State& state, bool hashMatches) {
  return state.active && state.receivedBytes == state.expectedBytes &&
         hashMatches;
}

inline bool Expired(
    const State& state,
    unsigned long nowMs,
    unsigned long timeoutMs) {
  return state.active && nowMs - state.lastActivityAtMs > timeoutMs;
}

}  // namespace codexbar_display::esp8266::cable_transfer
