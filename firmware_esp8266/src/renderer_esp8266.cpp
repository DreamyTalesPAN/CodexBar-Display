#include "renderer_esp8266.h"

#ifndef CODEXBAR_DISPLAY_PROBE_ONLY
#include "renderer_esp8266_display_state.h"
#include "theme_defs.h"
#else
#include "renderer_esp8266_probe.h"
#endif

namespace codexbar_display {
namespace esp8266 {

#ifndef CODEXBAR_DISPLAY_PROBE_ONLY
namespace {

constexpr const char* kDefaultGifAssetPath = "/themes/mini/mini.gif";
constexpr uint16_t kBacklightPwmRange = 1023;

const char* themeName(Theme theme) {
  (void)theme;
  return "mini";
}

uint8_t clampBrightnessPercent(uint8_t percent) {
  if (percent < 1) {
    return 1;
  }
  if (percent > 100) {
    return 100;
  }
  return percent;
}

}  // namespace
#endif

void RendererESP8266::Setup(app::RuntimeContext& ctx) {
#ifndef CODEXBAR_DISPLAY_PROBE_ONLY
  display::AttachContext(ctx);

#ifdef TFT_BL
  pinMode(TFT_BL, OUTPUT);
  ApplyBrightnessPercent(100);
#endif
  display::Tft().init();
  display::Tft().setRotation(0);
  display::GifCore().Setup(kDefaultGifAssetPath);
#else
  probe::Setup(ctx);
#endif
}

RendererDebugSnapshot RendererESP8266::DebugSnapshot() const {
  RendererDebugSnapshot snapshot;
#ifndef CODEXBAR_DISPLAY_PROBE_ONLY
  snapshot.themeSpecActive = display::HasFrame() && display::CurrentFrame().hasThemeSpec;
  if (snapshot.themeSpecActive) {
    snapshot.themeSpecId = display::CurrentFrame().themeSpecId;
    snapshot.themeSpecRev = display::CurrentFrame().themeSpecRev;
    snapshot.activeTheme = snapshot.themeSpecId.length() > 0 ? snapshot.themeSpecId : "theme-spec";
  } else {
    snapshot.activeTheme = themeName(display::ActiveTheme());
  }
  snapshot.themeSpecRenderOk = !snapshot.themeSpecActive || display::ThemeSpecRenderOk();
  snapshot.themeSpecRenderError = snapshot.themeSpecActive ? display::ThemeSpecRenderError() : "";
  snapshot.themeSpecRenderFailures = display::ThemeSpecRenderFailures();
  const display::ThemeSpecRuntimeStats themeSpecStats = display::ThemeSpecRuntimeStatsSnapshot();
  snapshot.themeSpecCompiled = themeSpecStats.compiled;
  snapshot.themeSpecPrimitiveCount = themeSpecStats.primitiveCount;
  snapshot.themeSpecPrimitiveCapacity = themeSpecStats.primitiveCapacity;
  snapshot.themeSpecStringBytes = themeSpecStats.stringBytes;
  snapshot.themeSpecStringCapacity = themeSpecStats.stringCapacity;
  snapshot.themeSpecKeepsJsonDocument = themeSpecStats.keepsJsonDocument;
  snapshot.themeSpecHasAnimatedAssets = themeSpecStats.hasAnimatedAssets;
  snapshot.themeSpecPartialSuccesses = themeSpecStats.partialSuccesses;
  snapshot.themeSpecPartialFailures = themeSpecStats.partialFailures;
  snapshot.themeSpecLastPartialChangedFields = themeSpecStats.lastPartialChangedFields;
  snapshot.themeSpecLastPartialError = themeSpecStats.lastPartialError;
  const GifCoreStatusSnapshot gif = display::GifCore().StatusSnapshot();
  snapshot.gifActivePath = gif.activePath;
  snapshot.gifFilePresent = gif.filePresent;
  snapshot.gifFileOpen = gif.fileOpen;
  snapshot.gifDecoderOpen = gif.decoderOpen;
  snapshot.gifBlocked = gif.blocked;
  snapshot.gifConsecutiveFailures = gif.consecutiveFailures;
  snapshot.gifBackoffRemainingMs = gif.backoffRemainingMs;
  snapshot.gifLastErrorPath = gif.lastErrorPath;
  snapshot.gifLastErrorStage = gif.lastErrorStage;
  snapshot.gifLastErrorFailures = gif.lastErrorFailures;
  snapshot.gifLastErrorAgeMs = gif.lastErrorAgeMs;
#else
  snapshot.activeTheme = "probe";
#endif
  return snapshot;
}

RendererHealthSnapshot RendererESP8266::HealthSnapshot() const {
  RendererHealthSnapshot snapshot;
#ifndef CODEXBAR_DISPLAY_PROBE_ONLY
  snapshot.themeSpecActive = display::HasFrame() && display::CurrentFrame().hasThemeSpec;
  if (snapshot.themeSpecActive) {
    snapshot.activeTheme = display::CurrentFrame().themeSpecId.length() > 0
                               ? display::CurrentFrame().themeSpecId
                               : "theme-spec";
  } else {
    snapshot.activeTheme = themeName(display::ActiveTheme());
  }
  snapshot.themeSpecRenderOk = !snapshot.themeSpecActive || display::ThemeSpecRenderOk();
  snapshot.themeSpecRenderFailures = display::ThemeSpecRenderFailures();
  const GifCoreStatusSnapshot gif = display::GifCore().StatusSnapshot();
  snapshot.gifActivePath = gif.activePath;
  snapshot.gifFilePresent = gif.filePresent;
  snapshot.gifDecoderOpen = gif.decoderOpen;
  snapshot.gifLastErrorStage = gif.lastErrorStage;
#else
  snapshot.activeTheme = "probe";
#endif
  return snapshot;
}

bool RendererESP8266::SupportsBrightnessControl() const {
#ifdef TFT_BL
  return true;
#else
  return false;
#endif
}

void RendererESP8266::ApplyBrightnessPercent(uint8_t percent) {
#ifdef TFT_BL
  const uint8_t clamped = clampBrightnessPercent(percent);
  if (clamped >= 100) {
    digitalWrite(TFT_BL, TFT_BACKLIGHT_ON);
    return;
  }
  analogWriteRange(kBacklightPwmRange);
  const uint16_t scaled = (static_cast<uint16_t>(clamped) * kBacklightPwmRange) / 100;
#if TFT_BACKLIGHT_ON == 0
  analogWrite(TFT_BL, kBacklightPwmRange - scaled);
#else
  analogWrite(TFT_BL, scaled);
#endif
#else
  (void)percent;
#endif
}

void RendererESP8266::ResetGifStateForAssetUpdate() {
#ifndef CODEXBAR_DISPLAY_PROBE_ONLY
  display::GifCore().ResetForAssetUpdate();
  display::ResetThemeSpecSpriteCaches();
#endif
}

void RendererESP8266::OnFrameAccepted(app::RuntimeContext& ctx, const core::SerialConsumeEvent& event) {
#ifndef CODEXBAR_DISPLAY_PROBE_ONLY
  display::AttachContext(ctx);

  if (display::CurrentFrame().hasTheme) {
    Theme frameTheme;
    if (themeFromName(display::CurrentFrame().theme, frameTheme) && frameTheme != display::ActiveTheme()) {
      display::ActiveTheme() = frameTheme;
      display::ScreenDirty() = true;
    }
  }

  if (event.visualChanged) {
#if CODEXBAR_DISPLAY_THEME_SPEC_RENDERER
    if (!display::ScreenDirty() &&
        event.themeSpecPartialRender &&
        display::CurrentFrame().hasThemeSpec &&
        display::CurrentThemeSpecRenderedSuccessfully()) {
      display::DisplayTransaction transaction;
      if (display::RenderThemeSpecPartial(event.themeSpecChangedFields)) {
        return;
      }
      if (core::KeepLastThemeSpecFrameAfterPartialRenderFailure(display::CurrentFrame(), event)) {
        return;
      }
    }
#endif
    display::ScreenDirty() = true;
  }
#else
  if (event.visualChanged) {
    ctx.screenDirty = true;
  }
#endif
}

void RendererESP8266::DrawSplash(app::RuntimeContext& ctx) {
#ifndef CODEXBAR_DISPLAY_PROBE_ONLY
  display::AttachContext(ctx);
  DrawStatus(ctx, "VIBE TV", "Starting", "Please wait");
#else
  probe::DrawSplash(ctx);
#endif
}

void RendererESP8266::TickSplash(app::RuntimeContext& ctx) {
#ifndef CODEXBAR_DISPLAY_PROBE_ONLY
  display::AttachContext(ctx);
  (void)ctx;
#else
  (void)ctx;
#endif
}

void RendererESP8266::DrawStatus(
    app::RuntimeContext& ctx,
    const String& title,
    const String& line1,
    const String& line2) {
#ifndef CODEXBAR_DISPLAY_PROBE_ONLY
  display::AttachContext(ctx);

  TFT_eSPI& tft = display::Tft();
  display::DisplayTransaction transaction;
  display::PrimitiveFillScreen(TFT_BLACK);
  tft.setTextWrap(false);
  tft.setTextFont(1);

  const int titleSize = display::ChooseTextSizeToFit(title.c_str(), 4, 2, tft.width() - 8);
  const int lineSize = display::ChooseTextSizeToFit(line1.c_str(), 3, 1, tft.width() - 8);
  const int line2Size = display::ChooseTextSizeToFit(line2.c_str(), 2, 1, tft.width() - 8);
  const int totalH =
      display::TextPixelHeight(titleSize) + 14 +
      display::TextPixelHeight(lineSize) + 8 +
      display::TextPixelHeight(line2Size);
  int y = (tft.height() - totalH) / 2;
  if (y < 6) {
    y = 6;
  }

  display::SetClassicTextSize(titleSize);
  tft.setTextColor(TFT_CYAN, TFT_BLACK);
  tft.setCursor(display::CenteredTextX(title.c_str(), titleSize), y);
  tft.print(title);

  y += display::TextPixelHeight(titleSize) + 14;
  display::SetClassicTextSize(lineSize);
  tft.setTextColor(TFT_WHITE, TFT_BLACK);
  tft.setCursor(display::CenteredTextX(line1.c_str(), lineSize), y);
  tft.print(line1);

  y += display::TextPixelHeight(lineSize) + 8;
  display::SetClassicTextSize(line2Size);
  tft.setTextColor(TFT_LIGHTGREY, TFT_BLACK);
  tft.setCursor(display::CenteredTextX(line2.c_str(), line2Size), y);
  tft.print(line2);

  ctx.lastRenderedSecs = -1;
  ctx.lastRenderedMinuteBucket = -1;
  ctx.screenDirty = false;
#else
  (void)ctx;
  Serial.printf("probe_status title=%s line1=%s line2=%s\n", title.c_str(), line1.c_str(), line2.c_str());
#endif
}

void RendererESP8266::DrawSetupInstructions(app::RuntimeContext& ctx, const String& ssid, const String& address) {
#ifndef CODEXBAR_DISPLAY_PROBE_ONLY
  display::AttachContext(ctx);

  TFT_eSPI& tft = display::Tft();
  display::DisplayTransaction transaction;
  display::PrimitiveFillScreen(TFT_BLACK);
  tft.setTextWrap(false);
  tft.setTextFont(1);

  const char* title = "USE PHONE";
  const char* action = "Join WiFi:";
  const char* detail = "Open:";
  const int titleSize = display::ChooseTextSizeToFit(title, 3, 2, tft.width() - 8);
  const int ssidSize = display::ChooseTextSizeToFit(ssid.c_str(), 3, 2, tft.width() - 8);
  const int actionSize = display::ChooseTextSizeToFit(action, 2, 1, tft.width() - 14);
  const int detailSize = display::ChooseTextSizeToFit(detail, 2, 1, tft.width() - 14);
  const int addressSize = display::ChooseTextSizeToFit(address.c_str(), 2, 1, tft.width() - 8);

  const int totalH =
      display::TextPixelHeight(titleSize) + 14 +
      display::TextPixelHeight(actionSize) + 4 +
      display::TextPixelHeight(ssidSize) + 10 +
      display::TextPixelHeight(detailSize) + 4 +
      display::TextPixelHeight(addressSize);
  int y = (tft.height() - totalH) / 2;
  if (y < 6) {
    y = 6;
  }

  display::SetClassicTextSize(titleSize);
  tft.setTextColor(TFT_CYAN, TFT_BLACK);
  tft.setCursor(display::CenteredTextX(title, titleSize), y);
  tft.print(title);

  y += display::TextPixelHeight(titleSize) + 14;
  display::SetClassicTextSize(actionSize);
  tft.setTextColor(TFT_WHITE, TFT_BLACK);
  tft.setCursor(display::CenteredTextX(action, actionSize), y);
  tft.print(action);

  y += display::TextPixelHeight(actionSize) + 4;
  display::SetClassicTextSize(ssidSize);
  tft.setTextColor(TFT_LIGHTGREY, TFT_BLACK);
  tft.setCursor(display::CenteredTextX(ssid.c_str(), ssidSize), y);
  tft.print(ssid);

  y += display::TextPixelHeight(ssidSize) + 10;
  display::SetClassicTextSize(detailSize);
  tft.setTextColor(TFT_WHITE, TFT_BLACK);
  tft.setCursor(display::CenteredTextX(detail, detailSize), y);
  tft.print(detail);

  y += display::TextPixelHeight(detailSize) + 4;
  display::SetClassicTextSize(addressSize);
  tft.setTextColor(TFT_LIGHTGREY, TFT_BLACK);
  tft.setCursor(display::CenteredTextX(address.c_str(), addressSize), y);
  tft.print(address);

  ctx.lastRenderedSecs = -1;
  ctx.lastRenderedMinuteBucket = -1;
  ctx.screenDirty = false;
#else
  (void)ctx;
  Serial.printf("probe_setup ssid=%s address=%s\n", ssid.c_str(), address.c_str());
#endif
}

void RendererESP8266::DrawConnectedSetupInstructions(
    app::RuntimeContext& ctx,
    const String& host,
    const String& fallbackIp) {
#ifndef CODEXBAR_DISPLAY_PROBE_ONLY
  display::AttachContext(ctx);

  TFT_eSPI& tft = display::Tft();
  display::DisplayTransaction transaction;
  display::PrimitiveFillScreen(TFT_BLACK);
  tft.setTextWrap(false);
  tft.setTextFont(1);

  (void)host;
  (void)fallbackIp;
  const char* title = "WiFi connected!";
  const char* action = "Now go to:";
  const char* detail = "app.vibetv.shop";
  const int titleSize = display::ChooseTextSizeToFit(title, 3, 2, tft.width() - 8);
  const int actionSize = display::ChooseTextSizeToFit(action, 2, 1, tft.width() - 14);
  const int detailSize = display::ChooseTextSizeToFit(detail, 2, 1, tft.width() - 14);

  const int totalH =
      display::TextPixelHeight(titleSize) + 12 +
      display::TextPixelHeight(actionSize) + 10 +
      display::TextPixelHeight(detailSize);
  int y = (tft.height() - totalH) / 2;
  if (y < 6) {
    y = 6;
  }

  display::SetClassicTextSize(titleSize);
  tft.setTextColor(TFT_CYAN, TFT_BLACK);
  tft.setCursor(display::CenteredTextX(title, titleSize), y);
  tft.print(title);

  y += display::TextPixelHeight(titleSize) + 12;
  display::SetClassicTextSize(actionSize);
  tft.setTextColor(TFT_WHITE, TFT_BLACK);
  tft.setCursor(display::CenteredTextX(action, actionSize), y);
  tft.print(action);

  y += display::TextPixelHeight(actionSize) + 10;
  display::SetClassicTextSize(detailSize);
  tft.setTextColor(TFT_LIGHTGREY, TFT_BLACK);
  tft.setCursor(display::CenteredTextX(detail, detailSize), y);
  tft.print(detail);

  ctx.lastRenderedSecs = -1;
  ctx.lastRenderedMinuteBucket = -1;
  ctx.screenDirty = false;
#else
  (void)ctx;
  Serial.printf("probe_connected_setup host=%s fallback_ip=%s\n", host.c_str(), fallbackIp.c_str());
#endif
}

void RendererESP8266::DrawFirmwareUpdateNotice(app::RuntimeContext& ctx, const String& text) {
#ifndef CODEXBAR_DISPLAY_PROBE_ONLY
  display::AttachContext(ctx);
  display::SetThemeSpecUpdateNoticeText(text);
  if (display::CurrentFrame().hasThemeSpec) {
#if CODEXBAR_DISPLAY_THEME_SPEC_RENDERER
    const String& raw = core::ThemeSpecRawForFrame(display::RuntimeState(), display::CurrentFrame());
    if (display::CurrentThemeSpecRenderedSuccessfully() &&
        core::ThemeSpecUsesBinding(raw, "label", "l")) {
      display::DisplayTransaction transaction;
      if (!display::RenderThemeSpecPartial(codexbar_display::themespec::kThemeSpecFieldLabel)) {
        display::ScreenDirty() = true;
      }
    }
#endif
    return;
  }
#else
  (void)ctx;
  Serial.printf("probe_update_notice text=%s\n", text.c_str());
#endif
}

void RendererESP8266::TickActive(app::RuntimeContext& ctx) {
#ifndef CODEXBAR_DISPLAY_PROBE_ONLY
  display::AttachContext(ctx);
  if (display::CurrentFrame().hasThemeSpec) {
    display::DisplayTransaction transaction;
    (void)display::TickThemeSpecGifs();
    return;
  }
#else
  (void)ctx;
#endif
}

void RendererESP8266::DrawError(app::RuntimeContext& ctx, const String& message) {
#ifndef CODEXBAR_DISPLAY_PROBE_ONLY
  display::AttachContext(ctx);
  (void)message;
  DrawStatus(ctx, "VIBE TV", "Open App", "app.vibetv.shop");
#else
  (void)message;
  probe::Render(ctx);
#endif
}

void RendererESP8266::DrawUsage(app::RuntimeContext& ctx) {
#ifndef CODEXBAR_DISPLAY_PROBE_ONLY
  display::AttachContext(ctx);
  if (display::CurrentFrame().hasThemeSpec) {
    display::DisplayTransaction transaction;
    if (display::DrawThemeSpecUsage()) {
      return;
    }
    // ThemeSpec rendering can fail transiently on ESP8266 under low heap while
    // changing state. Keep the last good visual instead of flashing the mini
    // error screen for one frame.
    return;
  }
  DrawStatus(ctx, "VIBE TV", "Open App", "app.vibetv.shop");
#else
  probe::Render(ctx);
#endif
}

bool RendererESP8266::DrawTopLine(app::RuntimeContext& ctx) {
#ifndef CODEXBAR_DISPLAY_PROBE_ONLY
  display::AttachContext(ctx);
  return false;
#else
  (void)ctx;
  return false;
#endif
}

void RendererESP8266::DrawReset(app::RuntimeContext& ctx, int64_t remainSecs) {
#ifndef CODEXBAR_DISPLAY_PROBE_ONLY
  display::AttachContext(ctx);
  if (display::CurrentFrame().hasThemeSpec) {
    display::DisplayTransaction transaction;
#if CODEXBAR_DISPLAY_THEME_SPEC_RENDERER
    const String& themeSpecRaw = core::ThemeSpecRawForFrame(display::RuntimeState(), display::CurrentFrame());
    if (display::CurrentThemeSpecRenderedSuccessfully() &&
        core::ThemeSpecUsesBinding(themeSpecRaw, "reset", "r") &&
        display::RenderThemeSpecPartial(codexbar_display::themespec::kThemeSpecFieldReset)) {
      return;
    }
#endif
    const int64_t remain = display::CurrentRemainingSecs();
    display::LastRenderedSecs() = remain;
    display::LastRenderedMinuteBucket() = remain / 60;
    return;
  }
  (void)remainSecs;
#else
  (void)remainSecs;
  probe::DrawReset(ctx);
#endif
}

}  // namespace esp8266
}  // namespace codexbar_display
