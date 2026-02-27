# Operator Runbook

Single source of truth for install, runtime checks, recovery, and smoke testing.

## Scope
- macOS runtime (`launchctl` + LaunchAgent)
- USB serial devices (`/dev/cu.usb*`)
- Companion binary (`vibeblock`)
- ESP8266 firmware target for v1 production rollout
- ESP32-S3 firmware path as experimental/non-blocking for v1

## Core Commands

```bash
cd companion
go run ./cmd/vibeblock setup --yes
go run ./cmd/vibeblock health
go run ./cmd/vibeblock doctor
go run ./cmd/vibeblock version
go run ./cmd/vibeblock upgrade --firmware-env esp8266_smalltv_st7789
go run ./cmd/vibeblock rollback --port /dev/cu.usbserial-10
```

## Setup

`setup` is idempotent and now handles the common "port busy" case automatically by attempting
`launchctl bootout gui/$(id -u)/com.vibeblock.daemon` before serial probe and flash.

### Default firmware target (ESP8266 SmallTV)

```bash
cd companion
go run ./cmd/vibeblock setup --yes
```

### ESP32-S3 target (override)

Experimental path for v1 (non-blocking):

```bash
cd companion
go run ./cmd/vibeblock setup --yes \
  --port /dev/cu.usbmodem101 \
  --firmware-env lilygo_t_display_s3
```

Useful flags:
- `--skip-flash`: install/update runtime only
- `--pin-port`: pin LaunchAgent to one explicit serial path
- `--firmware-env <env>`: select PlatformIO environment
- `--theme <classic|crt|none>`: persist runtime theme override in companion config
- `--validate-only`: run setup prerequisite checks only
- `--dry-run`: print setup actions without applying changes

During setup, runtime assets are installed to:
- Binary: `~/Library/Application Support/vibeblock/bin/vibeblock`
- Recovery scripts: `~/Library/Application Support/vibeblock/scripts/`
- Backups: `~/Library/Application Support/vibeblock/backups/`
- LaunchAgent: `~/Library/LaunchAgents/com.vibeblock.daemon.plist`

## Upgrade (No Re-Setup)

Use `upgrade` for N -> N+1 updates with preflight:

```bash
cd companion
go run ./cmd/vibeblock upgrade --firmware-env esp8266_smalltv_st7789
```

Preflight includes:
- serial port busy check (`lsof`)
- companion/firmware version guard (`upgrade/version-guard`)
- target firmware env/version resolution

Optional guard override:

```bash
# experimental v1 path
go run ./cmd/vibeblock upgrade \
  --firmware-env lilygo_t_display_s3 \
  --target-firmware-version 1.0.0
```

If you need to bypass guard (not recommended):

```bash
go run ./cmd/vibeblock upgrade --skip-version-guard
```

## Rollback (Last-Known-Good)

`upgrade` snapshots companion state for rollback and tracks known-good firmware paths.

Default rollback:

```bash
cd companion
go run ./cmd/vibeblock rollback --port /dev/cu.usbserial-10
```

Wrapper scripts:

```bash
cd /path/to/CodexBar-Display
./scripts/upgrade-with-preflight.sh --firmware-env esp8266_smalltv_st7789
./scripts/rollback-last-known-good.sh --port /dev/cu.usbserial-10
```

Rollback modes:
- companion only: `go run ./cmd/vibeblock rollback --skip-firmware`
- firmware only: `go run ./cmd/vibeblock rollback --skip-companion --port /dev/cu.usbserial-10`
- explicit image: `go run ./cmd/vibeblock rollback --skip-companion --port /dev/cu.usbserial-10 --image /path/to/firmware.bin --manifest /path/to/firmware.bin.manifest`

Rollback state file:
- `~/Library/Application Support/vibeblock/release-state.json`

## Theme Override (ESP8266 Display Targets)

Theme override is optional and currently applies to ESP8266 display firmware
that advertises `features:["theme"]`.

For an ad-hoc run:

```bash
cd companion
VIBEBLOCK_THEME=crt go run ./cmd/vibeblock daemon --interval 60s
```

Preferred persistent config:

```bash
cd companion
go run ./cmd/vibeblock setup --yes --skip-flash --theme crt
```

For LaunchAgent runtime:
- add `VIBEBLOCK_THEME` under `EnvironmentVariables` in `~/Library/LaunchAgents/com.vibeblock.daemon.plist`
- reload agent with `launchctl bootout/bootstrap/kickstart`
- verify with `go run ./cmd/vibeblock health` and daemon logs

