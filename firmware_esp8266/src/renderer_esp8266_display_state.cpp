#include "renderer_esp8266_display_state.h"

#ifndef CODEXBAR_DISPLAY_PROBE_ONLY

#include <cstring>

namespace codexbar_display {
namespace esp8266 {
namespace display {

namespace {

class ESP8266PrimitiveSink final : public primitive::Sink {
 public:
  void FillScreen(uint16_t color) override {
    Tft().fillScreen(color);
  }

  void FillRect(const primitive::RectCommand& cmd) override {
    if (cmd.width <= 0 || cmd.height <= 0) {
      return;
    }
    Tft().fillRect(cmd.x, cmd.y, cmd.width, cmd.height, cmd.color);
  }

  void DrawText(const primitive::TextCommand& cmd) override {
    TFT_eSPI& tft = Tft();
    tft.setTextWrap(cmd.wrap);
    tft.setTextFont(cmd.font);
    tft.setTextSize(cmd.size);
    tft.setTextColor(cmd.fg, cmd.bg);
    tft.setCursor(cmd.x, cmd.y);
    tft.print(cmd.text == nullptr ? "" : cmd.text);
    tft.setTextWrap(false);
  }

  void DrawProgress(const primitive::ProgressCommand& cmd) override {
    const int p = codexbar_display::core::ClampPct(cmd.percent);
    int filled = (cmd.width * p) / 100;
    if (filled > (cmd.width - 2)) {
      filled = cmd.width - 2;
    }
    if (filled < 0) {
      filled = 0;
    }

    int radius = 2;
    if (cmd.height >= 14) {
      radius = 3;
    }
    if (radius > ((cmd.height - 2) / 2)) {
      radius = (cmd.height - 2) / 2;
    }
    if (radius < 0) {
      radius = 0;
    }

    TFT_eSPI& tft = Tft();
    if (radius > 0) {
      tft.drawRoundRect(cmd.x, cmd.y, cmd.width, cmd.height, radius, cmd.borderColor);
      tft.fillRoundRect(cmd.x + 1, cmd.y + 1, cmd.width - 2, cmd.height - 2, radius - 1, cmd.bgColor);
    } else {
      tft.drawRect(cmd.x, cmd.y, cmd.width, cmd.height, cmd.borderColor);
      tft.fillRect(cmd.x + 1, cmd.y + 1, cmd.width - 2, cmd.height - 2, cmd.bgColor);
    }

    if (filled > 0) {
      if (radius > 1 && filled > (radius * 2)) {
        tft.fillRoundRect(cmd.x + 1, cmd.y + 1, filled, cmd.height - 2, radius - 1, cmd.fillColor);
      } else {
        tft.fillRect(cmd.x + 1, cmd.y + 1, filled, cmd.height - 2, cmd.fillColor);
      }
    }
  }
};

}  // namespace

SharedState& State() {
  static SharedState state;
  return state;
}

void AttachContext(app::RuntimeContext& ctx) {
  State().ctx = &ctx;
}

primitive::Sink& PrimitiveLayer() {
  static ESP8266PrimitiveSink sink;
  return sink;
}

void PrimitiveFillScreen(uint16_t color) {
  PrimitiveLayer().FillScreen(color);
}

void PrimitiveFillRect(int x, int y, int w, int h, uint16_t color) {
  primitive::RectCommand cmd;
  cmd.x = x;
  cmd.y = y;
  cmd.width = w;
  cmd.height = h;
  cmd.color = color;
  PrimitiveLayer().FillRect(cmd);
}

void PrimitiveDrawText(
    const char* text,
    int x,
    int y,
    int font,
    int size,
    uint16_t fg,
    uint16_t bg,
    bool wrap) {
  primitive::TextCommand cmd;
  cmd.text = text;
  cmd.x = x;
  cmd.y = y;
  cmd.font = font;
  cmd.size = size;
  cmd.fg = fg;
  cmd.bg = bg;
  cmd.wrap = wrap;
  PrimitiveLayer().DrawText(cmd);
}

void PrimitiveDrawProgress(int x, int y, int w, int h, int pct, uint16_t fillColor) {
  primitive::ProgressCommand cmd;
  cmd.x = x;
  cmd.y = y;
  cmd.width = w;
  cmd.height = h;
  cmd.percent = pct;
  cmd.fillColor = fillColor;
  cmd.borderColor = TFT_DARKGREY;
  cmd.bgColor = TFT_BLACK;
  PrimitiveLayer().DrawProgress(cmd);
}

void DrawBar(int x, int y, int w, int h, int pct, uint16_t fillColor) {
  PrimitiveDrawProgress(x, y, w, h, pct, fillColor);
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
