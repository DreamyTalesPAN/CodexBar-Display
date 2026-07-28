#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VALIDATOR="${ROOT}/scripts/validate-hardware-canary.py"
REPO="DreamyTalesPAN/CodexBar-Display"
CANDIDATE_RUN_ID=""; CANDIDATE_DIR=""; TARGET=""; EXPECTED_DEVICE_ID=""; OUTPUT_DIR=""
RECOVERY_PORT=""; CONFIRM_DEVICE_ID=""; CONFIRM_WRITE_RISK=""; DRY_RUN=0
CONFIRM_RENDER=""; CONFIRM_POWER_CYCLE=""; ACTOR=""
RESUME_STATE=""

usage() { echo "usage: $0 (--candidate-run-id ID|--candidate-dir DIR) --target URL --expected-device-id ID --output-dir DIR [--recovery-port PORT --confirm-device-id ID --confirm-hardware-write-risk] [--dry-run]" >&2; exit 2; }
die() { echo "error: $*" >&2; exit 1; }
while [[ $# -gt 0 ]]; do case "$1" in
  --candidate-run-id) CANDIDATE_RUN_ID="${2:-}"; shift 2;; --candidate-dir) CANDIDATE_DIR="${2:-}"; shift 2;; --target) TARGET="${2:-}"; shift 2;; --expected-device-id) EXPECTED_DEVICE_ID="${2:-}"; shift 2;; --output-dir) OUTPUT_DIR="${2:-}"; shift 2;;
  --recovery-port) RECOVERY_PORT="${2:-}"; shift 2;; --confirm-device-id) CONFIRM_DEVICE_ID="${2:-}"; shift 2;; --confirm-hardware-write-risk) CONFIRM_WRITE_RISK=1; shift;; --confirm-render-visible) CONFIRM_RENDER=1; shift;; --confirm-power-cycle-10s) CONFIRM_POWER_CYCLE=1; shift;; --actor) ACTOR="${2:-}"; shift 2;; --resume) RESUME_STATE="${2:-}"; shift 2;; --dry-run) DRY_RUN=1; shift;; *) usage;; esac; done
[[ -n "$TARGET" && -n "$EXPECTED_DEVICE_ID" && -n "$OUTPUT_DIR" ]] || usage
if [[ -z "$RESUME_STATE" ]]; then
  [[ -n "$CANDIDATE_RUN_ID" || -n "$CANDIDATE_DIR" ]] && [[ -z "$CANDIDATE_RUN_ID" || -z "$CANDIDATE_DIR" ]] || usage
fi
if (( DRY_RUN )); then
  [[ -n "$CANDIDATE_DIR" ]] && "$VALIDATOR" candidate --candidate-dir "$CANDIDATE_DIR" >/dev/null
  echo "DRY RUN: no network, launchctl, or hardware command will run"
  echo "candidate verified${CANDIDATE_DIR:+: ${CANDIDATE_DIR}}"
  echo "plan: read-only /hello and /health; exact candidate daemon render; firmware write only with recovery port and both confirmations"
  exit 0
fi

semver_compare() {
  python3 - "$1" "$2" <<'PY'
import re,sys
def parse(value):
 m=re.fullmatch(r'v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?', value.strip())
 if not m: raise SystemExit('invalid SemVer: '+value)
 return tuple(map(int,m.group(1,2,3))), m.group(4) or ''
a,b=parse(sys.argv[1]),parse(sys.argv[2])
print(1 if a[0]>b[0] or (a[0]==b[0] and ((not a[1] and b[1]) or a[1]>b[1])) else 0)
PY
}

work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
if [[ -n "$RESUME_STATE" ]]; then
  read -r CANDIDATE_DIR CANDIDATE_RUN_ID EVIDENCE_BEFORE < <(python3 - "$RESUME_STATE" <<'PY'
import json,sys
s=json.load(open(sys.argv[1])); print(s.get('candidateDir',''),s.get('candidateRunId',''),s['firmwareBefore'])
PY
)"
fi
if [[ -n "$CANDIDATE_RUN_ID" ]]; then
  gh run download "$CANDIDATE_RUN_ID" --repo "$REPO" --name vibetv-release-candidate --dir "$work/candidate"
  gh run download "$CANDIDATE_RUN_ID" --repo "$REPO" --name vibetv-release-candidate-result --dir "$work/candidate-result"
  CANDIDATE_DIR="$work/candidate"
  "$VALIDATOR" candidate-result --candidate-dir "$CANDIDATE_DIR" --result "$work/candidate-result/candidate-result.json" >/dev/null
fi
mkdir -p "$OUTPUT_DIR"
if [[ -z "$ACTOR" ]]; then ACTOR="$(gh api user --jq .login)"; fi
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
wait_for_resume_health() {
  local deadline=$((SECONDS + 90)) state="$1"
  while (( SECONDS < deadline )); do
    local next_hello next_health
    if next_hello="$(curl -fsS --max-time 3 "$TARGET/hello" 2>/dev/null)" && next_health="$(curl -fsS --max-time 3 "$TARGET/health" 2>/dev/null)" &&
      python3 - "$state" "$next_hello" "$next_health" <<'PY'
import json,sys
s=json.load(open(sys.argv[1])); h=json.loads(sys.argv[2]); x=json.loads(sys.argv[3])
assert h.get('deviceId') == s['deviceId'] and h.get('board') == s['board'] and h.get('firmware') == s['firmware']
assert x.get('ok') is True and x.get('display',{}).get('themeSpec',{}).get('renderOk') is True
PY
    then RESUME_HELLO="$next_hello"; RESUME_HEALTH="$next_health"; return 0; fi
    sleep 1
  done
  return 1
}
if [[ -n "$RESUME_STATE" ]]; then
  wait_for_resume_health "$RESUME_STATE" || die "resume timed out after 90 seconds waiting for /hello and /health"
  hello="$RESUME_HELLO"; health="$RESUME_HEALTH"
