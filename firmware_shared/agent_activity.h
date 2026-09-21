#pragma once

#include <cstring>
#include <cstdio>
#include <cstdint>

namespace codexbar_display {
namespace agentactivity {

// Presentation groups preserve the observer's original phase on the wire.
enum class State : uint8_t { Unknown, Idle, Working, NeedsYou, Done, Error };
inline State DisplayState(const char* phase) {
  if (phase == nullptr) return State::Unknown;
  static const struct { const char* phase; State state; } phases[] = {
    {"idle", State::Idle},
    {"coding", State::Working}, {"working", State::Working},
    {"thinking", State::Working}, {"tool_use", State::Working},
    {"compacting", State::Working},
    {"waiting_for_permission", State::NeedsYou},
    {"waiting_for_answer", State::NeedsYou},
    {"waiting_for_review", State::NeedsYou},
    {"done", State::Done}, {"error", State::Error},
  };
  for (const auto& item : phases) {
    if (std::strcmp(phase, item.phase) == 0) return item.state;
  }
  return State::Unknown;
}
inline bool IsWorking(const char* value) { return DisplayState(value) == State::Working; }

inline bool HasLease(const char* value) {
  if (value == nullptr || std::strcmp(value, "coding") == 0) return false;
  return DisplayState(value) > State::Idle || std::strcmp(value, "stale") == 0;
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
  bool Update(const char* phase, bool enabled, bool dedicated, uint32_t now, uint16_t reminderSecs = 0) {
    const State state = DisplayState(phase);
    const bool eligible = enabled && !dedicated &&
        state != State::Idle && state != State::Unknown;
    if (!initialized || !eligible) startedAt = now;
    if (initialized && state != previous) {
      running = eligible;
      startedAt = now;
    } else if (initialized && eligible && state == State::NeedsYou && reminderSecs > 0 &&
               now - startedAt >= static_cast<uint32_t>(reminderSecs) * 1000UL) {
      running = true;
      startedAt = now;
    }
    initialized = true;
    previous = state;
    const uint32_t elapsed = now - startedAt;
    if (!eligible || elapsed >= 550) running = false;
    return running && (elapsed < 200 || elapsed >= 350);
  }
};
}  // namespace agentactivity
}  // namespace codexbar_display
