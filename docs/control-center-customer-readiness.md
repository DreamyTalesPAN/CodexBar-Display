# Control Center Customer Readiness

This document tracks the customer-facing hosted app flow for `https://app.vibetv.shop`.

## Current Architecture

`app.vibetv.shop` is the customer UI. It runs in the browser and talks to the local Mac App service on the customer's computer:

```text
app.vibetv.shop
  -> http://127.0.0.1:47832/v1/status
  -> local Mac App service
  -> VibeTV on the customer's LAN
```

The browser permission prompt only allows the website to contact local services. It does not install, start, or repair the Mac App.

The local Companion responds to Chrome Private Network Access preflights from the allowed hosted origin. Allowed preflights include `Access-Control-Allow-Private-Network: true`; unknown origins remain blocked.

## Customer Flow

1. Customer opens `https://app.vibetv.shop`.
2. App checks the local Mac App service at `127.0.0.1:47832`.
3. If the Mac App is missing, the app shows one primary Mac App install/repair action.
4. Customer installs or starts the Mac App.
5. The Mac App runs as a macOS LaunchAgent and survives login/reboot.
6. App searches for VibeTV on the same WiFi/LAN.
7. If exactly one VibeTV is found, the Mac App stores that address for later checks.
8. If multiple VibeTV devices are found, the Mac App refuses to auto-pick one. The customer must enter the exact VibeTV address, for example `vibetv.local` or `192.168.178.163`, then use `Connect VibeTV` again. A manually entered address is strict: if that exact VibeTV does not answer, the Mac App reports a device error instead of falling back to another discovered VibeTV.
9. App can read Mac App status, VibeTV status, firmware, active theme, and settings.
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

The release workflow now fails before creating customer release assets unless the package signing and notarization secrets are configured. With secrets configured, the `build-companion-pkgs` release job imports the Developer ID Installer certificate into a temporary keychain, signs the packages, stores a notarytool profile, submits each package for notarization, staples the result, validates both packages again with signature and notarization checks, and uploads the validated `.pkg` files as an internal workflow artifact. The `build-and-release` job waits for that artifact, downloads it, builds release checksums after the `.pkg` files are present, and only then creates the public GitHub Release with the Companion packages included.

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

Before tagging a release, use the manual GitHub Actions workflow `Control Center Customer Package Candidate` to build signed and notarized Mac App package candidates. The workflow file must already exist on the default branch before GitHub can dispatch it. After this PR lands on `main`, but before creating a release tag, run it against the release candidate branch or `main`:

```bash
gh workflow run control-center-customer-pkg-candidate.yml \
  --ref <branch> \
  -f version=<version>
```

Use the planned release version, for example `1.0.32`. The workflow uploads the `.pkg` files and `checksums-v<version>.txt` as a private Actions artifact for Clean-Mac validation, keeps repository permissions read-only, and does not create or update a GitHub Release. Download the `vibetv-mac-app-pkgs-v<version>` artifact from the run, verify the package checksum, install the matching package on a clean Mac, then run the installed-package readiness check from this repo:

```bash
scripts/check-control-center-companion-customer-readiness.sh \
  --installed-package \
  --local-companion \
  --expect-version <version>
```

Only after that check passes can the customer-ready gate be run with `--clean-mac-tested`. The normal release workflow must still build and publish the final package assets for the release tag.

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

The legacy `install-control-center-companion.sh` asset is optional for support. The hosted customer API does not expose it as an install action; when both package assets exist without the script, the customer package path is still ready.

Set `CONTROL_CENTER_GITHUB_TOKEN` in the hosted app environment when possible. The token is used only by the server-side release check and is not sent to the browser. The read-only customer-readiness script also uses `CONTROL_CENTER_GITHUB_TOKEN` or `GITHUB_TOKEN` for GitHub release reads when present. Without a token, GitHub release reads are anonymous and can hit rate limits.

Successful GitHub release reads are cached server-side for one minute. Failed release reads are not cached, so the customer-facing retry button can check again immediately.

The `/api/companion/latest` route may keep technical field names and asset filenames for compatibility, but its human-readable `message` must use customer language such as `Mac App installer is not ready yet.` It must not expose `Companion`, release/package diagnostics, or customer installer internals.

Package links must exactly match the latest release tag version. If the latest release is `v1.0.32`, the app only exposes package download buttons when both `VibeTV-Companion-API-arm64-v1.0.32.pkg` and `VibeTV-Companion-API-amd64-v1.0.32.pkg` exist. Older, mismatched, or partial package assets stay hidden.

The app prefers the macOS package links when present. When both Apple silicon and Intel `.pkg` assets exist, customer-facing download actions show the package buttons and do not offer the shell script next to them. Because the release workflow only uploads `.pkg` release assets after signing and notarization validation, package buttons should not appear for unsigned local build artifacts. Until the first release with those assets exists, the app shows the installer as unavailable instead of linking customers to a missing file.

If only the shell script asset is available, setup screens must not present it as the normal customer installer. The primary setup state stays passive, such as `Installer is not ready yet.` Normal customer onboarding uses only the signed and notarized macOS package buttons.

When the browser can detect the Mac architecture, the matching package is shown first and marked `This Mac`. If detection is unavailable, both Apple silicon and Intel packages remain visible without marking both as the primary recommendation.

The Overview screen and the `/install/<theme_id>` entry use the same release check when the Mac App is missing, so a new customer does not have to discover the Updates tab first. That setup state has one primary action: install or repair the Mac App. If the Mac App is already installed but the app still cannot reach it, the package download is also the repair path.

