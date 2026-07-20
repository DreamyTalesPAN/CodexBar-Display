#pragma once

#include <Arduino.h>

namespace codexbar_display {
namespace esp8266 {
namespace wifi_setup {

constexpr char kSetupQrPayload[] = "WIFI:T:nopass;S:VibeTV-Setup;;";
constexpr uint8_t kSetupQrModules = 29;
constexpr uint8_t kSetupQrQuietZoneModules = 4;

// QR Code Model 2, error correction M. Each bit is one dark module.
const uint32_t kSetupQrRows[kSetupQrModules] PROGMEM = {
    0x1fd6177f, 0x10591641, 0x175fa25d, 0x1757cd5d, 0x1749755d,
    0x105ee141, 0x1fd5557f, 0x00165900, 0x13ebf9d1, 0x03ec1d38,
    0x1376f8c2, 0x0897a482, 0x089a38dd, 0x03e17c0a, 0x14270273,
    0x128a5712, 0x143be3c4, 0x05a00435, 0x10f6f45c, 0x0087a720,
    0x09f23e4b, 0x0b196300, 0x155b1d7f, 0x0b1a5041, 0x1bfef55d,
    0x088a0a5d, 0x1c08d45d, 0x1b2f5641, 0x0ad7f37f,
};

inline bool SetupQrModuleIsDark(uint8_t row, uint8_t column) {
  if (row >= kSetupQrModules || column >= kSetupQrModules) {
    return false;
  }
  const uint32_t bits = pgm_read_dword(&kSetupQrRows[row]);
  return ((bits >> column) & 1U) != 0;
}

}  // namespace wifi_setup
}  // namespace esp8266
}  // namespace codexbar_display
