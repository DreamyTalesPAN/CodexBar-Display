#pragma once

#include <cstdint>

namespace codexbar_display::esp8266 {

enum class WifiOtaRecoveryRoute : uint8_t {
  None,
  AuthenticatedUpload,
  PairThenUpload,
  SetupThenPairThenUpload,
  PhysicalRecoveryThenPairThenUpload,
};

struct WifiOtaRecoveryState {
  bool stationReachable = false;
  bool setupAccessPointActive = false;
  bool setupAccessPointFallbackAvailable = false;
  bool devicePaired = false;
  bool currentTokenValid = false;
  bool pairingWindowOpen = false;
  bool physicalRecoveryAvailable = false;
};

struct WifiSecurityPolicy {
  static constexpr uint32_t kPowerOnReset = 0;
  static constexpr uint32_t kExternalSystemReset = 6;

  static bool AllowsCredentialWrite(
      bool setupMode,
      bool devicePaired,
      bool deviceTokenValid) {
    return setupMode || (devicePaired && deviceTokenValid);
  }

  static bool AllowsPairing(
      bool devicePaired,
      bool deviceTokenValid,
      bool physicalPairingWindowOpen) {
    return (devicePaired && deviceTokenValid) || physicalPairingWindowOpen;
  }

  static bool AllowsFirmwareUpload(bool devicePaired, bool deviceTokenValid) {
    return devicePaired && deviceTokenValid;
  }

  static bool CountsAsPhysicalRecoveryReset(uint32_t resetReason) {
    return resetReason == kPowerOnReset || resetReason == kExternalSystemReset;
  }

  static WifiOtaRecoveryRoute OtaRecoveryRoute(const WifiOtaRecoveryState& state) {
    const bool networkPathAvailable = state.stationReachable ||
        state.setupAccessPointActive || state.setupAccessPointFallbackAvailable;
    if (!networkPathAvailable) {
      return WifiOtaRecoveryRoute::None;
    }
    if (state.devicePaired && state.currentTokenValid) {
      return WifiOtaRecoveryRoute::AuthenticatedUpload;
    }
    if (state.pairingWindowOpen) {
      return WifiOtaRecoveryRoute::PairThenUpload;
    }
    if (!state.devicePaired &&
        (state.setupAccessPointActive || state.setupAccessPointFallbackAvailable)) {
      return WifiOtaRecoveryRoute::SetupThenPairThenUpload;
    }
    if (state.physicalRecoveryAvailable) {
      return WifiOtaRecoveryRoute::PhysicalRecoveryThenPairThenUpload;
    }
    return WifiOtaRecoveryRoute::None;
  }
};

}  // namespace codexbar_display::esp8266
