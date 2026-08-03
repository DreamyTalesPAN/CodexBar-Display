#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
companion_dir="$repo_root/companion"

max_cycle_ns="${MAX_CYCLE_NS:-50000}"
max_cycle_allocs="${MAX_CYCLE_ALLOCS:-160}"
max_marshal_ns="${MAX_MARSHAL_NS:-1000}"
max_marshal_allocs="${MAX_MARSHAL_ALLOCS:-4}"
sample_count=5

output="$(cd "$companion_dir" && go test ./internal/daemon -run '^$' -bench 'BenchmarkRunCycleWithDeps|BenchmarkMarshalFrameWithinLimit' -benchmem -benchtime=1s -count="$sample_count" 2>&1)"
echo "$output"

benchmark_metrics="$(printf '%s\n' "$output" | awk '
  $1 ~ /^BenchmarkRunCycleWithDeps-/ {
    kind = "cycle"
  }
  $1 ~ /^BenchmarkMarshalFrameWithinLimit-/ {
    kind = "marshal"
  }
  kind != "" {
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
    print kind, ns, allocs
    kind = ""
  }
')"

metric_count() {
  printf '%s\n' "$benchmark_metrics" | awk -v wanted="$1" '$1 == wanted {count++} END {print count + 0}'
}

# Shared-runner contention only inflates elapsed time; allocations stay strict.
best_metric() {
  LC_ALL=C sort -n | awk 'NR == 1 {print; exit}'
}

max_metric() {
  awk 'NR == 1 || $1 > max {max = $1} END {print max}'
}

if [ "$(metric_count cycle)" -ne "$sample_count" ] || [ "$(metric_count marshal)" -ne "$sample_count" ]; then
  echo "failed to parse benchmark samples" >&2
  exit 1
fi

cycle_ns="$(printf '%s\n' "$benchmark_metrics" | awk '$1 == "cycle" {print $2}' | best_metric)"
cycle_allocs="$(printf '%s\n' "$benchmark_metrics" | awk '$1 == "cycle" {print $3}' | max_metric)"
marshal_ns="$(printf '%s\n' "$benchmark_metrics" | awk '$1 == "marshal" {print $2}' | best_metric)"
marshal_allocs="$(printf '%s\n' "$benchmark_metrics" | awk '$1 == "marshal" {print $3}' | max_metric)"

if [ -z "$cycle_ns" ] || [ -z "$cycle_allocs" ] || [ -z "$marshal_ns" ] || [ -z "$marshal_allocs" ]; then
  echo "failed to parse benchmark metrics" >&2
  exit 1
fi

echo "bench budget samples=${sample_count} cycle_ns=${cycle_ns}/${max_cycle_ns} cycle_allocs=${cycle_allocs}/${max_cycle_allocs} marshal_ns=${marshal_ns}/${max_marshal_ns} marshal_allocs=${marshal_allocs}/${max_marshal_allocs}"

ok_cycle_ns="$(awk -v used="$cycle_ns" -v max="$max_cycle_ns" 'BEGIN{if (used <= max) print "1"; else print "0"}')"
ok_cycle_allocs="$(awk -v used="$cycle_allocs" -v max="$max_cycle_allocs" 'BEGIN{if (used <= max) print "1"; else print "0"}')"
ok_marshal_ns="$(awk -v used="$marshal_ns" -v max="$max_marshal_ns" 'BEGIN{if (used <= max) print "1"; else print "0"}')"
ok_marshal_allocs="$(awk -v used="$marshal_allocs" -v max="$max_marshal_allocs" 'BEGIN{if (used <= max) print "1"; else print "0"}')"

if [ "$ok_cycle_ns" != "1" ] || [ "$ok_cycle_allocs" != "1" ] || [ "$ok_marshal_ns" != "1" ] || [ "$ok_marshal_allocs" != "1" ]; then
  echo "companion benchmark budget exceeded" >&2
  exit 1
fi
