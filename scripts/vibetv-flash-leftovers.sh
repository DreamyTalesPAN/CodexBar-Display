#!/usr/bin/env bash
set -euo pipefail

# Checks the flash between the end of the sketch region and the start of our
# filesystem for leftovers of the factory firmware (issue #310), and offers an
# opt-in full USB erase + reflash. Nothing here is part of the default
# provisioning flow.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_DIR="${ROOT_DIR}/firmware_esp8266"
ENV_NAME="esp8266_smalltv_st7789"
BAUD=115200            # 460800 failed on the bench
CHUNK=$((256 * 1024))

port=""
dump=""
ldscript=""
package_dir=""
usb_erase=0
assume_yes=0

usage() {
  cat <<'EOF'
Usage:
  vibetv-flash-leftovers.sh --port <serial-port>
  vibetv-flash-leftovers.sh --dump <file>
  vibetv-flash-leftovers.sh --usb-erase --port <serial-port> --package-dir <dir> --yes

--port       Read-only: reads the flash between the sketch region and our
             filesystem over USB (115200 baud, 256 KB chunks) and reports
             what is there. Nothing is written.
--dump       Judge an existing dump of that region instead of reading a device.
--usb-erase  Erases the WHOLE flash, writes firmware.bin and littlefs.bin from
             a package built by `vibetv-provision.sh build`, then runs the
             check. The device loses its saved WiFi, pairing, themes and
             settings. Needs --port, --package-dir and --yes.
--ldscript   Linker script to take the layout from. Default: the one named by
             board_build.ldscript in firmware_esp8266/platformio.ini.

Exit codes:
  0  CLEAN: the region is fully erased
  1  LEFTOVERS: factory leftovers found
  2  usage or setup error (bad arguments, missing file or tool, bad package,
     a dump whose length is not the region's)
  3  NOT ERASED: other data found (for example a firmware image staged by an
     earlier update)
  4  serial error: port busy, esptool failed, or the read came back short.
     No verdict was reached.
EOF
}

die() {
  printf 'error: %s\n' "$*" >&2
  exit 2
}

serial_error() {
  printf 'error: %s\n' "$*" >&2
  exit 4
}

tmp_dump=""
cleanup() {
  if [[ -n "$tmp_dump" ]]; then
    rm -f "$tmp_dump" "${tmp_dump}.part"
  fi
}
trap cleanup EXIT

while [[ $# -gt 0 ]]; do
  case "$1" in
    --port|--dump|--ldscript|--package-dir)
      [[ $# -ge 2 && -n "$2" ]] || { usage >&2; die "$1 needs a value"; } ;;
  esac
  case "$1" in
    --port) port="${2:-}"; shift 2 ;;
    --dump) dump="${2:-}"; shift 2 ;;
    --ldscript) ldscript="${2:-}"; shift 2 ;;
    --package-dir) package_dir="${2:-}"; shift 2 ;;
    --usb-erase) usb_erase=1; shift ;;
    --yes) assume_yes=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; die "unknown argument: $1" ;;
  esac
done

