#include <Arduino.h>

#include "../../firmware_shared/app_runtime.h"
#include "../../firmware_shared/app_transport.h"
#include "renderer_esp8266.h"

#ifndef CODEXBAR_DISPLAY_BOARD_ID
#define CODEXBAR_DISPLAY_BOARD_ID "esp8266-unknown"
#endif

#ifndef CODEXBAR_DISPLAY_FW_VERSION
#define CODEXBAR_DISPLAY_FW_VERSION "dev"
#endif

namespace {

codexbar_display::app::RuntimeContext runtimeCtx;
codexbar_display::esp8266::RendererESP8266 renderer;

#ifdef CODEXBAR_DISPLAY_RUNTIME_BENCH
struct RuntimeBenchWindow {
  unsigned long windowStartMs = 0;
  unsigned long loopCount = 0;
  unsigned long renderCount = 0;
  unsigned long loopCpuMaxUs = 0;
  unsigned long renderMaxUs = 0;
};

RuntimeBenchWindow benchWindow;

void recordBench(unsigned long loopStartUs, bool rendered, unsigned long renderUs) {
  const unsigned long nowMs = millis();
  if (benchWindow.windowStartMs == 0) {
    benchWindow.windowStartMs = nowMs;
  }

  const unsigned long loopCpuUs = micros() - loopStartUs;
  benchWindow.loopCount++;
  if (loopCpuUs > benchWindow.loopCpuMaxUs) {
    benchWindow.loopCpuMaxUs = loopCpuUs;
  }

  if (rendered) {
    benchWindow.renderCount++;
    if (renderUs > benchWindow.renderMaxUs) {
      benchWindow.renderMaxUs = renderUs;
    }
  }

  if (nowMs - benchWindow.windowStartMs >= 60000UL) {
    Serial.printf(
        "bench board=%s loops=%lu renders=%lu loop_cpu_us_max=%lu render_us_max=%lu\n",
        CODEXBAR_DISPLAY_BOARD_ID,
        benchWindow.loopCount,
        benchWindow.renderCount,
        benchWindow.loopCpuMaxUs,
        benchWindow.renderMaxUs);

    benchWindow = {};
    benchWindow.windowStartMs = nowMs;
  }
}
#endif

}  // namespace

void setup() {
  Serial.begin(115200);
  delay(200);

  renderer.Setup(runtimeCtx);
  renderer.DrawSplash(runtimeCtx);

  codexbar_display::app::TransportConfig transportConfig;
  transportConfig.boardId = CODEXBAR_DISPLAY_BOARD_ID;
  transportConfig.firmwareVersion = CODEXBAR_DISPLAY_FW_VERSION;
#ifdef CODEXBAR_DISPLAY_PROBE_ONLY
  transportConfig.featuresJSON = "[]";
  transportConfig.capabilitiesJSON =
      "{\"display\":{\"widthPx\":240,\"heightPx\":240,\"colorDepthBits\":16},"
      "\"theme\":{\"supportsThemeSpecV1\":false,\"maxThemeSpecBytes\":0,\"maxThemePrimitives\":0,\"builtinThemes\":[]},"
      "\"transport\":{\"active\":\"usb\",\"supported\":[\"usb\"]}}";
#else
  transportConfig.featuresJSON = "[\"theme\",\"theme-spec-v1\"]";
  transportConfig.capabilitiesJSON =
      "{\"display\":{\"widthPx\":240,\"heightPx\":240,\"colorDepthBits\":16},"
      "\"theme\":{\"supportsThemeSpecV1\":true,\"maxThemeSpecBytes\":1024,\"maxThemePrimitives\":32,"
      "\"builtinThemes\":[\"classic\",\"crt\",\"mini\"]},"
      "\"transport\":{\"active\":\"usb\",\"supported\":[\"usb\"]}}";
#endif
  transportConfig.maxFrameBytes = 1024;
  codexbar_display::app::EmitDeviceHello(transportConfig);

#ifdef CODEXBAR_DISPLAY_PROBE_ONLY
  Serial.println("codexbar_display_ready_probe");
#else
  Serial.println("codexbar_display_ready_display");
#endif
}

void loop() {
  const unsigned long loopStartUs = micros();
  bool rendered = false;
  unsigned long renderDurationUs = 0;

  codexbar_display::core::SerialConsumeEvent event;
  if (codexbar_display::app::ConsumeSerial(runtimeCtx, true, millis(), event)) {
    renderer.OnFrameAccepted(runtimeCtx, event);
    Serial.println("frame_received");
  }

  if (codexbar_display::app::HasFrame(runtimeCtx) &&
      !codexbar_display::app::CurrentFrame(runtimeCtx).hasError &&
      !runtimeCtx.screenDirty) {
    renderer.TickActive(runtimeCtx);
    const int64_t remain = codexbar_display::app::CurrentRemainingSecs(runtimeCtx, millis());
    if (remain != runtimeCtx.lastRenderedSecs) {
      const int64_t minuteBucket = remain / 60;
      if (minuteBucket != runtimeCtx.lastRenderedMinuteBucket) {
#ifdef CODEXBAR_DISPLAY_PROBE_ONLY
        runtimeCtx.screenDirty = true;
#else
        renderer.DrawReset(runtimeCtx, remain);
#endif
      } else {
        runtimeCtx.lastRenderedSecs = remain;
      }
    }
  }

  if (!codexbar_display::app::HasFrame(runtimeCtx) && !runtimeCtx.screenDirty) {
    renderer.TickSplash(runtimeCtx);
  }

  if (runtimeCtx.screenDirty) {
    const unsigned long renderStartUs = micros();
#ifdef CODEXBAR_DISPLAY_PROBE_ONLY
    renderer.DrawUsage(runtimeCtx);
#else
    if (!codexbar_display::app::HasFrame(runtimeCtx)) {
      renderer.DrawSplash(runtimeCtx);
    } else if (codexbar_display::app::CurrentFrame(runtimeCtx).hasError) {
      renderer.DrawError(runtimeCtx, codexbar_display::app::CurrentFrame(runtimeCtx).error);
    } else {
      renderer.DrawUsage(runtimeCtx);
    }
#endif
    rendered = true;
    renderDurationUs = micros() - renderStartUs;
    runtimeCtx.screenDirty = false;
  }

#ifdef CODEXBAR_DISPLAY_RUNTIME_BENCH
  recordBench(loopStartUs, rendered, renderDurationUs);
#endif

  delay(20);
}
