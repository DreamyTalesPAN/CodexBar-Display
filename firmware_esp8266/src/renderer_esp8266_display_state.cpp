#include "renderer_esp8266_display_state.h"

#ifndef CODEXBAR_DISPLAY_PROBE_ONLY

#include <cstring>

namespace codexbar_display {
namespace esp8266 {
namespace display {

namespace {

int ClampDrawRadius(int radius, int width, int height) {
  return max(0, min(radius, min(width, height) / 2));
}

// How many pixels the corner of a rounded rect of radius r takes off a row that
// lies `row` pixels from its top or bottom edge (0 from the middle rows on).
int RoundedCornerInset(int radius, int rowFromEdge) {
  if (radius <= 0 || rowFromEdge >= radius) {
    return 0;
  }
  // The row's centre lies (radius - rowFromEdge - 1/2) px from the circle's centre.
  const int dy2 = 2 * (radius - rowFromEdge) - 1;
  int dx = 0;
  while (4 * (dx + 1) * (dx + 1) + dy2 * dy2 <= 4 * radius * radius) {
    ++dx;
  }
  return radius - dx;
}

// The reserve or deficit piece of a pace bar: solid, or hatched with diagonal
// stripes two pixels wide every four, as the Control Center draws it. Where it
// reaches an end of the bar's rounded interior (leftRadius / rightRadius > 0) its
// corners follow that rounding instead of covering it.
void FillPacePiece(TFT_eSPI& tft, int x, int y, int w, int h, const primitive::ProgressCommand& cmd,
                   int leftRadius = 0, int rightRadius = 0) {
  if (w <= 0 || h <= 0) {
    return;
  }
  if (leftRadius <= 0 && rightRadius <= 0) {
    if (!cmd.hatched) {
      tft.fillRect(x, y, w, h, cmd.pieceColor);
      return;
    }
    tft.fillRect(x, y, w, h, cmd.hatchGapColor);
  }
  for (int row = 0; row < h; ++row) {
    const int edge = min(row, h - 1 - row);
    const int from = x + RoundedCornerInset(leftRadius, edge);
    const int to = x + w - RoundedCornerInset(rightRadius, edge);
    if (to <= from) {
      continue;
    }
    if (!cmd.hatched) {
      if (leftRadius > 0 || rightRadius > 0) {
        tft.fillRect(from, y + row, to - from, 1, cmd.pieceColor);
      }
      continue;
    }
    if (leftRadius > 0 || rightRadius > 0) {
      tft.fillRect(from, y + row, to - from, 1, cmd.hatchGapColor);
    }
    int stripe = from - 3;
    stripe += (4 - ((stripe + y + row) & 3)) & 3;
    for (; stripe < to; stripe += 4) {
      const int a = max(stripe, from);
      const int b = min(stripe + 2, to);
      if (b > a) {
        tft.fillRect(a, y + row, b - a, 1, cmd.pieceColor);
      }
    }
  }
}

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
    const int radius = ClampDrawRadius(cmd.borderRadius, cmd.width, cmd.height);
    if (radius > 0) {
      Tft().fillRoundRect(cmd.x, cmd.y, cmd.width, cmd.height, radius, cmd.color);
    } else {
      Tft().fillRect(cmd.x, cmd.y, cmd.width, cmd.height, cmd.color);
    }
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
    const int radius = ClampDrawRadius(cmd.borderRadius, cmd.width, cmd.height);
    const int innerW = max(0, cmd.width - 2);
    const int innerH = max(0, cmd.height - 2);
    const int innerRadius = ClampDrawRadius(max(0, radius - 1), innerW, innerH);
    if (radius > 0) {
      tft.drawRoundRect(cmd.x, cmd.y, cmd.width, cmd.height, radius, cmd.borderColor);
    } else {
      tft.drawRect(cmd.x, cmd.y, cmd.width, cmd.height, cmd.borderColor);
    }
    if (innerW > 0 && innerH > 0) {
      if (innerRadius > 0) {
        tft.fillRoundRect(cmd.x + 1, cmd.y + 1, innerW, innerH, innerRadius, cmd.bgColor);
      } else {
        tft.fillRect(cmd.x + 1, cmd.y + 1, innerW, innerH, cmd.bgColor);
      }
    }
    // A pace bar fills up to the larger of use and plan and lays the piece over
    // the part past `percent`; without a pace pieceTo is not past percent.
    const int pieceP = max(p, codexbar_display::core::ClampPct(cmd.pieceTo));
    if (cmd.style == 1) {
      const int segments = cmd.segments > 0 ? cmd.segments : 10;
      const int gap = cmd.segmentGap < 0 ? 0 : cmd.segmentGap;
      const int filledSegments = (segments * p + 99) / 100;
      const int pieceSegments = (segments * pieceP + 99) / 100;
      for (int i = 0; i < segments; ++i) {
        const int segX1 = cmd.x + 1 + ((i * innerW) / segments);
        const int segX2 = cmd.x + 1 + (((i + 1) * innerW) / segments);
        const int segW = max(0, segX2 - segX1 - gap);
        if (segW > 0 && i < filledSegments) {
          const int segmentRadius = ClampDrawRadius(innerRadius, segW, innerH);
          if (segmentRadius > 0) {
            tft.fillRoundRect(segX1, cmd.y + 1, segW, innerH, segmentRadius, cmd.fillColor);
          } else {
            tft.fillRect(segX1, cmd.y + 1, segW, innerH, cmd.fillColor);
          }
        } else if (segW > 0 && i < pieceSegments) {
          const int pieceRadius = ClampDrawRadius(innerRadius, segW, innerH);
          FillPacePiece(tft, segX1, cmd.y + 1, segW, innerH, cmd, pieceRadius, pieceRadius);
        }
      }
    } else {
      const int filled = min(innerW, max(0, (innerW * pieceP) / 100));
      if (filled > 0) {
        const int fillRadius = ClampDrawRadius(innerRadius, filled, innerH);
        if (fillRadius > 0) {
          tft.fillRoundRect(cmd.x + 1, cmd.y + 1, filled, innerH, fillRadius, cmd.fillColor);
        } else {
          tft.fillRect(cmd.x + 1, cmd.y + 1, filled, innerH, cmd.fillColor);
        }
      }
      const int pieceFrom = min(innerW, max(0, (innerW * p) / 100));
      FillPacePiece(tft, cmd.x + 1 + pieceFrom, cmd.y + 1, filled - pieceFrom, innerH, cmd,
                    pieceFrom == 0 ? ClampDrawRadius(innerRadius, filled, innerH) : 0,
                    filled == innerW ? ClampDrawRadius(innerRadius, filled, innerH) : 0);
    }
    if (cmd.planAt >= 0) {
      // The plan tick, 2 px wide, reaching past the bar like the ring's.
      const int tickX = cmd.x + 1 + (innerW * min(cmd.planAt, 100)) / 100 - 1;
      const int overhang = codexbar_display::usage_window_contract::kPaceTickOverhang;
      const int tickY = max(0, cmd.y - overhang);
      tft.fillRect(max(cmd.x, tickX), tickY, 2, cmd.y + cmd.height + overhang - tickY, 0xFFFF);
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
