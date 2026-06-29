# VibeTV Architecture

VibeTV has four visible pieces:

1. **VibeTV hardware**: the physical WiFi display on the desk.
2. **CodexBar**: the upstream usage collector for AI providers.
3. **VibeTV Mac App**: the local `codexbar-display` process on the customer's Mac.
4. **Control Center**: the hosted customer app at `https://app.vibetv.shop`.

Simple version:

```text
CodexBar reads AI usage on the Mac
  -> VibeTV Mac App normalizes it
  -> Control Center manages setup and actions
  -> VibeTV renders it over local WiFi
```

## Data Flow

```text
AI provider state
  -> CodexBar
  -> codexbar-display api on 127.0.0.1:47832
  -> browser running app.vibetv.shop
  -> codexbar-display sends frames to VibeTV over LAN
  -> VibeTV screen
```

The Control Center browser talks to the local Mac App service using Chrome
Private Network Access. The Mac App then talks to the device on the customer's
local network. VibeTV does not need a cloud backend to receive display frames.

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

1. Customer powers VibeTV.
2. Customer joins `VibeTV-Setup` and puts the device on home WiFi.
3. VibeTV shows `app.vibetv.shop`.
4. Customer opens Control Center on the Mac.
5. Control Center asks the customer to install/start the Mac App when needed.
6. The Mac App discovers or connects to VibeTV.
7. Control Center unlocks Overview, Usage, Theme Library, Settings, Updates,
   and Support once setup is complete.

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
- Control Center fetches the public app, release metadata, and Shopify theme
  catalog data from the web.
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
