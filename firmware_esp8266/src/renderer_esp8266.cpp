#include "renderer_esp8266.h"

#include <cstdio>
#include <cstring>

#include "gif_core_esp8266.h"
#include "theme_defs.h"

#ifndef VIBEBLOCK_PROBE_ONLY
#include <TFT_eSPI.h>
#endif

namespace vibeblock {
namespace esp8266 {

namespace {

app::RuntimeContext* gCtx = nullptr;

core::RuntimeState& runtimeState() {
  return gCtx->runtime;
}

core::Frame& current() {
  return gCtx->runtime.current;
}

bool hasFrame() {
  return gCtx->runtime.hasFrame;
}

bool& screenDirty() {
  return gCtx->screenDirty;
}

int64_t& lastRenderedSecs() {
  return gCtx->lastRenderedSecs;
}

int64_t& lastRenderedMinuteBucket() {
  return gCtx->lastRenderedMinuteBucket;
}

#ifndef VIBEBLOCK_PROBE_ONLY
uint8_t splashWaitingDots = 0;
unsigned long splashDotsLastTick = 0;
unsigned long splashStartedAt = 0;
unsigned long splashHintLastTick = 0;
#endif

#ifdef VIBEBLOCK_PROBE_ONLY
bool probeLastHasFrame = false;
bool probeLastHadError = false;
String probeLastProvider;
String probeLastLabel;
String probeLastError;
int probeLastSession = -1;
int probeLastWeekly = -1;
int64_t probeLastRemainSecs = -1;
#endif

#ifndef VIBEBLOCK_PROBE_ONLY
TFT_eSPI tft = TFT_eSPI();
#endif

int64_t currentRemainingSecs() {
  return vibeblock::core::CurrentRemainingSecs(runtimeState(), millis());
}

String formatDuration(int64_t secs) {
  return vibeblock::core::FormatDuration(secs);
}

#ifndef VIBEBLOCK_PROBE_ONLY
void drawBar(int x, int y, int w, int h, int pct, uint16_t fillColor) {
  const int p = vibeblock::core::ClampPct(pct);
  int filled = (w * p) / 100;
  if (filled > (w - 2)) {
    filled = w - 2;
  }
  if (filled < 0) {
    filled = 0;
  }

  int radius = 2;
  if (h >= 14) {
    radius = 3;
  }
  if (radius > ((h - 2) / 2)) {
    radius = (h - 2) / 2;
  }
  if (radius < 0) {
    radius = 0;
  }

  if (radius > 0) {
    tft.drawRoundRect(x, y, w, h, radius, TFT_DARKGREY);
    tft.fillRoundRect(x + 1, y + 1, w - 2, h - 2, radius - 1, TFT_BLACK);
  } else {
    tft.drawRect(x, y, w, h, TFT_DARKGREY);
    tft.fillRect(x + 1, y + 1, w - 2, h - 2, TFT_BLACK);
  }

  if (filled > 0) {
    if (radius > 1 && filled > (radius * 2)) {
      tft.fillRoundRect(x + 1, y + 1, filled, h - 2, radius - 1, fillColor);
    } else {
      tft.fillRect(x + 1, y + 1, filled, h - 2, fillColor);
    }
  }
}

int textPixelWidth(const char* text, int textSize) {
  if (text == nullptr || textSize <= 0) {
    return 0;
  }
  return static_cast<int>(strlen(text)) * 6 * textSize;
}

int textPixelHeight(int textSize) {
  if (textSize <= 0) {
    return 0;
  }
  return 8 * textSize;
}

int chooseTextSizeToFit(const char* text, int maxSize, int minSize, int maxWidth) {
  for (int size = maxSize; size >= minSize; --size) {
    if (textPixelWidth(text, size) <= maxWidth) {
      return size;
    }
  }
  return minSize;
}

int centeredTextX(const char* text, int textSize) {
  int x = (tft.width() - textPixelWidth(text, textSize)) / 2;
  if (x < 0) {
    return 0;
  }
  return x;
}

Theme activeTheme = defaultTheme();

constexpr uint16_t rgb565(uint8_t r, uint8_t g, uint8_t b) {
  return static_cast<uint16_t>(((r & 0xF8U) << 8) | ((g & 0xFCU) << 3) | (b >> 3));
}

constexpr uint16_t kCrtBg = rgb565(2, 11, 2);
constexpr uint16_t kCrtGreen = rgb565(0, 255, 65);
constexpr uint16_t kCrtDim = rgb565(0, 143, 36);
constexpr uint16_t kCrtBorder = rgb565(0, 61, 16);
constexpr uint16_t kCrtTrack = rgb565(1, 15, 1);

constexpr int kCrtDividerY = 40;
constexpr int kCrtHeaderTextY = 4;
constexpr int kCrtStatusDotX = 224;
constexpr int kCrtStatusDotY = 14;
constexpr int kCrtStatusDotSize = 10;
constexpr int kCrtBodyX = 8;
constexpr int kCrtBodyW = 224;
constexpr int kCrtBarH = 20;
constexpr int kCrtSessionLabelY = 50;
constexpr int kCrtSessionBarY = 88;
constexpr int kCrtWeeklyLabelY = 118;
constexpr int kCrtWeeklyBarY = 156;
constexpr int kCrtMidDividerY = 190;
constexpr int kCrtResetLabelY = 198;
constexpr int kCrtResetClearY = 196;
constexpr int kCrtResetClearH = 36;
constexpr int kCrtSplashLine1Y = 74;
constexpr int kCrtSplashLine2Y = 110;
constexpr int kCrtSplashLine2ClearY = 110;
constexpr int kCrtSplashLine2ClearH = 36;
constexpr int kCrtSplashHintY = 196;
constexpr int kCrtSplashHintClearY = 196;
constexpr int kCrtSplashHintClearH = 36;

constexpr const char* kMiniGifPath = "/mini.gif";
constexpr int kMiniGifMargin = 8;
constexpr int kMiniFallbackGifSize = 80;
constexpr uint16_t kMiniBg = TFT_BLACK;
constexpr uint16_t kMiniPrimary = rgb565(92, 204, 255);
constexpr uint16_t kMiniSecondary = rgb565(167, 255, 201);
constexpr uint16_t kMiniMuted = rgb565(121, 131, 148);
GifCoreESP8266 gifCore;

struct SplashLayout {
  int titleSize = 2;
  int subtitleSize = 1;
  int hintSize = 1;
  int titleY = 0;
  int line1Y = 0;
  int line2Y = 0;
  int line2ClearY = 0;
  int line2ClearH = 0;
  int hintY = 0;
  int hintClearY = 0;
  int hintClearH = 0;
};

struct UsageLayout {
  int x = 8;
  int w = 0;
  int providerSize = 3;
  int labelSize = 3;
  int resetSize = 2;
  int barH = 30;
  int labelToBarGap = 2;
  int topPad = 0;
  int bottomPad = 0;
  int gapProviderToSession = 0;
  int gapSessionToWeekly = 0;
  int gapWeeklyToReset = 0;
  int providerY = 0;
  int label1Y = 0;
  int bar1Y = 0;
  int label2Y = 0;
  int bar2Y = 0;
  int resetY = 0;
  int resetClearY = 0;
  int resetClearH = 0;
};

void setClassicTextSize(int size) {
  tft.setTextFont(1);
  tft.setTextSize(size);
}

void setCrtTextStyle(uint8_t textSize = 1) {
  tft.setTextFont(2);
  tft.setTextSize(textSize);
}

int centeredTextXCrt(const char* text) {
  int x = (tft.width() - tft.textWidth(text)) / 2;
  if (x < 0) {
    return 0;
  }
  return x;
}

int rightAlignedTextXCrt(const char* text, int rightPadding) {
  int x = tft.width() - rightPadding - tft.textWidth(text);
  if (x < 0) {
    return 0;
  }
  return x;
}

const GifPlaybackRequest& miniThemeGifRequest() {
  static constexpr GifPlaybackRequest kMiniThemeGifRequest = {
      kMiniGifPath,
      GifLayoutMode::BottomRightMini,
      GifFailureSlot::MiniTheme,
  };
  return kMiniThemeGifRequest;
}

void stopMiniGifPlayback() {
  gifCore.Stop();
}

bool shouldRenderMiniGif() {
  return activeTheme == Theme::Mini && hasFrame() && !current().hasError;
}

void tickMiniGif(bool forceFrame) {
  if (!shouldRenderMiniGif()) {
    return;
  }
  (void)gifCore.Tick(tft, miniThemeGifRequest(), forceFrame);
}

int miniGifReservedWidth() {
  return gifCore.ReservedWidthFor(kMiniGifPath, kMiniFallbackGifSize);
}

void drawMiniGifPlaceholder() {
  const int placeholderSize = miniGifReservedWidth();
  const int x = tft.width() - placeholderSize - kMiniGifMargin;
  const int y = tft.height() - placeholderSize - kMiniGifMargin;
  const int boxW = placeholderSize;
  const int boxH = placeholderSize;
  if (boxW <= 0 || boxH <= 0) {
    return;
  }

  tft.drawRect(x - 2, y - 2, boxW + 4, boxH + 4, kMiniMuted);
  if (!gifCore.IsCurrentAssetPresent(kMiniGifPath)) {
    tft.fillRect(x, y, boxW, boxH, rgb565(18, 20, 24));
    tft.setTextFont(1);
    tft.setTextSize(1);
    tft.setTextColor(kMiniMuted, rgb565(18, 20, 24));
    tft.setCursor(x + 8, y + (boxH / 2) - 4);
    tft.print("mini.gif");
  }
}

void drawCrtHeader(const char* title, bool showStatusDot) {
  uint8_t titleSize = 2;
  const int reservedForStatus = showStatusDot ? (kCrtStatusDotSize + 8) : 0;
  setCrtTextStyle(titleSize);
  if (tft.textWidth(title) > (kCrtBodyW - reservedForStatus)) {
    titleSize = 1;
    setCrtTextStyle(titleSize);
  }

  tft.drawFastHLine(0, kCrtDividerY, tft.width(), kCrtGreen);
  tft.drawFastHLine(0, kCrtDividerY + 1, tft.width(), kCrtGreen);
  tft.setTextWrap(false);
  tft.setTextColor(kCrtGreen, kCrtBg);
  const int titleY = titleSize > 1 ? kCrtHeaderTextY : (kCrtHeaderTextY + 8);
  tft.setCursor(kCrtBodyX, titleY);
  tft.print(title);
  if (showStatusDot) {
    tft.fillRect(kCrtStatusDotX, kCrtStatusDotY, kCrtStatusDotSize, kCrtStatusDotSize, kCrtGreen);
  }
}

const char* splashDotsSuffix() {
  switch (splashWaitingDots) {
    case 0:
      return ".";
    case 1:
      return "..";
    default:
      return "...";
  }
}

const char* providerLabelText() {
  if (current().label.length()) {
    return current().label.c_str();
  }
  return "Provider";
}

int usageCoreHeightFor(const UsageLayout& layout) {
  return textPixelHeight(layout.providerSize) +
         textPixelHeight(layout.labelSize) +
         layout.labelToBarGap +
         layout.barH +
         textPixelHeight(layout.labelSize) +
         layout.labelToBarGap +
         layout.barH +
         textPixelHeight(layout.resetSize);
}

constexpr int kUsageSpacingSlots = 5;
constexpr int kUsageMaxInternalGap = 8;

bool shrinkUsageLayout(UsageLayout& layout, int& minGap) {
  if (layout.resetSize > 2) {
    --layout.resetSize;
    return true;
  }
  if (layout.providerSize > 2) {
    --layout.providerSize;
    return true;
  }
  if (layout.labelSize > 2) {
    --layout.labelSize;
    return true;
  }
  if (layout.barH > 18) {
    layout.barH -= 2;
    return true;
  }
  if (layout.labelToBarGap > 1) {
    --layout.labelToBarGap;
    return true;
  }
  if (minGap > 1) {
    --minGap;
    return true;
  }
  if (layout.resetSize > 1) {
    --layout.resetSize;
    return true;
  }
  if (layout.labelSize > 1) {
    --layout.labelSize;
    return true;
  }
  if (layout.providerSize > 1) {
    --layout.providerSize;
    return true;
  }
  return false;
}

void distributeUsageGaps(int available, int minGap, int (&slotGaps)[kUsageSpacingSlots]) {
  if (available <= 0) {
    return;
  }

  if (available >= kUsageSpacingSlots * minGap) {
    const int extra = available - (kUsageSpacingSlots * minGap);
    const int extraEach = extra / kUsageSpacingSlots;
    const int extraRemainder = extra % kUsageSpacingSlots;
    for (int i = 0; i < kUsageSpacingSlots; ++i) {
      slotGaps[i] = minGap + extraEach + (i < extraRemainder ? 1 : 0);
    }
    return;
  }

  const int gapEach = available / kUsageSpacingSlots;
  const int gapRemainder = available % kUsageSpacingSlots;
  for (int i = 0; i < kUsageSpacingSlots; ++i) {
    slotGaps[i] = gapEach + (i < gapRemainder ? 1 : 0);
  }
}

void capUsageInternalGaps(int (&slotGaps)[kUsageSpacingSlots]) {
  int reclaimed = 0;
  for (int i = 1; i <= 3; ++i) {
    if (slotGaps[i] > kUsageMaxInternalGap) {
      reclaimed += (slotGaps[i] - kUsageMaxInternalGap);
      slotGaps[i] = kUsageMaxInternalGap;
    }
  }
  if (reclaimed > 0) {
    slotGaps[0] += reclaimed / 2;
    slotGaps[4] += reclaimed - (reclaimed / 2);
  }
}

UsageLayout usageLayoutForProvider(const char* providerText) {
  UsageLayout layout;
  layout.w = tft.width() - (layout.x * 2);
  layout.providerSize = chooseTextSizeToFit(providerText, 4, 2, tft.width() - 4);
  layout.labelSize = chooseTextSizeToFit("Session 100% used", 3, 2, layout.w);
  layout.resetSize = chooseTextSizeToFit("Reset in 999h 59m", 3, 2, tft.width() - 4);

  int minGap = 5;

  for (;;) {
    if (usageCoreHeightFor(layout) + (kUsageSpacingSlots * minGap) <= tft.height()) {
      break;
    }

    if (!shrinkUsageLayout(layout, minGap)) {
      break;
    }
  }

  int slotGaps[kUsageSpacingSlots] = {0, 0, 0, 0, 0};
  const int available = tft.height() - usageCoreHeightFor(layout);
  distributeUsageGaps(available, minGap, slotGaps);
  capUsageInternalGaps(slotGaps);

  layout.topPad = slotGaps[0];
  layout.gapProviderToSession = slotGaps[1];
  layout.gapSessionToWeekly = slotGaps[2];
  layout.gapWeeklyToReset = slotGaps[3];
  layout.bottomPad = slotGaps[4];

  layout.providerY = layout.topPad;
  layout.label1Y = layout.providerY + textPixelHeight(layout.providerSize) + layout.gapProviderToSession;
  layout.bar1Y = layout.label1Y + textPixelHeight(layout.labelSize) + layout.labelToBarGap;
  layout.label2Y = layout.bar1Y + layout.barH + layout.gapSessionToWeekly;
  layout.bar2Y = layout.label2Y + textPixelHeight(layout.labelSize) + layout.labelToBarGap;
  layout.resetY = layout.bar2Y + layout.barH + layout.gapWeeklyToReset;
  layout.resetClearY = layout.resetY;
  layout.resetClearH = textPixelHeight(layout.resetSize) + 2;
  return layout;
}

SplashLayout splashLayoutClassic() {
  constexpr char kTitle[] = "VIBEBLOCK";
  constexpr char kLine1[] = "Waiting for";
  constexpr char kHintSample[] = "Frames in ~30s";

  SplashLayout layout;
  const int maxWidth = tft.width() - 8;
  layout.titleSize = chooseTextSizeToFit(kTitle, 4, 2, maxWidth);
  layout.subtitleSize = chooseTextSizeToFit(kLine1, 3, 1, maxWidth);
  layout.hintSize = chooseTextSizeToFit(kHintSample, 3, 2, maxWidth);

  const int titleH = textPixelHeight(layout.titleSize);
  const int subtitleH = textPixelHeight(layout.subtitleSize);
  const int hintH = textPixelHeight(layout.hintSize);
  constexpr int gap1 = 12;
  constexpr int gap2 = 4;
  constexpr int gap3 = 10;

  const int totalH = titleH + gap1 + subtitleH + gap2 + subtitleH + gap3 + hintH;
  int top = (tft.height() - totalH) / 2;
  if (top < 4) {
    top = 4;
  }

  layout.titleY = top;
  layout.line1Y = layout.titleY + titleH + gap1;
  layout.line2Y = layout.line1Y + subtitleH + gap2;
  layout.line2ClearY = layout.line2Y;
  layout.line2ClearH = subtitleH + 2;
  layout.hintY = layout.line2Y + subtitleH + gap3;
  layout.hintClearY = layout.hintY;
  layout.hintClearH = hintH + 2;
  return layout;
}

void drawSplashHintLineClassic(const SplashLayout& layout) {
  constexpr unsigned long estimateSecs = 30;
  const unsigned long now = millis();
  unsigned long elapsedSecs = 0;
  if (splashStartedAt > 0 && now >= splashStartedAt) {
    elapsedSecs = (now - splashStartedAt) / 1000UL;
  }
  unsigned long remainingSecs = 0;
  if (elapsedSecs < estimateSecs) {
    remainingSecs = estimateSecs - elapsedSecs;
  }

  char hint[48];
  if (remainingSecs > 0) {
    std::snprintf(hint, sizeof(hint), "Frames in ~%lus", remainingSecs);
  } else {
    std::snprintf(hint, sizeof(hint), "Warte auf Frames");
  }

  tft.fillRect(0, layout.hintClearY, tft.width(), layout.hintClearH, TFT_BLACK);
  tft.setTextColor(TFT_LIGHTGREY, TFT_BLACK);
  setClassicTextSize(layout.hintSize);
  tft.setCursor(centeredTextX(hint, layout.hintSize), layout.hintY);
  tft.print(hint);
}

void drawSplashWaitingLineClassic(const SplashLayout& layout) {
  char line2[16] = "frames";
  std::strcat(line2, splashDotsSuffix());

  tft.fillRect(0, layout.line2ClearY, tft.width(), layout.line2ClearH, TFT_BLACK);
  tft.setTextColor(TFT_LIGHTGREY, TFT_BLACK);
  setClassicTextSize(layout.subtitleSize);
  tft.setCursor(centeredTextX(line2, layout.subtitleSize), layout.line2Y);
  tft.print(line2);
}

void drawSplashClassic() {
  constexpr char kTitle[] = "VIBEBLOCK";
  constexpr char kLine1[] = "Waiting for";

  const SplashLayout layout = splashLayoutClassic();
  tft.fillScreen(TFT_BLACK);

  tft.setTextColor(TFT_CYAN, TFT_BLACK);
  setClassicTextSize(layout.titleSize);
  tft.setCursor(centeredTextX(kTitle, layout.titleSize), layout.titleY);
  tft.print(kTitle);

  tft.setTextColor(TFT_WHITE, TFT_BLACK);
  setClassicTextSize(layout.subtitleSize);
  tft.setCursor(centeredTextX(kLine1, layout.subtitleSize), layout.line1Y);
  tft.print(kLine1);

  splashWaitingDots = 0;
  splashDotsLastTick = millis();
  splashStartedAt = millis();
  splashHintLastTick = splashStartedAt;
  drawSplashWaitingLineClassic(layout);
  drawSplashHintLineClassic(layout);

  lastRenderedSecs() = -1;
  lastRenderedMinuteBucket() = -1;
}

void tickSplashWaitingDotsClassic() {
  if (hasFrame()) {
    return;
  }
  const unsigned long now = millis();
  if (splashDotsLastTick == 0 || (now - splashDotsLastTick) < 450UL) {
    return;
  }

  splashDotsLastTick = now;
  splashWaitingDots = static_cast<uint8_t>((splashWaitingDots + 1) % 3);
  const SplashLayout layout = splashLayoutClassic();
  drawSplashWaitingLineClassic(layout);

  if (splashHintLastTick == 0 || (now - splashHintLastTick) >= 1000UL) {
    splashHintLastTick = now;
    drawSplashHintLineClassic(layout);
  }
}

void drawErrorClassic(const String& message) {
  tft.fillScreen(TFT_BLACK);
  setClassicTextSize(2);
  tft.setTextColor(TFT_ORANGE, TFT_BLACK);
  tft.setCursor(8, 16);
  tft.println("error");
  setClassicTextSize(1);
  tft.setTextColor(TFT_WHITE, TFT_BLACK);
  tft.setCursor(8, 50);
  tft.println(message);
  lastRenderedSecs() = -1;
  lastRenderedMinuteBucket() = -1;
}

void drawResetCountdownLineClassic(int64_t remain) {
  const UsageLayout layout = usageLayoutForProvider(providerLabelText());
  const String resetLabel = String("Reset in ") + formatDuration(remain);

  tft.fillRect(0, layout.resetClearY, tft.width(), layout.resetClearH, TFT_BLACK);
  setClassicTextSize(layout.resetSize);
  tft.setTextColor(TFT_WHITE, TFT_BLACK);
  tft.setCursor(centeredTextX(resetLabel.c_str(), layout.resetSize), layout.resetY);
  tft.print(resetLabel);

  lastRenderedSecs() = remain;
  lastRenderedMinuteBucket() = remain / 60;
}

void drawUsageClassic() {
  const int64_t remain = currentRemainingSecs();
  const char* providerText = providerLabelText();
  const UsageLayout layout = usageLayoutForProvider(providerText);

  tft.fillScreen(TFT_BLACK);
  tft.setTextColor(TFT_CYAN, TFT_BLACK);
  setClassicTextSize(layout.providerSize);
  tft.setCursor(centeredTextX(providerText, layout.providerSize), layout.providerY);
  tft.print(providerText);

  const String sessionLabel = String("Session ") + String(current().session) + "% used";
  const String weeklyLabel = String("Weekly ") + String(current().weekly) + "% used";

  setClassicTextSize(layout.labelSize);
  tft.setTextColor(TFT_WHITE, TFT_BLACK);
  tft.setCursor(centeredTextX(sessionLabel.c_str(), layout.labelSize), layout.label1Y);
  tft.print(sessionLabel);
  drawBar(layout.x, layout.bar1Y, layout.w, layout.barH, current().session, TFT_CYAN);

  tft.setCursor(centeredTextX(weeklyLabel.c_str(), layout.labelSize), layout.label2Y);
  tft.print(weeklyLabel);
  drawBar(layout.x, layout.bar2Y, layout.w, layout.barH, current().weekly, TFT_GREEN);

  drawResetCountdownLineClassic(remain);
}

void drawSplashHintLineCRT() {
  constexpr unsigned long estimateSecs = 30;
  const unsigned long now = millis();
  unsigned long elapsedSecs = 0;
  if (splashStartedAt > 0 && now >= splashStartedAt) {
    elapsedSecs = (now - splashStartedAt) / 1000UL;
  }
  unsigned long remainingSecs = 0;
  if (elapsedSecs < estimateSecs) {
    remainingSecs = estimateSecs - elapsedSecs;
  }

  char hint[32];
  if (remainingSecs > 0) {
    std::snprintf(hint, sizeof(hint), "Frames in ~%lus", remainingSecs);
  } else {
    std::snprintf(hint, sizeof(hint), "Waiting for frames");
  }

  uint8_t hintSize = 2;
  setCrtTextStyle(hintSize);
  if (tft.textWidth(hint) > kCrtBodyW) {
    hintSize = 1;
    setCrtTextStyle(hintSize);
  }
  tft.fillRect(0, kCrtSplashHintClearY, tft.width(), kCrtSplashHintClearH, kCrtBg);
  tft.setTextColor(kCrtDim, kCrtBg);
  const int hintY = hintSize > 1 ? kCrtSplashHintY : (kCrtSplashHintY + 8);
  tft.setCursor(centeredTextXCrt(hint), hintY);
  tft.print(hint);
}

void drawSplashWaitingLineCRT() {
  char line2[24] = "FRAMES";
  std::strcat(line2, splashDotsSuffix());

  uint8_t lineSize = 2;
  setCrtTextStyle(lineSize);
  if (tft.textWidth(line2) > kCrtBodyW) {
    lineSize = 1;
    setCrtTextStyle(lineSize);
  }
  tft.fillRect(0, kCrtSplashLine2ClearY, tft.width(), kCrtSplashLine2ClearH, kCrtBg);
  tft.setTextColor(kCrtGreen, kCrtBg);
  const int lineY = lineSize > 1 ? kCrtSplashLine2Y : (kCrtSplashLine2Y + 8);
  tft.setCursor(centeredTextXCrt(line2), lineY);
  tft.print(line2);
}

void drawSplashCRT() {
  tft.fillScreen(kCrtBg);
  drawCrtHeader("VIBEBLOCK", false);

  setCrtTextStyle(2);
  tft.setTextColor(kCrtDim, kCrtBg);
  tft.setCursor(centeredTextXCrt("WAITING FOR"), kCrtSplashLine1Y);
  tft.print("WAITING FOR");

  splashWaitingDots = 0;
  splashDotsLastTick = millis();
  splashStartedAt = millis();
  splashHintLastTick = splashStartedAt;
  drawSplashWaitingLineCRT();
  drawSplashHintLineCRT();

  lastRenderedSecs() = -1;
  lastRenderedMinuteBucket() = -1;
}

void tickSplashWaitingDotsCRT() {
  if (hasFrame()) {
    return;
  }
  const unsigned long now = millis();
  if (splashDotsLastTick == 0 || (now - splashDotsLastTick) < 450UL) {
    return;
  }

  splashDotsLastTick = now;
  splashWaitingDots = static_cast<uint8_t>((splashWaitingDots + 1) % 3);
  drawSplashWaitingLineCRT();

  if (splashHintLastTick == 0 || (now - splashHintLastTick) >= 1000UL) {
    splashHintLastTick = now;
    drawSplashHintLineCRT();
  }
}

void drawErrorCRT(const String& message) {
  tft.fillScreen(kCrtBg);
  drawCrtHeader("VIBEBLOCK", false);

  setCrtTextStyle(2);
  tft.setTextColor(kCrtDim, kCrtBg);
  tft.setCursor(kCrtBodyX, 68);
  tft.print("ERROR");

  uint8_t messageSize = 2;
  setCrtTextStyle(messageSize);
  if (tft.textWidth(message.c_str()) > kCrtBodyW) {
    messageSize = 1;
    setCrtTextStyle(messageSize);
  }
  tft.setTextColor(kCrtGreen, kCrtBg);
  tft.setTextWrap(true);
  const int messageY = messageSize > 1 ? 104 : 112;
  tft.setCursor(kCrtBodyX, messageY);
  tft.print(message);
  tft.setTextWrap(false);

  lastRenderedSecs() = -1;
  lastRenderedMinuteBucket() = -1;
}

void drawResetCountdownLineCRT(int64_t remain) {
  const String countdown = formatDuration(remain);
  constexpr int minGap = 12;
  uint8_t resetSize = 2;

  setCrtTextStyle(resetSize);
  if ((tft.textWidth("RST IN") + minGap + tft.textWidth(countdown.c_str())) > kCrtBodyW) {
    resetSize = 1;
    setCrtTextStyle(resetSize);
  }
  tft.fillRect(0, kCrtResetClearY, tft.width(), kCrtResetClearH, kCrtBg);
  tft.setTextColor(kCrtDim, kCrtBg);
  const int resetY = resetSize > 1 ? kCrtResetLabelY : (kCrtResetLabelY + 8);
  tft.setCursor(kCrtBodyX, resetY);
  tft.print("RST IN");

  tft.setTextColor(kCrtGreen, kCrtBg);
  tft.setCursor(rightAlignedTextXCrt(countdown.c_str(), 8), resetY);
  tft.print(countdown);

  lastRenderedSecs() = remain;
  lastRenderedMinuteBucket() = remain / 60;
}

void drawUsageCRT() {
  const int64_t remain = currentRemainingSecs();
  const int session = vibeblock::core::ClampPct(current().session);
  const int weekly = vibeblock::core::ClampPct(current().weekly);
  const int innerBarWidth = kCrtBodyW - 2;
  const int innerBarHeight = kCrtBarH - 2;

  tft.fillScreen(kCrtBg);
  drawCrtHeader(providerLabelText(), true);

  setCrtTextStyle(2);
  char pctBuf[8];

  tft.setTextColor(kCrtDim, kCrtBg);
  tft.setCursor(kCrtBodyX, kCrtSessionLabelY);
  tft.print("SESSION");
  std::snprintf(pctBuf, sizeof(pctBuf), "%d%%", session);
  tft.setTextColor(kCrtGreen, kCrtBg);
  tft.setCursor(rightAlignedTextXCrt(pctBuf, 8), kCrtSessionLabelY);
  tft.print(pctBuf);
  tft.fillRect(kCrtBodyX, kCrtSessionBarY, kCrtBodyW, kCrtBarH, kCrtTrack);
  tft.drawRect(kCrtBodyX, kCrtSessionBarY, kCrtBodyW, kCrtBarH, kCrtBorder);
  const int sessionFill = (innerBarWidth * session) / 100;
  if (sessionFill > 0) {
    tft.fillRect(kCrtBodyX + 1, kCrtSessionBarY + 1, sessionFill, innerBarHeight, kCrtGreen);
  }

  tft.setTextColor(kCrtDim, kCrtBg);
  tft.setCursor(kCrtBodyX, kCrtWeeklyLabelY);
  tft.print("WEEKLY");
  std::snprintf(pctBuf, sizeof(pctBuf), "%d%%", weekly);
  tft.setTextColor(kCrtGreen, kCrtBg);
  tft.setCursor(rightAlignedTextXCrt(pctBuf, 8), kCrtWeeklyLabelY);
  tft.print(pctBuf);
  tft.fillRect(kCrtBodyX, kCrtWeeklyBarY, kCrtBodyW, kCrtBarH, kCrtTrack);
  tft.drawRect(kCrtBodyX, kCrtWeeklyBarY, kCrtBodyW, kCrtBarH, kCrtBorder);
  const int weeklyFill = (innerBarWidth * weekly) / 100;
  if (weeklyFill > 0) {
    tft.fillRect(kCrtBodyX + 1, kCrtWeeklyBarY + 1, weeklyFill, innerBarHeight, kCrtGreen);
  }

  tft.drawFastHLine(kCrtBodyX, kCrtMidDividerY, kCrtBodyW, kCrtBorder);
  tft.drawFastHLine(kCrtBodyX, kCrtMidDividerY + 1, kCrtBodyW, kCrtBorder);
  drawResetCountdownLineCRT(remain);
}

void drawSplashMini() {
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

  lastRenderedSecs() = -1;
  lastRenderedMinuteBucket() = -1;
}

void tickSplashWaitingDotsMini() {
  // Static splash for this theme.
}

void drawErrorMini(const String& message) {
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

  lastRenderedSecs() = -1;
  lastRenderedMinuteBucket() = -1;
}

void drawResetCountdownLineMini(int64_t remain) {
  const int contentRight = tft.width() - miniGifReservedWidth() - (kMiniGifMargin * 2);
  const int maxWidth = contentRight > 100 ? contentRight : (tft.width() - 12);
  const int resetY = 206;
  const int resetH = 22;
  const String resetLabel = String("Reset in ") + formatDuration(remain);

  tft.fillRect(10, resetY, maxWidth, resetH, kMiniBg);
  tft.setTextFont(2);
  tft.setTextSize(1);
  tft.setTextColor(kMiniMuted, kMiniBg);
  tft.setCursor(10, resetY + 6);
  tft.print(resetLabel);

  lastRenderedSecs() = remain;
  lastRenderedMinuteBucket() = remain / 60;
}

void drawUsageMini() {
  const int64_t remain = currentRemainingSecs();
  (void)gifCore.EnsureReady(tft, miniThemeGifRequest());

  const int contentRight = tft.width() - miniGifReservedWidth() - (kMiniGifMargin * 2);
  const int maxValueWidth = contentRight > 90 ? contentRight : 120;

  tft.fillScreen(kMiniBg);

  tft.setTextFont(2);
  tft.setTextSize(1);
  tft.setTextColor(kMiniMuted, kMiniBg);
  tft.setCursor(10, 8);
  tft.print(providerLabelText());

  char pctBuf[8];
  std::snprintf(pctBuf, sizeof(pctBuf), "%d%%", vibeblock::core::ClampPct(current().session));
  int sessionValueSize = chooseTextSizeToFit(pctBuf, 7, 4, maxValueWidth);
  tft.setTextFont(1);
  tft.setTextSize(1);
  tft.setTextColor(kMiniMuted, kMiniBg);
  tft.setCursor(10, 34);
  tft.print("Session");
  tft.setTextFont(1);
  tft.setTextSize(sessionValueSize);
  tft.setTextColor(kMiniPrimary, kMiniBg);
  tft.setCursor(10, 46);
  tft.print(pctBuf);

  std::snprintf(pctBuf, sizeof(pctBuf), "%d%%", vibeblock::core::ClampPct(current().weekly));
  int weeklyValueSize = chooseTextSizeToFit(pctBuf, 7, 4, maxValueWidth);
  tft.setTextFont(1);
  tft.setTextSize(1);
  tft.setTextColor(kMiniMuted, kMiniBg);
  tft.setCursor(10, 124);
  tft.print("Weekly");
  tft.setTextFont(1);
  tft.setTextSize(weeklyValueSize);
  tft.setTextColor(kMiniSecondary, kMiniBg);
  tft.setCursor(10, 136);
  tft.print(pctBuf);

  drawResetCountdownLineMini(remain);
  drawMiniGifPlaceholder();
  tickMiniGif(true);
}

void drawSplash() {
  switch (activeTheme) {
    case Theme::Mini:
      stopMiniGifPlayback();
      drawSplashMini();
      return;
    case Theme::CRT:
      stopMiniGifPlayback();
      drawSplashCRT();
      return;
    case Theme::Classic:
    default:
      drawSplashClassic();
      return;
  }
}

void tickSplashWaitingDots() {
  switch (activeTheme) {
    case Theme::Mini:
      tickSplashWaitingDotsMini();
      return;
    case Theme::CRT:
      tickSplashWaitingDotsCRT();
      return;
    case Theme::Classic:
    default:
      tickSplashWaitingDotsClassic();
      return;
  }
}

void drawError(const String& message) {
  stopMiniGifPlayback();
  switch (activeTheme) {
    case Theme::Mini:
      drawErrorMini(message);
      return;
    case Theme::CRT:
      drawErrorCRT(message);
      return;
    case Theme::Classic:
    default:
      drawErrorClassic(message);
      return;
  }
}

void drawResetCountdownLine(int64_t remain) {
  switch (activeTheme) {
    case Theme::Mini:
      drawResetCountdownLineMini(remain);
      return;
    case Theme::CRT:
      drawResetCountdownLineCRT(remain);
      return;
    case Theme::Classic:
    default:
      drawResetCountdownLineClassic(remain);
      return;
  }
}

void drawUsage() {
  switch (activeTheme) {
    case Theme::Mini:
      drawUsageMini();
      return;
    case Theme::CRT:
      stopMiniGifPlayback();
      drawUsageCRT();
      return;
    case Theme::Classic:
    default:
      stopMiniGifPlayback();
      drawUsageClassic();
      return;
  }
}
#else
void renderProbe() {
  if (!hasFrame()) {
    if (probeLastHasFrame) {
      Serial.println("probe_waiting_for_frame");
      probeLastHasFrame = false;
      probeLastHadError = false;
      probeLastProvider = "";
      probeLastLabel = "";
      probeLastError = "";
      probeLastSession = -1;
      probeLastWeekly = -1;
      probeLastRemainSecs = -1;
    }
    return;
  }

  const int64_t remain = currentRemainingSecs();
  if (current().hasError) {
    const bool changed = !probeLastHasFrame || !probeLastHadError || current().error != probeLastError;
    if (changed) {
      Serial.printf("probe_error error=%s\n", current().error.c_str());
    }
    probeLastHasFrame = true;
    probeLastHadError = true;
    probeLastError = current().error;
    probeLastProvider = current().provider;
    probeLastLabel = current().label;
    probeLastSession = current().session;
    probeLastWeekly = current().weekly;
    probeLastRemainSecs = remain;
    lastRenderedSecs() = remain;
    return;
  }

  const bool changed =
      !probeLastHasFrame ||
      probeLastHadError ||
      current().provider != probeLastProvider ||
      current().label != probeLastLabel ||
      current().session != probeLastSession ||
      current().weekly != probeLastWeekly ||
      remain != probeLastRemainSecs;

  if (changed) {
    Serial.printf(
        "probe_usage label=%s provider=%s session=%d weekly=%d reset=%s\n",
        current().label.c_str(),
        current().provider.c_str(),
        current().session,
        current().weekly,
        formatDuration(remain).c_str());
  }

  probeLastHasFrame = true;
  probeLastHadError = false;
  probeLastError = "";
  probeLastProvider = current().provider;
  probeLastLabel = current().label;
  probeLastSession = current().session;
  probeLastWeekly = current().weekly;
  probeLastRemainSecs = remain;
  lastRenderedSecs() = remain;
}
#endif


}  // namespace

void RendererESP8266::Setup(app::RuntimeContext& ctx) {
  gCtx = &ctx;

#ifndef VIBEBLOCK_PROBE_ONLY
#ifdef TFT_BL
  pinMode(TFT_BL, OUTPUT);
  digitalWrite(TFT_BL, TFT_BACKLIGHT_ON);
#endif
  tft.init();
  tft.setRotation(0);
  gifCore.Setup(kMiniGifPath);
#endif
}

void RendererESP8266::OnFrameAccepted(app::RuntimeContext& ctx, const core::SerialConsumeEvent& event) {
  gCtx = &ctx;

#ifndef VIBEBLOCK_PROBE_ONLY
  Theme previousTheme = activeTheme;
  if (current().hasTheme) {
    Theme frameTheme;
    if (themeFromName(current().theme, frameTheme) && frameTheme != activeTheme) {
      activeTheme = frameTheme;
      screenDirty() = true;
    }
  }

  if (previousTheme == Theme::Mini && activeTheme != Theme::Mini) {
    stopMiniGifPlayback();
  } else if (activeTheme == Theme::Mini && (event.visualChanged || event.themeChanged)) {
    gifCore.ResetFrameSchedule();
  }

  if (!event.hadFrame) {
    stopMiniGifPlayback();
  }
#endif

  if (event.visualChanged) {
    screenDirty() = true;
  }
}

void RendererESP8266::DrawSplash(app::RuntimeContext& ctx) {
  gCtx = &ctx;

#ifndef VIBEBLOCK_PROBE_ONLY
  drawSplash();
#else
  if (!hasFrame()) {
    Serial.println("probe_waiting_for_frame");
  }
#endif
}

void RendererESP8266::TickSplash(app::RuntimeContext& ctx) {
  gCtx = &ctx;

#ifndef VIBEBLOCK_PROBE_ONLY
  tickSplashWaitingDots();
#endif
}

void RendererESP8266::TickActive(app::RuntimeContext& ctx) {
  gCtx = &ctx;

#ifndef VIBEBLOCK_PROBE_ONLY
  tickMiniGif(false);
#endif
}

void RendererESP8266::DrawError(app::RuntimeContext& ctx, const String& message) {
  gCtx = &ctx;

#ifndef VIBEBLOCK_PROBE_ONLY
  drawError(message);
#else
  (void)message;
  renderProbe();
#endif
}

void RendererESP8266::DrawUsage(app::RuntimeContext& ctx) {
  gCtx = &ctx;

#ifdef VIBEBLOCK_PROBE_ONLY
  renderProbe();
#else
  drawUsage();
#endif
}

void RendererESP8266::DrawReset(app::RuntimeContext& ctx, int64_t remainSecs) {
  gCtx = &ctx;

#ifndef VIBEBLOCK_PROBE_ONLY
  drawResetCountdownLine(remainSecs);
#else
  (void)remainSecs;
  screenDirty() = true;
#endif
}

}  // namespace esp8266
}  // namespace vibeblock
