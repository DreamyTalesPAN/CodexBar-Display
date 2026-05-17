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

constexpr unsigned long kThemeSpecAnimatedTickMs = 125UL;
unsigned long nextThemeSpecAnimatedTickAtMs = 0;
bool lastThemeSpecRenderOk = true;
const char* lastThemeSpecRenderError = "";
unsigned long themeSpecRenderFailures = 0;

void markThemeSpecRenderOk() {
  lastThemeSpecRenderOk = true;
  lastThemeSpecRenderError = "";
}

void markThemeSpecRenderFailed(const char* error) {
  lastThemeSpecRenderOk = false;
  lastThemeSpecRenderError = error == nullptr ? "render_failed" : error;
  themeSpecRenderFailures += 1;
}

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

bool parseAnimatedSpriteHeader(const String& line, int& width, int& height, int& frameCount, int& fps) {
  width = 0;
  height = 0;
  frameCount = 0;
  fps = 0;
  return std::sscanf(line.c_str(), "%d %d %d %d", &width, &height, &frameCount, &fps) == 4 &&
         width > 0 &&
         height > 0 &&
         frameCount > 0 &&
         frameCount <= 64 &&
         fps >= 0 &&
         fps <= 30;
}

bool parseSpritePaletteSize(const String& line, int& paletteSize) {
  paletteSize = line.toInt();
  return paletteSize > 0 && paletteSize <= 26;
}

bool drawSpriteRleRow(
    const String& row,
    const uint16_t* palette,
    int paletteSize,
    int x,
    int y,
    int sourceWidth,
    int sourceRow,
    int sourceHeight,
    int targetWidth,
    int targetHeight,
    bool drawTransparentRuns,
    uint16_t transparentColor) {
  int offset = 0;
  const int drawWidth = targetWidth > 0 ? targetWidth : sourceWidth;
  const int drawHeight = targetHeight > 0 ? targetHeight : sourceHeight;
  const int drawY1 = y + ((sourceRow * drawHeight) / sourceHeight);
  const int drawY2 = y + (((sourceRow + 1) * drawHeight + sourceHeight - 1) / sourceHeight);
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
    if (runLength <= 0 || i >= row.length() || offset + runLength > sourceWidth) {
      return false;
    }

    const char token = row[i++];
    const int drawX1 = x + ((offset * drawWidth) / sourceWidth);
    const int drawX2 = x + (((offset + runLength) * drawWidth + sourceWidth - 1) / sourceWidth);
    if (token == '.') {
      if (drawTransparentRuns) {
        PrimitiveFillRect(drawX1, drawY1, max(1, drawX2 - drawX1), max(1, drawY2 - drawY1), transparentColor);
      }
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
    PrimitiveFillRect(drawX1, drawY1, max(1, drawX2 - drawX1), max(1, drawY2 - drawY1), palette[colorIndex]);
    offset += runLength;
  }
  return offset == sourceWidth;
}

bool readSpritePalette(File& file, uint16_t* palette, int& paletteSize) {
  String line;
  if (!readSpriteLine(file, line) || !parseSpritePaletteSize(line, paletteSize)) {
    return false;
  }
  for (int i = 0; i < paletteSize; ++i) {
    if (!readSpriteLine(file, line) || !themespec::IsHexColor(line.c_str())) {
      return false;
    }
    palette[i] = themespec::ParseColor(line.c_str(), 0x0000);
  }
  return true;
}

int spriteFrameIndex(int frameCount, int fps) {
  if (frameCount <= 1 || fps <= 0) {
    return 0;
  }
  const unsigned long frameMs = static_cast<unsigned long>(1000 / fps);
  if (frameMs == 0) {
    return 0;
  }
  return static_cast<int>((millis() / frameMs) % static_cast<unsigned long>(frameCount));
}

bool skipSpriteRows(File& file, int rowCount) {
  String line;
  for (int row = 0; row < rowCount; ++row) {
    if (!readSpriteLine(file, line)) {
      return false;
    }
  }
  return true;
}

void drawStaticSpriteAsset(File& file, int x, int y, int targetWidth, int targetHeight, bool hasClearColor, uint16_t clearColor) {
  String line;
  int width = 0;
  int height = 0;
  if (!readSpriteLine(file, line) || !parseSpriteHeader(line, width, height)) {
    return;
  }

  uint16_t palette[26] = {0};
  int paletteSize = 0;
  if (!readSpritePalette(file, palette, paletteSize)) {
    return;
  }

  for (int row = 0; row < height; ++row) {
    if (!readSpriteLine(file, line) ||
        !drawSpriteRleRow(line, palette, paletteSize, x, y, width, row, height, targetWidth, targetHeight, hasClearColor, clearColor)) {
      return;
    }
    if ((row & 0x07) == 0x07) {
      yield();
    }
  }
}

