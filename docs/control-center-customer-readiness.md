# Control Center Customer Readiness

This document tracks the customer-facing hosted app flow for `https://app.vibetv.shop`.

## Current Architecture

`app.vibetv.shop` is the customer download entrypoint. It resolves the verified
DMG from the latest GitHub Release and does not contact the customer's local
Mac App or VibeTV:

```text
app.vibetv.shop
  -> verified VibeTV-Control-Center.dmg
  -> installed Mac App on 127.0.0.1:47832
  -> VibeTV on the customer's LAN
```

The native WebView and local Control Center own all local status, discovery,
pairing, settings, and display actions. Hosted setup therefore needs no browser
local-network permission.

## Customer Flow

1. Customer opens `https://app.vibetv.shop`.
2. The website shows one primary `Download Mac App` action only when the exact,
   non-empty DMG release asset is verified.
3. Customer opens the DMG, drags the app into Applications, and opens it.
4. A fresh native app shows the phone-based `VibeTV-Setup` and home-WiFi steps.
5. Before the customer confirms WiFi, the Control Center does not run device
   repair or pairing.
6. `VibeTV is on WiFi` runs one local discovery/repair check. An existing valid
   token is preserved; pairing happens only when missing or stale.
7. If exactly one VibeTV is found, the Mac App stores the address, starts the
   display stream, verifies the device response, and opens Overview.
8. If multiple VibeTV devices are found, the Mac App refuses to auto-pick one.
   The customer can enter the exact VibeTV address as a recovery step.
9. An already healthy installation opens Overview without onboarding writes.
10. Theme install writes stay locked until the hardware-safe release gate is enabled.

Existing customers do not repeat WiFi onboarding:

1. The v1.0.41 Update action installs the bridge binary and embedded UI once.
2. The bridge reports `installationMode=legacy` while disabling any further
   Terminal self-update.
3. Overview and Updates show `Move to the new Mac App` even when the bridge and
   DMG versions are identical.
4. The CTA appears only for the verified, feature-flagged DMG. Without it, the
   current Control Center keeps working and no installer runs.
5. The customer opens the DMG, moves the app into Applications, and opens it.
6. The native app keeps the existing VibeTV settings, accepts its new runtime
   only after health and port-ownership checks, archives the old app and user
   LaunchAgents, reloads the new local UI, and opens Overview.

## Legacy Operator Support Path

The customer UI does not expose Agentic or Terminal installation. Operators can
still use the legacy release shell installer to repair older installations:

```bash
curl -fsSL https://github.com/DreamyTalesPAN/CodexBar-Display/releases/latest/download/install-control-center-companion.sh | bash
```

That script performs these steps:

- downloads the matching `codexbar-display` macOS release binary,
- verifies the release SHA-256 checksum,
- installs the binary to `~/Library/Application Support/codexbar-display/bin/codexbar-display`,
- stops and removes the old standalone API LaunchAgent if it exists,
- disables an old global LaunchAgent for the current user if one is present,
- writes the normal `com.codexbar-display.daemon` LaunchAgent with `--api-addr 127.0.0.1:47832`,
- starts one Mac App background service for both VibeTV frames and Control Center,
- verifies `http://127.0.0.1:47832/v1/status`.

This is intentional for launch. Customers should have one Mac App process: the
Mac App background service sends display frames and answers the local Control Center API.

Support restart:

```bash
curl -fsSL https://github.com/DreamyTalesPAN/CodexBar-Display/releases/latest/download/install-control-center-companion.sh | bash -s -- --restart
```

Support uninstall:

```bash
curl -fsSL https://github.com/DreamyTalesPAN/CodexBar-Display/releases/latest/download/install-control-center-companion.sh | bash -s -- --uninstall
```

Uninstall stops the daemon LaunchAgent, removes old standalone API state if it exists, and keeps the installed binary on disk.

The repository-level development installer remains available:

```bash
./scripts/install-control-center-companion.sh
```

It performs these steps without downloading from GitHub Releases:

