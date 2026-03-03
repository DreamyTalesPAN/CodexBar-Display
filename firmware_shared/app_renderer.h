#pragma once

#include <Arduino.h>

#include "app_runtime.h"

namespace codexbar_display {
namespace app {

class Renderer {
 public:
  virtual ~Renderer() = default;

  virtual void Setup(RuntimeContext& ctx) = 0;
  virtual void OnFrameAccepted(RuntimeContext& ctx, const core::SerialConsumeEvent& event) = 0;

  virtual void DrawSplash(RuntimeContext& ctx) = 0;
  virtual void TickSplash(RuntimeContext& ctx) = 0;
  virtual void TickActive(RuntimeContext& ctx) { (void)ctx; }
  virtual void DrawError(RuntimeContext& ctx, const String& message) = 0;
  virtual void DrawUsage(RuntimeContext& ctx) = 0;
  virtual void DrawReset(RuntimeContext& ctx, int64_t remainSecs) = 0;
};

}  // namespace app
}  // namespace codexbar_display
