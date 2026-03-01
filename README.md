# vibeblock

vibeblock is a physical CodexBar status display.

The companion reads `codexbar usage --json` and sends newline-delimited JSON frames over USB serial to the firmware.

## v0 Status
- Pre-release.
- Primary (and only release-gated MVP) hardware target: ESP8266 SmallTV ST7789 (`esp8266_smalltv_st7789`).
- ESP8266 alt pin mapping (`esp8266_smalltv_st7789_alt`) remains a supported best-effort variant (non-blocking).
- v0 includes built-in themes (`classic`, `crt`, `mini`) and mini-theme local GIF rendering.
- ESP32 (`lilygo_t_display_s3`) remains experimental fallback/non-blocking for v0.

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
```

## Firmware Environments
KISS runtime path:
- `esp8266_smalltv_st7789` (default, release-gated)

Optional hardware variant (only for alternate-wiring units):
- `esp8266_smalltv_st7789_alt` (supported, non-blocking)

Experimental fallback (non-blocking):
- `lilygo_t_display_s3`

Release go/no-go for MVP is gated only by `esp8266_smalltv_st7789`.

Theme selection is runtime-driven (`classic|crt|mini`) via `--theme` or `VIBEBLOCK_THEME`.
Protocol contract (v0 target): companion sends `theme` only when device hello advertises `features:["theme"]`.

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
- Protocol: `protocol/PROTOCOL.md`
