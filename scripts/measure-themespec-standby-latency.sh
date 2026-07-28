#!/usr/bin/env bash
# Measures what a standby transition costs on a real VibeTV: how long the device
# needs to load, parse and render a stored ThemeSpec from LittleFS, and how much
# free heap is left afterwards. Backs the #277 measurement.
#
# This writes to the device (POST /theme/active) and therefore needs an explicit
# hardware-test approval per AGENTS.md "Live VibeTV Guardrails". The script
# refuses to run without --approved so it cannot be started by accident.
#
# Usage:
#   scripts/measure-themespec-standby-latency.sh --approved \
#     --device http://192.168.178.72 --token "$VIBETV_TOKEN" \
#     --live /themes/u/claude--3-afab9c.json \
#     --screensaver /themes/u/screensaver.json \
#     --rounds 5
#
# The live theme is activated last, so the device is left as it was found.
set -euo pipefail

DEVICE=""
TOKEN=""
LIVE=""
SCREENSAVER=""
ROUNDS=5
APPROVED=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --approved) APPROVED=1; shift ;;
    --device) DEVICE="$2"; shift 2 ;;
    --token) TOKEN="$2"; shift 2 ;;
    --live) LIVE="$2"; shift 2 ;;
    --screensaver) SCREENSAVER="$2"; shift 2 ;;
    --rounds) ROUNDS="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

if [[ "${APPROVED}" -ne 1 ]]; then
  echo "refusing to run: this writes to a live VibeTV." >&2
  echo "re-run with --approved only after the user approved this hardware test." >&2
  exit 2
fi
if [[ -z "${DEVICE}" || -z "${TOKEN}" || -z "${LIVE}" || -z "${SCREENSAVER}" ]]; then
  echo "usage: $0 --approved --device URL --token TOKEN --live PATH --screensaver PATH [--rounds N]" >&2
  exit 2
fi

health() {
  curl -fsS -m 5 "${DEVICE}/health"
}

# Prints "hash freeHeap maxFreeBlock fragPercent fullCount partialCount".
health_fields() {
  health | python3 -c '
import json, sys
d = json.load(sys.stdin)
spec = d["display"]["themeSpec"]
sysinfo = d["system"]
render = d["render"]
print(spec.get("hash"), sysinfo["freeHeap"], sysinfo["maxFreeBlock"],
      sysinfo["heapFragmentationPercent"], render["fullCount"], render["partialCount"],
      spec.get("renderOk"), spec.get("renderFailures"))
'
}

now_ms() {
  python3 -c 'import time; print(int(time.time()*1000))'
}

# Activates a stored spec and waits until the device has actually redrawn it.
#
# POST /theme/active returns as soon as the file is read and the new spec is
# staged; the compile and the full redraw happen in the following loop pass, and
# render.fullCount only advances once that redraw is done. So the new hash alone
# is not a render signal - both conditions have to hold.
#
# Prints "elapsedMs freeHeap maxFreeBlock fragPercent renderFailures".
activate_and_wait() {
  local path="$1"
  local after started deadline hash_before full_before fields
  read -r hash_before _ _ _ full_before _ _ _ <<<"$(health_fields)"

  started="$(now_ms)"
  curl -fsS -m 10 -X POST "${DEVICE}/theme/active" \
    -H "X-VibeTV-Token: ${TOKEN}" \
    -H "Content-Type: application/json" \
    --data "{\"path\":\"${path}\"}" >/dev/null

  deadline=$(( started + 15000 ))
  while :; do
    fields="$(health_fields || true)"
    if [[ -n "${fields}" ]]; then
      read -r hash free block frag full partial ok failures <<<"${fields}"
      if [[ "${hash}" != "${hash_before}" && "${full}" -gt "${full_before}" ]]; then
        after="$(now_ms)"
        echo "$(( after - started )) ${free} ${block} ${frag} ${failures}"
        return 0
      fi
    fi
    if [[ "$(now_ms)" -gt "${deadline}" ]]; then
      echo "timed out waiting for ${path} to render" >&2
      return 1
    fi
  done
}

echo "device: ${DEVICE}"
echo "baseline /health:"
health | python3 -m json.tool
echo

printf '%-6s %-12s %10s %10s %10s %6s %9s\n' \
  "round" "direction" "elapsedMs" "freeHeap" "maxBlock" "frag%" "failures"

for (( round = 1; round <= ROUNDS; ++round )); do
  read -r ms free block frag failures <<<"$(activate_and_wait "${SCREENSAVER}")"
  printf '%-6s %-12s %10s %10s %10s %6s %9s\n' "${round}" "->screensaver" "${ms}" "${free}" "${block}" "${frag}" "${failures}"
  sleep 2

  read -r ms free block frag failures <<<"$(activate_and_wait "${LIVE}")"
  printf '%-6s %-12s %10s %10s %10s %6s %9s\n' "${round}" "->live" "${ms}" "${free}" "${block}" "${frag}" "${failures}"
  sleep 2
done

echo
echo "final /health:"
health | python3 -m json.tool
echo
echo "note: elapsedMs includes the HTTP round trip and the /health poll interval."
echo "It is an upper bound on the device-side load+parse+render time."
