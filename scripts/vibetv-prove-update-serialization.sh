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

# A hard-coded 47832 proves nothing here. The managed agent runs with
# --api-fallback, so when that port is taken it serves from a free one and
# publishes the real origin. Against a fixed port this script would drive an
# unrelated service, or update one runtime while firing the repair into another
# and call the result evidence. Resolve the origin, and watch the listener on
# the port that origin names.
# shellcheck source=lib/vibetv-bench-api.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/vibetv-bench-api.sh"
API="$(bench::resolve_api)"
API_PORT="$(bench::api_port "$API")"
APP="/Applications/VibeTV Control Center.app"
LOG="$HOME/Library/Application Support/codexbar-display/logs/daemon.out.log"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

listeners() {
  lsof -nP -a -iTCP@127.0.0.1:"$API_PORT" -sTCP:LISTEN -Fp 2>/dev/null \
    | sed -nE 's/^p([0-9]+)$/\1/p' | sort -u | tr '\n' ' '
}

ASSUME_YES=0
case "${1:-}" in
  --yes|-y) ASSUME_YES=1 ;;
  '') ;;
  *) echo "usage: $(basename "$0") [--yes]" >&2; exit 2 ;;
esac

printf 'companion api:   %s\n' "$API"
# Answering runtime-health is not identity. If that listener is not the runtime
# launchd manages, this run would drive one Companion while the installed app
# repairs another, and every check below would still pass -- an invalid proof is
# worse than no proof, and this one costs real firmware to produce.
bench::api_owned_by_runtime "$API" \
  || { echo "error: $API is not the managed runtime (launchd label $BENCH_RUNTIME_LABEL); refusing to produce evidence" >&2; exit 1; }
before="$(listeners)"
printf 'listener before: %s\n' "${before:-none}"
[[ -n "$before" ]] || { echo "error: no Companion runtime on $API" >&2; exit 1; }

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
# The count of holds this runtime has refused, straight from the API.
#
# This used to grep daemon.out.log for the runtime's refusal line. That can
# never work: the line goes to stderr, and the managed runtime's LaunchAgent
# (macos/VibeTVControlCenter/shop.vibetv.control-center.runtime.plist) sets
# neither StandardOutPath nor StandardErrorPath -- daemon.out.log is written by
# the daemon itself, for other things. So the evidence never appeared and this
# script reported FAILED after flashing real firmware, every time.
#
# Asking the guard ourselves is not a substitute: the running job would answer
# 409 to anyone, so it proves the guard is live and says nothing about whether
# the repair ever reached it. A repair can bail out before asking -- an
# externally delivered vibetv://repair-codexbar returns immediately when a
# preparation already owns the app -- and that is exactly the case this run must
# not report as proven. Only the runtime's own refusal counter distinguishes
# them, so read it before and after the delivery.
hold_refusals() {
  curl -fsS --max-time 12 "$API/v1/runtime-health" 2>/dev/null | python3 -c '
import json, sys
try:
    print(int(json.load(sys.stdin).get("updateHoldRefusals") or 0))
except Exception:
    print(-1)
' 2>/dev/null || printf '%s' -1
}
holds_before="$(hold_refusals)"
[[ "$holds_before" == -1 ]] \
  && echo 'warning: this runtime predates updateHoldRefusals; the collision cannot be proven' >&2
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
      # Delivery is not collision. The repair asks this runtime for an update
      # hold and is refused while a job owns it; that refusal, counted by the
      # runtime itself, is the evidence from outside that the two actually met.
      for _ in $(seq 1 30); do
        now="$(hold_refusals)"
        if [[ "$now" == -1 ]]; then
          printf '  !! this runtime does not report updateHoldRefusals\n'
          break
        fi
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
