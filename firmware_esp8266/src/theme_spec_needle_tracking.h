#pragma once

#include "../../firmware_shared/theme_spec_renderer_core.h"

namespace codexbar_display {
namespace esp8266 {

// Only the most recently drawn needle is cached. Other primitives fall back
// to their full box, even when they share the same sprite and geometry.
class ThemeSpecNeedleTracking {
 public:
  void Reset() { *this = ThemeSpecNeedleTracking{}; }

  void Remember(const themespec::NeedleCommand& command) {
    if (primitive_ != command.primitive) {
      boundsValid_ = false;
    }
    primitive_ = command.primitive;
    stampAngle_ = command.angle;
  }

  bool DirtyBounds(
      const themespec::CompiledPrimitive& primitive,
      const themespec::FrameData& frame,
      const uint8_t* index,
      int sourceWidth,
      int sourceHeight,
      themespec::Bounds& bounds) {
    if (primitive_ != &primitive || primitive.kind != themespec::PrimitiveKind::Progress ||
        primitive.style != themespec::kProgressStyleNeedle) {
      return false;
    }
    const int angle = themespec::NeedleAngleDegrees(
        primitive.segments, primitive.segmentGap,
        themespec::CompiledProgressPercentFor(primitive, frame));
    if (boundsValid_ && angle == boundsAngle_ && stampAngle_ == boundsStampAngle_) {
      bounds = bounds_;
      return true;
    }
    themespec::Bounds current;
    themespec::Bounds previous;
    if (!themespec::NeedleOpaqueBounds(
            index, sourceWidth, sourceHeight, primitive.x, primitive.y,
            primitive.width, primitive.height, angle, 0xFF, current) ||
        !themespec::NeedleOpaqueBounds(
            index, sourceWidth, sourceHeight, primitive.x, primitive.y,
            primitive.width, primitive.height, stampAngle_, 0xFF, previous)) {
      return false;
    }
    themespec::ExpandBounds(current, previous);
    bounds_ = current;
    boundsAngle_ = angle;
    boundsStampAngle_ = stampAngle_;
    boundsValid_ = true;
    bounds = current;
    return true;
  }

 private:
  const themespec::CompiledPrimitive* primitive_ = nullptr;
  int stampAngle_ = 0;
  int boundsAngle_ = 0;
  int boundsStampAngle_ = 0;
  themespec::Bounds bounds_;
  bool boundsValid_ = false;
};

}  // namespace esp8266
}  // namespace codexbar_display
