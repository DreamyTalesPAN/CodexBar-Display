#include "renderer_esp8266.h"

#ifndef VIBEBLOCK_PROBE_ONLY
#include "renderer_esp8266_display_state.h"
#include "theme_defs.h"
#else
#include "renderer_esp8266_probe.h"
#endif

namespace vibeblock {
namespace esp8266 {

void RendererESP8266::Setup(app::RuntimeContext& ctx) {
#ifndef VIBEBLOCK_PROBE_ONLY
  display::AttachContext(ctx);

#ifdef TFT_BL
  pinMode(TFT_BL, OUTPUT);
  digitalWrite(TFT_BL, TFT_BACKLIGHT_ON);
#endif
  display::Tft().init();
  display::Tft().setRotation(0);
  display::GifCore().Setup(display::MiniGifAssetPath());
#else
  probe::Setup(ctx);
#endif
}

void RendererESP8266::OnFrameAccepted(app::RuntimeContext& ctx, const core::SerialConsumeEvent& event) {
#ifndef VIBEBLOCK_PROBE_ONLY
  display::AttachContext(ctx);

  Theme previousTheme = display::ActiveTheme();
  if (display::CurrentFrame().hasTheme) {
    Theme frameTheme;
    if (themeFromName(display::CurrentFrame().theme, frameTheme) && frameTheme != display::ActiveTheme()) {
      display::ActiveTheme() = frameTheme;
      display::ScreenDirty() = true;
    }
  }

  if (previousTheme == Theme::Mini && display::ActiveTheme() != Theme::Mini) {
    display::StopMiniGifPlayback();
  } else if (display::ActiveTheme() == Theme::Mini && (event.visualChanged || event.themeChanged)) {
    display::ResetMiniGifFrameSchedule();
  }

  if (!event.hadFrame) {
    display::StopMiniGifPlayback();
  }

  if (event.visualChanged) {
    display::ScreenDirty() = true;
  }
#else
  if (event.visualChanged) {
    ctx.screenDirty = true;
  }
#endif
}

void RendererESP8266::DrawSplash(app::RuntimeContext& ctx) {
#ifndef VIBEBLOCK_PROBE_ONLY
  display::AttachContext(ctx);

  switch (display::ActiveTheme()) {
    case Theme::Mini:
      display::StopMiniGifPlayback();
      display::DrawSplashMini();
      return;
    case Theme::CRT:
      display::StopMiniGifPlayback();
      display::DrawSplashCRT();
      return;
    case Theme::Classic:
    default:
      display::DrawSplashClassic();
      return;
  }
#else
  probe::DrawSplash(ctx);
#endif
}

void RendererESP8266::TickSplash(app::RuntimeContext& ctx) {
#ifndef VIBEBLOCK_PROBE_ONLY
  display::AttachContext(ctx);

  switch (display::ActiveTheme()) {
    case Theme::Mini:
      display::TickSplashMini();
      return;
    case Theme::CRT:
      display::TickSplashCRT();
      return;
    case Theme::Classic:
    default:
      display::TickSplashClassic();
      return;
  }
#else
  (void)ctx;
#endif
}

void RendererESP8266::TickActive(app::RuntimeContext& ctx) {
#ifndef VIBEBLOCK_PROBE_ONLY
  display::AttachContext(ctx);
  display::TickMiniGif(false);
#else
  (void)ctx;
#endif
}

void RendererESP8266::DrawError(app::RuntimeContext& ctx, const String& message) {
#ifndef VIBEBLOCK_PROBE_ONLY
  display::AttachContext(ctx);
  display::StopMiniGifPlayback();

  switch (display::ActiveTheme()) {
    case Theme::Mini:
      display::DrawErrorMini(message);
      return;
    case Theme::CRT:
      display::DrawErrorCRT(message);
      return;
    case Theme::Classic:
    default:
      display::DrawErrorClassic(message);
      return;
  }
#else
  (void)message;
  probe::Render(ctx);
#endif
}

void RendererESP8266::DrawUsage(app::RuntimeContext& ctx) {
#ifndef VIBEBLOCK_PROBE_ONLY
  display::AttachContext(ctx);

  switch (display::ActiveTheme()) {
    case Theme::Mini:
      display::DrawUsageMini();
      return;
    case Theme::CRT:
      display::StopMiniGifPlayback();
      display::DrawUsageCRT();
      return;
    case Theme::Classic:
    default:
      display::StopMiniGifPlayback();
      display::DrawUsageClassic();
      return;
  }
#else
  probe::Render(ctx);
#endif
}

void RendererESP8266::DrawReset(app::RuntimeContext& ctx, int64_t remainSecs) {
#ifndef VIBEBLOCK_PROBE_ONLY
  display::AttachContext(ctx);

  switch (display::ActiveTheme()) {
    case Theme::Mini:
      display::DrawResetMini(remainSecs);
      return;
    case Theme::CRT:
      display::DrawResetCRT(remainSecs);
      return;
    case Theme::Classic:
    default:
      display::DrawResetClassic(remainSecs);
      return;
  }
#else
  (void)remainSecs;
  probe::DrawReset(ctx);
#endif
}

}  // namespace esp8266
}  // namespace vibeblock
