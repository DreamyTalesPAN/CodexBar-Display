# Operator Runbook

Single source of truth for install, runtime checks, recovery, and smoke testing.

Hardware identity and board/env contract reference:
- `docs/hardware-contract.md`
- `docs/usage-polling-architecture.md` (usage command latency, polling architecture, tuning/bench workflow)

## Scope
- macOS runtime (`launchctl` + LaunchAgent)
- USB serial devices (`/dev/cu.usb*`)
- Companion binary (`codexbar-display`)
- Primary release-gated target for the v0 pre-release track: `esp8266_smalltv_st7789` (SemVer `1.x`)
- ESP32-S3 firmware path as experimental fallback/non-blocking for v0

Note: source entrypoint remains `./cmd/codexbar-display` in this repo. For branded demos, build once with
`go build -o ../codexbar-display ./cmd/codexbar-display` and run `../codexbar-display ...` equivalently.

## Core Commands

```bash
cd companion
../codexbar-display setup --yes
../codexbar-display health
../codexbar-display service status
../codexbar-display service stop
../codexbar-display service start
../codexbar-display doctor
../codexbar-display version
../codexbar-display upgrade --firmware-env esp8266_smalltv_st7789
../codexbar-display rollback --port /dev/cu.usbserial-10
```

## Service Control

Use the explicit service commands instead of killing processes in Activity Monitor:

```bash
cd companion
../codexbar-display service status
../codexbar-display service stop
../codexbar-display service start
```

Behavior:
- `service stop` unloads the LaunchAgent and disables it, so macOS will not respawn `codexbar-display` until you run `service start` or `setup` again.
- `service start` re-enables the LaunchAgent and starts it from the installed plist.
- `service status` reports whether the LaunchAgent is enabled and whether it is currently loaded/running.

## Setup

`setup` is idempotent. The default LaunchAgent runtime uses WiFi discovery, then stores the selected IP and stable `deviceId`.
USB setup is an explicit development/support path.

### Default WiFi runtime

```bash
cd companion
../codexbar-display setup --yes
```

This installs the companion runtime, persists the Mini theme on fresh installs, and writes a WiFi LaunchAgent.
It does not require USB serial.

### WiFi firmware update path

Use this for normal devices. It downloads the latest published firmware manifest and installs the matching release asset over WiFi:

```bash
codexbar-display install-update \
  --target http://<device-ip> \
  --confirm-live-update
```

### USB recovery flash path

Use only when a device is physically attached with a working data-capable USB serial connection and WiFi OTA is not available. This path flashes release firmware, not a local source build:

```bash
cd companion
../codexbar-display setup --yes \
  --transport usb \
  --port /dev/cu.usbserial-10 \
  --firmware-env esp8266_smalltv_st7789
```

### ESP32-S3 target (override)

Experimental fallback path (non-blocking):

```bash
cd companion
../codexbar-display setup --yes \
  --transport usb \
  --port /dev/cu.usbmodem101 \
  --firmware-env lilygo_t_display_s3
```

Useful flags:
- `--skip-flash`: install/update runtime only
- `--pin-port`: pin LaunchAgent to one explicit serial path (recommended when multiple USB serial devices are present)
- `--firmware-env <env>`: select PlatformIO environment
- `--theme <classic|crt|mini|none>`: persist runtime theme override in companion config
- `--validate-only`: run setup prerequisite checks only
- `--dry-run`: print setup actions without applying changes

## Firmware Environment Selection (ESP8266-first)

Use these rules when selecting `--firmware-env`:

- KISS default runtime firmware: `esp8266_smalltv_st7789` (release-gated)
- Themes are runtime-configured (`classic`, `crt`, `mini`) via `--theme`/`CODEXBAR_DISPLAY_THEME` on the same firmware.
- Legacy compile-theme/GIF/probe env names are unsupported; use only the runtime envs above.
- `lilygo_t_display_s3` is an experimental fallback and does not block v0 release decisions.
- MVP release go/no-go is gated only by `esp8266_smalltv_st7789`.
- Do not use `pio run -t upload` for published firmware. Direct source uploads require `CODEXBAR_DISPLAY_ALLOW_SOURCE_UPLOAD=1` and are only for intentional development tests.

