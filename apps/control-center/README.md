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

## Environment

Copy `.env.example` to `.env.local` and set the Storefront token.

```bash
SHOPIFY_STORE_DOMAIN=vibetv.shop
SHOPIFY_STOREFRONT_ACCESS_TOKEN=...
SHOPIFY_STOREFRONT_API_VERSION=2026-04
SHOPIFY_THEME_COLLECTION_HANDLE=themes-2
```

If Shopify env vars are missing, the app falls back to the GitHub theme-pack catalog so the Companion flow can still be reviewed.

## Flow

- `/` shows the theme library, Companion state, VibeTV state, install action and brightness.
- `/install/[themeId]` opens the same app with a theme preselected.
- Browser talks directly to `http://127.0.0.1:47832`.
- The server reads Shopify product data through the Storefront API and only sends normalized public theme data to the browser.

No paid theme entitlement logic is included in this MVP.
