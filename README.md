# vibeblock

vibeblock is a physical CodexBar status display.

The companion reads `codexbar usage --json` and sends newline-delimited JSON frames over USB serial to the firmware.

## v0 Status
- Pre-release.
- Release-gated hardware target: ESP8266 SmallTV ST7789 (including alt pin mappings).
- v0 includes GIF rendering/loop playback and built-in themes (`classic`, `crt`, `mini`).
- ESP32 (`lilygo_t_display_s3`) remains experimental/non-blocking for v0.

## Quick Start (macOS)
```bash
cd companion

# Full setup (flash + install + launch agent)
go run ./cmd/vibeblock setup --yes

# Health snapshot
go run ./cmd/vibeblock health
```

## Common Commands
```bash
cd companion

# One-shot runtime test
go run ./cmd/vibeblock daemon --once --port /dev/cu.usbserial-10 --theme mini

# Persist runtime theme
go run ./cmd/vibeblock setup --yes --skip-flash --theme mini

# Upgrade / rollback
go run ./cmd/vibeblock upgrade --firmware-env esp8266_smalltv_st7789
go run ./cmd/vibeblock rollback --port /dev/cu.usbserial-10

# GIF-player profile + upload flow
go run ./cmd/vibeblock setup --yes --firmware-env esp8266_smalltv_st7789_gif_player --port /dev/cu.usbserial-10
go run ./cmd/vibeblock gif-upload --port /dev/cu.usbserial-10 --gif ~/Downloads/testgif3.gif
```

## Firmware Environments
Release-gated (ESP8266):
- `esp8266_smalltv_st7789` (default)
- `esp8266_smalltv_st7789_crt`
- `esp8266_smalltv_st7789_mini`
- `esp8266_smalltv_st7789_alt`
- `esp8266_smalltv_st7789_alt_crt`
- `esp8266_smalltv_st7789_alt_mini`
- `esp8266_probe`
- `esp8266_smalltv_st7789_gif_player`
- `esp8266_smalltv_st7789_alt_gif_player`

Experimental:
- `lilygo_t_display_s3`

## Theme Precedence
1. `vibeblock daemon --theme <classic|crt|mini>`
2. `VIBEBLOCK_THEME`
3. `~/Library/Application Support/vibeblock/config.json`
4. Firmware compile default

## Development
```bash
# Companion tests
cd companion
go test ./...

# ESP8266 firmware
cd ../firmware_esp8266
pio run -e esp8266_smalltv_st7789

# ESP32 (experimental)
cd ../firmware
pio run -e lilygo_t_display_s3
```

## Docs
- Operator runbook: `docs/operator-runbook.md`
- Open roadmap: `TODO.md`
- Completed milestones: `docs/completed-milestones.md`
- Protocol: `protocol/PROTOCOL.md`
- Versioning/compatibility: `docs/versioning-compatibility.md`
- Release process: `docs/release-process.md`
- Known-good firmware: `docs/known-good-firmware.md`
