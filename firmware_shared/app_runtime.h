#pragma once

#include <Arduino.h>

#include "vibeblock_core.h"

namespace vibeblock {
namespace app {

struct RuntimeContext {
  core::RuntimeState runtime;
  core::LineReaderState lineReader;
  bool screenDirty = true;
  int64_t lastRenderedSecs = -1;
  int64_t lastRenderedMinuteBucket = -1;
};

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

inline String FormatDuration(int64_t secs) {
  return core::FormatDuration(secs);
}

}  // namespace app
}  // namespace vibeblock

