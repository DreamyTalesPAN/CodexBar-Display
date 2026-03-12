#include "renderer_esp8266_display_state.h"

#ifndef CODEXBAR_DISPLAY_PROBE_ONLY

#include <cstdio>
#include <cstring>

namespace codexbar_display {
namespace esp8266 {
namespace display {

namespace {

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

void setCrtTextStyle(uint8_t textSize = 1) {
  TFT_eSPI& tft = Tft();
  tft.setTextFont(2);
  tft.setTextSize(textSize);
}

int centeredTextXCrt(const char* text) {
  TFT_eSPI& tft = Tft();
  int x = (tft.width() - tft.textWidth(text)) / 2;
  if (x < 0) {
    return 0;
  }
  return x;
}

int rightAlignedTextXCrt(const char* text, int rightPadding) {
  TFT_eSPI& tft = Tft();
  int x = tft.width() - rightPadding - tft.textWidth(text);
  if (x < 0) {
    return 0;
  }
  return x;
}

void drawCrtHeader(const char* title, bool showStatusDot) {
  TFT_eSPI& tft = Tft();

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
    PrimitiveFillRect(kCrtStatusDotX, kCrtStatusDotY, kCrtStatusDotSize, kCrtStatusDotSize, kCrtGreen);
  }
}

void drawSplashHintLineCRT() {
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

  char hint[32];
  if (remainingSecs > 0) {
    std::snprintf(hint, sizeof(hint), "Frames in ~%lus", remainingSecs);
  } else {
    std::snprintf(hint, sizeof(hint), "Waiting for frames");
  }

  TFT_eSPI& tft = Tft();
  uint8_t hintSize = 2;
  setCrtTextStyle(hintSize);
  if (tft.textWidth(hint) > kCrtBodyW) {
    hintSize = 1;
    setCrtTextStyle(hintSize);
  }
  PrimitiveFillRect(0, kCrtSplashHintClearY, tft.width(), kCrtSplashHintClearH, kCrtBg);
  tft.setTextColor(kCrtDim, kCrtBg);
  const int hintY = hintSize > 1 ? kCrtSplashHintY : (kCrtSplashHintY + 8);
  tft.setCursor(centeredTextXCrt(hint), hintY);
  tft.print(hint);
}

void drawSplashWaitingLineCRT() {
  char line2[24] = "FRAMES";
  std::strcat(line2, SplashDotsSuffix());

  TFT_eSPI& tft = Tft();
  uint8_t lineSize = 2;
  setCrtTextStyle(lineSize);
  if (tft.textWidth(line2) > kCrtBodyW) {
    lineSize = 1;
    setCrtTextStyle(lineSize);
  }
  PrimitiveFillRect(0, kCrtSplashLine2ClearY, tft.width(), kCrtSplashLine2ClearH, kCrtBg);
  tft.setTextColor(kCrtGreen, kCrtBg);
  const int lineY = lineSize > 1 ? kCrtSplashLine2Y : (kCrtSplashLine2Y + 8);
  tft.setCursor(centeredTextXCrt(line2), lineY);
  tft.print(line2);
}

void drawResetCountdownLineCRT(int64_t remain) {
  TFT_eSPI& tft = Tft();

  const String countdown = FormatDuration(remain);
  constexpr int minGap = 12;
  uint8_t resetSize = 2;

  setCrtTextStyle(resetSize);
  if ((tft.textWidth("RST IN") + minGap + tft.textWidth(countdown.c_str())) > kCrtBodyW) {
    resetSize = 1;
    setCrtTextStyle(resetSize);
  }
  PrimitiveFillRect(0, kCrtResetClearY, tft.width(), kCrtResetClearH, kCrtBg);
  tft.setTextColor(kCrtDim, kCrtBg);
  const int resetY = resetSize > 1 ? kCrtResetLabelY : (kCrtResetLabelY + 8);
  tft.setCursor(kCrtBodyX, resetY);
  tft.print("RST IN");

  tft.setTextColor(kCrtGreen, kCrtBg);
  tft.setCursor(rightAlignedTextXCrt(countdown.c_str(), 8), resetY);
  tft.print(countdown);

  LastRenderedSecs() = remain;
  LastRenderedMinuteBucket() = remain / 60;
}

}  // namespace

void DrawSplashCRT() {
  TFT_eSPI& tft = Tft();

  PrimitiveFillScreen(kCrtBg);
  drawCrtHeader("CODEXBAR", false);

  setCrtTextStyle(2);
  tft.setTextColor(kCrtDim, kCrtBg);
  tft.setCursor(centeredTextXCrt("WAITING FOR"), kCrtSplashLine1Y);
  tft.print("WAITING FOR");

  SplashWaitingDots() = 0;
  SplashDotsLastTick() = millis();
  SplashStartedAt() = millis();
  SplashHintLastTick() = SplashStartedAt();
  drawSplashWaitingLineCRT();
  drawSplashHintLineCRT();

  LastRenderedSecs() = -1;
  LastRenderedMinuteBucket() = -1;
}

void TickSplashCRT() {
  if (HasFrame()) {
    return;
  }
  const unsigned long now = millis();
  if (SplashDotsLastTick() == 0 || (now - SplashDotsLastTick()) < 450UL) {
    return;
  }

  SplashDotsLastTick() = now;
  SplashWaitingDots() = static_cast<uint8_t>((SplashWaitingDots() + 1) % 3);
  drawSplashWaitingLineCRT();

  if (SplashHintLastTick() == 0 || (now - SplashHintLastTick()) >= 1000UL) {
    SplashHintLastTick() = now;
    drawSplashHintLineCRT();
  }
}

void DrawErrorCRT(const String& message) {
  TFT_eSPI& tft = Tft();

  PrimitiveFillScreen(kCrtBg);
  drawCrtHeader("CODEXBAR", false);

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

  LastRenderedSecs() = -1;
  LastRenderedMinuteBucket() = -1;
}

void DrawUsageCRT() {
  TFT_eSPI& tft = Tft();

  const int64_t remain = CurrentRemainingSecs();
  const int session = codexbar_display::core::ClampPct(CurrentFrame().session);
  const int weekly = codexbar_display::core::ClampPct(CurrentFrame().weekly);
  const int innerBarWidth = kCrtBodyW - 2;
  const int innerBarHeight = kCrtBarH - 2;

  PrimitiveFillScreen(kCrtBg);
  drawCrtHeader(ProviderLabelText(), true);

  setCrtTextStyle(2);
  char pctBuf[8];

  tft.setTextColor(kCrtDim, kCrtBg);
  tft.setCursor(kCrtBodyX, kCrtSessionLabelY);
  tft.print("SESSION");
  std::snprintf(pctBuf, sizeof(pctBuf), "%d%%", session);
  tft.setTextColor(kCrtGreen, kCrtBg);
  tft.setCursor(rightAlignedTextXCrt(pctBuf, 8), kCrtSessionLabelY);
  tft.print(pctBuf);
  PrimitiveFillRect(kCrtBodyX, kCrtSessionBarY, kCrtBodyW, kCrtBarH, kCrtTrack);
  tft.drawRect(kCrtBodyX, kCrtSessionBarY, kCrtBodyW, kCrtBarH, kCrtBorder);
  const int sessionFill = (innerBarWidth * session) / 100;
  if (sessionFill > 0) {
    PrimitiveFillRect(kCrtBodyX + 1, kCrtSessionBarY + 1, sessionFill, innerBarHeight, kCrtGreen);
  }

  tft.setTextColor(kCrtDim, kCrtBg);
  tft.setCursor(kCrtBodyX, kCrtWeeklyLabelY);
  tft.print("WEEKLY");
  std::snprintf(pctBuf, sizeof(pctBuf), "%d%%", weekly);
  tft.setTextColor(kCrtGreen, kCrtBg);
  tft.setCursor(rightAlignedTextXCrt(pctBuf, 8), kCrtWeeklyLabelY);
  tft.print(pctBuf);
  PrimitiveFillRect(kCrtBodyX, kCrtWeeklyBarY, kCrtBodyW, kCrtBarH, kCrtTrack);
  tft.drawRect(kCrtBodyX, kCrtWeeklyBarY, kCrtBodyW, kCrtBarH, kCrtBorder);
  const int weeklyFill = (innerBarWidth * weekly) / 100;
  if (weeklyFill > 0) {
    PrimitiveFillRect(kCrtBodyX + 1, kCrtWeeklyBarY + 1, weeklyFill, innerBarHeight, kCrtGreen);
  }

  tft.drawFastHLine(kCrtBodyX, kCrtMidDividerY, kCrtBodyW, kCrtBorder);
  tft.drawFastHLine(kCrtBodyX, kCrtMidDividerY + 1, kCrtBodyW, kCrtBorder);
  drawResetCountdownLineCRT(remain);
}

void DrawResetCRT(int64_t remainSecs) {
  drawResetCountdownLineCRT(remainSecs);
}

}  // namespace display
}  // namespace esp8266
}  // namespace codexbar_display

#endif
