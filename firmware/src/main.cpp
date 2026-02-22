#include <Arduino.h>
#include <ArduinoJson.h>
#include <TFT_eSPI.h>

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

TFT_eSPI tft = TFT_eSPI();

char lineBuffer[512];
size_t lineLen = 0;

Frame current;
bool hasFrame = false;
bool screenDirty = true;
int64_t lastRenderedSecs = -1;
unsigned long resetBaseMillis = 0;
int64_t resetBaseSecs = 0;

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
  unsigned long elapsedMillis = millis() - resetBaseMillis;
  int64_t elapsedSecs = static_cast<int64_t>(elapsedMillis / 1000UL);
  int64_t remain = resetBaseSecs - elapsedSecs;
  if (remain < 0) {
    return 0;
  }
  return remain;
}

String formatDuration(int64_t secs) {
  int64_t hours = secs / 3600;
  int64_t minutes = (secs % 3600) / 60;

  if (hours > 0) {
    return String(hours) + "h " + String(minutes) + "m";
  }
  return String(minutes) + "m";
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

  tft.fillScreen(TFT_BLACK);
  tft.setTextFont(4);
  tft.setTextColor(TFT_WHITE, TFT_BLACK);
  tft.setCursor(10, 12);
  tft.println(current.label.length() ? current.label : "Provider");

  tft.setTextFont(2);
  tft.setTextColor(TFT_LIGHTGREY, TFT_BLACK);
  tft.setCursor(10, 60);
  tft.printf("Session %d%%", current.session);
  drawBar(10, 76, 300, 16, current.session, TFT_CYAN);

  tft.setCursor(10, 106);
  tft.printf("Weekly  %d%%", current.weekly);
  drawBar(10, 122, 300, 16, current.weekly, TFT_GREEN);

  tft.setTextColor(TFT_WHITE, TFT_BLACK);
  tft.setCursor(10, 152);
  tft.printf("Reset in %s", formatDuration(remain).c_str());

  lastRenderedSecs = remain;
}

bool parseFrameLine(const char* line, Frame& out) {
  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, line);
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
    char c = static_cast<char>(Serial.read());

    if (c == '\r') {
      continue;
    }

    if (c == '\n') {
      lineBuffer[lineLen] = '\0';
      if (lineLen > 0) {
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
      continue;
    }

    if (lineLen + 1 < sizeof(lineBuffer)) {
      lineBuffer[lineLen++] = c;
    } else {
      lineLen = 0;
    }
  }
}

}  // namespace

void setup() {
  Serial.begin(115200);
  delay(200);

#ifdef TFT_BL
  pinMode(TFT_BL, OUTPUT);
  digitalWrite(TFT_BL, TFT_BACKLIGHT_ON);
#endif

  tft.init();
  tft.setRotation(1);
  drawSplash();

  Serial.println("vibeblock_ready");
}

void loop() {
  consumeSerial();

  if (hasFrame && !current.hasError) {
    int64_t remain = currentRemainingSecs();
    if (remain != lastRenderedSecs) {
      screenDirty = true;
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
