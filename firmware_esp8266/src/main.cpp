#include <Arduino.h>
#include <ArduinoJson.h>

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
unsigned long resetBaseMillis = 0;
int64_t resetBaseSecs = 0;

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

  tft.drawRect(x, y, w, h, TFT_DARKGREY);
  tft.fillRect(x + 1, y + 1, w - 2, h - 2, TFT_BLACK);
  if (filled > 0) {
    tft.fillRect(x + 1, y + 1, filled, h - 2, fillColor);
  }
}

void drawSplash() {
  tft.fillScreen(TFT_BLACK);
  tft.setTextColor(TFT_WHITE, TFT_BLACK);
  tft.setTextSize(2);
  tft.setCursor(8, 16);
  tft.println("vibeblock");
  tft.setTextSize(1);
  tft.setTextColor(TFT_LIGHTGREY, TFT_BLACK);
  tft.setCursor(8, 48);
  tft.println("Waiting for frames...");
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
}

void drawUsage() {
  const int64_t remain = currentRemainingSecs();
  constexpr int x = 8;
  const int w = tft.width() - (x * 2);
  constexpr int barH = 12;

  tft.fillScreen(TFT_BLACK);
  tft.setTextColor(TFT_WHITE, TFT_BLACK);
  tft.setTextSize(2);
  tft.setCursor(x, 10);
  tft.println(current.label.length() ? current.label : "Provider");

  tft.setTextSize(1);
  tft.setTextColor(TFT_LIGHTGREY, TFT_BLACK);
  tft.setCursor(x, 48);
  tft.printf("Session %d%% used", current.session);
  drawBar(x, 62, w, barH, current.session, TFT_CYAN);

  tft.setCursor(x, 88);
  tft.printf("Weekly %d%% used", current.weekly);
  drawBar(x, 102, w, barH, current.weekly, TFT_GREEN);

  tft.setCursor(x, 130);
  tft.setTextColor(TFT_WHITE, TFT_BLACK);
  tft.printf("Reset in %s", formatDuration(remain).c_str());

  lastRenderedSecs = remain;
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
          current = next;
          hasFrame = true;
          screenDirty = true;
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
      screenDirty = true;
    }
  }

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
