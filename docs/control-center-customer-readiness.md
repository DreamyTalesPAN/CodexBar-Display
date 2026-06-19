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

The local Companion responds to Chrome Private Network Access preflights from the allowed hosted origin. Allowed preflights include `Access-Control-Allow-Private-Network: true`; unknown origins remain blocked.

## Customer Flow

1. Customer opens `https://app.vibetv.shop`.
2. App checks the local Companion API at `127.0.0.1:47832`.
3. If Companion is missing, the app shows one primary Companion install/repair action.
4. Customer installs or starts the Companion.
5. Companion runs as a macOS LaunchAgent and survives login/reboot.
6. App searches for VibeTV on the same WiFi/LAN.
7. If exactly one VibeTV is found, the Companion stores that target for later checks.
8. If multiple VibeTV devices are found, the Companion refuses to auto-pick one. The customer must enter the exact target in the VibeTV target field, for example `vibetv.local` or `http://192.168.178.163`, then run discovery again. A manually entered target is strict: if that exact target does not answer, the Companion reports a device error instead of falling back to another discovered VibeTV.
9. App can read Companion status, VibeTV status, firmware, active theme, and settings.
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

Customer releases must include macOS `.pkg` assets:

```text
VibeTV-Companion-API-arm64-v<version>.pkg
VibeTV-Companion-API-amd64-v<version>.pkg
```

The package installs the binary under `/Library/Application Support/VibeTV/bin/`, installs `/Library/LaunchAgents/com.codexbar-display.companion-api.plist`, and starts the LaunchAgent for the current console user after install. Customer packages require Apple Developer ID Installer credentials and notarization setup.

The release workflow now fails before creating customer release assets unless the package signing and notarization secrets are configured. With secrets configured, the `build-companion-pkgs` release job imports the Developer ID Installer certificate into a temporary keychain, signs the packages, stores a notarytool profile, submits each package for notarization, staples the result, validates both packages again with signature and notarization checks, and only then uploads the `.pkg` assets to the release.

When the `.pkg` is installed or repaired, its `preinstall` script unloads the existing `com.codexbar-display.companion-api` LaunchAgent for the console user and removes the old script-installed user plist at `~/Library/LaunchAgents/com.codexbar-display.companion-api.plist` before the new payload is written. Its `postinstall` script then loads the package LaunchAgent from `/Library/LaunchAgents`. The package LaunchAgent becomes the single active Companion API service.

After the package is installed, the legacy shell installer refuses to run when it detects the package receipt `shop.vibetv.companion-api`. This prevents support steps from accidentally recreating the old user LaunchAgent. Use the package repair/update path instead. Support can still override the guard explicitly with `--force-legacy-script` when they intentionally need the legacy script.

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

Both legacy support commands are guarded after package migration. If the signed package is already installed, they exit without touching `~/Library/LaunchAgents/com.codexbar-display.companion-api.plist` unless support adds `--force-legacy-script`.

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

The Control Center Updates screen checks `/api/companion/latest`. That route reads the latest GitHub Release and only exposes customer package download links when the release actually contains both macOS package assets:

- `VibeTV-Companion-API-arm64-v<version>.pkg`
- `VibeTV-Companion-API-amd64-v<version>.pkg`

The legacy `install-control-center-companion.sh` asset is optional. When it exists, the app treats it as a support fallback; when both package assets exist without the script, the customer package path is still ready.

Set `CONTROL_CENTER_GITHUB_TOKEN` in the hosted app environment when possible. The token is used only by the server-side release check and is not sent to the browser. The read-only customer-readiness script also uses `CONTROL_CENTER_GITHUB_TOKEN` or `GITHUB_TOKEN` for GitHub release reads when present. Without a token, GitHub release reads are anonymous and can hit rate limits.

Successful GitHub release reads are cached server-side for one minute. Failed release reads are not cached, so the customer-facing retry button can check again immediately.

Package links must exactly match the latest release tag version. If the latest release is `v1.0.32`, the app only exposes package download buttons when both `VibeTV-Companion-API-arm64-v1.0.32.pkg` and `VibeTV-Companion-API-amd64-v1.0.32.pkg` exist. Older, mismatched, or partial package assets stay hidden.

The app prefers the macOS package links when present. When both Apple silicon and Intel `.pkg` assets exist, customer-facing download actions show the package buttons and do not offer the shell script next to them. Because the release workflow only uploads `.pkg` release assets after signing and notarization validation, package buttons should not appear for unsigned local build artifacts. Until the first release with those assets exists, the app shows the installer as unavailable instead of linking customers to a missing file.

If only the shell script asset is available, the Updates screen must label it as a support fallback instead of a normal customer installer. The primary package state stays `Mac package pending`; the script link is secondary. Normal customer onboarding should use the signed and notarized macOS package buttons.

