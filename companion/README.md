# vibeblock Companion

Go daemon that:
- fetches real provider usage from CodexBar (`usage --json`)
- selects the most recently active provider from local Codex/Claude activity logs (with usage-delta fallback)
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
`doctor` validates CodexBar binary, lists serial ports, and shows a live provider preview.

## Runtime behavior

- Poll interval defaults to `60s`.
- When CodexBar fails temporarily, the daemon reuses the last good frame for up to `10m` (configurable).
- Provider selection prefers local activity timestamps:
  - Codex: latest `~/.codex/sessions/**/*.jsonl` (fallback `~/.codex/history.jsonl`)
  - Claude: latest `~/.claude/history.jsonl` / `~/.claude/projects/**/*.jsonl`
- If local activity is unavailable, fallback uses usage deltas (`session`/`weekly` increase or reset jump).
- For Codex specifically, if `source=openai-web` reports `0/0` with no reset, the daemon repairs Codex data via `--provider codex --source cli`.

Environment variables:

- `CODEXBAR_BIN`: force CodexBar executable path
- `VIBEBLOCK_CODEXBAR_TIMEOUT_SECS`: timeout per CodexBar command (default `90`)
- `VIBEBLOCK_LAST_GOOD_MAX_AGE`: max age for stale fallback frame (Go duration format, default `10m`)
- `VIBEBLOCK_CODEX_ACTIVITY_DIR`: override Codex activity directory (default `~/.codex/sessions`)
- `VIBEBLOCK_CODEX_ACTIVITY_FILE`: override Codex fallback activity file (default `~/.codex/history.jsonl`)
- `VIBEBLOCK_CLAUDE_ACTIVITY_DIR`: override Claude activity directory (default `~/.claude/projects`)
- `VIBEBLOCK_CLAUDE_ACTIVITY_FILE`: override Claude activity file (default `~/.claude/history.jsonl`)

## CodexBar Binary Discovery

Priority order:
1. `CODEXBAR_BIN` env var
2. `codexbar` in `PATH`
3. Desktop bundle helpers:
   - `/Applications/CodexBar.app/Contents/Helpers/CodexBarCLI`
   - `~/Applications/CodexBar.app/Contents/Helpers/CodexBarCLI`
   - `~/Downloads/CodexBar.app/Contents/Helpers/CodexBarCLI`
