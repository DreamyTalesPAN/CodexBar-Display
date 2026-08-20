#!/usr/bin/env bash
# Asserts that the ESP8266 size constants baked into main.cpp still match what
# the xtensa toolchain reports. Compile only, nothing is flashed.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
XTENSA="${XTENSA_GXX:-${HOME}/.platformio/packages/toolchain-xtensa/bin/xtensa-lx106-elf-g++}"
ARDUINOJSON="${ARDUINOJSON_SRC:-${ROOT}/firmware_esp8266/.pio/libdeps/native_theme_spec_renderer/ArduinoJson/src}"

if [[ ! -x "${XTENSA}" ]]; then
  echo "xtensa toolchain not found at ${XTENSA}" >&2
  echo "run a PlatformIO ESP8266 build once, or set XTENSA_GXX" >&2
  exit 1
fi

PROBE="$(mktemp -t themespec-size-probe).cpp"
trap 'rm -f "${PROBE}"' EXIT
cat > "${PROBE}" <<'EOF'
#include <ArduinoJson.h>
#include "theme_spec_renderer_core.h"
static_assert(sizeof(codexbar_display::themespec::CompiledPrimitive) == 104, "kEspCompiledPrimitiveBytes");
static_assert(sizeof(ArduinoJson::detail::VariantData) == 8, "kEspVariantSlotBytes");
static_assert(ARDUINOJSON_POOL_CAPACITY == 128, "kEspPoolCapacitySlots");
static_assert(sizeof(ArduinoJson::detail::StringNode) == 12, "kEspStringNodeOverheadBytes");
EOF

"${XTENSA}" -std=gnu++17 -fsyntax-only \
  -I "${ROOT}/firmware_shared" \
  -I "${ROOT}/firmware_esp8266/test/test_native_theme_spec" \
  -I "${ARDUINOJSON}" \
  -D ARDUINOJSON_USE_DOUBLE=0 \
  -D CODEXBAR_DISPLAY_THEME_SPEC_RENDERER=1 \
  "${PROBE}"

echo "ESP8266 size constants match tools/themespec-slot-budget/main.cpp"
