#!/usr/bin/env bash
set -euo pipefail

STATE=""
BUNDLE=""
RESULTS=""
FROM_APP=""
FROM_FIRMWARE=""
CANDIDATE=""
CANDIDATE_FIRMWARE=""
SKIP_MAC_UPDATE=0
SKIP_FIRMWARE_UPDATE=0
CURRENT_STAGE="preflight"
FAILURE=""
ARTIFACT_SERVER_PID=""
DEVICE_PID=""
BASELINE_MOUNT=""
BASELINE_WORK=""
STATUS_URL="http://127.0.0.1:47832/v1/status"
DEVICE_URL="http://127.0.0.1:47834"
TOKEN="virtual-pair-token"
APP="/Applications/VibeTV Control Center.app"

mac_migration=false
sparkle_update=false
app_relaunch=false
mac_update_skipped=false
firmware_update_skipped=false
app_version=false
app_build=false
runtime_version=false
listener_ownership=false
single_runtime=false
firmware_ota=false
same_device_id=false
health=false
stream=false
render=false
second_flash_prevented=false

die() {
  FAILURE="$*"
  printf 'error: %s\n' "$*" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --state) STATE="$2"; shift 2 ;;
    --bundle) BUNDLE="$2"; shift 2 ;;
    --results) RESULTS="$2"; shift 2 ;;
    --from-app) FROM_APP="${2#v}"; shift 2 ;;
    --from-firmware) FROM_FIRMWARE="${2#v}"; shift 2 ;;
    --candidate) CANDIDATE="${2#v}"; shift 2 ;;
    --candidate-firmware) CANDIDATE_FIRMWARE="${2#v}"; shift 2 ;;
    --skip-mac-update) SKIP_MAC_UPDATE=1; shift ;;
    --skip-firmware-update) SKIP_FIRMWARE_UPDATE=1; shift ;;
    *) die "unknown guest argument: $1" ;;
  esac
done

[[ "$STATE" == "clean" || "$STATE" == "legacy" || "$STATE" == "native" ]] || die "invalid state"
[[ -d "$BUNDLE" && -n "$RESULTS" ]] || die "bundle and results are required"
mkdir -p "$RESULTS/screenshots"
TIMELINE="$RESULTS/timeline.jsonl"
: > "$TIMELINE"

timeline() {
  python3 - "$TIMELINE" "$CURRENT_STAGE" "$1" <<'PY'
import datetime, json, sys
with open(sys.argv[1], "a", encoding="utf-8") as handle:
    handle.write(json.dumps({
        "at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "stage": sys.argv[2],
        "detail": sys.argv[3],
    }) + "\n")
PY
}

cleanup() {
  launchctl unsetenv CODEXBAR_DISPLAY_MAC_APP_RELEASE_API_URL >/dev/null 2>&1 || true
  launchctl unsetenv CODEXBAR_DISPLAY_FIRMWARE_MANIFEST_URL >/dev/null 2>&1 || true
  [[ -z "$BASELINE_MOUNT" ]] || hdiutil detach "$BASELINE_MOUNT" -quiet >/dev/null 2>&1 || true
  [[ -z "$BASELINE_WORK" ]] || rm -rf "$BASELINE_WORK"
  [[ -z "$DEVICE_PID" ]] || kill "$DEVICE_PID" >/dev/null 2>&1 || true
  [[ -z "$ARTIFACT_SERVER_PID" ]] || kill "$ARTIFACT_SERVER_PID" >/dev/null 2>&1 || true
}

