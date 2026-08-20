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
# This writes firmware to the VibeTV the Companion currently has configured, so
# it names that device and takes a confirmation first. --yes skips the prompt.
#
#   scripts/vibetv-prove-update-serialization.sh [--yes]

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

ASSUME_YES=0
case "${1:-}" in
  --yes|-y) ASSUME_YES=1 ;;
  '') ;;
  *) echo "usage: $(basename "$0") [--yes]" >&2; exit 2 ;;
esac

before="$(listeners)"
printf 'listener before: %s\n' "${before:-none}"
[[ -n "$before" ]] || { echo 'error: no Companion runtime on 47832' >&2; exit 1; }

# A bench script that flashes whichever device happens to be configured is one
# stale terminal away from writing to the wrong live VibeTV. Name the device and
# the command, and fail closed when the Companion cannot say which device it is.
read -r target device_id firmware <<<"$(
  curl -fsS --max-time 10 "$API/v1/status" 2>/dev/null | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin).get("device") or {}
except Exception:
    d = {}
print(d.get("target") or "-", d.get("deviceId") or "-", d.get("firmware") or "-")
' 2>/dev/null)"
[[ "${target:--}" != "-" ]] \
  || { echo 'error: the Companion names no configured VibeTV; refusing to flash' >&2; exit 1; }

cat <<RISK

This starts a REAL firmware update and fires a CodexBar repair into it.

  device   ${device_id} at ${target}   (firmware ${firmware})
  command  POST ${API}/v1/updates/install

RISK
if [[ "$ASSUME_YES" == 1 ]]; then
  echo 'auto-confirmed (--yes)'
else
  read -r -p "Update this VibeTV now? [y/N] " reply
  [[ "$reply" == [yY] ]] || { echo 'aborted'; exit 1; }
fi

curl -fsS --max-time 30 -H 'Content-Type: application/json' --data '{}' \
  "$API/v1/updates/install" > "$WORK/start.json" || { echo 'error: could not start the update' >&2; exit 1; }
job="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["job"]["id"])' "$WORK/start.json" 2>/dev/null)"
[[ -n "$job" ]] || { echo 'error: no job id' >&2; cat "$WORK/start.json"; exit 1; }
printf 'job: %s\n' "$job"

fired=0 polls=0 answered=0
hold_refusals() {
  # grep -c already prints 0 when it finds nothing, and still exits 1 for it.
  # Adding a fallback value here appends a second line and every (( )) below
  # dies on it, which reads as "the repair never reached the guard".
  local count
  count="$(grep -c 'update hold refused' "$LOG" 2>/dev/null || true)"
  printf '%s' "${count:-0}"
}

holds_before="$(hold_refusals)"
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
      # A failed open leaves the update running undisturbed, every poll answered
      # and the listener unchanged -- the exact shape of a pass. Counting that as
      # a collision is how this script reports PASSED having proven nothing.
      if ! open -a "$APP" "vibetv://repair-codexbar"; then
        echo 'error: could not deliver vibetv://repair-codexbar to the installed app' >&2
        exit 1
      fi
      # Delivery is not collision. The Mac App keeps no log a script can read,
      # so the runtime says it instead: the repair asks for an update hold and is
      # refused while a job owns this process. That refusal is the only evidence
      # from outside that the two actually met.
      for _ in $(seq 1 30); do
        now="$(hold_refusals)"
        if (( now > holds_before )); then
          fired=1
          printf '  >>> %s the repair asked for a hold and was refused\n' "$(date -u +%H:%M:%SZ)"
          break
        fi
        sleep 2
      done
      if [[ "$fired" == 0 ]]; then
        printf '  !! the repair was delivered but never reached the update guard\n'
      fi
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
[[ "$fired" == 1 ]] \
  || printf '!! no repair ever met this job, so nothing about serialisation was proven\n'

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
