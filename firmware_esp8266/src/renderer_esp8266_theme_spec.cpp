#include "renderer_esp8266_display_state.h"

#ifndef CODEXBAR_DISPLAY_PROBE_ONLY

#ifndef CODEXBAR_DISPLAY_THEME_SPEC_RENDERER
#define CODEXBAR_DISPLAY_THEME_SPEC_RENDERER 0
#endif

#if CODEXBAR_DISPLAY_THEME_SPEC_RENDERER

#include <LittleFS.h>

#include <cstdio>
#include <cstring>
#include <new>

#include "../../firmware_shared/theme_spec_renderer_core.h"
#include "theme_spec_runtime_policy.h"

namespace codexbar_display {
namespace esp8266 {
namespace display {

namespace {

constexpr unsigned long kThemeSpecAnimatedTickMs = 20UL;
constexpr unsigned long kThemeSpecAnimatedResumeTickMs = 1UL;
constexpr unsigned long kThemeSpecFullRenderRetryMs = 750UL;
constexpr int kAnimatedSpriteCacheSlots = 2;
constexpr int kStaticSpriteRegionCacheMaxRows = 240;
constexpr size_t kSpriteLineReserveBytes = 256;
constexpr size_t kSpriteLineMaxBytes = 512;
unsigned long nextThemeSpecAnimatedTickAtMs = 0;
unsigned long nextThemeSpecFullRenderRetryAtMs = 0;
bool lastThemeSpecRenderOk = true;
bool cbaRenderJobInProgress = false;
unsigned long cbaCompletedFrames = 0;
unsigned long cbaLastFrameDurationMs = 0;
uint16_t* cbaFrameBuffer = nullptr;
uint32_t cbaFrameBufferCapacityPixels = 0;
unsigned long cbaBufferAllocationFailures = 0;
unsigned long cbaLastPushDurationUs = 0;
const char* lastThemeSpecRenderError = "";
unsigned long themeSpecRenderFailures = 0;
unsigned long themeSpecPartialSuccesses = 0;
unsigned long themeSpecPartialFailures = 0;
uint32_t lastPartialChangedFields = 0;
const char* lastPartialError = "";
String lastSuccessfulThemeSpecId = "";
int lastSuccessfulThemeSpecRev = 0;
uint32_t lastSuccessfulThemeSpecRawHash = 0;
JsonDocument cachedThemeSpecDoc;
uint32_t cachedThemeSpecDocHash = 0;
themespec::CompiledThemeSpec cachedThemeSpecScene;
themespec::FrameData currentThemeSpecFrameData(const char* updateNoticeText = nullptr);

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
  int indexedFrameCount = 0;
  int frameIndex = -1;
  int renderingFrameIndex = 0;
  int nextRow = 0;
  uint32_t nextRowOffset = 0;
  bool frameInProgress = false;
  bool frameReadyToPush = false;
  unsigned long frameStartedAtMs = 0;
  unsigned long nextFrameAtMs = 0;
  int frameBufferWidth = 0;
  int frameBufferHeight = 0;
  bool frameBufferHasStaticBackground = false;
};

// A CBA frame buffer is too small to keep a second RGB565 background copy.
// Cache only the CBI palette and row offsets, then rebuild the animated region
// in the existing frame buffer before each frame. This avoids a full TFT redraw.
struct StaticSpriteRegionCache {
  bool valid = false;
  String path;
  int x = 0;
  int y = 0;
  int targetWidth = 0;
  int targetHeight = 0;
  int sourceWidth = 0;
  int sourceHeight = 0;
  uint16_t palette[26] = {0};
  int paletteSize = 0;
  uint32_t rowOffsets[kStaticSpriteRegionCacheMaxRows] = {0};
};

AnimatedSpriteCache animatedSpriteCaches[kAnimatedSpriteCacheSlots];
AnimatedSpriteCache* cbaFrameBufferOwner = nullptr;
int nextAnimatedSpriteCacheSlot = 0;
StaticSpriteRegionCache staticSpriteRegionCache;

void markThemeSpecRenderOk() {
  lastThemeSpecRenderOk = true;
  lastThemeSpecRenderError = "";
}

void markThemeSpecRenderFailed(const char* error) {
  lastThemeSpecRenderOk = false;
  lastThemeSpecRenderError = error == nullptr ? "render_fail" : error;
  themeSpecRenderFailures += 1;
}

void markThemeSpecPartialAttempt(uint32_t changedFields) {
  lastPartialChangedFields = changedFields;
  lastPartialError = "";
}

void markThemeSpecPartialOk(uint32_t changedFields) {
  lastPartialChangedFields = changedFields;
  lastPartialError = "";
  themeSpecPartialSuccesses += 1;
  markThemeSpecRenderOk();
}

void markThemeSpecPartialFailed(uint32_t changedFields, const char* error) {
  lastPartialChangedFields = changedFields;
  lastPartialError = error == nullptr ? "partial_fail" : error;
  themeSpecPartialFailures += 1;
}

uint32_t themeSpecRawHash(const String& raw) {
  uint32_t hash = 2166136261UL;
  for (size_t i = 0; i < raw.length(); ++i) {
    hash ^= static_cast<uint8_t>(raw[i]);
    hash *= 16777619UL;
  }
  return hash == 0 ? 1 : hash;
}

bool compiledThemeSpecHasCbaAssets(const themespec::CompiledThemeSpec& scene) {
  auto isCba = [](const char* path) {
    return themespec::AssetPathLooksAnimated(path) &&
           !themespec::AssetPathLooksGif(path);
  };
  for (size_t i = 0; i < scene.primitiveCount; ++i) {
    const themespec::CompiledPrimitive& primitive = scene.primitives[i];
    if (primitive.kind == themespec::PrimitiveKind::Sprite &&
        (isCba(primitive.assetPath) ||
         isCba(primitive.idleAssetPath) ||
         isCba(primitive.codingAssetPath))) {
      return true;
    }
  }
  return false;
}

const String& currentThemeSpecRaw();
void resetAnimatedSpriteCaches();

void releaseCbaFrameBuffer() {
  delete[] cbaFrameBuffer;
  cbaFrameBuffer = nullptr;
  cbaFrameBufferCapacityPixels = 0;
  cbaFrameBufferOwner = nullptr;
}

void releaseAnimatedSpriteBuffer(AnimatedSpriteCache& cache) {
  if (cbaFrameBufferOwner == &cache) {
    cbaFrameBufferOwner = nullptr;
  }
  cache.frameBufferWidth = 0;
  cache.frameBufferHeight = 0;
  cache.frameBufferHasStaticBackground = false;
  cache.frameReadyToPush = false;
}

void cancelAnimatedSpriteFrame(AnimatedSpriteCache& cache) {
  releaseAnimatedSpriteBuffer(cache);
  cache.frameInProgress = false;
  cache.nextRow = 0;
  cache.nextRowOffset = 0;
}

void cooperativeYield() {
  if (ThemeSpecRuntimePolicy::CanYieldAtDisplayTransactionDepth(
          State().displayTransactionDepth)) {
    yield();
  }
}

void markCurrentThemeSpecRendered() {
  markThemeSpecRenderOk();
  lastSuccessfulThemeSpecId = CurrentFrame().themeSpecId;
  lastSuccessfulThemeSpecRev = CurrentFrame().themeSpecRev;
  lastSuccessfulThemeSpecRawHash = themeSpecRawHash(currentThemeSpecRaw());
}

bool currentThemeSpecRenderedSuccessfully() {
  return lastThemeSpecRenderOk &&
         CurrentFrame().hasThemeSpec &&
         lastSuccessfulThemeSpecRev == CurrentFrame().themeSpecRev &&
         lastSuccessfulThemeSpecId == CurrentFrame().themeSpecId &&
         lastSuccessfulThemeSpecRawHash != 0 &&
         lastSuccessfulThemeSpecRawHash == themeSpecRawHash(currentThemeSpecRaw());
}

bool hasThemeSpecHeap(bool animation) {
  const uint32_t freeHeap = ESP.getFreeHeap();
  const uint32_t maxFreeBlock = ESP.getMaxFreeBlockSize();
  return animation
             ? ThemeSpecRuntimePolicy::CanAnimate(freeHeap, maxFreeBlock)
             : ThemeSpecRuntimePolicy::CanRender(freeHeap, maxFreeBlock);
}

bool fullRenderRetryPending() {
  if (nextThemeSpecFullRenderRetryAtMs == 0) {
    return false;
  }
  return static_cast<long>(millis() - nextThemeSpecFullRenderRetryAtMs) < 0;
}

void scheduleFullRenderRetry() {
  nextThemeSpecFullRenderRetryAtMs = millis() + kThemeSpecFullRenderRetryMs;
}

void clearFullRenderRetry() {
  nextThemeSpecFullRenderRetryAtMs = 0;
}

void releaseThemeSpecRenderMemory() {
  resetAnimatedSpriteCaches();
  releaseCbaFrameBuffer();
  GifCore().ReleaseMemory();
  cachedThemeSpecDoc.clear();
  cachedThemeSpecDocHash = 0;
  themespec::ReleaseCompiledThemeSpec(cachedThemeSpecScene);
  cooperativeYield();
}

bool recoverThemeSpecRenderHeap() {
  releaseThemeSpecRenderMemory();
  return hasThemeSpecHeap(false);
}

const String& currentThemeSpecRaw() {
  return codexbar_display::core::ThemeSpecRawForFrame(RuntimeState(), CurrentFrame());
}

bool ensureThemeSpecSceneCached(const String& raw) {
  const uint32_t rawHash = themeSpecRawHash(raw);
  if (cachedThemeSpecDocHash == rawHash && cachedThemeSpecScene.primitiveCount > 0) {
    return true;
  }

  // A changed theme must stop any previous GIF immediately. The decoder stays
  // released while the next theme is parsed and compiled; GifCore allocates it
  // lazily only after real playback has found a valid GIF header.
  resetAnimatedSpriteCaches();
  GifCore().ReleaseMemory();
  cachedThemeSpecDoc.clear();
  cachedThemeSpecDocHash = 0;
  themespec::ReleaseCompiledThemeSpec(cachedThemeSpecScene);
  cooperativeYield();

  const DeserializationError err = deserializeJson(cachedThemeSpecDoc, raw.c_str());
  if (err) {
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
  if (!compiledThemeSpecHasCbaAssets(cachedThemeSpecScene)) {
    releaseCbaFrameBuffer();
  }
  cachedThemeSpecDocHash = rawHash;
  return true;
}

bool readSpriteLine(File& file, String& line) {
  if (!file.available()) {
    return false;
  }
  line = "";
  line.reserve(kSpriteLineReserveBytes);
  while (file.available()) {
    const int next = file.read();
    if (next < 0 || next == '\n') {
      break;
    }
    if (next == '\r') {
      continue;
    }
    if (line.length() >= kSpriteLineMaxBytes) {
      return false;
    }
    line += static_cast<char>(next);
  }
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

enum class SpriteRenderMode {
  All,
  StaticOnly,
  AnimatedOnly,
};

struct SpriteClip {
  bool active = false;
  int x = 0;
  int y = 0;
  int width = 0;
  int height = 0;
};

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
    uint16_t transparentColor,
    const SpriteClip& clip) {
  int offset = 0;
  int completedRuns = 0;
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
    const int clippedX1 = clip.active ? max(drawX1, clip.x) : drawX1;
    const int clippedY1 = clip.active ? max(drawY1, clip.y) : drawY1;
    const int clippedX2 = clip.active ? min(drawX2, clip.x + clip.width) : drawX2;
    const int clippedY2 = clip.active ? min(drawY2, clip.y + clip.height) : drawY2;
    const bool visible = clippedX1 < clippedX2 && clippedY1 < clippedY2;
    if (token == '.') {
      if (drawTransparentRuns && visible) {
        PrimitiveFillRect(clippedX1, clippedY1, clippedX2 - clippedX1, clippedY2 - clippedY1, transparentColor);
      }
      offset += runLength;
    } else {
      if (token < 'a' || token > 'z') {
        return false;
      }
      const int colorIndex = token - 'a';
      if (colorIndex >= paletteSize) {
        return false;
      }
      if (visible) {
        PrimitiveFillRect(clippedX1, clippedY1, clippedX2 - clippedX1, clippedY2 - clippedY1, palette[colorIndex]);
      }
      offset += runLength;
    }
    ++completedRuns;
    if (ThemeSpecRuntimePolicy::ShouldYieldDuringRleDecode(completedRuns)) {
      cooperativeYield();
    }
  }
  return offset == sourceWidth;
}

bool decodeSpriteRleRowToBuffer(
    const String& row,
    const uint16_t* palette,
    int paletteSize,
    int sourceWidth,
    int sourceRow,
    int sourceHeight,
    uint16_t transparentColor,
    uint16_t* buffer,
    int bufferWidth,
    int bufferHeight,
    bool preserveTransparentPixels) {
  if (buffer == nullptr || sourceWidth <= 0 || sourceHeight <= 0 ||
      sourceRow < 0 || sourceRow >= sourceHeight ||
      bufferWidth <= 0 || bufferHeight <= 0) {
    return false;
  }

  int sourceOffset = 0;
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
    if (runLength <= 0 || i >= row.length() || sourceOffset + runLength > sourceWidth) {
      return false;
    }

    const char token = row[i++];
    const bool transparent = token == '.';
    uint16_t color = transparentColor;
    if (!transparent) {
      if (token < 'a' || token > 'z') {
        return false;
      }
      const int colorIndex = token - 'a';
      if (colorIndex >= paletteSize) {
        return false;
      }
      color = palette[colorIndex];
    }

    const int x1 = (sourceOffset * bufferWidth) / sourceWidth;
    const int x2 = ((sourceOffset + runLength) * bufferWidth + sourceWidth - 1) / sourceWidth;
    const int y1 = (sourceRow * bufferHeight) / sourceHeight;
    const int y2 = ((sourceRow + 1) * bufferHeight + sourceHeight - 1) / sourceHeight;
    if (!transparent || !preserveTransparentPixels) {
      for (int py = y1; py < y2 && py < bufferHeight; ++py) {
        uint16_t* out = buffer + (py * bufferWidth);
        for (int px = x1; px < x2 && px < bufferWidth; ++px) {
          out[px] = color;
        }
      }
    }
    sourceOffset += runLength;
  }
  return sourceOffset == sourceWidth;
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

bool decodeStaticSpriteRleRowToRegionBuffer(
    const String& row,
    const StaticSpriteRegionCache& cache,
    int sourceRow,
    int regionX,
    int regionY,
    int regionWidth,
    int regionHeight,
    uint16_t* buffer) {
  if (buffer == nullptr || sourceRow < 0 || sourceRow >= cache.sourceHeight ||
      regionWidth <= 0 || regionHeight <= 0) {
    return false;
  }
  int sourceOffset = 0;
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
    if (runLength <= 0 || i >= row.length() || sourceOffset + runLength > cache.sourceWidth) {
      return false;
    }
    const char token = row[i++];
    const int drawX1 = cache.x + ((sourceOffset * cache.targetWidth) / cache.sourceWidth);
    const int drawX2 = cache.x + (((sourceOffset + runLength) * cache.targetWidth + cache.sourceWidth - 1) / cache.sourceWidth);
    const int drawY1 = cache.y + ((sourceRow * cache.targetHeight) / cache.sourceHeight);
    const int drawY2 = cache.y + (((sourceRow + 1) * cache.targetHeight + cache.sourceHeight - 1) / cache.sourceHeight);
    const int clippedX1 = max(drawX1, regionX);
    const int clippedX2 = min(drawX2, regionX + regionWidth);
    const int clippedY1 = max(drawY1, regionY);
    const int clippedY2 = min(drawY2, regionY + regionHeight);
    if (token != '.' && clippedX1 < clippedX2 && clippedY1 < clippedY2) {
      if (token < 'a' || token > 'z' || token - 'a' >= cache.paletteSize) {
        return false;
      }
      const uint16_t color = cache.palette[token - 'a'];
      for (int py = clippedY1; py < clippedY2; ++py) {
        uint16_t* out = buffer + ((py - regionY) * regionWidth);
        for (int px = clippedX1; px < clippedX2; ++px) {
          out[px - regionX] = color;
        }
      }
    }
    sourceOffset += runLength;
  }
  return sourceOffset == cache.sourceWidth;
}

bool cacheStaticSpriteRegionForAnimation(
    const char* animationPath,
    int animationX,
    int animationY,
    int animationWidth,
    int animationHeight) {
  if (animationPath == nullptr || animationPath[0] == '\0') {
    return false;
  }
  const themespec::FrameData frameData = currentThemeSpecFrameData();
  int animatedIndex = -1;
  for (size_t i = 0; i < cachedThemeSpecScene.primitiveCount; ++i) {
    const themespec::CompiledPrimitive& primitive = cachedThemeSpecScene.primitives[i];
    if (primitive.kind != themespec::PrimitiveKind::Sprite ||
        !themespec::AssetPathLooksAnimated(themespec::CompiledStateAssetPathFor(primitive, frameData))) {
      continue;
    }
    const char* path = themespec::CompiledStateAssetPathFor(primitive, frameData);
    if (path != nullptr && strcmp(path, animationPath) == 0 &&
        primitive.x == animationX && primitive.y == animationY &&
        primitive.width == animationWidth && primitive.height == animationHeight) {
      animatedIndex = static_cast<int>(i);
      break;
    }
  }
  if (animatedIndex <= 0) {
    return false;
  }

  for (int i = animatedIndex - 1; i >= 0; --i) {
    const themespec::CompiledPrimitive& primitive = cachedThemeSpecScene.primitives[i];
    const char* path = themespec::CompiledStateAssetPathFor(primitive, frameData);
    if (primitive.kind != themespec::PrimitiveKind::Sprite || path == nullptr ||
        themespec::AssetPathLooksAnimated(path) || strstr(path, ".cbi") == nullptr ||
        primitive.x > animationX || primitive.y > animationY ||
        primitive.x + primitive.width < animationX + animationWidth ||
        primitive.y + primitive.height < animationY + animationHeight) {
      continue;
    }
    if (staticSpriteRegionCache.valid && staticSpriteRegionCache.path == path &&
        staticSpriteRegionCache.x == primitive.x && staticSpriteRegionCache.y == primitive.y &&
        staticSpriteRegionCache.targetWidth == primitive.width &&
        staticSpriteRegionCache.targetHeight == primitive.height) {
      return true;
    }
    StaticSpriteRegionCache replacement;
    File file = LittleFS.open(path, "r");
    String line;
    int width = 0;
    int height = 0;
    if (!file || !readSpriteLine(file, line) || line != "CBI1" ||
        !readSpriteLine(file, line) || !parseSpriteHeader(line, width, height) ||
        height > kStaticSpriteRegionCacheMaxRows ||
        !readSpritePalette(file, replacement.palette, replacement.paletteSize)) {
      if (file) {
        file.close();
      }
      continue;
    }
    bool indexed = true;
    for (int row = 0; row < height; ++row) {
      replacement.rowOffsets[row] = static_cast<uint32_t>(file.position());
      if (!readSpriteLine(file, line)) {
        indexed = false;
        break;
      }
      if (ThemeSpecRuntimePolicy::ShouldYieldDuringAssetScan(row + 1)) {
        cooperativeYield();
      }
    }
    file.close();
    if (!indexed) {
      continue;
    }
    replacement.valid = true;
    replacement.path = path;
    replacement.x = primitive.x;
    replacement.y = primitive.y;
    replacement.targetWidth = primitive.width;
    replacement.targetHeight = primitive.height;
    replacement.sourceWidth = width;
    replacement.sourceHeight = height;
    staticSpriteRegionCache = replacement;
    return true;
  }
  return false;
}

bool restoreCachedStaticSpriteRegion(
    int regionX,
    int regionY,
    int regionWidth,
    int regionHeight,
    uint16_t* buffer) {
  const StaticSpriteRegionCache& cache = staticSpriteRegionCache;
  if (!cache.valid || buffer == nullptr || regionWidth <= 0 || regionHeight <= 0 ||
      cache.x > regionX || cache.y > regionY ||
      cache.x + cache.targetWidth < regionX + regionWidth ||
      cache.y + cache.targetHeight < regionY + regionHeight) {
    return false;
  }
  File file = LittleFS.open(cache.path, "r");
  if (!file) {
    return false;
  }
  String line;
  bool restored = true;
  for (int row = 0; row < cache.sourceHeight; ++row) {
    const int drawY1 = cache.y + ((row * cache.targetHeight) / cache.sourceHeight);
    const int drawY2 = cache.y + (((row + 1) * cache.targetHeight + cache.sourceHeight - 1) / cache.sourceHeight);
    if (drawY2 <= regionY || drawY1 >= regionY + regionHeight) {
      continue;
    }
    if (!file.seek(cache.rowOffsets[row], SeekSet) || !readSpriteLine(file, line) ||
        !decodeStaticSpriteRleRowToRegionBuffer(
            line, cache, row, regionX, regionY, regionWidth, regionHeight, buffer)) {
      restored = false;
      break;
    }
    if (ThemeSpecRuntimePolicy::ShouldYieldDuringAssetScan(row + 1)) {
      cooperativeYield();
    }
  }
  file.close();
  return restored;
}

void drawStaticSpriteAsset(
    File& file,
    int x,
    int y,
    int targetWidth,
    int targetHeight,
    bool hasClearColor,
    uint16_t clearColor,
    const SpriteClip& clip) {
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
    if (!readSpriteLine(file, line)) {
      return;
    }
    const int drawHeight = targetHeight > 0 ? targetHeight : height;
    // Partial renders keep the TFT viewport for correctness, but avoid
    // decoding the unchanged rows of a full-screen background entirely.
    if (clip.active &&
        !ThemeSpecRuntimePolicy::ScaledSpriteRowIntersectsClip(row, height, y, drawHeight, clip.y, clip.height)) {
      const int drawY1 = y + ((row * drawHeight) / height);
      if (drawY1 >= clip.y + clip.height) {
        break;
      }
    } else if (!drawSpriteRleRow(
                   line,
                   palette,
                   paletteSize,
                   x,
                   y,
                   width,
                   row,
                   height,
                   targetWidth,
                   targetHeight,
                   hasClearColor,
                   clearColor,
                   clip)) {
      return;
    }
    if (ThemeSpecRuntimePolicy::ShouldYieldDuringAssetScan(row + 1)) {
      cooperativeYield();
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

  releaseAnimatedSpriteBuffer(*slot);
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
  cache.frameIndex = -1;
  cache.renderingFrameIndex = 0;
  cache.nextRow = 0;
  cache.frameInProgress = false;
  cache.frameStartedAtMs = 0;
  cache.nextFrameAtMs = 0;

  // Do not scan every compressed row of every frame during the first render.
  // Frame zero starts at the current position. Each successful frame draw
  // records the following frame's offset, amortizing the index across normal
  // animation ticks instead of blocking the HTTP/frame path up front.
  cache.indexedFrameCount = ThemeSpecRuntimePolicy::InitialAnimatedIndexedFrameCount(frameCount);
  cache.frameOffsets[0] = static_cast<uint32_t>(file.position());
  cache.nextRowOffset = cache.frameOffsets[0];

  cache.valid = true;
  return true;
}

bool prepareAnimatedSpriteBuffer(
    AnimatedSpriteCache& cache,
    int x,
    int y,
    int targetWidth,
    int targetHeight,
    bool hasClearColor,
    uint16_t clearColor) {
  const int bufferWidth = targetWidth > 0 ? targetWidth : cache.width;
  const int bufferHeight = targetHeight > 0 ? targetHeight : cache.height;
  const uint32_t bufferBytes = ThemeSpecRuntimePolicy::CbaBufferBytes(
      bufferWidth,
      bufferHeight);
  if (!hasClearColor || bufferBytes == 0 ||
      (cbaFrameBufferOwner != nullptr && cbaFrameBufferOwner != &cache)) {
    return false;
  }

  const uint32_t requiredPixels = bufferBytes / sizeof(uint16_t);
  if (cbaFrameBuffer == nullptr || cbaFrameBufferCapacityPixels < requiredPixels) {
    uint16_t* replacement = nullptr;
    if (ThemeSpecRuntimePolicy::CanAllocateCbaBuffer(
            ESP.getFreeHeap(),
            ESP.getMaxFreeBlockSize(),
            bufferBytes)) {
      replacement = new (std::nothrow) uint16_t[requiredPixels];
    }
    if (replacement == nullptr && cbaFrameBuffer != nullptr) {
      // A larger theme may need the bytes currently held by the reusable
      // buffer. Release only for this deliberate resize, then re-check the
      // real allocator state before retrying. There is never a direct-draw
      // fallback if the guarded allocation still fails.
      releaseCbaFrameBuffer();
      if (ThemeSpecRuntimePolicy::CanAllocateCbaBuffer(
              ESP.getFreeHeap(),
              ESP.getMaxFreeBlockSize(),
              bufferBytes)) {
        replacement = new (std::nothrow) uint16_t[requiredPixels];
      }
    }
    if (replacement == nullptr) {
      cbaBufferAllocationFailures += 1;
      return false;
    }
    delete[] cbaFrameBuffer;
    cbaFrameBuffer = replacement;
    cbaFrameBufferCapacityPixels = requiredPixels;
  }
  for (uint32_t i = 0; i < requiredPixels; ++i) {
    cbaFrameBuffer[i] = clearColor;
  }
  cache.frameBufferHasStaticBackground = restoreCachedStaticSpriteRegion(
      x,
      y,
      bufferWidth,
      bufferHeight,
      cbaFrameBuffer);
  cbaFrameBufferOwner = &cache;
  cache.frameBufferWidth = bufferWidth;
  cache.frameBufferHeight = bufferHeight;
  return true;
}

void pushCompletedAnimatedSpriteFrame(
    AnimatedSpriteCache& cache,
    int x,
    int y) {
  if (!cache.frameReadyToPush || cbaFrameBuffer == nullptr ||
      cbaFrameBufferOwner != &cache) {
    return;
  }
  const unsigned long pushStartUs = micros();
  {
    DisplayTransaction transaction;
    const bool previousSwapBytes = Tft().getSwapBytes();
    Tft().setSwapBytes(true);
    Tft().pushImage(
        x,
        y,
        cache.frameBufferWidth,
        cache.frameBufferHeight,
        cbaFrameBuffer);
    Tft().setSwapBytes(previousSwapBytes);
  }
  cbaLastPushDurationUs = micros() - pushStartUs;

  cache.frameIndex = cache.renderingFrameIndex;
  if (ThemeSpecRuntimePolicy::ShouldIndexNextAnimatedFrame(
          cache.frameIndex,
          cache.frameCount,
          cache.indexedFrameCount)) {
    cache.frameOffsets[cache.indexedFrameCount] = cache.nextRowOffset;
    cache.indexedFrameCount += 1;
  }
  cache.frameReadyToPush = false;
  cbaCompletedFrames += 1;
  cbaLastFrameDurationMs = millis() - cache.frameStartedAtMs;
  const unsigned long frameDelayMs = ThemeSpecRuntimePolicy::CbaFrameDelayMs(cache.fps);
  cache.nextFrameAtMs = frameDelayMs > 0 ? cache.frameStartedAtMs + frameDelayMs : 0;
  releaseAnimatedSpriteBuffer(cache);
}

bool drawAnimatedSpriteAsset(
    AnimatedSpriteCache& cache,
    File& file,
    int x,
    int y,
    int targetWidth,
    int targetHeight,
    bool hasClearColor,
    uint16_t clearColor) {
  if (!cache.valid && !loadAnimatedSpriteCache(file, cache)) {
    return false;
  }

  if (!cache.frameInProgress) {
    cache.renderingFrameIndex = ThemeSpecRuntimePolicy::NextCbaFrameIndex(
        cache.frameIndex,
        cache.frameCount);
    if (!ThemeSpecRuntimePolicy::AnimatedFrameOffsetAvailable(
            cache.renderingFrameIndex,
            cache.frameCount,
            cache.indexedFrameCount)) {
      cache.valid = false;
      return false;
    }
    cache.nextRow = 0;
    cache.nextRowOffset = cache.frameOffsets[cache.renderingFrameIndex];
    releaseAnimatedSpriteBuffer(cache);
    (void)cacheStaticSpriteRegionForAnimation(
        cache.path.c_str(),
        x,
        y,
        targetWidth > 0 ? targetWidth : cache.width,
        targetHeight > 0 ? targetHeight : cache.height);
    if (!prepareAnimatedSpriteBuffer(
            cache,
            x,
            y,
            targetWidth,
            targetHeight,
            hasClearColor,
            clearColor)) {
      cache.nextFrameAtMs = millis() + kThemeSpecFullRenderRetryMs;
      return false;
    }
    cache.frameInProgress = true;
    cache.frameStartedAtMs = millis();
  }

  if (!file.seek(cache.nextRowOffset, SeekSet)) {
    cache.valid = false;
    cancelAnimatedSpriteFrame(cache);
    return false;
  }

  String line;
  const int rowsThisTick = ThemeSpecRuntimePolicy::CbaRowsForTick(
      cache.nextRow,
      cache.height);
  for (int rowBudget = 0; rowBudget < rowsThisTick; ++rowBudget) {
    const int row = cache.nextRow;
    const bool preserveTransparentPixels = cache.frameBufferHasStaticBackground;
    if (!readSpriteLine(file, line) ||
        !decodeSpriteRleRowToBuffer(
            line,
            cache.palette,
            cache.paletteSize,
            cache.width,
            row,
            cache.height,
            clearColor,
            cbaFrameBuffer,
            cache.frameBufferWidth,
            cache.frameBufferHeight,
            preserveTransparentPixels)) {
      cache.valid = false;
      cancelAnimatedSpriteFrame(cache);
      return false;
    }
    cache.nextRow += 1;
    cache.nextRowOffset = static_cast<uint32_t>(file.position());
  }

  if (cache.nextRow < cache.height) {
    cbaRenderJobInProgress = true;
    return true;
  }

  cache.frameInProgress = false;
  cache.frameReadyToPush = true;
  return true;
}

void drawSpriteAsset(
    const char* assetPath,
    int x,
    int y,
    int targetWidth,
    int targetHeight,
    SpriteRenderMode mode,
    bool hasClearColor,
    uint16_t clearColor,
    const SpriteClip& clip) {
  if (assetPath == nullptr || assetPath[0] == '\0') {
    return;
  }
  AnimatedSpriteCache* animatedCache = nullptr;
  if (mode == SpriteRenderMode::AnimatedOnly) {
    if (clip.active) {
      return;
    }
    animatedCache = animatedSpriteCacheForPath(assetPath);
    if (animatedCache == nullptr ||
        !ThemeSpecRuntimePolicy::CbaWorkDue(
            false,
            animatedCache->frameInProgress,
            animatedCache->valid,
            animatedCache->frameCount,
            animatedCache->fps,
            animatedCache->nextFrameAtMs,
            millis())) {
      return;
    }
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
      if (mode != SpriteRenderMode::AnimatedOnly) {
        drawStaticSpriteAsset(file, x, y, targetWidth, targetHeight, hasClearColor, clearColor, clip);
      }
    } else if (line == "CBA1") {
      if (mode != SpriteRenderMode::StaticOnly && animatedCache != nullptr) {
        (void)drawAnimatedSpriteAsset(
            *animatedCache,
            file,
            x,
            y,
            targetWidth,
            targetHeight,
            hasClearColor,
            clearColor);
      }
    }
  }

  file.close();
  if (animatedCache != nullptr && animatedCache->frameReadyToPush) {
    pushCompletedAnimatedSpriteFrame(*animatedCache, x, y);
  }
  if (animatedCache != nullptr && animatedCache->frameInProgress) {
    cbaRenderJobInProgress = true;
  }
}

void resetAnimatedSpriteCaches() {
  cbaRenderJobInProgress = false;
  cbaFrameBufferOwner = nullptr;
  for (int i = 0; i < kAnimatedSpriteCacheSlots; ++i) {
    animatedSpriteCaches[i] = AnimatedSpriteCache{};
  }
  staticSpriteRegionCache = StaticSpriteRegionCache{};
  nextAnimatedSpriteCacheSlot = 0;
}

class ThemeSpecSink final : public themespec::Sink {
 public:
  explicit ThemeSpecSink(
      bool forceAnimatedFrame,
      SpriteRenderMode spriteRenderMode = SpriteRenderMode::All,
      bool clearSpriteTransparent = false)
      : forceAnimatedFrame_(forceAnimatedFrame),
        spriteRenderMode_(spriteRenderMode),
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
    clipX_ = x;
    clipY_ = y;
    clipW_ = width;
    clipH_ = height;
    Tft().setViewport(x, y, width, height, false);
  }

