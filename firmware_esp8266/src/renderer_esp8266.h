#pragma once

#include <Arduino.h>

#include "../../firmware_shared/app_renderer.h"

namespace codexbar_display {
namespace esp8266 {

class RendererESP8266 : public app::Renderer {
 public:
  void Setup(app::RuntimeContext& ctx) override;
  void OnFrameAccepted(app::RuntimeContext& ctx, const core::SerialConsumeEvent& event) override;

  void DrawSplash(app::RuntimeContext& ctx) override;
  void TickSplash(app::RuntimeContext& ctx) override;
  void DrawStatus(app::RuntimeContext& ctx, const String& title, const String& line1, const String& line2);
  void DrawSetupInstructions(app::RuntimeContext& ctx, const String& ssid, const String& address);
  void DrawConnectedSetupInstructions(app::RuntimeContext& ctx, const String& host, const String& fallbackIp);
  void TickActive(app::RuntimeContext& ctx) override;
  void DrawError(app::RuntimeContext& ctx, const String& message) override;
  void DrawUsage(app::RuntimeContext& ctx) override;
  void DrawReset(app::RuntimeContext& ctx, int64_t remainSecs) override;
};

}  // namespace esp8266
}  // namespace codexbar_display
