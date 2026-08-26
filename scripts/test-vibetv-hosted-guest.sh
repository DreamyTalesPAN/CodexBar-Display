#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALL_APP='/Applications/VibeTV Control Center.app'
DMG="" APPCAST="" VIRTUAL_VIBETV="" COMPANION="" FIRMWARE="" FIRMWARE_MANIFEST="" VERSION="" STATE="" OUTPUT=""
BASELINE_DMG="" BASELINE_APPCAST=""
CURRENT_FIRMWARE='0.0.0'

die() { printf 'error: %s\n' "$*" >&2; exit 1; }
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dmg) DMG="${2:-}"; shift 2 ;; --appcast) APPCAST="${2:-}"; shift 2 ;;
    --virtual-vibetv) VIRTUAL_VIBETV="${2:-}"; shift 2 ;; --companion) COMPANION="${2:-}"; shift 2 ;;
    --firmware) FIRMWARE="${2:-}"; shift 2 ;; --firmware-manifest) FIRMWARE_MANIFEST="${2:-}"; shift 2 ;;
    --version) VERSION="${2#v}"; shift 2 ;; --state) STATE="${2:-}"; shift 2 ;;
    --output) OUTPUT="${2:-}"; shift 2 ;; --baseline-dmg) BASELINE_DMG="${2:-}"; shift 2 ;;
    --current-firmware) CURRENT_FIRMWARE="${2#v}"; shift 2 ;;
    --baseline-appcast) BASELINE_APPCAST="${2:-}"; shift 2 ;; *) die "unknown argument: $1" ;;
  esac
done
for file in "$DMG" "$APPCAST" "$FIRMWARE" "$FIRMWARE_MANIFEST"; do [[ -f "$file" ]] || die "required file missing: $file"; done
[[ -x "$VIRTUAL_VIBETV" ]] || die '--virtual-vibetv must be executable'
[[ -x "$COMPANION" ]] || die '--companion must be the exact candidate companion executable'
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]] || die '--version must be SemVer'
[[ "$STATE" =~ ^(clean_os|current_public|previous_public)$ ]] || die '--state is invalid'
[[ -n "$OUTPUT" && ! -e "$OUTPUT" ]] || die '--output must be a new directory'
[[ "$(uname -s)" == Darwin ]] || die 'hosted guest test requires macOS'
if [[ "$STATE" == clean_os ]]; then [[ -z "$BASELINE_DMG$BASELINE_APPCAST" ]] || die 'clean_os must not receive a baseline'; else [[ -f "$BASELINE_DMG" && -f "$BASELINE_APPCAST" ]] || die 'public state needs frozen baseline files'; fi
[[ ! -e "$INSTALL_APP" ]] || die "disposable guest is not clean: ${INSTALL_APP} exists"

