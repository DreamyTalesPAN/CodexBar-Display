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
  - `capabilities.display.brightness` when browser-adjustable backlight control is supported, including `minPercent` and `maxPercent` (1-100 on the current ESP8266 firmware)

Companion negotiation:
- prefers v2 when available.
- falls back to v1 when negotiation data is missing/legacy.

### RAW OTA sender pacing: always paced, and never concurrent

The RAW OTA sender keeps a 10 ms pause between 64-byte chunks for **every**
firmware version, and waits for a block acknowledgement every 1024 bytes.

The pause used to be skipped for released firmware >= 1.0.37, on the assumption
that the receiver fix in that version made it unnecessary. Measured on
`esp8266-smalltv-st7789`, with socket-level proof of what else was talking to
the device during each run:

| Sender | Other traffic to device | Device firmware | Direction | Result |
|---|---|---|---|---|
| Unpaced | none | 1.0.39 | -> 9999.0.24 | stalled |
| Unpaced | none | 1.0.39 | -> 9999.0.24 | stalled |
| Paced | none | 1.0.39 | -> 9999.0.24 | **installed** |
| Paced | Mac App runtime polling | 9999.0.24 | -> 1.0.39 | stalled |
| Unpaced | none (proven by `lsof`) | 9999.0.24 | -> 1.0.39 | stalled |
| Paced | none (proven by `lsof`) | 9999.0.24 | -> 1.0.39 | **installed** |

Unpaced: 0/3. Paced with the device to itself: 2/2. Paced while the Mac App
runtime was still polling: 0/1.

Two independent requirements follow, and both are needed:

1. **Pace every upload.** No firmware version is exempt. Locked by
   `TestFirmwareRawWritePauseIsConservativeForEveryFirmware`, `DO NOT weaken`.
2. **Quiesce every other writer first.** A paced upload still stalls if anything
   else is holding a connection to the device. Nothing may talk to port 80 while
   firmware bytes are on port 8081 -- not health polls, not display frames.

The stall itself is a TCP-level stop: `waitForFirmwareRawAck` polls the macOS
socket's `Snd_sbbytes` and gives up after 30 s when the send buffer never
drains, so the device's receive window closed and stayed closed. The "N bytes
pending" figure is send-buffer occupancy, not protocol state, which is why it is
not a multiple of the chunk size. A healthy paced upload takes about 100 s; a
stalling one dies after the 30 s ack timeout.

Contention was ruled out as the sole cause and pacing was ruled in by sampling
`lsof -nP -i @<device>` twice a second through each run: in the isolated runs
exactly one socket existed during the upload window, on port 8081, owned by the
updater, with zero overlap between port 80 and port 8081 samples.

### An interrupted OTA deactivates the stored theme

After a stalled upload the device reboots and comes back with
`display.activeTheme: "theme-missing"` and `display.themeSpec.active: false`,
while `themeSpec.path` still points at the stored spec. Measured over 7 minutes
and 24 probes with **no** Mac App or daemon running: the device never
reactivates the spec on its own.

A **successful** update does not have this problem — the device came back on
`9999.0.24` with `activeTheme: "clippy"` and the spec active.

So recovery is the updater's job: after a failed upload it must reactivate the
stored spec rather than leave the customer on a blank theme. Not yet
implemented.

### Token transport: exactly one carrier per request

An authenticated request carries the pairing token in the `X-VibeTV-Token`
header **or** in the `?token=` query parameter — never in both at once.

This is a device-proven rule, not a style preference. Measured against
`esp8266-smalltv-st7789` on firmware `1.0.39`, 30 attempts per variant from one
Go `http.Client`, no other traffic to the device:

| Token carrier | Failures |
|---|---|
| Header **and** query together | **24/30** — connection closed, `EOF`, no response |
| Header only | 0/30 |
| Query only | 0/30 |

The same bytes replayed over a raw socket succeed, and `curl` succeeds, so the
trigger is timing-dependent on the device side rather than a malformed request.
Until the firmware-side cause is understood, clients must not duplicate the
token.

Why this matters: duplicating the token broke **every** firmware update. The
update path authenticated `/hello` with both carriers, so the preflight failed
before a single byte was uploaded, and the customer saw only *"Update failed —
Keep VibeTV powered on, then try again."* Retrying could not help. Removing the
duplication took the same preflight to 0/30 failures on the same device.

