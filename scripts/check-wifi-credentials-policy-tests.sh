#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="${ROOT_DIR}/firmware_esp8266/tests/wifi_credentials_policy_test.cpp"
OUT="${ROOT_DIR}/tmp/wifi_credentials_policy_test"
CXX_BIN="${CXX:-c++}"

mkdir -p "${ROOT_DIR}/tmp"
"${CXX_BIN}" -std=c++17 -Wall -Wextra -pedantic "${SRC}" -o "${OUT}"
"${OUT}" "${ROOT_DIR}/firmware_esp8266/src/main.cpp"

KNOWN_SRC="${ROOT_DIR}/firmware_esp8266/tests/wifi_known_networks_test.cpp"
KNOWN_OUT="${ROOT_DIR}/tmp/wifi_known_networks_test"
"${CXX_BIN}" -std=c++17 -Wall -Wextra -pedantic "${KNOWN_SRC}" -o "${KNOWN_OUT}"
"${KNOWN_OUT}" "${ROOT_DIR}/firmware_esp8266/src/main.cpp"
