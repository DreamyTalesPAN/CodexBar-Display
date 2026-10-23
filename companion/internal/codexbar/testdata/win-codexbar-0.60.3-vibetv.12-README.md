# Windows usage decoding fixture

`win-codexbar-0.60.3-vibetv.12-usage.json` is derived from the source of
[marcus7989/Win-CodexBar, tag v0.60.3-vibetv.12](https://github.com/marcus7989/Win-CodexBar/tree/v0.60.3-vibetv.12),
the exact fork pinned by `scripts/fetch-win-codexbar.ps1`. It is **not a live capture**.

- `rust/src/cli/serve/data.rs`: `/usage` serializes `{provider, source, usage, cost}`.
- `rust/src/core/usage_snapshot.rs`: `UsageSnapshot.extra_rate_windows` and
  `NamedRateWindow {id, title, window}` use snake_case field names without renaming.
- `rust/src/core/rate_window.rs`: `used_percent`, `window_minutes`, `resets_at`
  and `is_informational`; optional duration/reset fields are omitted when absent.

The Claude window identities, percentages and durations follow the bundled
0.60.3 bench observations recorded in PR #956 (comment 6359207116).
The timestamps are fixed test inputs, not captured account data.