else
  hello="$(curl -fsS --max-time 5 "$TARGET/hello")"; health="$(curl -fsS --max-time 5 "$TARGET/health")"
fi
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
if [[ -n "$RESUME_STATE" ]]; then
  [[ -f "$RESUME_STATE" ]] || die "pending state is missing: $RESUME_STATE"
  [[ -n "$CONFIRM_RENDER" && -n "$CONFIRM_POWER_CYCLE" ]] || die "resume requires --confirm-render-visible and --confirm-power-cycle-10s"
  python3 - "$RESUME_STATE" "$TARGET" "$EXPECTED_DEVICE_ID" "$board" "$candidate_version" "$health" <<'PY'
import json,sys
state,target,device,board,version,health=sys.argv[1:]
s=json.load(open(state)); h=json.loads(health)
assert s['target']==target and s['deviceId']==device and s['board']==board and s['firmware']==version
assert h.get('ok') is True and h.get('display',{}).get('themeSpec',{}).get('renderOk') is True
PY
  if ! resume_daemon_output="$("$companion" daemon --transport wifi --target "$TARGET" --once 2>&1)" || [[ "$resume_daemon_output" != *"sent frame ->"* ]]; then
    write_evidence blocked "${EVIDENCE_BEFORE:-$before}" "$before" || true
    die "resume daemon/render failed; success evidence was not written"
  fi
  write_evidence success "${EVIDENCE_BEFORE:-$before}" "$before"
  echo "Evidence written: $OUTPUT_DIR/hardware-canary.json"
  exit 0
fi
if [[ "$(semver_compare "$candidate_version" "$before")" == 1 ]]; then
  [[ -n "$RECOVERY_PORT" && "$CONFIRM_DEVICE_ID" == "$EXPECTED_DEVICE_ID" && -n "$CONFIRM_WRITE_RISK" ]] || die "firmware write requires --recovery-port, exact --confirm-device-id, and --confirm-hardware-write-risk"
  mkdir -p "$OUTPUT_DIR"
  "${ROOT}/scripts/esp8266-backup.sh" "$RECOVERY_PORT" "$OUTPUT_DIR/usb-backup.bin" 0x400000
  cp "$firmware_manifest" "$OUTPUT_DIR/candidate-firmware-manifest.json"
fi
mkdir -p "$work/serve"
ln -s "$CANDIDATE_DIR" "$work/serve/candidate"
python3 -u -m http.server 0 --directory "$work/serve" >"$work/http.log" 2>&1 & server_pid=$!
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
local_manifest="$work/candidate-firmware-manifest.json"
python3 - "$firmware_manifest" "$manifest" "$local_manifest" "$port" <<'PY'
import json,sys
src,candidate,out,port=sys.argv[1:]; body=json.load(open(src)); candidate=json.load(open(candidate))
for artifact in body['artifacts']:
 match=next((x['path'] for x in candidate['artifacts'] if x['role']=='firmware' and x['path'].endswith(artifact.get('asset','').lstrip('/'))),None)
 if not match: raise SystemExit('candidate firmware artifact missing for '+artifact.get('board',''))
 artifact['firmwareUrl']='http://127.0.0.1:%s/candidate/%s' % (port, match)
json.dump(body,open(out,'w'),separators=(',',':'))
PY
cp "$local_manifest" "$OUTPUT_DIR/candidate-firmware-manifest.json"
if ! "$companion" install-update --target "$TARGET" --manifest-url "http://127.0.0.1:$port/${local_manifest#$work/}" --skip-launchagent-pause; then
  write_evidence unknown "$before" "" || true
  echo "OTA outcome unknown: STOP. Read-only diagnosis only; no retry or rollback. Recovery: $companion restore-known-good --port $RECOVERY_PORT" >&2
  exit 1
fi
if ! daemon_output="$("$companion" daemon --transport wifi --target "$TARGET" --once 2>&1)" || [[ "$daemon_output" != *"sent frame ->"* ]]; then
  write_evidence blocked "$before" "" || true
  echo "daemon/render failed; evidence is blocked and no OTA retry or rollback will run" >&2
  exit 1
fi
echo "Manual checks required: visually confirm one rendered frame, then power-cycle VibeTV for 10 seconds and confirm it returns."
pending="$OUTPUT_DIR/hardware-canary-pending.json"
mkdir -p "$OUTPUT_DIR"
python3 - "$pending" "$TARGET" "$EXPECTED_DEVICE_ID" "$board" "$candidate_version" "$CANDIDATE_DIR" "$CANDIDATE_RUN_ID" "$before" <<'PY'
import json,sys
json.dump(dict(target=sys.argv[2],deviceId=sys.argv[3],board=sys.argv[4],firmware=sys.argv[5],candidateDir=sys.argv[6],candidateRunId=sys.argv[7],firmwareBefore=sys.argv[8]),open(sys.argv[1],'w'))
PY
echo "Power-cycle VibeTV for 10 seconds, then resume read-only: $0 --resume $pending --target $TARGET --expected-device-id $EXPECTED_DEVICE_ID --output-dir $OUTPUT_DIR --confirm-render-visible --confirm-power-cycle-10s"
