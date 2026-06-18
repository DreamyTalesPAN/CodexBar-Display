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
7. If exactly one VibeTV is found, the Companion stores that target for later checks.
8. If multiple VibeTV devices are found, the Companion refuses to auto-pick one. The customer must enter the exact target in Settings, for example `vibetv.local` or `http://192.168.178.163`, then run discovery again.
9. App can read bridge status, device status, firmware, active theme, and settings.
10. Theme install writes stay locked until the hardware-safe release gate is enabled.

## macOS Companion API Installer

The customer/support release installer is published as a GitHub Release asset:

```bash
curl -fsSL https://github.com/DreamyTalesPAN/CodexBar-Display/releases/latest/download/install-control-center-companion.sh | bash
```

It performs these steps:

- downloads the matching `codexbar-display` macOS release binary,
- verifies the release SHA-256 checksum,
- installs the binary to `~/Library/Application Support/codexbar-display/bin/codexbar-display`,
- writes `~/Library/LaunchAgents/com.codexbar-display.companion-api.plist`,
- starts `codexbar-display api --addr 127.0.0.1:47832`,
- verifies `http://127.0.0.1:47832/v1/status`.

Future releases also build macOS `.pkg` assets:

```text
VibeTV-Companion-API-arm64-v<version>.pkg
VibeTV-Companion-API-amd64-v<version>.pkg
```

The package installs the binary under `/Library/Application Support/VibeTV/bin/`, installs `/Library/LaunchAgents/com.codexbar-display.companion-api.plist`, and starts the LaunchAgent for the current console user after install. The package build script supports optional `--sign-identity` and `--notary-profile`, but a real signed/notarized customer package still requires Apple Developer ID Installer credentials and notarization setup.

The release workflow is prepared for optional signing/notarization. Without secrets it still builds unsigned `.pkg` assets. With secrets configured, the `build-companion-pkgs` release job imports the Developer ID Installer certificate into a temporary keychain, signs the packages, stores a notarytool profile, submits each package for notarization, and staples the result.

Required GitHub secrets for signed packages:

- `VIBETV_PKG_CERTIFICATE_BASE64`: base64-encoded `.p12` containing the Developer ID Installer certificate and private key.
- `VIBETV_PKG_CERTIFICATE_PASSWORD`: password for that `.p12`.
- `VIBETV_PKG_SIGN_IDENTITY`: optional explicit identity name, for example `Developer ID Installer: Company (TEAMID)`. If omitted, the workflow attempts to auto-detect a Developer ID Installer identity.

Additional GitHub secrets for notarized packages:

- `VIBETV_NOTARY_APPLE_ID`
- `VIBETV_NOTARY_TEAM_ID`
- `VIBETV_NOTARY_APP_SPECIFIC_PASSWORD`
- `VIBETV_NOTARY_PROFILE`: optional notarytool profile name; defaults to `vibetv-notary`.

Support restart:

```bash
curl -fsSL https://github.com/DreamyTalesPAN/CodexBar-Display/releases/latest/download/install-control-center-companion.sh | bash -s -- --restart
```

Support uninstall of the API LaunchAgent:

```bash
curl -fsSL https://github.com/DreamyTalesPAN/CodexBar-Display/releases/latest/download/install-control-center-companion.sh | bash -s -- --uninstall
```

The repository-level development installer remains available:

```bash
./scripts/install-control-center-companion.sh
```

It performs these steps without downloading from GitHub Releases:

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

The Control Center Updates screen checks `/api/companion/latest`. That route reads the latest GitHub Release and only exposes download links when the release actually contains customer installer assets:

- `VibeTV-Companion-API-arm64-v<version>.pkg`
- `VibeTV-Companion-API-amd64-v<version>.pkg`
- `install-control-center-companion.sh`

The app prefers the macOS package links when present and keeps the shell installer as a support fallback. Until the first release with those assets exists, the app shows the installer as pending instead of linking customers to a missing file.

The Overview screen uses the same release check when Companion is missing, so a new customer does not have to discover the Updates tab first. That missing-Companion state explains that the Chrome local-network permission only allows the website to contact local services; the customer still needs to install/start Companion on the computer.

The Updates screen labels the same package actions by state:

- `Install` when Companion is not running yet.
- `Update` when the installed Companion version is behind the latest release.
- `Repair` when Companion is already current but should be reinstalled or restarted cleanly.

## Support Checks

Check whether the API responds:

```bash
curl -fsS http://127.0.0.1:47832/v1/status
```

Run a read-only discovery:

```bash
curl -fsS -X POST http://127.0.0.1:47832/v1/device/discover \
  -H 'Content-Type: application/json' \
  -d '{}'
```

Run discovery against an exact target:

```bash
curl -fsS -X POST http://127.0.0.1:47832/v1/device/discover \
  -H 'Content-Type: application/json' \
  -d '{"target":"http://192.168.178.163"}'
```

If discovery returns `multiple_devices_found`, do not guess. Ask the customer which VibeTV they want to control and use the exact target in Settings.

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