# Layout from the linker script the firmware is really built with: the sketch
# region ends where irom0_0_seg ends, our filesystem lives in _FS_start.._FS_end.
if [[ -z "$ldscript" ]]; then
  ld_name="$(awk -v env="[env:${ENV_NAME}]" '
    /^\[/ { in_env = ($0 == env) }
    in_env && /^board_build\.ldscript/ { sub(/^[^=]*=[ \t]*/, ""); print; exit }
  ' "${PROJECT_DIR}/platformio.ini")"
  [[ -n "$ld_name" ]] || die "no board_build.ldscript for ${ENV_NAME} in platformio.ini"
  ldscript="${PLATFORMIO_CORE_DIR:-$HOME/.platformio}/packages/framework-arduinoespressif8266/tools/sdk/ld/${ld_name}"
fi
[[ -f "$ldscript" ]] || die "linker script not found: $ldscript (build the firmware once, or pass --ldscript)"

FLASH_BASE=$((0x40200000))
irom="$(sed -n 's/.*irom0_0_seg *: *org *= *\(0x[0-9A-Fa-f]*\), *len *= *\(0x[0-9A-Fa-f]*\).*/\1 \2/p' "$ldscript")"
fs_start_abs="$(sed -n 's/.*PROVIDE *( *_FS_start *= *\(0x[0-9A-Fa-f]*\).*/\1/p' "$ldscript")"
fs_end_abs="$(sed -n 's/.*PROVIDE *( *_FS_end *= *\(0x[0-9A-Fa-f]*\).*/\1/p' "$ldscript")"
[[ -n "$irom" && -n "$fs_start_abs" && -n "$fs_end_abs" ]] || die "cannot read the flash layout from $ldscript"
region_start=$(( ${irom% *} + ${irom#* } - FLASH_BASE ))
fs_start=$(( fs_start_abs - FLASH_BASE ))
fs_end=$(( fs_end_abs - FLASH_BASE ))
region_size=$(( fs_start - region_start ))
(( region_size > 0 )) || die "no gap between sketch region and filesystem in $ldscript"

esptool() {
  (cd "$ROOT_DIR" && pio pkg exec --package "platformio/tool-esptoolpy" -- \
    esptool.py --chip esp8266 --port "$port" --baud "$BAUD" "$@")
}

require_free_port() {
  [[ -n "$port" ]] || die "--port is required (for example /dev/cu.usbserial-10)"
  local holders
  holders="$(lsof "$port" 2>/dev/null || true)"
  if [[ -n "$holders" ]]; then
    printf '%s\n' "$holders" >&2
    serial_error "serial port is busy: $port (quit the VibeTV app and stop its background service)"
  fi
}

read_region() {
  local out="$1" offset size
  : >"$out"
  for (( offset = region_start; offset < fs_start; offset += CHUNK )); do
    size=$(( fs_start - offset < CHUNK ? fs_start - offset : CHUNK ))
    printf 'read: 0x%06x +%d bytes\n' "$offset" "$size"
    esptool --after hard_reset read_flash "$offset" "$size" "${out}.part" >/dev/null ||
      serial_error "$(printf 'reading 0x%06x +%d bytes from %s failed; no verdict' "$offset" "$size" "$port")"
    cat "${out}.part" >>"$out"
    rm -f "${out}.part"
  done
  local got
  got="$(wc -c <"$out" | tr -d ' ')"
  [[ "$got" == "$region_size" ]] ||
    serial_error "short read from ${port}: got ${got} of ${region_size} bytes; no verdict"
}

# Dump file -> verdict. The only part that decides anything; no hardware.
judge() {
  python3 - "$1" "$region_start" "$region_size" <<'PY'
import sys

path, base, want = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
data = open(path, "rb").read()
if len(data) != want:
    print(f"error: dump has {len(data)} bytes, the region 0x{base:06x}-0x{base + want:06x} has {want}; no verdict", file=sys.stderr)
    sys.exit(2)

erased = 100.0 * data.count(0xFF) / len(data)
print(f"region: 0x{base:06x}-0x{base + len(data):06x} ({len(data)} bytes), {erased:.1f}% erased")

# A LittleFS superblock: revision (4 bytes), the superblock name tag, "littlefs",
# an inline-struct tag, then version, block_size, block_count (little endian).
# The tag is required so that the bare word inside a staged firmware image does not count.
MAGIC = b"\xf0\x0f\xff\xf7littlefs"
foreign = False
at = data.find(MAGIC)
while at != -1:
    foreign = True
    block = at - 4
    block_size = int.from_bytes(data[block + 24:block + 28], "little")
    block_count = int.from_bytes(data[block + 28:block + 32], "little")
    print(f"found: LittleFS superblock at 0x{base + block:06x} (block_size {block_size}, block_count {block_count})")
    at = data.find(MAGIC, at + 1)
for name in (b"photo_config.json", b"theme_config.txt"):
    at = data.find(name)
    if at != -1:
        foreign = True
        print(f"found: factory file name {name.decode()} at 0x{base + at:06x}")

if foreign:
    print("verdict: LEFTOVERS - a foreign filesystem is in the unused flash region")
    sys.exit(1)
if data.count(0xFF) != len(data):
    print("verdict: NOT ERASED - data without a filesystem signature (for example a firmware image staged by an earlier update)")
    sys.exit(3)
print("verdict: CLEAN - the region is fully erased")
PY
}

check_device() {
  command -v pio >/dev/null 2>&1 || die "missing required command: pio"
  tmp_dump="$(mktemp "${TMPDIR:-/tmp}/vibetv-flash-region.XXXXXX")"
  read_region "$tmp_dump"
  local status=0
  judge "$tmp_dump" || status=$?
  return "$status"
}

if [[ -n "$dump" ]]; then
  [[ "$usb_erase" == "0" && -z "$port" ]] || die "--dump cannot be combined with --port or --usb-erase"
  [[ -f "$dump" ]] || die "dump not found: $dump"
  judge "$dump"
  exit
fi

if [[ "$usb_erase" == "0" ]]; then
  require_free_port
  check_device
  exit
fi

[[ -n "$port" ]] || die "--usb-erase needs an explicit --port"
[[ -n "$package_dir" ]] || die "--usb-erase needs --package-dir (from vibetv-provision.sh build)"
firmware="${package_dir}/firmware.bin"
filesystem="${package_dir}/littlefs.bin"
[[ -f "$firmware" && -f "$filesystem" && -f "${package_dir}/SHA256SUMS" ]] ||
  die "package needs firmware.bin, littlefs.bin and SHA256SUMS: $package_dir"
for name in firmware.bin littlefs.bin; do
  listed="$(awk -v name="$name" '$2 == name || $2 == "*" name { print $1 }' "${package_dir}/SHA256SUMS")"
  [[ -n "$listed" ]] || die "SHA256SUMS does not list ${name}: $package_dir"
  [[ "$listed" == "$(shasum -a 256 "${package_dir}/${name}" | awk '{print $1}')" ]] ||
    die "package checksums do not match for ${name}: $package_dir"
done
firmware_bytes="$(wc -c <"$firmware" | tr -d ' ')"
filesystem_bytes="$(wc -c <"$filesystem" | tr -d ' ')"
(( firmware_bytes <= region_start )) || die "firmware.bin (${firmware_bytes} bytes) does not fit the sketch region"
(( filesystem_bytes <= fs_end - fs_start )) || die "littlefs.bin (${filesystem_bytes} bytes) does not fit the filesystem region"

cat <<EOF
usb-erase: port ${port}
  1. ERASE the whole flash of the device on that port. Lost for good:
     saved WiFi, pairing token, installed themes, brightness and all other
     settings, plus everything the factory firmware left behind.
  2. Write ${firmware} (${firmware_bytes} bytes) at 0x000000.
  3. Write ${filesystem} (${filesystem_bytes} bytes) at $(printf '0x%06x' "$fs_start").
  4. Read $(printf '0x%06x-0x%06x' "$region_start" "$fs_start") back and require it to be clean.
The device must be set up again over the USB cable afterwards.
EOF
[[ "$assume_yes" == "1" ]] || die "refusing to erase without --yes"
require_free_port
command -v pio >/dev/null 2>&1 || die "missing required command: pio"

esptool erase_flash || serial_error "erasing the flash on ${port} failed"
esptool write_flash --flash_size detect 0x000000 "$firmware" "$(printf '0x%06x' "$fs_start")" "$filesystem" ||
  serial_error "writing firmware and filesystem to ${port} failed; the device is erased and has to be written again"
status=0
check_device || status=$?
if [[ "$status" != "0" ]]; then
  printf 'usb-erase: FAIL - the region is not clean after erase and write\n' >&2
  exit "$status"
fi
printf 'usb-erase: PASS\n'
