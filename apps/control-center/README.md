# VibeTV Control Center

Hosted setup app and local Mac App Control Center for VibeTV.

## Local Development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

Run the customer-flow browser test without live Shopify, Companion, or VibeTV access:

```bash
npm run test:customer-flows
```

The test builds the app with a local catalog fixture, starts `next start` on a free localhost port, mocks Companion browser calls, and checks the critical `/install/[themeId]` flows.

For small copy-only changes, do not run the full browser suite by default. Use the smallest check that matches the risk:

```bash
npm run check:customer-ui-copy
git diff --check
```

If the copy change touches setup state, theme selection, or update status and needs a quick browser check, run the smoke path instead of the full flow suite:

```bash
npm run test:customer-smoke
```

Run `npm run test:customer-flows` for state changes, navigation/action changes, API behavior changes, or before claiming merge readiness.

For Theme Studio changes, the focused safety flow checks the local render-pack
path, the Companion ZIP install route, the absence of direct VibeTV writes, and
the disabled AI surface:

```bash
npm run test:theme-studio-safety
```

Build the static Control Center bundle that gets embedded into the Mac App release binary:

```bash
npm run build:local
```

That command writes `out-local/`. The release workflow copies those files into
`companion/internal/companionapi/controlcenter_static/` before building the
macOS Companion binary. The local Mac App then serves the customer app at
`http://127.0.0.1:47832/control-center` and keeps private device/usage actions
on the local `/v1/*` API.

Before claiming the Control Center is customer-ready, run the repository-level gate:

```bash
../../scripts/check-control-center-customer-ready-gate.sh
```

That command is no-write: it does not merge, release, install packages, start services, discover devices, or touch VibeTV hardware. During normal feature-branch development before package release assets exist, run the automated non-release subset:

```bash
../../scripts/check-control-center-customer-ready-gate.sh --automated-only --skip-release
```

For the current customer setup path, `app.vibetv.shop` offers only the verified
DMG. The installed Mac App owns WiFi onboarding and opens Overview after it
verifies VibeTV.

The local Mac App service must run on `127.0.0.1:47832` for real device actions:

```bash
cd ../../companion
go run ./cmd/codexbar-display api
```

If the app runs on another local port, start the local service with a matching dev origin, for example:

```bash
go run ./cmd/codexbar-display api --dev-origin http://localhost:3002
```

For local development, install the Mac App service from the repository root:

```bash
./scripts/install-control-center-companion.sh
```

That starts the normal VibeTV Mac App background service with the local Control
Center API built in. It is a development/support path and is not shown in the
customer setup UI. See
[`docs/control-center-customer-readiness.md`](../../docs/control-center-customer-readiness.md)
for the support flow.

The legacy operator command is:

```bash
curl -fsSL https://app.vibetv.shop/install-control-center-companion.sh | bash
```

This command remains an operator support tool for existing installations. See
`../../docs/macos-dmg-distribution.md` for the signed/notarized
`VibeTV Control Center.app` release flow.

Hosted setup shows only the verified DMG download. If the flag is off or the
asset is missing, the download stays unavailable; customer setup never falls
back to the old Agentic/Terminal installer that could create a second app under
`~/Applications`. After opening the installed app, native onboarding owns WiFi
instructions, device verification, pairing when required, and the automatic
handoff to Overview. The native app first enables its bundled, persistent local
service.
It then backs up old user LaunchAgent plists under
`~/Library/Application Support/codexbar-display/migration-backups/`. The
app-owned service runs the display daemon and local API after the window quits
and across future logins.

## Device Write Guardrails

The Control Center must not trigger firmware updates from the theme install flow. Browser installs send `skipFirmwareUpdate: true`; firmware update belongs to a separate explicit update flow.

Theme install is available by default after the Mac App is online and VibeTV is paired. For read-only demos or diagnostics, disable it locally:

```bash
VIBETV_DISABLE_WIFI_THEME_INSTALL=1 go run ./cmd/codexbar-display api --dev-origin http://localhost:3002
```

Use read-only Companion calls and mocked/unit tests before installing themes on shared hardware.

Theme Studio is part of the local Control Center. Opening it, editing a draft,
validating, and exporting a ZIP must not write to hardware. The **Send to
VibeTV** button is the explicit write action: it uploads loaded assets, uploads
the current Theme JSON, activates it, and sends one live frame. Test that path
with mocked device requests unless the current chat has approved the exact live
hardware write.

## Environment

Copy `.env.example` to `.env.local` and set the Storefront token.

```bash
SHOPIFY_STORE_DOMAIN=vibetv.shop
SHOPIFY_STOREFRONT_ACCESS_TOKEN=...
SHOPIFY_STOREFRONT_PRIVATE_TOKEN=...
SHOPIFY_STOREFRONT_API_VERSION=2026-04
SHOPIFY_THEME_COLLECTION_HANDLE=themes-2
CONTROL_CENTER_GITHUB_TOKEN=...
CONTROL_CENTER_ENABLE_MAC_APP_DMG_DOWNLOAD=0
```

Use either `SHOPIFY_STOREFRONT_PRIVATE_TOKEN` for a Headless private token or `SHOPIFY_STOREFRONT_ACCESS_TOKEN` for a public token. `CONTROL_CENTER_GITHUB_TOKEN` is optional, server-side only, and keeps GitHub release version checks away from anonymous rate limits. If Shopify env vars are missing, the app shows a configuration warning and no installable themes. Set `CONTROL_CENTER_ALLOW_CATALOG_FALLBACK=1` only for explicit local development with repo catalog data.

Keep `CONTROL_CENTER_ENABLE_MAC_APP_DMG_DOWNLOAD=0` until the latest GitHub
release contains a signed, notarized, non-empty
`VibeTV-Control-Center.dmg` asset. Setting it to `1` only allows the hosted
release check to expose the exact uploaded asset URL; the Setup and Updates
screens still stay link-free if that asset is missing or invalid. The embedded
local UI reads the same result from the absolute hosted endpoint, so it never
falls back to an unchecked `/latest/download/...` URL.

## Flow

- On HTTPS hosted origins, `/` offers the verified Mac App DMG download and no
  device setup.
- On HTTPS hosted origins, `/install/[themeId]` offers the same Mac App download;
  native onboarding still ends at Overview, and theme choice happens later in
  the local Theme Library.
- On the local Mac App origin, `/control-center` opens the full Control Center
  and starts WiFi onboarding only when no usable VibeTV connection exists.
- After local discovery and verification succeed, the installed app opens
  Overview directly; existing healthy installations open Overview immediately.
- The server reads Shopify product data through the Storefront API and only sends normalized public theme data to the browser.

Validate the hosted customer catalog before rollout:

```bash
../../scripts/check-control-center-companion-customer-readiness.sh \
  --app-url https://app.vibetv.shop \
  --expect-catalog-source shopify \
  --expect-theme-id <theme_id> \
  --expect-all-free-themes-installable \
  --expect-shopify-product-pages
```

Paid theme entitlement logic is not part of the first customer flow.
