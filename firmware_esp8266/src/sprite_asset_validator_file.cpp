#include "sprite_asset_validator_file.h"

#include <Arduino.h>
#include <LittleFS.h>

namespace codexbar_display {
namespace esp8266 {
namespace {

size_t FileReadAt(void* context, size_t offset, uint8_t* destination, size_t length) {
  File* file = static_cast<File*>(context);
  if (file == nullptr || !*file || !file->seek(offset, SeekSet)) {
    return 0;
  }
  // The validator streams the asset in small cache refills. Feeding the
  // watchdog here keeps a large sprite from resetting the device while the
  // upload request is still being completed.
  ESP.wdtFeed();
  return file->read(destination, length);
}

}  // namespace

SpriteValidationError ValidateSpriteAssetFile(
    const char* path,
    SpriteValidationInfo* info) {
  if (path == nullptr || path[0] == '\0' || !LittleFS.exists(path)) {
    return SpriteValidationError::Empty;
  }
  File file = LittleFS.open(path, "r");
  if (!file) {
    return SpriteValidationError::Empty;
  }
  const SpriteValidationError result =
      ValidateSpriteAsset(FileReadAt, &file, file.size(), info);
  file.close();
  return result;
}

}  // namespace esp8266
}  // namespace codexbar_display
