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

The local Mac App service responds to Chrome Private Network Access preflights from the allowed hosted origin. Allowed preflights include `Access-Control-Allow-Private-Network: true`; unknown origins remain blocked.

## Customer Flow

1. Customer opens `https://app.vibetv.shop`.
2. App checks the local Mac App service at `127.0.0.1:47832`.
3. If the Mac App is missing, the app shows one primary Mac App install/repair action.
4. Customer installs or starts the Mac App.
5. The Mac App service runs from the Agentic Terminal setup context.
6. App searches for VibeTV on the same WiFi/LAN.
7. If exactly one VibeTV is found, the Mac App stores that address for later checks.
8. If multiple VibeTV devices are found, the Mac App refuses to auto-pick one. The customer must enter the exact VibeTV address, for example `vibetv.local` or `192.168.178.163`, then use `Connect VibeTV` again. A manually entered address is strict: if that exact VibeTV does not answer, the Mac App reports a device error instead of falling back to another discovered VibeTV.
9. App can read Mac App status, VibeTV status, firmware, active theme, and settings.
10. Theme install writes stay locked until the hardware-safe release gate is enabled.

## Agentic Terminal Path

The current v1 setup does not depend on a packaged macOS installer. The Setup tab gives the customer an Agentic setup prompt and a manual Terminal fallback. Both use the release shell installer:

```bash
curl -fsSL https://github.com/DreamyTalesPAN/CodexBar-Display/releases/latest/download/install-control-center-companion.sh | bash -s -- --terminal-session
```

That script performs these steps:

- downloads the matching `codexbar-display` macOS release binary,
- verifies the release SHA-256 checksum,
- installs the binary to `~/Library/Application Support/codexbar-display/bin/codexbar-display`,
- stops and removes the old user LaunchAgent for this API service if it exists,
- disables an old global LaunchAgent for the current user if one is present,
- refreshes the older display-stream LaunchAgent if it exists, so existing customers do not keep sending frames from an old binary,
- starts `codexbar-display api --addr 127.0.0.1:47832` in the background from the Terminal session,
- stores the started process id in `~/Library/Application Support/codexbar-display/run/companion-api.pid`,
- verifies `http://127.0.0.1:47832/v1/status`.

This is intentional for v1. In hardware testing, the Terminal-started process could reach the customer's LAN/VibeTV, while the same ad-hoc binary launched by the user LaunchAgent could get stuck in a macOS local-network permission state. So the normal customer path starts from the agent/Terminal context, removes the stale user LaunchAgent, and disables stale global LaunchAgent entries for the current user instead of recreating them.

Support restart:

```bash
curl -fsSL https://github.com/DreamyTalesPAN/CodexBar-Display/releases/latest/download/install-control-center-companion.sh | bash -s -- --restart --terminal-session
```

Support uninstall:

```bash
curl -fsSL https://github.com/DreamyTalesPAN/CodexBar-Display/releases/latest/download/install-control-center-companion.sh | bash -s -- --uninstall
```

Uninstall stops the PID-file process, removes the old user LaunchAgent plist if it exists, and disables any old global LaunchAgent for the current user.

The repository-level development installer remains available:

```bash
./scripts/install-control-center-companion.sh
```

It performs these steps without downloading from GitHub Releases:

- builds `companion/cmd/codexbar-display`,
- installs the binary to `~/Library/Application Support/codexbar-display/bin/codexbar-display`,
- removes the old user LaunchAgent plist if present,
- disables an old global LaunchAgent for the current user if present,
- starts `codexbar-display api --addr 127.0.0.1:47832` in the background from Terminal,
- verifies `http://127.0.0.1:47832/v1/status`.

Optional local development origin:

```bash
VIBETV_COMPANION_DEV_ORIGIN=http://localhost:3002 ./scripts/install-control-center-companion.sh
```