During setup, runtime assets are installed to:
- Binary: `~/Library/Application Support/codexbar-display/bin/codexbar-display`
- Recovery scripts: `~/Library/Application Support/codexbar-display/scripts/`
- Backups: `~/Library/Application Support/codexbar-display/backups/`
- LaunchAgent: `~/Library/LaunchAgents/com.codexbar-display.daemon.plist`

## Upgrade (No Re-Setup)

Use `upgrade` for N -> N+1 updates with preflight:

```bash
cd companion
../codexbar-display upgrade --firmware-env esp8266_smalltv_st7789
```

Preflight includes:
- serial port busy check (`lsof`)
- companion/firmware version guard (`upgrade/version-guard`)
- target firmware env/version resolution

Optional guard override:

```bash
# experimental fallback path
../codexbar-display upgrade \
  --firmware-env lilygo_t_display_s3 \
  --target-firmware-version <x.y.z>
```

If you need to bypass guard (not recommended):

```bash
../codexbar-display upgrade --skip-version-guard
```

## Rollback (Last-Known-Good)

`upgrade` snapshots companion state for rollback and tracks known-good firmware paths.

Default rollback:

```bash
cd companion
../codexbar-display rollback --port /dev/cu.usbserial-10
```

Wrapper scripts:

```bash
cd /path/to/CodexBar-Display
./scripts/upgrade-with-preflight.sh --firmware-env esp8266_smalltv_st7789
./scripts/rollback-last-known-good.sh --port /dev/cu.usbserial-10
```

Wrapper behavior:
- `upgrade-with-preflight.sh` delegates to `codexbar-display upgrade` and therefore runs the same preflight checks (port busy + version guard).
- `rollback-last-known-good.sh` delegates to `codexbar-display rollback` with identical rollback/restore semantics.

## Firmware Provisioning

Use the OTA package and WiFi upload wrapper for repeatable device provisioning instead of manual `curl` commands:

```bash
./scripts/vibetv-provision.sh build \
  --package-dir dist/vibetv-ota/release-2026-05-03

./scripts/vibetv-provision.sh flash \
  --target 192.168.178.123 \
  --package-dir dist/vibetv-ota/release-2026-05-03 \
  --expect-board esp8266-smalltv-st7789 \
  --yes
```

Per device:
- connect the device to the provisioning WiFi
- replace only `--target` with that device IP
- keep the same `--package-dir` for the provisioning run
- confirm `/health`, `/hello`, `/assets`, LittleFS upload, and the `mini` smoke frame pass

During normal operation the display uses explicit support states:
- `Starting`: boot is running before WiFi mode is known.
- `SETUP WIFI` with `VibeTV-Setup` and the setup IP: setup AP is active; customer should join the setup WiFi and open the shown address.
- `Connecting WiFi`: station mode is connecting to the saved or imported SSID.
- `WiFi connected!` with `Now go to:` and `app.vibetv.shop`: WiFi is connected and the device gives the customer the hosted Control Center URL.
- Live usage: a valid USB or WiFi frame is rendering; provider/usage data is shown, not theme asset names.
- `Open App` / `app.vibetv.shop`: the device previously had data, but no fresh frame arrived for more than two minutes, or the Mac App reported a recoverable runtime problem.
- `Install Mac App` / `app.vibetv.shop`: the device received a runtime frame saying the Mac App binary is missing.
- `Update Mac App` / `app.vibetv.shop`: the Mac App reported an incompatible usage app version or payload format.
- `Update available` / `app.vibetv.shop`: a firmware update is available. ThemeSpec themes receive the same alternating text through their provider-label binding.
- `Update running`: firmware, filesystem, or display asset upload is in progress. The display intentionally does not show internal paths such as GIF or theme asset filenames.
- `WiFi reset`: saved WiFi credentials are being cleared before setup mode restarts.

Before packaging a device for a customer, clear local provisioning WiFi credentials with `POST /reset-wifi` while the device is still reachable. After reboot, the display must show both setup steps on one screen: connect to `VibeTV-Setup`, then open `192.168.4.1` in a browser.

