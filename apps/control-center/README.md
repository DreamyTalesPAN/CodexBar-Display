# VibeTV Control Center

Hosted MVP for `https://app.vibetv.shop`.

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

The local Companion API must run on `127.0.0.1:47832` for real device actions:

```bash
cd ../../companion
go run ./cmd/codexbar-display api
```

If the app runs on another local port, start the Companion with a matching dev origin, for example:

```bash
go run ./cmd/codexbar-display api --dev-origin http://localhost:3002
```

For the hosted customer flow, use the macOS Companion API LaunchAgent installer from
the repository root:

```bash
./scripts/install-control-center-companion.sh
```

That starts the local API in the background, so the web app no longer depends on a
Terminal window staying open. The older frame-sending daemon LaunchAgent is separate.
See `docs/control-center-customer-readiness.md` for the support flow.

## Device Write Guardrails

The Control Center must not trigger firmware updates from the theme install flow. Browser installs send `skipFirmwareUpdate: true`; firmware update belongs to a separate explicit update flow.

The local Companion API currently blocks WiFi theme installs by default because ESP8266 asset uploads can destabilize the attached test device. Enable install only during a prepared hardware test window:

```bash
VIBETV_ENABLE_WIFI_THEME_INSTALL=1 go run ./cmd/codexbar-display api --dev-origin http://localhost:3002
```

Do not enable this for routine UI checks. Use read-only Companion calls and mocked/unit tests first.

## Environment

Copy `.env.example` to `.env.local` and set the Storefront token.

```bash
SHOPIFY_STORE_DOMAIN=vibetv.shop
SHOPIFY_STOREFRONT_ACCESS_TOKEN=...
SHOPIFY_STOREFRONT_PRIVATE_TOKEN=...
SHOPIFY_STOREFRONT_API_VERSION=2026-04
SHOPIFY_THEME_COLLECTION_HANDLE=themes-2
CONTROL_CENTER_GITHUB_TOKEN=...
```

Use either `SHOPIFY_STOREFRONT_PRIVATE_TOKEN` for a Headless private token or `SHOPIFY_STOREFRONT_ACCESS_TOKEN` for a public token. `CONTROL_CENTER_GITHUB_TOKEN` is optional, server-side only, and keeps GitHub release checks for Companion installer assets away from anonymous rate limits. If Shopify env vars are missing, the app shows a configuration warning and no installable themes. Set `CONTROL_CENTER_ALLOW_CATALOG_FALLBACK=1` only for explicit local development with repo catalog data.

## Flow

- `/` opens the Control Center overview with Companion, VibeTV and update state.
- `/install/[themeId]` opens the same app with a theme preselected.
- Browser talks directly to `http://127.0.0.1:47832`.
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

No paid theme entitlement logic is included in this MVP.