When the browser can detect the Mac architecture, the matching package is shown first and marked `This Mac`. If detection is unavailable, both Apple silicon and Intel packages remain visible without marking both as the primary recommendation.

The Overview screen and the `/install/<theme_id>` entry use the same release check when Companion is missing, so a new customer does not have to discover the Updates tab first. That setup state has one primary action: install or repair Companion. If Companion is already installed but the app still cannot reach it, the package download is also the repair path.

The Overview and `/install/<theme_id>` setup path should not show release diagnostics, internal asset names, or multiple equal actions. Customers should see only the next action that can move setup forward.

After a customer clicks any Companion download action, the app shows the immediate next step in place: open the package from Downloads, finish the install/update/repair, then return to the same page. The page keeps checking Companion and moves forward when it becomes available.

The Updates screen is available only after setup is complete. It should expose update actions, not setup recovery actions.

While the page is open in the missing-Companion state, it quietly checks Companion again. After the customer installs or starts Companion, the UI should move forward without requiring a manual refresh.

When Companion is running but VibeTV is not found, the Overview screen and the `/install/<theme_id>` entry expose a `VibeTV target` field and one `Connect VibeTV` action. Customers or support can enter the exact `vibetv.local`/IP target there and connect without leaving the current flow.

Manual targets may be `vibetv.local`, an IP address, or an `http(s)` URL with a host and optional valid port. The Companion rejects explicit targets with unsupported schemes, invalid ports, paths, username/password credentials, query strings, or fragments so support reports do not collect tokenized URLs.

If an exact target does not answer, the app keeps Companion online and shows VibeTV as not found. That means the customer should correct the device target or WiFi state, not reinstall Companion.

If the Shopify theme catalog is empty or the requested `/install/<theme_id>` does not exist in the catalog, the app must show a locked catalog state. It must not fall back to demo/mock themes or silently select the first available theme for an unknown Shopify link.

The Updates screen labels the same package actions by state:

- `Install` when Companion is not running yet.
- `Update` when the installed Companion version is behind the latest release.
- `Repair` when Companion is already current but should be reinstalled or restarted cleanly.

The public VibeTV Shopify theme products now link to this hosted readiness flow instead of copying a terminal install command. As of 2026-06-19, the Shopify products `synthwave-theme`, `clippy-theme`, and `claude-creature-theme` link to technical Control Center theme IDs `synthwave`, `clippy`, and `claude-creature`, and no longer expose `codexbar-display theme-pack install --target http://vibetv.local` as customer-facing copy.

## Customer Readiness Validation

Use the read-only validation script before asking a customer to use a release:

```bash
scripts/check-control-center-companion-customer-readiness.sh \
  --release v<version> \
  --pkg dist/companion-pkg/VibeTV-Companion-API-arm64-v<version>.pkg \
  --require-signed \
  --require-notarized \
  --app-url https://app.vibetv.shop \
  --expect-catalog-source shopify \
  --expect-theme-id <theme_id> \
  --expect-all-free-themes-installable \
  --expect-shopify-product-pages
```

Keep the script behavior covered in CI with:

```bash
scripts/test-control-center-companion-customer-readiness.sh
scripts/test-control-center-companion-legacy-installer.sh
```

The readiness checker test uses a fake `curl` binary through `CONTROL_CENTER_READINESS_CURL`, so it does not hit the hosted app, Shopify, local Companion, or VibeTV hardware. The legacy installer guard test uses fake `pkgutil`, `launchctl`, and `curl` with a temporary `HOME`; it proves the shell installer refuses to touch the old user LaunchAgent after a package receipt exists unless support explicitly passes `--force-legacy-script`.

Keep the macOS package builder covered with:

```bash
scripts/test-control-center-companion-pkg-build.sh
```

That smoke test runs on macOS, builds temporary unsigned `arm64` and `amd64` Companion packages, then validates both packages with the same read-only readiness checker. It does not install packages, start services, discover devices, or write to VibeTV hardware.

What it checks:

- release contains `install-control-center-companion.sh`,
- release contains both macOS package assets,
- package metadata uses the expected package identifier, version, and `/` install location,
- package payload includes the Companion binary and LaunchAgent plist,
- package binary architecture matches the package filename, for example `arm64` or `amd64`,
- package LaunchAgent points to `/Library/Application Support/VibeTV/bin/codexbar-display api --addr 127.0.0.1:47832`, has `RunAtLoad`/`KeepAlive`, and does not include a development origin,
- package includes executable `preinstall` and `postinstall` scripts for migration/repair,
- package `preinstall`/`postinstall` scripts unload the old user LaunchAgent, remove the legacy `~/Library/LaunchAgents/com.codexbar-display.companion-api.plist`, and load the package LaunchAgent from `/Library/LaunchAgents`,
- package payload has no AppleDouble files,
- optional Developer ID Installer signature,
- optional notarization staple,
- hosted app HTTP reachability,
- hosted app `/api/companion/latest` status and exact installer/package asset names when `--app-url` is combined with `--release` or `--release-json`,
- optional hosted app `/api/themes` source, selected free theme readiness, concrete `/install/<theme_id>` route reachability, and all visible free theme readiness when `--expect-catalog-source`, `--expect-theme-id`, or `--expect-all-free-themes-installable` is provided.
- optional public Shopify product page readiness when `--expect-shopify-product-pages` or `--shopify-product-page <url> <theme_id>` is provided: each checked product page must link to `https://app.vibetv.shop/install/<theme_id>`, show gated readiness button copy such as `Check compatibility in the app`, `Kompatibilität prüfen`, or `In App öffnen`, and must not expose the legacy terminal install command, `vibetv.local` target, or a finished install promise like `Jetzt installieren` / `Install now`. `--expect-shopify-product-pages` reads `productUrl` from `/api/themes`, or derives it from `handle` plus `--shopify-store-url` while older deployments are still rolling forward, and checks every free Shopify catalog item.

Use `--expect-catalog-source shopify` for the production customer app. Use `--expect-theme-id <theme_id>` for at least one public free Shopify theme before linking customers to product pages. That selected theme check also requests `/install/<theme_id>` so the Shopify Custom Liquid button target is proven reachable. Add `--expect-all-free-themes-installable` before a collection-wide rollout. Those checks fail if a required theme is missing, paid, missing `themeId`, has no resolved `packUrl`, exposes a `packUrl` that is not an `http(s)` download URL, or if any free theme's `/install/<theme_id>` route is not reachable.

After installing on a clean Mac, run:

```bash
scripts/check-control-center-companion-customer-readiness.sh \
  --installed-package \
  --local-companion \
  --expect-version <version>
```

The clean-Mac installed-package check verifies the macOS package receipt, installed Companion binary, installed package LaunchAgent plist metadata, absence of the legacy user LaunchAgent plist, whether the loaded LaunchAgent points to the package binary, local Companion `/v1/status`, and the hosted-app Private Network Access preflight. The installed plist must point to `/Library/Application Support/VibeTV/bin/codexbar-display api --addr 127.0.0.1:47832`, keep `RunAtLoad`/`KeepAlive` enabled, and must not contain `--dev-origin`. The validation script is read-only. It does not install packages, start services, discover devices, or write to VibeTV hardware.

By default, local Companion checks use `127.0.0.1:47832`. If a test package was intentionally built with a different `VIBETV_COMPANION_ADDR`, run the readiness script with the same environment value so package metadata, `/v1/status`, and Private Network Access preflight checks all validate the same address.

## Support Checks

Check whether the API responds:

```bash
curl -fsS http://127.0.0.1:47832/v1/status
```

Create a redacted support report:

```bash
curl -fsS http://127.0.0.1:47832/v1/diagnostics
```

The support report is read-only. It includes Companion version, install-gate state, configured public device target, pairing presence, `/hello` status, `/health` status, board, firmware, and active theme when available. It must not include the pairing token or tokenized URLs.

In the hosted app, the Logs screen can copy the loaded support report or download it as `vibetv-support-report-<timestamp>.json`. The download path is useful when browser clipboard permission is blocked.

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

If discovery returns `multiple_devices_found`, do not guess. Ask the customer which VibeTV they want to control and use the exact target in the VibeTV target field.

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
- `GET /v1/diagnostics`
- `GET /v1/device`
- `POST /v1/device/discover`
- `GET /v1/settings`

Theme install writes remain locked unless `VIBETV_ENABLE_WIFI_THEME_INSTALL=1` is set for a prepared hardware test window. Browser installs send `skipFirmwareUpdate: true`, and the install path must not trigger firmware updates.

The app-side install preflight keeps the customer button locked until these checks pass:

- Companion is running.
- VibeTV is found and connected.
- VibeTV is paired.
- The selected Shopify theme is free.
- The selected theme has a technical `pack_url`.
- The selected theme `pack_url` is an `http(s)` download URL.
- Any declared `compatible_boards` include the detected VibeTV board.
- Any declared `requires_firmware` is less than or equal to the detected firmware version.
- The Companion reports `themeInstallEnabled`.

The Companion also enforces a server-side write preflight before delegating to the theme installer:

- Pairing token exists.
- `/hello` advertises ThemeSpec v1 support.
- `/health` is reachable.
- `VIBETV_ENABLE_WIFI_THEME_INSTALL=1` is enabled for the approved hardware test window.

Do not run device write tests, merge, or tag a release until the user has tested and explicitly approved the hardware flow.
