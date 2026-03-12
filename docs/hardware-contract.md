# Hardware Contract (USB-first transition)

This document defines the required hardware/runtime contract for codexbar-display on the USB-first path.

## Scope and Release Policy
- Release-gated MVP target: `esp8266_smalltv_st7789`
- Experimental fallback (non-blocking): `lilygo_t_display_s3`
- Transport in this phase: USB CDC serial only (`transport.active=usb`)

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
  - `supportedProtocolVersions: [2,1]`
  - `preferredProtocolVersion: 2`
  - `protocolVersion` (legacy single-value signal)
  - `board`, `firmware`, `features`, `maxFrameBytes`
  - `capabilities` block (`display`, `theme`, `transport`)

Companion negotiation:
- prefers v2 when available.
- falls back to v1 when negotiation data is missing/legacy.

## Theme Contract
- Built-in runtime themes: `classic`, `crt`, `mini`.
- Capability-aware behavior:
  - known + unsupported `theme` => host omits `theme`
  - unknown hello => optimistic `theme` send remains allowed
- ThemeSpec v1 (declarative JSON):
  - validated by companion before send
  - checked against capability limits (`maxThemeSpecBytes`, `maxThemePrimitives`, `builtinThemes`)
  - no user-script execution on firmware

## Local USB ThemeSpec Flow

```bash
cd companion
../codexbar-display theme-validate --spec ../protocol/fixtures/v2/theme_spec_mini_transport.json
../codexbar-display theme-apply --spec ../protocol/fixtures/v2/theme_spec_mini_transport.json
```

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
  - reports negotiated protocol version
- `codexbar-display setup --yes [--firmware-env ...]`:
  - validates firmware env support
  - rejects incompatible board <-> env pair when hello is available

## Out of Scope
- WiFi transport protocol implementation
- Cloud-hosted backend
- OTA over network
- Executing third-party theme code on firmware
