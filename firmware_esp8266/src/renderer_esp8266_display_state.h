#pragma once

#ifndef CODEXBAR_DISPLAY_PROBE_ONLY

#include <Arduino.h>
#include <TFT_eSPI.h>

#include "../../firmware_shared/app_runtime.h"
#include "../../firmware_shared/codexbar_display_core.h"
#include "../../firmware_shared/render_primitives.h"
#include "gif_core_esp8266.h"

namespace codexbar_display {
namespace esp8266 {
namespace display {

struct SharedState {
  app::RuntimeContext* ctx = nullptr;
  TFT_eSPI tft = TFT_eSPI();
  GifCoreESP8266 gifCore;
  String themeSpecUpdateNoticeText;
  uint16_t displayTransactionDepth = 0;
};

SharedState& State();
void AttachContext(app::RuntimeContext& ctx);

inline app::RuntimeContext& Context() {
  return *State().ctx;
}

inline core::RuntimeState& RuntimeState() {
  return Context().runtime;
}

inline core::Frame& CurrentFrame() {
  return Context().runtime.current;
}

inline bool HasFrame() {
  return Context().runtime.hasFrame;
}

inline bool& ScreenDirty() {
  return Context().screenDirty;
}

inline int64_t& LastRenderedSecs() {
  return Context().lastRenderedSecs;
}

inline int64_t& LastRenderedMinuteBucket() {
  return Context().lastRenderedMinuteBucket;
}

inline TFT_eSPI& Tft() {
  return State().tft;
}

inline GifCoreESP8266& GifCore() {
  return State().gifCore;
}

inline void SetThemeSpecUpdateNoticeText(const String& text) {
  State().themeSpecUpdateNoticeText = text;
}

inline const char* ThemeSpecUpdateNoticeText() {
  return State().themeSpecUpdateNoticeText.c_str();
}

bool BeginDisplayTransaction();
void EndDisplayTransaction();

class DisplayTransaction {
 public:
  DisplayTransaction();
  ~DisplayTransaction();

  DisplayTransaction(const DisplayTransaction&) = delete;
  DisplayTransaction& operator=(const DisplayTransaction&) = delete;

 private:
  bool active_ = false;
};

inline int64_t CurrentRemainingSecs() {
  return codexbar_display::core::CurrentRemainingSecs(RuntimeState(), millis());
}

inline String FormatDuration(int64_t secs) {
  return codexbar_display::core::FormatDuration(secs);
}

primitive::Sink& PrimitiveLayer();
void PrimitiveFillScreen(uint16_t color);
void PrimitiveFillRect(int x, int y, int w, int h, uint16_t color);

int TextPixelWidth(const char* text, int textSize);
int TextPixelHeight(int textSize);
int ChooseTextSizeToFit(const char* text, int maxSize, int minSize, int maxWidth);
int CenteredTextX(const char* text, int textSize);

void SetTextSize(int size);
const char* ProviderLabelText();

// Height of the firmware update overlay bar drawn over themes without a
// label binding. Bounded so the notice never covers more than one edge strip.
constexpr int kFirmwareUpdateNoticeBarHeight = 24;

struct FirmwareUpdateOverlayPlacement {
  bool valid = false;
  int y = 0;
};

bool DrawThemeSpecUsage();
bool TickThemeSpecGifs();
bool ThemeSpecAnimationWorkPending();
void MarkThemeSpecCountdownsRendered();
bool RenderThemeSpecPartial(uint32_t changedFields, const char* updateNoticeText = nullptr);
// Repaints one bounded display region from the cached ThemeSpec scene without
// a full-screen redraw. Used to remove the update-notice overlay bar.
bool RenderThemeSpecRegion(int x, int y, int width, int height);
// Picks a bar position (top preferred, bottom fallback) that no animated
// GIF/sprite primitive repaints, so animations keep rendering correctly.
FirmwareUpdateOverlayPlacement FirmwareUpdateOverlayBarPlacement();
void ResetThemeSpecSpriteCaches();
bool ThemeSpecFullRenderRetryPending();
bool CurrentThemeSpecRenderedSuccessfully();
bool ThemeSpecRenderOk();
const char* ThemeSpecRenderError();
unsigned long ThemeSpecRenderFailures();
struct ThemeSpecRuntimeStats {
  bool compiled = false;
  uint16_t primitiveCount = 0;
  uint16_t primitiveCapacity = 0;
  uint16_t stringBytes = 0;
  uint16_t stringCapacity = 0;
  bool keepsJsonDocument = false;
  bool hasAnimatedAssets = false;
  unsigned long cbaCompletedFrames = 0;
  unsigned long cbaLastFrameDurationMs = 0;
  uint32_t cbaBufferBytes = 0;
  unsigned long cbaBufferAllocationFailures = 0;
  unsigned long cbaLastPushDurationUs = 0;
  unsigned long partialSuccesses = 0;
  unsigned long partialFailures = 0;
  uint32_t lastPartialChangedFields = 0;
  const char* lastPartialError = "";
};
ThemeSpecRuntimeStats ThemeSpecRuntimeStatsSnapshot();

}  // namespace display
}  // namespace esp8266
}  // namespace codexbar_display

#endif
