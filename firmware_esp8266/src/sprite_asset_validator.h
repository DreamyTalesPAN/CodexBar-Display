#pragma once

#include <stddef.h>
#include <stdint.h>

namespace codexbar_display {
namespace esp8266 {

// Upper bound for a stored sprite edge. Well above the 240x240 panel so every
// shippable asset still passes, but low enough that width*height*frameCount
// cannot overflow the int math used by the renderer.
constexpr int kMaxSpriteDimension = 480;
// Mirrors the renderer's parseAnimatedSpriteHeader limits so validation never
// accepts a CBA the ThemeSpec renderer would refuse to index.
constexpr int kMaxSpriteFrames = 64;
constexpr int kMaxSpriteFps = 30;
constexpr int kMaxSpritePaletteSize = 26;

enum class SpriteValidationError : uint8_t {
  None = 0,
  Empty,
  UnsupportedHeader,
  InvalidDimensions,
  InvalidPalette,
  InvalidRow,
  Truncated,
  TrailingData,
};

struct SpriteValidationInfo {
  bool animated = false;
  int width = 0;
  int height = 0;
  int frameCount = 0;
  int fps = 0;
  int paletteSize = 0;
  uint32_t rowCount = 0;
};

using SpriteReadAtCallback = size_t (*)(void* context, size_t offset, uint8_t* destination, size_t length);

// Streams the asset through a small fixed cache and never buffers a full file
// or a full row, so the ESP8266 upload path can validate a sprite without
// holding the asset in RAM.
SpriteValidationError ValidateSpriteAsset(
    SpriteReadAtCallback readAt,
    void* context,
    size_t size,
    SpriteValidationInfo* info = nullptr);

SpriteValidationError ValidateSpriteAssetMemory(
    const uint8_t* bytes,
    size_t size,
    SpriteValidationInfo* info = nullptr);

// Short, stable diagnostic text for support and upload error responses.
const char* SpriteValidationErrorText(SpriteValidationError error);

}  // namespace esp8266
}  // namespace codexbar_display
