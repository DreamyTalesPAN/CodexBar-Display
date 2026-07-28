#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DMG=""
APPCAST=""
VIRTUAL_VIBETV=""
FIRMWARE=""
VERSION=""
STATE=""
OUTPUT=""
BASELINE_DMG=""
BASELINE_APPCAST=""

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dmg) DMG="${2:-}"; shift 2 ;;
    --appcast) APPCAST="${2:-}"; shift 2 ;;
    --virtual-vibetv) VIRTUAL_VIBETV="${2:-}"; shift 2 ;;
    --firmware) FIRMWARE="${2:-}"; shift 2 ;;
    --version) VERSION="${2#v}"; shift 2 ;;
    --state) STATE="${2:-}"; shift 2 ;;
    --output) OUTPUT="${2:-}"; shift 2 ;;
    --baseline-dmg) BASELINE_DMG="${2:-}"; shift 2 ;;
    --baseline-appcast) BASELINE_APPCAST="${2:-}"; shift 2 ;;
    *) die "unknown argument: $1" ;;
  esac
done

[[ -f "$DMG" ]] || die '--dmg must name the signed candidate DMG'
[[ -f "$APPCAST" ]] || die '--appcast must name the signed candidate appcast'
[[ -x "$VIRTUAL_VIBETV" ]] || die '--virtual-vibetv must name the Core-provided executable'
[[ -f "$FIRMWARE" ]] || die '--firmware must name the candidate firmware image'
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]] || die '--version must be SemVer'
[[ "$STATE" == clean_os || "$STATE" == current_public || "$STATE" == previous_public ]] || die '--state is invalid'
[[ -n "$OUTPUT" && ! -e "$OUTPUT" ]] || die '--output must be a new directory'
[[ "$(uname -s)" == Darwin ]] || die 'hosted guest test requires macOS'
if [[ "$STATE" == clean_os ]]; then
  [[ -z "$BASELINE_DMG" && -z "$BASELINE_APPCAST" ]] || die 'clean_os must not receive a public baseline'
else
  [[ -f "$BASELINE_DMG" && -f "$BASELINE_APPCAST" ]] || die 'public states require a frozen baseline DMG and appcast'
fi

mkdir -p "$OUTPUT"
MOUNT="$(mktemp -d "${TMPDIR:-/tmp}/vibetv-hosted-mount.XXXXXX")"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/vibetv-hosted-guest.XXXXXX")"
VIRTUAL_PID=""
cleanup() {
  [[ -z "$VIRTUAL_PID" ]] || kill "$VIRTUAL_PID" >/dev/null 2>&1 || true
  [[ -z "$VIRTUAL_PID" ]] || wait "$VIRTUAL_PID" 2>/dev/null || true
  hdiutil detach "$MOUNT" -quiet >/dev/null 2>&1 || true
  rm -rf "$MOUNT" "$WORK"
}
trap cleanup EXIT HUP INT TERM

sw_vers > "$OUTPUT/macos-version.txt"
ps -axo pid=,ppid=,comm= > "$OUTPUT/processes-before.txt"
lsof -nP -iTCP@127.0.0.1:47832 -sTCP:LISTEN > "$OUTPUT/port-47832-before.txt" 2>&1 || true

if [[ -n "$BASELINE_DMG" ]]; then
  "$ROOT/scripts/verify-macos-control-center-dmg.sh" --dmg "$BASELINE_DMG" > "$OUTPUT/baseline-dmg-verification.txt" 2>&1
  python3 - "$BASELINE_APPCAST" "$OUTPUT/baseline-appcast-check.json" <<'PY'
import json
import sys
import xml.etree.ElementTree as ET

root = ET.parse(sys.argv[1]).getroot()
namespace = "{http://www.andymatuschak.org/xml-namespaces/sparkle}"
if not any(item.find("enclosure") is not None and item.find("enclosure").get(namespace + "edSignature") for item in root.findall("./channel/item")):
    raise SystemExit("public baseline appcast has no signed Sparkle enclosure")
with open(sys.argv[2], "w", encoding="utf-8") as output:
    json.dump({"baseline": "signed-public-appcast"}, output)
    output.write("\n")
PY
fi

"$ROOT/scripts/verify-macos-control-center-dmg.sh" --dmg "$DMG" > "$OUTPUT/dmg-verification.txt" 2>&1
hdiutil attach -readonly -nobrowse -mountpoint "$MOUNT" "$DMG" > "$OUTPUT/dmg-mount.txt" 2>&1
APP="$MOUNT/VibeTV Control Center.app"
[[ -d "$APP" ]] || die 'candidate DMG has no VibeTV Control Center.app'
codesign --verify --deep --strict --verbose=2 "$APP" > "$OUTPUT/app-codesign.txt" 2>&1
plutil -extract CFBundleShortVersionString raw -o - "$APP/Contents/Info.plist" > "$OUTPUT/app-version.txt"
[[ "$(cat "$OUTPUT/app-version.txt")" == "$VERSION" ]] || die 'candidate app version does not match requested version'

