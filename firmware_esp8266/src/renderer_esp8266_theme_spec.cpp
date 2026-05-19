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
constexpr int kAnimatedSpriteCacheSlots = 2;
unsigned long nextThemeSpecAnimatedTickAtMs = 0;
bool lastThemeSpecRenderOk = true;
const char* lastThemeSpecRenderError = "";
unsigned long themeSpecRenderFailures = 0;
String lastSuccessfulThemeSpecId = "";
int lastSuccessfulThemeSpecRev = 0;
uint32_t lastSuccessfulThemeSpecRawHash = 0;
JsonDocument cachedThemeSpecDoc;
uint32_t cachedThemeSpecDocHash = 0;
themespec::CompiledThemeSpec cachedThemeSpecScene;

struct AnimatedSpriteCache {
  bool valid = false;
  String path;
  int width = 0;
  int height = 0;
  int frameCount = 0;
  int fps = 0;
  uint16_t palette[26] = {0};
  int paletteSize = 0;
  uint32_t frameOffsets[64] = {0};
  int frameIndex = 0;
  unsigned long nextFrameAtMs = 0;
};

AnimatedSpriteCache animatedSpriteCaches[kAnimatedSpriteCacheSlots];
int nextAnimatedSpriteCacheSlot = 0;

void markThemeSpecRenderOk() {
  lastThemeSpecRenderOk = true;
  lastThemeSpecRenderError = "";
}

void markThemeSpecRenderFailed(const char* error) {
  lastThemeSpecRenderOk = false;
  lastThemeSpecRenderError = error == nullptr ? "render_failed" : error;
  themeSpecRenderFailures += 1;
}

uint32_t themeSpecRawHash(const String& raw) {
  uint32_t hash = 2166136261UL;
  for (size_t i = 0; i < raw.length(); ++i) {
    hash ^= static_cast<uint8_t>(raw[i]);
    hash *= 16777619UL;
  }
  return hash == 0 ? 1 : hash;
}

const String& currentThemeSpecRaw();

void markCurrentThemeSpecRendered() {
  markThemeSpecRenderOk();
  lastSuccessfulThemeSpecId = CurrentFrame().themeSpecId;
  lastSuccessfulThemeSpecRev = CurrentFrame().themeSpecRev;
  lastSuccessfulThemeSpecRawHash = themeSpecRawHash(currentThemeSpecRaw());
}

bool currentThemeSpecRenderedSuccessfully() {
  return CurrentFrame().hasThemeSpec &&
         lastSuccessfulThemeSpecRev == CurrentFrame().themeSpecRev &&
         lastSuccessfulThemeSpecId == CurrentFrame().themeSpecId &&
         lastSuccessfulThemeSpecRawHash != 0 &&
         lastSuccessfulThemeSpecRawHash == themeSpecRawHash(currentThemeSpecRaw());
}

const String& currentThemeSpecRaw() {
  return codexbar_display::core::ThemeSpecRawForFrame(RuntimeState(), CurrentFrame());
}

