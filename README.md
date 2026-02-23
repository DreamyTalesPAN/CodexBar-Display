# vibeblock

Physical CodexBar status display for desk use.

This project reads local usage data from `codexbar usage --json` and renders one provider on a USB-connected LILYGO T-Display-S3.

## Project Docs
- Product requirements: `vibeblock-prd.md`
- Execution checklist: `TODO.md`
- Provider selection rules: `docs/provider-selection.md`
- Provider activity detectors: `docs/provider-activity-sources.md`
- Milestone 1 test matrix: `docs/m1-test-matrix.md`
- Milestone 2 runtime resilience: `docs/m2-runtime-resilience.md`

## MVP Scope
- macOS only
- One connected display
- Provider selection stays in companion (local activity -> usage delta -> sticky current -> CodexBar order)
- USB serial transport (no WiFi/BLE in V1)

## Start Here
1. Read `TODO.md`
2. Connect board and verify serial device path (`/dev/cu.usbmodem*`)
3. Build firmware bring-up target
4. Build companion daemon

## Current Status

- Firmware + daemon path is working on macOS with LILYGO T-Display-S3.
- `vibeblock setup` is currently a doctor-style helper (not full one-command setup yet).

## Quickstart (Current)

```bash
# flash firmware
cd firmware
pio run -e lilygo_t_display_s3 -t upload --upload-port /dev/cu.usbmodem101

# build companion
cd ../companion
go run ./cmd/vibeblock doctor
go build -o vibeblock ./cmd/vibeblock

# one-shot validation (sends one frame)
./vibeblock daemon --port /dev/cu.usbmodem101 --once
```

Companion supports both:
- `codexbar` CLI in `PATH`
- Desktop app helper (`CodexBarCLI`) inside `CodexBar.app`

## Run As LaunchAgent

```bash
cd companion
go build -o vibeblock ./cmd/vibeblock
mkdir -p "$HOME/Library/Application Support/vibeblock/bin"
cp "$PWD/vibeblock" "$HOME/Library/Application Support/vibeblock/bin/vibeblock"
mkdir -p "$HOME/Library/LaunchAgents"
cp "$PWD/install/com.vibeblock.daemon.plist" "$HOME/Library/LaunchAgents/com.vibeblock.daemon.plist"
launchctl bootstrap gui/$(id -u) "$HOME/Library/LaunchAgents/com.vibeblock.daemon.plist"
launchctl kickstart -k gui/$(id -u)/com.vibeblock.daemon
```

Logs:

```bash
tail -f /tmp/vibeblock-daemon.out.log
tail -f /tmp/vibeblock-daemon.err.log
# if you run a custom plist with Library logs:
tail -f "$HOME/Library/Logs/vibeblock-daemon.out.log"
tail -f "$HOME/Library/Logs/vibeblock-daemon.err.log"
```
