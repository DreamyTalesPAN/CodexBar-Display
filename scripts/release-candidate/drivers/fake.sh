#!/usr/bin/env bash
set -euo pipefail

command_name="${1:-}"
shift || true
log_file="${VIBETV_RC_FAKE_DRIVER_LOG:-/dev/null}"
printf '%s %s\n' "$command_name" "$*" >> "$log_file"

case "$command_name" in
  check|clone|run|stop|delete)
    exit 0
    ;;
  exec)
    vm_name="${1:?VM name required}"
    shift
    state=""
    results=""
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --state) state="$2"; shift 2 ;;
        --results) results="$2"; shift 2 ;;
        *) shift ;;
      esac
    done
    [[ -n "$state" && -n "$results" ]] || exit 2
    host_results="${VIBETV_RC_FAKE_SHARE_DIR:?}/${results#/Volumes/My Shared Files/codex-rc/}"
    mkdir -p "$host_results/screenshots"
    status="${VIBETV_RC_FAKE_STATUS:-passed}"
    python3 - "$host_results/result.json" "$state" "$status" "$vm_name" <<'PY'
import json, pathlib, sys
path, state, status, vm = sys.argv[1:]
payload = {
    "schemaVersion": 1,
    "state": state,
    "status": status,
    "vm": vm,
    "checks": {
        "macMigration": status == "passed",
        "sparkleUpdate": status == "passed",
        "appRelaunch": status == "passed",
        "macUpdateSkipped": False,
        "firmwareUpdateSkipped": False,
        "appVersion": status == "passed",
        "appBuild": status == "passed",
        "runtimeVersion": status == "passed",
        "listenerOwnership": status == "passed",
        "firmwareOTA": status == "passed",
        "sameDeviceId": status == "passed",
        "health": status == "passed",
        "stream": status == "passed",
        "render": status == "passed",
        "secondFlashPrevented": status == "passed",
        "snapshotDisposed": False,
    },
}
pathlib.Path(path).write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
PY
    printf '# %s\n\nStatus: %s\n' "$state" "$status" > "$host_results/summary.md"
    printf '{"event":"fake guest complete","state":"%s"}\n' "$state" > "$host_results/timeline.jsonl"
    : > "$host_results/screenshots/final.png"
    [[ "$status" == "passed" ]]
    ;;
  *)
    exit 2
    ;;
esac
