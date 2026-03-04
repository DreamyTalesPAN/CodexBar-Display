# Usage Polling Architecture (Companion)

## Goal

Keep firmware dumb and mirror CodexBar desktop values on the device with a resilient polling model that does not block rendering when upstream usage calls are slow.

## Current Data Path

1. LaunchAgent runs `codexbar-display daemon --interval 60s`.
2. Daemon starts a background collector (`mode=fetch-all`).
3. Collector calls aggregated CodexBar usage:
   - `codexbar usage --json --web-timeout 8`
4. Collector stores fresh provider snapshots in memory.
5. Render cycle reads cached snapshots, selects active provider, and sends one frame over serial.
6. If usage is temporarily unavailable, daemon serves last-good frame (stale-while-revalidate) until max-age is exceeded.

## Fallback Model (Fetch)

`FetchAllProviders` is aggregate-first:

1. Aggregate `usage --json` call.
2. Optional one retry after starting CodexBar app when output indicates app/bootstrap issue.
3. If aggregate still fails: codex CLI-only fallback (`--provider codex --source cli`).
4. If no usable payload exists: return error, daemon falls back to last-good frame.

Notes:
- No per-provider fanout polling loop is used in daemon collector mode.
- Aggregate Codex values are preserved as-is (no replacement by separate codex-cli repair when codex already exists in aggregate payload).

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

### 1) Measure raw CodexBar fetch latency

```bash
/usr/bin/time -p codexbar usage --json --web-timeout 8 > /tmp/codexbar-usage.json
```

### 2) Observe daemon collector/render behavior

```bash
tail -n 200 /tmp/codexbar-display-daemon.out.log
```

Look for:
- `collector started ... mode=fetch-all`
- `collector complete providers=... succeeded=... timeout=... mode=fetch-all`
- `sent frame -> ...`
- absence of `fatal cycle timeout` and `collector fetch-all err=...`

### 3) Confirm runtime health

```bash
codexbar-display health
```

## Benchmark Template

| UTC timestamp | Machine load | Command | Real seconds | Providers returned | Notes |
|---|---|---|---:|---:|---|
| 2026-03-04T10:21:00Z | high (parallel video render) | `codexbar usage --json --web-timeout 8` | 45.55 | 2 | matched device values |
| 2026-03-04T10:13:00Z | high | `codexbar usage --json --web-timeout 8` | 46.69 | 2 | collector stable |
| 2026-03-04T10:08:00Z | very high | `codexbar usage --json --web-timeout 8` | 93.75 | 1 | still within 10m collector budget |

## Tuning Guidance

1. If `collector fetch-all err=context deadline exceeded` appears, increase `CODEXBAR_DISPLAY_FETCH_TIMEOUT_SECS`.
2. Keep collector timeout comfortably above observed p95/p99 `codexbar usage --json` latency on target machines.
3. Keep `CODEXBAR_DISPLAY_LAST_GOOD_MAX_AGE` long enough to bridge temporary upstream outages.
4. Use aggregate parity checks regularly:
   - device frame session/weekly
   - `codexbar usage --json` codex remaining session/weekly