The local API service is separate from the older frame-sending daemon LaunchAgent. Existing customer Macs may still have that daemon. The release installer refreshes it once after installing the new binary, so the old display stream picks up the new `codexbar-display` binary instead of continuing with the previous build.

The Control Center Updates screen checks `/api/companion/latest`. That route still reads the latest GitHub Release for version information, but the v1 setup path uses the Agentic prompt and Terminal command above.

The `install-control-center-companion.sh` asset is part of the hosted customer setup. The app exposes it through the Agentic prompt rather than as a raw download button.

Set `CONTROL_CENTER_GITHUB_TOKEN` in the hosted app environment when possible. The token is used only by the server-side release check and is not sent to the browser. The read-only customer-readiness script also uses `CONTROL_CENTER_GITHUB_TOKEN` or `GITHUB_TOKEN` for GitHub release reads when present. Without a token, GitHub release reads are anonymous and can hit rate limits.

Successful GitHub release reads are cached server-side for one minute. Failed release reads are not cached, so the customer-facing retry button can check again immediately.

The `/api/companion/latest` route returns version state only. It must not expose macOS package download URLs in the v1 customer flow. Its human-readable `message` must use customer language and avoid release/package diagnostics.

The Overview and `/install/<theme_id>` entry use the same setup state when the Mac App is missing, so a new customer does not have to discover the Updates tab first. That setup state has one primary action: install or repair the Mac App through setup.

The Overview and `/install/<theme_id>` setup path should not show release diagnostics, internal asset names, or multiple equal actions. Customers should see only the next action that can move setup forward.

After the Agentic setup or manual Terminal command starts the Mac App service, the app checks quietly and moves forward when the Mac App becomes available.

The Updates screen is available only after setup is complete. It should expose update actions, not setup recovery actions.

While the page is open in the missing-Mac-App state, it quietly checks the Mac App again. After the customer installs or starts the Mac App, the UI should move forward without requiring a manual refresh.

When the Mac App is running but VibeTV is not found, the Overview screen and the `/install/<theme_id>` entry expose a `VibeTV address` field and one `Connect VibeTV` action. Customers or support can enter the exact `vibetv.local`/IP address there and connect without leaving the current flow.

Manual targets may be `vibetv.local`, an IP address, or an `http(s)` URL with a host and optional valid port. The Companion rejects explicit targets with unsupported schemes, invalid ports, paths, username/password credentials, query strings, or fragments so support reports do not collect tokenized URLs.

If an exact address does not answer, the app keeps the Mac App online and shows VibeTV as not found. That means the customer should correct the VibeTV address or WiFi state, not reinstall the Mac App.

If the Shopify theme catalog is empty or the requested `/install/<theme_id>` does not exist in the catalog, the app must show a locked catalog state. It must not fall back to demo/mock themes or silently select the first available theme for an unknown Shopify link.

The Updates screen labels Mac App actions plainly:

- `Copy install command` when the Mac App is not running yet.
- `Copy update command` when the installed Mac App version is behind the latest release.
- `Copy repair command` only if the Mac App needs a clean restart path.

## Documentation Cleanup Backlog

The top-level README, customer setup guide, Control Center README, and this readiness doc now describe the current v1 path. The older operator/package docs still contain historical package and LaunchAgent material for development and later packaging work. Before public release, split that material into a legacy/later document or issue and write one clean public technical guide covering:

- dependencies: VibeTV hardware, CodexBar, `codexbar-display`, Chrome local-network permission,
- why CodexBar is installed or required,
- how usage data moves from CodexBar to the Mac App service to VibeTV,
- customer commands: install/update, status check, uninstall,
- support commands and flags: `--terminal-session`, `--restart`, `--uninstall`, `--dev-origin`, `--version`, `--addr`,
- what data is local, what reaches `app.vibetv.shop`, and what is sent to the device,
- update flow and failure-report flow.

