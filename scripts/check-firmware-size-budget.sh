#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 4 ]; then
  echo "usage: $0 <firmware_dir> <env_name> <max_flash_pct> <max_ram_pct>" >&2
  exit 2
fi

firmware_dir="$1"
env_name="$2"
max_flash_pct="$3"
max_ram_pct="$4"

if [ ! -d "$firmware_dir" ]; then
  echo "firmware dir not found: $firmware_dir" >&2
  exit 2
fi

output="$(cd "$firmware_dir" && pio run -e "$env_name" 2>&1)"
echo "$output"

ram_pct="$(echo "$output" | sed -nE 's/^RAM:[^0-9]*([0-9]+(\.[0-9]+)?)%.*/\1/p' | tail -n 1)"
flash_pct="$(echo "$output" | sed -nE 's/^Flash:[^0-9]*([0-9]+(\.[0-9]+)?)%.*/\1/p' | tail -n 1)"

if [ -z "$ram_pct" ] || [ -z "$flash_pct" ]; then
  echo "failed to parse RAM/Flash percentage from build output for env=$env_name" >&2
  exit 1
fi

ram_ok="$(awk -v used="$ram_pct" -v max="$max_ram_pct" 'BEGIN{if (used <= max) print "1"; else print "0"}')"
flash_ok="$(awk -v used="$flash_pct" -v max="$max_flash_pct" 'BEGIN{if (used <= max) print "1"; else print "0"}')"

echo "budget env=$env_name ram=${ram_pct}%/${max_ram_pct}% flash=${flash_pct}%/${max_flash_pct}%"

if [ "$ram_ok" != "1" ] || [ "$flash_ok" != "1" ]; then
  echo "firmware size budget exceeded for env=$env_name" >&2
  exit 1
fi
