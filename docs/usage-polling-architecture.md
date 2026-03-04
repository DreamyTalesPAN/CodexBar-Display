# Usage Polling Architecture and Benchmarks

This document is the single reference for how `codexbar-display` fetches usage data, why stale values can appear, and how to benchmark/tune polling behavior.

## Scope

- Companion runtime (`companion/internal/daemon`)
- CodexBar fetch layer (`companion/internal/codexbar`)
- macOS LaunchAgent runtime behavior
- Benchmark workflow for latency and allocation budgets

## Upstream CodexBar CLI Reference

Primary upstream docs:

- CLI reference: <https://github.com/steipete/CodexBar/blob/main/docs/cli.md>
- Refresh loop: <https://github.com/steipete/CodexBar/blob/main/docs/refresh-loop.md>
- Status polling: <https://github.com/steipete/CodexBar/blob/main/docs/status.md>

Upstream commands we rely on in this repo:

- Aggregated usage: `codexbar usage --json --web-timeout 8`
- Provider-scoped usage: `codexbar usage --json --provider <provider> --web-timeout <n>`
- Codex CLI-priority path: `codexbar usage --json --provider codex --source cli`
- Debug/structured logging flags:
  - `--json-output`
  - `--json-only`
  - `--log-level <trace|debug|...>`

## Current Polling Architecture (This Repo)

### 1) Daemon cadence

- Default render interval: `60s`
- Runtime loop is in `companion/internal/daemon/daemon.go`
- Collector runs in background and provides provider snapshots to render cycles

### 2) Provider collector behavior

Collector knobs (env vars):

- `CODEXBAR_DISPLAY_COLLECTOR_INTERVAL_SECS`
  - bounded to `30s..60s`
- `CODEXBAR_DISPLAY_PROVIDER_TIMEOUT_SECS`
  - bounded to `2s..4s` (default `4s`)
- `CODEXBAR_DISPLAY_PROVIDER_MAX_PARALLEL`
  - bounded to `1..4` (default `3`)
- `CODEXBAR_DISPLAY_PROVIDER_ORDER`
  - comma-separated provider order override

Per-provider fetch path:

1. For `codex`: try CLI-priority provider call first (`--provider codex --source cli`)
2. Otherwise call provider-scoped usage (`--provider <key> --web-timeout <n>`)
3. `CODEXBAR_DISPLAY_PROVIDER_WEB_TIMEOUT_SECS` controls provider web timeout (`2..8`, default `3`)

### 3) Selection path

Provider selection order in `ProviderSelector`:

1. Local activity signal (`local-activity`)
2. Usage delta (`usage-delta`)
3. Sticky current provider (`sticky-current`)
4. CodexBar provider order (`codexbar-order`)

### 4) Fallback/staleness behavior

When provider fetches fail:

- Collector keeps previously successful provider snapshots
- Render cycle can continue sending stale values via:
  - snapshot reuse
  - last-good fallback frame

Related env vars:

- `CODEXBAR_DISPLAY_LAST_GOOD_MAX_AGE`
- `CODEXBAR_DISPLAY_PROVIDER_LAST_GOOD_MAX_AGE`

Important practical implication:

- If real command latency is above collector timeout, `collector succeeded=0` can persist while stale values remain visible on device.

## Benchmark Workflow

Use both host-command latency measurements and daemon micro-benchmarks.

### A) Command latency benchmarks (real machine behavior)

Run:

```bash
./scripts/bench-codexbar-usage-latency.sh 5
```

This script measures:

- `codexbar usage --provider codex --source cli --json`
- `codexbar usage --provider codex --json --web-timeout 8`
- `codexbar usage --json --web-timeout 8`

### B) Daemon micro-benchmarks (code-level budget)

Run:

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
~/Library/Application\ Support/codexbar-display/bin/codexbar-display health
tail -n 200 /tmp/codexbar-display-daemon.out.log
```

Look for:

- `collector complete ... succeeded=<n> timeout=<x>s`
- `sent frame -> ... reason=<...>`
- large gaps between `sent frame ->` events

## Sample Measurements (2026-03-04, MacBook Pro M3)

Host command latency (under local load):

| Command | Observed real time |
|---|---|
| `codexbar usage --provider codex --source cli --json` | `1.92s` |
| `codexbar usage --provider codex --json --web-timeout 8` | `54.61s` |
| `codexbar usage --json --web-timeout 8` | `99.51s` |

Additional spot-check (same day): `codexbar usage --provider codex --source cli --json` also measured `5.98s` and `5.42s`.

Daemon benchmark:

| Benchmark | Result |
|---|---|
| `BenchmarkRunCycleWithDeps` | `45867 ns/op`, `4351 B/op`, `71 allocs/op` |
| `BenchmarkMarshalFrameWithinLimit` | `1911 ns/op`, `224 B/op`, `2 allocs/op` |

Interpretation:

- If collector timeout is `3s` or `4s`, even moderate provider latency (`~5s`) will fail consistently.
- Long-tail spikes (`50s+`) make stale fallback behavior inevitable with current timeout caps.
- Persistent provider timeouts lead to stale snapshot rendering.

## Tuning Checklist

1. Measure `p50/p95` command latency on target hardware (idle and loaded).
2. Set collector/provider timeouts to exceed `p95` with margin.
3. Validate `collector succeeded` is non-zero during normal operation.
4. Validate `last sent frame` freshness in `health`.
5. Re-run daemon micro-benchmarks after changes.

## Known Constraints (Current Main Branch)

- `CODEXBAR_DISPLAY_PROVIDER_TIMEOUT_SECS` max is currently hard-clamped to `4s`.
- `CODEXBAR_DISPLAY_PROVIDER_WEB_TIMEOUT_SECS` max is currently hard-clamped to `8s`.

If measured `p95` exceeds these caps on real machines, reliability requires code changes (not only config changes).
