# Control Center Customer Readiness

This document tracks the customer-facing hosted app flow for `https://app.vibetv.shop`.

## Current Architecture

`app.vibetv.shop` is the customer UI. It runs in the browser and talks to a local Companion API on the customer's computer:

```text
app.vibetv.shop
  -> http://127.0.0.1:47832/v1/status
  -> local Companion API
  -> VibeTV on the customer's LAN
```

The browser permission prompt only allows the website to contact local services. It does not install, start, or repair the Companion.

## Customer Flow

1. Customer opens `https://app.vibetv.shop`.
2. App checks the local Companion API at `127.0.0.1:47832`.
3. If Companion is missing, the app shows the local bridge state and repair actions.
4. Customer installs or starts the Companion.
5. Companion runs as a macOS LaunchAgent and survives login/reboot.
6. App searches for VibeTV on the same WiFi/LAN.
7. App can read bridge status, device status, firmware, active theme, and settings.
8. Theme install writes stay locked until the hardware-safe release gate is enabled.

## macOS Companion API Installer

The current repository-level installer is:

```bash
./scripts/install-control-center-companion.sh
```

It performs these steps:

- builds `companion/cmd/codexbar-display`,
- installs the binary to `~/Library/Application Support/codexbar-display/bin/codexbar-display`,
- writes `~/Library/LaunchAgents/com.codexbar-display.companion-api.plist`,
- starts `codexbar-display api --addr 127.0.0.1:47832`,
- verifies `http://127.0.0.1:47832/v1/status`.

Optional local development origin:

```bash
VIBETV_COMPANION_DEV_ORIGIN=http://localhost:3002 ./scripts/install-control-center-companion.sh
```

The API LaunchAgent is separate from the older frame-sending daemon LaunchAgent. The API service exists so `app.vibetv.shop` can talk to the local machine without keeping a Terminal window open.

## Support Checks

Check whether the API responds:

```bash
curl -fsS http://127.0.0.1:47832/v1/status
```

Inspect service state:

```bash
launchctl print gui/$(id -u)/com.codexbar-display.companion-api
```

Logs:

```text
/tmp/codexbar-display-companion-api.out.log
/tmp/codexbar-display-companion-api.err.log
```

Restart service:

```bash
launchctl kickstart -k gui/$(id -u)/com.codexbar-display.companion-api
```

Unload service:

```bash
launchctl bootout gui/$(id -u)/com.codexbar-display.companion-api
```

## Release Gate

Read-only checks are allowed:

- `GET /v1/status`
- `GET /v1/device`
- `POST /v1/device/discover`
- `GET /v1/settings`

Theme install writes remain locked unless `VIBETV_ENABLE_WIFI_THEME_INSTALL=1` is set for a prepared hardware test window. Browser installs send `skipFirmwareUpdate: true`, and the install path must not trigger firmware updates.

Do not run device write tests, merge, or tag a release until the user has tested and explicitly approved the hardware flow.
