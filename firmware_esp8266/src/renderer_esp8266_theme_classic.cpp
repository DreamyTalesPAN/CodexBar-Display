#include "renderer_esp8266_display_state.h"

#ifndef CODEXBAR_DISPLAY_PROBE_ONLY

#include <cstdio>
#include <cstring>

namespace codexbar_display {
namespace esp8266 {
namespace display {

namespace {

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

constexpr int kUsageSpacingSlots = 5;
constexpr int kUsageMaxInternalGap = 8;

int usageCoreHeightFor(const UsageLayout& layout) {
  return TextPixelHeight(layout.providerSize) +
         TextPixelHeight(layout.labelSize) +
         layout.labelToBarGap +
         layout.barH +
         TextPixelHeight(layout.labelSize) +
         layout.labelToBarGap +
         layout.barH +
         TextPixelHeight(layout.resetSize);
}

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
  TFT_eSPI& tft = Tft();

  UsageLayout layout;
  layout.w = tft.width() - (layout.x * 2);
  layout.providerSize = ChooseTextSizeToFit(providerText, 4, 2, tft.width() - 4);
  layout.labelSize = ChooseTextSizeToFit("Session 100% used", 3, 2, layout.w);
  layout.resetSize = ChooseTextSizeToFit("Reset in 999h 59m", 3, 2, tft.width() - 4);

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
  layout.label1Y = layout.providerY + TextPixelHeight(layout.providerSize) + layout.gapProviderToSession;
  layout.bar1Y = layout.label1Y + TextPixelHeight(layout.labelSize) + layout.labelToBarGap;
  layout.label2Y = layout.bar1Y + layout.barH + layout.gapSessionToWeekly;
  layout.bar2Y = layout.label2Y + TextPixelHeight(layout.labelSize) + layout.labelToBarGap;
  layout.resetY = layout.bar2Y + layout.barH + layout.gapWeeklyToReset;
  layout.resetClearY = layout.resetY;
  layout.resetClearH = TextPixelHeight(layout.resetSize) + 2;
  return layout;
}

SplashLayout splashLayoutClassic() {
  TFT_eSPI& tft = Tft();

  constexpr char kTitle[] = "CODEXBAR";
  constexpr char kLine1[] = "Waiting for";
  constexpr char kHintSample[] = "Frames in ~30s";

  SplashLayout layout;
  const int maxWidth = tft.width() - 8;
  layout.titleSize = ChooseTextSizeToFit(kTitle, 4, 2, maxWidth);
  layout.subtitleSize = ChooseTextSizeToFit(kLine1, 3, 1, maxWidth);
  layout.hintSize = ChooseTextSizeToFit(kHintSample, 3, 2, maxWidth);

  const int titleH = TextPixelHeight(layout.titleSize);
  const int subtitleH = TextPixelHeight(layout.subtitleSize);
  const int hintH = TextPixelHeight(layout.hintSize);
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
  if (SplashStartedAt() > 0 && now >= SplashStartedAt()) {
    elapsedSecs = (now - SplashStartedAt()) / 1000UL;
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

  TFT_eSPI& tft = Tft();
  PrimitiveFillRect(0, layout.hintClearY, tft.width(), layout.hintClearH, TFT_BLACK);
  tft.setTextColor(TFT_LIGHTGREY, TFT_BLACK);
  SetClassicTextSize(layout.hintSize);
  tft.setCursor(CenteredTextX(hint, layout.hintSize), layout.hintY);
  tft.print(hint);
}

void drawSplashWaitingLineClassic(const SplashLayout& layout) {
  char line2[16] = "frames";
  std::strcat(line2, SplashDotsSuffix());

  TFT_eSPI& tft = Tft();
  PrimitiveFillRect(0, layout.line2ClearY, tft.width(), layout.line2ClearH, TFT_BLACK);
  tft.setTextColor(TFT_LIGHTGREY, TFT_BLACK);
  SetClassicTextSize(layout.subtitleSize);
  tft.setCursor(CenteredTextX(line2, layout.subtitleSize), layout.line2Y);
  tft.print(line2);
}

void drawResetCountdownLineClassic(int64_t remain) {
  TFT_eSPI& tft = Tft();
  const UsageLayout layout = usageLayoutForProvider(ProviderLabelText());
  const String resetLabel = String("Reset in ") + FormatDuration(remain);

  PrimitiveFillRect(0, layout.resetClearY, tft.width(), layout.resetClearH, TFT_BLACK);
  SetClassicTextSize(layout.resetSize);
  tft.setTextColor(TFT_WHITE, TFT_BLACK);
  tft.setCursor(CenteredTextX(resetLabel.c_str(), layout.resetSize), layout.resetY);
  tft.print(resetLabel);

  LastRenderedSecs() = remain;
  LastRenderedMinuteBucket() = remain / 60;
}

}  // namespace

void DrawSplashClassic() {
  TFT_eSPI& tft = Tft();

  constexpr char kTitle[] = "CODEXBAR";
  constexpr char kLine1[] = "Waiting for";

  const SplashLayout layout = splashLayoutClassic();
  PrimitiveFillScreen(TFT_BLACK);

  tft.setTextColor(TFT_CYAN, TFT_BLACK);
  SetClassicTextSize(layout.titleSize);
  tft.setCursor(CenteredTextX(kTitle, layout.titleSize), layout.titleY);
  tft.print(kTitle);

  tft.setTextColor(TFT_WHITE, TFT_BLACK);
  SetClassicTextSize(layout.subtitleSize);
  tft.setCursor(CenteredTextX(kLine1, layout.subtitleSize), layout.line1Y);
  tft.print(kLine1);

  SplashWaitingDots() = 0;
  SplashDotsLastTick() = millis();
  SplashStartedAt() = millis();
  SplashHintLastTick() = SplashStartedAt();
  drawSplashWaitingLineClassic(layout);
  drawSplashHintLineClassic(layout);

  LastRenderedSecs() = -1;
  LastRenderedMinuteBucket() = -1;
}

void TickSplashClassic() {
  if (HasFrame()) {
    return;
  }

  const unsigned long now = millis();
  if (SplashDotsLastTick() == 0 || (now - SplashDotsLastTick()) < 450UL) {
    return;
  }

  SplashDotsLastTick() = now;
  SplashWaitingDots() = static_cast<uint8_t>((SplashWaitingDots() + 1) % 3);
  const SplashLayout layout = splashLayoutClassic();
  drawSplashWaitingLineClassic(layout);

  if (SplashHintLastTick() == 0 || (now - SplashHintLastTick()) >= 1000UL) {
    SplashHintLastTick() = now;
    drawSplashHintLineClassic(layout);
  }
}

void DrawErrorClassic(const String& message) {
  TFT_eSPI& tft = Tft();

  PrimitiveFillScreen(TFT_BLACK);
  SetClassicTextSize(2);
  tft.setTextColor(TFT_ORANGE, TFT_BLACK);
  tft.setCursor(8, 16);
  tft.println("error");

  SetClassicTextSize(1);
  tft.setTextColor(TFT_WHITE, TFT_BLACK);
  tft.setCursor(8, 50);
  tft.println(message);

  LastRenderedSecs() = -1;
  LastRenderedMinuteBucket() = -1;
}

void DrawUsageClassic() {
  TFT_eSPI& tft = Tft();

  const int64_t remain = CurrentRemainingSecs();
  const char* providerText = ProviderLabelText();
  const UsageLayout layout = usageLayoutForProvider(providerText);

  PrimitiveFillScreen(TFT_BLACK);
  tft.setTextColor(TFT_CYAN, TFT_BLACK);
  SetClassicTextSize(layout.providerSize);
  tft.setCursor(CenteredTextX(providerText, layout.providerSize), layout.providerY);
  tft.print(providerText);

  const String sessionLabel = String("Session ") + String(CurrentFrame().session) + "% used";
  const String weeklyLabel = String("Weekly ") + String(CurrentFrame().weekly) + "% used";

  SetClassicTextSize(layout.labelSize);
  tft.setTextColor(TFT_WHITE, TFT_BLACK);
  tft.setCursor(CenteredTextX(sessionLabel.c_str(), layout.labelSize), layout.label1Y);
  tft.print(sessionLabel);
  DrawBar(layout.x, layout.bar1Y, layout.w, layout.barH, CurrentFrame().session, TFT_CYAN);

  tft.setCursor(CenteredTextX(weeklyLabel.c_str(), layout.labelSize), layout.label2Y);
  tft.print(weeklyLabel);
  DrawBar(layout.x, layout.bar2Y, layout.w, layout.barH, CurrentFrame().weekly, TFT_GREEN);

  drawResetCountdownLineClassic(remain);
}

void DrawResetClassic(int64_t remainSecs) {
  drawResetCountdownLineClassic(remainSecs);
}

}  // namespace display
}  // namespace esp8266
}  // namespace codexbar_display

#endif