The setup screen includes a fixed offline WiFi QR code for the open
`VibeTV-Setup` access point. The QR code does not contain a public URL and does
not replace the manual `VibeTV-Setup` plus `192.168.4.1` fallback shown on the
same screen.

Smoke checklist for #53:
- Boot device and confirm the first screen says `Starting`.
- Clear WiFi and confirm the setup AP screen shows the WiFi QR code,
  `VibeTV-Setup`, and the setup IP.
- Save WiFi and confirm the connecting screen shows `Connecting WiFi` plus the SSID.
- After WiFi connects, confirm the waiting screen shows only `WiFi connected!`, `Now go to:`, and `app.vibetv.shop`.
- Send a USB frame and a WiFi `/frame` frame and confirm normal usage rendering still appears.
- Send a frame with `update.available=true` and confirm the customer-facing update text alternates between `Update available` and `app.vibetv.shop`.
- Apply one stored ThemeSpec with a provider-label primitive, send the same update frame again, and confirm the provider-label area alternates between `Update available` and `app.vibetv.shop`.
- Stop the Mac App service for more than two minutes after a frame and confirm `Open App` / `app.vibetv.shop`.
- Send a runtime error frame and confirm the display shows a customer-friendly action, not an internal error code.
- Start firmware/filesystem/asset upload and confirm the display says `Update running` without asset paths.

Full flow and endpoint overrides are documented in `docs/firmware-provisioning.md`.

Rollback modes:
- companion only: `../codexbar-display rollback --skip-firmware`
- firmware only: `../codexbar-display rollback --skip-companion --port /dev/cu.usbserial-10`
- explicit image: `../codexbar-display rollback --skip-companion --port /dev/cu.usbserial-10 --image /path/to/firmware.bin --manifest /path/to/firmware.bin.manifest`

Rollback state file:
- `~/Library/Application Support/codexbar-display/release-state.json`

## Theme Override (ESP8266 Display Targets)

Theme override is optional and currently applies to ESP8266 display firmware
that advertises `features:["theme"]`.

Runtime behavior:
- If capability handshake confirms `supportsTheme=true`, companion sends the selected theme.
- If capability handshake is temporarily unavailable (missing hello), companion uses optimistic send on the MVP path.
- If capabilities are known and explicitly do not support theme, companion omits `theme`.
- Companion negotiates protocol `v2` first and falls back to `v1` when device support is legacy/missing.

For an ad-hoc WiFi run:

```bash
cd companion
CODEXBAR_DISPLAY_THEME=mini ../codexbar-display daemon --transport wifi --interval 30s
```

Preferred persistent config:

```bash
cd companion
../codexbar-display setup --yes --skip-flash --theme mini
```

For LaunchAgent runtime:
- add `CODEXBAR_DISPLAY_THEME` under `EnvironmentVariables` in `~/Library/LaunchAgents/com.codexbar-display.daemon.plist`
- reload agent with `launchctl bootout/bootstrap/kickstart`
- verify with `../codexbar-display health` and daemon logs

Note: rerunning `codexbar-display setup` rewrites the LaunchAgent plist; re-apply custom env vars afterward.

### ThemeSpec v1 (local USB flow)

```bash
cd companion
../codexbar-display theme-validate --spec ../protocol/fixtures/v2/theme_spec_mini_transport.json
../codexbar-display theme-apply --spec ../protocol/fixtures/v2/theme_spec_mini_transport.json
```

If hello negotiation is temporarily unavailable, you can opt into local USB fallback limits:

```bash
../codexbar-display theme-validate --allow-unknown-capabilities --spec ../protocol/fixtures/v2/theme_spec_mini_transport.json
../codexbar-display theme-apply --allow-unknown-capabilities --spec ../protocol/fixtures/v2/theme_spec_mini_transport.json
```

Validation checks:
- ThemeSpec schema/field rules (`protocol/theme_spec_v1.schema.json`)
- capability compatibility (`maxThemeSpecBytes`, `maxThemePrimitives`, `builtinThemes`)

## Runtime Health

```bash
cd companion
../codexbar-display health
```

`health` reports in one output:
- LaunchAgent state + PID
- auto-detected serial port
- last successful `sent frame` timestamp + port
- last runtime error (if any)

