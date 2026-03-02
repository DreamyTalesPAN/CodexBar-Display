#include "renderer_esp8266_display_state.h"

#ifndef VIBEBLOCK_PROBE_ONLY

#include <cstdio>

namespace vibeblock {
namespace esp8266 {
namespace display {

namespace {

constexpr uint16_t rgb565(uint8_t r, uint8_t g, uint8_t b) {
  return static_cast<uint16_t>(((r & 0xF8U) << 8) | ((g & 0xFCU) << 3) | (b >> 3));
}

constexpr const char* kMiniGifPath = "/mini.gif";
constexpr int kMiniGifMargin = 8;
constexpr int kMiniFallbackGifSize = 64;
constexpr uint16_t kMiniBg = TFT_BLACK;
constexpr uint16_t kMiniPrimary = rgb565(92, 204, 255);
constexpr uint16_t kMiniSecondary = rgb565(167, 255, 201);
constexpr uint16_t kMiniMuted = rgb565(121, 131, 148);

const GifPlaybackRequest& miniThemeGifRequest() {
  static constexpr GifPlaybackRequest kMiniThemeGifRequest = {
      kMiniGifPath,
      GifLayoutMode::BottomRightMini,
      GifFailureSlot::MiniTheme,
  };
  return kMiniThemeGifRequest;
}

void drawResetCountdownLineMini(int64_t remain) {
  TFT_eSPI& tft = Tft();

  const int contentRight = tft.width() - MiniGifReservedWidth() - (kMiniGifMargin * 2);
  const int maxWidth = contentRight > 100 ? contentRight : (tft.width() - 12);
  const int resetY = 212;
  const int resetH = 24;
  const String resetLabel = String("Reset ") + FormatDuration(remain);
  const int resetTextSize = ChooseTextSizeToFit(resetLabel.c_str(), 2, 1, maxWidth);

  tft.fillRect(10, resetY, maxWidth, resetH, kMiniBg);
  tft.setTextFont(1);
  tft.setTextSize(resetTextSize);
  tft.setTextColor(kMiniMuted, kMiniBg);
  tft.setCursor(10, resetY + 4);
  tft.print(resetLabel);

  LastRenderedSecs() = remain;
  LastRenderedMinuteBucket() = remain / 60;
}

}  // namespace

const char* MiniGifAssetPath() {
  return kMiniGifPath;
}

void ResetMiniGifFrameSchedule() {
  GifCore().ResetFrameSchedule();
}

void StopMiniGifPlayback() {
  GifCore().Stop();
}

bool ShouldRenderMiniGif() {
  return ActiveTheme() == Theme::Mini && HasFrame() && !CurrentFrame().hasError;
}

void TickMiniGif(bool forceFrame) {
  if (!ShouldRenderMiniGif()) {
    return;
  }
  (void)GifCore().Tick(Tft(), miniThemeGifRequest(), forceFrame);
}

int MiniGifReservedWidth() {
  return GifCore().ReservedWidthFor(kMiniGifPath, kMiniFallbackGifSize);
}

void DrawMiniGifPlaceholder() {
  TFT_eSPI& tft = Tft();

  const int placeholderSize = MiniGifReservedWidth();
  const int x = tft.width() - placeholderSize - kMiniGifMargin;
  const int y = tft.height() - placeholderSize - kMiniGifMargin;
  const int boxW = placeholderSize;
  const int boxH = placeholderSize;
  if (boxW <= 0 || boxH <= 0) {
    return;
  }

  if (!GifCore().IsCurrentAssetPresent(kMiniGifPath)) {
    tft.fillRect(x, y, boxW, boxH, rgb565(18, 20, 24));
    tft.setTextFont(1);
    tft.setTextSize(1);
    tft.setTextColor(kMiniMuted, rgb565(18, 20, 24));
    tft.setCursor(x + 8, y + (boxH / 2) - 4);
    tft.print("mini.gif");
  }
}

void DrawSplashMini() {
  TFT_eSPI& tft = Tft();

  tft.fillScreen(kMiniBg);
  tft.setTextColor(kMiniPrimary, kMiniBg);
  tft.setTextFont(2);
  tft.setTextSize(2);
  tft.setCursor(12, 20);
  tft.print("MINI");

  tft.setTextFont(2);
  tft.setTextSize(1);
  tft.setTextColor(kMiniMuted, kMiniBg);
  tft.setCursor(12, 52);
  tft.print("Waiting for usage frame...");
  tft.setCursor(12, 70);
  tft.print("GIF: /mini.gif");

  LastRenderedSecs() = -1;
  LastRenderedMinuteBucket() = -1;
}

void TickSplashMini() {
  // Static splash for this theme.
}

void DrawErrorMini(const String& message) {
  TFT_eSPI& tft = Tft();

  tft.fillScreen(kMiniBg);
  tft.setTextFont(2);
  tft.setTextSize(2);
  tft.setTextColor(kMiniPrimary, kMiniBg);
  tft.setCursor(12, 20);
  tft.print("MINI");

  tft.setTextFont(2);
  tft.setTextSize(1);
  tft.setTextColor(TFT_ORANGE, kMiniBg);
  tft.setCursor(12, 56);
  tft.print("error");

  tft.setTextColor(TFT_WHITE, kMiniBg);
  tft.setTextWrap(true);
  tft.setCursor(12, 78);
  tft.print(message);
  tft.setTextWrap(false);

  LastRenderedSecs() = -1;
  LastRenderedMinuteBucket() = -1;
}

void DrawUsageMini() {
  TFT_eSPI& tft = Tft();

  const int64_t remain = CurrentRemainingSecs();
  (void)GifCore().EnsureReady(tft, miniThemeGifRequest());

  const int contentRight = tft.width() - MiniGifReservedWidth() - (kMiniGifMargin * 2);
  const int maxValueWidth = contentRight > 90 ? contentRight : 120;

  tft.fillScreen(kMiniBg);

  tft.setTextFont(2);
  tft.setTextSize(2);
  tft.setTextColor(kMiniMuted, kMiniBg);
  tft.setCursor(10, 8);
  tft.print(ProviderLabelText());

  char pctBuf[8];
  std::snprintf(pctBuf, sizeof(pctBuf), "%d%%", vibeblock::core::ClampPct(CurrentFrame().session));
  int sessionValueSize = ChooseTextSizeToFit(pctBuf, 5, 3, maxValueWidth);
  tft.setTextFont(1);
  tft.setTextSize(2);
  tft.setTextColor(kMiniMuted, kMiniBg);
  tft.setCursor(10, 46);
  tft.print("Session");
  tft.setTextFont(1);
  tft.setTextSize(sessionValueSize);
  tft.setTextColor(kMiniPrimary, kMiniBg);
  tft.setCursor(10, 70);
  tft.print(pctBuf);

  std::snprintf(pctBuf, sizeof(pctBuf), "%d%%", vibeblock::core::ClampPct(CurrentFrame().weekly));
  int weeklyValueSize = ChooseTextSizeToFit(pctBuf, 5, 3, maxValueWidth);
  tft.setTextFont(1);
  tft.setTextSize(2);
  tft.setTextColor(kMiniMuted, kMiniBg);
  tft.setCursor(10, 132);
  tft.print("Weekly");
  tft.setTextFont(1);
  tft.setTextSize(weeklyValueSize);
  tft.setTextColor(kMiniSecondary, kMiniBg);
  tft.setCursor(10, 156);
  tft.print(pctBuf);

  drawResetCountdownLineMini(remain);
  DrawMiniGifPlaceholder();
  TickMiniGif(true);
}

void DrawResetMini(int64_t remainSecs) {
  drawResetCountdownLineMini(remainSecs);
}

}  // namespace display
}  // namespace esp8266
}  // namespace vibeblock

#endif
