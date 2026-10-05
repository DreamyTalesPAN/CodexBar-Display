#pragma once

namespace codexbar_display::esp8266 {

struct WifiSecurityPolicy {
  static bool AllowsCredentialWrite(
      bool setupMode,
      bool devicePaired,
      bool deviceTokenValid) {
    return setupMode || (devicePaired && deviceTokenValid);
  }

  static bool AllowsFirmwareUpload(bool devicePaired, bool deviceTokenValid) {
    return devicePaired && deviceTokenValid;
  }
};

}  // namespace codexbar_display::esp8266
