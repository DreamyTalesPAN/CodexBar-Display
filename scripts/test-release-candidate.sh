#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUNDLE=""
FROM_APP=""
LEGACY_APP=""
FROM_FIRMWARE=""
CANDIDATE=""
CANDIDATE_FIRMWARE=""
OUTPUT=""
STATES="clean,legacy,native"
DRIVER="tart"
CLEAN_IMAGE="CODEX-vibetv-clean"
LEGACY_IMAGE=""
NATIVE_IMAGE=""
KEEP_FAILED_VM=0
SKIP_MAC_UPDATE=0
SKIP_FIRMWARE_UPDATE=0
ACTIVE_VM=""
ACTIVE_DRIVER=""
ACTIVE_RESULT=""

usage() {
  cat <<'EOF'
Usage:
  ./scripts/test-release-candidate.sh \
    --from-app <current-public-version> \
    --legacy-app <previous-public-or-migration-floor-version> \
    --from-firmware <current-public-version> \
    --candidate <candidate-version> \
    --bundle <private-candidate-directory> \
    [--candidate-firmware <version>] [--output <directory>]

Optional VM settings:
  --vm-driver tart|fake|/path/to/driver
  --states clean,legacy,native
  --clean-image <Tart image>
  --legacy-image <Tart image>
  --native-image <Tart image>
  --keep-failed-vm
  --skip-mac-update
  --skip-firmware-update
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
    --bundle) need_value "$1" "${2:-}"; BUNDLE="$2"; shift 2 ;;
    --from-app) need_value "$1" "${2:-}"; FROM_APP="${2#v}"; shift 2 ;;
    --legacy-app) need_value "$1" "${2:-}"; LEGACY_APP="${2#v}"; shift 2 ;;
    --from-firmware) need_value "$1" "${2:-}"; FROM_FIRMWARE="${2#v}"; shift 2 ;;
    --candidate) need_value "$1" "${2:-}"; CANDIDATE="${2#v}"; shift 2 ;;
    --candidate-firmware) need_value "$1" "${2:-}"; CANDIDATE_FIRMWARE="${2#v}"; shift 2 ;;
    --output) need_value "$1" "${2:-}"; OUTPUT="$2"; shift 2 ;;
    --states) need_value "$1" "${2:-}"; STATES="$2"; shift 2 ;;
    --vm-driver) need_value "$1" "${2:-}"; DRIVER="$2"; shift 2 ;;
    --clean-image) need_value "$1" "${2:-}"; CLEAN_IMAGE="$2"; shift 2 ;;
    --legacy-image) need_value "$1" "${2:-}"; LEGACY_IMAGE="$2"; shift 2 ;;
    --native-image) need_value "$1" "${2:-}"; NATIVE_IMAGE="$2"; shift 2 ;;
    --keep-failed-vm) KEEP_FAILED_VM=1; shift ;;
    --skip-mac-update) SKIP_MAC_UPDATE=1; shift ;;
    --skip-firmware-update) SKIP_FIRMWARE_UPDATE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

for version_name in FROM_APP LEGACY_APP FROM_FIRMWARE CANDIDATE; do
  version="${!version_name}"
  [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]] \
    || die "${version_name,,} must be a SemVer release version"
done
[[ -n "$CANDIDATE_FIRMWARE" ]] || CANDIDATE_FIRMWARE="$CANDIDATE"
[[ "$CANDIDATE_FIRMWARE" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]] \
  || die "candidate firmware must be a SemVer release version"
[[ -d "$BUNDLE" ]] || die "candidate bundle not found: $BUNDLE"
for required in candidate.json checksums.txt appcast.xml firmware-manifest.json mac-app-release.json \
  VibeTV-Control-Center.dmg public-baseline.dmg firmware.bin sparkle-cli.tar.gz \
  virtual-vibetv install-candidate-mac-app.sh; do
  [[ -e "$BUNDLE/$required" ]] || die "candidate bundle is missing $required"
done
(
  cd "$BUNDLE"
  shasum -a 256 -c checksums.txt >/dev/null
) || die "candidate bundle checksum validation failed"
bundle_candidate="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["candidate"])' "$BUNDLE/candidate.json")"
[[ "$bundle_candidate" == "$CANDIDATE" ]] \
  || die "bundle candidate ${bundle_candidate} does not match --candidate ${CANDIDATE}"
bundle_firmware="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("candidateFirmware", ""))' "$BUNDLE/candidate.json")"
[[ "$bundle_firmware" == "$CANDIDATE_FIRMWARE" ]] \
  || die "bundle firmware ${bundle_firmware} does not match --candidate-firmware ${CANDIDATE_FIRMWARE}"
bundle_baseline="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("baselineApp", ""))' "$BUNDLE/candidate.json")"
[[ "$bundle_baseline" == "$FROM_APP" ]] \
  || die "bundle baseline ${bundle_baseline} does not match --from-app ${FROM_APP}"

case "$DRIVER" in
  tart|fake) ACTIVE_DRIVER="$ROOT/scripts/release-candidate/drivers/${DRIVER}.sh" ;;
  *) ACTIVE_DRIVER="$DRIVER" ;;
