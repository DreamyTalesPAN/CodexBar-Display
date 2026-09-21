#include <cstdio>
#include <fstream>
#include <iterator>
#include <string>
#include <vector>

#include "../src/sprite_asset_validator.h"

namespace {

using codexbar_display::esp8266::SpriteValidationError;
using codexbar_display::esp8266::SpriteValidationInfo;
using codexbar_display::esp8266::ValidateSpriteAssetMemory;

bool expect(bool condition, const char* message) {
  if (!condition) {
    std::fprintf(stderr, "FAIL: %s\n", message);
    return false;
  }
  return true;
}

SpriteValidationError validate(const std::string& text, SpriteValidationInfo* info = nullptr) {
  return ValidateSpriteAssetMemory(
      reinterpret_cast<const uint8_t*>(text.data()), text.size(), info);
}

// 4x2 static sprite, two palette colors, fully covered RLE rows.
std::string validStaticSprite() {
  return "CBI1\n4 2\n2\n#FF0000\n#00FF00\n4a\n2a2b\n";
}

// 2x2 animated sprite with two frames.
std::string validAnimatedSprite() {
  return "CBA1\n2 2 2 4\n2\n#FF0000\n#00FF00\n2a\n2b\n2b\n2a\n";
}

bool testValidSpritesAreAccepted() {
  SpriteValidationInfo staticInfo;
  if (!expect(
          validate(validStaticSprite(), &staticInfo) == SpriteValidationError::None,
          "a well-formed CBI1 sprite must validate")) {
    return false;
  }
  if (!expect(
          !staticInfo.animated && staticInfo.width == 4 && staticInfo.height == 2 &&
              staticInfo.frameCount == 1 && staticInfo.paletteSize == 2 &&
              staticInfo.rowCount == 2,
          "CBI1 metadata must be reported")) {
    return false;
  }

  SpriteValidationInfo animatedInfo;
  if (!expect(
          validate(validAnimatedSprite(), &animatedInfo) == SpriteValidationError::None,
          "a well-formed CBA1 sprite must validate")) {
    return false;
  }
  return expect(
      animatedInfo.animated && animatedInfo.width == 2 && animatedInfo.height == 2 &&
          animatedInfo.frameCount == 2 && animatedInfo.fps == 4 &&
          animatedInfo.rowCount == 4,
      "CBA1 metadata must cover every frame row");
}

bool testCarriageReturnsAndTrailingNewlineAreTolerated() {
  if (!expect(
          validate("CBI1\r\n4 2\r\n2\r\n#FF0000\r\n#00FF00\r\n4a\r\n2a2b\r\n") ==
              SpriteValidationError::None,
          "CRLF sprites must validate like LF sprites")) {
    return false;
  }
  return expect(
      validate("CBI1\n4 2\n2\n#FF0000\n#00FF00\n4a\n2a2b") == SpriteValidationError::None,
      "a missing final newline must still validate");
}

bool testTruncationIsRejected() {
  // Half-transferred upload: the frame table promises rows the file lacks.
  if (!expect(
          validate("CBI1\n4 2\n2\n#FF0000\n#00FF00\n4a\n") == SpriteValidationError::Truncated,
          "a CBI1 sprite missing a whole row must be rejected")) {
    return false;
  }
  if (!expect(
          validate("CBA1\n2 2 2 4\n2\n#FF0000\n#00FF00\n2a\n2b\n2b\n") ==
              SpriteValidationError::Truncated,
          "a CBA1 sprite missing its last frame row must be rejected")) {
    return false;
  }
  if (!expect(
          validate("CBI1\n4 2\n2\n#FF0000\n") == SpriteValidationError::InvalidPalette,
          "a sprite truncated inside its palette must be rejected")) {
    return false;
  }
  if (!expect(validate("") == SpriteValidationError::Empty, "an empty asset must be rejected")) {
    return false;
  }
  // A row that ends after a run length but before its color token.
  return expect(
      validate("CBI1\n4 2\n2\n#FF0000\n#00FF00\n4a\n2a2\n") == SpriteValidationError::InvalidRow,
      "a row ending on a dangling run length must be rejected");
}

bool testWrongHeaderIsRejected() {
  if (!expect(
          validate("CBI2\n4 2\n2\n#FF0000\n#00FF00\n4a\n2a2b\n") ==
              SpriteValidationError::UnsupportedHeader,
          "an unknown sprite magic must be rejected")) {
    return false;
  }
  if (!expect(
          validate("GIF89a") == SpriteValidationError::UnsupportedHeader,
          "a GIF uploaded under a sprite path must be rejected")) {
    return false;
  }
  // CBA payload stored with a static header: the renderer would read the frame
  // count as part of the first row and draw garbage.
  return expect(
      validate("CBI1\n2 2 2 4\n2\n#FF0000\n#00FF00\n2a\n2b\n") ==
          SpriteValidationError::InvalidDimensions,
      "a CBA header stored as CBI1 must be rejected");
}

bool testImplausibleDimensionsAreRejected() {
  if (!expect(
          validate("CBI1\n0 2\n2\n#FF0000\n#00FF00\n4a\n2a2b\n") ==
              SpriteValidationError::InvalidDimensions,
          "a zero width must be rejected")) {
    return false;
  }
  if (!expect(
          validate("CBI1\n4 0\n2\n#FF0000\n#00FF00\n4a\n") ==
              SpriteValidationError::InvalidDimensions,
          "a zero height must be rejected")) {
    return false;
  }
  if (!expect(
          validate("CBI1\n99999 2\n2\n#FF0000\n#00FF00\n4a\n2a2b\n") ==
              SpriteValidationError::InvalidDimensions,
          "an oversized width must be rejected")) {
    return false;
  }
  // Integer overflow attempt: the header value does not fit the parser.
  if (!expect(
          validate("CBI1\n4294967296 2\n2\n#FF0000\n#00FF00\n4a\n2a2b\n") ==
              SpriteValidationError::InvalidDimensions,
          "a width beyond int range must be rejected")) {
    return false;
  }
  if (!expect(
          validate("CBA1\n2 2 0 4\n2\n#FF0000\n#00FF00\n2a\n2b\n") ==
              SpriteValidationError::InvalidDimensions,
          "a zero frame count must be rejected")) {
    return false;
  }
  if (!expect(
          validate("CBA1\n2 2 65 4\n2\n#FF0000\n#00FF00\n2a\n2b\n") ==
              SpriteValidationError::InvalidDimensions,
          "a frame count above the renderer limit must be rejected")) {
    return false;
  }
  if (!expect(
          validate("CBA1\n2 2 2 31\n2\n#FF0000\n#00FF00\n2a\n2b\n2b\n2a\n") ==
              SpriteValidationError::InvalidDimensions,
          "an fps above the renderer limit must be rejected")) {
    return false;
  }
  return expect(
      validate("CBI1\n4\n2\n#FF0000\n#00FF00\n4a\n2a2b\n") ==
          SpriteValidationError::InvalidDimensions,
      "a CBI1 header missing its height must be rejected");
}

bool testInvalidPaletteIsRejected() {
  if (!expect(
          validate("CBI1\n4 2\n0\n4a\n2a2b\n") == SpriteValidationError::InvalidPalette,
          "an empty palette must be rejected")) {
    return false;
  }
  if (!expect(
          validate("CBI1\n4 2\n27\n#FF0000\n") == SpriteValidationError::InvalidPalette,
          "a palette above 26 colors must be rejected")) {
    return false;
  }
  return expect(
      validate("CBI1\n4 2\n2\n#FF0000\nnotacolor\n4a\n2a2b\n") ==
          SpriteValidationError::InvalidPalette,
      "a malformed palette color must be rejected");
}

bool testInvalidRowsAreRejected() {
  // Same byte count as the valid sprite, but the rows no longer cover the row
  // width. Content hashes cannot catch this class of damage.
  if (!expect(
          validate("CBI1\n4 2\n2\n#FF0000\n#00FF00\n3a\n2a2b\n") ==
              SpriteValidationError::InvalidRow,
          "a row narrower than the declared width must be rejected")) {
    return false;
  }
  if (!expect(
          validate("CBI1\n4 2\n2\n#FF0000\n#00FF00\n5a\n2a2b\n") ==
              SpriteValidationError::InvalidRow,
          "a row wider than the declared width must be rejected")) {
    return false;
  }
  if (!expect(
          validate("CBI1\n4 2\n2\n#FF0000\n#00FF00\n4c\n2a2b\n") ==
              SpriteValidationError::InvalidRow,
          "a token outside the palette must be rejected")) {
    return false;
  }
  if (!expect(
          validate("CBI1\n4 2\n2\n#FF0000\n#00FF00\n4A\n2a2b\n") ==
              SpriteValidationError::InvalidRow,
          "an out-of-range token character must be rejected")) {
    return false;
  }
  // Transparent runs are legal and must stay legal.
  return expect(
      validate("CBI1\n4 2\n2\n#FF0000\n#00FF00\n2a2.\n4.\n") == SpriteValidationError::None,
      "transparent runs must remain valid");
}

// readSpriteLine() in the renderer refuses any row longer than 512 bytes, so a
// longer row must be rejected at upload instead of being promoted and then
// failing on the device as cbi_truncated.
bool testOverlongRowsAreRejected() {
  std::string wide = "CBI1\n480 1\n2\n#FF0000\n#00FF00\n";
  // 480 single-pixel runs cover the declared width but need 960 row bytes.
  for (int i = 0; i < 480; ++i) {
    wide += "1a";
  }
  wide += "\n";
  if (!expect(
          validate(wide) == SpriteValidationError::InvalidRow,
          "a row the renderer cannot read must be rejected")) {
    return false;
  }
  // A row just inside the limit stays valid, so the check cannot reject
  // shippable assets.
  std::string near = "CBI1\n255 1\n2\n#FF0000\n#00FF00\n";
  for (int i = 0; i < 255; ++i) {
    near += "1a";
  }
  near += "\n";
  return expect(
      validate(near) == SpriteValidationError::None,
      "a row within the renderer's line limit must stay valid");
}

bool testInconsistentFrameTablesAreRejected() {
  // The header promises two frames but the payload only contains one.
  if (!expect(
          validate("CBA1\n2 2 2 4\n2\n#FF0000\n#00FF00\n2a\n2b\n") ==
              SpriteValidationError::Truncated,
          "a CBA1 frame table larger than the payload must be rejected")) {
    return false;
  }
  // The payload contains more rows than the frame table describes, so the
  // renderer would index offsets that do not match the stored frames.
  return expect(
      validate("CBA1\n2 2 1 4\n2\n#FF0000\n#00FF00\n2a\n2b\n2a\n") ==
          SpriteValidationError::TrailingData,
      "extra frame rows beyond the frame table must be rejected");
}

bool testShippedThemePackAssetsValidate(int argc, char** argv) {
  if (!expect(argc > 1, "shipped sprite asset paths are required")) {
    return false;
  }
  for (int i = 1; i < argc; ++i) {
    std::ifstream input(argv[i], std::ios::binary);
    if (!expect(input.good(), "shipped sprite asset must be readable")) {
      std::fprintf(stderr, "  path: %s\n", argv[i]);
      return false;
    }
    const std::vector<uint8_t> bytes(
        (std::istreambuf_iterator<char>(input)), std::istreambuf_iterator<char>());
    SpriteValidationInfo info;
    const SpriteValidationError error =
        ValidateSpriteAssetMemory(bytes.data(), bytes.size(), &info);
    if (error != SpriteValidationError::None) {
      std::fprintf(
          stderr,
          "FAIL: shipped sprite asset must validate: %s (error=%d)\n",
          argv[i],
          static_cast<int>(error));
      return false;
    }
  }
  return true;
}

}  // namespace

int main(int argc, char** argv) {
  if (!testValidSpritesAreAccepted()) {
    return 1;
  }
  if (!testCarriageReturnsAndTrailingNewlineAreTolerated()) {
    return 1;
  }
  if (!testTruncationIsRejected()) {
    return 1;
  }
  if (!testWrongHeaderIsRejected()) {
    return 1;
  }
  if (!testImplausibleDimensionsAreRejected()) {
    return 1;
  }
  if (!testInvalidPaletteIsRejected()) {
    return 1;
  }
  if (!testInvalidRowsAreRejected()) {
    return 1;
  }
  if (!testOverlongRowsAreRejected()) {
    return 1;
  }
  if (!testInconsistentFrameTablesAreRejected()) {
    return 1;
  }
  if (!testShippedThemePackAssetsValidate(argc, argv)) {
    return 1;
  }
  std::printf("sprite asset validator tests passed\n");
  return 0;
}
