#!/usr/bin/env bash
set -euo pipefail

PORT="${1:-/dev/cu.usbserial-10}"
DEFAULT_BACKUP_DIR="${CODEXBAR_DISPLAY_BACKUP_DIR:-$HOME/Library/Application Support/codexbar-display/backups}"
OUT="${2:-$DEFAULT_BACKUP_DIR/weather_backup_$(date +%Y%m%d_%H%M%S).bin}"
FLASH_SIZE_INPUT="${3:-0x400000}"

CHUNK_SIZE_INPUT="0x4000"
MAX_ATTEMPTS=6
FAST_BAUD=460800
SLOW_BAUD=115200
READ_TIMEOUT_TICKS=60
LOG_FILE="/tmp/codexbar-display-esptool.log"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

TOTAL_BYTES=$((FLASH_SIZE_INPUT))
CHUNK_BYTES=$((CHUNK_SIZE_INPUT))

check_port_available() {
  local holders
  holders="$(lsof "$PORT" 2>/dev/null || true)"
  if [[ -n "$holders" ]]; then
    echo "error: serial port is busy: $PORT" >&2
    echo "$holders" >&2
    echo "hint: stop any daemon/monitor that keeps the port open and retry" >&2
    exit 1
  fi
}

if (( TOTAL_BYTES <= 0 )); then
  echo "error: invalid flash size '$FLASH_SIZE_INPUT'" >&2
  exit 1
fi

if (( CHUNK_BYTES <= 0 || TOTAL_BYTES % CHUNK_BYTES != 0 )); then
  echo "error: flash size must be divisible by chunk size" >&2
  exit 1
fi

CHUNKS_TOTAL=$((TOTAL_BYTES / CHUNK_BYTES))
OUT_DIR="$(dirname "$OUT")"
CHUNK_DIR="${OUT}.chunks"

mkdir -p "$OUT_DIR" "$CHUNK_DIR"

compute_sha256() {
  shasum -a 256 "$1" | awk '{print $1}'
}

read_device_mac() {
  local mac_output mac
  mac_output="$(
    pio pkg exec --package "platformio/tool-esptoolpy" -- \
      esptool.py --chip esp8266 --port "$PORT" --baud "$SLOW_BAUD" read_mac \
      2>&1 || true
  )"
  printf '%s\n' "$mac_output" >>"$LOG_FILE"
  mac="$(printf '%s\n' "$mac_output" | awk '/MAC:/{print $2; exit}')"
  if [[ -z "$mac" ]]; then
    return 1
  fi
  printf '%s\n' "$mac"
}

run_chunk_read() {
  local baud="$1"
  local offset_hex="$2"
  local part_file="$3"

  pio pkg exec --package "platformio/tool-esptoolpy" -- \
    esptool.py --chip esp8266 --port "$PORT" --baud "$baud" \
    read_flash "$offset_hex" "$CHUNK_SIZE_INPUT" "$part_file" \
    >"$LOG_FILE" 2>&1 &

  local pid=$!
  local ticks=0
  while kill -0 "$pid" 2>/dev/null; do
    sleep 0.5
    ticks=$((ticks + 1))
    if (( ticks >= READ_TIMEOUT_TICKS )); then
      kill -9 "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
      return 124
    fi
  done

  wait "$pid"
}

echo "backup: port=$PORT size=$FLASH_SIZE_INPUT chunks=$CHUNKS_TOTAL out=$OUT"
check_port_available

chunk_index=0
for ((offset=0; offset<TOTAL_BYTES; offset+=CHUNK_BYTES)); do
  chunk_index=$((chunk_index + 1))
  offset_hex="$(printf '0x%06x' "$offset")"
  part_file="$(printf '%s/chunk_%06x.bin' "$CHUNK_DIR" "$offset")"

  if [[ -f "$part_file" ]] && [[ "$(wc -c < "$part_file")" -eq "$CHUNK_BYTES" ]]; then
    continue
  fi

  ok=0
  for ((attempt=1; attempt<=MAX_ATTEMPTS; attempt++)); do
    if run_chunk_read "$FAST_BAUD" "$offset_hex" "$part_file"; then
      if [[ "$(wc -c < "$part_file")" -eq "$CHUNK_BYTES" ]]; then
        ok=1
        break
      fi
    fi

    if run_chunk_read "$SLOW_BAUD" "$offset_hex" "$part_file"; then
      if [[ "$(wc -c < "$part_file")" -eq "$CHUNK_BYTES" ]]; then
        ok=1
        break
      fi
    fi

    sleep 0.15
  done

  if (( ok != 1 )); then
    echo "error: failed chunk $chunk_index/$CHUNKS_TOTAL offset=$offset_hex" >&2
    tail -n 40 "$LOG_FILE" || true
    exit 1
  fi

  if (( chunk_index % 16 == 0 )); then
    done_files="$(ls "$CHUNK_DIR"/chunk_*.bin 2>/dev/null | wc -l | tr -d ' ')"
    echo "progress: chunk=$chunk_index/$CHUNKS_TOTAL files=$done_files"
  fi
done

cat "$CHUNK_DIR"/chunk_*.bin > "$OUT"

bytes="$(wc -c < "$OUT")"
if [[ "$bytes" -ne "$TOTAL_BYTES" ]]; then
  echo "error: backup size mismatch expected=$TOTAL_BYTES got=$bytes" >&2
  exit 1
fi

echo "done: $OUT"
wc -c "$OUT"

sha256="$(compute_sha256 "$OUT")"
device_mac="$(read_device_mac || true)"
if [[ -z "$device_mac" ]]; then
  device_mac="unknown"
fi
created_at_utc="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
manifest_path="${OUT}.manifest"

{
  printf 'schema=v1\n'
  printf 'image_file=%s\n' "$(basename "$OUT")"
  printf 'image_path=%s\n' "$OUT"
  printf 'size_bytes=%s\n' "$bytes"
  printf 'sha256=%s\n' "$sha256"
  printf 'chip=esp8266\n'
  printf 'device_mac=%s\n' "$device_mac"
  printf 'created_at_utc=%s\n' "$created_at_utc"
} >"$manifest_path"

echo "sha256: $sha256"
echo "device_mac: $device_mac"
echo "manifest: $manifest_path"