write_result() {
  status="$1"
  if command -v screencapture >/dev/null 2>&1; then
    screencapture -x "$RESULTS/screenshots/final.png" >/dev/null 2>&1 || true
  fi
  python3 - "$RESULTS/result.json" \
    "$STATE" "$status" "$CURRENT_STAGE" "$FAILURE" "$FROM_APP" "$FROM_FIRMWARE" \
    "$CANDIDATE" "$CANDIDATE_FIRMWARE" \
    "$mac_migration" "$sparkle_update" "$app_relaunch" \
    "$mac_update_skipped" "$firmware_update_skipped" \
    "$app_version" "$app_build" "$runtime_version" \
    "$listener_ownership" "$single_runtime" "$firmware_ota" "$same_device_id" \
    "$health" "$stream" "$render" "$second_flash_prevented" <<'PY'
import json, pathlib, sys
(
    path, state, status, stage, failure, from_app, from_firmware,
    candidate, candidate_firmware, *checks
) = sys.argv[1:]
names = [
    "macMigration", "sparkleUpdate", "appRelaunch", "macUpdateSkipped", "firmwareUpdateSkipped",
    "appVersion", "appBuild", "runtimeVersion",
    "listenerOwnership", "singleRuntime", "firmwareOTA", "sameDeviceId",
    "health", "stream", "render", "secondFlashPrevented",
]
payload = {
    "schemaVersion": 1,
    "state": state,
    "status": status,
    "failedStage": stage if status != "passed" else "",
    "failure": failure,
    "from": {"app": from_app, "firmware": from_firmware},
    "candidate": {"app": candidate, "firmware": candidate_firmware},
    "checks": {name: value == "true" for name, value in zip(names, checks)},
}
pathlib.Path(path).write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
PY
  {
    printf '# VibeTV release candidate: %s\n\n' "$STATE"
    printf 'Status: **%s**\n\n' "$status"
    printf -- '- Mac migration/install: %s\n' "$mac_migration"
    printf -- '- Sparkle update/relaunch: %s / %s\n' "$sparkle_update" "$app_relaunch"
    printf -- '- Skipped Mac/Firmware update: %s / %s\n' "$mac_update_skipped" "$firmware_update_skipped"
    printf -- '- App version/build: %s / %s\n' "$app_version" "$app_build"
    printf -- '- Runtime/listener: %s / %s\n' "$runtime_version" "$listener_ownership"
    printf -- '- Firmware OTA/device identity: %s / %s\n' "$firmware_ota" "$same_device_id"
    printf -- '- Health/stream/render: %s / %s / %s\n' "$health" "$stream" "$render"
    printf -- '- Second flash prevented: %s\n' "$second_flash_prevented"
    [[ -z "$FAILURE" ]] || printf '\nFailure at `%s`: %s\n' "$CURRENT_STAGE" "$FAILURE"
  } > "$RESULTS/summary.md"
}

on_exit() {
  status=$?
  trap - EXIT HUP INT TERM
  if [[ "$status" == "0" ]]; then
    write_result passed
  else
    [[ -n "$FAILURE" ]] || FAILURE="guest command failed with exit ${status}"
    timeline "failed: $FAILURE"
    write_result failed
  fi
  cleanup
  exit "$status"
}
trap on_exit EXIT HUP INT TERM

CURRENT_STAGE="preflight"
timeline "validating private candidate bundle"
for command in codesign curl ditto hdiutil launchctl lsof open pgrep plutil python3 shasum spctl tar; do
  command -v "$command" >/dev/null 2>&1 || die "required guest command is missing: $command"
done
(
  cd "$BUNDLE"
  shasum -a 256 -c checksums.txt >/dev/null
) || die "candidate bundle checksums failed"
grep -q 'sparkle:edSignature=' "$BUNDLE/appcast.xml" \
  || die "real VM tests require a signed private Sparkle appcast"
grep -q '<!-- sparkle-signatures:' "$BUNDLE/appcast.xml" \
  || die "real VM tests require the private Sparkle feed itself to be signed"
bundle_build="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["build"])' "$BUNDLE/candidate.json")"
bundle_candidate="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["candidate"])' "$BUNDLE/candidate.json")"
bundle_baseline="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["baselineApp"])' "$BUNDLE/candidate.json")"
[[ "$bundle_candidate" == "$CANDIDATE" ]] || die "candidate metadata mismatch"
[[ "$bundle_baseline" == "$FROM_APP" ]] || die "public baseline metadata mismatch"

CURRENT_STAGE="baseline"
timeline "checking ${STATE} snapshot baseline"
if [[ "$STATE" == "clean" ]]; then
  [[ ! -e "$APP" ]] || die "clean snapshot already contains the app"
else
  [[ -e "$APP" || "$STATE" == "legacy" ]] || die "native snapshot is missing the public app"
fi

CURRENT_STAGE="candidate-sources"
timeline "starting private artifact server and Virtual VibeTV"
python3 -m http.server 47835 --bind 127.0.0.1 --directory "$BUNDLE" \
  > "$RESULTS/artifact-server.log" 2>&1 &
