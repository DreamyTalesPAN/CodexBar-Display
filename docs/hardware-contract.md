# Hardware Contract (v0 MVP)

This document defines the required hardware/runtime contract for codexbar-display v0.

## Scope and Release Policy
- Release-gated MVP target: `esp8266_smalltv_st7789`
- Experimental fallback (non-blocking): `lilygo_t_display_s3`

## Firmware Environment -> Board Identity

The firmware `hello.board` value must match the selected firmware environment:

| Firmware Env | Expected `hello.board` | Release Role |
|---|---|---|
| `esp8266_smalltv_st7789` | `esp8266-smalltv-st7789` | release-gated |
| `lilygo_t_display_s3` | `esp32-lilygo-t-display-s3` | experimental, non-blocking |

Companion setup enforces this mapping when a device hello is available.

## Serial and Protocol Contract
- USB CDC serial at `115200` baud.
- Host sends newline-delimited JSON frames.
- Firmware emits JSON `hello` on boot/reconnect with:
  - `protocolVersion: 1`
  - `board` (mapped above)
  - `firmware` (SemVer line, v0 track: `1.x`)
  - `features` (for v0 display targets this includes `theme`)
  - `maxFrameBytes` (current contract: `512`)

## Theme Capability Contract
- If capabilities are explicitly known and `theme` is unsupported, host must omit `theme`.
- If hello is missing (unknown capabilities), host may use optimistic `theme` send on the MVP path.

## ESP8266 Pin Contract

`esp8266_smalltv_st7789`:
- `TFT_MOSI=13`
- `TFT_SCLK=14`
- `TFT_CS=-1`
- `TFT_DC=0`
- `TFT_RST=2`
- `TFT_BL=5`

Common display assumptions:
- ST7789 driver
- `240x240`
- filesystem: LittleFS

## Operator Verification
- `codexbar-display doctor`:
  - validates board/protocol contract and theme capability for ESP8266 boards
- `codexbar-display setup --yes [--firmware-env ...]`:
  - validates firmware env support
  - rejects incompatible board <-> env pair when hello is available

## Out of Scope (v0)
- Runtime media upload protocol
- External theme SDK/plugin loading
- Additional release-gated hardware beyond `esp8266_smalltv_st7789`
