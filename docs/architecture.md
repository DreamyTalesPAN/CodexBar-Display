# VibeTV Architecture

VibeTV has four visible pieces:

1. **VibeTV hardware**: the physical WiFi display on the desk.
2. **CodexBar**: the upstream usage collector for AI providers.
3. **VibeTV Mac App**: the local `codexbar-display` process on the customer's Mac.
4. **Control Center**: the local browser app served by the Mac App at
   `http://127.0.0.1:47832/control-center`.

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
  -> VibeTV Mac App on 127.0.0.1:47832
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
3. The Mac App resolves the theme pack from GitHub catalog artifacts when needed.
4. The Mac App uploads theme assets to VibeTV over local WiFi.
5. VibeTV activates the stored ThemeSpec and keeps receiving live usage frames.

Theme install and firmware update are separate flows. Theme install must not
silently flash firmware.

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
- Theme Studio: `tools/theme-studio`