  void EndClip() override {
    if (!clipActive_) {
      return;
    }
    Tft().resetViewport();
    clipActive_ = false;
    clipX_ = 0;
    clipY_ = 0;
    clipW_ = 0;
    clipH_ = 0;
  }

  void FillScreen(uint16_t color) override {
    backgroundColor_ = color;
    hasBackgroundColor_ = true;
    PrimitiveFillScreen(color);
  }

  void FillRect(const themespec::RectCommand& cmd) override {
    primitive::RectCommand rect;
    rect.x = cmd.x;
    rect.y = cmd.y;
    rect.width = cmd.width;
    rect.height = cmd.height;
    rect.borderRadius = cmd.borderRadius;
    rect.color = cmd.color;
    PrimitiveLayer().FillRect(rect);
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
    int textClipX = cmd.x;
    int textClipY = cmd.y;
    int textClipW = cmd.maxWidth;
    int textClipH = 0;
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
      const int fontHeight = static_cast<int>(tft.fontHeight());
      textClipH = fontHeight > 1 ? fontHeight + 4 : 1;
    }
    if (textClipW > 0) {
      if (!intersectWithActiveClip(textClipX, textClipY, textClipW, textClipH)) {
        return;
      }
      Tft().setViewport(textClipX, textClipY, textClipW, textClipH, false);
      PrimitiveLayer().DrawText(text);
      restoreActiveClip();
      return;
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
    progress.borderRadius = cmd.borderRadius;
    progress.fillColor = cmd.fillColor;
    progress.borderColor = cmd.borderColor;
    progress.bgColor = cmd.bgColor;
    PrimitiveLayer().DrawProgress(progress);
  }

