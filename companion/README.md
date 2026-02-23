# vibeblock Companion

Go daemon that:
- fetches real provider usage from CodexBar (`usage --json`)
- applies deterministic provider selection (`local activity -> usage delta -> sticky current -> CodexBar order`)
- sends protocol JSON lines to the USB display

## Commands

```bash
cd companion

go run ./cmd/vibeblock doctor
go run ./cmd/vibeblock daemon --port /dev/cu.usbmodem101 --once
go run ./cmd/vibeblock daemon --port /dev/cu.usbmodem101 --interval 60s
go run ./cmd/vibeblock setup
```

`setup` currently validates prerequisites and prints guided next steps.
`doctor` validates CodexBar binary, lists serial ports, runs runtime serial checks, and shows a live provider preview.

## Runtime behavior

- Poll interval defaults to `60s`.
- Runtime retry backoff on errors is `1s -> 2s -> 4s -> ... -> 30s` (capped by poll interval).
- When CodexBar fails temporarily, the daemon reuses the last good frame for up to `10m` (configurable).
- Sleep/Wake gaps are auto-detected; retry state is reset for faster recovery after wake.
- If a configured serial port disappears (for example `/dev/cu.usbmodem101` -> `/dev/cu.usbmodem1101` after reconnect), the daemon auto-falls back to port autodetection and continues.
- Local activity uses provider detectors:
  - `codex` detector: latest `~/.codex/sessions/**/*.jsonl` plus `~/.codex/history.jsonl`
  - `claude` detector: latest `~/.claude/history.jsonl` plus `~/.claude/projects/**/*.jsonl` and `~/.config/claude/projects/**/*.jsonl`
  - `vertexai` detector: Vertex-marked entries inside Claude project logs
  - `jetbrains` detector: latest `AIAssistantQuotaManager2.xml` from JetBrains IDE config dirs
  - `cursor` detector: `~/Library/Application Support/CodexBar/cursor-session.json`
  - `factory` detector: `~/Library/Application Support/CodexBar/factory-session.json`
  - `augment` detector: `~/Library/Application Support/CodexBar/augment-session.json`
  - `gemini` detector: `~/.gemini/oauth_creds.json` + `~/.gemini/settings.json`
  - `kimi` detector: Chromium cookie DB entries for `kimi-auth` on `kimi.com` (low confidence)
  - `ollama` detector: Chromium cookie DB entries for Ollama session cookies on `ollama.com` (low confidence)
- Providers without robust local artifacts (for example `openrouter`, `warp`, `copilot`, `zai`, `kimik2`, `opencode`) still work via usage-delta/sticky fallback.
- Optional custom detectors for any provider:
  - `VIBEBLOCK_ACTIVITY_FILE_<PROVIDER>=/path/to/file`
  - `VIBEBLOCK_ACTIVITY_DIR_<PROVIDER>=/path/to/dir`
  - Example: `VIBEBLOCK_ACTIVITY_FILE_KIMI=~/my-kimi-activity.log`
- Selection order is always:
  1. most recent local activity
  2. usage delta (`session`/`weekly` increase or reset jump)
  3. sticky current provider
  4. first provider in CodexBar result order
- Conflict rule for near-simultaneous local activity (default window `15s`):
  1. keep current provider if it is in the conflict set
  2. otherwise choose the conflict candidate with strongest usage delta
  3. otherwise choose CodexBar order
- Local activity older than `6h` is ignored by default.
- Low-confidence local activity (for example browser-cookie signals) is capped at `20m` max age.
- For Codex specifically, if `source=openai-web` reports `0/0` with no reset, the daemon repairs Codex data via `--provider codex --source cli`.
- Unified runtime error frames use stable codes like `runtime/codexbar-parse` and `runtime/serial-write`.
- Daemon logs include `reason=<selection strategy>` and `detail=<tie-break context>` for each sent frame.

Environment variables:

- `CODEXBAR_BIN`: force CodexBar executable path
- `VIBEBLOCK_CODEXBAR_TIMEOUT_SECS`: timeout per CodexBar command (default `90`)
- `VIBEBLOCK_LAST_GOOD_MAX_AGE`: max age for stale fallback frame (Go duration format, default `10m`)
- `VIBEBLOCK_ACTIVITY_MAX_AGE`: max age for local activity signals before they are ignored (default `6h`)
- `VIBEBLOCK_ACTIVITY_CONFLICT_WINDOW`: window for near-simultaneous activity conflict handling (default `15s`)
- `VIBEBLOCK_CODEX_ACTIVITY_DIR`: override Codex activity directory (default `~/.codex/sessions`)
- `VIBEBLOCK_CODEX_ACTIVITY_FILE`: override Codex fallback activity file (default `~/.codex/history.jsonl`)
- `VIBEBLOCK_CLAUDE_ACTIVITY_DIR`: override primary Claude activity directory
- `VIBEBLOCK_CLAUDE_ACTIVITY_DIRS`: override Claude activity directories (comma-separated)
- `VIBEBLOCK_CLAUDE_ACTIVITY_FILE`: override Claude activity file (default `~/.claude/history.jsonl`)
- `VIBEBLOCK_VERTEX_ACTIVITY_DIR`: override primary Vertex activity directory
- `VIBEBLOCK_VERTEX_ACTIVITY_DIRS`: override Vertex activity directories (comma-separated)
- `VIBEBLOCK_JETBRAINS_ACTIVITY_DIRS`: override JetBrains config roots (comma-separated)
- `VIBEBLOCK_CURSOR_ACTIVITY_FILE`: override Cursor session activity file
- `VIBEBLOCK_FACTORY_ACTIVITY_FILE`: override Factory session activity file
- `VIBEBLOCK_AUGMENT_ACTIVITY_FILE`: override Augment session activity file
- `VIBEBLOCK_GEMINI_OAUTH_FILE`: override Gemini OAuth credentials file
- `VIBEBLOCK_GEMINI_SETTINGS_FILE`: override Gemini settings file
- `VIBEBLOCK_SQLITE3_BIN`: override sqlite3 binary used for Chromium cookie activity checks (default `sqlite3`)
- `VIBEBLOCK_CHROMIUM_COOKIE_DB_PATHS`: explicit comma-separated cookie DB file paths for Kimi/Ollama cookie detectors
- `VIBEBLOCK_ACTIVITY_FILE_<PROVIDER>`: add custom file-based detector for provider key
- `VIBEBLOCK_ACTIVITY_DIR_<PROVIDER>`: add custom directory-based detector for provider key

## CodexBar Binary Discovery

Priority order:
1. `CODEXBAR_BIN` env var
2. `codexbar` in `PATH`
3. Desktop bundle helpers:
   - `/Applications/CodexBar.app/Contents/Helpers/CodexBarCLI`
   - `~/Applications/CodexBar.app/Contents/Helpers/CodexBarCLI`
   - `~/Downloads/CodexBar.app/Contents/Helpers/CodexBarCLI`