- builds `companion/cmd/codexbar-display`,
- installs the binary to `~/Library/Application Support/codexbar-display/bin/codexbar-display`,
- removes the old standalone API LaunchAgent plist if present,
- disables an old global LaunchAgent for the current user if present,
- writes and starts `com.codexbar-display.daemon` with `--api-addr 127.0.0.1:47832`,
- verifies `http://127.0.0.1:47832/v1/status`.

Optional local development origin:

```bash
VIBETV_COMPANION_DEV_ORIGIN=http://localhost:3002 ./scripts/install-control-center-companion.sh
```

The local API service is part of the frame-sending daemon. Existing customer
Macs may already have that daemon; the installer rewrites and restarts it so the
same process also answers Control Center.

## Existing Customer Update Bridge

Existing v1.0.41 customers already have a fixed latest-release call to
`install-control-center-companion.sh`. The first public DMG release therefore
publishes that bridge script, its matching Darwin binaries and checksums, and
the signed DMG together. The old binary uses its existing update endpoint once
to install the bridge. The new binary does not register that endpoint again.

The bridge preserves the existing device URL, pairing token, display daemon,
and current VibeTV behavior. Its new UI detects `installationMode=legacy`
independently of `updateAvailable`, so an equal-version DMG remains visible.
The CTA never calls `/v1/mac-app/update`; it opens only the verified DMG URL.

The hosted entry and local Updates screen check `/api/companion/latest`. The
route reads the latest GitHub Release and exposes the DMG URL only when the
feature flag is enabled and the exact asset is uploaded and non-empty.

`install-control-center-companion.sh` remains a legacy operator asset. Hosted
customer setup never exposes it.

Set `CONTROL_CENTER_GITHUB_TOKEN` in the hosted app environment when possible. The token is used only by the server-side release check and is not sent to the browser. The read-only customer-readiness script also uses `CONTROL_CENTER_GITHUB_TOKEN` or `GITHUB_TOKEN` for GitHub release reads when present. Without a token, GitHub release reads are anonymous and can hit rate limits.

Successful GitHub release reads are cached server-side for one minute. Failed release reads are not cached, so the customer-facing retry button can check again immediately.

The `/api/companion/latest` route returns version state and, only after the DMG
gate passes, the verified `VibeTV-Control-Center.dmg` URL. Its human-readable
`message` must use customer language and avoid release/package diagnostics.

The hosted `/` and `/install/<theme_id>` entries use the same download-only
state. Native setup begins only after the downloaded app opens.

The Overview and `/install/<theme_id>` setup path should not show release diagnostics, internal asset names, or multiple equal actions. Customers should see only the next action that can move setup forward.

The Updates screen is available only after setup is complete. It should expose update actions, not setup recovery actions.

After the customer opens the installed app, the local Control Center checks its
own bundled service and either opens Overview or shows WiFi onboarding.

When the Mac App is running but VibeTV is not found, native setup exposes a
`VibeTV address` recovery field and one `Fix connection` action. Customers or
support can enter the exact IP address there without leaving the
local flow. The hosted `/install/<theme_id>` entry remains download-only.

Manual customer targets are IP addresses. The Companion rejects unsupported schemes, invalid ports, paths, username/password credentials, query strings, or fragments so support reports do not collect tokenized URLs.

If an exact address does not answer, the app keeps the Mac App online and shows VibeTV as not found. That means the customer should correct the VibeTV address or WiFi state, not reinstall the Mac App.

If the Shopify theme catalog is empty or the requested `/install/<theme_id>` does not exist in the catalog, the app must show a locked catalog state. It must not fall back to demo/mock themes or silently select the first available theme for an unknown Shopify link.

The Updates screen labels Mac App actions plainly:

- `Download new Mac App` for a verified legacy-to-DMG migration, including an
  equal-version migration.
- `New Mac App not ready` when a legacy installation is detected but the exact
  signed asset cannot be verified.
