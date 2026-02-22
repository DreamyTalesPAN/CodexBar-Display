# vibeblock Companion

Go daemon that:
- fetches real provider usage from CodexBar (`usage --json`)
- selects the provider with the most recent `updatedAt` timestamp
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

## Runtime behavior

- Poll interval defaults to `60s`.
- When CodexBar fails temporarily, the daemon reuses the last good frame for up to `10m` (configurable).
- For Codex specifically, if `source=openai-web` reports `0/0` with no reset, the daemon retries Codex with `--source cli` and uses that frame if better.

Environment variables:

- `CODEXBAR_BIN`: force CodexBar executable path
- `VIBEBLOCK_CODEXBAR_TIMEOUT_SECS`: timeout per CodexBar command (default `90`)
- `VIBEBLOCK_LAST_GOOD_MAX_AGE`: max age for stale fallback frame (Go duration format, default `10m`)

## CodexBar Binary Discovery

Priority order:
1. `CODEXBAR_BIN` env var
2. `codexbar` in `PATH`
3. Desktop bundle helpers:
   - `/Applications/CodexBar.app/Contents/Helpers/CodexBarCLI`
   - `~/Applications/CodexBar.app/Contents/Helpers/CodexBarCLI`
   - `~/Downloads/CodexBar.app/Contents/Helpers/CodexBarCLI`
