#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
companion_dir="$repo_root/companion"

max_cycle_ns="${MAX_CYCLE_NS:-50000}"
max_cycle_allocs="${MAX_CYCLE_ALLOCS:-120}"
max_marshal_ns="${MAX_MARSHAL_NS:-1000}"
max_marshal_allocs="${MAX_MARSHAL_ALLOCS:-4}"

output="$(cd "$companion_dir" && go test ./internal/daemon -run '^$' -bench 'BenchmarkRunCycleWithDeps|BenchmarkMarshalFrameWithinLimit' -benchmem -count=1 2>&1)"
echo "$output"

cycle_line="$(echo "$output" | grep 'BenchmarkRunCycleWithDeps' | tail -n 1)"
marshal_line="$(echo "$output" | grep 'BenchmarkMarshalFrameWithinLimit' | tail -n 1)"

if [ -z "$cycle_line" ] || [ -z "$marshal_line" ]; then
  echo "failed to parse benchmark output" >&2
  exit 1
fi

cycle_ns="$(echo "$cycle_line" | awk '{for (i=1;i<=NF;i++) if (index($i, "ns/op") > 0) {print $(i-1); exit}}')"
cycle_allocs="$(echo "$cycle_line" | awk '{for (i=1;i<=NF;i++) if (index($i, "allocs/op") > 0) {print $(i-1); exit}}')"

marshal_ns="$(echo "$marshal_line" | awk '{for (i=1;i<=NF;i++) if (index($i, "ns/op") > 0) {print $(i-1); exit}}')"
marshal_allocs="$(echo "$marshal_line" | awk '{for (i=1;i<=NF;i++) if (index($i, "allocs/op") > 0) {print $(i-1); exit}}')"

if [ -z "$cycle_ns" ] || [ -z "$cycle_allocs" ] || [ -z "$marshal_ns" ] || [ -z "$marshal_allocs" ]; then
  echo "failed to parse benchmark metrics" >&2
  exit 1
fi

echo "bench budget cycle_ns=${cycle_ns}/${max_cycle_ns} cycle_allocs=${cycle_allocs}/${max_cycle_allocs} marshal_ns=${marshal_ns}/${max_marshal_ns} marshal_allocs=${marshal_allocs}/${max_marshal_allocs}"

ok_cycle_ns="$(awk -v used="$cycle_ns" -v max="$max_cycle_ns" 'BEGIN{if (used <= max) print "1"; else print "0"}')"
ok_cycle_allocs="$(awk -v used="$cycle_allocs" -v max="$max_cycle_allocs" 'BEGIN{if (used <= max) print "1"; else print "0"}')"
ok_marshal_ns="$(awk -v used="$marshal_ns" -v max="$max_marshal_ns" 'BEGIN{if (used <= max) print "1"; else print "0"}')"
ok_marshal_allocs="$(awk -v used="$marshal_allocs" -v max="$max_marshal_allocs" 'BEGIN{if (used <= max) print "1"; else print "0"}')"

if [ "$ok_cycle_ns" != "1" ] || [ "$ok_cycle_allocs" != "1" ] || [ "$ok_marshal_ns" != "1" ] || [ "$ok_marshal_allocs" != "1" ]; then
  echo "companion benchmark budget exceeded" >&2
  exit 1
fi
