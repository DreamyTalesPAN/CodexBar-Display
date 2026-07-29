# VibeTV Architecture

VibeTV has four visible pieces:

1. **VibeTV hardware**: the physical WiFi display on the desk.
2. **CodexBar**: the upstream usage collector for AI providers.
3. **VibeTV Mac App**: the local `codexbar-display` process on the customer's Mac.
4. **Control Center**: the local browser app served by the Mac App. It prefers
   `http://127.0.0.1:47832/control-center` and automatically uses another
   loopback port when that port belongs to an unrelated process. It never
   starts a second display writer beside another VibeTV service.

The hosted page at `https://app.vibetv.shop` is the download entrypoint. It
offers the verified Mac App DMG. After installation, the customer opens the Mac
App and continues entirely in the local Control Center on the same Mac.

Simple version:

```text
CodexBar reads AI usage on the Mac
  -> VibeTV Mac App normalizes it
  -> local Control Center manages actions
  -> VibeTV renders it over local WiFi
```

## Data Flow

```text
AI provider state
  -> CodexBar
  -> VibeTV Mac App on a private loopback port
  -> browser running the local Control Center
  -> codexbar-display sends frames to VibeTV over LAN
  -> VibeTV screen
```

The hosted setup page only resolves and offers the verified Mac App DMG. It does
not probe loopback or manage VibeTV. After the customer opens the installed app,
the full Control Center is served locally, and private device actions stay on
the customer's Mac and LAN. VibeTV does not need a cloud backend to receive
display frames.

## Responsibilities

| Piece | Responsibility |
| --- | --- |
| VibeTV hardware | WiFi setup, device health, display settings, rendering frames, storing active ThemeSpec assets. |
| CodexBar | Provider integrations, provider usage fetching, local token scans, provider status. |
| VibeTV Mac App | Local API, device discovery, pairing, usage snapshots, theme install, firmware update, support diagnostics. |
| Control Center | Customer setup, next action UI, Theme Library, Usage view, Settings, Updates, Support logs. |
| Shopify | Hardware product pages and theme catalog source for Control Center. |
| GitHub releases | Mac App binaries, checksums, firmware binaries, installer script, theme-pack catalog artifacts. |

## Why CodexBar Exists In The Stack

CodexBar already knows how to collect provider-specific usage information from
local files, CLIs, OAuth/API sources, browser sessions, and provider dashboards.
VibeTV should not duplicate that provider work. It uses CodexBar as the source
of usage truth, then focuses on physical display, setup, themes, updates, and
hardware reliability.

## Local Mac App

Control Center uses:

```text
http://127.0.0.1:47832
```

Important endpoints include:

- `GET /v1/status`
- `GET /v1/usage`
- `POST /v1/device/discover`
- `POST /v1/device/repair`
- `POST /v1/themes/install`
- `POST /v1/firmware/install`
- `GET /v1/diagnostics`

Customer-facing copy should still call this the **Mac App**, not an API or
daemon. API language belongs in developer and operator docs.

## Setup Flow

1. Customer opens `app.vibetv.shop` on the Mac and downloads the verified DMG.
2. Customer drags VibeTV Control Center into Applications and opens it.
3. If no usable device is configured, the native app explains how to join
   `VibeTV-Setup` on a phone and put VibeTV on the home WiFi.
4. The customer confirms that VibeTV is on WiFi.
5. The Mac App discovers the device, pairs only when required, starts the local
   display stream, and verifies the returned device status.
6. A successful check opens Overview immediately. An existing healthy setup
   skips onboarding and opens Overview directly.
7. Overview, Usage, Theme Library, Settings, Updates, and Support remain local
   to the installed Mac App.

## Theme Flow

1. Control Center reads the public theme catalog from Shopify.
2. Each theme maps to a VibeTV theme-pack ID.
3. Published themes use catalog artifacts; Theme Studio sends its generated ZIP
   directly to the loopback Mac App without a hosted API or temporary URL.
4. The Mac App validates the pack and device readiness, then uploads the theme
   assets to VibeTV over local WiFi.
5. VibeTV activates the stored ThemeSpec and keeps receiving live usage frames.

Theme install and firmware update are separate flows. Theme install must not
silently flash firmware.

## Screensaver Slot

The device has two independent ThemeSpec slots, and the Mac App is the only path
to both. Control Center never talks to the device directly.

- `POST /v1/themes/install` takes `"slot": "live"` (the default) or
  `"slot": "screensaver"`. Both run the same verified install: same pack
  validation, same asset upload with its rate limiting, same upload verification.
  The screensaver slot then records the reference through `/screensaver/active`
  instead of activating and re-rendering, so the live theme stays on screen and
  there is no new image to verify.
- A pack is rejected when its `usage` does not match the target slot, before
  anything is uploaded. The screensaver slot additionally requires a device that
  advertises `capabilities.standby.supported`.
- `GET`/`POST /v1/settings` carries `standby` with `enabled`, `timeoutMinutes`,
  `brightnessPercent` and `screensaverPath`. `screensaverPath` is the slot state:
  the stored ThemeSpec the device shows in standby, `null` while the slot is
  empty. Omitting it on a write leaves the slot untouched. The device clamps and
  validates; the Mac App forwards and returns the readback.

## Device Clock

VibeTV keeps its own wall clock so `{time}` and `{date}` stay correct while the
Mac is off.

- After the WiFi link is up, the firmware starts SNTP against `pool.ntp.org`
  (**UDP port 123, outbound**) and reads UTC from the system clock. This is the
  only traffic the firmware initiates on its own. It is not an HTTPS fetch, so
  the rule that the firmware must not fetch public HTTPS manifests is untouched.
- SNTP delivers UTC only. The local UTC offset is learned from the Companion
  clock string while the Mac is reachable, rounded to a quarter hour, and stored
  in the device settings file, so it survives a reboot with the Mac switched off.
- Rendering order: device clock first; the Companion string second, and only
  while it is still current (two minutes); otherwise `--:--` / `--.--.----`.
  A frozen value is never presented as the current time.
- `GET /health` reports `clock.synced`, `clock.source`, `clock.epoch`,
  `clock.utcOffsetMinutes`, `clock.lastSyncAgeMs`, `clock.syncCount` and the
  resolved `clock.time` / `clock.date`.

## Privacy Shape

- Provider usage is read on the customer's Mac through CodexBar and the Mac App.
- The Mac App sends display frames to VibeTV over local WiFi.
- The hosted setup page, release metadata, and Shopify theme catalog data come
  from the web.
- The full Control Center app is served from the local Mac App after setup.
- In the normal product flow, provider usage is displayed in the browser and on
  VibeTV; it is not stored as a VibeTV cloud account dataset.
- Support diagnostics are created only when requested. They include device/app
  health fields and are designed to avoid secrets, pairing tokens, raw cookie
  values, direct contact data, and tokenized URLs.

## Developer Entry Points

- Control Center app: `apps/control-center`
- Mac App command: `companion/cmd/codexbar-display`
- Local API server: `companion/internal/companionapi`
- Usage collector: `companion/internal/codexbar`
- Device daemon/frame sending: `companion/internal/daemon`
- Firmware: `firmware_esp8266`
- Theme Studio UI: `apps/control-center/src/components/theme-studio-screen.tsx`
- Theme Studio domain and ZIP logic: `apps/control-center/src/lib/theme-studio.ts`