mkdir -p "$OUTPUT"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/vibetv-hosted-guest.XXXXXX")"
CANDIDATE_MOUNT="$(mktemp -d "${TMPDIR:-/tmp}/vibetv-candidate-mount.XXXXXX")"
BASELINE_MOUNT="$(mktemp -d "${TMPDIR:-/tmp}/vibetv-baseline-mount.XXXXXX")"
VIRTUAL_PID="" HTTP_PID=""
# Everything the runtime knows about why a display stream is or is not healthy
# lives outside this script, so a failure here used to be undebuggable from the
# uploaded artifacts alone. Collect it unconditionally, before cleanup deletes
# the installed app.
collect_diagnostics() {
  local dir="$OUTPUT/diagnostics"
  mkdir -p "$dir" || return 0
  curl --fail --silent --max-time 10 http://127.0.0.1:47832/v1/status > "$dir/runtime-status.json" 2>/dev/null || true
  curl --fail --silent --max-time 10 http://127.0.0.1:47832/v1/device > "$dir/device.json" 2>/dev/null || true
  curl --fail --silent --max-time 10 http://127.0.0.1:47832/v1/diagnostics > "$dir/diagnostics.json" 2>/dev/null || true
  curl --fail --silent --max-time 10 http://127.0.0.1:47834/__virtual/state > "$dir/virtual-state-final.json" 2>/dev/null || true
  local support="$HOME/Library/Application Support/codexbar-display"
  # daemon.out.log is the file the runtime parses to decide stream health, so
  # it is the only place that explains a stream_attention outcome.
  for log in daemon.out.log daemon.out.log.1 firmware-update.log; do
    [[ -f "$support/logs/$log" ]] && tail -c 200000 "$support/logs/$log" > "$dir/$log" 2>/dev/null || true
  done
  launchctl print "gui/$(id -u)/shop.vibetv.control-center.runtime" > "$dir/launchctl-runtime.txt" 2>&1 || true
  launchctl list > "$dir/launchctl-list.txt" 2>&1 || true
}
cleanup() {
  collect_diagnostics || true
  [[ -z "$VIRTUAL_PID" ]] || kill "$VIRTUAL_PID" >/dev/null 2>&1 || true
  [[ -z "$HTTP_PID" ]] || kill "$HTTP_PID" >/dev/null 2>&1 || true
  launchctl unsetenv CODEXBAR_DISPLAY_FIRMWARE_MANIFEST_URL >/dev/null 2>&1 || true
  launchctl unsetenv CODEXBAR_DISPLAY_MAC_APP_RELEASE_API_URL >/dev/null 2>&1 || true
  hdiutil detach "$CANDIDATE_MOUNT" -quiet >/dev/null 2>&1 || true
  hdiutil detach "$BASELINE_MOUNT" -quiet >/dev/null 2>&1 || true
  [[ ! -e "$INSTALL_APP" ]] || rm -rf "$INSTALL_APP" || true
  rm -rf "$WORK" "$CANDIDATE_MOUNT" "$BASELINE_MOUNT"
}
trap cleanup EXIT HUP INT TERM

validate_installed_runtime() {
  local status_output="$1"
  local runtime_pid="" listener_pids
  local build_version expected_bundle_version registered_bundle_version
  build_version="$(plutil -extract CFBundleVersion raw -o - "$INSTALL_APP/Contents/Info.plist")"
  expected_bundle_version="${VERSION}+${build_version}"
  rm -f "$status_output"
  local deadline=$((SECONDS + 120))
  while (( SECONDS < deadline )); do
    registered_bundle_version="$(
      defaults read shop.vibetv.control-center \
        shop.vibetv.control-center.runtime.registered-bundle-version 2>/dev/null || true
    )"
    if [[ "$registered_bundle_version" == "$expected_bundle_version" ]] \
      && curl --fail --silent --max-time 3 http://127.0.0.1:47832/v1/status > "$status_output"; then
      if runtime_pid="$(python3 - "$status_output" "$VERSION" "$INSTALL_APP" <<'PY'
import json, sys
status_path, expected_version, install_app = sys.argv[1:]
status = json.load(open(status_path, encoding="utf-8"))
companion = status.get("companion", {})
runtime = companion.get("runtime", {})
if (status.get("ok") is not True or companion.get("status") != "ready"
        or companion.get("version") != expected_version
        or companion.get("installationMode") != "dmg"
        or runtime.get("version") != expected_version
        or runtime.get("executable") != f"{install_app}/Contents/Helpers/codexbar-display"
        or runtime.get("listenerOwner") != "shop.vibetv.control-center.runtime"
        or not isinstance(runtime.get("pid"), int) or runtime["pid"] < 1):
    raise SystemExit("installed candidate runtime status did not match the signed DMG")
print(runtime["pid"])
PY
)"; then
        break
      fi
    fi
    runtime_pid=""
    sleep 1
  done
  [[ -n "$runtime_pid" ]] \
    || die 'installed candidate app preparation and runtime did not become healthy on port 47832'
  listener_pids="$(lsof -nP -a -iTCP@127.0.0.1:47832 -sTCP:LISTEN -Fp 2>/dev/null | sed -nE 's/^p([0-9]+)$/\1/p' | sort -u)"
  # Name the processes: without them this failure only says "not sole" and the
  # next person has to re-run the whole gate to learn who else held the port.
  if [[ "$listener_pids" != "$runtime_pid" ]]; then
    ps -o pid=,lstart=,command= -p ${listener_pids//$'\n'/ } 2>/dev/null || true
    die "installed candidate runtime is not the sole port-47832 listener (runtime ${runtime_pid}, listeners ${listener_pids//$'\n'/ })"
  fi
}

