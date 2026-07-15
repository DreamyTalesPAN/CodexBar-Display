#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
checker="${repo_root}/scripts/check-firmware-size-budget.sh"
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/vibetv-size-budget-test.XXXXXX")"
trap 'rm -rf "$tmp_dir"' EXIT

build_log="${tmp_dir}/build.log"
firmware_bin="${tmp_dir}/firmware.bin"
printf '%s\n' \
  'RAM:   [=====     ]  52.3% (used 42828 bytes from 81920 bytes)' \
  'Flash: [====      ]  43.6% (used 455419 bytes from 1044464 bytes)' > "$build_log"
printf 'firmware-test-payload' > "$firmware_bin"
before_hash="$(shasum -a 256 "$firmware_bin" | awk '{print $1}')"

"$checker" "$build_log" "$firmware_bin" test-env 46 82 100 100

after_hash="$(shasum -a 256 "$firmware_bin" | awk '{print $1}')"
if [ "$before_hash" != "$after_hash" ]; then
  echo "size checker changed the firmware binary" >&2
  exit 1
fi
if [ -e "${firmware_bin}.gz" ]; then
  echo "size checker left a generated artifact beside the firmware binary" >&2
  exit 1
fi
if "$checker" "$build_log" "$firmware_bin" test-env 40 82 100 100 >/dev/null 2>&1; then
  echo "size checker accepted an exceeded flash budget" >&2
  exit 1
fi

echo "firmware size budget tests passed"
