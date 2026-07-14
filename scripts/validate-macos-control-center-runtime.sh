#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="VibeTV Control Center"
BUNDLE_ID="shop.vibetv.control-center"
RUNTIME_LABEL="shop.vibetv.control-center.runtime"
UNREGISTER_ARGUMENT="--vibetv-validation-unregister-runtime"
UNREGISTER_ENV="VIBETV_RUNTIME_VALIDATION_UNREGISTER"
INSTALL_APP="/Applications/${APP_NAME}.app"
STATUS_URL="http://127.0.0.1:47832/v1/status"
MODE=""
SOURCE_APP=""
EXPECTED_VERSION=""
TIMEOUT_SECONDS=110
WORK_DIR=""
FAKE_DEVICE_PID=""
UI_PID=""
SERVICE_PID=""
CLEANUP_ARMED=0
LAUNCH_ENV_SET=0
INSTALLED=0

usage() {
  cat <<'EOF'
Usage:
  validate-macos-control-center-runtime.sh --dry-run --app path.app --expected-version x.y.z
  CODEX_ALLOW_MACOS_RUNTIME_VALIDATION=1 validate-macos-control-center-runtime.sh --real --app path.app --expected-version x.y.z [--timeout-seconds n]

Real mode is destructive and intentionally limited to a clean validation Mac.
It installs the signed app in /Applications, uses only a loopback fake VibeTV,
validates the SMAppService runtime, and removes all validation state afterward.
EOF
}

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

need_value() {
  [[ -n "${2:-}" ]] || die "$1 needs a value"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run|--real)
      [[ -z "$MODE" ]] || die "choose exactly one of --dry-run or --real"
      MODE="${1#--}"
      shift
      ;;
    --app)
      need_value "$1" "${2:-}"
      SOURCE_APP="$2"
      shift 2
      ;;
    --expected-version)
      need_value "$1" "${2:-}"
      EXPECTED_VERSION="${2#v}"
      shift 2
      ;;
    --timeout-seconds)
      need_value "$1" "${2:-}"
      TIMEOUT_SECONDS="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "unknown argument: $1"
      ;;
  esac
done

