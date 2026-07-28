#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VALIDATOR="${ROOT}/scripts/validate-hardware-canary.py"
REPO="DreamyTalesPAN/CodexBar-Display"
CANDIDATE_RUN_ID=""; CANDIDATE_DIR=""; TARGET=""; EXPECTED_DEVICE_ID=""; OUTPUT_DIR=""
RECOVERY_PORT=""; CONFIRM_DEVICE_ID=""; CONFIRM_WRITE_RISK=""; DRY_RUN=0
CONFIRM_RENDER=""; CONFIRM_POWER_CYCLE=""; ACTOR="${USER:-unknown}"

usage() { echo "usage: $0 (--candidate-run-id ID|--candidate-dir DIR) --target URL --expected-device-id ID --output-dir DIR [--recovery-port PORT --confirm-device-id ID --confirm-hardware-write-risk] [--dry-run]" >&2; exit 2; }
die() { echo "error: $*" >&2; exit 1; }
while [[ $# -gt 0 ]]; do case "$1" in
  --candidate-run-id) CANDIDATE_RUN_ID="${2:-}"; shift 2;; --candidate-dir) CANDIDATE_DIR="${2:-}"; shift 2;; --target) TARGET="${2:-}"; shift 2;; --expected-device-id) EXPECTED_DEVICE_ID="${2:-}"; shift 2;; --output-dir) OUTPUT_DIR="${2:-}"; shift 2;;
  --recovery-port) RECOVERY_PORT="${2:-}"; shift 2;; --confirm-device-id) CONFIRM_DEVICE_ID="${2:-}"; shift 2;; --confirm-hardware-write-risk) CONFIRM_WRITE_RISK=1; shift;; --confirm-render-visible) CONFIRM_RENDER=1; shift;; --confirm-power-cycle-10s) CONFIRM_POWER_CYCLE=1; shift;; --actor) ACTOR="${2:-}"; shift 2;; --dry-run) DRY_RUN=1; shift;; *) usage;; esac; done
[[ -n "$TARGET" && -n "$EXPECTED_DEVICE_ID" && -n "$OUTPUT_DIR" ]] || usage
[[ -n "$CANDIDATE_RUN_ID" || -n "$CANDIDATE_DIR" ]] && [[ -z "$CANDIDATE_RUN_ID" || -z "$CANDIDATE_DIR" ]] || usage
if (( DRY_RUN )); then
  [[ -n "$CANDIDATE_DIR" ]] && "$VALIDATOR" candidate --candidate-dir "$CANDIDATE_DIR" >/dev/null
  echo "DRY RUN: no network, launchctl, or hardware command will run"
  echo "candidate verified${CANDIDATE_DIR:+: ${CANDIDATE_DIR}}"
  echo "plan: read-only /hello and /health; exact candidate daemon render; firmware write only with recovery port and both confirmations"
  exit 0
fi

work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
if [[ -n "$CANDIDATE_RUN_ID" ]]; then
  gh run download "$CANDIDATE_RUN_ID" --repo "$REPO" --name vibetv-release-candidate --dir "$work/candidate"
  gh run download "$CANDIDATE_RUN_ID" --repo "$REPO" --name vibetv-release-candidate-result --dir "$work/candidate-result"
  CANDIDATE_DIR="$work/candidate"
  "$VALIDATOR" candidate-result --candidate-dir "$CANDIDATE_DIR" --result "$work/candidate-result/candidate-result.json" >/dev/null
