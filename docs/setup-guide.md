# Setup Guide

`vibeblock setup` is now the primary install path for a fresh macOS machine.

It performs all required steps in one command:
1. Ensure CodexBar CLI is available (auto-install via Homebrew when missing)
2. Detect/select serial port
3. Flash firmware
4. Install companion binary into `~/Library/Application Support/vibeblock/bin/vibeblock`
5. Install and start LaunchAgent (`com.vibeblock.daemon`)

## One-command setup

```bash
cd companion
go run ./cmd/vibeblock setup
```

If multiple serial devices are connected, setup asks which port to use.

## Useful flags

```bash
# Non-interactive mode (auto-select recommended serial port)
go run ./cmd/vibeblock setup --yes

# Force a specific serial path
go run ./cmd/vibeblock setup --port /dev/cu.usbmodem101

# Skip firmware flash (service/binary install only)
go run ./cmd/vibeblock setup --skip-flash
```

## What gets installed

- Binary: `~/Library/Application Support/vibeblock/bin/vibeblock`
- LaunchAgent: `~/Library/LaunchAgents/com.vibeblock.daemon.plist`
- Logs:
  - `/tmp/vibeblock-daemon.out.log`
  - `/tmp/vibeblock-daemon.err.log`

Setup is idempotent: re-running updates binary/plist and restarts the agent safely.

## Verify runtime

```bash
cd companion
go run ./cmd/vibeblock doctor
launchctl print gui/$(id -u)/com.vibeblock.daemon | rg "state =|pid ="
tail -f /tmp/vibeblock-daemon.out.log
```

