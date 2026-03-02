# vibeblock

vibeblock is a physical CodexBar status display.

The companion reads `codexbar usage --json` and sends newline-delimited JSON frames over USB serial to the firmware.
For the Codex provider, companion prioritizes `--provider codex --source cli` over web-derived values.

## v0 Status
- Pre-release.
- Primary (and only release-gated MVP) hardware target: ESP8266 SmallTV ST7789 (`esp8266_smalltv_st7789`).
- v0 includes built-in themes (`classic`, `crt`, `mini`) and a shared GIF core for scenario-based playback.
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

Experimental fallback (non-blocking):
- `lilygo_t_display_s3`

Release go/no-go for MVP is gated only by `esp8266_smalltv_st7789`.

Theme selection is runtime-driven (`classic|crt|mini`) via `--theme` or `VIBEBLOCK_THEME`.
Protocol contract (v0 target): companion applies `theme` when capability handshake confirms support.
If device hello is temporarily unavailable on the MVP device path, companion falls back to optimistic theme send.

GIF core scenarios on ESP8266:
- `/mini.gif`: mini theme ambient overlay

`classic`/`crt` use no GIF playback at the moment.
The GIF core is request-based so additional theme/event scenarios can be added without reworking decode/retry logic.
Missing or invalid GIF assets automatically fall back to non-GIF UI and enter per-asset retry backoff.

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

# Focused ESP8266 soak gate (theme/reconnect/sleep-wake/24h simulation)
cd ..
./scripts/check-esp8266-soak-gate.sh

# GIF core policy tests (fallback/backoff/request-switching)
./scripts/check-gif-core-policy-tests.sh

# ESP8266 firmware
cd firmware_esp8266
pio run -e esp8266_smalltv_st7789

# ESP32 (experimental)
cd ../firmware_esp32
pio run -e lilygo_t_display_s3
```

## Docs
- Operator runbook: `docs/operator-runbook.md`
- Hardware contract: `docs/hardware-contract.md`
- Open roadmap: `TODO.md`
- Protocol: `protocol/PROTOCOL.md`
