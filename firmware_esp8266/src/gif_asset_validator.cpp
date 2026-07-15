#include "gif_asset_validator.h"

#include <stdlib.h>
#include <string.h>

namespace codexbar_display {
namespace esp8266 {
namespace {

class Reader {
 public:
  Reader(GifReadAtCallback readAt, void* context, size_t size)
      : readAt_(readAt), context_(context), size_(size) {}

  bool ReadByte(uint8_t& value) {
    if (position_ >= size_) {
      return false;
    }
    if (position_ < cacheOffset_ || position_ >= cacheOffset_ + cacheLength_) {
      cacheOffset_ = position_;
      const size_t requested = size_ - position_ < sizeof(cache_) ? size_ - position_ : sizeof(cache_);
      cacheLength_ = readAt_ != nullptr ? readAt_(context_, cacheOffset_, cache_, requested) : 0;
      if (cacheLength_ == 0) {
        return false;
      }
    }
    value = cache_[position_ - cacheOffset_];
    ++position_;
    return true;
  }

  bool ReadLittleEndian16(uint16_t& value) {
    uint8_t low = 0;
    uint8_t high = 0;
    if (!ReadByte(low) || !ReadByte(high)) {
      return false;
    }
    value = static_cast<uint16_t>(low | (static_cast<uint16_t>(high) << 8));
    return true;
  }

  bool Skip(size_t count) {
    if (count > size_ - position_) {
      position_ = size_;
      return false;
    }
    position_ += count;
    return true;
  }

 private:
  GifReadAtCallback readAt_ = nullptr;
  void* context_ = nullptr;
  size_t size_ = 0;
  size_t position_ = 0;
  size_t cacheOffset_ = 0;
  size_t cacheLength_ = 0;
  uint8_t cache_[64] = {0};
};

bool SkipSubBlocks(Reader& reader) {
  while (true) {
    uint8_t length = 0;
    if (!reader.ReadByte(length)) {
      return false;
    }
    if (length == 0) {
      return true;
    }
    if (!reader.Skip(length)) {
      return false;
    }
  }
}

class LzwSubBlockBits {
 public:
  explicit LzwSubBlockBits(Reader& reader) : reader_(reader) {}

  bool ReadCode(uint8_t width, uint16_t& code) {
    while (bitCount_ < width) {
      uint8_t byte = 0;
      if (!ReadDataByte(byte)) {
        return false;
      }
      bits_ |= static_cast<uint32_t>(byte) << bitCount_;
      bitCount_ += 8;
    }
    code = static_cast<uint16_t>(bits_ & ((1UL << width) - 1UL));
    bits_ >>= width;
    bitCount_ -= width;
    return true;
  }

  bool Finish() {
    bitCount_ = 0;
    bits_ = 0;
    if (terminated_) {
      return true;
    }
    if (bytesRemaining_ > 0 && !reader_.Skip(bytesRemaining_)) {
      return false;
    }
    bytesRemaining_ = 0;
    while (true) {
      uint8_t length = 0;
      if (!reader_.ReadByte(length)) {
        return false;
      }
      if (length == 0) {
        terminated_ = true;
        return true;
      }
      if (!reader_.Skip(length)) {
        return false;
      }
    }
  }

  bool terminated() const { return terminated_; }

 private:
  bool ReadDataByte(uint8_t& value) {
    while (bytesRemaining_ == 0) {
      uint8_t length = 0;
      if (!reader_.ReadByte(length)) {
        return false;
      }
      if (length == 0) {
        terminated_ = true;
        return false;
      }
      bytesRemaining_ = length;
    }
    if (!reader_.ReadByte(value)) {
      return false;
    }
    --bytesRemaining_;
    return true;
  }

