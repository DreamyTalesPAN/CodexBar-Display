#pragma once

#include <Arduino.h>
#include <TFT_eSPI.h>

#include "../../firmware_shared/app_renderer.h"

namespace vibeblock {
namespace esp32 {

class RendererESP32 : public app::Renderer {
 public:
  void Setup(app::RuntimeContext& ctx) override;
  void OnFrameAccepted(app::RuntimeContext& ctx, const core::SerialConsumeEvent& event) override;

  void DrawSplash(app::RuntimeContext& ctx) override;
  void TickSplash(app::RuntimeContext& ctx) override;
  void DrawError(app::RuntimeContext& ctx, const String& message) override;
  void DrawUsage(app::RuntimeContext& ctx) override;
  void DrawReset(app::RuntimeContext& ctx, int64_t remainSecs) override;

 private:
  TFT_eSPI tft = TFT_eSPI();

  static constexpr int kContentX = 10;
  static constexpr int kContentW = 300;
  static constexpr int kSessionLabelY = 48;
  static constexpr int kSessionBarY = 72;
  static constexpr int kWeeklyLabelY = 92;
  static constexpr int kWeeklyBarY = 116;
  static constexpr int kBarHeight = 12;
  static constexpr int kResetY = 140;
  static constexpr uint16_t kAnthropicOrange = 0xDBAA;

  void drawBar(int x, int y, int w, int h, int pct, uint16_t fillColor);
  void barColorsForProvider(const String& provider, uint16_t& sessionColor, uint16_t& weeklyColor) const;
};

}  // namespace esp32
}  // namespace vibeblock