ARTIFACT_SERVER_PID="$!"
firmware_sha="$(shasum -a 256 "$BUNDLE/firmware.bin" | awk '{print $1}')"
"$BUNDLE/virtual-vibetv" \
  --addr 127.0.0.1:47834 \
  --device-id virtual-vibetv-rc-001 \
  --firmware "$FROM_FIRMWARE" \
  --candidate-firmware "$CANDIDATE_FIRMWARE" \
  --expected-firmware-sha256 "$firmware_sha" \
  --reboot-unavailable-requests 3 \
  > "$RESULTS/virtual-vibetv.log" 2>&1 &
DEVICE_PID="$!"
for url in http://127.0.0.1:47835/candidate.json "$DEVICE_URL/hello"; do
  deadline=$((SECONDS + 20))
  until curl -fsS "$url" >/dev/null 2>&1; do
    (( SECONDS < deadline )) || die "local candidate source did not start: $url"
    sleep 1
  done
done

mkdir -p "$HOME/Library/Application Support/codexbar-display"
python3 - "$HOME/Library/Application Support/codexbar-display/config.json" "$DEVICE_URL" "$TOKEN" <<'PY'
import json, pathlib, sys
path = pathlib.Path(sys.argv[1])
path.write_text(json.dumps({"deviceTarget": sys.argv[2], "deviceToken": sys.argv[3]}, indent=2) + "\n", encoding="utf-8")
path.chmod(0o600)
PY
launchctl setenv CODEXBAR_DISPLAY_MAC_APP_RELEASE_API_URL http://127.0.0.1:47835/mac-app-release.json
launchctl setenv CODEXBAR_DISPLAY_FIRMWARE_MANIFEST_URL http://127.0.0.1:47835/firmware-manifest.json

wait_for_runtime_version() {
  local expected="$1"
  local output="$2"
  local deadline=$((SECONDS + 180))
  while (( SECONDS < deadline )); do
    if curl -fsS "$STATUS_URL" > "$output" 2>/dev/null && \
      python3 - "$output" "$expected" <<'PY'
import json, sys
status = json.load(open(sys.argv[1]))
companion = status.get("companion") or {}
raise SystemExit(
    0 if status.get("ok") is True
    and str(companion.get("version", "")).removeprefix("v") == sys.argv[2]
    else 1
)
PY
    then
      return 0
    fi
    sleep 2
  done
  return 1
}

install_public_baseline() {
  local source_app version
  BASELINE_WORK="$(mktemp -d "${TMPDIR:-/tmp}/vibetv-public-baseline.XXXXXX")"
  BASELINE_MOUNT=""
  cleanup_baseline() {
    [[ -z "$BASELINE_MOUNT" ]] || hdiutil detach "$BASELINE_MOUNT" -quiet >/dev/null 2>&1 || true
    [[ -z "$BASELINE_WORK" ]] || rm -rf "$BASELINE_WORK"
    BASELINE_MOUNT=""
    BASELINE_WORK=""
  }
  hdiutil attach -readonly -nobrowse -plist "$BUNDLE/public-baseline.dmg" > "$BASELINE_WORK/attach.plist"
  BASELINE_MOUNT="$(python3 - "$BASELINE_WORK/attach.plist" <<'PY'
import plistlib, sys
for entity in plistlib.load(open(sys.argv[1], "rb")).get("system-entities", []):
    if entity.get("mount-point"):
        print(entity["mount-point"])
        break
PY
)"
  source_app="$BASELINE_MOUNT/VibeTV Control Center.app"
  [[ -d "$source_app" ]] || die "public baseline DMG has no app bundle"
  codesign --verify --deep --strict --verbose=2 "$source_app"
  spctl --assess --type execute --verbose "$source_app"
  version="$(plutil -extract CFBundleShortVersionString raw -o - "$source_app/Contents/Info.plist")"
  [[ "${version#v}" == "$FROM_APP" ]] || die "public baseline DMG version mismatch"
  rm -rf "$APP"
  ditto "$source_app" "$APP"
  cleanup_baseline
}

CURRENT_STAGE="public-baseline"
timeline "preparing the current public app before the candidate update"
if [[ "$STATE" == "clean" || "$STATE" == "legacy" ]]; then
  install_public_baseline
else
  current_version="$(plutil -extract CFBundleShortVersionString raw -o - "$APP/Contents/Info.plist")"
  [[ "${current_version#v}" == "$FROM_APP" ]] || die "native snapshot app version mismatch"
fi
open "$APP"
wait_for_runtime_version "$FROM_APP" "$RESULTS/baseline-status.json" \
  || die "public baseline runtime did not become healthy"
