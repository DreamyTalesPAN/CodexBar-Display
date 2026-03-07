# Token Usage Support Matrix

This document describes how `codexbar-display` populates absolute token stats in addition to the existing percentage/quota bars.

## Data Source

Absolute token stats are sourced from:

- `codexbar cost --json`

This is a local-data path. It does not replace the existing percentage collector (`codexbar usage --json`); it complements it.

## Normalized Fields

`codexbar-display` maps token data to these optional frame fields:

- `sessionTokens`: top-level `sessionTokens`
- `weekTokens`: rolling 7-day sum from `daily[].totalTokens`
- `totalTokens`: `totals.totalTokens`

If a field cannot be derived reliably, it is omitted instead of guessed.

## Provider Matrix

| Provider / condition | Source | Session | Week | Total | Notes |
|---|---|---|---|---|---|
| `codex` | `codexbar cost --json` | yes | yes | yes | validated against local Codex logs |
| `claude` | `codexbar cost --json` | yes | yes | yes | validated against local Claude logs |
| Any provider present in `codexbar cost --json` with `sessionTokens`, `daily[]`, and `totals.totalTokens` | `codexbar cost --json` | yes | yes | yes | zero/missing fields are treated as unavailable |
| Provider present without `daily[]` | `codexbar cost --json` | maybe | no | maybe | companion will skip `weekTokens` |
| Provider present without `totals.totalTokens` | `codexbar cost --json` | maybe | maybe | no | companion keeps percentage/quota-only rendering when needed |

## Runtime Notes

- Token stats are cached separately from quota polling.
- The companion refreshes token stats at most once per minute.
- If a refresh fails, the companion may reuse cached token stats for up to 15 minutes.
- The mini theme is the initial compact UI target and renders absolute token stats as `S <session>  W <week>  T <total>`.
