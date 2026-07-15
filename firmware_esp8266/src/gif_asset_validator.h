#pragma once

#include <stddef.h>
#include <stdint.h>

namespace codexbar_display {
namespace esp8266 {

constexpr uint8_t kMaxThemeGifLzwBits = 11;

enum class GifValidationError : uint8_t {
  None = 0,
  Invalid,
  LzwCodeSizeExceeded,
};

struct GifValidationInfo {
  uint16_t width = 0;
  uint16_t height = 0;
};

using GifReadAtCallback = size_t (*)(void* context, size_t offset, uint8_t* destination, size_t length);

GifValidationError ValidateGifAsset(
    GifReadAtCallback readAt,
    void* context,
    size_t size,
    uint8_t maxLzwBits,
    GifValidationInfo* info = nullptr);

GifValidationError ValidateGifAssetMemory(
    const uint8_t* bytes,
    size_t size,
    uint8_t maxLzwBits,
    GifValidationInfo* info = nullptr);

}  // namespace esp8266
}  // namespace codexbar_display