  Reader& reader_;
  uint32_t bits_ = 0;
  uint8_t bitCount_ = 0;
  uint16_t bytesRemaining_ = 0;
  bool terminated_ = false;
};

GifValidationError ValidateLzwStream(
    Reader& reader,
    uint8_t minimumCodeSize,
    uint8_t maxAllowedBits,
    uint32_t expectedPixels,
    uint16_t* codeLengths) {
  if (minimumCodeSize < 2 || minimumCodeSize > 8) {
    return GifValidationError::Invalid;
  }

  const uint16_t clearCode = static_cast<uint16_t>(1U << minimumCodeSize);
  const uint16_t endCode = static_cast<uint16_t>(clearCode + 1U);
  uint16_t nextCode = static_cast<uint16_t>(clearCode + 2U);
  uint8_t codeSize = static_cast<uint8_t>(minimumCodeSize + 1U);
  bool havePreviousCode = false;
  bool sawClearCode = false;
  bool sawDataCode = false;
  uint16_t previousLength = 0;
  uint32_t emittedPixels = 0;
  LzwSubBlockBits bits(reader);

  while (true) {
    if (codeSize > 12 || codeSize > maxAllowedBits) {
      return GifValidationError::LzwCodeSizeExceeded;
    }
    uint16_t code = 0;
    if (!bits.ReadCode(codeSize, code)) {
      return GifValidationError::Invalid;
    }

    if (code == clearCode) {
      sawClearCode = true;
      nextCode = static_cast<uint16_t>(clearCode + 2U);
      codeSize = static_cast<uint8_t>(minimumCodeSize + 1U);
      havePreviousCode = false;
      previousLength = 0;
      continue;
    }
    if (!sawClearCode) {
      return GifValidationError::Invalid;
    }
    if (code == endCode) {
      if (!sawDataCode || emittedPixels != expectedPixels) {
        return GifValidationError::Invalid;
      }
      return bits.Finish() ? GifValidationError::None : GifValidationError::Invalid;
    }

    if (!havePreviousCode) {
      if (code >= clearCode) {
        return GifValidationError::Invalid;
      }
      havePreviousCode = true;
      sawDataCode = true;
      previousLength = 1;
      if (emittedPixels >= expectedPixels) {
        return GifValidationError::Invalid;
      }
      ++emittedPixels;
      continue;
    }

    if (code > nextCode) {
      return GifValidationError::Invalid;
    }
    uint16_t outputLength = 0;
    if (code < clearCode) {
      outputLength = 1;
    } else if (code < nextCode) {
      outputLength = codeLengths[code];
    } else {
      outputLength = static_cast<uint16_t>(previousLength + 1U);  // KwKwK
    }
    if (outputLength == 0 || emittedPixels > expectedPixels ||
        outputLength > expectedPixels - emittedPixels) {
      return GifValidationError::Invalid;
    }
    emittedPixels += outputLength;
    if (nextCode < 4096U) {
      codeLengths[nextCode] = static_cast<uint16_t>(previousLength + 1U);
      ++nextCode;
      if (nextCode >= static_cast<uint16_t>(1U << codeSize) && codeSize < 12U) {
        ++codeSize;
      }
    }
    previousLength = outputLength;
    sawDataCode = true;
  }
}

size_t MemoryReadAt(void* context, size_t offset, uint8_t* destination, size_t length) {
  const uint8_t* bytes = static_cast<const uint8_t*>(context);
  memcpy(destination, bytes + offset, length);
  return length;
}

}  // namespace

GifValidationError ValidateGifAsset(
    GifReadAtCallback readAt,
    void* context,
    size_t size,
    uint8_t maxLzwBits,
    GifValidationInfo* info) {
  GifValidationInfo localInfo;
  if (info == nullptr) {
    info = &localInfo;
  }
  *info = GifValidationInfo();
  if (readAt == nullptr) {
    return GifValidationError::Invalid;
  }
  if (maxLzwBits < 3 || maxLzwBits > 12) {
    return GifValidationError::LzwCodeSizeExceeded;
  }

  const size_t codeLengthCount = static_cast<size_t>(1U << maxLzwBits);
  uint16_t* codeLengths = static_cast<uint16_t*>(malloc(codeLengthCount * sizeof(uint16_t)));
  if (codeLengths == nullptr) {
    return GifValidationError::Invalid;
  }
  struct CodeLengthCleanup {
    uint16_t* values;
    ~CodeLengthCleanup() { free(values); }
  } cleanup{codeLengths};

  Reader reader(readAt, context, size);
  bool sawFrame = false;
  uint8_t signature[6] = {0};
  for (uint8_t& byte : signature) {
    if (!reader.ReadByte(byte)) {
      return GifValidationError::Invalid;
    }
  }
  if (memcmp(signature, "GIF87a", 6) != 0 && memcmp(signature, "GIF89a", 6) != 0) {
    return GifValidationError::Invalid;
  }
  if (!reader.ReadLittleEndian16(info->width) || !reader.ReadLittleEndian16(info->height)) {
    return GifValidationError::Invalid;
  }
  if (info->width == 0 || info->height == 0) {
    return GifValidationError::Invalid;
  }

  uint8_t packed = 0;
  uint8_t ignored = 0;
  if (!reader.ReadByte(packed) || !reader.ReadByte(ignored) || !reader.ReadByte(ignored)) {
    return GifValidationError::Invalid;
  }
  if ((packed & 0x80U) != 0) {
    const size_t colorTableBytes = static_cast<size_t>(3U << ((packed & 0x07U) + 1U));
    if (!reader.Skip(colorTableBytes)) {
      return GifValidationError::Invalid;
    }
  }

  while (true) {
    uint8_t introducer = 0;
    if (!reader.ReadByte(introducer)) {
      return GifValidationError::Invalid;
    }
    if (introducer == 0x3BU) {
      return sawFrame ? GifValidationError::None : GifValidationError::Invalid;
    }
    if (introducer == 0x21U) {
      uint8_t extensionLabel = 0;
      if (!reader.ReadByte(extensionLabel) || !SkipSubBlocks(reader)) {
        return GifValidationError::Invalid;
      }
      continue;
    }
    if (introducer != 0x2CU) {
      return GifValidationError::Invalid;
    }

    uint16_t left = 0;
    uint16_t top = 0;
    uint16_t width = 0;
    uint16_t height = 0;
    if (!reader.ReadLittleEndian16(left) || !reader.ReadLittleEndian16(top) ||
        !reader.ReadLittleEndian16(width) || !reader.ReadLittleEndian16(height) ||
        !reader.ReadByte(packed)) {
      return GifValidationError::Invalid;
    }
    if (width == 0 || height == 0 || left > info->width || top > info->height ||
        width > info->width - left || height > info->height - top) {
      return GifValidationError::Invalid;
    }
    if ((packed & 0x80U) != 0) {
      const size_t colorTableBytes = static_cast<size_t>(3U << ((packed & 0x07U) + 1U));
      if (!reader.Skip(colorTableBytes)) {
        return GifValidationError::Invalid;
      }
    }

    uint8_t minimumCodeSize = 0;
    if (!reader.ReadByte(minimumCodeSize)) {
      return GifValidationError::Invalid;
    }
    const uint32_t expectedPixels = static_cast<uint32_t>(width) * static_cast<uint32_t>(height);
    const GifValidationError lzwError =
        ValidateLzwStream(reader, minimumCodeSize, maxLzwBits, expectedPixels, codeLengths);
    if (lzwError != GifValidationError::None) {
      return lzwError;
    }
    sawFrame = true;
  }
}

GifValidationError ValidateGifAssetMemory(
    const uint8_t* bytes,
    size_t size,
    uint8_t maxLzwBits,
    GifValidationInfo* info) {
  if (bytes == nullptr && size != 0) {
    return GifValidationError::Invalid;
  }
  return ValidateGifAsset(MemoryReadAt, const_cast<uint8_t*>(bytes), size, maxLzwBits, info);
}

}  // namespace esp8266
}  // namespace codexbar_display
