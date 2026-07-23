#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="${ROOT_DIR}/firmware_esp8266/tests/gif_core_policy_test.cpp"
OUT="${ROOT_DIR}/tmp/gif_core_policy_test"
VALIDATOR_SRC="${ROOT_DIR}/firmware_esp8266/tests/gif_asset_validator_test.cpp"
VALIDATOR_OUT="${ROOT_DIR}/tmp/gif_asset_validator_test"
PROFILE_SRC="${ROOT_DIR}/firmware_esp8266/tests/animated_gif_profile_test.cpp"
PROFILE_OUT="${ROOT_DIR}/tmp/animated_gif_profile_test"
PARITY_SRC="${ROOT_DIR}/firmware_esp8266/tests/animated_gif_parity_test.cpp"
PARITY_OUT="${ROOT_DIR}/tmp/animated_gif_parity_test"
CXX_BIN="${CXX:-c++}"

mkdir -p "${ROOT_DIR}/tmp"
"${CXX_BIN}" -std=c++17 -Wall -Wextra -pedantic "${SRC}" -o "${OUT}"
"${OUT}" \
  "${ROOT_DIR}/firmware_esp8266/src/renderer_esp8266_theme_spec.cpp" \
  "${ROOT_DIR}/firmware_esp8266/src/gif_core_esp8266.cpp" \
  "${ROOT_DIR}/firmware_esp8266/src/main.cpp" \
  "${ROOT_DIR}/firmware_esp8266/src/renderer_esp8266.cpp" \
  "${ROOT_DIR}/firmware_esp8266/platformio.ini"

"${CXX_BIN}" -std=c++17 -Wall -Wextra -pedantic \
  "${VALIDATOR_SRC}" \
  "${ROOT_DIR}/firmware_esp8266/src/gif_asset_validator.cpp" \
  -o "${VALIDATOR_OUT}"
"${VALIDATOR_OUT}" "${ROOT_DIR}/theme-packs/mini-classic/assets/mini.gif"

"${CXX_BIN}" -std=c++17 -Wall -Wextra -pedantic -D__MACH__ \
  -I"${ROOT_DIR}/firmware_esp8266/lib/AnimatedGIFVibeTV/src" \
  "${PROFILE_SRC}" \
  -o "${PROFILE_OUT}"
"${PROFILE_OUT}"

"${CXX_BIN}" -std=c++17 -Wall -Wextra -pedantic -D__MACH__ \
  -I"${ROOT_DIR}/firmware_esp8266/lib/AnimatedGIFVibeTV/src" \
  "${PARITY_SRC}" \
  "${ROOT_DIR}/firmware_esp8266/lib/AnimatedGIFVibeTV/src/AnimatedGIF.cpp" \
  -o "${PARITY_OUT}"
"${PARITY_OUT}" "${ROOT_DIR}/theme-packs/mini-classic/assets/mini.gif"
