#pragma once

#include <stdint.h>

namespace codexbar_display {
namespace esp8266 {

// Pure policy kept separate from ESP APIs so the low-memory boundaries can be
// verified by the native test target.
class ThemeSpecRuntimePolicy {
 public:
  static constexpr int kCbaRowsPerTick = 4;
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

  static bool CbaWorkDue(
      bool forceFrame,
      bool frameInProgress,
      bool cacheValid,
      int frameCount,
      int fps,
      unsigned long nextFrameAtMs,
      unsigned long nowMs) {
    return frameInProgress || AnimatedAssetDue(
                                  forceFrame,
                                  cacheValid,
                                  frameCount,
                                  fps,
                                  nextFrameAtMs,
                                  nowMs);
  }

  static int CbaRowsForTick(int nextRow, int height) {
    if (nextRow < 0 || height <= 0 || nextRow >= height) {
      return 0;
    }
    const int remaining = height - nextRow;
    return remaining < kCbaRowsPerTick ? remaining : kCbaRowsPerTick;
  }

  static int NextCbaFrameIndex(int completedFrameIndex, int frameCount) {
    if (frameCount <= 0 || completedFrameIndex < 0) {
      return 0;
    }
    return (completedFrameIndex + 1) % frameCount;
  }

  static unsigned long CbaFrameDelayMs(int fps) {
    return fps > 0 ? (1000UL / static_cast<unsigned long>(fps)) : 0;
  }

  static bool CanYieldAtDisplayTransactionDepth(uint16_t transactionDepth) {
    return transactionDepth == 0;
  }

  static int InitialAnimatedIndexedFrameCount(int frameCount) {
    return frameCount > 0 ? 1 : 0;
  }

  static bool AnimatedFrameOffsetAvailable(
      int selectedFrame,
      int frameCount,
      int indexedFrameCount) {
    return selectedFrame >= 0 &&
           selectedFrame < frameCount &&
           selectedFrame < indexedFrameCount;
  }

  static bool ShouldIndexNextAnimatedFrame(
      int selectedFrame,
      int frameCount,
      int indexedFrameCount) {
    return AnimatedFrameOffsetAvailable(selectedFrame, frameCount, indexedFrameCount) &&
           selectedFrame + 1 == indexedFrameCount &&
           indexedFrameCount < frameCount;
  }

  static bool ShouldYieldDuringAssetScan(int completedRows) {
    return completedRows > 0 && (completedRows % 4) == 0;
  }

  static bool ShouldYieldDuringRleDecode(int completedRuns) {
    return completedRuns > 0 && (completedRuns % 16) == 0;
  }

  static bool ScaledSpriteRowIntersectsClip(
      int sourceRow,
      int sourceHeight,
      int targetY,
      int targetHeight,
      int clipY,
      int clipHeight) {
    if (sourceRow < 0 || sourceHeight <= 0 || targetHeight <= 0 || clipHeight <= 0) {
      return false;
    }
    const int drawY1 = targetY + ((sourceRow * targetHeight) / sourceHeight);
    const int drawY2 = targetY + (((sourceRow + 1) * targetHeight + sourceHeight - 1) / sourceHeight);
    return drawY1 < clipY + clipHeight && drawY2 > clipY;
  }
};

}  // namespace esp8266
}  // namespace codexbar_display
