#!/usr/bin/env bash
# The merge gate and the release candidate ship the same roles under different
# directories and, for the firmware, under different file names. Both have to
# resolve, because only the release candidate builds an exact main SHA and main
# is the only releasable state.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/vibetv-rehearsal.sh
source "$script_dir/lib/vibetv-rehearsal.sh"

tmp_dir="$(mktemp -d)"
cleanup() { rm -rf "$tmp_dir"; }
trap cleanup EXIT

failures=0
fail() { printf 'FAIL: %s\n' "$1" >&2; failures=$((failures + 1)); }

digest() { shasum -a 256 "$1" | awk '{print $1}'; }

expect_equal() {
  local label="$1" want="$2" got="$3"
  [[ "$want" == "$got" ]] || fail "$label: expected '$want', got '$got'"
}

# --- merge gate layout: bare names in the manifest, firmware.bin ------------
gate="$tmp_dir/gate"
mkdir -p "$gate/dist/macos" "$gate/tmp/vibetv-merge"
printf 'dmg\n' > "$gate/dist/macos/VibeTV-Control-Center.dmg"
printf 'appcast\n' > "$gate/dist/macos/appcast.xml"
printf 'firmware\n' > "$gate/tmp/vibetv-merge/firmware.bin"
cat > "$gate/tmp/vibetv-merge/firmware-manifest.json" <<JSON
{"schemaVersion":1,"artifacts":[{"firmwareEnv":"esp8266_smalltv_st7789","board":"esp8266-smalltv-st7789","firmwareVersion":"9999.0.63","asset":"firmware.bin","firmwareUrl":"firmware.bin"}]}
JSON
cat > "$gate/dist/macos/candidate-manifest.json" <<JSON
{"schemaVersion":1,"sourceSha":"1111111111111111111111111111111111111111","version":"9999.0.63","artifacts":[
{"name":"VibeTV-Control-Center.dmg","path":"VibeTV-Control-Center.dmg","sha256":"$(digest "$gate/dist/macos/VibeTV-Control-Center.dmg")","role":"signed-dmg"},
{"name":"appcast.xml","path":"appcast.xml","sha256":"$(digest "$gate/dist/macos/appcast.xml")","role":"sparkle-appcast"},
{"name":"firmware.bin","path":"firmware.bin","sha256":"$(digest "$gate/tmp/vibetv-merge/firmware.bin")","role":"firmware"},
{"name":"firmware-manifest.json","path":"firmware-manifest.json","sha256":"$(digest "$gate/tmp/vibetv-merge/firmware-manifest.json")","role":"firmware-manifest"}]}
JSON

CANDIDATE_DIR="$gate"
CANDIDATE_MANIFEST="$gate/dist/macos/candidate-manifest.json"
rehearsal::resolve_candidate_artifacts >/dev/null
expect_equal 'merge gate dmg' "$gate/dist/macos/VibeTV-Control-Center.dmg" "$CANDIDATE_DMG"
expect_equal 'merge gate appcast' "$gate/dist/macos/appcast.xml" "$CANDIDATE_APPCAST"
expect_equal 'merge gate firmware' "$gate/tmp/vibetv-merge/firmware.bin" "$CANDIDATE_FIRMWARE"
expect_equal 'merge gate firmware manifest' "$gate/tmp/vibetv-merge/firmware-manifest.json" "$CANDIDATE_FIRMWARE_MANIFEST"

