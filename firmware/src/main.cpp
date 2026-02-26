#include <Arduino.h>
#include <TFT_eSPI.h>

#include "../../firmware_shared/vibeblock_core.h"

#ifndef VIBEBLOCK_BOARD_ID
#define VIBEBLOCK_BOARD_ID "esp32-unknown"
#endif

#ifndef VIBEBLOCK_FW_VERSION
#define VIBEBLOCK_FW_VERSION "dev"
#endif

namespace {

TFT_eSPI tft = TFT_eSPI();

vibeblock::core::RuntimeState runtimeState;
vibeblock::core::LineReaderState lineReaderState;

bool screenDirty = true;
int64_t lastRenderedSecs = -1;

vibeblock::core::Frame& current = runtimeState.current;
bool& hasFrame = runtimeState.hasFrame;

constexpr int kContentX = 10;
constexpr int kContentW = 300;
constexpr int kSessionLabelY = 48;
constexpr int kSessionBarY = 72;
constexpr int kWeeklyLabelY = 92;
constexpr int kWeeklyBarY = 116;
constexpr int kBarHeight = 12;
constexpr int kResetY = 140;
constexpr uint16_t kAnthropicOrange = 0xDBAA;

int clampPct(int v) {
  return vibeblock::core::ClampPct(v);
}

int64_t currentRemainingSecs() {
  return vibeblock::core::CurrentRemainingSecs(runtimeState, millis());
}

String formatDuration(int64_t secs) {
  return vibeblock::core::FormatDuration(secs);
}

void drawResetLine(int64_t remainSecs) {
  tft.fillRect(kContentX, kResetY, kContentW, 28, TFT_BLACK);
  tft.setTextColor(TFT_WHITE, TFT_BLACK);
  tft.setTextFont(4);
  tft.setCursor(kContentX, kResetY);
  tft.printf("Reset in %s", formatDuration(remainSecs).c_str());
}

void barColorsForProvider(const String& provider, uint16_t& sessionColor, uint16_t& weeklyColor) {
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

void drawBar(int x, int y, int w, int h, int pct, uint16_t fillColor) {
  int p = clampPct(pct);
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

void drawSplash() {
  tft.fillScreen(TFT_BLACK);
  tft.setTextColor(TFT_WHITE, TFT_BLACK);
  tft.setTextFont(2);
  tft.setCursor(14, 40);
  tft.println("vibeblock 1");
  tft.setCursor(14, 80);
  tft.setTextColor(TFT_LIGHTGREY, TFT_BLACK);
  tft.println("Waiting for CodexBar...");
}

void drawError(const String& message) {
  tft.fillScreen(TFT_BLACK);
  tft.setTextFont(2);
  tft.setTextColor(TFT_ORANGE, TFT_BLACK);
  tft.setCursor(10, 16);
  tft.println("vibeblock error");

  tft.setTextColor(TFT_WHITE, TFT_BLACK);
  tft.setCursor(10, 48);
  tft.println(message);
}

void drawUsage() {
  int64_t remain = currentRemainingSecs();
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

  drawResetLine(remain);

  lastRenderedSecs = remain;
}

void consumeSerial() {
  while (Serial.available() > 0) {
    const char c = static_cast<char>(Serial.read());
    vibeblock::core::SerialConsumeEvent event;
    if (vibeblock::core::ConsumeSerialByte(
            lineReaderState,
            runtimeState,
            c,
            millis(),
            false,
            event)) {
      if (event.visualChanged) {
        screenDirty = true;
      }
      Serial.println("frame_received");
    }
  }
}

void emitDeviceHello() {
  Serial.printf(
      "{\"kind\":\"hello\",\"protocolVersion\":1,\"board\":\"%s\",\"firmware\":\"%s\","
      "\"features\":[],\"maxFrameBytes\":512}\n",
      VIBEBLOCK_BOARD_ID,
      VIBEBLOCK_FW_VERSION);
}

}  // namespace

void setup() {
  Serial.begin(115200);
  delay(200);

#ifdef TFT_BL
  pinMode(TFT_BL, OUTPUT);
  digitalWrite(TFT_BL, TFT_BACKLIGHT_ON);
#endif
  // LilyGO T-Display-S3 requires GPIO15 high to power the LCD panel.
  pinMode(15, OUTPUT);
  digitalWrite(15, HIGH);

  tft.init();
  tft.setRotation(1);
  drawSplash();

  emitDeviceHello();
  Serial.println("vibeblock_ready");
}

void loop() {
  consumeSerial();

  if (hasFrame && !current.hasError && !screenDirty) {
    int64_t remain = currentRemainingSecs();
    if (remain != lastRenderedSecs) {
      drawResetLine(remain);
      lastRenderedSecs = remain;
    }
  }

  if (screenDirty) {
    if (!hasFrame) {
      drawSplash();
    } else if (current.hasError) {
      drawError(current.error);
    } else {
      drawUsage();
    }
    screenDirty = false;
  }

  delay(20);
}
