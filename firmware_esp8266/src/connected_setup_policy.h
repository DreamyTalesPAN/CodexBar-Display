#pragma once

#include <cstdint>

namespace codexbar_display {
namespace esp8266 {

class ConnectedSetupPolicy {
 public:
  static bool IsStationIPv4(const char* value) {
    if (value == nullptr || *value == '\0') {
      return false;
    }

    uint16_t octets[4] = {0, 0, 0, 0};
    uint8_t octetIndex = 0;
    uint8_t digits = 0;
    for (const char* cursor = value;; ++cursor) {
      const char current = *cursor;
      if (current >= '0' && current <= '9') {
        if (digits >= 3) {
          return false;
        }
        octets[octetIndex] = static_cast<uint16_t>(octets[octetIndex] * 10 + (current - '0'));
        if (octets[octetIndex] > 255) {
          return false;
        }
        ++digits;
        continue;
      }
      if ((current == '.' || current == '\0') && digits > 0) {
        if (current == '\0') {
          if (octetIndex != 3) {
            return false;
          }
          break;
        }
        if (octetIndex >= 3) {
          return false;
        }
        ++octetIndex;
        digits = 0;
        continue;
      }
      return false;
    }

    // Never present unspecified, loopback, multicast, or the fixed setup-AP
    // address as the reachable station address shown to the customer.
    if (octets[0] == 0 || octets[0] == 127 || octets[0] >= 224) {
      return false;
    }
    return !(octets[0] == 192 && octets[1] == 168 && octets[2] == 4 && octets[3] == 1);
  }
};

}  // namespace esp8266
}  // namespace codexbar_display