The Overview and `/install/<theme_id>` setup path should not show release diagnostics, internal asset names, or multiple equal actions. Customers should see only the next action that can move setup forward.

After a customer clicks any Mac App download action, the app shows the immediate next step in place: open the downloaded installer, finish the install/update/repair, then return to the same page. The page keeps checking the Mac App and moves forward when it becomes available.

The Updates screen is available only after setup is complete. It should expose update actions, not setup recovery actions.

While the page is open in the missing-Mac-App state, it quietly checks the Mac App again. After the customer installs or starts the Mac App, the UI should move forward without requiring a manual refresh.

When the Mac App is running but VibeTV is not found, the Overview screen and the `/install/<theme_id>` entry expose a `VibeTV address` field and one `Connect VibeTV` action. Customers or support can enter the exact `vibetv.local`/IP address there and connect without leaving the current flow.

Manual targets may be `vibetv.local`, an IP address, or an `http(s)` URL with a host and optional valid port. The Companion rejects explicit targets with unsupported schemes, invalid ports, paths, username/password credentials, query strings, or fragments so support reports do not collect tokenized URLs.

If an exact address does not answer, the app keeps the Mac App online and shows VibeTV as not found. That means the customer should correct the VibeTV address or WiFi state, not reinstall the Mac App.

If the Shopify theme catalog is empty or the requested `/install/<theme_id>` does not exist in the catalog, the app must show a locked catalog state. It must not fall back to demo/mock themes or silently select the first available theme for an unknown Shopify link.

The Updates screen labels the same package actions by state:

- `Install` when the Mac App is not running yet.
- `Update` when the installed Mac App version is behind the latest release.
- `Repair` when the Mac App is already current but should be reinstalled or restarted cleanly.

The public VibeTV Shopify theme products now link to this hosted readiness flow instead of copying a terminal install command. As of 2026-06-19, the Shopify products `synthwave-theme`, `clippy-theme`, and `claude-creature-theme` link to technical Control Center theme IDs `synthwave`, `clippy`, and `claude-creature`, and no longer expose a terminal theme-pack install command as customer-facing copy.

## Customer Readiness Validation

Final local gate before telling anyone this is customer-ready:

```bash
scripts/check-control-center-customer-ready-gate.sh
```

This gate is intentionally strict. It never merges, tags, releases, installs packages, starts services, discovers devices, or writes to VibeTV hardware. It only runs local checks and read-only hosted/release checks, then fails until the non-automated customer gates are also confirmed:

- latest or selected release exposes both signed macOS Companion package assets through the hosted app,
- signed package was validated on a clean Mac,
- the user explicitly approved and passed the hardware write flow.

Clean-Mac evidence comes from the candidate package workflow above plus the installed-package readiness check. Do not pass `--clean-mac-tested` only because the workflow produced an artifact; the package has to be installed and verified on a clean Mac first.

On macOS, the local gate also builds temporary unsigned Companion packages and validates their metadata, payload, scripts, and binary architecture without installing them. On non-macOS systems, that smoke step is skipped and the dedicated `companion-pkg-smoke` CI job covers it on macOS.

Use an exact tag when validating a specific release:

```bash
scripts/check-control-center-customer-ready-gate.sh --release v<version>
```

During normal development, use the automated subset without claiming customer readiness:

```bash
scripts/check-control-center-customer-ready-gate.sh --automated-only
```

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
scripts/test-control-center-release-workflow.sh
scripts/test-control-center-candidate-pkg-workflow.sh
scripts/test-control-center-companion-legacy-installer.sh
```

The readiness checker test uses a fake `curl` binary through `CONTROL_CENTER_READINESS_CURL`, so it does not hit the hosted app, Shopify, local Companion, or VibeTV hardware. The release workflow test proves the public GitHub Release cannot be created before signed/notarized Companion PKGs are validated, downloaded into the release job, and included in the release checksums. The candidate workflow test proves the pre-release Clean-Mac package path stays manual, read-only, non-release, signed/notarized, and artifact-only. The legacy installer guard test uses fake `pkgutil`, `launchctl`, and `curl` with a temporary `HOME`; it proves the shell installer refuses to touch the old user LaunchAgent after a package receipt exists unless support explicitly passes `--force-legacy-script`.

Keep the macOS package builder covered with:

```bash
scripts/test-control-center-companion-pkg-build.sh
```

That smoke test runs on macOS, builds temporary unsigned `arm64` and `amd64` Companion packages, then validates both packages with the same read-only readiness checker. It does not install packages, start services, discover devices, or write to VibeTV hardware.

What it checks:

- release may contain the legacy support script without exposing it through the customer API,
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

The support report is read-only. It includes Companion version, install-gate state, configured VibeTV address, pairing presence, `/hello` status, `/health` status, board, firmware, and active theme when available. It must not include the pairing token or tokenized URLs.

In the hosted app, the Logs screen can copy the loaded support report or download it as `vibetv-support-report-<timestamp>.json`. The download path is useful when browser clipboard permission is blocked.

Run a read-only discovery:

```bash
curl -fsS -X POST http://127.0.0.1:47832/v1/device/discover \
  -H 'Content-Type: application/json' \
  -d '{}'
```

Run discovery against an exact VibeTV address:

```bash
curl -fsS -X POST http://127.0.0.1:47832/v1/device/discover \
  -H 'Content-Type: application/json' \
  -d '{"target":"http://192.168.178.163"}'
```

If discovery returns `multiple_devices_found`, do not guess. Ask the customer which VibeTV they want to control and use the exact VibeTV address in the app.

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