fi
"$VALIDATOR" candidate --candidate-dir "$CANDIDATE_DIR" >/dev/null
manifest="$CANDIDATE_DIR/candidate-manifest.json"
read_json() { python3 - "$manifest" "$1" <<'PY'
import json,sys
b=json.load(open(sys.argv[1])); q=sys.argv[2]
if q=='companion': print(next(x['path'] for x in b['artifacts'] if x['role']=='companion'))
elif q=='firmware-manifest': print(next(x['path'] for x in b['artifacts'] if x['role']=='firmware-manifest'))
elif q=='version': print(b['version'])
PY
}
companion="$CANDIDATE_DIR/$(read_json companion)"; firmware_manifest="$CANDIDATE_DIR/$(read_json firmware-manifest)"
write_evidence() {
  local result="$1" before_value="$2" after_value="$3"
  mkdir -p "$OUTPUT_DIR"
  python3 - "$manifest" "$CANDIDATE_DIR" "$OUTPUT_DIR/hardware-canary.json" "$EXPECTED_DEVICE_ID" "$board" "$before_value" "$after_value" "$ACTOR" "$result" <<'PY'
import hashlib,json,sys,datetime,pathlib
manifest,root,out,device,board,before,after,actor,result=sys.argv[1:]
b=json.load(open(manifest)); root=pathlib.Path(root)
hashes={a['path']: hashlib.sha256((root/a['path']).read_bytes()).hexdigest() for a in b['artifacts']}
now=datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat().replace('+00:00','Z')
e={'schemaVersion':1,'repository':b['repository'],'sourceSha':b['sourceSha'],'version':b['version'],'candidateRunId':b['candidateRunId'],'candidateManifestSha256':hashlib.sha256(pathlib.Path(manifest).read_bytes()).hexdigest(),'artifactHashes':hashes,'device':{'deviceId':device,'board':board,'firmwareBefore':before,'firmwareAfter':after},'checks':{'candidateVerified':True,'hello':True,'health':True,'daemonRender':result=='success'},'timestamps':{'startedAt':now,'finishedAt':now},'actor':actor,'result':result}
json.dump(e,open(out,'w'),separators=(',',':'))
PY
}
hello="$(curl -fsS "$TARGET/hello")"; health="$(curl -fsS "$TARGET/health")"
read -r board before < <(python3 - "$hello" "$health" "$EXPECTED_DEVICE_ID" <<'PY'
import json,sys
h=json.loads(sys.argv[1]); x=json.loads(sys.argv[2]); w=sys.argv[3]
assert h.get('deviceId') == w and h.get('board')
assert x.get('ok') is True
print(h['board'], h['firmware'])
PY
)
candidate_version="$(python3 - "$firmware_manifest" "$board" <<'PY'
import json,sys
body=json.load(open(sys.argv[1])); board=sys.argv[2]
print(next(a['firmwareVersion'] for a in body['artifacts'] if a.get('board') == board))
PY
)"
if [[ "$before" != "$candidate_version" ]]; then
  [[ -n "$RECOVERY_PORT" && "$CONFIRM_DEVICE_ID" == "$EXPECTED_DEVICE_ID" && -n "$CONFIRM_WRITE_RISK" ]] || die "firmware write requires --recovery-port, exact --confirm-device-id, and --confirm-hardware-write-risk"
  mkdir -p "$OUTPUT_DIR"
  "${ROOT}/scripts/esp8266-backup.sh" "$RECOVERY_PORT" "$OUTPUT_DIR/usb-backup.bin" 0x400000
  cp "$firmware_manifest" "$OUTPUT_DIR/candidate-firmware-manifest.json"
fi
python3 -m http.server 0 --directory "$CANDIDATE_DIR" >"$work/http.log" 2>&1 & server_pid=$!
trap 'kill "$server_pid" 2>/dev/null || true; rm -rf "$work"' EXIT
port="$(python3 -u - "$work/http.log" <<'PY'
import sys,time,re
for _ in range(100):
 try:
  s=open(sys.argv[1]).read(); m=re.search(r'port (\d+)',s)
  if m: print(m.group(1)); break
 except FileNotFoundError: pass
 time.sleep(.05)
PY
)"
[[ -n "$port" ]] || die "local candidate manifest server did not start"
write_started=1
on_write_error() {
  write_evidence unknown "$before" "" || true
  echo "OTA outcome unknown: STOP. Read-only diagnosis only; no retry or rollback. Recovery: $companion restore-known-good --port $RECOVERY_PORT" >&2
}
trap 'on_write_error' ERR
"$companion" install-update --target "$TARGET" --manifest-url "http://127.0.0.1:$port/${firmware_manifest#$CANDIDATE_DIR/}" --skip-launchagent-pause
"$companion" daemon --transport wifi --target "$TARGET" --once
echo "Manual checks required: visually confirm one rendered frame, then power-cycle VibeTV for 10 seconds and confirm it returns."
[[ -n "$CONFIRM_RENDER" && -n "$CONFIRM_POWER_CYCLE" ]] || die "recording success evidence requires --confirm-render-visible and --confirm-power-cycle-10s"
after_hello="$(curl -fsS "$TARGET/hello")"
after="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["firmware"])' "$after_hello")"
write_evidence success "$before" "$after"
echo "Evidence written: $OUTPUT_DIR/hardware-canary.json"
echo "Record with: gh workflow run record-hardware-canary.yml --ref main -f evidence_base64=$(base64 < "$OUTPUT_DIR/hardware-canary.json" | tr -d '\n')"