  void DrawGif(const themespec::GifCommand& cmd) override {
    GifPlaybackRequest request;
    request.assetPath = cmd.assetPath;
    request.x = cmd.x;
    request.y = cmd.y;
    request.width = cmd.width;
    request.height = cmd.height;
    request.hasBackgroundColor = cmd.hasBg || hasBackgroundColor_;
    request.backgroundColor = cmd.hasBg ? cmd.bg : backgroundColor_;
    (void)GifCore().Tick(Tft(), request, forceAnimatedFrame_);
  }

  void DrawSprite(const themespec::SpriteCommand& cmd) override {
    SpriteClip clip;
    clip.active = clipActive_;
    clip.x = clipX_;
    clip.y = clipY_;
    clip.width = clipW_;
    clip.height = clipH_;
    drawSpriteAsset(
        cmd.assetPath,
        cmd.x,
        cmd.y,
        cmd.width,
        cmd.height,
        spriteRenderMode_,
        clearSpriteTransparent_ && (cmd.hasBg || hasBackgroundColor_),
        cmd.hasBg ? cmd.bg : backgroundColor_,
        clip);
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
  bool intersectWithActiveClip(int& x, int& y, int& width, int& height) const {
    if (width <= 0 || height <= 0) {
      return false;
    }
    if (!clipActive_) {
      return true;
    }
    const int x1 = max(x, clipX_);
    const int y1 = max(y, clipY_);
    const int x2 = min(x + width, clipX_ + clipW_);
    const int y2 = min(y + height, clipY_ + clipH_);
    x = x1;
    y = y1;
    width = x2 - x1;
    height = y2 - y1;
    return width > 0 && height > 0;
  }

  void restoreActiveClip() {
    if (clipActive_) {
      Tft().setViewport(clipX_, clipY_, clipW_, clipH_, false);
    } else {
      Tft().resetViewport();
    }
  }

  bool forceAnimatedFrame_ = false;
  SpriteRenderMode spriteRenderMode_ = SpriteRenderMode::All;
  bool clearSpriteTransparent_ = false;
  bool clipActive_ = false;
  int clipX_ = 0;
  int clipY_ = 0;
  int clipW_ = 0;
  int clipH_ = 0;
  bool hasBackgroundColor_ = false;
  uint16_t backgroundColor_ = 0x0000;
};

const char* usageModeText() {
  if (CurrentFrame().hasUsageMode && CurrentFrame().usageMode == "remaining") {
    return "remaining";
  }
  return "used";
}

const char* themeSpecUpdateNoticeText() {
  return "Open VibeTV Mac App";
}

themespec::FrameData currentThemeSpecFrameData(const char* updateNoticeText) {
  themespec::FrameData frame;
  frame.provider = CurrentFrame().provider.c_str();
  frame.label = ProviderLabelText();
  frame.updateAvailable = CurrentFrame().updateAvailable;
  frame.showUpdateNotice = updateNoticeText != nullptr && updateNoticeText[0] != '\0';
  frame.updateNotice = frame.showUpdateNotice ? updateNoticeText : themeSpecUpdateNoticeText();
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
  if (fullRenderRetryPending()) {
    return false;
  }
  const String& raw = currentThemeSpecRaw();
  if (!codexbar_display::core::ThemeSpecRawLooksRenderable(raw)) {
    markThemeSpecRenderFailed("missing_spec");
    scheduleFullRenderRetry();
    return false;
  }
  if (!hasThemeSpecHeap(false) && !recoverThemeSpecRenderHeap()) {
    markThemeSpecRenderFailed("low_heap");
    scheduleFullRenderRetry();
    return false;
  }

  if (!ensureThemeSpecSceneCached(raw)) {
    markThemeSpecRenderFailed("parse_fail");
    scheduleFullRenderRetry();
    return false;
  }

  // A full redraw cancels any partial CBA job. The active state restarts at
  // frame zero and resumes a bounded row chunk per main-loop tick.
  resetAnimatedSpriteCaches();

  const auto frameData = currentThemeSpecFrameData();
  ThemeSpecSink sink(false, SpriteRenderMode::StaticOnly);
  if (!themespec::RenderCompiledThemeSpecStaticPrimitives(cachedThemeSpecScene, frameData, sink)) {
    markThemeSpecRenderFailed(nullptr);
    scheduleFullRenderRetry();
    return false;
  }
  markCurrentThemeSpecRendered();
  clearFullRenderRetry();
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
  if (!hasThemeSpecHeap(true)) {
    nextThemeSpecAnimatedTickAtMs = now + kThemeSpecAnimatedTickMs;
    return true;
  }

  if (!ensureThemeSpecSceneCached(raw)) {
    nextThemeSpecAnimatedTickAtMs = now + kThemeSpecAnimatedTickMs;
    return false;
  }

  ThemeSpecSink sink(false, SpriteRenderMode::AnimatedOnly, true);
  cbaRenderJobInProgress = false;
  const bool ok = themespec::RenderCompiledThemeSpecAnimatedPrimitives(cachedThemeSpecScene, currentThemeSpecFrameData(), sink);
  nextThemeSpecAnimatedTickAtMs = now +
      (cbaRenderJobInProgress ? kThemeSpecAnimatedResumeTickMs : kThemeSpecAnimatedTickMs);
  return ok;
}

bool ThemeSpecAnimationWorkPending() {
  return cbaRenderJobInProgress;
}

bool RenderThemeSpecPartial(uint32_t changedFields, const char* updateNoticeText) {
  markThemeSpecPartialAttempt(changedFields);
  const String& raw = currentThemeSpecRaw();
  if (!CurrentFrame().hasThemeSpec || !codexbar_display::core::ThemeSpecRawLooksRenderable(raw) || changedFields == 0) {
    markThemeSpecPartialFailed(changedFields, changedFields == 0 ? "no_changes" : "missing_spec");
    return false;
  }

  if (!hasThemeSpecHeap(false)) {
    markThemeSpecPartialFailed(changedFields, "low_heap");
    ScreenDirty() = true;
    return false;
  }

  if (!ensureThemeSpecSceneCached(raw)) {
    markThemeSpecPartialFailed(changedFields, "parse_fail");
    return false;
  }

  const auto frameData = currentThemeSpecFrameData(updateNoticeText);
  ThemeSpecSink sink(false, SpriteRenderMode::StaticOnly, true);
  const char* partialError = nullptr;
  if (!themespec::RenderCompiledThemeSpecChangedPrimitives(
          cachedThemeSpecScene,
          frameData,
          changedFields,
          sink,
          &partialError,
          nullptr)) {
    markThemeSpecPartialFailed(changedFields, partialError);
    return false;
  }
  // State assets are selected by activity. Clearing the cache cancels the old
  // resumable job and starts the new state's animation at frame zero.
  if ((changedFields & themespec::kThemeSpecFieldActivity) != 0) {
    resetAnimatedSpriteCaches();
  }
  markThemeSpecPartialOk(changedFields);
  nextThemeSpecAnimatedTickAtMs = cachedThemeSpecScene.hasAnimatedAssets
                                      ? millis() + kThemeSpecAnimatedTickMs
                                      : 0;
  const int64_t remain = CurrentRemainingSecs();
  LastRenderedSecs() = remain;
  LastRenderedMinuteBucket() = remain / 60;
  return true;
}

bool RenderThemeSpecRegion(int x, int y, int width, int height) {
  const String& raw = currentThemeSpecRaw();
  if (!CurrentFrame().hasThemeSpec || !codexbar_display::core::ThemeSpecRawLooksRenderable(raw)) {
    return false;
  }
  if (!hasThemeSpecHeap(false)) {
    return false;
  }
  if (!ensureThemeSpecSceneCached(raw)) {
    return false;
  }

  themespec::Bounds region;
  region.x = x;
  region.y = y;
  region.width = width;
  region.height = height;
  const auto frameData = currentThemeSpecFrameData();
  ThemeSpecSink sink(false, SpriteRenderMode::StaticOnly, true);
  const char* regionError = nullptr;
  if (themespec::RenderCompiledThemeSpecRegionPrimitives(
          cachedThemeSpecScene, frameData, region, sink, &regionError, nullptr)) {
    return true;
  }
  // The background fill already restored a region no primitive overlaps.
  return regionError != nullptr && strcmp(regionError, "no_overlap_rendered") == 0;
}

FirmwareUpdateOverlayPlacement FirmwareUpdateOverlayBarPlacement() {
  FirmwareUpdateOverlayPlacement placement;
  const String& raw = currentThemeSpecRaw();
  if (!CurrentFrame().hasThemeSpec || !codexbar_display::core::ThemeSpecRawLooksRenderable(raw)) {
    return placement;
  }
  if (!ensureThemeSpecSceneCached(raw)) {
    return placement;
  }

  const auto frameData = currentThemeSpecFrameData();
  themespec::Bounds bar;
  bar.x = 0;
  bar.width = Tft().width();
  bar.height = kFirmwareUpdateNoticeBarHeight;
  bar.y = 0;
  if (!themespec::AnyAnimatedCompiledPrimitiveOverlaps(cachedThemeSpecScene, frameData, bar)) {
    placement.valid = true;
    placement.y = bar.y;
    return placement;
  }
  // Animated GIF/sprite frames repaint their full bounds on every tick and
  // would fight with an overlay drawn on top. Fall back to the bottom edge.
  bar.y = Tft().height() - bar.height;
  if (!themespec::AnyAnimatedCompiledPrimitiveOverlaps(cachedThemeSpecScene, frameData, bar)) {
    placement.valid = true;
    placement.y = bar.y;
  }
  return placement;
}

void ResetThemeSpecSpriteCaches() {
  resetAnimatedSpriteCaches();
  releaseCbaFrameBuffer();
  clearFullRenderRetry();
  lastSuccessfulThemeSpecId = "";
  lastSuccessfulThemeSpecRev = 0;
  lastSuccessfulThemeSpecRawHash = 0;
  lastPartialChangedFields = 0;
  lastPartialError = "";
  cachedThemeSpecDoc.clear();
  cachedThemeSpecDocHash = 0;
  themespec::ReleaseCompiledThemeSpec(cachedThemeSpecScene);
}

bool ThemeSpecFullRenderRetryPending() {
  return fullRenderRetryPending();
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
  stats.stringBytes = static_cast<uint16_t>(cachedThemeSpecScene.stringPoolUsed);
  stats.stringCapacity = static_cast<uint16_t>(cachedThemeSpecScene.stringPoolCapacity);
  stats.keepsJsonDocument = cachedThemeSpecScene.requiresJsonDocument;
  stats.hasAnimatedAssets = cachedThemeSpecScene.hasAnimatedAssets;
  stats.cbaCompletedFrames = cbaCompletedFrames;
  stats.cbaLastFrameDurationMs = cbaLastFrameDurationMs;
  stats.cbaBufferBytes = cbaFrameBufferCapacityPixels * sizeof(uint16_t);
  stats.cbaBufferAllocationFailures = cbaBufferAllocationFailures;
  stats.cbaLastPushDurationUs = cbaLastPushDurationUs;
  stats.partialSuccesses = themeSpecPartialSuccesses;
  stats.partialFailures = themeSpecPartialFailures;
  stats.lastPartialChangedFields = lastPartialChangedFields;
  stats.lastPartialError = lastPartialError;
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

bool ThemeSpecAnimationWorkPending() {
  return false;
}

bool RenderThemeSpecPartial(uint32_t changedFields, const char* updateNoticeText) {
  (void)changedFields;
  (void)updateNoticeText;
  return false;
}

void ResetThemeSpecSpriteCaches() {}

bool ThemeSpecFullRenderRetryPending() {
  return false;
}

bool CurrentThemeSpecRenderedSuccessfully() {
  return false;
}

bool RenderThemeSpecRegion(int x, int y, int width, int height) {
  (void)x;
  (void)y;
  (void)width;
  (void)height;
  return false;
}

FirmwareUpdateOverlayPlacement FirmwareUpdateOverlayBarPlacement() {
  return FirmwareUpdateOverlayPlacement{};
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