app_pid_before="$(pgrep -f 'VibeTV Control Center.app/Contents/MacOS/VibeTVControlCenter' | head -n1 || true)"
[[ -n "$app_pid_before" ]] || die "public baseline app is not running"
mac_migration=true

CURRENT_STAGE="mac-install-update"
expected_app_version="$CANDIDATE"
expected_runtime_version="$CANDIDATE"
if [[ "$SKIP_MAC_UPDATE" == "1" ]]; then
  timeline "skipping Mac candidate update by explicit request"
  mac_update_skipped=true
  expected_app_version="$FROM_APP"
  expected_runtime_version="$FROM_APP"
  cp "$RESULTS/baseline-status.json" "$RESULTS/status.json"
else
  timeline "updating the running public app through Sparkle"
  sparkle_work="$RESULTS/sparkle-cli"
  mkdir -p "$sparkle_work"
  tar -xzf "$BUNDLE/sparkle-cli.tar.gz" -C "$sparkle_work"
  sparkle_cli="$sparkle_work/sparkle.app/Contents/MacOS/sparkle"
  [[ -x "$sparkle_cli" ]] || die "Sparkle CLI archive has no executable"
  codesign --verify --deep --strict --verbose=2 "$sparkle_work/sparkle.app"
  "$sparkle_cli" \
    "$APP" \
    --application "$APP" \
    --check-immediately \
    --allow-major-upgrades \
    --feed-url http://127.0.0.1:47835/appcast.xml \
    --user-agent-name CODEX-VibeTV-RC \
    --verbose \
    > "$RESULTS/mac-update.log" 2>&1 \
    || die "Sparkle candidate update failed"
  sparkle_update=true
  wait_for_runtime_version "$CANDIDATE" "$RESULTS/status.json" \
    || die "candidate runtime did not become healthy after Sparkle update"
  app_pid_after="$(pgrep -f 'VibeTV Control Center.app/Contents/MacOS/VibeTVControlCenter' | head -n1 || true)"
  [[ -n "$app_pid_after" && "$app_pid_after" != "$app_pid_before" ]] \
    || die "Sparkle did not relaunch the candidate app with a new process"
  app_relaunch=true
fi

CURRENT_STAGE="mac-final-state"
timeline "verifying app bundle, runtime, SMAppService, and listener"
installed_version="$(plutil -extract CFBundleShortVersionString raw -o - "$APP/Contents/Info.plist")"
installed_build="$(plutil -extract CFBundleVersion raw -o - "$APP/Contents/Info.plist")"
[[ "${installed_version#v}" == "$expected_app_version" ]] || die "installed app version mismatch"
app_version=true
if [[ "$SKIP_MAC_UPDATE" == "1" ]]; then
  [[ -n "$installed_build" ]] || die "installed public app build is missing"
else
  [[ "$installed_build" == "$bundle_build" ]] || die "installed app build mismatch"
fi
app_build=true

status_json="$RESULTS/status.json"
python3 - "$status_json" "$expected_runtime_version" <<'PY' || exit 1
import json, sys
status = json.load(open(sys.argv[1]))
companion = status.get("companion") or {}
raise SystemExit(0 if status.get("ok") is True and str(companion.get("version", "")).removeprefix("v") == sys.argv[2] else 1)
PY
runtime_version=true
runtime_pid="$(launchctl print "gui/$(id -u)/shop.vibetv.control-center.runtime" 2>/dev/null | sed -nE 's/^[[:space:]]*pid = ([0-9]+)$/\1/p')"
[[ "$(printf '%s\n' "$runtime_pid" | awk 'NF{n++} END{print n+0}')" == "1" ]] || die "SMAppService runtime PID is not unique"
listener_pid="$(lsof -nP -a -iTCP@127.0.0.1:47832 -sTCP:LISTEN -Fp 2>/dev/null | sed -nE 's/^p([0-9]+)$/\1/p' | sort -u)"
[[ "$listener_pid" == "$runtime_pid" ]] || die "port 47832 is not owned by the SMAppService runtime"
listener_ownership=true
for legacy_label in com.codexbar-display.daemon com.codexbar-display.companion-api; do
  ! launchctl print "gui/$(id -u)/${legacy_label}" >/dev/null 2>&1 || die "legacy service is still loaded: $legacy_label"
done
single_runtime=true

