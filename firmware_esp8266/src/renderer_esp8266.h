#pragma once

#include <Arduino.h>

#include "../../firmware_shared/app_renderer.h"

namespace vibeblock {
namespace esp8266 {

class RendererESP8266 : public app::Renderer {
 public:
  void Setup(app::RuntimeContext& ctx) override;
  void OnFrameAccepted(app::RuntimeContext& ctx, const core::SerialConsumeEvent& event) override;

  void DrawSplash(app::RuntimeContext& ctx) override;
  void TickSplash(app::RuntimeContext& ctx) override;
  void DrawError(app::RuntimeContext& ctx, const String& message) override;
  void DrawUsage(app::RuntimeContext& ctx) override;
  void DrawReset(app::RuntimeContext& ctx, int64_t remainSecs) override;
};

}  // namespace esp8266
}  // namespace vibeblock