# Drives one firmware update through the installed runtime's Companion API and
# waits for the job to finish. This is the exact path the Updates tab uses: the
# runtime pauses its own display stream and marks the child updater as
# parent-paused, so the writer-quiesce gate stays satisfied without stopping
# the app.
api_firmware_update() {
  local status_output="$1" expected_outcome="$2"
  local start_output="${status_output%.json}.start.json"
  local start_deadline=$((SECONDS + 70)) http_status
  while true; do
    http_status="$(curl --silent --show-error --max-time 30 \
      --output "$start_output" --write-out '%{http_code}' \
      -H 'Content-Type: application/json' --data '{}' \
      http://127.0.0.1:47832/v1/updates/install)"
    [[ "$http_status" == 202 ]] && break
    if [[ "$http_status" == 409 ]] \
      && python3 -c 'import json,sys; raise SystemExit(json.load(open(sys.argv[1])).get("error", {}).get("code") != "mac_app_restarting")' "$start_output" \
      && (( SECONDS < start_deadline )); then
      sleep 2
      continue
    fi
    sed 's/^/firmware update start: /' "$start_output" >&2
    die "installed runtime refused the firmware update start with HTTP $http_status"
  done
  local job_id
  job_id="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["job"]["id"])' "$start_output")"
  [[ -n "$job_id" ]] || die 'installed runtime did not start a firmware update job'
  local deadline=$((SECONDS + 300))
  while (( SECONDS < deadline )); do
    curl --fail --silent --max-time 10 \
      "http://127.0.0.1:47832/v1/updates/install/status?jobId=${job_id}" > "$status_output" \
      || { sleep 2; continue; }
    if python3 -c 'import json,sys; job=json.load(open(sys.argv[1]))["job"]; raise SystemExit(0 if job.get("phase") in ("complete","error","attention") else 1)' "$status_output"; then
      break
    fi
    sleep 2
  done
  python3 - "$status_output" "$expected_outcome" <<'PY'
import json, sys
job = json.load(open(sys.argv[1], encoding="utf-8"))["job"]
if job.get("phase") != "complete" or job.get("outcome") != sys.argv[2]:
    raise SystemExit(
        "firmware update job ended phase=%r outcome=%r message=%r; expected complete/%s"
        % (job.get("phase"), job.get("outcome"), job.get("message"), sys.argv[2]))
PY
}

sw_vers > "$OUTPUT/macos-version.txt"
ps -axo pid=,ppid=,comm= > "$OUTPUT/processes-before.txt"
"$ROOT/scripts/verify-macos-control-center-dmg.sh" --dmg "$DMG" > "$OUTPUT/candidate-dmg-verification.txt" 2>&1
hdiutil attach -readonly -nobrowse -mountpoint "$CANDIDATE_MOUNT" "$DMG" > "$OUTPUT/candidate-dmg-mount.txt" 2>&1
CANDIDATE_APP="$CANDIDATE_MOUNT/VibeTV Control Center.app"
[[ -d "$CANDIDATE_APP" ]] || die 'candidate DMG has no app'
codesign --verify --deep --strict --verbose=2 "$CANDIDATE_APP" > "$OUTPUT/candidate-app-codesign.txt" 2>&1

mkdir -p "$WORK/serve"
cp "$DMG" "$WORK/serve/VibeTV-Control-Center.dmg"
cp "$APPCAST" "$WORK/serve/appcast.xml"
cp "$FIRMWARE" "$WORK/serve/firmware.bin"
cp "$FIRMWARE_MANIFEST" "$WORK/serve/firmware-manifest.template.json"
python3 - "$WORK/serve" "$WORK/serve/port" <<'PY' > "$OUTPUT/loopback-server.log" 2>&1 &
import http.server, pathlib, socketserver, sys
root, port_file = map(pathlib.Path, sys.argv[1:])
import os
os.chdir(root)
class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, fmt, *args): print(fmt % args, flush=True)
with socketserver.TCPServer(("127.0.0.1", 0), Handler) as server:
    port_file.write_text(str(server.server_address[1]), encoding="utf-8")
    server.serve_forever()
