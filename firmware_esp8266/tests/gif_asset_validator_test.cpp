#include <cstdio>
#include <fstream>
#include <iterator>
#include <string>
#include <vector>

#include "../src/gif_asset_validator.h"

namespace {

using codexbar_display::esp8266::GifValidationError;
using codexbar_display::esp8266::GifValidationInfo;
using codexbar_display::esp8266::ValidateGifAssetMemory;
using codexbar_display::esp8266::kMaxThemeGifLzwBits;

bool expect(bool condition, const char* message) {
  if (!condition) {
    std::fprintf(stderr, "FAIL: %s\n", message);
    return false;
  }
  return true;
}

const char* errorName(GifValidationError error) {
  switch (error) {
    case GifValidationError::None: return "none";
    case GifValidationError::Invalid: return "invalid";
    case GifValidationError::LzwCodeSizeExceeded: return "lzw_code_size_exceeded";
  }
  return "unknown";
}

void appendCode(std::vector<uint8_t>& bytes, uint32_t& bits, uint8_t& bitCount, uint16_t code, uint8_t width) {
  bits |= static_cast<uint32_t>(code) << bitCount;
  bitCount += width;
  while (bitCount >= 8) {
    bytes.push_back(static_cast<uint8_t>(bits & 0xFFU));
    bits >>= 8;
    bitCount -= 8;
  }
}

std::vector<uint8_t> packFixedWidthCodes(const std::vector<uint16_t>& codes, uint8_t width) {
  std::vector<uint8_t> bytes;
  uint32_t bits = 0;
  uint8_t bitCount = 0;
  for (uint16_t code : codes) {
    appendCode(bytes, bits, bitCount, code, width);
  }
  if (bitCount > 0) {
    bytes.push_back(static_cast<uint8_t>(bits));
  }
  return bytes;
}

std::vector<uint8_t> growingTwelveBitStream() {
  std::vector<uint8_t> bytes;
  uint32_t bits = 0;
  uint8_t bitCount = 0;
  uint8_t width = 3;
  uint16_t nextCode = 6;
  appendCode(bytes, bits, bitCount, 4, width);  // clear
  appendCode(bytes, bits, bitCount, 0, width);  // first literal
  while (width <= kMaxThemeGifLzwBits) {
    appendCode(bytes, bits, bitCount, 0, width);
    ++nextCode;
    if (nextCode >= static_cast<uint16_t>(1U << width) && width < 12) {
      ++width;
    }
  }
  appendCode(bytes, bits, bitCount, 5, width);  // EOI encoded at 12 bits
  if (bitCount > 0) {
    bytes.push_back(static_cast<uint8_t>(bits));
  }
  return bytes;
}

std::vector<uint8_t> gifWithLzw(
    const std::vector<uint8_t>& lzwBytes,
    uint16_t width = 1,
    uint16_t height = 1,
    uint8_t imagePacked = 0) {
  std::vector<uint8_t> gif = {
      'G', 'I', 'F', '8', '9', 'a',
      static_cast<uint8_t>(width), static_cast<uint8_t>(width >> 8),
      static_cast<uint8_t>(height), static_cast<uint8_t>(height >> 8), 0x80, 0, 0,
      0, 0, 0, 255, 255, 255,
      0x2C, 0, 0, 0, 0,
      static_cast<uint8_t>(width), static_cast<uint8_t>(width >> 8),
      static_cast<uint8_t>(height), static_cast<uint8_t>(height >> 8), imagePacked,
      2};
  size_t offset = 0;
  while (offset < lzwBytes.size()) {
    const size_t remaining = lzwBytes.size() - offset;
    const uint8_t length = static_cast<uint8_t>(remaining > 255 ? 255 : remaining);
    gif.push_back(length);
    gif.insert(gif.end(), lzwBytes.begin() + offset, lzwBytes.begin() + offset + length);
    offset += length;
  }
  gif.push_back(0);
  gif.push_back(0x3B);
  return gif;
}

GifValidationError validate(const std::vector<uint8_t>& gif, GifValidationInfo* info = nullptr) {
  return ValidateGifAssetMemory(gif.data(), gif.size(), kMaxThemeGifLzwBits, info);
}

bool expectError(const std::vector<uint8_t>& gif, GifValidationError expected, const char* message) {
  const GifValidationError actual = validate(gif);
  if (actual != expected) {
    std::fprintf(
        stderr,
        "FAIL: %s (expected %s, got %s)\n",
        message,
        errorName(expected),
        errorName(actual));
    return false;
  }
  return true;
}

bool testProfileAndMalformedStreams() {
  GifValidationInfo info;
  const std::vector<uint8_t> valid = gifWithLzw(packFixedWidthCodes({4, 0, 5}, 3));
  if (!expectError(valid, GifValidationError::None, "valid three-bit GIF must pass")) return false;
  if (!expect(validate(valid, &info) == GifValidationError::None &&
              info.width == 1 && info.height == 1,
              "valid GIF metadata must be reported")) return false;

  if (!expectError(
          gifWithLzw(growingTwelveBitStream(), 2043, 1),
          GifValidationError::LzwCodeSizeExceeded,
          "stream requiring twelve-bit codes must be rejected")) return false;
  if (!expectError(
          gifWithLzw(packFixedWidthCodes({0, 5}, 3)),
          GifValidationError::Invalid,
          "missing clear code must be rejected")) return false;
  if (!expectError(
          gifWithLzw(packFixedWidthCodes({4, 0}, 3)),
          GifValidationError::Invalid,
          "missing EOI code must be rejected")) return false;

  if (!expectError(
          gifWithLzw(packFixedWidthCodes({4, 0, 5}, 3), 2, 2),
          GifValidationError::Invalid,
          "EOI before the complete raster must be rejected")) return false;
  if (!expectError(
          gifWithLzw(packFixedWidthCodes({4, 0, 0, 5}, 3)),
          GifValidationError::Invalid,
          "pixels beyond the declared raster must be rejected")) return false;
  if (!expectError(
          gifWithLzw(packFixedWidthCodes({4, 0, 6, 5}, 3), 3, 1),
          GifValidationError::None,
          "KwKwK output length must be counted exactly")) return false;
  if (!expectError(
          gifWithLzw(packFixedWidthCodes({4, 0, 4, 0, 4, 0, 4, 0, 5}, 3), 2, 2, 0x40),
          GifValidationError::None,
          "clear codes and interlacing must preserve exact raster accounting")) return false;

  std::vector<uint8_t> truncated = valid;
  truncated[30] = 3;
  if (!expectError(truncated, GifValidationError::Invalid, "truncated sub-block must be rejected")) return false;

  std::vector<uint8_t> malformed = valid;
  malformed[19] = 0x7F;
  if (!expectError(malformed, GifValidationError::Invalid, "unknown block must be rejected")) return false;

  std::vector<uint8_t> missingTrailer = valid;
  missingTrailer.pop_back();
  if (!expectError(missingTrailer, GifValidationError::Invalid, "missing trailer must be rejected")) return false;
  return true;
}

bool testRepositoryMiniGif(const char* path) {
  std::ifstream input(path, std::ios::binary);
  const std::vector<uint8_t> bytes{
      std::istreambuf_iterator<char>(input),
      std::istreambuf_iterator<char>()};
  if (!expect(!bytes.empty(), "Mini Classic GIF must be readable")) return false;
  GifValidationInfo info;
  const GifValidationError error = validate(bytes, &info);
  if (error != GifValidationError::None) {
    std::fprintf(stderr, "FAIL: Mini Classic GIF rejected: %s\n", errorName(error));
    return false;
  }
  return expect(
      info.width == 80 && info.height == 80,
      "Mini Classic GIF must remain an 80x80 asset within the 11-bit profile");
}

}  // namespace

int main(int argc, char** argv) {
  if (!expect(argc == 2, "Mini Classic GIF path is required")) return 1;
  if (!testProfileAndMalformedStreams()) return 1;
  if (!testRepositoryMiniGif(argv[1])) return 1;
  std::printf("ok: gif_asset_validator_test\n");
  return 0;
}