- `Download Mac App update` when a newer verified DMG is available.
- `Mac App update not ready` when the exact signed asset cannot be verified.
- No Terminal installer or second app location is offered.

## Documentation Cleanup Backlog

The top-level README, customer setup guide, Control Center README, and this readiness doc now describe the current v1 path. The older operator/package docs still contain historical package and LaunchAgent material for development and later packaging work. Before public release, split that material into a legacy/later document or issue and write one clean public technical guide covering:

- dependencies: VibeTV hardware, CodexBar, the signed Mac App, and local WiFi,
- why CodexBar is installed or required,
- how usage data moves from CodexBar to the Mac App service to VibeTV,
- customer commands: install/update, status check, uninstall,
- support commands and flags: `--restart`, `--uninstall`, `--dev-origin`, `--version`, `--addr`, `--target`,
- what data is local, what reaches `app.vibetv.shop`, and what is sent to the device,
- update flow and failure-report flow.

The intended launch path is the hosted Control Center route:
`https://app.vibetv.shop/install/<theme_id>`. It offers the same verified DMG as
the root route. Native onboarding intentionally ends at Overview; theme choice
happens later in the local Theme Library. There is no customer Terminal
fallback. Before product pages point customers there, verify the signed DMG and
the native WiFi-to-Overview flow on a customer-like Mac.

## Customer Readiness Validation

Release order matters for this migration:

1. Build and publish the GitHub Release for the exact commit, including the
   bridge installer, Darwin binaries, checksums, and signed DMG in that same
   release.
2. Verify that release with `--release v<version>`.
3. Only then deploy or promote the hosted `app.vibetv.shop` setup launcher for
   that commit.

If the hosted download entry goes live before the matching GitHub Release, the
button can still point to an older Mac App that does not serve the new local
Control Center flow. In that case customers can get stuck after installation.

Final local gate before telling anyone this is customer-ready:

```bash
scripts/check-control-center-customer-ready-gate.sh
```

This gate is intentionally strict. It never merges, tags, releases, installs packages, starts services, discovers devices, or writes to VibeTV hardware. It only runs local checks and read-only hosted/release checks, then fails until the non-automated customer gates are also confirmed:

- latest or selected release exposes the verified Mac App DMG,
- DMG installation and native WiFi onboarding were validated on a customer-like Mac,
- the user explicitly approved and passed the hardware write flow.

Customer-like Mac evidence means the signed app was installed in Applications,
the local service answered `http://127.0.0.1:47832/v1/status`, WiFi verification
succeeded, and the Control Center opened Overview without manual code changes.

Hardware write evidence is recorded in `docs/control-center-hardware-test-evidence.md`.
The current PR has a user-approved WiFi theme install result there for the Control Center
write path, and further device writes still require fresh approval.

Use an exact tag when validating a specific release:

```bash
scripts/check-control-center-customer-ready-gate.sh --release v<version>
```

During normal feature-branch development before package release assets exist, use the automated non-release subset without claiming customer readiness:

```bash
scripts/check-control-center-customer-ready-gate.sh --automated-only --skip-release
```

After a candidate or public release exposes the Mac setup script and binary assets, remove `--skip-release` so the same automated gate also verifies release links.

Use the read-only validation script before asking a customer to use a release:

```bash
scripts/check-control-center-companion-customer-readiness.sh \
  --release v<version> \
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
scripts/test-install-sh-control-center-migration.sh
scripts/test-control-center-companion-legacy-installer.sh
```

The readiness checker test uses a fake `curl` binary through `CONTROL_CENTER_READINESS_CURL`, so it does not hit the hosted app, Shopify, local Mac App service, or VibeTV hardware. The release workflow test keeps the public GitHub Release package-free. The legacy `install.sh` migration test uses fake release downloads, fake CodexBar, fake `launchctl`, and a temporary `HOME`; it proves the old customer installer starts the local Control Center service without touching a real Mac install. The terminal installer test uses fake `launchctl`, `curl`, and a temporary `HOME`; it proves the shell installer removes the old user LaunchAgent path, disables old global LaunchAgent state for the current user, and starts the local service from the Terminal context.

