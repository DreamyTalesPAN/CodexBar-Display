#include "renderer_esp8266_display_state.h"

#ifndef CODEXBAR_DISPLAY_PROBE_ONLY

#include <cstdio>

namespace codexbar_display {
namespace esp8266 {
namespace display {

namespace {

constexpr uint16_t rgb565(uint8_t r, uint8_t g, uint8_t b) {
  return static_cast<uint16_t>(((r & 0xF8U) << 8) | ((g & 0xFCU) << 3) | (b >> 3));
}

constexpr const char* kMiniGifPath = "/mini.gif";
constexpr int kMiniGifSpacing = 0;
constexpr int kMiniFallbackGifSize = 64;
constexpr int kMiniGifVerticalOffset = 35;
constexpr int kProviderTextSize = 3;
constexpr int kUsageMetaTextSize = 2;
constexpr int kUsageModeTextSize = 1;
constexpr int kPercentTextSize = 5;
constexpr int kResetTextSize = 2;
constexpr int kUsageLeftCenter = 58;
constexpr int kUsageOuterPadding = 4;
constexpr int kUsageLabelY = 30;
constexpr int kUsageValueY = 66;
constexpr int kUsageModeY = 106;
constexpr uint16_t kMiniBg = TFT_BLACK;
constexpr uint16_t kMiniAction = rgb565(204, 255, 0);
constexpr uint16_t kMiniPrimary = kMiniAction;
constexpr uint16_t kMiniSecondary = rgb565(250, 250, 250);
constexpr uint16_t kMiniMuted = rgb565(153, 153, 153);
constexpr uint16_t kMiniPanel = TFT_BLACK;
constexpr int kMiniSplashActionY = 132;
constexpr int kMiniSplashActionLineGap = 34;
constexpr int kMiniSplashActionClearY = 124;

struct MiniGifBox {
  int drawX = 0;
  int drawY = 0;
  int drawSize = 0;
};

const GifPlaybackRequest& miniThemeGifRequest() {
  static constexpr GifPlaybackRequest kMiniThemeGifRequest = {
      kMiniGifPath,
      GifLayoutMode::FullscreenCenterLower,
      GifFailureSlot::MiniTheme,
  };
  return kMiniThemeGifRequest;
}

const char* miniUsageModeText() {
  if (CurrentFrame().hasUsageMode && CurrentFrame().usageMode == "remaining") {
    return "remaining";
  }
  return "used";
}

int centeredXForText(const char* text, int textSize) {
  int x = (Tft().width() - TextPixelWidth(text, textSize)) / 2;
  if (x < 0) {
    return 0;
  }
  return x;
}

int centeredXForColumn(const char* text, int textSize, int columnCenterX) {
  int x = columnCenterX - (TextPixelWidth(text, textSize) / 2);
  if (x < 0) {
    return 0;
  }
  return x;
}

int centeredXForColumnPixels(int textWidthPx, int columnCenterX) {
  int x = columnCenterX - (textWidthPx / 2);
  if (x < 0) {
    return 0;
  }
  return x;
}

int centeredXForCurrentFont(const char* text) {
  TFT_eSPI& tft = Tft();
  int x = (tft.width() - tft.textWidth(text)) / 2;
  if (x < 0) {
    return 0;
  }
  return x;
}

void printBoldCurrentFont(const char* text, int x, int y) {
  TFT_eSPI& tft = Tft();
  tft.setCursor(x, y);
  tft.print(text);
  tft.setCursor(x + 1, y);
  tft.print(text);
}

void drawSplashActionLineMini() {
  char line2[24];
  std::snprintf(line2, sizeof(line2), "ANY AI TOOL%s", SplashDotsSuffix());

  TFT_eSPI& tft = Tft();
  PrimitiveFillRect(0, kMiniSplashActionClearY, tft.width(), tft.height() - kMiniSplashActionClearY, kMiniBg);
  tft.setTextFont(2);
  tft.setTextSize(2);
  tft.setTextColor(kMiniSecondary, kMiniBg);
  tft.setCursor(centeredXForCurrentFont("START USING"), kMiniSplashActionY);
  tft.print("START USING");
  tft.setCursor(centeredXForCurrentFont(line2), kMiniSplashActionY + kMiniSplashActionLineGap);
  tft.print(line2);
}

MiniGifBox currentMiniGifBox() {
  TFT_eSPI& tft = Tft();

  MiniGifBox box;
  box.drawSize = MiniGifReservedWidth();
  if (box.drawSize <= 0) {
    box.drawSize = kMiniFallbackGifSize;
  }
  box.drawX = (tft.width() - box.drawSize) / 2;
  box.drawY = ((tft.height() - box.drawSize) / 2) + kMiniGifVerticalOffset;
  if (box.drawX < 0) {
    box.drawX = 0;
  }
  if (box.drawY < 0) {
    box.drawY = 0;
  }
  return box;
}

void drawResetCountdownLineMini(int64_t remain) {
  TFT_eSPI& tft = Tft();

  const MiniGifBox box = currentMiniGifBox();
  const int clearY = box.drawY + box.drawSize + kMiniGifSpacing;
  if (clearY >= tft.height()) {
    return;
  }

  const int clearH = tft.height() - clearY;
  const String resetLabel = String("Reset ") + FormatDuration(remain);
  const int resetY = clearY + ((clearH - TextPixelHeight(kResetTextSize)) / 2);

  PrimitiveFillRect(0, clearY, tft.width(), clearH, kMiniBg);
  tft.setTextFont(1);
  tft.setTextSize(kResetTextSize);
  tft.setTextColor(kMiniMuted, kMiniBg);
  tft.setCursor(centeredXForText(resetLabel.c_str(), kResetTextSize), resetY);
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

  const MiniGifBox box = currentMiniGifBox();
  const int x = box.drawX;
  const int y = box.drawY;
  const int boxW = box.drawSize;
  const int boxH = box.drawSize;
  if (boxW <= 0 || boxH <= 0) {
    return;
  }

  const GifCoreStatusSnapshot status = GifCore().StatusSnapshot();
  const bool missing = !GifCore().IsCurrentAssetPresent(kMiniGifPath);
  const bool failed = status.activePath == kMiniGifPath && status.lastErrorStage.length() > 0;
  if (missing || failed) {
    const char* label = failed ? "GIF Fehler" : "Theme fehlt";
    PrimitiveFillRect(x, y, boxW, boxH, kMiniPanel);
    tft.setTextFont(1);
    tft.setTextSize(1);
    tft.setTextColor(kMiniMuted, kMiniPanel);
    tft.setCursor(x + ((boxW - TextPixelWidth(label, 1)) / 2), y + ((boxH - TextPixelHeight(1)) / 2));
    tft.print(label);
  }
}

void DrawSplashMini() {
  TFT_eSPI& tft = Tft();

  PrimitiveFillScreen(kMiniBg);

  constexpr char kTitle[] = "VIBETV";

  tft.setTextWrap(false);

  tft.setTextFont(2);
  tft.setTextSize(4);
  tft.setTextColor(kMiniPrimary, kMiniBg);
  printBoldCurrentFont(kTitle, centeredXForCurrentFont(kTitle), 58);

  SplashWaitingDots() = 0;
  SplashDotsLastTick() = millis();
  drawSplashActionLineMini();

  LastRenderedSecs() = -1;
  LastRenderedMinuteBucket() = -1;
}

void TickSplashMini() {
  if (HasFrame()) {
    return;
  }

  const unsigned long now = millis();
  if (SplashDotsLastTick() == 0 || (now - SplashDotsLastTick()) < 450UL) {
    return;
  }

  SplashDotsLastTick() = now;
  SplashWaitingDots() = static_cast<uint8_t>((SplashWaitingDots() + 1) % 3);
  drawSplashActionLineMini();
}

void DrawErrorMini(const String& message) {
  TFT_eSPI& tft = Tft();

  PrimitiveFillScreen(kMiniBg);
  tft.setTextFont(2);
  tft.setTextSize(2);
  tft.setTextColor(kMiniPrimary, kMiniBg);
  tft.setCursor(12, 20);
  tft.print("VIBETV");

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
  const char* usageMode = miniUsageModeText();

  PrimitiveFillScreen(kMiniBg);
  tft.setTextWrap(false);

  const char* provider = ProviderLabelText();
  tft.setTextFont(1);
  tft.setTextSize(kProviderTextSize);
  tft.setTextColor(kMiniMuted, kMiniBg);
  tft.setCursor(centeredXForText(provider, kProviderTextSize), 4);
  tft.print(provider);

  const int leftCenter = kUsageLeftCenter;
  const int rightCenter = tft.width() - leftCenter;
  const int labelY = kUsageLabelY;
  const int valueY = kUsageValueY;
  const int modeY = kUsageModeY;

  char sessionPctBuf[8];
  char weeklyPctBuf[8];
  std::snprintf(sessionPctBuf, sizeof(sessionPctBuf), "%d%%", codexbar_display::core::ClampPct(CurrentFrame().session));
  std::snprintf(weeklyPctBuf, sizeof(weeklyPctBuf), "%d%%", codexbar_display::core::ClampPct(CurrentFrame().weekly));

  tft.setTextFont(2);
  tft.setTextSize(kUsageMetaTextSize);
  const int sessionLabelW = tft.textWidth("Session");
  const int weeklyLabelW = tft.textWidth("Weekly");

  tft.setTextFont(1);
  tft.setTextSize(kPercentTextSize);
  const int sessionPctW = tft.textWidth(sessionPctBuf);
  const int weeklyPctW = tft.textWidth(weeklyPctBuf);

  tft.setTextFont(2);
  tft.setTextSize(kUsageModeTextSize);
  const int usageModeW = tft.textWidth(usageMode);

  auto max3 = [](int a, int b, int c) {
    int maxVal = a;
    if (b > maxVal) {
      maxVal = b;
    }
    if (c > maxVal) {
      maxVal = c;
    }
    return maxVal;
  };
  const int leftColW = max3(sessionLabelW, sessionPctW, usageModeW);
  const int rightColW = max3(weeklyLabelW, weeklyPctW, usageModeW);
  int leftColX = centeredXForColumnPixels(leftColW, leftCenter);
  if (leftColX < kUsageOuterPadding) {
    leftColX = kUsageOuterPadding;
  }

  int rightColX = centeredXForColumnPixels(rightColW, rightCenter);
  const int maxRightColRight = tft.width() - kUsageOuterPadding;
  if ((rightColX + rightColW) > maxRightColRight) {
    rightColX = maxRightColRight - rightColW;
  }
  if (rightColX < kUsageOuterPadding) {
    rightColX = kUsageOuterPadding;
  }
  const int rightColRight = rightColX + rightColW;

  tft.setTextFont(2);
  tft.setTextSize(kUsageMetaTextSize);
  tft.setTextColor(kMiniMuted, kMiniBg);
  tft.setCursor(leftColX, labelY);
  tft.print("Session");
  tft.setTextFont(1);
  tft.setTextSize(kPercentTextSize);
  tft.setTextColor(kMiniPrimary, kMiniBg);
  tft.setCursor(leftColX, valueY);
  tft.print(sessionPctBuf);
  tft.setTextFont(2);
  tft.setTextSize(kUsageModeTextSize);
  tft.setTextColor(kMiniMuted, kMiniBg);
  tft.setCursor(leftColX, modeY);
  tft.print(usageMode);

  tft.setTextFont(2);
  tft.setTextSize(kUsageMetaTextSize);
  tft.setTextColor(kMiniMuted, kMiniBg);
  tft.setCursor(rightColRight - weeklyLabelW, labelY);
  tft.print("Weekly");
  tft.setTextFont(1);
  tft.setTextSize(kPercentTextSize);
  tft.setTextColor(kMiniPrimary, kMiniBg);
  tft.setCursor(rightColRight - weeklyPctW, valueY);
  tft.print(weeklyPctBuf);
  tft.setTextFont(2);
  tft.setTextSize(kUsageModeTextSize);
  tft.setTextColor(kMiniMuted, kMiniBg);
  tft.setCursor(rightColRight - usageModeW, modeY);
  tft.print(usageMode);

  DrawMiniGifPlaceholder();
  TickMiniGif(true);
  drawResetCountdownLineMini(remain);
}

void DrawResetMini(int64_t remainSecs) {
  drawResetCountdownLineMini(remainSecs);
}

}  // namespace display
}  // namespace esp8266
}  // namespace codexbar_display

#endif
