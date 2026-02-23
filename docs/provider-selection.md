# Provider Selection (Milestone 1)

vibeblock keeps firmware/device dumb. All intelligence stays in the macOS companion:
- usage data comes from `codexbar usage --json`
- activity hints come from local provider logs
- firmware only renders the selected frame

## Deterministic Selection Order

For every poll cycle, the companion chooses one provider with this exact order:

1. `local activity`
2. `usage delta`
3. `sticky current`
4. `CodexBar order` (first provider returned by CodexBar)

If no provider is available, the companion sends an error frame.

## Local Activity Rules

- Local activity is read through provider detectors (`provider -> activity detector`).
- Current built-in detectors:
  - high confidence: `codex`, `claude`, `vertexai`, `jetbrains`
  - medium confidence: `cursor`, `factory`, `augment`, `gemini`
  - low confidence: `kimi`, `ollama` (Chromium cookie signals)
- Higher-confidence signals win over newer lower-confidence signals.
- Activity older than `6h` is ignored (`VIBEBLOCK_ACTIVITY_MAX_AGE`).
- Low-confidence signals are additionally capped at `20m`.

## Conflict Rules (Near-Simultaneous Activity)

If multiple providers have local activity timestamps within `15s` of the newest one (`VIBEBLOCK_ACTIVITY_CONFLICT_WINDOW`):

1. Keep current provider if it is in the conflict set.
2. Else choose the provider with stronger usage delta score.
3. Else choose deterministic CodexBar order.

This avoids flapping when Codex and Claude are used back-to-back.

## Usage Delta Rules

Usage delta score is computed from previous cycle:
- `sessionDelta` (`Session` increased)
- `weeklyDelta` (`Weekly` increased)
- `resetGain` (`ResetSec` jump up by >120s, or `0 -> >0`)

Priority: `sessionDelta` > `weeklyDelta` > `resetGain`.

## Sticky Rules

If local activity and usage delta provide no signal, keep the currently shown provider as long as it still exists in the CodexBar provider list.

If it disappeared, fall back to CodexBar order.

## Observability

Each sent frame is logged with:
- `reason`: one of `local-activity`, `usage-delta`, `sticky-current`, `codexbar-order`, `stale-last-good`, `error-frame`
- `detail`: tie-break context (candidate set, score, or fallback reason)
