#!/usr/bin/env bash
set -euo pipefail

# Feeds synthetic flash dumps to vibetv-flash-leftovers.sh. Never opens a serial port.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="${ROOT_DIR}/scripts/vibetv-flash-leftovers.sh"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/vibetv-flash-leftovers-test.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

# The layout of eagle.flash.4m2m.ld: sketch region ends at 0x100000, filesystem starts at 0x200000.
cat >"${WORK}/layout.ld" <<'LD'
MEMORY
{
  irom0_0_seg :                         org = 0x40201010, len = 0xfeff0
}
PROVIDE ( _FS_start = 0x40400000 );
PROVIDE ( _FS_end = 0x405FA000 );
LD

python3 - "$WORK" <<'PY'
import os, sys
work = sys.argv[1]
size = 0x100000
erased = bytearray(b"\xff" * size)
open(f"{work}/erased.bin", "wb").write(erased)

# What the factory firmware leaves: a LittleFS superblock at the start of the region.
superblock = (b"\x01\x00\x00\x00" + b"\xf0\x0f\xff\xf7littlefs" + b"\x2f\xe0\x00\x10"
              + (0x00020000).to_bytes(4, "little") + (8192).to_bytes(4, "little") + (381).to_bytes(4, "little"))
vendor = bytearray(erased)
vendor[0:len(superblock)] = superblock
open(f"{work}/superblock.bin", "wb").write(vendor)

names = bytearray(erased)
names[0x4000:0x4011] = b"photo_config.json"
open(f"{work}/names.bin", "wb").write(names)

# A staged firmware image: random data that also contains the bare word "littlefs".
staged = bytearray(erased)
staged[0x80000:0x90000] = os.urandom(0x10000)
staged[0x80008:0x80010] = b"littlefs"
open(f"{work}/staged.bin", "wb").write(staged)
PY

expect() {
  local name="$1" want_status="$2" want_text="$3" status=0 output
  output="$("$SCRIPT" --ldscript "${WORK}/layout.ld" --dump "${WORK}/${name}.bin" 2>&1)" || status=$?
  [[ "$status" == "$want_status" ]] || die "${name}: exit ${status}, expected ${want_status}: ${output}"
  [[ "$output" == *"$want_text"* ]] || die "${name}: output lacks '${want_text}': ${output}"
}

expect erased 0 "region: 0x100000-0x200000 (1048576 bytes), 100.0% erased"
expect erased 0 "verdict: CLEAN"
expect superblock 1 "found: LittleFS superblock at 0x100000 (block_size 8192, block_count 381)"
expect superblock 1 "verdict: LEFTOVERS"
expect names 1 "found: factory file name photo_config.json at 0x104000"
expect staged 3 "93.8% erased"
expect staged 3 "verdict: NOT ERASED"

# The erase path refuses before it touches anything. /dev/null stands in for a
# port; the script must stop before it would open it.
mkdir "${WORK}/pkg"
printf 'fw' >"${WORK}/pkg/firmware.bin"
printf 'fs' >"${WORK}/pkg/littlefs.bin"
(cd "${WORK}/pkg" && shasum -a 256 firmware.bin littlefs.bin >SHA256SUMS)
refuse() {
  local want_text="$1" status=0 output
  shift
  output="$("$SCRIPT" --ldscript "${WORK}/layout.ld" "$@" 2>&1)" || status=$?
  [[ "$status" == "2" ]] || die "expected refusal (exit 2) for: $* -- got ${status}: ${output}"
  [[ "$output" == *"$want_text"* ]] || die "refusal for '$*' lacks '${want_text}': ${output}"
}
refuse "needs an explicit --port" --usb-erase --package-dir "${WORK}/pkg" --yes
refuse "refusing to erase without --yes" --usb-erase --port /dev/null --package-dir "${WORK}/pkg"
refuse "ERASE the whole flash" --usb-erase --port /dev/null --package-dir "${WORK}/pkg"
refuse "saved WiFi, pairing token" --usb-erase --port /dev/null --package-dir "${WORK}/pkg"
printf 'x' >>"${WORK}/pkg/firmware.bin"
refuse "package checksums do not match" --usb-erase --port /dev/null --package-dir "${WORK}/pkg" --yes

bash -n "$SCRIPT"
printf 'VibeTV flash leftovers tests passed\n'
