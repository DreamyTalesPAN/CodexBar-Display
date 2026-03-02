#pragma once

#ifdef VIBEBLOCK_PROBE_ONLY

#include <Arduino.h>

#include "../../firmware_shared/app_runtime.h"

namespace vibeblock {
namespace esp8266 {
namespace probe {

void Setup(app::RuntimeContext& ctx);
void DrawSplash(app::RuntimeContext& ctx);
void Render(app::RuntimeContext& ctx);
void DrawReset(app::RuntimeContext& ctx);

}  // namespace probe
}  // namespace esp8266
}  // namespace vibeblock

#endif