The intended launch path is the hosted Control Center route:
`https://app.vibetv.shop/install/<theme_id>`. Shopify theme products may still
show the direct Terminal install command during staged rollout or rollback, but
that is a fallback path. Before product pages point customers into Control
Center, verify that the Agentic setup path works end to end on a customer-like
Mac and that `/install/<theme_id>` preserves setup gating.

## Customer Readiness Validation

Final local gate before telling anyone this is customer-ready:

```bash
scripts/check-control-center-customer-ready-gate.sh
```

This gate is intentionally strict. It never merges, tags, releases, installs packages, starts services, discovers devices, or writes to VibeTV hardware. It only runs local checks and read-only hosted/release checks, then fails until the non-automated customer gates are also confirmed:

- latest or selected release exposes the Mac setup assets needed by the Agentic setup prompt,
- Agentic setup was validated on a customer-like Mac,
- the user explicitly approved and passed the hardware write flow.

Customer-like Mac evidence means the setup prompt was run from a realistic agent/Terminal context, the local service answered `http://127.0.0.1:47832/v1/status`, and the Control Center moved forward without manual code changes.

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
scripts/test-control-center-companion-legacy-installer.sh
```

The readiness checker test uses a fake `curl` binary through `CONTROL_CENTER_READINESS_CURL`, so it does not hit the hosted app, Shopify, local Mac App service, or VibeTV hardware. The release workflow test keeps the public GitHub Release package-free. The terminal installer test uses fake `launchctl`, `curl`, and a temporary `HOME`; it proves the shell installer removes the old user LaunchAgent path, disables old global LaunchAgent state for the current user, and starts the local service from the Terminal context.

What it checks:

- release may contain the older `install.sh` support script without exposing it through the customer API,
- release contains `install-control-center-companion.sh`,
- release contains both Darwin companion binaries,
- release contains `checksums-v<version>.txt`,
- release does not contain Mac App `.pkg` assets,
- hosted app HTTP reachability,
- hosted app `/api/companion/latest` version status without installer or package URLs when `--app-url` is combined with `--release` or `--release-json`,
- optional hosted app `/api/themes` source, selected free theme readiness, concrete `/install/<theme_id>` route reachability, and all visible free theme readiness when `--expect-catalog-source`, `--expect-theme-id`, or `--expect-all-free-themes-installable` is provided.
- optional public Shopify product page readiness when `--expect-shopify-product-pages` or `--shopify-product-page <url> <theme_id>` is provided: during staged rollout, each checked product page must show `Copy install command` and the direct command `codexbar-display theme-pack install --theme <theme_id> --target http://vibetv.local`. During Control Center cutover, validate that product pages point to the matching `https://app.vibetv.shop/install/<theme_id>` route and that the hosted app route remains reachable and setup-gated. `--expect-shopify-product-pages` reads `productUrl` from `/api/themes`, or derives it from `handle` plus `--shopify-store-url` while deployments are rolling forward, and checks every free Shopify catalog item.

Use `--expect-catalog-source shopify` for the production customer app. Use `--expect-theme-id <theme_id>` for at least one public free Shopify theme before linking customers to product pages. That selected theme check requests `/install/<theme_id>` to prove the hosted app route exists. Add `--expect-all-free-themes-installable` before a collection-wide rollout. Those checks fail if a required theme is missing, paid, missing `themeId`, has no resolved `packUrl`, exposes a `packUrl` that is not an `http(s)` download URL, or if any free theme's `/install/<theme_id>` route is not reachable.

After installing on a clean Mac, run:

```bash
scripts/check-control-center-companion-customer-readiness.sh \
  --local-companion \
  --expect-version <version>
```

The clean-Mac check verifies local Companion `/v1/status` and the hosted-app Private Network Access preflight. The validation script is read-only. It does not install apps, start services, discover devices, or write to VibeTV hardware.

By default, local Companion checks use `127.0.0.1:47832`. If the Terminal setup was intentionally run with a different `VIBETV_COMPANION_ADDR`, run the readiness script with the same environment value so `/v1/status` and Private Network Access preflight checks validate the same address.

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
