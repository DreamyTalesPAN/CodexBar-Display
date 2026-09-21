#include "sprite_asset_validator.h"

#include "theme_spec_runtime_policy.h"

namespace codexbar_display {
namespace esp8266 {
namespace {

// Longest header/palette line the validator keeps in RAM. RLE rows are
// validated while streaming and are never collected into a buffer.
constexpr size_t kMaxTokenLineBytes = 64;
// Mirrors kSpriteLineMaxBytes in the renderer. readSpriteLine() refuses any
// longer row, so accepting one here would promote an asset the device then
// fails to draw with cbi_truncated.
constexpr int kMaxRowBytes = 512;

class LineReader {
 public:
  LineReader(SpriteReadAtCallback readAt, void* context, size_t size)
      : readAt_(readAt), context_(context), size_(size) {}

  bool ReadByte(uint8_t& value) {
    if (position_ >= size_) {
      return false;
    }
    if (position_ < cacheOffset_ || position_ >= cacheOffset_ + cacheLength_) {
      cacheOffset_ = position_;
      const size_t remaining = size_ - position_;
      const size_t requested = remaining < sizeof(cache_) ? remaining : sizeof(cache_);
      cacheLength_ = readAt_ != nullptr ? readAt_(context_, cacheOffset_, cache_, requested) : 0;
      if (cacheLength_ == 0) {
        return false;
      }
    }
    value = cache_[position_ - cacheOffset_];
    ++position_;
    return true;
  }

  bool AtEnd() const { return position_ >= size_; }

