#!/usr/bin/env bash
set -euo pipefail

PORT="${1:-/dev/cu.usbserial-10}"
IMAGE="${2:-}"
BAUD="${BAUD:-460800}"

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

echo "restore: port=$PORT image=$IMAGE baud=$BAUD"

pio pkg exec --package "platformio/tool-esptoolpy" -- \
  esptool.py --chip esp8266 --port "$PORT" --baud "$BAUD" \
  write_flash --flash_size detect 0x000000 "$IMAGE"

echo "restore complete"