bool ensureThemeSpecSceneCached(const String& raw) {
  const uint32_t rawHash = themeSpecRawHash(raw);
  if (cachedThemeSpecDocHash == rawHash && cachedThemeSpecScene.primitiveCount > 0) {
    return true;
  }
  cachedThemeSpecDoc.clear();
  const DeserializationError err = deserializeJson(cachedThemeSpecDoc, raw.c_str());
  if (err) {
    cachedThemeSpecDocHash = 0;
    return false;
  }
  themespec::CompiledThemeSpec nextScene;
  if (!themespec::CompileThemeSpecObject(cachedThemeSpecDoc.as<JsonObjectConst>(), nextScene)) {
    cachedThemeSpecDocHash = 0;
    cachedThemeSpecDoc.clear();
    return false;
  }
  themespec::MoveCompiledThemeSpec(cachedThemeSpecScene, nextScene);
  if (!cachedThemeSpecScene.requiresJsonDocument) {
    cachedThemeSpecDoc.clear();
  }
  cachedThemeSpecDocHash = rawHash;
  return true;
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

int cachedSpriteFrameIndex(AnimatedSpriteCache& cache, bool forceFrame, bool& shouldDraw) {
  shouldDraw = forceFrame;
  if (cache.frameCount <= 1 || cache.fps <= 0) {
    cache.frameIndex = 0;
    cache.nextFrameAtMs = 0;
    return 0;
  }

  const unsigned long now = millis();
  const unsigned long frameMs = max(1UL, static_cast<unsigned long>(1000 / cache.fps));
  if (cache.nextFrameAtMs == 0) {
    cache.nextFrameAtMs = now + frameMs;
    return cache.frameIndex;
  }

  if (static_cast<long>(now - cache.nextFrameAtMs) >= 0) {
    cache.frameIndex = (cache.frameIndex + 1) % cache.frameCount;
    cache.nextFrameAtMs = now + frameMs;
    shouldDraw = true;
  }
  return cache.frameIndex;
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

AnimatedSpriteCache* animatedSpriteCacheForPath(const char* assetPath) {
  if (assetPath == nullptr || assetPath[0] == '\0') {
    return nullptr;
  }
  for (int i = 0; i < kAnimatedSpriteCacheSlots; ++i) {
    if (animatedSpriteCaches[i].valid && animatedSpriteCaches[i].path == assetPath) {
      return &animatedSpriteCaches[i];
    }
  }

  AnimatedSpriteCache* slot = nullptr;
  for (int i = 0; i < kAnimatedSpriteCacheSlots; ++i) {
    if (!animatedSpriteCaches[i].valid) {
      slot = &animatedSpriteCaches[i];
      break;
    }
  }
  if (slot == nullptr) {
    slot = &animatedSpriteCaches[nextAnimatedSpriteCacheSlot];
    nextAnimatedSpriteCacheSlot = (nextAnimatedSpriteCacheSlot + 1) % kAnimatedSpriteCacheSlots;
  }

  *slot = AnimatedSpriteCache{};
  slot->path = assetPath;
  return slot;
}

bool loadAnimatedSpriteCache(File& file, AnimatedSpriteCache& cache) {
  String line;
  int width = 0;
  int height = 0;
  int frameCount = 0;
  int fps = 0;
  if (!readSpriteLine(file, line) || !parseAnimatedSpriteHeader(line, width, height, frameCount, fps)) {
    cache.valid = false;
    return false;
  }

  uint16_t palette[26] = {0};
  int paletteSize = 0;
  if (!readSpritePalette(file, palette, paletteSize)) {
    cache.valid = false;
    return false;
  }

  cache.width = width;
  cache.height = height;
  cache.frameCount = frameCount;
  cache.fps = fps;
  cache.paletteSize = paletteSize;
  for (int i = 0; i < paletteSize; ++i) {
    cache.palette[i] = palette[i];
  }
  cache.frameIndex = 0;
  cache.nextFrameAtMs = 0;

  for (int frame = 0; frame < frameCount; ++frame) {
    cache.frameOffsets[frame] = static_cast<uint32_t>(file.position());
    if (!skipSpriteRows(file, height)) {
      cache.valid = false;
      return false;
    }
    if ((frame & 0x03) == 0x03) {
      yield();
    }
  }

  cache.valid = true;
  return true;
}

void drawAnimatedSpriteAsset(
    const char* assetPath,
    File& file,
    int x,
    int y,
    int targetWidth,
    int targetHeight,
    bool forceFrame,
    bool hasClearColor,
    uint16_t clearColor) {
  AnimatedSpriteCache* cache = animatedSpriteCacheForPath(assetPath);
  if (cache == nullptr) {
    return;
  }
  if (!cache->valid && !loadAnimatedSpriteCache(file, *cache)) {
    return;
  }

  bool shouldDraw = false;
  const int selectedFrame = cachedSpriteFrameIndex(*cache, forceFrame, shouldDraw);
  if (!shouldDraw) {
    return;
  }
  if (selectedFrame < 0 || selectedFrame >= cache->frameCount || !file.seek(cache->frameOffsets[selectedFrame], SeekSet)) {
    return;
  }

  String line;

  for (int row = 0; row < cache->height; ++row) {
    if (!readSpriteLine(file, line) ||
        !drawSpriteRleRow(
            line,
            cache->palette,
            cache->paletteSize,
            x,
            y,
            cache->width,
            row,
            cache->height,
            targetWidth,
            targetHeight,
            hasClearColor,
            clearColor)) {
      return;
    }
    if ((row & 0x07) == 0x07) {
      yield();
    }
  }
}

void drawSpriteAsset(
    const char* assetPath,
    int x,
    int y,
    int targetWidth,
    int targetHeight,
    bool animatedOnly,
    bool forceAnimatedFrame,
    bool hasClearColor,
    uint16_t clearColor) {
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
      drawAnimatedSpriteAsset(assetPath, file, x, y, targetWidth, targetHeight, forceAnimatedFrame, hasClearColor, clearColor);
    }
  }

  file.close();
}

