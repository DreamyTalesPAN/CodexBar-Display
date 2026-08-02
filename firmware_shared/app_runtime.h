#pragma once

#include <Arduino.h>

#include "codexbar_display_core.h"
#include "device_clock.h"

namespace codexbar_display {
namespace app {

struct RuntimeContext {
  core::RuntimeState runtime;
  core::LineReaderState lineReader;
  deviceclock::DeviceClock clock;
  bool screenDirty = true;
  String topLineOverride;
  int64_t lastRenderedSecs = -1;
  int64_t lastRenderedMinuteBucket = -1;
  int64_t lastRenderedUsageWindowSecs[core::kMaxUsageWindows];
  int64_t lastRenderedUsageWindowMinuteBuckets[core::kMaxUsageWindows];

  RuntimeContext() {
    for (size_t i = 0; i < core::kMaxUsageWindows; ++i) {
      lastRenderedUsageWindowSecs[i] = -1;
      lastRenderedUsageWindowMinuteBuckets[i] = -1;
    }
  }
};

// Resolved wall clock texts, device clock first and Companion string as
// fallback. Both renderer and diagnostics read them through here.
inline deviceclock::Source ClockTimeText(const RuntimeContext& ctx, unsigned long nowMillis, char* out, size_t outSize) {
  return deviceclock::ResolveTimeText(ctx.clock, nowMillis, ctx.runtime.current.timeText.c_str(), out, outSize);
}

inline deviceclock::Source ClockDateText(const RuntimeContext& ctx, unsigned long nowMillis, char* out, size_t outSize) {
  return deviceclock::ResolveDateText(ctx.clock, nowMillis, ctx.runtime.current.dateText.c_str(), out, outSize);
}

inline core::Frame& CurrentFrame(RuntimeContext& ctx) {
  return ctx.runtime.current;
}

inline const core::Frame& CurrentFrame(const RuntimeContext& ctx) {
  return ctx.runtime.current;
}

inline bool HasFrame(const RuntimeContext& ctx) {
  return ctx.runtime.hasFrame;
}

inline int64_t CurrentRemainingSecs(const RuntimeContext& ctx, unsigned long nowMillis) {
  return core::CurrentRemainingSecs(ctx.runtime, nowMillis);
}

inline int64_t CurrentUsageWindowRemainingSecs(
    const RuntimeContext& ctx,
    size_t windowIndex,
    unsigned long nowMillis) {
  return core::CurrentUsageWindowRemainingSecs(ctx.runtime, windowIndex, nowMillis);
}

inline String FormatDuration(int64_t secs) {
  return core::FormatDuration(secs);
}

}  // namespace app
}  // namespace codexbar_display
