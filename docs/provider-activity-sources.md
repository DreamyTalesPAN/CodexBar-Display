# Provider Activity Sources (Milestone 1)

Goal: keep vibeblock tightly coupled to CodexBar data while adding lightweight local activity hints.

## Adapter Architecture

Companion uses an adapter interface:

- `ProviderActivityDetector.ProviderKey()`
- `ProviderActivityDetector.LatestActivityAt(home string)`

Mapping is explicit: `provider -> detector`.

## Supported Detectors

| Provider | Local Source(s) | Signal Quality | Notes |
|---|---|---|---|
| `codex` | `~/.codex/sessions/**/*.jsonl`, `~/.codex/history.jsonl` | high | Session files usually move on every interaction. |
| `claude` | `~/.claude/history.jsonl`, `~/.claude/projects/**/*.jsonl` | high | Project logs are strong activity indicators. |
| `vertexai` | Vertex-marked entries in Claude project logs | high | Detected from `_vrtx_` and Vertex-style model markers. |
| `jetbrains` | `AIAssistantQuotaManager2.xml` in JetBrains config dirs | high | File changes track JetBrains AI quota usage updates. |
| `cursor` | `~/Library/Application Support/CodexBar/cursor-session.json` | medium | Session-file updates are a weaker proxy than direct usage logs. |
| `factory` | `~/Library/Application Support/CodexBar/factory-session.json` | medium | Session/token refresh timestamps only. |
| `augment` | `~/Library/Application Support/CodexBar/augment-session.json` | medium | Session-file updates only. |
| `gemini` | `~/.gemini/oauth_creds.json`, `~/.gemini/settings.json` | medium | Auth/credential refresh is weaker than direct usage logs. |
| `kimi` | Chromium cookie DB entries for `kimi-auth` on `kimi.com` | low | Requires readable Chromium cookie DB + `sqlite3`; signal age is capped to reduce noise. |
| `ollama` | Chromium cookie DB entries for Ollama session cookies on `ollama.com` | low | Requires readable Chromium cookie DB + `sqlite3`; signal age is capped to reduce noise. |

## Providers Without Detector

Providers without robust local artifacts (for example `openrouter`, `warp`, `copilot`, `zai`, `kimik2`, `opencode`) run without built-in local detector.

Fallback path for those providers is automatic:

1. usage delta
2. sticky current
3. CodexBar order

This keeps behavior deterministic without adding provider-specific complexity into firmware/device.

Optional: custom detector paths can be defined per provider via environment:
- `VIBEBLOCK_ACTIVITY_FILE_<PROVIDER>`
- `VIBEBLOCK_ACTIVITY_DIR_<PROVIDER>`
- `VIBEBLOCK_CHROMIUM_COOKIE_DB_PATHS`
- `VIBEBLOCK_SQLITE3_BIN`

## Freshness and Conflict

- Stale local activity is filtered with `VIBEBLOCK_ACTIVITY_MAX_AGE` (default `6h`).
- Low-confidence detector signals are additionally capped at `20m`.
- Near-simultaneous local events are resolved with `VIBEBLOCK_ACTIVITY_CONFLICT_WINDOW` (default `15s`).

## Why This Matches the Product Principle

- CodexBar remains the source of truth for quotas and provider list.
- vibeblock companion only decides *which* provider frame to display.
- firmware/device remain render-only and protocol-only.
