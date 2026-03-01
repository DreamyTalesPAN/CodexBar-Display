# vibeblock Companion

Go CLI/daemon for vibeblock.

It does three things:
- fetches usage from CodexBar (`usage --json`)
- selects one active provider deterministically
- sends protocol frames to the display over USB serial

Operator procedures are centralized in `../docs/operator-runbook.md`.

## v0 Scope
- Release-gated: ESP8266 SmallTV ST7789 variants
- GIF rendering/loop playback is included in v0
- ESP32 (`lilygo_t_display_s3`) remains experimental

## Most-used Commands
```bash
cd companion

go run ./cmd/vibeblock doctor
go run ./cmd/vibeblock health
go run ./cmd/vibeblock version

# Runtime
go run ./cmd/vibeblock daemon --once --port /dev/cu.usbserial-10
go run ./cmd/vibeblock daemon --interval 60s --theme mini

# Setup
go run ./cmd/vibeblock setup --yes
go run ./cmd/vibeblock setup --yes --skip-flash --theme mini

# Firmware/recovery
go run ./cmd/vibeblock upgrade --firmware-env esp8266_smalltv_st7789
go run ./cmd/vibeblock rollback --port /dev/cu.usbserial-10
go run ./cmd/vibeblock restore-known-good --port /dev/cu.usbserial-10

# GIF-player profile
go run ./cmd/vibeblock setup --yes --firmware-env esp8266_smalltv_st7789_gif_player --port /dev/cu.usbserial-10
go run ./cmd/vibeblock gif-upload --port /dev/cu.usbserial-10 --gif ~/Downloads/testgif3.gif
```

## Setup Summary
`setup` is idempotent and handles:
- CodexBar check (including Homebrew auto-install when missing)
- serial port selection (interactive when needed)
- firmware flashing (unless `--skip-flash`)
- companion install to `~/Library/Application Support/vibeblock/bin/vibeblock`
- launch agent write/restart (`com.vibeblock.daemon`)
- persistent runtime theme config (`--theme classic|crt|mini|none`)

Main flags:
- `--port`, `--yes`, `--skip-flash`, `--pin-port`, `--firmware-env`, `--theme`, `--validate-only`, `--dry-run`

## Runtime Summary
- Default poll interval: `60s`
- Error retry backoff: `1s -> 2s -> 4s ... -> 30s` (capped)
- Last-good-frame fallback on temporary usage fetch failures
- Theme precedence: `--theme` > `VIBEBLOCK_THEME` > runtime config > compile default
- Default mode is auto-port detection; pinned mode falls back to auto-detect if pinned path disappears

## Coded Errors
The CLI emits stable code families:
- `transport/*`
- `protocol/*`
- `runtime/*`
- `setup/*`
- `upgrade/*`
- `rollback/*`

Recovery mapping: `../docs/operator-runbook.md`

## Further Docs
- Runbook: `../docs/operator-runbook.md`
- Provider selection: `../docs/provider-selection.md`
- Provider activity sources: `../docs/provider-activity-sources.md`
- Performance budgets: `../docs/performance-budgets.md`
- Versioning/compatibility: `../docs/versioning-compatibility.md`
- Release process: `../docs/release-process.md`
- Known-good firmware: `../docs/known-good-firmware.md`
