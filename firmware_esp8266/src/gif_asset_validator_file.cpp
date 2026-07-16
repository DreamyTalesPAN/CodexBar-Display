#include "gif_asset_validator_file.h"

#include <LittleFS.h>

namespace codexbar_display {
namespace esp8266 {
namespace {

size_t FileReadAt(void* context, size_t offset, uint8_t* destination, size_t length) {
  File* file = static_cast<File*>(context);
  if (file == nullptr || !*file || !file->seek(offset, SeekSet)) {
    return 0;
  }
  return file->read(destination, length);
}

}  // namespace

GifValidationError ValidateGifAssetFile(
    const char* path,
    uint8_t maxLzwBits,
    GifValidationInfo* info) {
  if (path == nullptr || path[0] == '\0' || !LittleFS.exists(path)) {
    return GifValidationError::Invalid;
  }
  File file = LittleFS.open(path, "r");
  if (!file) {
    return GifValidationError::Invalid;
  }
  const GifValidationError result =
      ValidateGifAsset(FileReadAt, &file, file.size(), maxLzwBits, info);
  file.close();
  return result;
}

}  // namespace esp8266
}  // namespace codexbar_display
