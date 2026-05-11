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
  void FillScreen(uint16_t color) override {
    PrimitiveFillScreen(color);
  }

  void FillRect(const themespec::RectCommand& cmd) override {
    PrimitiveFillRect(cmd.x, cmd.y, cmd.width, cmd.height, cmd.color);
  }

  void DrawText(const themespec::TextCommand& cmd) override {
    PrimitiveDrawText(cmd.text, cmd.x, cmd.y, cmd.font, cmd.size, cmd.fg, cmd.bg, cmd.wrap);
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

  ThemeSpecSink sink;
  if (!themespec::RenderThemeSpec(CurrentFrame().themeSpecRaw.c_str(), currentThemeSpecFrameData(), sink)) {
    return false;
  }

  StopMiniGifPlayback();
  const int64_t remain = CurrentRemainingSecs();
  LastRenderedSecs() = remain;
  LastRenderedMinuteBucket() = remain / 60;
  return true;
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

}  // namespace display
}  // namespace esp8266
}  // namespace codexbar_display

#endif

#endif
