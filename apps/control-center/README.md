# VibeTV Control Center

Hosted MVP for `https://app.vibetv.shop`.

## Local Development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

The local Companion API must run on `127.0.0.1:47832` for real device actions:

```bash
cd ../../companion
go run ./cmd/codexbar-display api
```

If the app runs on another local port, start the Companion with a matching dev origin, for example:

```bash
go run ./cmd/codexbar-display api --dev-origin http://localhost:3002
```

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
```

Use either `SHOPIFY_STOREFRONT_PRIVATE_TOKEN` for a Headless private token or `SHOPIFY_STOREFRONT_ACCESS_TOKEN` for a public token. If Shopify env vars are missing, the app shows a configuration warning and no installable themes. Set `CONTROL_CENTER_ALLOW_CATALOG_FALLBACK=1` only for explicit local development with repo catalog data.

## Flow

- `/` shows the theme library, Companion state, VibeTV state, install action and brightness.
- `/install/[themeId]` opens the same app with a theme preselected.
- Browser talks directly to `http://127.0.0.1:47832`.
- The server reads Shopify product data through the Storefront API and only sends normalized public theme data to the browser.

No paid theme entitlement logic is included in this MVP.
