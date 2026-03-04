# Usage Polling Architecture and Benchmarks

This document is the reference for how `codexbar-display` fetches usage data, why stale values can appear, and how to benchmark/tune polling behavior.

## Goal

Keep firmware dumb and mirror CodexBar desktop values on the device, while keeping render cycles responsive even when upstream usage calls are slow.

## Upstream CodexBar References

- CLI reference: <https://github.com/steipete/CodexBar/blob/main/docs/cli.md>
- Refresh loop: <https://github.com/steipete/CodexBar/blob/main/docs/refresh-loop.md>
- Status polling: <https://github.com/steipete/CodexBar/blob/main/docs/status.md>

Primary commands used by companion:

- Aggregated usage: `codexbar usage --json --web-timeout 8`
- Codex CLI fallback: `codexbar usage --json --provider codex --source cli`

## Current Runtime Architecture

### 1) Daemon cadence

- LaunchAgent runs `codexbar-display daemon --interval 60s`.
- Daemon starts a background collector (`mode=fetch-all`).
- Render cycle reads collector snapshots and sends one serial frame to device.

### 2) Collector behavior

Collector is aggregate-first:

1. Call `codexbar usage --json --web-timeout 8`.
2. Optional retry after starting CodexBar app when output indicates app/bootstrap issue.
3. If aggregate still fails, try codex CLI-only fallback (`--provider codex --source cli`).
4. If no usable payload exists, daemon serves last-good frame (stale-while-revalidate).

Notes:

- No per-provider fanout polling loop in daemon collector mode.
- Aggregate Codex values are preserved as-is (no replacement by separate codex-cli value when aggregate already contains Codex).

### 3) Selection and staleness

Provider selection in render cycles uses local activity + usage deltas + sticky/current behavior. If collector fetch fails temporarily:

- previous provider snapshots can still be used,
- then persisted last-good frame fallback is used within max-age window.

## Runtime Defaults and Env Knobs

| Area | Env | Default | Bounds / Notes |
|---|---|---:|---|
| Collector fetch timeout | `CODEXBAR_DISPLAY_FETCH_TIMEOUT_SECS` | `600s` | clamped `60..900s` |
| CodexBar command timeout | `CODEXBAR_DISPLAY_TIMEOUT_SECS` | `300s` | used by usage command calls |
| Cycle watchdog timeout | `CODEXBAR_DISPLAY_CYCLE_TIMEOUT_SECS` | `180s` | clamped `5..600s` |
| Collector interval | `CODEXBAR_DISPLAY_COLLECTOR_INTERVAL_SECS` | `60s` | clamped `30..60s` |
| Cold-start fetch timeout (sync path) | `CODEXBAR_DISPLAY_COLDSTART_TIMEOUT_SECS` | `2s` | only when no last-good frame exists |
| Last-good frame max age | `CODEXBAR_DISPLAY_LAST_GOOD_MAX_AGE` | `10m` | stale frame serving window |
| Provider snapshot max age | `CODEXBAR_DISPLAY_PROVIDER_LAST_GOOD_MAX_AGE` | inherits last-good max age | snapshot freshness gate |

## Benchmark Workflow

### A) Command latency benchmark

Quick loop benchmark:

```bash
./scripts/bench-codexbar-usage-latency.sh 5
```

Single-shot check:

```bash
/usr/bin/time -p codexbar usage --json --web-timeout 8 > /tmp/codexbar-usage.json
```

### B) Daemon micro-benchmarks

```bash
cd companion
go test ./internal/daemon -run '^$' -bench 'BenchmarkRunCycleWithDeps|BenchmarkMarshalFrameWithinLimit' -benchmem -count=1
```

Optional budget gate:

```bash
./scripts/check-companion-bench-budget.sh
```

### C) Runtime observability checks

```bash
codexbar-display health
tail -n 200 /tmp/codexbar-display-daemon.out.log
```

Look for:

- `collector started ... mode=fetch-all`
- `collector complete providers=... succeeded=... timeout=... mode=fetch-all`
- `sent frame -> ...`
- absence of `fatal cycle timeout` and `collector fetch-all err=...`

## Benchmark Template

| UTC timestamp | Machine load | Command | Real seconds | Providers returned | Notes |
|---|---|---|---:|---:|---|
| 2026-03-04T10:21:00Z | high (parallel video render) | `codexbar usage --json --web-timeout 8` | 45.55 | 2 | matched device values |
| 2026-03-04T10:13:00Z | high | `codexbar usage --json --web-timeout 8` | 46.69 | 2 | collector stable |
| 2026-03-04T10:08:00Z | very high | `codexbar usage --json --web-timeout 8` | 93.75 | 1 | still within 10m collector budget |

## Tuning Checklist

1. Measure `p50/p95` usage latency on target hardware (idle + loaded).
2. Keep collector timeout above observed `p95` with margin.
3. Verify `collector complete ... succeeded>0` in normal operation.
4. Verify `codexbar-display health` shows fresh `last sent frame`.
5. Re-run daemon micro-benchmarks after runtime changes.
6. Periodically do parity check: device frame session/weekly vs `codexbar usage --json` codex remaining values.
