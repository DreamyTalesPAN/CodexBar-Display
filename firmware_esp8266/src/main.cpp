#include <Arduino.h>
#include <ArduinoJson.h>
#include <cstdio>
#include <cstring>

#ifndef VIBEBLOCK_PROBE_ONLY
#include <TFT_eSPI.h>
#endif

namespace {

struct Frame {
  String provider;
  String label;
  int session = 0;
  int weekly = 0;
  int64_t resetSecs = 0;
  bool hasError = false;
  String error;
};

char lineBuffer[512];
size_t lineLen = 0;
bool lineOverflowed = false;
bool screenDirty = true;

Frame current;
bool hasFrame = false;
int64_t lastRenderedSecs = -1;
int64_t lastRenderedMinuteBucket = -1;
unsigned long resetBaseMillis = 0;
int64_t resetBaseSecs = 0;

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

int clampPct(int v) {
  if (v < 0) {
    return 0;
  }
  if (v > 100) {
    return 100;
  }
  return v;
}

int64_t currentRemainingSecs() {
  if (!hasFrame) {
    return 0;
  }
  const unsigned long elapsedMillis = millis() - resetBaseMillis;
  const int64_t elapsedSecs = static_cast<int64_t>(elapsedMillis / 1000UL);
  const int64_t remain = resetBaseSecs - elapsedSecs;
  if (remain < 0) {
    return 0;
  }
  return remain;
}

String formatDuration(int64_t secs) {
  const int64_t hours = secs / 3600;
  const int64_t minutes = (secs % 3600) / 60;
  if (hours > 0) {
    return String(hours) + "h " + String(minutes) + "m";
  }
  return String(minutes) + "m";
}

#ifndef VIBEBLOCK_PROBE_ONLY
void drawBar(int x, int y, int w, int h, int pct, uint16_t fillColor) {
  const int p = clampPct(pct);
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

UsageLayout usageLayoutForProvider(const char* providerText) {
  UsageLayout layout;
  layout.w = tft.width() - (layout.x * 2);
  layout.providerSize = chooseTextSizeToFit(providerText, 4, 2, tft.width() - 4);
  layout.labelSize = chooseTextSizeToFit("Session 100% used", 3, 2, layout.w);
  layout.resetSize = chooseTextSizeToFit("Reset in 999h 59m", 3, 2, tft.width() - 4);

  constexpr int spacingSlots = 5;  // top + 3 internal gaps + bottom
  int minGap = 5;                  // reduced spacing while keeping even distribution

  for (;;) {
    if (usageCoreHeightFor(layout)+(spacingSlots*minGap) <= tft.height()) {
      break;
    }

    bool reduced = false;
    if (layout.resetSize > 2) {
      --layout.resetSize;
      reduced = true;
    } else if (layout.providerSize > 2) {
      --layout.providerSize;
      reduced = true;
    } else if (layout.labelSize > 2) {
      --layout.labelSize;
      reduced = true;
    } else if (layout.barH > 18) {
      layout.barH -= 2;
      reduced = true;
    } else if (layout.labelToBarGap > 1) {
      --layout.labelToBarGap;
      reduced = true;
    } else if (minGap > 1) {
      --minGap;
      reduced = true;
    } else if (layout.resetSize > 1) {
      --layout.resetSize;
      reduced = true;
    } else if (layout.labelSize > 1) {
      --layout.labelSize;
      reduced = true;
    } else if (layout.providerSize > 1) {
      --layout.providerSize;
      reduced = true;
    }

    if (!reduced) {
      break;
    }
  }

  int slotGaps[spacingSlots] = {0, 0, 0, 0, 0};
  const int available = tft.height() - usageCoreHeightFor(layout);
  if (available > 0) {
    if (available >= spacingSlots*minGap) {
      const int extra = available - (spacingSlots * minGap);
      const int extraEach = extra / spacingSlots;
      const int extraRemainder = extra % spacingSlots;
      for (int i = 0; i < spacingSlots; ++i) {
        slotGaps[i] = minGap + extraEach + (i < extraRemainder ? 1 : 0);
      }
    } else {
      const int gapEach = available / spacingSlots;
      const int gapRemainder = available % spacingSlots;
      for (int i = 0; i < spacingSlots; ++i) {
        slotGaps[i] = gapEach + (i < gapRemainder ? 1 : 0);
      }
    }
  }

  // Keep internal rhythm compact; push surplus mainly into top/bottom padding.
  constexpr int maxInternalGap = 8;
  int reclaimed = 0;
  for (int i = 1; i <= 3; ++i) {
    if (slotGaps[i] > maxInternalGap) {
      reclaimed += (slotGaps[i] - maxInternalGap);
      slotGaps[i] = maxInternalGap;
    }
  }
  if (reclaimed > 0) {
    slotGaps[0] += reclaimed / 2;
    slotGaps[4] += reclaimed - (reclaimed / 2);
  }

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

SplashLayout splashLayout() {
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

void drawSplashWaitingLine(const SplashLayout& layout) {
  char line2[16] = "frames";
  std::strcat(line2, splashDotsSuffix());

  tft.fillRect(0, layout.line2ClearY, tft.width(), layout.line2ClearH, TFT_BLACK);
  tft.setTextColor(TFT_LIGHTGREY, TFT_BLACK);
  tft.setTextSize(layout.subtitleSize);
  tft.setCursor(centeredTextX(line2, layout.subtitleSize), layout.line2Y);
  tft.print(line2);
}

void drawSplashHintLine(const SplashLayout& layout) {
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
  tft.setTextSize(layout.hintSize);
  tft.setCursor(centeredTextX(hint, layout.hintSize), layout.hintY);
  tft.print(hint);
}

void drawSplash() {
  constexpr char kTitle[] = "VIBEBLOCK";
  constexpr char kLine1[] = "Waiting for";

  const SplashLayout layout = splashLayout();
  tft.fillScreen(TFT_BLACK);

  tft.setTextColor(TFT_CYAN, TFT_BLACK);
  tft.setTextSize(layout.titleSize);
  tft.setCursor(centeredTextX(kTitle, layout.titleSize), layout.titleY);
  tft.print(kTitle);

  tft.setTextColor(TFT_WHITE, TFT_BLACK);
  tft.setTextSize(layout.subtitleSize);
  tft.setCursor(centeredTextX(kLine1, layout.subtitleSize), layout.line1Y);
  tft.print(kLine1);

  splashWaitingDots = 0;
  splashDotsLastTick = millis();
  splashStartedAt = millis();
  splashHintLastTick = splashStartedAt;
  drawSplashWaitingLine(layout);
  drawSplashHintLine(layout);

  lastRenderedSecs = -1;
  lastRenderedMinuteBucket = -1;
}

void tickSplashWaitingDots() {
  if (hasFrame) {
    return;
  }
  const unsigned long now = millis();
  if (splashDotsLastTick == 0 || (now - splashDotsLastTick) < 450UL) {
    return;
  }

  splashDotsLastTick = now;
  splashWaitingDots = static_cast<uint8_t>((splashWaitingDots + 1) % 3);
  const SplashLayout layout = splashLayout();
  drawSplashWaitingLine(layout);

  if (splashHintLastTick == 0 || (now - splashHintLastTick) >= 1000UL) {
    splashHintLastTick = now;
    drawSplashHintLine(layout);
  }
}

void drawError(const String& message) {
  tft.fillScreen(TFT_BLACK);
  tft.setTextSize(2);
  tft.setTextColor(TFT_ORANGE, TFT_BLACK);
  tft.setCursor(8, 16);
  tft.println("error");
  tft.setTextSize(1);
  tft.setTextColor(TFT_WHITE, TFT_BLACK);
  tft.setCursor(8, 50);
  tft.println(message);
  lastRenderedSecs = -1;
  lastRenderedMinuteBucket = -1;
}

void drawResetCountdownLine(int64_t remain) {
  const char* providerText = current.label.length() ? current.label.c_str() : "Provider";
  const UsageLayout layout = usageLayoutForProvider(providerText);
  const String resetLabel = String("Reset in ") + formatDuration(remain);

  tft.fillRect(0, layout.resetClearY, tft.width(), layout.resetClearH, TFT_BLACK);
  tft.setTextSize(layout.resetSize);
  tft.setTextColor(TFT_WHITE, TFT_BLACK);
  tft.setCursor(centeredTextX(resetLabel.c_str(), layout.resetSize), layout.resetY);
  tft.print(resetLabel);

  lastRenderedSecs = remain;
  lastRenderedMinuteBucket = remain / 60;
}

void drawUsage() {
  const int64_t remain = currentRemainingSecs();
  const char* providerText = current.label.length() ? current.label.c_str() : "Provider";
  const UsageLayout layout = usageLayoutForProvider(providerText);

  tft.fillScreen(TFT_BLACK);
  tft.setTextColor(TFT_CYAN, TFT_BLACK);
  tft.setTextSize(layout.providerSize);
  tft.setCursor(centeredTextX(providerText, layout.providerSize), layout.providerY);
  tft.print(providerText);

  const String sessionLabel = String("Session ") + String(current.session) + "% used";
  const String weeklyLabel = String("Weekly ") + String(current.weekly) + "% used";

  tft.setTextSize(layout.labelSize);
  tft.setTextColor(TFT_WHITE, TFT_BLACK);
  tft.setCursor(centeredTextX(sessionLabel.c_str(), layout.labelSize), layout.label1Y);
  tft.print(sessionLabel);
  drawBar(layout.x, layout.bar1Y, layout.w, layout.barH, current.session, TFT_CYAN);

  tft.setCursor(centeredTextX(weeklyLabel.c_str(), layout.labelSize), layout.label2Y);
  tft.print(weeklyLabel);
  drawBar(layout.x, layout.bar2Y, layout.w, layout.barH, current.weekly, TFT_GREEN);

  drawResetCountdownLine(remain);
}
#else
void renderProbe() {
  if (!hasFrame) {
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
  if (current.hasError) {
    const bool changed = !probeLastHasFrame || !probeLastHadError || current.error != probeLastError;
    if (changed) {
      Serial.printf("probe_error error=%s\n", current.error.c_str());
    }
    probeLastHasFrame = true;
    probeLastHadError = true;
    probeLastError = current.error;
    probeLastProvider = current.provider;
    probeLastLabel = current.label;
    probeLastSession = current.session;
    probeLastWeekly = current.weekly;
    probeLastRemainSecs = remain;
    lastRenderedSecs = remain;
    return;
  }

  const bool changed =
      !probeLastHasFrame ||
      probeLastHadError ||
      current.provider != probeLastProvider ||
      current.label != probeLastLabel ||
      current.session != probeLastSession ||
      current.weekly != probeLastWeekly ||
      remain != probeLastRemainSecs;

  if (changed) {
    Serial.printf(
        "probe_usage label=%s provider=%s session=%d weekly=%d reset=%s\n",
        current.label.c_str(),
        current.provider.c_str(),
        current.session,
        current.weekly,
        formatDuration(remain).c_str());
  }

  probeLastHasFrame = true;
  probeLastHadError = false;
  probeLastError = "";
  probeLastProvider = current.provider;
  probeLastLabel = current.label;
  probeLastSession = current.session;
  probeLastWeekly = current.weekly;
  probeLastRemainSecs = remain;
  lastRenderedSecs = remain;
}
#endif

bool parseFrameLine(const char* line, Frame& out) {
  JsonDocument doc;
  const DeserializationError err = deserializeJson(doc, line);
  if (err) {
    out = {};
    out.hasError = true;
    out.error = String("bad json: ") + err.c_str();
    return true;
  }

  if (doc["error"].is<const char*>()) {
    out = {};
    out.hasError = true;
    out.error = String(doc["error"].as<const char*>());
    return true;
  }

  out = {};
  out.provider = String(doc["provider"] | "");
  out.label = String(doc["label"] | "Provider");
  out.session = clampPct(doc["session"] | 0);
  out.weekly = clampPct(doc["weekly"] | 0);
  out.resetSecs = static_cast<int64_t>(doc["resetSecs"] | 0);
  out.hasError = false;
  out.error = "";
  return true;
}

bool frameVisualChanged(const Frame& previous, const Frame& next) {
  if (previous.hasError != next.hasError) {
    return true;
  }
  if (next.hasError) {
    return previous.error != next.error;
  }
  return previous.provider != next.provider ||
         previous.label != next.label ||
         previous.session != next.session ||
         previous.weekly != next.weekly;
}

void consumeSerial() {
  while (Serial.available() > 0) {
    const char c = static_cast<char>(Serial.read());

    if (c == '\r') {
      continue;
    }

    if (c == '\n') {
      lineBuffer[lineLen] = '\0';
      if (!lineOverflowed && lineLen > 0) {
        Frame next;
        if (parseFrameLine(lineBuffer, next)) {
          const bool hadFrame = hasFrame;
          const bool visualChanged = !hadFrame || frameVisualChanged(current, next);
          current = next;
          hasFrame = true;
          if (visualChanged) {
            screenDirty = true;
          }
          resetBaseSecs = current.resetSecs;
          resetBaseMillis = millis();
          Serial.println("frame_received");
        }
      }
      lineLen = 0;
      lineOverflowed = false;
      continue;
    }

    if (!lineOverflowed && lineLen + 1 < sizeof(lineBuffer)) {
      lineBuffer[lineLen++] = c;
    } else {
      lineOverflowed = true;
    }
  }
}

}  // namespace

void setup() {
  Serial.begin(115200);
  delay(200);

#ifndef VIBEBLOCK_PROBE_ONLY
#ifdef TFT_BL
  pinMode(TFT_BL, OUTPUT);
  digitalWrite(TFT_BL, TFT_BACKLIGHT_ON);
#endif
  tft.init();
  tft.setRotation(0);
  drawSplash();
#endif

#ifdef VIBEBLOCK_PROBE_ONLY
  Serial.println("vibeblock_ready_probe");
  Serial.println("probe_waiting_for_frame");
#else
  Serial.println("vibeblock_ready_display");
#endif
}

void loop() {
  consumeSerial();

  if (hasFrame && !current.hasError && !screenDirty) {
    const int64_t remain = currentRemainingSecs();
    if (remain != lastRenderedSecs) {
      const int64_t minuteBucket = remain / 60;
      if (minuteBucket != lastRenderedMinuteBucket) {
#ifdef VIBEBLOCK_PROBE_ONLY
        screenDirty = true;
#else
        drawResetCountdownLine(remain);
#endif
      } else {
        lastRenderedSecs = remain;
      }
    }
  }

#ifndef VIBEBLOCK_PROBE_ONLY
  if (!hasFrame && !screenDirty) {
    tickSplashWaitingDots();
  }
#endif

  if (screenDirty) {
#ifdef VIBEBLOCK_PROBE_ONLY
    renderProbe();
#else
    if (!hasFrame) {
      drawSplash();
    } else if (current.hasError) {
      drawError(current.error);
    } else {
      drawUsage();
    }
#endif
    screenDirty = false;
  }

  delay(20);
}
