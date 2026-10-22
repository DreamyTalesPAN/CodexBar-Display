#!/usr/bin/env bash
set -euo pipefail

# Feeds small PlatformIO projects to check-esp8266-flash-layout.sh. Needs pio.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHECK="${ROOT_DIR}/scripts/check-esp8266-flash-layout.sh"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/esp8266-flash-layout-test.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

# project <name>: reads platformio.ini for a new project from stdin.
project() {
  mkdir -p "${WORK}/$1"
  cat >"${WORK}/$1/platformio.ini"
}

expect() {
  local want="$1" name="$2" status=0
  "$CHECK" "${WORK}/${name}" >/dev/null 2>&1 || status=$?
  [[ "$status" == "$want" ]] || die "${name}: exit ${status}, expected ${want}"
}

OK_INI='[env]
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
'

project ok <<<"$OK_INI"
expect 0 ok

project bigger-fs <<<"${OK_INI/eagle.flash.4m2m.ld/eagle.flash.4m3m.ld}"
expect 1 bigger-fs

grep -v ldscript <<<"$OK_INI" | project board-default
expect 1 board-default

printf '%s\n[env:other]\nextends = env:main\nboard_build.ldscript = eagle.flash.4m1m.ld\n' "$OK_INI" | project child-override
expect 1 child-override

printf '%s\n[env:new]\nplatform = espressif8266@4.2.1\nboard = esp12e\n' "$OK_INI" | project new-env
expect 1 new-env

printf '%s\n[env:owner]\nplatform = platformio/espressif8266@4.2.1\nboard_build.ldscript = eagle.flash.4m3m.ld\n' "$OK_INI" | project owner-qualified
expect 1 owner-qualified

printf '[env:native]\nplatform = native@1.2.1\n' | project no-esp8266
expect 2 no-esp8266

# Several parents: the latter one wins.
project multi-latter-bad <<'INI'
[base_ok]
board_build.ldscript = eagle.flash.4m2m.ld

[base_bad]
board_build.ldscript = eagle.flash.4m3m.ld

[env:main]
platform = espressif8266@4.2.1
extends = base_ok, base_bad
INI
expect 1 multi-latter-bad

sed 's/extends = base_ok, base_bad/extends = base_bad, base_ok/' "${WORK}/multi-latter-bad/platformio.ini" | project multi-latter-ok
expect 0 multi-latter-ok

# [env] defaults apply only when no parent sets the option.
project env-default-after-parents <<'INI'
[env]
board_build.ldscript = eagle.flash.4m2m.ld

[bad]
board_build.ldscript = eagle.flash.4m3m.ld

[unrelated]
build_flags = -DX=1

[env:main]
platform = espressif8266@4.2.1
extends = bad, unrelated
INI
expect 1 env-default-after-parents

# ${section.option} interpolation.
project interpolated-bad <<'INI'
[common]
platform = espressif8266@4.2.1
ldscript = eagle.flash.4m3m.ld

[env:main]
platform = ${common.platform}
board_build.ldscript = ${common.ldscript}
INI
expect 1 interpolated-bad

sed 's/4m3m/4m2m/' "${WORK}/interpolated-bad/platformio.ini" | project interpolated-ok
expect 0 interpolated-ok

# extra_configs, also when an extra file names a further one.
printf '[platformio]\nextra_configs = extra/*.ini\n\n%s' "$OK_INI" | project extra-configs
mkdir -p "${WORK}/extra-configs/extra/nested"
printf '[env:main]\nboard_build.ldscript = eagle.flash.4m3m.ld\n' >"${WORK}/extra-configs/extra/override.ini"
expect 1 extra-configs
printf '[env:main]\nbuild_flags = -DY=1\n' >"${WORK}/extra-configs/extra/override.ini"
expect 0 extra-configs
printf '[platformio]\nextra_configs = extra/nested/*.ini\n' >"${WORK}/extra-configs/extra/override.ini"
printf '[env:main]\nboard_build.ldscript = eagle.flash.4m3m.ld\n' >"${WORK}/extra-configs/extra/nested/deeper.ini"
expect 1 extra-configs

# ${sysenv.NAME} is resolved from the environment, as in the build.
printf '%s\n[env:fromenv]\nplatform = ${sysenv.W310_PLATFORM}\nboard_build.ldscript = eagle.flash.4m3m.ld\n' "$OK_INI" | project sysenv
status=0
W310_PLATFORM=espressif8266@4.2.1 "$CHECK" "${WORK}/sysenv" >/dev/null 2>&1 || status=$?
[[ "$status" == "1" ]] || die "sysenv: exit ${status}, expected 1"

"$CHECK" >/dev/null || die "the repository's firmware_esp8266/platformio.ini fails the check"

echo "ESP8266 flash layout check tests passed"