What it checks:

- release may contain the older `install.sh` support script without exposing it through the customer API,
- release contains `install-control-center-companion.sh`,
- release contains both Darwin companion binaries,
- future DMG-first customer releases contain `VibeTV Control Center.app` in a
  `.dmg` with an Applications symlink and include that DMG in checksums,
- release contains `checksums-v<version>.txt`,
- release does not contain Mac App `.pkg` assets,
- hosted setup presents only the verified DMG Mac App path after rollout and
  keeps that action unavailable while the DMG gate is off or its asset is
  unavailable,
- the native Mac App enables its bundled persistent service before stopping and
  backing up old user LaunchAgents, while preserving
  `~/Library/Application Support/codexbar-display/config.json`,
- hosted app HTTP reachability,
- hosted app `/api/companion/latest` version status without installer or package URLs when `--app-url` is combined with `--release` or `--release-json`,
- optional hosted app `/api/themes` source, selected free theme readiness, concrete `/install/<theme_id>` route reachability, and all visible free theme readiness when `--expect-catalog-source`, `--expect-theme-id`, or `--expect-all-free-themes-installable` is provided.
- optional public Shopify product page readiness when `--expect-shopify-product-pages` or `--shopify-product-page <url> <theme_id>` is provided: validate that product pages point to the matching `https://app.vibetv.shop/install/<theme_id>` route and that the hosted app route remains reachable and setup-gated. `--expect-shopify-product-pages` reads `productUrl` from `/api/themes`, or derives it from `handle` plus `--shopify-store-url` while deployments are rolling forward, and checks every free Shopify catalog item.

Use `--expect-catalog-source shopify` for the production customer app. Use `--expect-theme-id <theme_id>` for at least one public free Shopify theme before linking customers to product pages. That selected theme check requests `/install/<theme_id>` to prove the hosted app route exists. Add `--expect-all-free-themes-installable` before a collection-wide rollout. Those checks fail if a required theme is missing, paid, missing `themeId`, has no resolved `packUrl`, exposes a `packUrl` that is not an `http(s)` download URL, or if any free theme's `/install/<theme_id>` route is not reachable.

After installing on a clean Mac, run:

```bash
scripts/check-control-center-companion-customer-readiness.sh \
  --local-companion \
  --expect-version <version>
```

The clean-Mac check verifies local Companion `/v1/status` and the hosted-app Private Network Access preflight. The validation script is read-only. It does not install apps, start services, discover devices, or write to VibeTV hardware.

By default, local Companion checks use `127.0.0.1:47832`. If setup was intentionally run with a different `VIBETV_COMPANION_ADDR`, run the readiness script with the same environment value so `/v1/status` and Private Network Access preflight checks validate the same address.

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
launchctl print gui/$(id -u)/com.codexbar-display.daemon
```

Logs:

```text
/tmp/codexbar-display-daemon.out.log
/tmp/codexbar-display-daemon.err.log
```

Restart service:

```bash
launchctl kickstart -k gui/$(id -u)/com.codexbar-display.daemon
```

Unload service:

```bash
launchctl bootout gui/$(id -u)/com.codexbar-display.daemon
```

## Release Gate

Read-only checks are allowed:

- `GET /v1/status`
- `GET /v1/diagnostics`
- `GET /v1/device`
- `POST /v1/device/discover`
- `GET /v1/settings`

The Mac App service enables Theme Library installs by default after VibeTV is connected and paired. Local development and ad-hoc Companion runs can opt into read-only mode with `VIBETV_DISABLE_WIFI_THEME_INSTALL=1`. Browser installs send `skipFirmwareUpdate: true`, and the install path must not trigger firmware updates.

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
- Theme install has not been explicitly disabled with `VIBETV_DISABLE_WIFI_THEME_INSTALL=1`.

Do not run device write tests, merge, or tag a release until the user has tested and explicitly approved the hardware flow.
