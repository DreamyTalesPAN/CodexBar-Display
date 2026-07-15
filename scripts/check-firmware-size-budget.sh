#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 5 ] || [ "$#" -gt 7 ]; then
  echo "usage: $0 <build_log> <firmware_bin> <env_name> <max_flash_pct> <max_ram_pct> [max_bin_bytes] [max_gzip_bytes]" >&2
  exit 2
fi

build_log="$1"
bin_path="$2"
env_name="$3"
max_flash_pct="$4"
max_ram_pct="$5"
max_bin_bytes="${6:-0}"
max_gzip_bytes="${7:-0}"

if [ ! -f "$build_log" ]; then
  echo "firmware build log not found: $build_log" >&2
  exit 2
fi
if [ ! -f "$bin_path" ]; then
  echo "firmware binary not found: $bin_path" >&2
  exit 2
fi

ram_pct="$(sed -nE 's/^RAM:[^0-9]*([0-9]+(\.[0-9]+)?)%.*/\1/p' "$build_log" | tail -n 1)"
flash_pct="$(sed -nE 's/^Flash:[^0-9]*([0-9]+(\.[0-9]+)?)%.*/\1/p' "$build_log" | tail -n 1)"

if [ -z "$ram_pct" ] || [ -z "$flash_pct" ]; then
  echo "failed to parse RAM/Flash percentage from build log for env=$env_name" >&2
  exit 1
fi

ram_ok="$(awk -v used="$ram_pct" -v max="$max_ram_pct" 'BEGIN{if (used <= max) print "1"; else print "0"}')"
flash_ok="$(awk -v used="$flash_pct" -v max="$max_flash_pct" 'BEGIN{if (used <= max) print "1"; else print "0"}')"

echo "budget env=$env_name ram=${ram_pct}%/${max_ram_pct}% flash=${flash_pct}%/${max_flash_pct}%"

bin_bytes="$(wc -c <"$bin_path" | tr -d ' ')"
bin_ok="1"
if [ "$max_bin_bytes" != "0" ]; then
  bin_ok="$(awk -v used="$bin_bytes" -v max="$max_bin_bytes" 'BEGIN{if (used <= max) print "1"; else print "0"}')"
  echo "budget env=$env_name bin=${bin_bytes}/${max_bin_bytes} bytes"
else
  echo "budget env=$env_name bin=${bin_bytes} bytes"
fi

gzip_path="$(mktemp "${TMPDIR:-/tmp}/vibetv-firmware-size.XXXXXX.gz")"
trap 'rm -f "$gzip_path"' EXIT
gzip -c -9 "$bin_path" > "$gzip_path"
gzip_bytes="$(wc -c <"$gzip_path" | tr -d ' ')"
gzip_ok="1"
if [ "$max_gzip_bytes" != "0" ]; then
  gzip_ok="$(awk -v used="$gzip_bytes" -v max="$max_gzip_bytes" 'BEGIN{if (used <= max) print "1"; else print "0"}')"
  echo "budget env=$env_name gzip=${gzip_bytes}/${max_gzip_bytes} bytes"
else
  echo "budget env=$env_name gzip=${gzip_bytes} bytes"
fi

if [ "$ram_ok" != "1" ] || [ "$flash_ok" != "1" ] || [ "$bin_ok" != "1" ] || [ "$gzip_ok" != "1" ]; then
  echo "firmware size budget exceeded for env=$env_name" >&2
  exit 1
fi
