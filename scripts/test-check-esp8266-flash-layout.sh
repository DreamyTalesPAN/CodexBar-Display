#!/usr/bin/env bash
set -euo pipefail

# Feeds small platformio.ini files to check-esp8266-flash-layout.sh.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHECK="${ROOT_DIR}/scripts/check-esp8266-flash-layout.sh"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/esp8266-flash-layout-test.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

expect() {
  local want="$1" name="$2" status=0
  "$CHECK" "${WORK}/${name}.ini" >/dev/null 2>&1 || status=$?
  [[ "$status" == "$want" ]] || die "${name}: exit ${status}, expected ${want}"
}

cat >"${WORK}/ok.ini" <<'INI'
[env]
framework = arduino

[env:main]
platform = espressif8266@4.2.1
board = esp12e
board_build.ldscript = eagle.flash.4m2m.ld ; the 2 MB filesystem

[env:child]
extends = env:main
build_flags = -DX=1

[env:native]
platform = native@1.2.1
INI
expect 0 ok

sed 's/eagle.flash.4m2m.ld/eagle.flash.4m3m.ld/' "${WORK}/ok.ini" >"${WORK}/bigger-fs.ini"
expect 1 bigger-fs

grep -v ldscript "${WORK}/ok.ini" >"${WORK}/board-default.ini"
expect 1 board-default

cat "${WORK}/ok.ini" >"${WORK}/child-override.ini"
printf '\n[env:other]\nextends = env:main\nboard_build.ldscript = eagle.flash.4m1m.ld\n' >>"${WORK}/child-override.ini"
expect 1 child-override

cat "${WORK}/ok.ini" >"${WORK}/new-env.ini"
printf '\n[env:new]\nplatform = espressif8266@4.2.1\nboard = esp12e\n' >>"${WORK}/new-env.ini"
expect 1 new-env

printf '[env:native]\nplatform = native@1.2.1\n' >"${WORK}/no-esp8266.ini"
expect 1 no-esp8266

"$CHECK" >/dev/null || die "the repository's platformio.ini fails the check"

echo "ESP8266 flash layout check tests passed"
