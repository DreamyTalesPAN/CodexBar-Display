#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 4 ] || [ "$#" -gt 5 ]; then
  echo "usage: $0 <firmware_dir> <env_name> <max_flash_pct> <max_ram_pct> [max_bin_bytes]" >&2
  exit 2
fi

firmware_dir="$1"
env_name="$2"
max_flash_pct="$3"
max_ram_pct="$4"
max_bin_bytes="${5:-0}"

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

bin_ok="1"
if [ "$max_bin_bytes" != "0" ]; then
  bin_path="${firmware_dir}/.pio/build/${env_name}/firmware.bin"
  if [ ! -f "$bin_path" ]; then
    echo "firmware binary not found: $bin_path" >&2
    exit 1
  fi
  bin_bytes="$(wc -c <"$bin_path" | tr -d ' ')"
  bin_ok="$(awk -v used="$bin_bytes" -v max="$max_bin_bytes" 'BEGIN{if (used <= max) print "1"; else print "0"}')"
  echo "budget env=$env_name bin=${bin_bytes}/${max_bin_bytes} bytes"
fi

if [ "$ram_ok" != "1" ] || [ "$flash_ok" != "1" ] || [ "$bin_ok" != "1" ]; then
  echo "firmware size budget exceeded for env=$env_name" >&2
  exit 1
fi
