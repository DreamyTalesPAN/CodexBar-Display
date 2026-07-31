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
- **VibeTV firmware** renders the generic frame it receives.

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
second CodexBar fetch path.

`/v1/usage` reports:

- `refreshing`: the requested collection has not completed; usable last-good
  values remain visible.
- `rate_limited`: CodexBar reported a provider rate limit; usable last-good
  values remain visible.
- `fresh`: at least one usable collector snapshot satisfies the request.
- `unavailable`: no usable collector snapshot exists.

`blockedUntil` is returned only when CodexBar supplies a real timestamp. The Mac
App does not synthesize a cooldown from an error message.

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