`doctor` runtime checks additionally validate:
- board/protocol/theme capability contract from device hello
- LaunchAgent port affinity safety (fails when multiple serial ports are present and daemon is unpinned)

Runtime error logs use:
- stable `code=<category/item>` (`transport/*`, `protocol/*`, `runtime/*`, `setup/*`)
- concrete `recovery="..."` actions inline

Examples:
- `cycle error: code=runtime/serial-write ... recovery="Check cable/device power; daemon will retry automatically."`
- `setup failed at flash-firmware [setup/flash-firmware] ...`

Daemon logs:
- `/tmp/codexbar-display-daemon.out.log`
- `/tmp/codexbar-display-daemon.err.log`

## Backup and Restore (ESP8266)

### Create backup + manifest

```bash
./scripts/esp8266-backup.sh /dev/cu.usbserial-10
```

Backup now writes:
- image file (`.bin`)
- manifest (`.manifest`) with file name, `sha256`, size, device MAC, UTC timestamp

Default backup location:
- `~/Library/Application Support/codexbar-display/backups/`

### Restore known-good image (verified by default)

```bash
cd companion
../codexbar-display restore-known-good --port /dev/cu.usbserial-10
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
1. plist path (default: `~/Library/LaunchAgents/com.codexbar-display.daemon.plist`)
2. out log path (default: `/tmp/codexbar-display-daemon.out.log`)
3. timeout seconds (default: `90`)

## Soak Gate (ESP8266)

Focused daemon resilience gate for v0:
- theme contract on supported device capabilities (`classic`, `crt`, `mini`)
- reconnect recovery backoff behavior
- sleep/wake retry-reset behavior
- 24h-equivalent daemon soak simulation

```bash
./scripts/check-esp8266-soak-gate.sh
```

## Release Readiness (Go/No-Go)

Run this list before every v0 release decision.

### Build + Artifacts
- [ ] `go test ./...` in `companion` is green.
- [ ] `pio run -d firmware_esp8266 -e esp8266_smalltv_st7789` is green.
- [ ] Clean-Mac validation was confirmed by running the Mac setup prompt from `app.vibetv.shop` and checking `http://127.0.0.1:47832/v1/status`.
- [ ] Release artifacts include the Mac setup script, both Darwin companion binaries, firmware binaries, manifests, and checksums.
- [ ] GitHub Release includes the customer Mac setup assets for the release tag:
  `install-control-center-companion.sh`,
  `codexbar-display-darwin-arm64-v<version>`,
  `codexbar-display-darwin-amd64-v<version>`,
  and `checksums-v<version>.txt`.
- [ ] DMG-first releases include `VibeTV Control Center.app` inside
  `VibeTV-Control-Center-v<version>.dmg` with an Applications symlink, and the
  DMG checksum appears in `checksums-v<version>.txt`.
- [ ] Hosted setup shows only the verified DMG Mac App action after rollout;
  Agentic/Terminal installers remain visible only while the DMG gate is off or
  its release asset is unavailable.
- [ ] Existing Terminal-setup users were validated by launching the DMG app on a
  Mac with old `com.codexbar-display.*` user LaunchAgents; old plists should be
  moved to `~/Library/Application Support/codexbar-display/migration-backups/`
  and the existing config should remain in place.
- [ ] GitHub Release does not include Mac App `.pkg` assets.
- [ ] Firmware artifact reports expected `CODEXBAR_DISPLAY_FW_VERSION` for the release tag.

### Functional Gate (release-gated env)
- [ ] Device hello reports expected board id for `esp8266_smalltv_st7789`.
- [ ] Theme contract is capability-aware (`known && !supportsTheme` blocks theme; unknown hello uses MVP optimistic send).
- [ ] Runtime theme switching `classic`/`crt`/`mini` works without reflashing.
- [ ] Asset-backed themes render correctly when assets are present and fall back cleanly when assets are missing/corrupt.
- [ ] `classic`/`crt` remain stable without GIF playback.

### Stability + Recovery
- [ ] `./scripts/check-esp8266-soak-gate.sh` passes.
- [ ] No reboot loop / black-screen loop when GIF files are missing or invalid.
- [ ] `setup`, `upgrade`, `rollback`, `restore-known-good` pass on operator path.

