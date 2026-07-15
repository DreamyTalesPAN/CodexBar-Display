#!/usr/bin/env bash
set -euo pipefail

STATE=""
VERSION=""
APP="/Applications/VibeTV Control Center.app"

die() {
  printf 'error: snapshot preparation: %s\n' "$*" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --state) STATE="$2"; shift 2 ;;
    --version) VERSION="${2#v}"; shift 2 ;;
    *) die "unknown argument: $1" ;;
  esac
done

[[ "$STATE" == "native" || "$STATE" == "legacy" ]] || die "state must be native or legacy"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]] || die "valid version required"
[[ "$(uname -s)" == "Darwin" ]] || die "macOS guest required"

rm -rf "$HOME/Library/Application Support/codexbar-display"
rm -f "$HOME/Library/Preferences/shop.vibetv.control-center.plist"
launchctl bootout "gui/$(id -u)/shop.vibetv.control-center.runtime" >/dev/null 2>&1 || true
launchctl bootout "gui/$(id -u)/com.codexbar-display.daemon" >/dev/null 2>&1 || true
launchctl bootout "gui/$(id -u)/com.codexbar-display.companion-api" >/dev/null 2>&1 || true
rm -rf "$APP" "$HOME/Applications/VibeTV Control Center.app"

if [[ "$STATE" == "native" ]]; then
  work="$(mktemp -d "${TMPDIR:-/tmp}/vibetv-native-snapshot.XXXXXX")"
  mount=""
  cleanup() {
    [[ -z "$mount" ]] || hdiutil detach "$mount" -quiet >/dev/null 2>&1 || true
    rm -rf "$work"
  }
  trap cleanup EXIT HUP INT TERM
  url="https://github.com/DreamyTalesPAN/CodexBar-Display/releases/download/v${VERSION}/VibeTV-Control-Center.dmg"
  curl -fsSL "$url" -o "$work/public.dmg"
  hdiutil attach -readonly -nobrowse -plist "$work/public.dmg" > "$work/attach.plist"
  mount="$(python3 - "$work/attach.plist" <<'PY'
import plistlib, sys
for entity in plistlib.load(open(sys.argv[1], "rb")).get("system-entities", []):
    if entity.get("mount-point"):
        print(entity["mount-point"])
        break
PY
)"
  source_app="$mount/VibeTV Control Center.app"
  [[ -d "$source_app" ]] || die "public DMG has no app bundle"
  codesign --verify --deep --strict --verbose=2 "$source_app"
  ditto "$source_app" "$APP"
  open "$APP"
else
  installer="https://github.com/DreamyTalesPAN/CodexBar-Display/releases/download/v${VERSION}/install-control-center-companion.sh"
  curl -fsSL "$installer" | bash -s -- \
    --version "$VERSION" \
    --skip-device-setup \
    --addr 127.0.0.1:47832
fi

deadline=$((SECONDS + 120))
while (( SECONDS < deadline )); do
  if status="$(curl -fsS http://127.0.0.1:47832/v1/status 2>/dev/null)"; then
    if python3 - "$VERSION" "$status" <<'PY'
import json, sys
status = json.loads(sys.argv[2])
companion = status.get("companion") or {}
raise SystemExit(0 if str(companion.get("version", "")).removeprefix("v") == sys.argv[1] else 1)
PY
    then
      printf 'Prepared %s snapshot at version %s\n' "$STATE" "$VERSION"
      exit 0
    fi
  fi
  sleep 2
done
die "prepared state did not become healthy"
