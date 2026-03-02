#include "renderer_esp8266_probe.h"

#ifdef VIBEBLOCK_PROBE_ONLY

#include "../../firmware_shared/vibeblock_core.h"

namespace vibeblock {
namespace esp8266 {
namespace probe {

namespace {

app::RuntimeContext* gCtx = nullptr;

bool probeLastHasFrame = false;
bool probeLastHadError = false;
String probeLastProvider;
String probeLastLabel;
String probeLastError;
int probeLastSession = -1;
int probeLastWeekly = -1;
int64_t probeLastRemainSecs = -1;

inline core::RuntimeState& runtimeState() {
  return gCtx->runtime;
}

inline core::Frame& current() {
  return gCtx->runtime.current;
}

inline bool hasFrame() {
  return gCtx->runtime.hasFrame;
}

inline bool& screenDirty() {
  return gCtx->screenDirty;
}

inline int64_t& lastRenderedSecs() {
  return gCtx->lastRenderedSecs;
}

int64_t currentRemainingSecs() {
  return vibeblock::core::CurrentRemainingSecs(runtimeState(), millis());
}

String formatDuration(int64_t secs) {
  return vibeblock::core::FormatDuration(secs);
}

void resetProbeState() {
  probeLastHasFrame = false;
  probeLastHadError = false;
  probeLastProvider = "";
  probeLastLabel = "";
  probeLastError = "";
  probeLastSession = -1;
  probeLastWeekly = -1;
  probeLastRemainSecs = -1;
}

}  // namespace

void Setup(app::RuntimeContext& ctx) {
  gCtx = &ctx;
  resetProbeState();
}

void DrawSplash(app::RuntimeContext& ctx) {
  gCtx = &ctx;
  if (!hasFrame()) {
    Serial.println("probe_waiting_for_frame");
  }
}

void Render(app::RuntimeContext& ctx) {
  gCtx = &ctx;

  if (!hasFrame()) {
    if (probeLastHasFrame) {
      Serial.println("probe_waiting_for_frame");
      resetProbeState();
    }
    return;
  }

  const int64_t remain = currentRemainingSecs();
  if (current().hasError) {
    const bool changed = !probeLastHasFrame || !probeLastHadError || current().error != probeLastError;
    if (changed) {
      Serial.printf("probe_error error=%s\n", current().error.c_str());
    }
    probeLastHasFrame = true;
    probeLastHadError = true;
    probeLastError = current().error;
    probeLastProvider = current().provider;
    probeLastLabel = current().label;
    probeLastSession = current().session;
    probeLastWeekly = current().weekly;
    probeLastRemainSecs = remain;
    lastRenderedSecs() = remain;
    return;
  }

  const bool changed =
      !probeLastHasFrame ||
      probeLastHadError ||
      current().provider != probeLastProvider ||
      current().label != probeLastLabel ||
      current().session != probeLastSession ||
      current().weekly != probeLastWeekly ||
      remain != probeLastRemainSecs;

  if (changed) {
    Serial.printf(
        "probe_usage label=%s provider=%s session=%d weekly=%d reset=%s\n",
        current().label.c_str(),
        current().provider.c_str(),
        current().session,
        current().weekly,
        formatDuration(remain).c_str());
  }

  probeLastHasFrame = true;
  probeLastHadError = false;
  probeLastError = "";
  probeLastProvider = current().provider;
  probeLastLabel = current().label;
  probeLastSession = current().session;
  probeLastWeekly = current().weekly;
  probeLastRemainSecs = remain;
  lastRenderedSecs() = remain;
}

void DrawReset(app::RuntimeContext& ctx) {
  gCtx = &ctx;
  screenDirty() = true;
}

}  // namespace probe
}  // namespace esp8266
}  // namespace vibeblock

#endif