wait_update_job() {
  local start_file="$1"
  local output_file="$2"
  local job_id
  job_id="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["job"]["id"])' "$start_file")"
  deadline=$((SECONDS + 180))
  while (( SECONDS < deadline )); do
    curl -fsS "http://127.0.0.1:47832/v1/updates/install/status?jobId=${job_id}" > "$output_file"
    phase="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["job"]["phase"])' "$output_file")"
    [[ "$phase" == "complete" ]] && return 0
    [[ "$phase" != "error" ]] || return 1
    sleep 1
  done
  return 1
}

CURRENT_STAGE="firmware-ota"
expected_device_firmware="$CANDIDATE_FIRMWARE"
expected_uploads=1
if [[ "$SKIP_FIRMWARE_UPDATE" == "1" ]]; then
  timeline "skipping firmware candidate update by explicit request"
  firmware_update_skipped=true
  expected_device_firmware="$FROM_FIRMWARE"
  expected_uploads=0
else
  timeline "updating candidate firmware through the real Companion job"
  curl -fsS -X POST -H 'Content-Type: application/json' -d '{}' \
    http://127.0.0.1:47832/v1/updates/install > "$RESULTS/firmware-start.json" \
    || die "firmware update job did not start"
  wait_update_job "$RESULTS/firmware-start.json" "$RESULTS/firmware-result.json" \
    || die "firmware update job failed"
  firmware_ota=true
  [[ "$CANDIDATE_FIRMWARE" != "$FROM_FIRMWARE" ]] || expected_uploads=0
fi

CURRENT_STAGE="device-verification"
timeline "verifying device identity, version, health, stream, and render"
curl -fsS "$DEVICE_URL/hello" > "$RESULTS/device-hello.json"
curl -fsS "$DEVICE_URL/health" > "$RESULTS/device-health.json"
curl -fsS "$DEVICE_URL/__virtual/state" > "$RESULTS/device-state.json"
python3 - "$RESULTS/device-hello.json" "$RESULTS/device-health.json" "$RESULTS/device-state.json" \
  "$expected_device_firmware" "$expected_uploads" <<'PY' || exit 1
import json, sys
hello, health, state = (json.load(open(path)) for path in sys.argv[1:4])
expected = sys.argv[4]
expected_uploads = int(sys.argv[5])
assert hello.get("deviceId") == "virtual-vibetv-rc-001"
assert hello.get("firmware") == expected
assert health.get("ok") is True
assert (health.get("display") or {}).get("themeSpec", {}).get("renderOk") is True
assert state.get("updateUploads") == expected_uploads
PY
same_device_id=true
health=true
render=true
curl -fsS "$STATUS_URL" > "$RESULTS/final-status.json"
deadline=$((SECONDS + 90))
while true; do
  curl -fsS "$STATUS_URL" > "$RESULTS/final-status.json"
  if python3 - "$RESULTS/final-status.json" <<'PY'
import json, sys
status = json.load(open(sys.argv[1]))
device = status.get("device") or {}
stream = device.get("stream") or {}
raise SystemExit(0 if device.get("connected") is True and stream.get("healthy") is True else 1)
PY
  then
    break
  fi
  (( SECONDS < deadline )) || die "display stream did not become healthy"
  sleep 2
done
stream=true

CURRENT_STAGE="second-flash-guard"
if [[ "$SKIP_FIRMWARE_UPDATE" == "1" ]]; then
  timeline "proving the skipped firmware path performed no OTA upload"
else
  timeline "re-running update to prove already-current is a no-op"
  curl -fsS -X POST -H 'Content-Type: application/json' -d '{}' \
    http://127.0.0.1:47832/v1/updates/install > "$RESULTS/firmware-noop-start.json"
  wait_update_job "$RESULTS/firmware-noop-start.json" "$RESULTS/firmware-noop-result.json" \
    || die "already-current update did not complete as a no-op"
fi
curl -fsS "$DEVICE_URL/__virtual/state" > "$RESULTS/device-state-final.json"
python3 - "$RESULTS/device-state-final.json" "$expected_uploads" <<'PY' || exit 1
import json, sys
state = json.load(open(sys.argv[1]))
raise SystemExit(0 if state.get("updateUploads") == int(sys.argv[2]) and not state.get("violations") else 1)
PY
second_flash_prevented=true

CURRENT_STAGE="complete"
timeline "all candidate checks passed"
