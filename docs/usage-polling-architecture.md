# Usage Data Architecture

This document describes the normal Mac App runtime path for provider usage and
token history.

## Goal

Mirror CodexBar's provider data in Control Center and on VibeTV without
reimplementing provider behavior. Firmware stays dumb, the Mac App stays
provider-neutral, and temporary collection failures do not create a second
source of truth.

## Ownership

- **CodexBar** owns provider integrations, authentication, provider-specific
  fallbacks, quota mapping, usage-window meaning, provider errors, and provider
  inventory.
- **VibeTV Mac App** supervises the bundled CodexBar process, maps generic
  provider data into the VibeTV protocol, keeps one bounded last-good state, and
  transports the same state to Control Center and VibeTV.
- **Control Center** renders the local API. It does not fetch providers directly,
  keep a second usage cache, or decide provider freshness.
- **VibeTV firmware** renders the generic frame it receives. It does not infer
  activity. The one rule of its own is the expiry the frame itself declares:
  when `activityTtlSecs` has passed without a fresh frame, the device shows not
  working (`protocol/PROTOCOL.md`, Activity and Expiry).

Before changing this path, identify the exact CodexBar version pinned by
`scripts/fetch-codexbar.sh` and inspect that version's output and source.
Upstream `main` and older CodexBar releases are useful context, not the runtime
contract for the bundled app.

## Normal Runtime Path

```text
bundled CodexBar
  -> private loopback `codexbar serve`
  -> `/dashboard/v1/snapshot` plus `/usage`
  -> provider-neutral Companion collector
  -> one persisted provider snapshot set
  -> `/v1/usage` and the VibeTV display stream
```

1. The Mac App starts one private CodexBar serve process on loopback.
2. CodexBar owns its refresh loop. The Mac App disables the serve request
   deadline so a slow successful refresh can complete instead of becoming a
   local HTTP timeout.
3. The collector reads the dashboard snapshot and usage payload from that same
   serve process and maps the returned ordered usage windows generically.
4. The collector stores one snapshot per enabled provider and applies one
   bounded last-good policy.
5. The local API and device frame are derived from that collector-owned state.

The two dashboard endpoints are parts of one CodexBar serve contract, not
independent fallback paths. If the configured serve path is unavailable, the
normal Mac App runtime does not start provider-specific probes or substitute a
different CLI result.

## Provider-Neutral Rules

- Preserve CodexBar provider IDs, ordering, labels, and ordered usage windows.
- Do not assume every provider has Session and Weekly windows.
- Do not invent a missing window, percentage, reset time, or provider.
- A known zero remains zero. Missing or explicitly unknown data remains
  unavailable.
- One unavailable window does not invalidate other known windows.
- Provider-specific source selection, authentication, retries, and quota
  interpretation remain in CodexBar.
- Active-provider selection may use generic activity and usage signals, but it
  must not branch on provider IDs.

## Manual Refresh

Control Center manual refresh wakes the existing collector. It never starts a
second CodexBar fetch path. A request made while one is still waiting keeps the
first request's time, so the reading that answers the first also answers the
second.

`/v1/usage` reports:

- `refreshing`: the requested collection has not completed; usable last-good
  values remain visible.
- `fresh`: at least one usable collector snapshot satisfies the request.
- `unavailable`: no usable collector snapshot exists.

The usage path does not read CodexBar's error text. A provider that cannot
deliver is unavailable whatever reason CodexBar gives. A provider that has never
produced a good frame is reported to the VibeTV like no provider at all; one
with a last-good frame keeps it on screen until it expires and is then sent as
unavailable.

## Freshness Signals

Keep these meanings separate:

- **quota collection time**: when the authoritative CodexBar snapshot was
  generated;
- **provider activity time**: when provider activity was observed;
- **token-history collection time**: when `codexbar cost --json` completed;
- **manual refresh state**: whether a requested collection has completed;
- **last sent frame time**: when the Mac App last wrote a frame to VibeTV.

