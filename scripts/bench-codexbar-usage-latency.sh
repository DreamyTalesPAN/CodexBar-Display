#!/usr/bin/env bash
set -euo pipefail

runs="${1:-5}"
if ! [[ "$runs" =~ ^[0-9]+$ ]] || [ "$runs" -le 0 ]; then
  echo "usage: $0 <runs>" >&2
  exit 1
fi

if ! command -v codexbar >/dev/null 2>&1; then
  echo "error: codexbar binary not found in PATH" >&2
  exit 1
fi

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

measure_case() {
  local label="$1"
  shift
  local -a cmd=("$@")

  local case_file="$tmp_dir/${label// /_}.times"
  : >"$case_file"

  echo "== $label =="
  echo "cmd: ${cmd[*]}"

  local success=0
  local failed=0

  for i in $(seq 1 "$runs"); do
    local time_file="$tmp_dir/${label// /_}.${i}.time"
    set +e
    /usr/bin/time -p "${cmd[@]}" >/dev/null 2>"$time_file"
    local status=$?
    set -e

    local real
    real="$(awk '/^real /{print $2}' "$time_file")"
    if [ -n "$real" ]; then
      echo "$real" >>"$case_file"
    fi

    if [ "$status" -eq 0 ]; then
      success=$((success + 1))
    else
      failed=$((failed + 1))
    fi

    printf "run %02d status=%d real=%ss\n" "$i" "$status" "${real:-n/a}"
  done

  if [ ! -s "$case_file" ]; then
    echo "summary: no timing samples captured"
    echo
    return
  fi

  local summary
  summary="$(sort -n "$case_file" | awk '
    {vals[NR]=$1; sum+=$1}
    END {
      n=NR
      p50_idx=int((n+1)/2)
      p95_idx=int((n*95+99)/100)
      if (p95_idx < 1) p95_idx=1
      if (p95_idx > n) p95_idx=n
      printf("summary: n=%d mean=%.3fs p50=%.3fs p95=%.3fs min=%.3fs max=%.3fs",
        n, sum/n, vals[p50_idx], vals[p95_idx], vals[1], vals[n])
    }')"

  echo "$summary success=$success failed=$failed"
  echo
}

measure_case "provider_codex_cli" codexbar usage --provider codex --source cli --json
measure_case "provider_codex_auto" codexbar usage --provider codex --json --web-timeout 8
measure_case "all_providers_auto" codexbar usage --json --web-timeout 8
