#pragma once

#ifndef CODEXBAR_DISPLAY_PROBE_ONLY

#include <Arduino.h>
#include <TFT_eSPI.h>

#include "../../firmware_shared/app_runtime.h"
#include "../../firmware_shared/codexbar_display_core.h"
#include "../../firmware_shared/render_primitives.h"
#include "gif_core_esp8266.h"
#include "theme_defs.h"

namespace codexbar_display {
namespace esp8266 {
namespace display {

struct SharedState {
  app::RuntimeContext* ctx = nullptr;
  TFT_eSPI tft = TFT_eSPI();
  Theme activeTheme = defaultTheme();
  GifCoreESP8266 gifCore;
  String themeSpecUpdateNoticeText;
  uint16_t displayTransactionDepth = 0;
  uint8_t splashWaitingDots = 0;
  unsigned long splashDotsLastTick = 0;
  unsigned long splashStartedAt = 0;
  unsigned long splashHintLastTick = 0;
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

inline Theme& ActiveTheme() {
  return State().activeTheme;
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

inline uint8_t& SplashWaitingDots() {
  return State().splashWaitingDots;
}

inline unsigned long& SplashDotsLastTick() {
  return State().splashDotsLastTick;
}

inline unsigned long& SplashStartedAt() {
  return State().splashStartedAt;
}

inline unsigned long& SplashHintLastTick() {
  return State().splashHintLastTick;
}

inline int64_t CurrentRemainingSecs() {
  return codexbar_display::core::CurrentRemainingSecs(RuntimeState(), millis());
}

inline String FormatDuration(int64_t secs) {
  return codexbar_display::core::FormatDuration(secs);
}

void DrawBar(int x, int y, int w, int h, int pct, uint16_t fillColor);
primitive::Sink& PrimitiveLayer();
void PrimitiveFillScreen(uint16_t color);
void PrimitiveFillRect(int x, int y, int w, int h, uint16_t color);
void PrimitiveDrawText(
    const char* text,
    int x,
    int y,
    int font,
    int size,
    uint16_t fg,
    uint16_t bg,
    bool wrap);
void PrimitiveDrawProgress(int x, int y, int w, int h, int pct, uint16_t fillColor);

int TextPixelWidth(const char* text, int textSize);
int TextPixelHeight(int textSize);
int ChooseTextSizeToFit(const char* text, int maxSize, int minSize, int maxWidth);
int CenteredTextX(const char* text, int textSize);

void SetClassicTextSize(int size);
const char* ProviderLabelText();
const char* SplashDotsSuffix();

void DrawSplashClassic();
void TickSplashClassic();
void DrawErrorClassic(const String& message);
void DrawUsageClassic();
void DrawResetClassic(int64_t remainSecs);

void DrawSplashCRT();
void TickSplashCRT();
void DrawErrorCRT(const String& message);
void DrawUsageCRT();
void DrawResetCRT(int64_t remainSecs);

bool DrawThemeSpecUsage();
bool TickThemeSpecGifs();
bool ThemeSpecAnimationWorkPending();
bool RenderThemeSpecPartial(uint32_t changedFields, const char* updateNoticeText = nullptr);
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
  unsigned long partialSuccesses = 0;
  unsigned long partialFailures = 0;
  uint32_t lastPartialChangedFields = 0;
  const char* lastPartialError = "";
};
ThemeSpecRuntimeStats ThemeSpecRuntimeStatsSnapshot();

const char* MiniGifAssetPath();
void ResetMiniGifFrameSchedule();
void StopMiniGifPlayback();
bool ShouldRenderMiniGif();
void TickMiniGif(bool forceFrame);
int MiniGifReservedWidth();
void DrawMiniGifPlaceholder();
bool DrawMiniProviderLineOnly();

void DrawSplashMini();
void TickSplashMini();
void DrawErrorMini(const String& message);
void DrawUsageMini();
void DrawResetMini(int64_t remainSecs);
}  // namespace display
}  // namespace esp8266
}  // namespace codexbar_display

#endif