### Decision
- [ ] GO: all checklist items done, no open P0/P1 blockers.
- [ ] NO-GO: at least one blocker open (record blocker, owner, next check time).

## RC -> Soak -> Final Flow

1. Cut RC tag (for example `v1.0.0-rc.1`) and publish artifacts.
2. Run checklist above + soak gate + setup/upgrade/rollback validation.
3. Soak in realistic operator mode; monitor daemon logs and fix regressions via new RC tags.
4. Promote to final tag (for example `v1.0.0`) only after soak passes with no blockers.
5. Keep prior known-good artifact set available for rollback/hotfix RC.

## Quick Troubleshooting

### Serial busy

```bash
launchctl bootout gui/$(id -u)/com.codexbar-display.daemon 2>/dev/null || true
lsof /dev/cu.usbserial-10
```

### LaunchAgent not running

```bash
launchctl print gui/$(id -u)/com.codexbar-display.daemon
tail -n 100 /tmp/codexbar-display-daemon.err.log
```

### No new frames

```bash
../codexbar-display health
./scripts/smoke-daemon-sent-frame.sh
```

### `runtime/codexbar-command`

```bash
codexbar usage --json --provider codex --source cli
codexbar usage --json --web-timeout 8
```

## Error Code Recovery Map

Use this taxonomy for incident triage:

| Category | Typical Codes | First Recovery Action |
|---|---|---|
| `transport/*` | `transport/serial-open`, `transport/no-usb-serial-ports`, `transport/serial-write` | Reconnect board/cable, check `ls /dev/cu.usb*`, release busy port via `lsof <port>` |
| `protocol/*` | `protocol/device-hello-unavailable` | Reconnect device to force boot hello; runtime falls back when hello is missing |
| `runtime/*` | `runtime/serial-resolve`, `runtime/cycle-timeout`, `runtime/codexbar-parse`, `runtime/frame-too-large` | Run `codexbar-display doctor`, verify CodexBar output, inspect daemon logs |
| `setup/*` | `setup/flash-firmware`, `setup/unsupported-hardware`, `setup/launchagent-verify` | Rerun setup with matching `--firmware-env`, verify PlatformIO + launchctl state |
| `upgrade/*` | `upgrade/port-busy`, `upgrade/version-guard`, `upgrade/flash-firmware` | Free serial port, use compatible versions, rerun `codexbar-display upgrade` |
| `rollback/*` | `rollback/missing-known-good`, `rollback/companion-restore`, `rollback/firmware-restore` | Provide explicit rollback image/manifest or restore captured known-good state |

## Performance Budgets

Usage polling architecture, timeout knobs, and benchmark workflow are documented in:
- [`docs/usage-polling-architecture.md`](usage-polling-architecture.md)

Companion benchmark gate:

```bash
cd companion
go test ./internal/daemon -run '^$' -bench 'BenchmarkRunCycleWithDeps|BenchmarkMarshalFrameWithinLimit' -benchmem -count=1
./scripts/check-companion-bench-budget.sh
```

Firmware bench envs:
- ESP8266: `esp8266_smalltv_st7789_bench`
- ESP32 fallback: `lilygo_t_display_s3_bench`

## Versioning and Release Notes

- Companion and firmware releases use SemVer `1.x`.
- Release go/no-go for MVP is gated by `esp8266_smalltv_st7789`.
- `codexbar-display upgrade` enforces companion/firmware compatibility with a version guard.
- Release firmware builds stamp `CODEXBAR_DISPLAY_FW_VERSION` from the release tag version.
- GitHub release artifacts include companion binaries, firmware binaries, checksums, manifests, and `install-control-center-companion.sh`.
- The customer Mac App target is a signed/notarized DMG containing `VibeTV Control Center.app`. Keep its hosted download feature flag disabled until the latest release contains the verified DMG asset; the setup prompt remains the support fallback.
- Current customer releases must not publish Mac App `.pkg` assets.
- A customer release is not ready until the Mac setup script, both Darwin companion binaries, and the checksum file exist on the GitHub Release and match the tag version.