esac
[[ -x "$ACTIVE_DRIVER" ]] || die "VM driver is not executable: $ACTIVE_DRIVER"
[[ -n "$LEGACY_IMAGE" ]] || LEGACY_IMAGE="CODEX-vibetv-legacy-${LEGACY_APP}"
[[ -n "$NATIVE_IMAGE" ]] || NATIVE_IMAGE="CODEX-vibetv-native-${FROM_APP}"
[[ -n "$OUTPUT" ]] || OUTPUT="$ROOT/tmp/release-candidate/${CANDIDATE}-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$OUTPUT"
RUN_DIR="$(cd "$OUTPUT" && pwd)"
SHARE_DIR="$RUN_DIR/shared"
mkdir -p "$SHARE_DIR/bundle" "$SHARE_DIR/results"
cp -R "$BUNDLE/." "$SHARE_DIR/bundle/"
cp "$ROOT/scripts/release-candidate/guest-run.sh" "$SHARE_DIR/guest-run.sh"
chmod 755 "$SHARE_DIR/guest-run.sh"

export VIBETV_RC_FAKE_SHARE_DIR="$SHARE_DIR"
printf 'Release candidate %s\n' "$CANDIDATE" > "$RUN_DIR/host.log"

cleanup_active_vm() {
  local failed="${1:-0}"
  [[ -n "$ACTIVE_VM" ]] || return 0
  "$ACTIVE_DRIVER" stop "$ACTIVE_VM" >> "$RUN_DIR/host.log" 2>&1 || true
  if [[ "$KEEP_FAILED_VM" == "1" && "$failed" != "0" ]]; then
    printf 'Keeping failed VM: %s\n' "$ACTIVE_VM" | tee -a "$RUN_DIR/host.log"
    ACTIVE_VM=""
    return 0
  fi
  if "$ACTIVE_DRIVER" delete "$ACTIVE_VM" >> "$RUN_DIR/host.log" 2>&1; then
    if [[ -f "$ACTIVE_RESULT" ]]; then
      python3 - "$ACTIVE_RESULT" <<'PY'
import json, pathlib, sys
path = pathlib.Path(sys.argv[1])
data = json.loads(path.read_text(encoding="utf-8"))
data.setdefault("checks", {})["snapshotDisposed"] = True
path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")
PY
    fi
  else
    printf 'Failed to delete VM: %s\n' "$ACTIVE_VM" | tee -a "$RUN_DIR/host.log"
    return 1
  fi
  ACTIVE_VM=""
}

on_exit() {
  status=$?
  trap - EXIT HUP INT TERM
  cleanup_active_vm "$status" || status=1
  exit "$status"
}
trap on_exit EXIT HUP INT TERM

"$ACTIVE_DRIVER" check
IFS=',' read -r -a requested_states <<< "$STATES"
overall_status=0
for state in "${requested_states[@]}"; do
  case "$state" in
    clean) source_image="$CLEAN_IMAGE" ;;
    legacy) source_image="$LEGACY_IMAGE" ;;
    native) source_image="$NATIVE_IMAGE" ;;
    *) die "unsupported state: $state" ;;
  esac
  vm_name="CODEX-rc-${state}-${CANDIDATE//[^0-9A-Za-z]/-}-$$"
  result_dir="$SHARE_DIR/results/$state"
  mkdir -p "$result_dir"
  ACTIVE_VM="$vm_name"
  ACTIVE_RESULT="$result_dir/result.json"
  printf 'state=%s source=%s vm=%s\n' "$state" "$source_image" "$vm_name" | tee -a "$RUN_DIR/host.log"
  "$ACTIVE_DRIVER" clone "$source_image" "$vm_name" >> "$RUN_DIR/host.log" 2>&1
  "$ACTIVE_DRIVER" run "$vm_name" "$SHARE_DIR" "$RUN_DIR/$state" >> "$RUN_DIR/host.log" 2>&1
  guest_results="/Volumes/My Shared Files/codex-rc/results/$state"
  state_status=0
  guest_args=(
    --state "$state" \
    --bundle "/Volumes/My Shared Files/codex-rc/bundle" \
    --results "$guest_results" \
    --from-app "$FROM_APP" \
    --from-firmware "$FROM_FIRMWARE" \
    --candidate "$CANDIDATE" \
    --candidate-firmware "$CANDIDATE_FIRMWARE"
  )
  [[ "$SKIP_MAC_UPDATE" == "0" ]] || guest_args+=(--skip-mac-update)
  [[ "$SKIP_FIRMWARE_UPDATE" == "0" ]] || guest_args+=(--skip-firmware-update)
  if ! "$ACTIVE_DRIVER" exec "$vm_name" \
    /Volumes/My\ Shared\ Files/codex-rc/guest-run.sh \
    "${guest_args[@]}" \
    >> "$RUN_DIR/host.log" 2>&1; then
    state_status=1
    overall_status=1
  fi
  cleanup_active_vm "$state_status" || overall_status=1
done

python3 - "$SHARE_DIR/results" "$RUN_DIR" "$CANDIDATE" <<'PY'
import json, pathlib, sys
results_root = pathlib.Path(sys.argv[1])
run_dir = pathlib.Path(sys.argv[2])
candidate = sys.argv[3]
states = []
for path in sorted(results_root.glob("*/result.json")):
    states.append(json.loads(path.read_text(encoding="utf-8")))
status = "passed" if states and all(item.get("status") == "passed" for item in states) else "failed"
payload = {"schemaVersion": 1, "candidate": candidate, "status": status, "states": states}
(run_dir / "result.json").write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
lines = [f"# VibeTV release candidate {candidate}", "", f"Overall: **{status}**", ""]
for item in states:
    lines.append(f"- {item.get('state', 'unknown')}: {item.get('status', 'missing')}")
(run_dir / "summary.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
PY

printf 'Machine result: %s\n' "$RUN_DIR/result.json"
printf 'Human summary: %s\n' "$RUN_DIR/summary.md"
exit "$overall_status"
