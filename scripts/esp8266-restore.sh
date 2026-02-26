#!/usr/bin/env bash
set -euo pipefail

PORT="${1:-/dev/cu.usbserial-10}"
IMAGE="${2:-}"
BAUD="${BAUD:-460800}"
MANIFEST="${MANIFEST:-${IMAGE}.manifest}"
SKIP_VERIFY="${SKIP_VERIFY:-0}"
LOG_FILE="/tmp/vibeblock-esptool.log"

if [[ -z "$IMAGE" ]]; then
  echo "usage: $0 <port> <backup.bin>" >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f "$IMAGE" ]]; then
  echo "error: image not found: $IMAGE" >&2
  exit 1
fi

holders="$(lsof "$PORT" 2>/dev/null || true)"
if [[ -n "$holders" ]]; then
  echo "error: serial port is busy: $PORT" >&2
  echo "$holders" >&2
  echo "hint: stop any daemon/monitor that keeps the port open and retry" >&2
  exit 1
fi

manifest_value() {
  local key="$1"
  if [[ ! -f "$MANIFEST" ]]; then
    return 1
  fi
  sed -n "s/^${key}=//p" "$MANIFEST" | head -n 1
}

compute_sha256() {
  shasum -a 256 "$1" | awk '{print $1}'
}

read_device_mac() {
  local mac_output mac
  mac_output="$(
    pio pkg exec --package "platformio/tool-esptoolpy" -- \
      esptool.py --chip esp8266 --port "$PORT" --baud "$BAUD" read_mac \
      2>&1 || true
  )"
  printf '%s\n' "$mac_output" >>"$LOG_FILE"
  mac="$(printf '%s\n' "$mac_output" | awk '/MAC:/{print $2; exit}')"
  if [[ -z "$mac" ]]; then
    return 1
  fi
  printf '%s\n' "$mac"
}

verify_manifest() {
  if [[ "$SKIP_VERIFY" == "1" ]]; then
    echo "verify: skipped (SKIP_VERIFY=1)"
    return 0
  fi

  if [[ ! -f "$MANIFEST" ]]; then
    echo "error: manifest not found: $MANIFEST" >&2
    echo "hint: run backup again to generate a manifest, or pass --skip-verify for legacy backups" >&2
    exit 1
  fi

  local expected_file expected_sha expected_mac actual_sha actual_mac
  expected_file="$(manifest_value "image_file" || true)"
  expected_sha="$(manifest_value "sha256" || true)"
  expected_mac="$(manifest_value "device_mac" || true)"

  if [[ -n "$expected_file" && "$expected_file" != "$(basename "$IMAGE")" ]]; then
    echo "error: manifest image mismatch expected=$expected_file actual=$(basename "$IMAGE")" >&2
    exit 1
  fi

  if [[ -z "$expected_sha" ]]; then
    echo "error: manifest missing sha256 entry: $MANIFEST" >&2
    exit 1
  fi

  actual_sha="$(compute_sha256 "$IMAGE")"
  if [[ "$actual_sha" != "$expected_sha" ]]; then
    echo "error: sha256 mismatch expected=$expected_sha actual=$actual_sha" >&2
    exit 1
  fi

  if [[ -n "$expected_mac" && "$expected_mac" != "unknown" ]]; then
    actual_mac="$(read_device_mac || true)"
    if [[ -z "$actual_mac" ]]; then
      echo "error: unable to read device MAC for verification" >&2
      exit 1
    fi
    if [[ "$(printf '%s' "$actual_mac" | tr '[:upper:]' '[:lower:]')" != "$(printf '%s' "$expected_mac" | tr '[:upper:]' '[:lower:]')" ]]; then
      echo "error: device MAC mismatch expected=$expected_mac actual=$actual_mac" >&2
      exit 1
    fi
  fi

  echo "verify: ok manifest=$MANIFEST sha256=$expected_sha device_mac=$expected_mac"
}

verify_manifest

echo "restore: port=$PORT image=$IMAGE baud=$BAUD"

pio pkg exec --package "platformio/tool-esptoolpy" -- \
  esptool.py --chip esp8266 --port "$PORT" --baud "$BAUD" \
  write_flash --flash_size detect 0x000000 "$IMAGE"

echo "restore complete"
