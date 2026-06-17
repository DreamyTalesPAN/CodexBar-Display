# VibeTV Control Center Command Console Spec

Status: active design/build spec for PR #120 (`codex/control-center-117`).
Do not merge or release from this work without explicit user approval.

## Product Intent

The hosted Control Center at `app.vibetv.shop` is a customer-facing command and control surface for VibeTV.
Its first job is to make device state visible before the customer tries to change anything.

Brand thesis: VibeTV helps AI builders see important workflow state early enough to stay oriented and avoid surprise interruptions.

Primary user question:

> Is my VibeTV connected, current, and safe to control?

Secondary user questions:

> What can I adjust?
> What themes can I install?

## Brand Constraints

Use only the VibeTV brandbook palette:

- Primary CTA / signal: `#CCFF00`
- CTA hover / active variant: `#ABD600`
- Secondary support accent: `#506600`
- Heading / dark surface: `#1B1B1B`
- Body text: `#444933`
- Base surface: `#F9F9F9`
- Secondary surface: `#EEEEEE`
- Structural stroke: `#747A60`
- Inverse text on dark: `#EDEDED`

No other colors. No blue, red, orange, purple, beige, gradient, or decorative color families.
Use status labels and hierarchy instead of extra status colors.

Visual tone:

- command and control center
- clean, sparse, builder-credible
- sharp, not soft
- warm through clarity, not cuteness
- no mascot, pet, companion, novelty-gadget framing

## Information Architecture

### Navigation

Use a persistent left rail on desktop and a compact top/segmented nav on narrow screens.

Tabs:

1. `Overview`
2. `Settings`
3. `Theme Library`
4. `Updates`
5. `Logs`

MVP behavior:

- `Overview`, `Settings`, and `Theme Library` are active screens in this PR.
- `Updates` and `Logs` may be read-only placeholders if the API data does not exist yet.
- Do not invent destructive actions for placeholder screens.

### Overview

Overview is status-only. It must not contain theme browsing or detailed settings controls.

Required sections:

- Top command header:
  - title: `VibeTV Control Center`
  - line: `Know where you stand.`
  - compact companion API endpoint
- Status hero:
  - primary state: connected/offline/missing bridge
  - support details:
    - Bridge
    - Device
    - Firmware
    - Updates
    - Write Access / Install Lock
    - Signal Freshness
- VibeTV device mockup:
  - large visual mockup of the physical square display
  - current theme/status shown on screen using brand colors only
  - no decorative gradients or non-brand colors
- Readiness strip:
  - rows or compact metrics for device, bridge, firmware, updates, write access
- Last events:
  - compact event list, e.g. bridge checked, device health read, firmware current, theme install locked
  - use current in-memory/browser state for now; backend event history is a future feature

### Settings

Settings contains all controls and device metadata.

Required sections:

- Connection controls:
  - check bridge
  - discover device
  - pair device
- Device facts:
  - target URL
  - board
  - firmware
  - transport
  - ThemeSpec readiness
- Display controls:
  - brightness slider
  - load settings
  - save brightness
- Safety state:
  - whether theme installs are locked
  - why writes are disabled when `VIBETV_ENABLE_WIFI_THEME_INSTALL` is absent

### Theme Library

Theme Library is the only place where themes appear.

Required sections:

- Theme list/table/grid with compact previews
- Selected theme detail
- install readiness reason
- install action
- last install success message

The install action stays disabled unless all are true:

- theme is free/installable in the MVP
- Companion API is online
- VibeTV is connected
- local install feature flag is enabled

Theme install must keep sending `skipFirmwareUpdate: true`.

### Updates

Future first-class screen. Current PR may show a clear placeholder with current known firmware value.

Missing API work:

- explicit update availability endpoint
- update channel/current/latest versions
- customer-safe update flow

### Logs

Future first-class screen. Current PR may show a clear placeholder or local session events.

Missing API work:

- persistent Companion event history endpoint
- event severity/type model
- timestamped device/write/read events

## Component Inventory

Current target components:

- `ControlCenterApp`
- `Shell`
- `SideNav`
- `OverviewScreen`
- `DeviceMockup`
- `ReadinessStrip`
- `LastEvents`
- `SettingsScreen`
- `ThemeLibraryScreen`
- `UpdatesScreen`
- `LogsScreen`
- shared primitives:
  - `ActionButton`
  - `StatusTile`
  - `FactRow`
  - `SectionHeader`
  - `ThemePreview`

## Current API/Data Mapping

Existing Companion API:

- `GET /v1/status`
  - companion status/version
  - `features.themeInstallEnabled`
  - saved target / saved pairing token state
- `POST /v1/device/discover`
- `GET /v1/device`
- `POST /v1/device/pair`
- `GET /v1/settings`
- `POST /v1/settings`
- `POST /v1/themes/install`

Existing theme catalog:

- Shopify Storefront API when configured
- GitHub catalog fallback only for explicit local development

## Feature Backlog

Track these before declaring the app end-to-end complete:

1. Real update data
   - Current status: not implemented.
   - Proposed destination: new issue after #120 unless user wants it in this PR.
   - Needed API: latest firmware/version availability and recommended action.

2. Persistent event log
   - Current status: UI can show local session events only.
   - Proposed destination: new issue after #120.
   - Needed API: local Companion event history.

3. Real active theme metadata
   - Current status: health may expose active theme in firmware but Control Center does not model it cleanly.
   - Proposed destination: likely in this PR if cheap; otherwise new issue.

4. Customer-safe install enablement
   - Current status: guarded by `VIBETV_ENABLE_WIFI_THEME_INSTALL=1`.
   - Proposed destination: keep guardrail in this PR.
   - No automatic hosted install until hardware path is explicitly approved.

## Implementation Tasks

- [x] Create command-console shell and brand color constants.
- [x] Refactor app state/types so tabs can share readiness state cleanly.
- [x] Build Overview screen with status hero, VibeTV mockup, readiness strip, and last events.
- [x] Move all settings controls into Settings tab.
- [x] Move all theme browsing/install UI into Theme Library tab.
- [x] Add Updates and Logs placeholder screens without fake backend claims.
- [x] Remove non-brand colors from Control Center UI.
- [x] Verify local app via browser and run `npm run lint`, `npm run build`, and `go test ./...`.
- [ ] Push to PR #120 only; do not merge, release, or tag.
