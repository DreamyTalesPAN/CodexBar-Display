#pragma once

#include <stddef.h>
#include <stdint.h>
#include <string.h>

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

inline int HexNibble(char value) {
  if (value >= '0' && value <= '9') {
    return value - '0';
  }
  if (value >= 'a' && value <= 'f') {
    return value - 'a' + 10;
  }
  if (value >= 'A' && value <= 'F') {
    return value - 'A' + 10;
  }
  return -1;
}

inline int Base64Value(char value) {
  if (value >= 'A' && value <= 'Z') {
    return value - 'A';
  }
  if (value >= 'a' && value <= 'z') {
    return value - 'a' + 26;
  }
  if (value >= '0' && value <= '9') {
    return value - '0' + 52;
  }
  if (value == '+') {
    return 62;
  }
  if (value == '/') {
    return 63;
  }
  return -1;
}

// Decodes one chunk: cable-transfer-v1 sends `hex`, v2 sends `base64` instead.
// Returns the decoded length, or 0 for anything malformed or over capacity, so
// a damaged line is rejected before its checksum is even compared.
inline size_t DecodeChunk(
    const char* hex,
    const char* base64,
    uint8_t* out,
    size_t capacity) {
  if (base64 != nullptr && base64[0] != '\0') {
    const size_t length = strlen(base64);
    if (length % 4 != 0) {
      return 0;
    }
    size_t written = 0;
    for (size_t i = 0; i < length; i += 4) {
      const bool last = i + 4 == length;
      size_t bytes = 3;
      if (last && base64[i + 2] == '=') {
        if (base64[i + 3] != '=') {
          return 0;
        }
        bytes = 1;
      } else if (last && base64[i + 3] == '=') {
        bytes = 2;
      }
      uint32_t group = 0;
      for (size_t k = 0; k < 4; ++k) {
        const int value = k > bytes ? 0 : Base64Value(base64[i + k]);
        if (value < 0) {
          return 0;
        }
        group = (group << 6) | static_cast<uint32_t>(value);
      }
      if (written + bytes > capacity) {
        return 0;
      }
      for (size_t k = 0; k < bytes; ++k) {
        out[written++] = static_cast<uint8_t>(group >> (16 - 8 * k));
      }
    }
    return written;
  }
  const size_t length = hex == nullptr ? 0 : strlen(hex);
  if (length == 0 || length % 2 != 0 || length / 2 > capacity) {
    return 0;
  }
  for (size_t i = 0; i < length / 2; ++i) {
    const int high = HexNibble(hex[i * 2]);
    const int low = HexNibble(hex[i * 2 + 1]);
    if (high < 0 || low < 0) {
      return 0;
    }
    out[i] = static_cast<uint8_t>((high << 4) | low);
  }
  return length / 2;
}

inline bool Expired(
    const State& state,
    unsigned long nowMs,
    unsigned long timeoutMs) {
  return state.active && nowMs - state.lastActivityAtMs > timeoutMs;
}

}  // namespace codexbar_display::esp8266::cable_transfer