[[ -n "$MODE" ]] || die "choose exactly one of --dry-run or --real"
[[ -n "$SOURCE_APP" && "$SOURCE_APP" == *.app ]] || die "--app must name an .app bundle"
[[ "$EXPECTED_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]] \
  || die "--expected-version must be a release version"
[[ "$TIMEOUT_SECONDS" =~ ^[0-9]+$ ]] && (( TIMEOUT_SECONDS >= 30 && TIMEOUT_SECONDS <= 300 )) \
  || die "--timeout-seconds must be between 30 and 300"

if [[ "$MODE" == "dry-run" ]]; then
  cat <<EOF
dry-run: NO CHANGES will be made
  verify signed app and version ${EXPECTED_VERSION}: ${SOURCE_APP}
  require a clean validation Mac and empty port 47832
  start a loopback-only fake VibeTV and write a temporary loopback runtime config
  copy the app to ${INSTALL_APP} and open it
  require the SMAppService PID to be the sole 127.0.0.1:47832 listener
  require ${STATUS_URL} to report version=${EXPECTED_VERSION} and installationMode=dmg
  terminate only the Control Center UI and prove the same helper PID remains healthy
  unregister only ${RUNTIME_LABEL}, then remove the app and all temporary validation state
EOF
  exit 0
fi

[[ "${CODEX_ALLOW_MACOS_RUNTIME_VALIDATION:-}" == "1" ]] \
  || die "real mode needs CODEX_ALLOW_MACOS_RUNTIME_VALIDATION=1"
[[ "$(uname -s)" == "Darwin" ]] || die "real runtime validation requires macOS"
(( EUID != 0 )) || die "real runtime validation must run in the logged-in GUI user session"

for command in codesign curl defaults ditto launchctl lsof open plutil ps python3 spctl; do
  command -v "$command" >/dev/null 2>&1 || die "required command is unavailable: $command"
done

[[ -d "$SOURCE_APP" ]] || die "signed app not found: $SOURCE_APP"
[[ ! -e "$INSTALL_APP" ]] || die "clean host required: $INSTALL_APP already exists"
[[ -w /Applications ]] || die "/Applications is not writable"

APP_SUPPORT="${HOME}/Library/Application Support/codexbar-display"
PREFERENCES="${HOME}/Library/Preferences/${BUNDLE_ID}.plist"
for path in \
  "$APP_SUPPORT" \
  "$PREFERENCES" \
  "${HOME}/Applications/${APP_NAME}.app" \
  "${HOME}/Library/LaunchAgents/com.codexbar-display.daemon.plist" \
  "${HOME}/Library/LaunchAgents/com.codexbar-display.companion-api.plist" \
  "/Library/LaunchAgents/com.codexbar-display.daemon.plist" \
  "/Library/LaunchAgents/com.codexbar-display.companion-api.plist"
do
  [[ ! -e "$path" ]] || die "clean host required: found $path"
done

UID_VALUE="$(id -u)"
SERVICE_TARGET="gui/${UID_VALUE}/${RUNTIME_LABEL}"
launchctl print "gui/${UID_VALUE}" >/dev/null 2>&1 \
  || die "logged-in GUI launchd domain is unavailable"
if launchctl print "$SERVICE_TARGET" >/dev/null 2>&1; then
  die "clean host required: ${RUNTIME_LABEL} is already loaded"
fi
if lsof -nP -iTCP@127.0.0.1:47832 -sTCP:LISTEN >/dev/null 2>&1; then
  die "clean host required: port 47832 already has a listener"
fi
for legacy_label in com.codexbar-display.daemon com.codexbar-display.companion-api; do
  if launchctl print "gui/${UID_VALUE}/${legacy_label}" >/dev/null 2>&1; then
    die "clean host required: legacy service ${legacy_label} is loaded"
  fi
done
if defaults read "$BUNDLE_ID" >/dev/null 2>&1; then
  die "clean host required: ${BUNDLE_ID} preferences already exist"
fi
for environment_key in \
  CODEXBAR_DISPLAY_MAC_APP_RELEASE_API_URL \
  CODEXBAR_DISPLAY_FIRMWARE_MANIFEST_URL \
  CODEXBAR_BIN
do
  [[ -z "$(launchctl getenv "$environment_key" 2>/dev/null || true)" ]] \
    || die "clean host required: launchd environment already defines ${environment_key}"
done

codesign --verify --deep --strict --verbose=2 "$SOURCE_APP"
SIGNATURE_DETAILS="$(codesign -dv --verbose=4 "$SOURCE_APP" 2>&1)"
[[ "$SIGNATURE_DETAILS" == *"Authority=Developer ID Application:"* ]] \
  || die "app is not Developer-ID signed"
[[ "$SIGNATURE_DETAILS" == *"TeamIdentifier="* && "$SIGNATURE_DETAILS" != *"TeamIdentifier=not set"* ]] \
  || die "app has no Developer-ID team"
GATEKEEPER_OUTPUT="$(spctl --assess --type execute --verbose=4 "$SOURCE_APP" 2>&1)" \
  || die "Gatekeeper rejected the signed app: $GATEKEEPER_OUTPUT"
[[ "$GATEKEEPER_OUTPUT" == *"source=Notarized Developer ID"* ]] \
  || die "Gatekeeper source is not Notarized Developer ID"

SOURCE_VERSION="$(plutil -extract CFBundleShortVersionString raw -o - "$SOURCE_APP/Contents/Info.plist")"
[[ "${SOURCE_VERSION#v}" == "$EXPECTED_VERSION" ]] \
  || die "app version ${SOURCE_VERSION:-<missing>} does not match ${EXPECTED_VERSION}"

service_pid() {
  local output pids
  output="$(launchctl print "$SERVICE_TARGET" 2>/dev/null)" || return 1
  pids="$(printf '%s\n' "$output" | sed -nE 's/^[[:space:]]*pid = ([0-9]+)$/\1/p')"
  [[ "$(printf '%s\n' "$pids" | awk 'NF { count++ } END { print count + 0 }')" == "1" ]] || return 1
  printf '%s\n' "$pids"
}

listener_pids() {
  lsof -nP -a -iTCP@127.0.0.1:47832 -sTCP:LISTEN -Fp 2>/dev/null \
    | sed -nE 's/^p([0-9]+)$/\1/p' | sort -u
}

status_is_valid() {
  local output="$1"
  python3 - "$output" "$EXPECTED_VERSION" <<'PY'
import json
import sys

try:
    with open(sys.argv[1], encoding="utf-8") as status_file:
        status = json.load(status_file)
except (OSError, UnicodeError, ValueError, json.JSONDecodeError):
    raise SystemExit(1)
if not isinstance(status, dict):
    raise SystemExit(1)
companion = status.get("companion")
if status.get("ok") is not True or not isinstance(companion, dict):
    raise SystemExit(1)
actual = str(companion.get("version", "")).strip().removeprefix("v")
if companion.get("status") != "ready" or actual != sys.argv[2]:
    raise SystemExit(1)
if companion.get("installationMode") != "dmg":
    raise SystemExit(1)
PY
}

ui_pids() {
  ps -axo pid=,comm= | awk -v executable="$INSTALL_APP/Contents/MacOS/VibeTVControlCenter" '
    {
      pid = $1
      $1 = ""
      sub(/^[[:space:]]+/, "")
      if ($0 == executable) print pid
    }
  '
}

cleanup_resources() {
  local failed=0 unregister_output=""
  if [[ -n "$UI_PID" ]] && kill -0 "$UI_PID" >/dev/null 2>&1; then
    kill -TERM "$UI_PID" >/dev/null 2>&1 || failed=1
  fi
  if [[ "$INSTALLED" == "1" && -x "$INSTALL_APP/Contents/MacOS/VibeTVControlCenter" ]]; then
    if ! unregister_output="$(
      env "${UNREGISTER_ENV}=1" \
        "$INSTALL_APP/Contents/MacOS/VibeTVControlCenter" \
        "$UNREGISTER_ARGUMENT" 2>&1
    )"; then
      printf '%s\n' "$unregister_output" >&2
      failed=1
    elif [[ "$unregister_output" != *"CODEX_RUNTIME_UNREGISTER_OK label=${RUNTIME_LABEL}"* ]]; then
      printf 'error: invalid unregister confirmation: %s\n' "$unregister_output" >&2
      failed=1
    fi
  fi
  if launchctl print "$SERVICE_TARGET" >/dev/null 2>&1; then
    printf 'error: cleanup left %s loaded\n' "$RUNTIME_LABEL" >&2
    failed=1
  fi
  [[ "$INSTALLED" != "1" ]] || rm -rf "$INSTALL_APP" || failed=1
  [[ -z "$FAKE_DEVICE_PID" ]] || kill "$FAKE_DEVICE_PID" >/dev/null 2>&1 || true
  [[ -z "$FAKE_DEVICE_PID" ]] || wait "$FAKE_DEVICE_PID" 2>/dev/null || true
  [[ "$LAUNCH_ENV_SET" != "1" ]] || launchctl unsetenv CODEXBAR_DISPLAY_MAC_APP_RELEASE_API_URL >/dev/null 2>&1 || failed=1
  [[ "$LAUNCH_ENV_SET" != "1" ]] || launchctl unsetenv CODEXBAR_DISPLAY_FIRMWARE_MANIFEST_URL >/dev/null 2>&1 || failed=1
  [[ "$LAUNCH_ENV_SET" != "1" ]] || launchctl unsetenv CODEXBAR_BIN >/dev/null 2>&1 || failed=1
  defaults delete "$BUNDLE_ID" >/dev/null 2>&1 || true
  rm -rf "$APP_SUPPORT" "$PREFERENCES" || failed=1
  [[ -z "$WORK_DIR" ]] || rm -rf "$WORK_DIR" || failed=1
  return "$failed"
}

on_exit() {
  local status=$?
  trap - EXIT HUP INT TERM
  if [[ "$CLEANUP_ARMED" == "1" ]] && ! cleanup_resources; then
    status=1
  fi
  exit "$status"
}
trap on_exit EXIT
trap 'exit 130' HUP INT TERM

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/vibetv-runtime-validation.XXXXXX")"
CLEANUP_ARMED=1
REQUEST_LOG="$WORK_DIR/fake-device.requests"
PORT_FILE="$WORK_DIR/fake-device.port"
FIRMWARE_VERSIONS="$ROOT/release/firmware-versions.json"
[[ -f "$FIRMWARE_VERSIONS" ]] || die "release firmware versions are missing: $FIRMWARE_VERSIONS"
FAKE_DEVICE_FIRMWARE="$(python3 - "$FIRMWARE_VERSIONS" <<'PY'
import json
import re
import sys

with open(sys.argv[1], encoding="utf-8") as source:
    manifest = json.load(source)

matches = [
    artifact
    for artifact in manifest.get("artifacts", [])
    if artifact.get("firmwareEnv") == "esp8266_smalltv_st7789"
    and artifact.get("board") == "esp8266-smalltv-st7789"
]
if len(matches) != 1:
    raise SystemExit("release firmware manifest must contain exactly one ESP8266 VibeTV artifact")
version = str(matches[0].get("firmwareVersion", "")).strip().removeprefix("v")
if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", version):
    raise SystemExit(f"release ESP8266 firmware version is invalid: {version!r}")
print(version)
PY
)"

