#pragma once

#include "gif_asset_validator.h"

namespace codexbar_display {
namespace esp8266 {

GifValidationError ValidateGifAssetFile(
    const char* path,
    uint8_t maxLzwBits,
    GifValidationInfo* info = nullptr);

}  // namespace esp8266
}  // namespace codexbar_display
