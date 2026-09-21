#pragma once

#include "sprite_asset_validator.h"

namespace codexbar_display {
namespace esp8266 {

SpriteValidationError ValidateSpriteAssetFile(
    const char* path,
    SpriteValidationInfo* info = nullptr);

}  // namespace esp8266
}  // namespace codexbar_display