python3 - "$PORT_FILE" "$REQUEST_LOG" "$FAKE_DEVICE_FIRMWARE" <<'PY' &
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

port_file, request_log, firmware = sys.argv[1:]

class Handler(BaseHTTPRequestHandler):
    def record(self, path):
        with open(request_log, "a", encoding="utf-8") as output:
            output.write(path + "\n")

    def reply(self, payload, status=200):
        body = json.dumps(payload, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = urlsplit(self.path).path
        self.record(path)
        if path == "/hello":
            self.reply({"kind":"hello","protocolVersion":2,"board":"esp8266-smalltv-st7789","firmware":firmware,"maxFrameBytes":4096,"capabilities":{"transport":{"active":"wifi"}}})
        elif path == "/health":
            self.reply({"status":"ok"})
        else:
            self.reply({"error":"not found"}, 404)

    def do_POST(self):
        path = urlsplit(self.path).path
        self.record(path)
        length = min(int(self.headers.get("Content-Length", "0")), 1024 * 1024)
        self.rfile.read(length)
        if path == "/frame":
            self.reply({"ok":True})
        else:
            self.reply({"error":"not found"}, 404)

    def log_message(self, *_):
        pass

server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
temporary = port_file + ".tmp"
with open(temporary, "w", encoding="utf-8") as output:
    output.write(str(server.server_port))
os.replace(temporary, port_file)
server.serve_forever()
PY
FAKE_DEVICE_PID=$!

for _ in $(seq 1 100); do
  [[ -s "$PORT_FILE" ]] && break
  kill -0 "$FAKE_DEVICE_PID" >/dev/null 2>&1 || die "loopback fake VibeTV exited"
  sleep 0.05
done
[[ -s "$PORT_FILE" ]] || die "loopback fake VibeTV did not start"
FAKE_PORT="$(cat "$PORT_FILE")"

mkdir -p "$APP_SUPPORT"
python3 - "$APP_SUPPORT/config.json" "$FAKE_PORT" <<'PY'
import json
import sys
with open(sys.argv[1], "w", encoding="utf-8") as output:
    json.dump({"deviceTarget": f"http://127.0.0.1:{sys.argv[2]}"}, output)
    output.write("\n")
PY
chmod 600 "$APP_SUPPORT/config.json"

launchctl setenv CODEXBAR_DISPLAY_MAC_APP_RELEASE_API_URL off
launchctl setenv CODEXBAR_DISPLAY_FIRMWARE_MANIFEST_URL off
launchctl setenv CODEXBAR_BIN /usr/bin/false
LAUNCH_ENV_SET=1

ditto "$SOURCE_APP" "$INSTALL_APP"
INSTALLED=1
codesign --verify --deep --strict --verbose=2 "$INSTALL_APP"
open -na "$INSTALL_APP"

deadline=$((SECONDS + TIMEOUT_SECONDS))
STATUS_FILE="$WORK_DIR/status.json"
while (( SECONDS < deadline )); do
  UI_PIDS="$(ui_pids)"
  if [[ "$(printf '%s\n' "$UI_PIDS" | awk 'NF { count++ } END { print count + 0 }')" == "1" ]]; then
    UI_PID="$UI_PIDS"
  fi
  CURRENT_SERVICE_PID="$(service_pid || true)"
  LISTENERS="$(listener_pids || true)"
  if [[ -n "$UI_PID" && -n "$CURRENT_SERVICE_PID" && "$LISTENERS" == "$CURRENT_SERVICE_PID" ]] &&
      curl -fsS --max-time 3 "$STATUS_URL" >"$STATUS_FILE" 2>/dev/null &&
      status_is_valid "$STATUS_FILE" &&
      grep -qxF /hello "$REQUEST_LOG" 2>/dev/null &&
      grep -qxF /frame "$REQUEST_LOG" 2>/dev/null; then
    SERVICE_PID="$CURRENT_SERVICE_PID"
    break
  fi
  sleep 0.5
done
[[ -n "$SERVICE_PID" ]] || die "runtime did not reach the signed-app SMAppService/port/status/frame contract before timeout"

kill -TERM "$UI_PID"
for _ in $(seq 1 40); do
  ! kill -0 "$UI_PID" >/dev/null 2>&1 && break
  sleep 0.25
done
kill -0 "$UI_PID" >/dev/null 2>&1 && die "Control Center UI did not terminate"
UI_PID=""
sleep 2

kill -0 "$SERVICE_PID" >/dev/null 2>&1 || die "SMAppService helper stopped with the UI"
[[ "$(service_pid || true)" == "$SERVICE_PID" ]] || die "SMAppService PID changed after the UI exited"
[[ "$(listener_pids || true)" == "$SERVICE_PID" ]] || die "helper is not the sole port-47832 listener after UI exit"
curl -fsS --max-time 3 "$STATUS_URL" >"$STATUS_FILE"
status_is_valid "$STATUS_FILE" || die "runtime status became invalid after UI exit"

trap - EXIT HUP INT TERM
if ! cleanup_resources; then
  die "runtime validation passed but cleanup failed"
fi
CLEANUP_ARMED=0
printf 'macOS Control Center runtime validation passed: version=%s helper-pid=%s mode=dmg\n' \
  "$EXPECTED_VERSION" "$SERVICE_PID"