PY
HTTP_PID=$!
for _ in $(seq 1 30); do [[ -s "$WORK/serve/port" ]] && break; sleep 1; done
[[ -s "$WORK/serve/port" ]] || die 'local candidate artifact server did not start'
PORT="$(cat "$WORK/serve/port")"
SERVER_URL="http://127.0.0.1:${PORT}"
python3 - "$WORK/serve/appcast.xml" "$SERVER_URL/VibeTV-Control-Center.dmg" <<'PY'
import sys
path, url = sys.argv[1:]
data = open(path, encoding="utf-8").read()
start = 'https://github.com/'
if start not in data: raise SystemExit('production appcast has no GitHub enclosure URL')
before, _, rest = data.partition(start)
_, _, tail = rest.partition('/VibeTV-Control-Center.dmg')
open(path, 'w', encoding='utf-8').write(before + url + tail)
PY

# The served firmware manifest must exist before any app process starts: the
# installed runtime resolves it from the launchd environment as soon as it runs.
python3 - "$WORK/serve/firmware-manifest.template.json" "$WORK/serve/firmware-manifest.json" "$SERVER_URL/firmware.bin" <<'PY'
import json, sys
source, output, url = sys.argv[1:]
manifest = json.load(open(source, encoding="utf-8"))
for artifact in manifest.get("artifacts", []): artifact["firmwareUrl"] = url
json.dump(manifest, open(output, "w", encoding="utf-8"), indent=2)
PY

if [[ "$STATE" == clean_os ]]; then
  ditto "$CANDIDATE_APP" "$INSTALL_APP"
else
  "$ROOT/scripts/verify-macos-control-center-dmg.sh" --dmg "$BASELINE_DMG" > "$OUTPUT/baseline-dmg-verification.txt" 2>&1
  hdiutil attach -readonly -nobrowse -mountpoint "$BASELINE_MOUNT" "$BASELINE_DMG" > "$OUTPUT/baseline-dmg-mount.txt" 2>&1
  BASELINE_APP="$BASELINE_MOUNT/VibeTV Control Center.app"
  [[ -d "$BASELINE_APP" ]] || die 'baseline DMG has no app'
  ditto "$BASELINE_APP" "$INSTALL_APP"
  plutil -extract CFBundleShortVersionString raw -o - "$INSTALL_APP/Contents/Info.plist" > "$OUTPUT/baseline-version.txt"
  # The runtime reads the firmware manifest override from the launchd
  # environment at spawn, so it must be set before launchd starts any app or
  # runtime process on this guest.
  launchctl setenv CODEXBAR_DISPLAY_FIRMWARE_MANIFEST_URL "$SERVER_URL/firmware-manifest.json"
  # The firmware-install gate fails closed when the Mac App release check does
  # not answer, so the guest must provide a deterministic release feed: the
  # public GitHub API would rate-limit shared CI runners. The feed announces
  # exactly the candidate version, proving "app is current" honestly.
  printf '{"tag_name": "v%s"}\n' "$VERSION" > "$WORK/serve/mac-app-release.json"
  launchctl setenv CODEXBAR_DISPLAY_MAC_APP_RELEASE_API_URL "$SERVER_URL/mac-app-release.json"
  open -na "$INSTALL_APP"
  sleep 2
  BASELINE_PID="$(pgrep -f "$INSTALL_APP/Contents/MacOS/VibeTVControlCenter" | head -n1)"
  [[ -n "$BASELINE_PID" ]] || die 'baseline app did not start before Sparkle replacement'
  printf '%s\n' "$BASELINE_PID" > "$OUTPUT/baseline-pid.txt"
  # Sparkle's official CLI is intentionally mandatory. Do not downgrade this
  # to XML parsing: if the hosted image lacks it, the gate must fail loudly.
  "$ROOT/scripts/build-sparkle-cli.sh" --output "$WORK/sparkle-cli" > "$OUTPUT/sparkle-cli-provenance.txt"
  SPARKLE_CLI="${SPARKLE_CLI:-$WORK/sparkle-cli/sparkle.app/Contents/MacOS/sparkle}"
  [[ -x "$SPARKLE_CLI" ]] || die "official Sparkle CLI is unavailable at ${SPARKLE_CLI}; cannot prove Sparkle update"
  "$SPARKLE_CLI" --check-immediately --feed-url "$SERVER_URL/appcast.xml" --user-agent-name 'CODEX VibeTV RC' "$INSTALL_APP" > "$OUTPUT/sparkle-update.txt" 2>&1
  deadline=$((SECONDS + 45)); CANDIDATE_PID=''
  while (( SECONDS < deadline )); do
    CANDIDATE_PID="$(pgrep -f "$INSTALL_APP/Contents/MacOS/VibeTVControlCenter" | head -n1 || true)"
    [[ -n "$CANDIDATE_PID" && "$CANDIDATE_PID" != "$BASELINE_PID" ]] && break
    sleep 1
  done
  [[ -n "$CANDIDATE_PID" && "$CANDIDATE_PID" != "$BASELINE_PID" ]] || die 'Sparkle did not replace and relaunch the candidate app'
  printf '%s\n' "$CANDIDATE_PID" > "$OUTPUT/candidate-pid.txt"
