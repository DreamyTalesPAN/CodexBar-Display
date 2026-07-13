#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HARNESS="${ROOT}/scripts/validate-macos-control-center-runtime.sh"
SWIFT_SOURCE="${ROOT}/macos/VibeTVControlCenter/main.swift"
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

python3 - "$HARNESS" "$SWIFT_SOURCE" <<'PY'
import sys

harness = open(sys.argv[1], encoding="utf-8").read()
swift = open(sys.argv[2], encoding="utf-8").read()

required_harness = [
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
for forbidden in ["sfltool", "vibetv.local", "192.168."]:
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
