#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="${ROOT_DIR}/firmware_esp8266/tests/gif_core_policy_test.cpp"
OUT="${ROOT_DIR}/tmp/gif_core_policy_test"
CXX_BIN="${CXX:-c++}"

mkdir -p "${ROOT_DIR}/tmp"
"${CXX_BIN}" -std=c++17 -Wall -Wextra -pedantic "${SRC}" -o "${OUT}"
"${OUT}" \
  "${ROOT_DIR}/firmware_esp8266/src/renderer_esp8266_theme_spec.cpp" \
  "${ROOT_DIR}/firmware_esp8266/src/gif_core_esp8266.cpp"