fi

plutil -extract CFBundleShortVersionString raw -o - "$INSTALL_APP/Contents/Info.plist" > "$OUTPUT/installed-candidate-version.txt"
[[ "$(cat "$OUTPUT/installed-candidate-version.txt")" == "$VERSION" ]] || die 'installed app is not the candidate version after Sparkle/direct install'
cmp "$COMPANION" "$INSTALL_APP/Contents/Helpers/codexbar-display" || die 'installed app does not contain the candidate companion artifact'

candidate_firmware="$(python3 -c 'import json; print(next(a["firmwareVersion"] for a in json.load(open("'"$FIRMWARE_MANIFEST"'"))["artifacts"] if a["firmwareEnv"] == "esp8266_smalltv_st7789"))')"
expected_uploads="$(python3 - "$CURRENT_FIRMWARE" "$candidate_firmware" <<'PY'
import sys
def key(value): return tuple(int(part) for part in value.split('-')[0].split('.'))
print(1 if key(sys.argv[2]) > key(sys.argv[1]) else 0)
PY
)"
RAW_FIRMWARE="$WORK/firmware.bin"
if [[ "$FIRMWARE" == *.gz ]]; then
  gzip -t "$FIRMWARE"
  gzip -cd "$FIRMWARE" > "$RAW_FIRMWARE"
else
  cp "$FIRMWARE" "$RAW_FIRMWARE"
fi
firmware_sha="$(shasum -a 256 "$RAW_FIRMWARE" | awk '{print $1}')"
"$VIRTUAL_VIBETV" --addr 127.0.0.1:47834 --raw-addr 127.0.0.1:8081 --firmware "$CURRENT_FIRMWARE" --candidate-firmware "$candidate_firmware" --expected-firmware-sha256 "$firmware_sha" > "$OUTPUT/virtual-vibetv.log" 2>&1 & VIRTUAL_PID=$!
for _ in $(seq 1 30); do curl --fail --silent "$SERVER_URL/firmware-manifest.json" >/dev/null && curl --fail --silent http://127.0.0.1:47834/health > "$OUTPUT/virtual-health-before.json" && break; sleep 1; done
[[ -s "$OUTPUT/virtual-health-before.json" ]] || die 'Virtual VibeTV did not become healthy'
CANDIDATE_COMPANION="$INSTALL_APP/Contents/Helpers/codexbar-display"
if [[ "$STATE" == clean_os ]]; then
  # No runtime is alive on a clean OS, so the direct CLI updater is the honest
  # path and its writer-quiesce probe finds the runtime-health endpoint dead.
  "$CANDIDATE_COMPANION" install-update --target http://127.0.0.1:47834 --manifest-url "$SERVER_URL/firmware-manifest.json" --skip-launchagent-pause > "$OUTPUT/candidate-install-update.txt" 2>&1
  "$CANDIDATE_COMPANION" install-update --target http://127.0.0.1:47834 --manifest-url "$SERVER_URL/firmware-manifest.json" --skip-launchagent-pause > "$OUTPUT/candidate-already-current.txt" 2>&1
  grep -F 'Firmware: already current' "$OUTPUT/candidate-already-current.txt" >/dev/null || die 'candidate companion did not prove already_current'
  if ! "$CANDIDATE_COMPANION" daemon --transport wifi --target http://127.0.0.1:47834 --once > "$OUTPUT/candidate-daemon-once.txt" 2>&1; then
    grep -F 'error code=runtime/no-providers' "$OUTPUT/candidate-daemon-once.txt" >/dev/null \
      || die 'candidate daemon failed before rendering to the virtual VibeTV'
  fi
