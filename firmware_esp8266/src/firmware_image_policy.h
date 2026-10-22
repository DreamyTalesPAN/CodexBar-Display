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
// Accepted: a raw ESP8266 image only (entry address in the ESP8266 IRAM,
// 0x40100000 to 0x4010FFFF). Every ESP32 family chip enters elsewhere (ESP32
// 0x4008xxxx, S3 0x4037xxxx, C3 0x4038xxxx). A gzip image (.bin.gz) is refused
// here: its inner header is not visible before the write, so a gzipped ESP32
// image would pass, and the Companion unpacks .bin.gz before a WiFi upload
// anyway (downloadManifestFirmwareArtifact); only the Cable path sends .gz
// (Codex review on #828).
inline bool IsEsp8266FirmwareImageStart(const uint8_t* data, std::size_t length) {
  if (data == nullptr || length < 8) {
    return false;
  }
  if (data[0] != 0xE9) {
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
