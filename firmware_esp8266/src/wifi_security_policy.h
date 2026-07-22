#pragma once

namespace codexbar_display::esp8266 {

struct WifiSecurityPolicy {
  static bool AllowsCredentialWrite(
      bool physicalSetupAuthorized,
      bool setupTokenValid,
      bool devicePaired,
      bool deviceTokenValid) {
    return (physicalSetupAuthorized && setupTokenValid) ||
        (devicePaired && deviceTokenValid);
  }

  static bool AllowsPairing(
      bool devicePaired,
      bool deviceTokenValid,
      bool physicalPairingWindowOpen) {
    return (devicePaired && deviceTokenValid) || physicalPairingWindowOpen;
  }
};

}  // namespace codexbar_display::esp8266