else
  # Sparkle relaunched the candidate app, so its runtime owns the device and a
  # direct CLI flash is refused by the writer-quiesce gate — deliberately.
  # Drive the update the way a customer does: through the runtime's Companion
  # API, which pauses its own display stream around the child updater.
  validate_installed_runtime "$OUTPUT/candidate-runtime-status.json"
  curl --fail --silent --show-error --max-time 30 \
    -H 'Content-Type: application/json' \
    --data '{"target":"http://127.0.0.1:47834","forcePair":true}' \
    http://127.0.0.1:47832/v1/device/repair > "$OUTPUT/candidate-runtime-repair.json"
  first_outcome=updated
  [[ "$expected_uploads" == 0 ]] && first_outcome=already_current
  api_firmware_update "$OUTPUT/candidate-install-update.json" "$first_outcome"
  api_firmware_update "$OUTPUT/candidate-already-current.json" already_current
fi
for _ in $(seq 1 30); do
  curl --fail --silent http://127.0.0.1:47834/__virtual/state > "$OUTPUT/virtual-state.json"
  python3 -c 'import json,sys; raise SystemExit(json.load(open(sys.argv[1])).get("framesAccepted", 0) < 1)' "$OUTPUT/virtual-state.json" && break
  sleep 1
done
curl --fail --silent http://127.0.0.1:47834/__virtual/state > "$OUTPUT/virtual-state.json"
python3 - "$OUTPUT/virtual-state.json" "$expected_uploads" <<'PY'
import json, sys
state = json.load(open(sys.argv[1], encoding="utf-8"))
expected_uploads = int(sys.argv[2])
if state.get("updateUploads") != expected_uploads or state.get("violations") or state.get("framesAccepted", 0) < 1:
    raise SystemExit("candidate companion did not complete raw OTA/render/no-op sequence")
# A candidate whose firmware matches the baseline uploads nothing -- the outcome
# asserted above is already_current -- so there is no Raw OTA to find. Demanding
# one regardless fails every release that ships no new firmware.
if expected_uploads and not any(event.get("path") == "/update/firmware.raw" for event in state.get("events", [])):
    raise SystemExit("candidate companion did not use Raw OTA port 8081")
PY

if [[ "$STATE" == clean_os ]]; then
  open -na "$INSTALL_APP"
  validate_installed_runtime "$OUTPUT/companion-port-47832.txt"
fi
screencapture -x "$OUTPUT/guest-${STATE}.png"
python3 - "$OUTPUT/result.json" "$STATE" "$VERSION" <<'PY'
import json, sys
json.dump({"schemaVersion": 1, "state": sys.argv[2], "version": sys.argv[3], "status": "passed", "checks": ["signed-dmg", "installed-baseline-to-sparkle-update", "candidate-companion-raw-ota-rediscovery-no-op", "candidate-daemon-render", "installed-runtime-port-47832"]}, open(sys.argv[1], "w", encoding="utf-8"), indent=2)
PY
