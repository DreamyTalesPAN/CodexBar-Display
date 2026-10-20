#pragma once

#include <cstddef>
#include <cstdint>

namespace codexbar_display {
namespace esp8266 {

// Issue #652: the ESP8266 Updater only checks the 0xE9 magic and the
// flash-size nibble. An ESP32 image passes both, is copied over the sketch and
// the VibeTV stays dark. The first bytes of an upload decide before any byte
// is staged.
//
// Accepted: a raw ESP8266 image (entry address in the ESP8266 IRAM,
// 0x40100000 to 0x4010FFFF) and a gzip image (.bin.gz, unpacked by eboot at
// boot; its inner header is not visible here). Every ESP32 family chip enters
// elsewhere (ESP32 0x4008xxxx, S3 0x4037xxxx, C3 0x4038xxxx).
inline bool IsEsp8266FirmwareImageStart(const uint8_t* data, std::size_t length) {
  if (data == nullptr || length < 2) {
    return false;
  }
  if (data[0] == 0x1F && data[1] == 0x8B) {
    return true;
  }
  if (data[0] != 0xE9 || length < 8) {
    return false;
  }
  const uint32_t entry = static_cast<uint32_t>(data[4]) |
                         (static_cast<uint32_t>(data[5]) << 8) |
                         (static_cast<uint32_t>(data[6]) << 16) |
                         (static_cast<uint32_t>(data[7]) << 24);
  return entry >= 0x40100000UL && entry < 0x40110000UL;
}

}  // namespace esp8266
}  // namespace codexbar_display
