#pragma once

#include <Arduino.h>

#include "../../firmware_shared/app_renderer.h"

namespace codexbar_display {
namespace esp8266 {

struct RendererDebugSnapshot {
  String activeTheme;
  bool themeSpecActive = false;
  String themeSpecId;
  int themeSpecRev = 0;
  bool themeSpecRenderOk = true;
  String themeSpecRenderError;
  unsigned long themeSpecRenderFailures = 0;
  bool themeSpecCompiled = false;
  uint16_t themeSpecPrimitiveCount = 0;
  uint16_t themeSpecPrimitiveCapacity = 0;
  uint16_t themeSpecStringBytes = 0;
  uint16_t themeSpecStringCapacity = 0;
  bool themeSpecKeepsJsonDocument = false;
  bool themeSpecHasAnimatedAssets = false;
  unsigned long themeSpecPartialSuccesses = 0;
  unsigned long themeSpecPartialFailures = 0;
  uint32_t themeSpecLastPartialChangedFields = 0;
  String themeSpecLastPartialError;
  String gifActivePath;
  bool gifFilePresent = false;
  bool gifFileOpen = false;
  bool gifDecoderAllocated = false;
  bool gifDecoderOpen = false;
  bool gifBlocked = false;
  uint8_t gifConsecutiveFailures = 0;
  unsigned long gifBackoffRemainingMs = 0;
  String gifLastErrorPath;
  String gifLastErrorStage;
  unsigned int gifLastErrorFailures = 0;
  unsigned long gifLastErrorAgeMs = 0;
};

struct RendererHealthSnapshot {
  String activeTheme;
  bool themeSpecActive = false;
  bool themeSpecRenderOk = true;
  unsigned long themeSpecRenderFailures = 0;
  String gifActivePath;
  bool gifFilePresent = false;
  bool gifDecoderAllocated = false;
  bool gifDecoderOpen = false;
  String gifLastErrorStage;
};

class RendererESP8266 : public app::Renderer {
 public:
  void Setup(app::RuntimeContext& ctx) override;
  void OnFrameAccepted(app::RuntimeContext& ctx, const core::SerialConsumeEvent& event) override;
  RendererDebugSnapshot DebugSnapshot() const;
  RendererHealthSnapshot HealthSnapshot() const;
  void ResetGifStateForAssetUpdate();
  bool SupportsBrightnessControl() const;
  void ApplyBrightnessPercent(uint8_t percent);

  void DrawSplash(app::RuntimeContext& ctx) override;
  void TickSplash(app::RuntimeContext& ctx) override;
  void DrawStatus(app::RuntimeContext& ctx, const String& title, const String& line1, const String& line2);
  void DrawSetupInstructions(app::RuntimeContext& ctx, const String& ssid, const String& address);
  void DrawConnectedSetupInstructions(app::RuntimeContext& ctx, const String& host, const String& fallbackIp);
  void DrawFirmwareUpdateNotice(app::RuntimeContext& ctx, const String& text);
  void TickActive(app::RuntimeContext& ctx) override;
  void DrawError(app::RuntimeContext& ctx, const String& message) override;
  bool DrawTopLine(app::RuntimeContext& ctx);
  void DrawUsage(app::RuntimeContext& ctx) override;
  void DrawReset(app::RuntimeContext& ctx, int64_t remainSecs) override;
};

}  // namespace esp8266
}  // namespace codexbar_display