void drawAnimatedSpriteAsset(File& file, int x, int y, int targetWidth, int targetHeight, bool hasClearColor, uint16_t clearColor) {
  String line;
  int width = 0;
  int height = 0;
  int frameCount = 0;
  int fps = 0;
  if (!readSpriteLine(file, line) || !parseAnimatedSpriteHeader(line, width, height, frameCount, fps)) {
    return;
  }

  uint16_t palette[26] = {0};
  int paletteSize = 0;
  if (!readSpritePalette(file, palette, paletteSize)) {
    return;
  }

  const int selectedFrame = spriteFrameIndex(frameCount, fps);
  if (!skipSpriteRows(file, selectedFrame * height)) {
    return;
  }

  for (int row = 0; row < height; ++row) {
    if (!readSpriteLine(file, line) ||
        !drawSpriteRleRow(line, palette, paletteSize, x, y, width, row, height, targetWidth, targetHeight, hasClearColor, clearColor)) {
      return;
    }
    if ((row & 0x07) == 0x07) {
      yield();
    }
  }
}

void drawSpriteAsset(const char* assetPath, int x, int y, int targetWidth, int targetHeight, bool animatedOnly, bool hasClearColor, uint16_t clearColor) {
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
  if (readSpriteLine(file, line)) {
    if (line == "CBI1") {
      if (!animatedOnly) {
        drawStaticSpriteAsset(file, x, y, targetWidth, targetHeight, hasClearColor, clearColor);
      }
    } else if (line == "CBA1") {
      drawAnimatedSpriteAsset(file, x, y, targetWidth, targetHeight, hasClearColor, clearColor);
    }
  }

  file.close();
}

class ThemeSpecSink final : public themespec::Sink {
 public:
  explicit ThemeSpecSink(bool forceGifFrame) : forceGifFrame_(forceGifFrame) {}

  void PrimeBackground(uint16_t color) override {
    backgroundColor_ = color;
    hasBackgroundColor_ = true;
  }

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
    request.hasBackgroundColor = cmd.hasBg || hasBackgroundColor_;
    request.backgroundColor = cmd.hasBg ? cmd.bg : backgroundColor_;
    (void)GifCore().Tick(Tft(), request, forceGifFrame_);
  }

  void DrawSprite(const themespec::SpriteCommand& cmd) override {
    drawSpriteAsset(
        cmd.assetPath,
        cmd.x,
        cmd.y,
        cmd.width,
        cmd.height,
        !forceGifFrame_,
        !forceGifFrame_ && (cmd.hasBg || hasBackgroundColor_),
        cmd.hasBg ? cmd.bg : backgroundColor_);
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
  frame.activity = CurrentFrame().activity.c_str();
  frame.time = CurrentFrame().timeText.c_str();
  frame.date = CurrentFrame().dateText.c_str();
  frame.sessionTokens = CurrentFrame().sessionTokens;
  frame.weekTokens = CurrentFrame().weekTokens;
  frame.totalTokens = CurrentFrame().totalTokens;
  return frame;
}

}  // namespace

bool DrawThemeSpecUsage() {
  if (!CurrentFrame().hasThemeSpec) {
    return false;
  }
  if (CurrentFrame().themeSpecRaw.length() == 0) {
    markThemeSpecRenderFailed("missing_theme_spec");
    return false;
  }

  ThemeSpecSink sink(true);
  if (!themespec::RenderThemeSpec(CurrentFrame().themeSpecRaw.c_str(), currentThemeSpecFrameData(), sink)) {
    markThemeSpecRenderFailed("full_render_failed");
    return false;
  }

  markThemeSpecRenderOk();
  nextThemeSpecAnimatedTickAtMs = millis() + kThemeSpecAnimatedTickMs;
  const int64_t remain = CurrentRemainingSecs();
  LastRenderedSecs() = remain;
  LastRenderedMinuteBucket() = remain / 60;
  return true;
}

bool TickThemeSpecGifs() {
  if (!CurrentFrame().hasThemeSpec || CurrentFrame().themeSpecRaw.length() == 0) {
    return false;
  }
  const unsigned long now = millis();
  if (nextThemeSpecAnimatedTickAtMs == 0) {
    return true;
  }
  if (static_cast<long>(now - nextThemeSpecAnimatedTickAtMs) < 0) {
    return true;
  }
  nextThemeSpecAnimatedTickAtMs = now + kThemeSpecAnimatedTickMs;

  ThemeSpecSink sink(false);
  const bool ok = themespec::RenderThemeSpecAnimatedPrimitives(CurrentFrame().themeSpecRaw.c_str(), currentThemeSpecFrameData(), sink);
  if (!ok) {
    markThemeSpecRenderFailed("animated_render_failed");
  }
  return ok;
}

bool ThemeSpecRenderOk() {
  return lastThemeSpecRenderOk;
}

const char* ThemeSpecRenderError() {
  return lastThemeSpecRenderError;
}

unsigned long ThemeSpecRenderFailures() {
  return themeSpecRenderFailures;
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

bool ThemeSpecRenderOk() {
  return true;
}

const char* ThemeSpecRenderError() {
  return "";
}

unsigned long ThemeSpecRenderFailures() {
  return 0;
}

}  // namespace display
}  // namespace esp8266
}  // namespace codexbar_display

#endif

#endif
