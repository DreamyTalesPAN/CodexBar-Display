#pragma once

#include <stdint.h>

namespace codexbar_display {
namespace esp8266 {

// Pure policy kept separate from ESP APIs so the low-memory boundaries can be
// verified by the native test target.
class ThemeSpecRuntimePolicy {
 public:
  static constexpr uint32_t kMinRenderFreeHeapBytes = 6144UL;
  static constexpr uint32_t kMinRenderMaxFreeBlockBytes = 2048UL;
  static constexpr uint32_t kMinAnimationFreeHeapBytes = 8192UL;
  static constexpr uint32_t kMinAnimationMaxFreeBlockBytes = 3072UL;

  static bool CanRender(uint32_t freeHeapBytes, uint32_t maxFreeBlockBytes) {
    return freeHeapBytes >= kMinRenderFreeHeapBytes &&
           maxFreeBlockBytes >= kMinRenderMaxFreeBlockBytes;
  }

  static bool CanAnimate(uint32_t freeHeapBytes, uint32_t maxFreeBlockBytes) {
    return freeHeapBytes >= kMinAnimationFreeHeapBytes &&
           maxFreeBlockBytes >= kMinAnimationMaxFreeBlockBytes;
  }

  static bool AnimatedAssetDue(
      bool forceFrame,
      bool cacheValid,
      int frameCount,
      int fps,
      unsigned long nextFrameAtMs,
      unsigned long nowMs) {
    if (forceFrame || !cacheValid) {
      return true;
    }
    if (frameCount <= 1 || fps <= 0) {
      return false;
    }
    if (nextFrameAtMs == 0) {
      return true;
    }
    return static_cast<int32_t>(nowMs - nextFrameAtMs) >= 0;
  }
};

}  // namespace esp8266
}  // namespace codexbar_display
