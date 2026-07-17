#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HARNESS="${ROOT}/scripts/validate-macos-control-center-runtime.sh"
SWIFT_SOURCE="${ROOT}/macos/VibeTVControlCenter/main.swift"
FIRMWARE_VERSIONS="${ROOT}/release/firmware-versions.json"
TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/vibetv-runtime-contract.XXXXXX")"
trap 'rm -rf "$TMP_ROOT"' EXIT HUP INT TERM

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

assert_contains() {
  [[ "$1" == *"$2"* ]] || die "$3"
}

[[ -x "$HARNESS" ]] || die "runtime validation harness is missing or not executable"
[[ -f "$FIRMWARE_VERSIONS" ]] || die "release firmware versions are missing"

source_app="$TMP_ROOT/Signed Fixture.app"
output="$("$HARNESS" --dry-run --app "$source_app" --expected-version v1.2.3)"
for expected in \
  "NO CHANGES" \
  "loopback-only fake VibeTV" \
  "SMAppService PID" \
  "sole 127.0.0.1:47832 listener" \
  "version=1.2.3 and installationMode=dmg" \
  "same helper PID remains healthy" \
  "unregister only shop.vibetv.control-center.runtime"
do
  assert_contains "$output" "$expected" "dry-run contract is missing: $expected"
done
[[ ! -e "$source_app" ]] || die "dry-run created the fake app path"

if "$HARNESS" --real --app "$source_app" --expected-version 1.2.3 \
  >"$TMP_ROOT/no-opt-in.out" 2>&1; then
  die "real mode ran without its explicit environment opt-in"
fi
assert_contains "$(cat "$TMP_ROOT/no-opt-in.out")" \
  "CODEX_ALLOW_MACOS_RUNTIME_VALIDATION=1" \
  "missing real-mode opt-in must fail before any mutation"

if "$HARNESS" --dry-run --real --app "$source_app" --expected-version 1.2.3 \
  >/dev/null 2>&1; then
  die "harness accepted two execution modes"
fi
if "$HARNESS" --dry-run --app "$source_app" --expected-version latest \
  >/dev/null 2>&1; then
  die "harness accepted an unpinned expected version"
fi

python3 - "$HARNESS" "$SWIFT_SOURCE" "$FIRMWARE_VERSIONS" <<'PY'
import json
import sys

harness = open(sys.argv[1], encoding="utf-8").read()
swift = open(sys.argv[2], encoding="utf-8").read()
with open(sys.argv[3], encoding="utf-8") as source:
    firmware_versions = json.load(source)

esp8266_artifacts = [
    artifact
    for artifact in firmware_versions.get("artifacts", [])
    if artifact.get("firmwareEnv") == "esp8266_smalltv_st7789"
    and artifact.get("board") == "esp8266-smalltv-st7789"
]
if len(esp8266_artifacts) != 1:
    raise SystemExit("release manifest must contain exactly one ESP8266 VibeTV artifact")
version = str(esp8266_artifacts[0].get("firmwareVersion", "")).removeprefix("v")
try:
    version_parts = tuple(int(part) for part in version.split("."))
except ValueError:
    raise SystemExit(f"release ESP8266 firmware version is invalid: {version!r}")
if len(version_parts) != 3:
    raise SystemExit("release ESP8266 firmware version must use x.y.z semver")

required_harness = [
    'FIRMWARE_VERSIONS="$ROOT/release/firmware-versions.json"',
    'artifact.get("firmwareEnv") == "esp8266_smalltv_st7789"',
    'artifact.get("board") == "esp8266-smalltv-st7789"',
    'python3 - "$PORT_FILE" "$REQUEST_LOG" "$FAKE_DEVICE_FIRMWARE" "$FAKE_DEVICE_PAIRING_TOKEN"',
    'port_file, request_log, firmware, pairing_token = sys.argv[1:]',
    '"firmware":firmware',
    'self.headers.get("X-VibeTV-Token") != pairing_token',
    '"deviceToken": sys.argv[3]',
    'RUNTIME_LABEL="shop.vibetv.control-center.runtime"',
    'UNREGISTER_ARGUMENT="--vibetv-validation-unregister-runtime"',
    'UNREGISTER_ENV="VIBETV_RUNTIME_VALIDATION_UNREGISTER"',
    '"$LISTENERS" == "$CURRENT_SERVICE_PID"',
    '"$(listener_pids || true)" == "$SERVICE_PID"',
    'companion.get("installationMode") != "dmg"',
    'grep -qxF /hello',
    'grep -qxF /frame',
]
for snippet in required_harness:
    if snippet not in harness:
        raise SystemExit(f"runtime harness is missing fail-closed contract: {snippet}")
if '"firmware":"1.0.35"' in harness:
    raise SystemExit("runtime harness still hard-codes the blocked ESP8266 firmware")
for forbidden in ["sfltool", ".local", "192.168."]:
    if forbidden in harness:
        raise SystemExit(f"runtime harness must stay loopback-only and scoped: {forbidden}")

required_swift = [
    '"--vibetv-validation-unregister-runtime"',
    '"VIBETV_RUNTIME_VALIDATION_UNREGISTER"',
    "arguments.count == 2",
    'environment[runtimeValidationUnregisterEnvironmentKey] == "1"',
    "SMAppService.agent(plistName: runtimeLaunchAgentPlistName)",
    "service.unregister(completionHandler:",
    'CODEX_RUNTIME_UNREGISTER_OK label=\\(runtimeLaunchAgentLabel)',
]
for snippet in required_swift:
    if snippet not in swift:
        raise SystemExit(f"native cleanup gate is missing: {snippet}")
PY

printf 'macOS Control Center runtime validation contract test passed\n'
