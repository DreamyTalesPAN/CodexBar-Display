#include "renderer_esp32.h"

#include "../../firmware_shared/vibeblock_core.h"

namespace vibeblock {
namespace esp32 {

void RendererESP32::Setup(app::RuntimeContext&) {
#ifdef TFT_BL
  pinMode(TFT_BL, OUTPUT);
  digitalWrite(TFT_BL, TFT_BACKLIGHT_ON);
#endif
  // LilyGO T-Display-S3 requires GPIO15 high to power the LCD panel.
  pinMode(15, OUTPUT);
  digitalWrite(15, HIGH);

  tft.init();
  tft.setRotation(1);
}

void RendererESP32::OnFrameAccepted(app::RuntimeContext& ctx, const core::SerialConsumeEvent& event) {
  if (event.visualChanged) {
    ctx.screenDirty = true;
  }
}

void RendererESP32::DrawSplash(app::RuntimeContext& ctx) {
  tft.fillScreen(TFT_BLACK);
  tft.setTextColor(TFT_WHITE, TFT_BLACK);
  tft.setTextFont(2);
  tft.setCursor(14, 40);
  tft.println("vibeblock 1");
  tft.setCursor(14, 80);
  tft.setTextColor(TFT_LIGHTGREY, TFT_BLACK);
  tft.println("Waiting for CodexBar...");
  ctx.lastRenderedSecs = -1;
  ctx.lastRenderedMinuteBucket = -1;
}

void RendererESP32::TickSplash(app::RuntimeContext&) {
  // ESP32 splash is static for now.
}

void RendererESP32::DrawError(app::RuntimeContext& ctx, const String& message) {
  tft.fillScreen(TFT_BLACK);
  tft.setTextFont(2);
  tft.setTextColor(TFT_ORANGE, TFT_BLACK);
  tft.setCursor(10, 16);
  tft.println("vibeblock error");

  tft.setTextColor(TFT_WHITE, TFT_BLACK);
  tft.setCursor(10, 48);
  tft.println(message);

  ctx.lastRenderedSecs = -1;
  ctx.lastRenderedMinuteBucket = -1;
}

void RendererESP32::DrawUsage(app::RuntimeContext& ctx) {
  const core::Frame& current = app::CurrentFrame(ctx);
  const int64_t remain = app::CurrentRemainingSecs(ctx, millis());
  uint16_t sessionColor = TFT_CYAN;
  uint16_t weeklyColor = TFT_GREEN;
  barColorsForProvider(current.provider, sessionColor, weeklyColor);

  tft.fillScreen(TFT_BLACK);
  tft.setTextFont(4);
  tft.setTextColor(TFT_WHITE, TFT_BLACK);
  tft.setCursor(kContentX, 10);
  tft.println(current.label.length() ? current.label : "Provider");

  tft.setTextFont(4);
  tft.setTextColor(TFT_LIGHTGREY, TFT_BLACK);
  tft.setCursor(kContentX, kSessionLabelY);
  tft.printf("Session %d%% used", current.session);
  drawBar(kContentX, kSessionBarY, kContentW, kBarHeight, current.session, sessionColor);

  tft.setCursor(kContentX, kWeeklyLabelY);
  tft.printf("Weekly %d%% used", current.weekly);
  drawBar(kContentX, kWeeklyBarY, kContentW, kBarHeight, current.weekly, weeklyColor);

  DrawReset(ctx, remain);
}

void RendererESP32::DrawReset(app::RuntimeContext& ctx, int64_t remainSecs) {
  tft.fillRect(kContentX, kResetY, kContentW, 28, TFT_BLACK);
  tft.setTextColor(TFT_WHITE, TFT_BLACK);
  tft.setTextFont(4);
  tft.setCursor(kContentX, kResetY);
  tft.printf("Reset in %s", app::FormatDuration(remainSecs).c_str());

  ctx.lastRenderedSecs = remainSecs;
  ctx.lastRenderedMinuteBucket = remainSecs / 60;
}

void RendererESP32::barColorsForProvider(const String& provider, uint16_t& sessionColor, uint16_t& weeklyColor) const {
  sessionColor = TFT_CYAN;
  weeklyColor = TFT_GREEN;

  String p = provider;
  p.toLowerCase();
  if (p == "codex") {
    sessionColor = TFT_WHITE;
    weeklyColor = TFT_WHITE;
    return;
  }
  if (p == "claude") {
    sessionColor = kAnthropicOrange;
    weeklyColor = kAnthropicOrange;
  }
}

void RendererESP32::drawBar(int x, int y, int w, int h, int pct, uint16_t fillColor) {
  const int p = core::ClampPct(pct);
  int filled = (w * p) / 100;

  tft.drawRect(x, y, w, h, TFT_DARKGREY);
  tft.fillRect(x + 1, y + 1, w - 2, h - 2, TFT_BLACK);
  if (filled > 0) {
    if (filled > (w - 2)) {
      filled = w - 2;
    }
    tft.fillRect(x + 1, y + 1, filled, h - 2, fillColor);
  }
}

}  // namespace esp32
}  // namespace vibeblock