None of these timestamps refreshes another. The Mac App does not copy
CodexBar's client staleness hint into a second provider deadline. Product-level
availability uses the collector's central bounded last-good policy; after that
window expires, old percentages and reset times become unavailable.

## Token History

Absolute token history is a separate CodexBar contract:

```text
codexbar cost --refresh --days 30 --json
```

Request the window explicitly and force the scan. `codexbar cost --json` alone
returns cached scan results, and CodexBar reports its window total as
`last30DaysTokens` regardless of the window length. Reading the plain command
therefore accepts a warming or shorter-window cache entry and presents it as a
complete 30-day history.

One collector-owned, single-in-flight background scan reads that contract.
Token fields are merged only when reliable values are available. A slow or
failed token scan does not start another token path, does not refresh quota age,
and does not make otherwise valid quota windows unavailable.

### Token scan latency budget

The numbers below are constants in the code; change them there and here
together.

| What | Value | Where |
| --- | --- | --- |
| One `cost` command | 120 s | `tokenStatsCommandTimeout`, `companion/internal/codexbar/token_stats.go` |
| One scan as the collector runs it | 125 s | `tokenStatsCollectorTimeout`, `companion/internal/daemon/collector.go` |
| Wait after a completed scan whose history has settled | 5 min | `tokenStatsScanCooldown`, same file |
| Wait after a failed scan | 1 min | `tokenStatsFailedScanCooldown`, same file |
| Stored totals stay usable | 10 min | `defaultProviderMaxAge`, `companion/internal/daemon/daemon.go` |

- The command budget is above the slowest measured scan: a cold history took
  about 78 s on 2026-07-29. The collector adds 5 s so the scan is not cancelled
  at the same instant as the command.
- A scan is asked for after the first collection, after every usage collection
  (every 30 to 60 s, `collectorInterval`), after a wake, and on every activity
  poll (2 s by default, `activityPollInterval`). Only one scan runs at a time;
  a request while one is running is dropped (`requestTokenStatsScan`).
- Both waits count from the end of the scan, not from its start.
- The 5 min wait applies only once the history has settled: every provider
  with a cost history returned the same history as in the scan before
  (`tokenHistoryFingerprint`). Until then, the first scan included, the next
  scan starts at the next request, so scans run back to back.
- A failed scan (timeout, cancelled, unreadable answer) is tried again after
  1 min instead of 5. The full wait made the retry find the stored totals
  already expired.
- A provider that was just switched on skips the wait once
  (`tokenStatsRescan`, set in `applyProviderInventoryLocked`, PR #541): the
  last scan could not know about it. A running scan is still not interrupted.
- Longest gap between two settled scans: 5 min wait plus 125 s scan, 7 min 5 s,
  which stays inside the 10 min the stored totals are usable.

## Debugging Order

Do not start by adding a fallback, cache, timeout, or provider condition. Find
the first boundary where correct data changes or disappears:

```text
bundled CodexBar output
  -> private serve health and payload
  -> collector snapshot
  -> persisted usage
  -> `/v1/usage`
  -> selected display frame
  -> VibeTV
```

Useful read-only checks:

```bash
codexbar-display health
curl -fsS http://127.0.0.1:47832/v1/status
curl -fsS http://127.0.0.1:47832/v1/usage
tail -n 200 /tmp/codexbar-display-daemon.out.log
```

When direct CodexBar output and the Mac App disagree, treat the direct command
as a diagnostic clue, not permission to add it as a runtime fallback. Inspect
the bundled version and the private serve path first.

## Change Checklist

Before changing usage code:

1. Confirm the bundled CodexBar version and its real contract.
2. Identify the current owner of the incorrect decision.
3. Trace the complete data path and find the first wrong transformation.
4. Delete a conflicting local rule or duplicate path before adding code.
5. Keep the result provider-neutral and preserve unavailable data honestly.
6. Verify the same collector truth reaches `/v1/usage` and the device frame.
7. Run the focused CodexBar and daemon tests, then review the complete diff for
   unnecessary state, timers, caches, and fallbacks.

```bash
cd companion
go test ./internal/codexbar ./internal/daemon
```