# --- release candidate layout: real paths, gzipped per-version firmware,
# --- and a second board that must not be picked ------------------------------
rc="$tmp_dir/rc"
mkdir -p "$rc/publish/macos" "$rc/publish/firmware" "$rc/test"
printf 'rc dmg\n' > "$rc/publish/macos/VibeTV-Control-Center.dmg"
printf 'rc appcast\n' > "$rc/publish/macos/appcast.xml"
printf 'rc esp8266\n' > "$rc/publish/firmware/codexbar-display-firmware-esp8266_smalltv_st7789-v1.0.54.bin.gz"
printf 'rc esp32\n' > "$rc/publish/firmware/codexbar-display-firmware-esp32_display-v1.0.54.bin.gz"
cat > "$rc/publish/firmware/firmware-manifest.json" <<JSON
{"schemaVersion":1,"release":"v1.0.54","artifacts":[
{"firmwareEnv":"esp32_display","board":"esp32-display","firmwareVersion":"1.0.54","asset":"codexbar-display-firmware-esp32_display-v1.0.54.bin.gz","firmwareUrl":"codexbar-display-firmware-esp32_display-v1.0.54.bin.gz"},
{"firmwareEnv":"esp8266_smalltv_st7789","board":"esp8266-smalltv-st7789","firmwareVersion":"1.0.54","asset":"codexbar-display-firmware-esp8266_smalltv_st7789-v1.0.54.bin.gz","firmwareUrl":"codexbar-display-firmware-esp8266_smalltv_st7789-v1.0.54.bin.gz"}]}
JSON
cat > "$rc/candidate-manifest.json" <<JSON
{"schemaVersion":1,"sourceSha":"2222222222222222222222222222222222222222","version":"1.0.54","artifacts":[
{"name":"VibeTV-Control-Center.dmg","path":"publish/macos/VibeTV-Control-Center.dmg","sha256":"$(digest "$rc/publish/macos/VibeTV-Control-Center.dmg")","role":"signed-dmg","publish":true},
{"name":"appcast.xml","path":"publish/macos/appcast.xml","sha256":"$(digest "$rc/publish/macos/appcast.xml")","role":"sparkle-appcast","publish":true},
{"name":"codexbar-display-firmware-esp32_display-v1.0.54.bin.gz","path":"publish/firmware/codexbar-display-firmware-esp32_display-v1.0.54.bin.gz","sha256":"$(digest "$rc/publish/firmware/codexbar-display-firmware-esp32_display-v1.0.54.bin.gz")","role":"firmware","publish":true},
{"name":"codexbar-display-firmware-esp8266_smalltv_st7789-v1.0.54.bin.gz","path":"publish/firmware/codexbar-display-firmware-esp8266_smalltv_st7789-v1.0.54.bin.gz","sha256":"$(digest "$rc/publish/firmware/codexbar-display-firmware-esp8266_smalltv_st7789-v1.0.54.bin.gz")","role":"firmware","publish":true},
{"name":"firmware-manifest.json","path":"publish/firmware/firmware-manifest.json","sha256":"$(digest "$rc/publish/firmware/firmware-manifest.json")","role":"firmware-manifest","publish":true}]}
JSON

CANDIDATE_DIR="$rc"
CANDIDATE_MANIFEST="$rc/candidate-manifest.json"
rehearsal::resolve_candidate_artifacts >/dev/null
expect_equal 'release candidate dmg' "$rc/publish/macos/VibeTV-Control-Center.dmg" "$CANDIDATE_DMG"
expect_equal 'release candidate appcast' "$rc/publish/macos/appcast.xml" "$CANDIDATE_APPCAST"
expect_equal 'release candidate firmware for this board' \
  "$rc/publish/firmware/codexbar-display-firmware-esp8266_smalltv_st7789-v1.0.54.bin.gz" "$CANDIDATE_FIRMWARE"
expect_equal 'release candidate firmware manifest' "$rc/publish/firmware/firmware-manifest.json" "$CANDIDATE_FIRMWARE_MANIFEST"

# The served file name is what the rewritten firmwareUrl points at.
expect_equal 'served firmware name' \
  'codexbar-display-firmware-esp8266_smalltv_st7789-v1.0.54.bin.gz' "$(basename "$CANDIDATE_FIRMWARE")"

# --- a corrupted download must not be rehearsed -----------------------------
# In a subshell, because the failure path calls rehearsal::die, which exits.
printf 'tampered\n' > "$rc/publish/macos/VibeTV-Control-Center.dmg"
if (rehearsal::resolve_candidate_artifacts) >/dev/null 2>&1; then
  fail 'a checksum mismatch was accepted'
fi

if [[ "$failures" -gt 0 ]]; then
  printf '\n%d check(s) failed\n' "$failures" >&2
  exit 1
fi
printf 'candidate layout resolution: all checks passed\n'
