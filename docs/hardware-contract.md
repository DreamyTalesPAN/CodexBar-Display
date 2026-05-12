# Hardware Contract (WiFi runtime MVP)

This document defines the required hardware/runtime contract for codexbar-display on the VibeTV WiFi runtime path.

## Scope and Release Policy
- Release-gated MVP target: `esp8266_smalltv_st7789`
- Experimental fallback (non-blocking): `lilygo_t_display_s3`
- MVP runtime transport: WiFi HTTP (`transport.active=wifi`)
- USB CDC serial remains optional for development, flashing, logs, and support (`supported=["usb","wifi"]`)

## Firmware Environment -> Board Identity

The firmware `hello.board` value must match the selected firmware environment:

| Firmware Env | Expected `hello.board` | Release Role |
|---|---|---|
| `esp8266_smalltv_st7789` | `esp8266-smalltv-st7789` | release-gated |
| `lilygo_t_display_s3` | `esp32-lilygo-t-display-s3` | experimental, non-blocking |

Companion setup enforces this mapping when a device hello is available.

## Transport and Protocol Contract
- USB CDC serial at `115200` baud.
- WiFi HTTP on port 80 after the device joins the customer WiFi network.
- Host sends newline-delimited JSON frames either over USB Serial or as the body of `POST /frame`.
- Firmware exposes `GET /hello` over WiFi with the same hello shape as USB.
- Firmware emits JSON `hello` on boot/reconnect with:
  - `supportedProtocolVersions: [2,1]`
  - `preferredProtocolVersion: 2`
  - `protocolVersion` (legacy single-value signal)
  - `board`, `firmware`, `features`, `maxFrameBytes`
  - `capabilities` block (`display`, `theme`, `transport`)

Companion negotiation:
- prefers v2 when available.
- falls back to v1 when negotiation data is missing/legacy.

## WiFi Setup Contract
- Devices ship with firmware installed.
- Fresh or failed WiFi devices start an open `VibeTV-Setup` access point.
- Setup UI is served at `http://vibetv.local`. In setup mode this is backed by AP mDNS plus captive DNS; `http://192.168.4.1` remains the fallback address.
- The setup flow stores home WiFi credentials and restarts the device.
- Connected devices expose `http://vibetv.local` with mDNS, show/log the fallback IP, serve a local setup hub with a copyable Mac setup command, and wait for the Mac Companion.
- Companion runtime defaults to WiFi with `http://vibetv.local`; explicit device IPs remain supported when `.local` does not resolve.
- Saved WiFi credentials can be cleared from the local web UI with `POST /reset-wifi`.
- If a connected device loses WiFi, it retries in station mode first. After a persistent outage it starts `VibeTV-Setup` again so the user can choose a different network.
- If the device is not reachable on WiFi, three interrupted early boots clear saved WiFi credentials and return the device to `VibeTV-Setup`.
- Generic theme assets can be managed over WiFi with `GET /assets`, `POST /assets?path=...`, and `DELETE /assets?path=...`.
- `GET /assets` returns `filesystem.mounted` plus an `assets` array. Every asset entry includes `path` and `sizeBytes`; `sha256` is optional so small ESP8266 builds do not need to carry hashing code.
- `GET /health` returns `display.activeTheme` and `display.gif` so provisioning can see the active GIF path, file/decoder open state, backoff state, and the last GIF open/decode error.

## Theme Contract
- Built-in runtime themes: `classic`, `crt`, `mini`.
- Theme assets are stored as data files in LittleFS and are not hardcoded into the transport protocol.
- OTA package manifests list required theme assets separately from theme packs. Provisioning compares device `/assets` metadata against that manifest and rejects missing, empty, wrong-size, or wrong-hash required assets when the device exposes hashes.
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
- Cloud-hosted backend
- Cloud-hosted OTA orchestration
- Hosted theme store/catalog
- Executing third-party theme code on firmware