python3 - "$APPCAST" "$VERSION" "$OUTPUT/appcast-check.json" <<'PY'
import json
import sys
import xml.etree.ElementTree as ET

appcast, version, output = sys.argv[1:]
root = ET.parse(appcast).getroot()
namespace = "{http://www.andymatuschak.org/xml-namespaces/sparkle}"
items = root.findall("./channel/item")
if not items:
    raise SystemExit("appcast has no item")
for item in items:
    enclosure = item.find("enclosure")
    if enclosure is None:
        continue
    if enclosure.get(namespace + "edSignature") and enclosure.get(namespace + "shortVersionString") == version:
        with open(output, "w", encoding="utf-8") as destination:
            json.dump({"sparkleUpdate": "signed-appcast-candidate", "version": version}, destination)
            destination.write("\n")
        break
else:
    raise SystemExit("appcast has no signed enclosure for the candidate version")
PY

# GitHub-hosted macOS runners are disposable guests. This test deliberately
# uses the real signed app and only a loopback Virtual VibeTV; it never reaches
# physical hardware. The Core branch supplies virtual-vibetv.
firmware_sha="$(shasum -a 256 "$FIRMWARE" | awk '{print $1}')"
"$VIRTUAL_VIBETV" \
  --addr 127.0.0.1:47834 \
  --firmware 0.0.0 \
  --candidate-firmware "$VERSION" \
  --expected-firmware-sha256 "$firmware_sha" \
  > "$OUTPUT/virtual-vibetv.log" 2>&1 &
VIRTUAL_PID=$!
for _ in $(seq 1 30); do
  curl --fail --silent --show-error http://127.0.0.1:47834/health > "$WORK/health.json" && break
  sleep 1
done
[[ -s "$WORK/health.json" ]] || die 'Virtual VibeTV did not become healthy'
curl --fail --silent --show-error http://127.0.0.1:47834/hello > "$OUTPUT/virtual-hello.json"
curl --fail --silent --show-error http://127.0.0.1:47834/health > "$OUTPUT/virtual-health-before.json"
curl --fail --silent --show-error \
  -H 'X-VibeTV-Token: virtual-pair-token' \
  -H 'Content-Type: application/json' \
  --data '{"provider":"vibetv","label":"Hosted gate"}' \
  http://127.0.0.1:47834/frame > "$OUTPUT/virtual-frame.txt"
curl --fail --silent --show-error \
  -H 'X-VibeTV-Token: virtual-pair-token' \
  --data-binary "@$FIRMWARE" \
  http://127.0.0.1:47834/update/firmware > "$OUTPUT/virtual-ota.txt"
for _ in $(seq 1 30); do
  curl --fail --silent --show-error http://127.0.0.1:47834/health > "$OUTPUT/virtual-health-after.json" && break
  sleep 1
done
curl --fail --silent --show-error http://127.0.0.1:47834/__virtual/state > "$OUTPUT/virtual-state.json"
python3 - "$OUTPUT/virtual-state.json" <<'PY'
import json
import sys

state = json.load(open(sys.argv[1], encoding="utf-8"))
if state.get("updateUploads") != 1 or state.get("framesAccepted", 0) < 1 or state.get("violations"):
    raise SystemExit("Virtual VibeTV did not record a healthy render/stream/OTA sequence")
PY

# The exact same firmware is now current. A second upload must be rejected,
# which is the no-op guard against a duplicate OTA after a transient response.
status="$(curl --silent --output "$OUTPUT/virtual-no-op.txt" --write-out '%{http_code}' \
  -H 'X-VibeTV-Token: virtual-pair-token' --data-binary "@$FIRMWARE" \
  http://127.0.0.1:47834/update/firmware)"
[[ "$status" == 409 ]] || die "Virtual VibeTV no-op OTA must return 409, got $status"

CODEX_ALLOW_MACOS_RUNTIME_VALIDATION=1 \
  "$ROOT/scripts/validate-macos-control-center-runtime.sh" \
  --real --app "$APP" --expected-version "$VERSION" \
  > "$OUTPUT/companion-port-47832.txt" 2>&1
ps -axo pid=,ppid=,comm= > "$OUTPUT/processes-after.txt"
lsof -nP -iTCP@127.0.0.1:47832 -sTCP:LISTEN > "$OUTPUT/port-47832-after.txt" 2>&1 || true
screencapture -x "$OUTPUT/guest-${STATE}.png"

python3 - "$OUTPUT/result.json" "$STATE" "$VERSION" <<'PY'
import json
import sys

with open(sys.argv[1], "w", encoding="utf-8") as output:
    json.dump({
        "schemaVersion": 1,
        "state": sys.argv[2],
        "version": sys.argv[3],
        "status": "passed",
        "checks": ["signed-dmg", "signed-app", "sparkle-update", "companion-port-47832", "virtual-health-render-stream-ota-no-op"],
    }, output, indent=2)
    output.write("\n")
PY
