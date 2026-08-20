#!/usr/bin/env bash
# Proves that a firmware update survives a CodexBar repair fired into it.
#
# A firmware update job lives inside the runtime process and dies with it, so a
# provider recovery that restarts the runtime mid-update strands the customer
# on a progress screen that never answers again. The merge gate found this as
# an empty status file; on the bench it is only visible if the collision is
# forced, because the automatic recovery fires once per incident and usually
# misses the window.
#
# The test fails loudly if the guard is gone: no restart may happen between the
# job's own startedAt and finishedAt, and every status poll must be answered.
#
#   scripts/vibetv-prove-update-serialization.sh

set -uo pipefail
export PATH=/usr/bin:/bin:/usr/sbin:/sbin:$PATH

API="http://127.0.0.1:47832"
APP="/Applications/VibeTV Control Center.app"
LOG="$HOME/Library/Application Support/codexbar-display/logs/daemon.out.log"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

listeners() {
  lsof -nP -a -iTCP@127.0.0.1:47832 -sTCP:LISTEN -Fp 2>/dev/null \
    | sed -nE 's/^p([0-9]+)$/\1/p' | sort -u | tr '\n' ' '
}

before="$(listeners)"
printf 'listener before: %s\n' "${before:-none}"
[[ -n "$before" ]] || { echo 'error: no Companion runtime on 47832' >&2; exit 1; }

curl -fsS --max-time 30 -H 'Content-Type: application/json' --data '{}' \
  "$API/v1/updates/install" > "$WORK/start.json" || { echo 'error: could not start the update' >&2; exit 1; }
job="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["job"]["id"])' "$WORK/start.json" 2>/dev/null)"
[[ -n "$job" ]] || { echo 'error: no job id' >&2; cat "$WORK/start.json"; exit 1; }
printf 'job: %s\n' "$job"

fired=0 polls=0 answered=0
deadline=$((SECONDS + 600))
while (( SECONDS < deadline )); do
  polls=$((polls + 1))
  if curl -fsS --max-time 12 "$API/v1/updates/install/status?jobId=${job}" > "$WORK/status.json" 2>/dev/null \
     && python3 -c 'import json,sys;json.load(open(sys.argv[1]))["job"]' "$WORK/status.json" 2>/dev/null; then
    answered=$((answered + 1))
    read -r phase stage <<<"$(python3 -c '
import json, sys
j = json.load(open(sys.argv[1]))["job"]
print(j.get("phase"), j.get("stage"))' "$WORK/status.json")"
    printf '  %s %s %s\n' "$(date -u +%H:%M:%SZ)" "$phase" "$stage"
    if [[ "$fired" == 0 && "$stage" == uploading ]]; then
      sleep 20
      printf '  >>> %s firing vibetv://repair-codexbar INTO the running job\n' "$(date -u +%H:%M:%SZ)"
      open -a "$APP" "vibetv://repair-codexbar"
      fired=1
    fi
    case "$phase" in complete|error|attention) break ;; esac
  else
    printf '  %s POLL FAILED — the runtime no longer knows this job\n' "$(date -u +%H:%M:%SZ)"
  fi
  sleep 10
done

after="$(listeners)"
printf '\nlistener after:  %s\n' "${after:-none}"
printf 'polls answered:  %s/%s\n' "$answered" "$polls"
[[ "$fired" == 1 ]] || printf '!! the repair was never fired: the job never reached uploading\n'

python3 - "$WORK/status.json" "$LOG" "$before" "$after" "$answered" "$polls" "$fired" <<'PY'
import json, sys
status, log, before, after, answered, polls, fired = sys.argv[1:]
job = json.load(open(status))["job"]
start = job.get("startedAt", "")[:19]
end = (job.get("finishedAt") or "")[:19]
print(f"phase: {job.get('phase')}  outcome: {job.get('outcome')}")
print(f"window: {start} -> {end or '(never finished)'}")

failures = []
if not end:
    failures.append("the job never reached a terminal phase")
else:
    restarts = [l.split()[0][:19] for l in open(log, encoding="utf-8", errors="ignore")
                if "VibeTV companion API listening" in l and start <= l.split()[0][:19] <= end]
    print(f"runtime restarts inside the window: {len(restarts)} {restarts}")
    if restarts:
        failures.append("the runtime restarted while the update was running")
if before.strip() != after.strip():
    failures.append(f"the listener changed: {before.strip()} -> {after.strip()}")
if answered != polls:
    failures.append(f"only {answered} of {polls} status polls were answered")
if fired != "1":
    failures.append("the repair never collided with the job, so nothing was proven")

if failures:
    print("\nFAILED:")
    for f in failures:
        print(f"  - {f}")
    raise SystemExit(1)
print("\nPASSED: the update kept its runtime and stayed addressable throughout")
PY
