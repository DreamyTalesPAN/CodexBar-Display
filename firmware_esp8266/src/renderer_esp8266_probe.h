#pragma once

#ifdef CODEXBAR_DISPLAY_PROBE_ONLY

#include <Arduino.h>

#include "../../firmware_shared/app_runtime.h"

namespace codexbar_display {
namespace esp8266 {
namespace probe {

void Setup(app::RuntimeContext& ctx);
void DrawSplash(app::RuntimeContext& ctx);
void Render(app::RuntimeContext& ctx);
void DrawReset(app::RuntimeContext& ctx);

}  // namespace probe
}  // namespace esp8266
}  // namespace codexbar_display

#endif
