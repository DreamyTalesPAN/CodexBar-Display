#include <Arduino.h>

#include "../../firmware_shared/app_runtime.h"
#include "../../firmware_shared/app_transport.h"
#include "renderer_esp32.h"

#ifndef VIBEBLOCK_BOARD_ID
#define VIBEBLOCK_BOARD_ID "esp32-unknown"
#endif

#ifndef VIBEBLOCK_FW_VERSION
#define VIBEBLOCK_FW_VERSION "dev"
#endif

namespace {

vibeblock::app::RuntimeContext runtimeCtx;
vibeblock::esp32::RendererESP32 renderer;

}  // namespace

void setup() {
  Serial.begin(115200);
  delay(200);

  renderer.Setup(runtimeCtx);
  renderer.DrawSplash(runtimeCtx);

  vibeblock::app::TransportConfig transportConfig;
  transportConfig.boardId = VIBEBLOCK_BOARD_ID;
  transportConfig.firmwareVersion = VIBEBLOCK_FW_VERSION;
  transportConfig.featuresJSON = "[]";
  transportConfig.maxFrameBytes = 512;
  vibeblock::app::EmitDeviceHello(transportConfig);

  Serial.println("vibeblock_ready");
}

void loop() {
  vibeblock::core::SerialConsumeEvent event;
  if (vibeblock::app::ConsumeSerial(runtimeCtx, false, millis(), event)) {
    renderer.OnFrameAccepted(runtimeCtx, event);
    Serial.println("frame_received");
  }

  if (vibeblock::app::HasFrame(runtimeCtx) &&
      !vibeblock::app::CurrentFrame(runtimeCtx).hasError &&
      !runtimeCtx.screenDirty) {
    const int64_t remain = vibeblock::app::CurrentRemainingSecs(runtimeCtx, millis());
    if (remain != runtimeCtx.lastRenderedSecs) {
      renderer.DrawReset(runtimeCtx, remain);
    }
  }

  if (!vibeblock::app::HasFrame(runtimeCtx) && !runtimeCtx.screenDirty) {
    renderer.TickSplash(runtimeCtx);
  }

  if (runtimeCtx.screenDirty) {
    if (!vibeblock::app::HasFrame(runtimeCtx)) {
      renderer.DrawSplash(runtimeCtx);
    } else if (vibeblock::app::CurrentFrame(runtimeCtx).hasError) {
      renderer.DrawError(runtimeCtx, vibeblock::app::CurrentFrame(runtimeCtx).error);
    } else {
      renderer.DrawUsage(runtimeCtx);
    }
    runtimeCtx.screenDirty = false;
  }

  delay(20);
}
