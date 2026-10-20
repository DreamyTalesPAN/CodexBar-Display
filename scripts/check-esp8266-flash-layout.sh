#!/usr/bin/env bash
set -euo pipefail

# Fails if an ESP8266 firmware build would use another flash layout than
# eagle.flash.4m2m.ld (issue #310). Devices that came with the GeekMagic factory
# firmware still carry its LittleFS at 0x100000. With the 4m2m layout our
# filesystem starts at 0x200000 and never sees it. A layout with a bigger
# filesystem (for example eagle.flash.4m3m.ld) starts at 0x100000 and would
# mount the factory files on every device already sold.
#
# PlatformIO itself resolves the configuration (extends, [env] defaults,
# ${...} interpolation, extra_configs), so this check sees what the build sees.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_DIR="${1:-${ROOT_DIR}/firmware_esp8266}"
REQUIRED="eagle.flash.4m2m.ld"

die() {
  printf 'error: %s\n' "$*" >&2
  exit 2
}

[[ -f "${PROJECT_DIR}/platformio.ini" ]] || die "${PROJECT_DIR}/platformio.ini not found"
command -v pio >/dev/null 2>&1 || die "missing required command: pio (PlatformIO)"

CONFIG="$(pio project config -d "$PROJECT_DIR" --json-output)" ||
  die "PlatformIO could not read ${PROJECT_DIR}/platformio.ini"

printf '%s' "$CONFIG" | python3 -c '
import json, sys

required = sys.argv[1]
bad, checked = [], []
for section, options in json.load(sys.stdin):
    if not section.startswith("env:"):
        continue
    values = dict(options)
    # Covers espressif8266@x, platformio/espressif8266@x and repository URLs.
    if "espressif8266" not in str(values.get("platform", "")):
        continue
    checked.append(section)
    ldscript = values.get("board_build.ldscript")
    if ldscript != required:
        used = ldscript or "the board default"
        bad.append(f"[{section}] uses {used}")

if not checked:
    print("error: no ESP8266 environment found", file=sys.stderr)
    sys.exit(2)
if bad:
    print(f"flash layout: FAIL, every ESP8266 build must use {required} (issue #310)", file=sys.stderr)
    for line in bad:
        print(f"  {line}", file=sys.stderr)
    print("  Devices already sold keep the factory filesystem at 0x100000; another layout can mount it.", file=sys.stderr)
    sys.exit(1)
print(f"flash layout: ok, {len(checked)} ESP8266 builds use {required}")
' "$REQUIRED"