Regression tests that lock this rule are marked `DO NOT weaken`:
`TestDeviceHelloPreflightSendsTokenOnlyInHeader`.

A second device-side defect is visible in the same measurement: when the token
is **invalid**, a header-only or query-only request returns a clean `401`, but a
duplicated one closes the connection. An expired token therefore surfaces as an
unexplained transport error instead of an authentication failure.

## WiFi Setup Contract
- Devices ship with firmware installed.
- Fresh or failed WiFi devices start an open `VibeTV-Setup` access point.
- Setup UI is served at `http://192.168.4.1` through the setup access point and captive DNS.
- The device setup screen tells the customer to join the open `VibeTV-Setup`
  access point manually and open `192.168.4.1`.
- The setup UI lists only 2.4 GHz scan results, supports an explicit re-scan,
  and keeps manual SSID entry available for hidden networks.
- `Troubleshooting: vibetv.shop/pages/setup` links to the public support page
  delivered by issue #192 at `https://vibetv.shop/pages/setup`.
- Fresh setup and automatic fallback after a lasting WiFi failure use the same
  writable setup form. The setup flow stores the selected home WiFi credentials
  and restarts the device.
- Saving a different network changes only the WiFi SSID/password. A paired
  device keeps its device ID, pairing token, themes/assets, active theme,
  brightness, and other settings.
- Connected devices expose their current IP in `/hello` discovery, show `WiFi connected!` plus `app.vibetv.shop`, serve the local setup hub on that IP, and wait for the Mac App.
- Connected devices expose read-only status on their current IP. Customer-facing writes are performed by the authenticated Control Center.
- `POST /api/settings` accepts form field `b` as a brightness percentage and updates supported settings without reflashing firmware. Include `api=1` for a JSON/CORS response; omit it for the built-in IP-based form redirect. `GET /health` is the readback and support-diagnostics path.
- Starting with firmware `1.0.39`, connected devices accept an explicit local-WiFi `POST /api/pair` without the previous token; the latest Mac wins. Other write APIs require `X-VibeTV-Token` or the native-tool/raw-OTA query fallback. Read-only diagnostics (`/hello`, `/health`, `GET /assets`) remain open.
- Firmware and filesystem uploads always require the current pairing token,
  including on fresh devices and while `VibeTV-Setup` is active. The public
  `/update` page never embeds that token or exposes a direct upload form.
- Companion runtime discovers the current device IP and verifies the stable `deviceId`; it does not use a hostname default.
- Saved WiFi credentials can be cleared by an authenticated Control Center request.
- If a connected device loses WiFi, it retries in station mode first. After a
  lasting failure it returns to the same open, writable `VibeTV-Setup` portal,
  where the customer can choose the new network without resetting the device.
- Short or repeated power interruptions never clear saved WiFi credentials on
  firmware `1.0.39` and newer. Firmware `1.0.38` retains its legacy
  three-power-cycle WiFi recovery solely so old devices can reconnect and
  update.
- Theme assets can be managed over WiFi only below `/themes/`; internal filesystem paths are never mutable through the asset API.
- `GET /assets` returns `filesystem.mounted` plus an `assets` array. Every asset entry includes `path` and `sizeBytes`; `sha256` is optional so small ESP8266 builds do not need to carry hashing code.
- `GET /health` returns `display.activeTheme`, compact `display.themeSpec` render health, and `display.gif` so provisioning can see the active GIF path, file presence, decoder state, blocked state, and the last GIF open/decode error.
- `GET /health` returns `settings.display.brightnessPercent` for support diagnostics. A VibeTV without saved display settings reports the 20 percent factory default.

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
  - active stored ThemeSpec path is persisted on the device, so the last activated ThemeSpec is restored after reboot before live usage frames arrive
  - if the persisted active ThemeSpec is missing or invalid, firmware falls back to the built-in `mini-classic` ThemeSpec cache
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

Current release-gated hardware treats `TFT_BL` as PWM-capable and active-low (`TFT_BACKLIGHT_ON=0`), so brightness percentages are inverted before writing PWM duty.

Common display assumptions:
- ST7789 driver
- `240x240`
- filesystem: LittleFS
- asset paths: 31 characters max on ESP8266 LittleFS

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
