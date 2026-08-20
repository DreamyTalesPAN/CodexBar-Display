#!/usr/bin/env bash
# Builds the ThemeSpec slot budget reporter and prints the report for the given
# theme specs. Defaults to every shipped theme pack spec.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="${ROOT}/tmp/themespec-slot-budget"
ARDUINOJSON="${ARDUINOJSON_SRC:-${ROOT}/firmware_esp8266/.pio/libdeps/native_theme_spec_renderer/ArduinoJson/src}"

if [[ ! -d "${ARDUINOJSON}" ]]; then
  echo "ArduinoJson sources not found at ${ARDUINOJSON}" >&2
  echo "run: pio test -e native_theme_spec_renderer -d ${ROOT}/firmware_esp8266  (or set ARDUINOJSON_SRC)" >&2
  exit 1
fi

mkdir -p "${OUT}"
"${CXX:-c++}" -std=gnu++17 -O2 -o "${OUT}/themespec-slot-budget" \
  -I "${ROOT}/firmware_shared" \
  -I "${ROOT}/firmware_esp8266/test/test_native_theme_spec" \
  -I "${ARDUINOJSON}" \
  -D ARDUINOJSON_USE_DOUBLE=0 \
  -D CODEXBAR_DISPLAY_THEME_SPEC_RENDERER=1 \
  "${ROOT}/tools/themespec-slot-budget/main.cpp"

if [[ $# -gt 0 ]]; then
  "${OUT}/themespec-slot-budget" "$@"
else
  "${OUT}/themespec-slot-budget" "${ROOT}"/theme-packs/*/theme.json
fi
