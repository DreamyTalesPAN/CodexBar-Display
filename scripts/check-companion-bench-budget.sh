#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
companion_dir="$repo_root/companion"

max_cycle_ns="${MAX_CYCLE_NS:-50000}"
max_cycle_allocs="${MAX_CYCLE_ALLOCS:-160}"
max_marshal_ns="${MAX_MARSHAL_NS:-1000}"
max_marshal_allocs="${MAX_MARSHAL_ALLOCS:-4}"

run_benchmark() {
  local benchmark="$1"
  local output

  if ! output="$(cd "$companion_dir" && go test ./internal/daemon -run '^$' -bench "^${benchmark}$" -benchmem -benchtime=3s -count=1 2>&1)"; then
    printf '%s\n' "$output"
    return 1
  fi
  printf '%s\n' "$output"
}

parse_metric() {
  local output="$1"
  local benchmark="$2"

  printf '%s\n' "$output" | awk -v benchmark="$benchmark" '
  index($1, benchmark) == 1 {
    ns = ""
    allocs = ""
    for (i = 1; i <= NF; i++) {
      if ($i == "ns/op") {
        ns = $(i - 1)
      }
      if ($i == "allocs/op") {
        allocs = $(i - 1)
      }
    }
    if (ns == "" || allocs == "") {
      exit 1
    }
    print ns, allocs
    exit
  }
  '
}

if ! cycle_output="$(run_benchmark BenchmarkRunCycleWithDeps)"; then
  exit 1
fi
printf '%s\n' "$cycle_output"

if ! marshal_output="$(run_benchmark BenchmarkMarshalFrameWithinLimit)"; then
  exit 1
fi
printf '%s\n' "$marshal_output"

cycle_metrics="$(parse_metric "$cycle_output" BenchmarkRunCycleWithDeps)"
marshal_metrics="$(parse_metric "$marshal_output" BenchmarkMarshalFrameWithinLimit)"
cycle_ns="$(printf '%s\n' "$cycle_metrics" | awk '{print $1}')"
cycle_allocs="$(printf '%s\n' "$cycle_metrics" | awk '{print $2}')"
marshal_ns="$(printf '%s\n' "$marshal_metrics" | awk '{print $1}')"
marshal_allocs="$(printf '%s\n' "$marshal_metrics" | awk '{print $2}')"

if [ -z "$cycle_ns" ] || [ -z "$cycle_allocs" ] || [ -z "$marshal_ns" ] || [ -z "$marshal_allocs" ]; then
  echo "failed to parse benchmark metrics" >&2
  exit 1
fi

echo "bench budget processes=2 benchtime=3s cycle_ns=${cycle_ns}/${max_cycle_ns} cycle_allocs=${cycle_allocs}/${max_cycle_allocs} marshal_ns=${marshal_ns}/${max_marshal_ns} marshal_allocs=${marshal_allocs}/${max_marshal_allocs}"

ok_cycle_ns="$(awk -v used="$cycle_ns" -v max="$max_cycle_ns" 'BEGIN{if (used <= max) print "1"; else print "0"}')"
ok_cycle_allocs="$(awk -v used="$cycle_allocs" -v max="$max_cycle_allocs" 'BEGIN{if (used <= max) print "1"; else print "0"}')"
ok_marshal_ns="$(awk -v used="$marshal_ns" -v max="$max_marshal_ns" 'BEGIN{if (used <= max) print "1"; else print "0"}')"
ok_marshal_allocs="$(awk -v used="$marshal_allocs" -v max="$max_marshal_allocs" 'BEGIN{if (used <= max) print "1"; else print "0"}')"

if [ "$ok_cycle_ns" != "1" ] || [ "$ok_cycle_allocs" != "1" ] || [ "$ok_marshal_ns" != "1" ] || [ "$ok_marshal_allocs" != "1" ]; then
  echo "companion benchmark budget exceeded" >&2
  exit 1
fi