Note: rerunning `vibeblock setup` rewrites the LaunchAgent plist; re-apply custom env vars afterward.

## Runtime Health

```bash
cd companion
go run ./cmd/vibeblock health
```

`health` reports in one output:
- LaunchAgent state + PID
- auto-detected serial port
- last successful `sent frame` timestamp + port
- last runtime error (if any)

Runtime error logs use:
- stable `code=<category/item>` (`transport/*`, `protocol/*`, `runtime/*`, `setup/*`)
- concrete `recovery="..."` actions inline

Examples:
- `cycle error: code=runtime/serial-write ... recovery="Check cable/device power; daemon will retry automatically."`
- `setup failed at flash-firmware [setup/flash-firmware] ...`

Daemon logs:
- `/tmp/vibeblock-daemon.out.log`
- `/tmp/vibeblock-daemon.err.log`

## Backup and Restore (ESP8266)

### Create backup + manifest

```bash
./scripts/esp8266-backup.sh /dev/cu.usbserial-10
```

Backup now writes:
- image file (`.bin`)
- manifest (`.manifest`) with file name, `sha256`, size, device MAC, UTC timestamp

Default backup location:
- `~/Library/Application Support/vibeblock/backups/`

### Restore known-good image (verified by default)

```bash
cd companion
go run ./cmd/vibeblock restore-known-good --port /dev/cu.usbserial-10
```

By default restore verifies:
- manifest exists
- image SHA256 matches manifest
- device MAC matches manifest (prevents wrong-backup/wrong-device restore)

### Restore flags
- `--image <path>`: explicit image
- `--manifest <path>`: explicit manifest
- `--backup-dir <dir>`: add search directory (repeatable)
- `--script-path <path>`: explicit `esp8266-restore.sh`
- `--skip-verify`: bypass manifest/device verification (legacy backups only)

## Smoke Test (E2E)

Minimal runtime smoke:
- restart LaunchAgent
- wait up to 90s
- require a new `sent frame ->` log line

```bash
./scripts/smoke-daemon-sent-frame.sh
```

Optional args:
1. plist path (default: `~/Library/LaunchAgents/com.vibeblock.daemon.plist`)
2. out log path (default: `/tmp/vibeblock-daemon.out.log`)
3. timeout seconds (default: `90`)

## Quick Troubleshooting

### Serial busy

```bash
launchctl bootout gui/$(id -u)/com.vibeblock.daemon 2>/dev/null || true
lsof /dev/cu.usbserial-10
```

### LaunchAgent not running

```bash
launchctl print gui/$(id -u)/com.vibeblock.daemon
tail -n 100 /tmp/vibeblock-daemon.err.log
```

### No new frames

```bash
go run ./cmd/vibeblock health
./scripts/smoke-daemon-sent-frame.sh
```

## Error Code Recovery Map

Use this taxonomy for incident triage:

| Category | Typical Codes | First Recovery Action |
|---|---|---|
| `transport/*` | `transport/serial-open`, `transport/no-usb-serial-ports`, `transport/serial-write` | Reconnect board/cable, check `ls /dev/cu.usb*`, release busy port via `lsof <port>` |
| `protocol/*` | `protocol/device-hello-unavailable` | Reconnect device to force boot hello; runtime falls back when hello is missing |
| `runtime/*` | `runtime/serial-resolve`, `runtime/codexbar-parse`, `runtime/frame-too-large` | Run `vibeblock doctor`, verify CodexBar output, inspect daemon logs |
| `setup/*` | `setup/flash-firmware`, `setup/unsupported-hardware`, `setup/launchagent-verify` | Rerun setup with matching `--firmware-env`, verify PlatformIO + launchctl state |
| `upgrade/*` | `upgrade/port-busy`, `upgrade/version-guard`, `upgrade/flash-firmware` | Free serial port, use compatible versions, rerun `vibeblock upgrade` |
| `rollback/*` | `rollback/missing-known-good`, `rollback/companion-restore`, `rollback/firmware-restore` | Provide explicit rollback image/manifest or restore captured known-good state |

## Performance Budgets

Companion benchmark limits, firmware probe-bench commands, and per-target budgets:
- `docs/performance-budgets.md`

Versioning/release references:
- `docs/versioning-compatibility.md`
- `docs/release-process.md`
- `docs/known-good-firmware.md`
