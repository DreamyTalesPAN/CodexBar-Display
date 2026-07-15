#pragma once

#include <cstdint>

namespace codexbar_display {
namespace esp8266 {

// ESP8266 SDK reset reason values from user_interface.h. Keep the policy
// independent of the SDK so it can be covered by the native test runner.
struct BootRecoveryPolicy {
  static constexpr uint32_t kPowerOnReset = 0;
  static constexpr uint32_t kExternalSystemReset = 6;

  static bool CountsAsPhysicalReset(uint32_t resetReason) {
    return resetReason == kPowerOnReset || resetReason == kExternalSystemReset;
  }
};

}  // namespace esp8266
}  // namespace codexbar_display
