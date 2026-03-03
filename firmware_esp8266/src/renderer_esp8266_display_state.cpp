#include "renderer_esp8266_display_state.h"

#ifndef CODEXBAR_DISPLAY_PROBE_ONLY

#include <cstring>

namespace codexbar_display {
namespace esp8266 {
namespace display {

SharedState& State() {
  static SharedState state;
  return state;
}

void AttachContext(app::RuntimeContext& ctx) {
  State().ctx = &ctx;
}

void DrawBar(int x, int y, int w, int h, int pct, uint16_t fillColor) {
  TFT_eSPI& tft = Tft();
  const int p = codexbar_display::core::ClampPct(pct);
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

int TextPixelWidth(const char* text, int textSize) {
  if (text == nullptr || textSize <= 0) {
    return 0;
  }
  return static_cast<int>(strlen(text)) * 6 * textSize;
}

int TextPixelHeight(int textSize) {
  if (textSize <= 0) {
    return 0;
  }
  return 8 * textSize;
}

int ChooseTextSizeToFit(const char* text, int maxSize, int minSize, int maxWidth) {
  for (int size = maxSize; size >= minSize; --size) {
    if (TextPixelWidth(text, size) <= maxWidth) {
      return size;
    }
  }
  return minSize;
}

int CenteredTextX(const char* text, int textSize) {
  int x = (Tft().width() - TextPixelWidth(text, textSize)) / 2;
  if (x < 0) {
    return 0;
  }
  return x;
}

void SetClassicTextSize(int size) {
  Tft().setTextFont(1);
  Tft().setTextSize(size);
}

const char* ProviderLabelText() {
  if (CurrentFrame().label.length()) {
    return CurrentFrame().label.c_str();
  }
  return "Provider";
}

const char* SplashDotsSuffix() {
  switch (SplashWaitingDots()) {
    case 0:
      return ".";
    case 1:
      return "..";
    default:
      return "...";
  }
}

}  // namespace display
}  // namespace esp8266
}  // namespace codexbar_display

#endif