void resetAnimatedSpriteCaches() {
  for (int i = 0; i < kAnimatedSpriteCacheSlots; ++i) {
    animatedSpriteCaches[i] = AnimatedSpriteCache{};
  }
  nextAnimatedSpriteCacheSlot = 0;
}

class ThemeSpecSink final : public themespec::Sink {
 public:
  explicit ThemeSpecSink(bool forceGifFrame, bool clearSpriteTransparent = false)
      : forceGifFrame_(forceGifFrame),
        clearSpriteTransparent_(clearSpriteTransparent) {}

  void PrimeBackground(uint16_t color) override {
    backgroundColor_ = color;
    hasBackgroundColor_ = true;
  }

  void BeginClip(int x, int y, int width, int height) override {
    if (width <= 0 || height <= 0) {
      return;
    }
    clipActive_ = true;
    Tft().setViewport(x, y, width, height, false);
  }

  void EndClip() override {
    if (!clipActive_) {
      return;
    }
    Tft().resetViewport();
    clipActive_ = false;
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
    if (cmd.maxWidth > 0) {
      TFT_eSPI& tft = Tft();
      int size = cmd.size;
      tft.setTextFont(cmd.font);
      tft.setTextSize(size);
      if (cmd.fitShrink) {
        while (size > 1 && tft.textWidth(cmd.text == nullptr ? "" : cmd.text) > cmd.maxWidth) {
          --size;
          tft.setTextSize(size);
        }
        text.size = size;
      }
      const int width = tft.textWidth(cmd.text == nullptr ? "" : cmd.text);
      if (cmd.align == 1) {
        text.x = cmd.x + max(0, (cmd.maxWidth - width) / 2);
      } else if (cmd.align == 2) {
        text.x = cmd.x + max(0, cmd.maxWidth - width);
      }
    }
    PrimitiveLayer().DrawText(text);
  }

