#include <Arduino.h>

#include "../../firmware_shared/app_runtime.h"
#include "../../firmware_shared/app_transport.h"
#include "renderer_esp8266.h"

#ifndef VIBEBLOCK_BOARD_ID
#define VIBEBLOCK_BOARD_ID "esp8266-unknown"
#endif

#ifndef VIBEBLOCK_FW_VERSION
#define VIBEBLOCK_FW_VERSION "dev"
#endif

namespace {

vibeblock::app::RuntimeContext runtimeCtx;
vibeblock::esp8266::RendererESP8266 renderer;

#ifdef VIBEBLOCK_RUNTIME_BENCH
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
        VIBEBLOCK_BOARD_ID,
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

  vibeblock::app::TransportConfig transportConfig;
  transportConfig.boardId = VIBEBLOCK_BOARD_ID;
  transportConfig.firmwareVersion = VIBEBLOCK_FW_VERSION;
#ifdef VIBEBLOCK_PROBE_ONLY
  transportConfig.featuresJSON = "[]";
#else
  transportConfig.featuresJSON = "[\"theme\"]";
#endif
  transportConfig.maxFrameBytes = 512;
  vibeblock::app::EmitDeviceHello(transportConfig);

#ifdef VIBEBLOCK_PROBE_ONLY
  Serial.println("vibeblock_ready_probe");
#else
  Serial.println("vibeblock_ready_display");
#endif
}

void loop() {
  const unsigned long loopStartUs = micros();
  bool rendered = false;
  unsigned long renderDurationUs = 0;

  vibeblock::core::SerialConsumeEvent event;
  if (vibeblock::app::ConsumeSerial(runtimeCtx, true, millis(), event)) {
    renderer.OnFrameAccepted(runtimeCtx, event);
    Serial.println("frame_received");
  }

  if (vibeblock::app::HasFrame(runtimeCtx) &&
      !vibeblock::app::CurrentFrame(runtimeCtx).hasError &&
      !runtimeCtx.screenDirty) {
    renderer.TickActive(runtimeCtx);
    const int64_t remain = vibeblock::app::CurrentRemainingSecs(runtimeCtx, millis());
    if (remain != runtimeCtx.lastRenderedSecs) {
      const int64_t minuteBucket = remain / 60;
      if (minuteBucket != runtimeCtx.lastRenderedMinuteBucket) {
#ifdef VIBEBLOCK_PROBE_ONLY
        runtimeCtx.screenDirty = true;
#else
        renderer.DrawReset(runtimeCtx, remain);
#endif
      } else {
        runtimeCtx.lastRenderedSecs = remain;
      }
    }
  }

  if (!vibeblock::app::HasFrame(runtimeCtx) && !runtimeCtx.screenDirty) {
    renderer.TickSplash(runtimeCtx);
  }

  if (runtimeCtx.screenDirty) {
    const unsigned long renderStartUs = micros();
#ifdef VIBEBLOCK_PROBE_ONLY
    renderer.DrawUsage(runtimeCtx);
#else
    if (!vibeblock::app::HasFrame(runtimeCtx)) {
      renderer.DrawSplash(runtimeCtx);
    } else if (vibeblock::app::CurrentFrame(runtimeCtx).hasError) {
      renderer.DrawError(runtimeCtx, vibeblock::app::CurrentFrame(runtimeCtx).error);
    } else {
      renderer.DrawUsage(runtimeCtx);
    }
#endif
    rendered = true;
    renderDurationUs = micros() - renderStartUs;
    runtimeCtx.screenDirty = false;
  }

#ifdef VIBEBLOCK_RUNTIME_BENCH
  recordBench(loopStartUs, rendered, renderDurationUs);
#endif

  delay(20);
}