 private:
  SpriteReadAtCallback readAt_ = nullptr;
  void* context_ = nullptr;
  size_t size_ = 0;
  size_t position_ = 0;
  size_t cacheOffset_ = 0;
  size_t cacheLength_ = 0;
  uint8_t cache_[64] = {0};
};

// Mirrors readSpriteLine() in the renderer: CR is dropped, LF terminates, and
// surrounding whitespace is trimmed.
bool ReadTrimmedLine(LineReader& reader, char* out, size_t capacity, bool& overlong) {
  overlong = false;
  if (out == nullptr || capacity == 0 || reader.AtEnd()) {
    return false;
  }
  size_t length = 0;
  uint8_t value = 0;
  while (reader.ReadByte(value)) {
    if (value == '\n') {
      break;
    }
    if (value == '\r') {
      continue;
    }
    if (length + 1 >= capacity) {
      overlong = true;
      return false;
    }
    out[length++] = static_cast<char>(value);
  }
  while (length > 0 && (out[length - 1] == ' ' || out[length - 1] == '\t')) {
    --length;
  }
  size_t start = 0;
  while (start < length && (out[start] == ' ' || out[start] == '\t')) {
    ++start;
  }
  if (start > 0) {
    for (size_t i = 0; i + start < length; ++i) {
      out[i] = out[i + start];
    }
    length -= start;
  }
  out[length] = '\0';
  return true;
}

bool LinesEqual(const char* line, const char* expected) {
  size_t i = 0;
  for (; expected[i] != '\0'; ++i) {
    if (line[i] != expected[i]) {
      return false;
    }
  }
  return line[i] == '\0';
}

bool IsHexColorLine(const char* line) {
  if (line == nullptr || line[0] != '#') {
    return false;
  }
  for (int i = 1; i < 7; ++i) {
    const char c = line[i];
    const bool valid = (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F');
    if (!valid) {
      return false;
    }
  }
  return line[7] == '\0';
}

// Streams one RLE row and checks that its runs cover exactly `width` pixels
// using only palette indices that exist. The row is never materialized.
SpriteValidationError ValidateRow(LineReader& reader, int width, int paletteSize, bool& sawRow) {
  sawRow = false;
  if (reader.AtEnd()) {
    return SpriteValidationError::Truncated;
  }
  sawRow = true;
  int offset = 0;
  int runLength = 0;
  bool hasRunLength = false;
  uint8_t value = 0;
  bool endOfLine = false;
  int rowBytes = 0;
  // readSpriteLine() trims the row before decoding and the Companion trims it
  // during pack validation, so surrounding whitespace is not RLE content here
  // either. Interior whitespace stays invalid, exactly as the renderer sees it.
  bool sawToken = false;
  int pendingSpaces = 0;
  while (!endOfLine) {
    if (!reader.ReadByte(value)) {
      endOfLine = true;
      value = '\n';
    }
    if (value == '\r') {
      continue;
    }
    if (value == '\n') {
      break;
    }
    // readSpriteLine() counts every raw non-CR byte against its line buffer
    // before trimming, so leading and trailing whitespace counts too.
    if (rowBytes >= kMaxRowBytes) {
      return SpriteValidationError::InvalidRow;
    }
    ++rowBytes;
    if (value == ' ' || value == '\t') {
      if (!sawToken) {
        // Leading whitespace is trimmed away before the renderer decodes.
        continue;
      }
      // Could be trailing whitespace; only a later token makes it interior.
      ++pendingSpaces;
      continue;
    }
    if (pendingSpaces > 0) {
      // A token after whitespace means that whitespace was interior, which the
      // renderer's RLE decoder rejects.
      return SpriteValidationError::InvalidRow;
    }
    sawToken = true;
    if (value >= '0' && value <= '9') {
      const int digit = value - '0';
      if (runLength > (kMaxSpriteDimension - digit) / 10) {
        return SpriteValidationError::InvalidRow;
      }
      runLength = runLength * 10 + digit;
      hasRunLength = true;
      continue;
    }
    if (!hasRunLength) {
      runLength = 1;
    }
    if (runLength <= 0 || offset + runLength > width) {
      return SpriteValidationError::InvalidRow;
    }
    if (value != '.') {
      if (value < 'a' || value > 'z' || static_cast<int>(value - 'a') >= paletteSize) {
        return SpriteValidationError::InvalidRow;
      }
    }
    offset += runLength;
    runLength = 0;
    hasRunLength = false;
  }
  if (hasRunLength) {
    // A trailing run length without its color token is a truncated row.
    return SpriteValidationError::InvalidRow;
  }
  return offset == width ? SpriteValidationError::None : SpriteValidationError::InvalidRow;
}

}  // namespace

SpriteValidationError ValidateSpriteAsset(
    SpriteReadAtCallback readAt,
    void* context,
    size_t size,
    SpriteValidationInfo* info) {
  if (info != nullptr) {
    *info = SpriteValidationInfo{};
  }
  if (readAt == nullptr || size == 0) {
    return SpriteValidationError::Empty;
  }

  LineReader reader(readAt, context, size);
  char line[kMaxTokenLineBytes] = {0};
  bool overlong = false;

  if (!ReadTrimmedLine(reader, line, sizeof(line), overlong)) {
    return overlong ? SpriteValidationError::UnsupportedHeader : SpriteValidationError::Empty;
  }
  const bool animated = LinesEqual(line, "CBA1");
  if (!animated && !LinesEqual(line, "CBI1")) {
    return SpriteValidationError::UnsupportedHeader;
  }

  if (!ReadTrimmedLine(reader, line, sizeof(line), overlong)) {
    return SpriteValidationError::InvalidDimensions;
  }
  int values[4] = {0, 0, 0, 0};
  const uint8_t valueCount = animated ? 4 : 2;
  // Reuse the renderer's header parser so validation cannot drift from the
  // exact syntax the device accepts at draw time.
  if (!ThemeSpecRuntimePolicy::ParseCbaHeader(line, values, valueCount)) {
    return SpriteValidationError::InvalidDimensions;
  }
  const int width = values[0];
  const int height = values[1];
  const int frameCount = animated ? values[2] : 1;
  const int fps = animated ? values[3] : 0;
  if (width <= 0 || height <= 0 ||
      width > kMaxSpriteDimension || height > kMaxSpriteDimension) {
    return SpriteValidationError::InvalidDimensions;
  }
  if (animated && (frameCount <= 0 || frameCount > kMaxSpriteFrames || fps < 0 || fps > kMaxSpriteFps)) {
    return SpriteValidationError::InvalidDimensions;
  }

  if (!ReadTrimmedLine(reader, line, sizeof(line), overlong)) {
    return SpriteValidationError::InvalidPalette;
  }
  int paletteValue[1] = {0};
  if (!ThemeSpecRuntimePolicy::ParseCbaHeader(line, paletteValue, 1)) {
    return SpriteValidationError::InvalidPalette;
  }
  const int paletteSize = paletteValue[0];
  if (paletteSize <= 0 || paletteSize > kMaxSpritePaletteSize) {
    return SpriteValidationError::InvalidPalette;
  }
  for (int i = 0; i < paletteSize; ++i) {
    if (!ReadTrimmedLine(reader, line, sizeof(line), overlong) || !IsHexColorLine(line)) {
      return SpriteValidationError::InvalidPalette;
    }
  }

  const uint32_t expectedRows =
      static_cast<uint32_t>(height) * static_cast<uint32_t>(frameCount);
  for (uint32_t row = 0; row < expectedRows; ++row) {
    bool sawRow = false;
    const SpriteValidationError error = ValidateRow(reader, width, paletteSize, sawRow);
    if (error != SpriteValidationError::None) {
      return error;
    }
    if (info != nullptr) {
      info->rowCount = row + 1;
    }
  }

  // Trailing bytes mean the stored frame table does not match the header, so
  // the renderer would index frames the file does not really contain.
  while (!reader.AtEnd()) {
    uint8_t value = 0;
    if (!reader.ReadByte(value)) {
      break;
    }
    if (value != '\n' && value != '\r' && value != ' ' && value != '\t') {
      return SpriteValidationError::TrailingData;
    }
  }

  if (info != nullptr) {
    info->animated = animated;
    info->width = width;
    info->height = height;
    info->frameCount = frameCount;
    info->fps = fps;
    info->paletteSize = paletteSize;
  }
  return SpriteValidationError::None;
}

SpriteValidationError ValidateSpriteAssetMemory(
    const uint8_t* bytes,
    size_t size,
    SpriteValidationInfo* info) {
  if (bytes == nullptr) {
    return SpriteValidationError::Empty;
  }
  struct MemorySource {
    const uint8_t* bytes;
    size_t size;
  };
  MemorySource source{bytes, size};
  const SpriteReadAtCallback readAt = [](void* context, size_t offset, uint8_t* destination, size_t length) -> size_t {
    MemorySource* memory = static_cast<MemorySource*>(context);
    if (memory == nullptr || offset >= memory->size) {
      return 0;
    }
    const size_t available = memory->size - offset;
    const size_t copied = length < available ? length : available;
    for (size_t i = 0; i < copied; ++i) {
      destination[i] = memory->bytes[offset + i];
    }
    return copied;
  };
  return ValidateSpriteAsset(readAt, &source, size, info);
}

const char* SpriteValidationErrorText(SpriteValidationError error) {
  switch (error) {
    case SpriteValidationError::None: return "";
    case SpriteValidationError::Empty: return "sprite asset is empty";
    case SpriteValidationError::UnsupportedHeader: return "sprite asset header must be CBI1 or CBA1";
    case SpriteValidationError::InvalidDimensions: return "sprite asset has invalid dimensions";
    case SpriteValidationError::InvalidPalette: return "sprite asset has invalid palette";
    case SpriteValidationError::InvalidRow: return "sprite asset has invalid pixel row";
    case SpriteValidationError::Truncated: return "sprite asset is truncated";
    case SpriteValidationError::TrailingData: return "sprite asset has unexpected trailing data";
  }
  return "invalid sprite asset";
}

}  // namespace esp8266
}  // namespace codexbar_display
