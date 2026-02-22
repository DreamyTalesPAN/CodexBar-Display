# vibeblock Companion

Go daemon that:
- fetches real provider usage from CodexBar (`usage --json`)
- selects provider index `0`
- sends protocol JSON lines to the USB display

## Commands

```bash
cd companion

go run ./cmd/vibeblock doctor
go run ./cmd/vibeblock daemon --port /dev/cu.usbmodem101 --once
go run ./cmd/vibeblock daemon --port /dev/cu.usbmodem101 --interval 60s
```

## CodexBar Binary Discovery

Priority order:
1. `CODEXBAR_BIN` env var
2. `codexbar` in `PATH`
3. Desktop bundle helpers:
   - `/Applications/CodexBar.app/Contents/Helpers/CodexBarCLI`
   - `~/Applications/CodexBar.app/Contents/Helpers/CodexBarCLI`
   - `~/Downloads/CodexBar.app/Contents/Helpers/CodexBarCLI`
