# vibeblock

vibeblock is a physical CodexBar status display for desk use.

It reads local usage data from `codexbar usage --json`, selects one active provider, and renders usage on a USB-connected display.

## Project Status

- Pre-release: there is no public vibeblock release yet.
- No market device fleet yet; current hardware baseline is the connected ESP8266 SmallTV development unit.
- v0 scope includes rich rendering (`usage` + GIF media on one screen) with built-in themes only, tracked in `protocol/PROTOCOL.md` and `TODO.md`.
- v0 production hardware target is ESP8266 SmallTV ST7789.
- ESP32 LilyGO T-Display-S3 remains in-repo as experimental/non-blocking for v0.

Core dependency:
- CodexBar: https://codexbar.app/

## UI Preview

![vibeblock display preview](docs/assets/vibeblock-display-preview.jpg)

## Key Capabilities

- v0 release-gated firmware target:
  - ESP8266 SmallTV ST7789 profile (default setup target)
- Experimental firmware target (non-blocking for v0):
  - ESP32 LilyGO T-Display-S3 profile
- Shared firmware core for frame parsing and runtime state across boards
- Device handshake and capability detection (`hello`, board ID, features)
- Companion-side feature gating (for example optional `theme` field)
- Theme system on ESP8266 SmallTV (`classic`, `crt`, `mini`)
- GIF player mode for full-color loop playback with timeline-preserving catch-up frame drops
- One-command setup for flash + install + launch agent management
- Runtime hardening for reconnect and sleep/wake workflows
- Upgrade and rollback flows with compatibility guard + known-good recovery state

## Architecture

1. `companion` daemon polls `codexbar usage --json`.
2. Provider selection logic chooses one provider deterministically.
3. Companion sends newline-delimited JSON frames over USB serial.
4. Firmware renders the frame on device UI and reports boot capabilities via handshake.

Protocol references:
- `protocol/PROTOCOL.md`

## Supported Firmware Environments

v0 release-gated:
- `esp8266_smalltv_st7789` (default)
- `esp8266_smalltv_st7789_crt`
- `esp8266_smalltv_st7789_mini`
- `esp8266_smalltv_st7789_alt`
- `esp8266_smalltv_st7789_alt_crt`
- `esp8266_smalltv_st7789_alt_mini`
- `esp8266_probe` (no-display probe profile)
- `esp8266_smalltv_st7789_gif_player` (GIF loop playback profile)
- `esp8266_smalltv_st7789_alt_gif_player` (GIF loop playback alt pin mapping)

Experimental (non-blocking for v0):
- `lilygo_t_display_s3`

## Theme Support

Supported themes:
- `classic`
- `crt`
- `mini`

Theme-capable firmware envs:
- `esp8266_smalltv_st7789`
- `esp8266_smalltv_st7789_crt`
- `esp8266_smalltv_st7789_mini`
- `esp8266_smalltv_st7789_alt`
- `esp8266_smalltv_st7789_alt_crt`
- `esp8266_smalltv_st7789_alt_mini`

Theme selection precedence:
1. `vibeblock daemon --theme <classic|crt|mini>`
2. `VIBEBLOCK_THEME`
3. runtime config (`~/Library/Application Support/vibeblock/config.json`)
4. firmware compile default

Persistent override:

```bash
cd companion
go run ./cmd/vibeblock setup --yes --skip-flash --theme crt
```

Theme development (high-level):
- shared registries: `firmware_shared/theme_registry.h`, `companion/internal/theme/registry.go`
- ESP8266 mapping/renderer: `firmware_esp8266/src/theme_defs.*`, `firmware_esp8266/src/renderer_esp8266.cpp`
- protocol validation: `protocol/theme_registry.json`, `protocol/schema.json`
- external Theme SDK is intentionally deferred to v2 (`docs/theme-sdk-v2-outlook.md`)

## Quick Start (macOS)

```bash
cd companion

# full setup: validates tooling, flashes firmware, installs binary, configures launch agent
go run ./cmd/vibeblock setup --yes

# health snapshot
go run ./cmd/vibeblock health
```

Common setup variants:

```bash
# skip flashing (already flashed device)
go run ./cmd/vibeblock setup --yes --skip-flash --port /dev/cu.usbserial-10

# explicit ESP32 firmware target (experimental for v0)
go run ./cmd/vibeblock setup --yes --firmware-env lilygo_t_display_s3 --port /dev/cu.usbmodem101

# v0 GIF workflow: upload and loop a local GIF on GIF-player firmware
go run ./cmd/vibeblock gif-upload --port /dev/cu.usbserial-10 --gif ~/Downloads/testgif3.gif
```

## Operations

```bash
cd companion

go run ./cmd/vibeblock doctor
go run ./cmd/vibeblock health
go run ./cmd/vibeblock version
go run ./cmd/vibeblock upgrade --firmware-env esp8266_smalltv_st7789
go run ./cmd/vibeblock rollback --port /dev/cu.usbserial-10
go run ./cmd/vibeblock restore-known-good --port /dev/cu.usbserial-10
go run ./cmd/vibeblock gif-upload --port /dev/cu.usbserial-10 --gif ~/Downloads/testgif3.gif
../scripts/upgrade-with-preflight.sh --firmware-env esp8266_smalltv_st7789
../scripts/rollback-last-known-good.sh --port /dev/cu.usbserial-10
```

Detailed operator procedures (setup, recovery, smoke test, troubleshooting):
- `docs/operator-runbook.md`

## Development

Companion tests:

```bash
cd companion
go test ./...
```

Firmware builds:

```bash
cd firmware_esp8266
pio run -e esp8266_smalltv_st7789
pio run -e esp8266_smalltv_st7789_gif_player

# optional ESP32 build (experimental for v0)
cd ../firmware
pio run -e lilygo_t_display_s3
```

## Repository Map

- `companion/` - Go CLI/daemon (`setup`, `doctor`, `health`, runtime)
- `firmware/` - ESP32 firmware (experimental for v0)
- `firmware_esp8266/` - ESP8266 firmware and board profiles (`v0` production target, including GIF player profiles)
- `firmware_shared/` - shared firmware core (parser/state)
- `protocol/` - protocol documentation
- `docs/` - operator and engineering docs
- `scripts/` - backup/restore and smoke scripts

## Canonical Docs

- Operator runbook: `docs/operator-runbook.md`
- Provider selection rules: `docs/provider-selection.md`
- Provider activity detectors: `docs/provider-activity-sources.md`
- Milestone test matrix: `docs/m1-test-matrix.md`
- Performance budgets: `docs/performance-budgets.md`
- Versioning and compatibility: `docs/versioning-compatibility.md`
- Release process: `docs/release-process.md`
- Known-good firmware: `docs/known-good-firmware.md`
- Theme SDK v2 outlook: `docs/theme-sdk-v2-outlook.md`
- Hardware sourcing checklist: `docs/supplier-hardware-checklist.md`
- ESP8266 spike notes: `docs/esp8266-spike.md`
- Open roadmap: `TODO.md`
- Completed milestones: `docs/completed-milestones.md`

## Upstream Hardware References

- ESP8266 supplier firmware: https://github.com/GeekMagicClock/smalltv
- ESP32 supplier firmware: https://github.com/GeekMagicClock/smalltv-pro
- Pinout discussion: https://github.com/GeekMagicClock/smalltv/issues/4
- ESPHome adaptation reference: https://github.com/ViToni/esphome-geekmagic-smalltv
