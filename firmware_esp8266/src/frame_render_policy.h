#pragma once

namespace codexbar_display {
namespace esp8266 {

// Rendering from ESP8266WebServer callbacks can starve the WiFi stack and the
// hardware watchdog. Keep this decision pure so it is covered by native tests.
class FrameRenderPolicy {
 public:
  static bool ShouldDeferToMainLoop(bool wifiTransport, bool visualChanged) {
    return wifiTransport && visualChanged;
  }
};

}  // namespace esp8266
}  // namespace codexbar_display
