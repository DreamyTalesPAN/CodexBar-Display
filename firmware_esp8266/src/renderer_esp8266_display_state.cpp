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
    DisplayTransaction transaction;
    Tft().fillScreen(color);
  }

  void FillRect(const primitive::RectCommand& cmd) override {
    if (cmd.width <= 0 || cmd.height <= 0) {
      return;
    }
    DisplayTransaction transaction;
    Tft().fillRect(cmd.x, cmd.y, cmd.width, cmd.height, cmd.color);
  }

  void DrawText(const primitive::TextCommand& cmd) override {
    DisplayTransaction transaction;
    TFT_eSPI& tft = Tft();
    tft.setTextWrap(cmd.wrap);
    tft.setTextFont(cmd.font);
    tft.setTextSize(cmd.size);
    if (cmd.hasBg) {
      tft.setTextColor(cmd.fg, cmd.bg);
    } else {
      tft.setTextColor(cmd.fg);
    }
    tft.setCursor(cmd.x, cmd.y);
    tft.print(cmd.text == nullptr ? "" : cmd.text);
    tft.setTextWrap(false);
  }

  void DrawProgress(const primitive::ProgressCommand& cmd) override {
    const int p = codexbar_display::core::ClampPct(cmd.percent);

    DisplayTransaction transaction;
    TFT_eSPI& tft = Tft();
    tft.drawRect(cmd.x, cmd.y, cmd.width, cmd.height, cmd.borderColor);
    tft.fillRect(cmd.x + 1, cmd.y + 1, cmd.width - 2, cmd.height - 2, cmd.bgColor);
    if (cmd.style == 1) {
      const int segments = cmd.segments > 0 ? cmd.segments : 10;
      const int gap = cmd.segmentGap < 0 ? 0 : cmd.segmentGap;
      const int innerW = cmd.width - 2;
      const int innerH = cmd.height - 2;
      const int filledSegments = (segments * p + 99) / 100;
      for (int i = 0; i < segments; ++i) {
        const int segX1 = cmd.x + 1 + ((i * innerW) / segments);
        const int segX2 = cmd.x + 1 + (((i + 1) * innerW) / segments);
        const int segW = max(0, segX2 - segX1 - gap);
        if (segW > 0 && i < filledSegments) {
          tft.fillRect(segX1, cmd.y + 1, segW, innerH, cmd.fillColor);
        }
      }
      return;
    }

    int filled = (cmd.width * p) / 100;
    if (filled > (cmd.width - 2)) {
      filled = cmd.width - 2;
    }
    if (filled < 0) {
      filled = 0;
    }
    if (filled > 0) {
      tft.fillRect(cmd.x + 1, cmd.y + 1, filled, cmd.height - 2, cmd.fillColor);
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

bool BeginDisplayTransaction() {
  SharedState& state = State();
  if (state.displayTransactionDepth == UINT16_MAX) {
    return false;
  }
  if (state.displayTransactionDepth == 0) {
    Tft().startWrite();
  }
  ++state.displayTransactionDepth;
  return true;
}

void EndDisplayTransaction() {
  SharedState& state = State();
  if (state.displayTransactionDepth == 0) {
    return;
  }
  --state.displayTransactionDepth;
  if (state.displayTransactionDepth == 0) {
    Tft().endWrite();
  }
}

DisplayTransaction::DisplayTransaction() : active_(BeginDisplayTransaction()) {}

DisplayTransaction::~DisplayTransaction() {
  if (active_) {
    EndDisplayTransaction();
  }
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

void SetTextSize(int size) {
  Tft().setTextFont(1);
  Tft().setTextSize(size);
}

const char* ProviderLabelText() {
  if (Context().topLineOverride.length()) {
    return Context().topLineOverride.c_str();
  }
  if (CurrentFrame().label.length()) {
    return CurrentFrame().label.c_str();
  }
  return "Provider";
}

}  // namespace display
}  // namespace esp8266
}  // namespace codexbar_display

#endif