  void DrawProgress(const themespec::ProgressCommand& cmd) override {
    primitive::ProgressCommand progress;
    progress.x = cmd.x;
    progress.y = cmd.y;
    progress.width = cmd.width;
    progress.height = cmd.height;
    progress.percent = cmd.percent;
    progress.style = cmd.style;
    progress.segments = cmd.segments;
    progress.segmentGap = cmd.segmentGap;
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
        forceGifFrame_,
        clearSpriteTransparent_ && (cmd.hasBg || hasBackgroundColor_),
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
  bool clearSpriteTransparent_ = false;
  bool clipActive_ = false;
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
  const String& raw = currentThemeSpecRaw();
  if (!codexbar_display::core::ThemeSpecRawLooksRenderable(raw)) {
    markThemeSpecRenderFailed("missing_theme_spec");
    return false;
  }

  if (!ensureThemeSpecSceneCached(raw)) {
    markThemeSpecRenderFailed("theme_spec_parse_failed");
    return false;
  }

  ThemeSpecSink sink(true);
  if (!themespec::RenderCompiledThemeSpec(cachedThemeSpecScene, currentThemeSpecFrameData(), sink)) {
    markThemeSpecRenderFailed("full_render_failed");
    return false;
  }

  markCurrentThemeSpecRendered();
  nextThemeSpecAnimatedTickAtMs = cachedThemeSpecScene.hasAnimatedAssets
                                      ? millis() + kThemeSpecAnimatedTickMs
                                      : 0;
  const int64_t remain = CurrentRemainingSecs();
  LastRenderedSecs() = remain;
  LastRenderedMinuteBucket() = remain / 60;
  return true;
}

bool TickThemeSpecGifs() {
  const String& raw = currentThemeSpecRaw();
  if (!CurrentFrame().hasThemeSpec || !codexbar_display::core::ThemeSpecRawLooksRenderable(raw)) {
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

  if (!ensureThemeSpecSceneCached(raw)) {
    return false;
  }

  ThemeSpecSink sink(false, true);
  const bool ok = themespec::RenderCompiledThemeSpecAnimatedPrimitives(cachedThemeSpecScene, currentThemeSpecFrameData(), sink);
  return ok;
}

bool RenderThemeSpecPartial(uint32_t changedFields) {
  const String& raw = currentThemeSpecRaw();
  if (!CurrentFrame().hasThemeSpec || !codexbar_display::core::ThemeSpecRawLooksRenderable(raw) || changedFields == 0) {
    return false;
  }

  if (!ensureThemeSpecSceneCached(raw)) {
    markThemeSpecRenderFailed("theme_spec_parse_failed");
    return false;
  }

  ThemeSpecSink sink(true, true);
  if (!themespec::RenderCompiledThemeSpecChangedPrimitives(cachedThemeSpecScene, currentThemeSpecFrameData(), changedFields, sink)) {
    markThemeSpecRenderFailed("partial_render_failed");
    return false;
  }

  markThemeSpecRenderOk();
  nextThemeSpecAnimatedTickAtMs = cachedThemeSpecScene.hasAnimatedAssets
                                      ? millis() + kThemeSpecAnimatedTickMs
                                      : 0;
  const int64_t remain = CurrentRemainingSecs();
  LastRenderedSecs() = remain;
  LastRenderedMinuteBucket() = remain / 60;
  return true;
}

void ResetThemeSpecSpriteCaches() {
  resetAnimatedSpriteCaches();
  lastSuccessfulThemeSpecId = "";
  lastSuccessfulThemeSpecRev = 0;
  lastSuccessfulThemeSpecRawHash = 0;
  cachedThemeSpecDoc.clear();
  cachedThemeSpecDocHash = 0;
  themespec::ReleaseCompiledThemeSpec(cachedThemeSpecScene);
}

bool CurrentThemeSpecRenderedSuccessfully() {
  return currentThemeSpecRenderedSuccessfully();
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

ThemeSpecRuntimeStats ThemeSpecRuntimeStatsSnapshot() {
  ThemeSpecRuntimeStats stats;
  stats.compiled = cachedThemeSpecScene.primitiveCount > 0;
  stats.primitiveCount = static_cast<uint16_t>(cachedThemeSpecScene.primitiveCount);
  stats.primitiveCapacity = static_cast<uint16_t>(cachedThemeSpecScene.primitiveCapacity);
  stats.stateAssetCount = static_cast<uint16_t>(cachedThemeSpecScene.stateAssetCount);
  stats.stateAssetCapacity = static_cast<uint16_t>(cachedThemeSpecScene.stateAssetCapacity);
  stats.stringBytes = static_cast<uint16_t>(cachedThemeSpecScene.stringPoolUsed);
  stats.stringCapacity = static_cast<uint16_t>(cachedThemeSpecScene.stringPoolCapacity);
  stats.keepsJsonDocument = cachedThemeSpecScene.requiresJsonDocument;
  stats.hasAnimatedAssets = cachedThemeSpecScene.hasAnimatedAssets;
  return stats;
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

bool RenderThemeSpecPartial(uint32_t changedFields) {
  (void)changedFields;
  return false;
}

void ResetThemeSpecSpriteCaches() {}

bool CurrentThemeSpecRenderedSuccessfully() {
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

ThemeSpecRuntimeStats ThemeSpecRuntimeStatsSnapshot() {
  return ThemeSpecRuntimeStats{};
}

}  // namespace display
}  // namespace esp8266
}  // namespace codexbar_display

#endif

#endif
