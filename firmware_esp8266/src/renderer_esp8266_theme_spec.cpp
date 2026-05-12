#include "renderer_esp8266_display_state.h"

#ifndef CODEXBAR_DISPLAY_PROBE_ONLY

#ifndef CODEXBAR_DISPLAY_THEME_SPEC_RENDERER
#define CODEXBAR_DISPLAY_THEME_SPEC_RENDERER 0
#endif

#if CODEXBAR_DISPLAY_THEME_SPEC_RENDERER

#include "../../firmware_shared/theme_spec_renderer_core.h"

namespace codexbar_display {
namespace esp8266 {
namespace display {

namespace {

class ThemeSpecSink final : public themespec::Sink {
 public:
  explicit ThemeSpecSink(bool forceGifFrame) : forceGifFrame_(forceGifFrame) {}

  void FillScreen(uint16_t color) override {
    backgroundColor_ = color;
    hasBackgroundColor_ = true;
    PrimitiveFillScreen(color);
  }

  void FillRect(const themespec::RectCommand& cmd) override {
    PrimitiveFillRect(cmd.x, cmd.y, cmd.width, cmd.height, cmd.color);
  }

  void DrawText(const themespec::TextCommand& cmd) override {
    primitive::TextCommand text;
    text.text = cmd.text;
    text.x = cmd.x;
    text.y = cmd.y;
    text.font = cmd.font;
    text.size = cmd.size;
    text.fg = cmd.fg;
    text.bg = cmd.bg;
    text.hasBg = cmd.hasBg;
    text.wrap = cmd.wrap;
    PrimitiveLayer().DrawText(text);
  }

  void DrawProgress(const themespec::ProgressCommand& cmd) override {
    primitive::ProgressCommand progress;
    progress.x = cmd.x;
    progress.y = cmd.y;
    progress.width = cmd.width;
    progress.height = cmd.height;
    progress.percent = cmd.percent;
    progress.fillColor = cmd.fillColor;
    progress.borderColor = cmd.borderColor;
    progress.bgColor = cmd.bgColor;
    PrimitiveLayer().DrawProgress(progress);
  }

  void DrawGif(const themespec::GifCommand& cmd) override {
    GifPlaybackRequest request;
    request.assetPath = cmd.assetPath;
    request.layoutMode = GifLayoutMode::Explicit;
    request.failureSlot = GifFailureSlot::Reserved1;
    request.x = cmd.x;
    request.y = cmd.y;
    request.width = cmd.width;
    request.height = cmd.height;
    request.hasBackgroundColor = hasBackgroundColor_;
    request.backgroundColor = backgroundColor_;
    (void)GifCore().Tick(Tft(), request, forceGifFrame_);
  }

  void DrawPixels(const themespec::PixelsCommand& cmd) override {
    for (int row = 0; row < cmd.height; ++row) {
      int runStart = -1;
      for (int col = 0; col <= cmd.width; ++col) {
        const int bitIndex = row * cmd.width + col;
        const bool on = col < cmd.width && themespec::BitmapBitSet(cmd.data, bitIndex);
        if (on && runStart < 0) {
          runStart = col;
        } else if (!on && runStart >= 0) {
          PrimitiveFillRect(cmd.x + runStart, cmd.y + row, col - runStart, 1, cmd.color);
          runStart = -1;
        }
      }
    }
  }

 private:
  bool forceGifFrame_ = false;
  bool hasBackgroundColor_ = false;
  uint16_t backgroundColor_ = 0x0000;
};

const char* usageModeText() {
  if (CurrentFrame().hasUsageMode && CurrentFrame().usageMode == "remaining") {
    return "remaining";
  }
  return "used";
}

themespec::FrameData currentThemeSpecFrameData() {
  themespec::FrameData frame;
  frame.provider = CurrentFrame().provider.c_str();
  frame.label = ProviderLabelText();
  frame.session = CurrentFrame().session;
  frame.weekly = CurrentFrame().weekly;
  frame.resetSecs = CurrentRemainingSecs();
  frame.usageMode = usageModeText();
  frame.sessionTokens = CurrentFrame().sessionTokens;
  frame.weekTokens = CurrentFrame().weekTokens;
  frame.totalTokens = CurrentFrame().totalTokens;
  return frame;
}

}  // namespace

bool DrawThemeSpecUsage() {
  if (!CurrentFrame().hasThemeSpec || CurrentFrame().themeSpecRaw.length() == 0) {
    return false;
  }

  ThemeSpecSink sink(true);
  if (!themespec::RenderThemeSpec(CurrentFrame().themeSpecRaw.c_str(), currentThemeSpecFrameData(), sink)) {
    return false;
  }

  const int64_t remain = CurrentRemainingSecs();
  LastRenderedSecs() = remain;
  LastRenderedMinuteBucket() = remain / 60;
  return true;
}

bool TickThemeSpecGifs() {
  if (!CurrentFrame().hasThemeSpec || CurrentFrame().themeSpecRaw.length() == 0) {
    return false;
  }

  ThemeSpecSink sink(false);
  return themespec::RenderThemeSpecAnimatedPrimitives(CurrentFrame().themeSpecRaw.c_str(), currentThemeSpecFrameData(), sink);
}

}  // namespace display
}  // namespace esp8266
}  // namespace codexbar_display

#else

namespace codexbar_display {
namespace esp8266 {
namespace display {

bool DrawThemeSpecUsage() {
  return false;
}

bool TickThemeSpecGifs() {
  return false;
}

}  // namespace display
}  // namespace esp8266
}  // namespace codexbar_display

#endif

#endif
