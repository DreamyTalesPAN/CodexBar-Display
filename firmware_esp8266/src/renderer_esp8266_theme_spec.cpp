#include "renderer_esp8266_display_state.h"

#ifndef CODEXBAR_DISPLAY_PROBE_ONLY

#ifndef CODEXBAR_DISPLAY_THEME_SPEC_RENDERER
#define CODEXBAR_DISPLAY_THEME_SPEC_RENDERER 0
#endif

#if CODEXBAR_DISPLAY_THEME_SPEC_RENDERER

#include <LittleFS.h>

#include <cstdio>

#include "../../firmware_shared/theme_spec_renderer_core.h"

namespace codexbar_display {
namespace esp8266 {
namespace display {

namespace {

bool readSpriteLine(File& file, String& line) {
  if (!file.available()) {
    return false;
  }
  line = file.readStringUntil('\n');
  line.trim();
  return true;
}

bool parseSpriteHeader(const String& line, int& width, int& height) {
  width = 0;
  height = 0;
  return std::sscanf(line.c_str(), "%d %d", &width, &height) == 2 && width > 0 && height > 0;
}

bool parseSpritePaletteSize(const String& line, int& paletteSize) {
  paletteSize = line.toInt();
  return paletteSize > 0 && paletteSize <= 26;
}

bool drawSpriteRleRow(const String& row, const uint16_t* palette, int paletteSize, int x, int y, int width) {
  int offset = 0;
  for (size_t i = 0; i < row.length();) {
    int runLength = 0;
    bool hasRunLength = false;
    while (i < row.length() && row[i] >= '0' && row[i] <= '9') {
      hasRunLength = true;
      runLength = (runLength * 10) + (row[i] - '0');
      ++i;
    }
    if (!hasRunLength) {
      runLength = 1;
    }
    if (runLength <= 0 || i >= row.length() || offset + runLength > width) {
      return false;
    }

    const char token = row[i++];
    if (token == '.') {
      offset += runLength;
      continue;
    }
    if (token < 'a' || token > 'z') {
      return false;
    }
    const int colorIndex = token - 'a';
    if (colorIndex >= paletteSize) {
      return false;
    }
    PrimitiveFillRect(x + offset, y, runLength, 1, palette[colorIndex]);
    offset += runLength;
  }
  return offset == width;
}

void drawSpriteAsset(const char* assetPath, int x, int y) {
  if (assetPath == nullptr || assetPath[0] == '\0') {
    return;
  }
  if (!LittleFS.begin()) {
    return;
  }
  File file = LittleFS.open(assetPath, "r");
  if (!file) {
    return;
  }

  String line;
  if (!readSpriteLine(file, line) || line != "CBI1") {
    file.close();
    return;
  }

  int width = 0;
  int height = 0;
  if (!readSpriteLine(file, line) || !parseSpriteHeader(line, width, height)) {
    file.close();
    return;
  }

  int paletteSize = 0;
  if (!readSpriteLine(file, line) || !parseSpritePaletteSize(line, paletteSize)) {
    file.close();
    return;
  }

  uint16_t palette[26] = {0};
  for (int i = 0; i < paletteSize; ++i) {
    if (!readSpriteLine(file, line) || !themespec::IsHexColor(line.c_str())) {
      file.close();
      return;
    }
    palette[i] = themespec::ParseColor(line.c_str(), 0x0000);
  }

  for (int row = 0; row < height; ++row) {
    if (!readSpriteLine(file, line) || !drawSpriteRleRow(line, palette, paletteSize, x, y + row, width)) {
      file.close();
      return;
    }
  }

  file.close();
}

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

  void DrawSprite(const themespec::SpriteCommand& cmd) override {
    drawSpriteAsset(cmd.assetPath, cmd.x, cmd.y);
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
  frame.time = CurrentFrame().timeText.c_str();
  frame.date = CurrentFrame().dateText.c_str();
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
