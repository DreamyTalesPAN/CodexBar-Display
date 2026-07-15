#!/usr/bin/env bash
set -euo pipefail

APP_NAME="VibeTV Control Center"
INSTALL_APP="/Applications/${APP_NAME}.app"
DMG_URL="${VIBETV_CANDIDATE_DMG_URL:-http://127.0.0.1:47835/VibeTV-Control-Center.dmg}"
EXPECTED_VERSION=""
EXPECTED_BUILD="${VIBETV_CANDIDATE_BUILD:-}"
ADDR="127.0.0.1:47832"

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version) EXPECTED_VERSION="${2#v}"; shift 2 ;;
    --addr) ADDR="$2"; shift 2 ;;
    --skip-device-setup) shift ;;
    --dmg-url) DMG_URL="$2"; shift 2 ;;
    *) die "unknown candidate installer argument: $1" ;;
  esac
done

[[ "${CODEX_ALLOW_RELEASE_CANDIDATE_INSTALL:-}" == "1" ]] \
  || die "candidate install requires CODEX_ALLOW_RELEASE_CANDIDATE_INSTALL=1"
[[ "$EXPECTED_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]] \
  || die "candidate version is required"
[[ "$(uname -s)" == "Darwin" ]] || die "candidate install requires macOS"
for command in codesign curl ditto hdiutil lsof open plutil python3 spctl; do
  command -v "$command" >/dev/null 2>&1 || die "missing command: $command"
done

WORK="$(mktemp -d "${TMPDIR:-/tmp}/vibetv-candidate-install.XXXXXX")"
MOUNT=""
BACKUP=""
STAGED="/Applications/.${APP_NAME}.candidate.$$"
cleanup() {
  [[ -z "$MOUNT" ]] || hdiutil detach "$MOUNT" -quiet >/dev/null 2>&1 || true
  rm -rf "$WORK" "$STAGED"
}
trap cleanup EXIT HUP INT TERM

printf 'Downloading Mac App candidate...\n'
curl -fsSL "$DMG_URL" -o "$WORK/candidate.dmg"
attach_plist="$WORK/attach.plist"
hdiutil attach -readonly -nobrowse -plist "$WORK/candidate.dmg" > "$attach_plist"
MOUNT="$(plutil -extract system-entities xml1 -o - "$attach_plist" | python3 -c '
import plistlib, sys
entities = plistlib.load(sys.stdin.buffer)
for entity in entities:
    mount = entity.get("mount-point")
    if mount:
        print(mount)
        break
')"
SOURCE_APP="$MOUNT/${APP_NAME}.app"
[[ -d "$SOURCE_APP" ]] || die "candidate DMG does not contain ${APP_NAME}.app"
codesign --verify --deep --strict --verbose=2 "$SOURCE_APP"
spctl --assess --type execute --verbose=4 "$SOURCE_APP"

version="$(plutil -extract CFBundleShortVersionString raw -o - "$SOURCE_APP/Contents/Info.plist")"
build="$(plutil -extract CFBundleVersion raw -o - "$SOURCE_APP/Contents/Info.plist")"
[[ "${version#v}" == "$EXPECTED_VERSION" ]] \
  || die "candidate app version ${version:-missing} does not match ${EXPECTED_VERSION}"
[[ -z "$EXPECTED_BUILD" || "$build" == "$EXPECTED_BUILD" ]] \
  || die "candidate app build ${build:-missing} does not match ${EXPECTED_BUILD}"

printf 'Stopping current Mac App...\n'
pkill -x VibeTVControlCenter >/dev/null 2>&1 || true
sleep 1
ditto "$SOURCE_APP" "$STAGED"
codesign --verify --deep --strict --verbose=2 "$STAGED"

if [[ -e "$INSTALL_APP" ]]; then
  BACKUP="$WORK/${APP_NAME}.previous.app"
  mv "$INSTALL_APP" "$BACKUP"
fi
if ! mv "$STAGED" "$INSTALL_APP"; then
  [[ -z "$BACKUP" ]] || mv "$BACKUP" "$INSTALL_APP"
  die "could not replace app in /Applications"
fi

rollback() {
  rm -rf "$INSTALL_APP"
  [[ -z "$BACKUP" ]] || mv "$BACKUP" "$INSTALL_APP"
  [[ ! -d "$INSTALL_APP" ]] || open "$INSTALL_APP" >/dev/null 2>&1 || true
  die "$1"
}

printf 'Relaunching Mac App...\n'
open "$INSTALL_APP"
deadline=$((SECONDS + 120))
while (( SECONDS < deadline )); do
  if status="$(curl -fsS "http://${ADDR}/v1/status" 2>/dev/null)"; then
    if python3 - "$EXPECTED_VERSION" "$status" <<'PY'
import json, sys
expected = sys.argv[1]
status = json.loads(sys.argv[2])
companion = status.get("companion") or {}
raise SystemExit(0 if status.get("ok") is True and str(companion.get("version", "")).removeprefix("v") == expected else 1)
PY
    then
      runtime_pid="$(launchctl print "gui/$(id -u)/shop.vibetv.control-center.runtime" 2>/dev/null | sed -nE 's/^[[:space:]]*pid = ([0-9]+)$/\1/p' | head -n1)"
      listener_pid="$(lsof -nP -a -iTCP@127.0.0.1:47832 -sTCP:LISTEN -Fp 2>/dev/null | sed -nE 's/^p([0-9]+)$/\1/p' | sort -u)"
      if [[ -n "$runtime_pid" && "$listener_pid" == "$runtime_pid" ]]; then
        rm -rf "$BACKUP"
        printf 'Verified Mac App %s build %s and runtime listener ownership.\n' "$EXPECTED_VERSION" "$build"
        exit 0
      fi
    fi
  fi
  sleep 2
done

rollback "candidate app/runtime/listener verification timed out"
