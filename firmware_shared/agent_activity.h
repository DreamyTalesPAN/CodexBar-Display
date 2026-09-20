#pragma once

#include <cstring>
#include <cstdio>
#include <cstdint>

namespace codexbar_display {
namespace agentactivity {

inline bool IsWorking(const char* value) {
  if (value == nullptr) return false;
  return std::strcmp(value, "coding") == 0 ||
      std::strcmp(value, "working") == 0 ||
      std::strcmp(value, "thinking") == 0 ||
      std::strcmp(value, "tool_use") == 0 ||
      std::strcmp(value, "compacting") == 0;
}

inline bool HasLease(const char* value) {
  if (value == nullptr) return false;
  return (IsWorking(value) && std::strcmp(value, "coding") != 0) ||
      std::strcmp(value, "waiting_for_permission") == 0 ||
      std::strcmp(value, "waiting_for_answer") == 0 ||
      std::strcmp(value, "waiting_for_review") == 0 ||
      std::strcmp(value, "done") == 0 ||
      std::strcmp(value, "error") == 0 ||
      std::strcmp(value, "stale") == 0;
}

// Presentation groups preserve the observer's original phase on the wire.
enum class State { Unknown, Idle, Working, NeedsYou, Done, Error };
inline State DisplayState(const char* phase) {
  if (phase == nullptr) return State::Unknown;
  if (IsWorking(phase)) return State::Working;
  if (std::strcmp(phase, "idle") == 0) return State::Idle;
  if (std::strcmp(phase, "waiting_for_permission") == 0 ||
      std::strcmp(phase, "waiting_for_answer") == 0 ||
      std::strcmp(phase, "waiting_for_review") == 0) return State::NeedsYou;
  if (std::strcmp(phase, "done") == 0) return State::Done;
  if (std::strcmp(phase, "error") == 0) return State::Error;
  return State::Unknown;
}
inline void StatusText(const char* phase, const char* name, char* out, size_t size) {
  const State state = DisplayState(phase);
  if (state == State::Idle) { std::snprintf(out, size, "Nothing running"); return; }
  if (state == State::Unknown) { std::snprintf(out, size, "Agent status unavailable"); return; }
  const char* suffix = state == State::Working ? "is working" :
      state == State::NeedsYou ? "needs you" : state == State::Done ? "is done" : "hit an error";
  std::snprintf(out, size, "%.40s %s", name != nullptr && name[0] ? name : "Agent", suffix);
}

// Observe every frame/tick. The first observation establishes a baseline, so
// activation/reconnect cannot replay a completion. No heap or framebuffer.
struct Announcement {
  State previous = State::Unknown;
  bool initialized = false;
  bool running = false;
  uint32_t startedAt = 0;
  bool Update(const char* phase, bool enabled, bool dedicated, uint32_t now) {
    const State state = DisplayState(phase);
    if (initialized && state != previous) {
      running = enabled && !dedicated && state != State::Idle && state != State::Unknown;
      startedAt = now;
    }
    initialized = true;
    previous = state;
    if (!enabled || dedicated || state == State::Idle || state == State::Unknown) running = false;
    const uint32_t elapsed = now - startedAt;
    if (elapsed >= 550) running = false;
    return running && (elapsed < 200 || elapsed >= 350);
  }
};
}  // namespace agentactivity
}  // namespace codexbar_display
