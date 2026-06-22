# VibeTV Shopify Theme Journey

This document is the current Shopify rollout plan for customer-visible VibeTV theme products.

## Current Decision

The rollout uses normal Shopify products as the visible theme catalog:

- Shop domain: `vibetv.shop`
- Theme collection handle: `themes-2`
- Hosted app: `https://app.vibetv.shop`
- Product entry surface: `https://vibetv.shop/products/<theme-handle>`
- Current product action: visible Terminal install command.

The Control Center reads products from Shopify Storefront API through `apps/control-center/src/lib/themes.ts`. App-owned Shopify Metaobjects can still be revisited later, but they are not the current source of truth.

Do not link Shopify theme product pages to `https://app.vibetv.shop/install/<theme_id>` until the hosted app path is actually customer-available, including a signed Mac App installer attached to a release and verified on a clean Mac. Until then, the product pages must show the direct Terminal install command.

## Product Model

Each customer-visible theme should be a Shopify product in the `themes-2` collection.

Required:

- Product title, description, and preview images/GIFs.
- Product price `0`, because the first customer flow only installs free themes.
- Product type or tag: `VibeTV Theme`.
- Metafield `vibetv.theme_id`.

Recommended:

- `vibetv.theme_version`
- `vibetv.manifest_url`
- `vibetv.pack_url`
- `vibetv.compatible_boards`
- `vibetv.requires_firmware`

The `vibetv.theme_id` value must match the ID used by the Control Center and the GitHub theme-pack catalog, for example `synthwave`, `clippy`, or `claude-creature`.

Shopify is the catalog and preview surface. The installable ZIPs stay in GitHub release/repo artifacts for now. If a Shopify product does not define a valid `vibetv.pack_url`, the Control Center fills the missing or invalid pack URL from the GitHub catalog by matching `vibetv.theme_id`.

## Product Button

Use the Custom Liquid block stored in `docs/vibetv-theme-product-custom-liquid.liquid` on VibeTV theme product pages. It renders one primary action, `Copy install command`, then shows the actual command:

```liquid
curl -fsSL https://github.com/DreamyTalesPAN/CodexBar-Display/releases/latest/download/install.sh | bash && codexbar-display theme-pack install --theme <theme_id> --target http://vibetv.local
```

The Liquid derives `<theme_id>` from `vibetv.theme_id` or `theme.theme_id`.

Do not use customer-facing copy like `Check compatibility in the app`, `Opens the hosted Control Center`, or `Jetzt installieren` on Shopify theme product pages while the app path is not customer-available.

Live rollout status on 2026-06-22: the main `vibetv.shop` theme template `templates/product.themes.json` shows the Terminal command block for VibeTV theme products. The Synthwave page was verified publicly with `Copy install command` and `codexbar-display theme-pack install --theme synthwave --target http://vibetv.local`. It does not link to `app.vibetv.shop`.

## Customer Flow

1. Customer visits `https://vibetv.shop/collections/themes-2`.
2. Customer opens a VibeTV theme product.
3. Product page shows one primary action: `Copy install command`.
4. Customer opens Terminal, pastes the command, and presses Return while VibeTV is on the same WiFi.
5. The command installs/updates the CLI helper and runs `codexbar-display theme-pack install --theme <theme_id> --target http://vibetv.local`.

Future app flow: once the hosted Control Center and signed Mac App installer are truly customer-available, the product page can move back to an app entry point. At that point, the app must show one next action at a time: install/repair Mac App, connect VibeTV, update firmware if explicitly needed, then install the selected theme.

## GitHub Theme Pack Artifacts

Theme source files live in this repo:

```text
theme-packs/<theme-id>/manifest.json
theme-packs/<theme-id>/theme.json
theme-packs/<theme-id>/assets/*
```

Build artifacts from the repo root:

```bash
node scripts/build-theme-packs.mjs
```

Committed generated files include:

```text
dist/theme-packs/vibetv-theme-packs.json
dist/theme-packs/vibetv-theme-synthwave.zip
dist/theme-packs/vibetv-theme-clippy.zip
dist/theme-packs/vibetv-theme-claude-creature.zip
dist/theme-packs/vibetv-theme-cozy-meadow.zip
dist/theme-packs/vibetv-theme-mini-classic.zip
```

The fallback catalog URL is:

```text
https://raw.githubusercontent.com/DreamyTalesPAN/CodexBar-Display/main/dist/theme-packs/vibetv-theme-packs.json
```

## Hardware Test Guardrail

WiFi theme installs write to the device. Do not run them against `vibetv.local` as a routine development check.

Before linking customers to a theme product, verify that the hosted app is reading the Shopify catalog and that the product resolves to an installable free theme:

```bash
scripts/check-control-center-companion-customer-readiness.sh \
  --app-url https://app.vibetv.shop \
  --expect-catalog-source shopify \
  --expect-theme-id <theme_id> \
  --expect-all-free-themes-installable \
  --expect-shopify-product-pages
```

That check only reads public HTTP pages and the hosted app. It fails if `/api/themes` is empty, served from the wrong catalog source, missing the selected `theme_id`, returning a paid theme for that ID, missing a free theme `themeId`, missing the resolved `packUrl`, returning a `packUrl` that is not an `http(s)` download URL, exposing any free collection theme that is not installable, if the selected `/install/<theme_id>` route is not reachable, if any free collection theme's `/install/<theme_id>` route is not reachable, if a free Shopify catalog item has neither `productUrl` nor `handle`, if a Shopify product page does not show `Copy install command`, if it does not include `codexbar-display theme-pack install --theme <theme_id> --target http://vibetv.local`, or if it still links customers to the unavailable hosted app install CTA.

Allowed without extra hardware approval:

- Shopify product/collection browsing.
- Hosted app readiness checks.
- Mac App installer availability checks.
- Read-only Mac App status, diagnostics, device discovery, and settings reads.

Not allowed without current explicit approval:

- `POST /v1/themes/install`
- `POST /assets`
- `POST /theme/active`
- firmware updates
- any repeated hardware write test after a failed write

## Hosted App Return Path

Switch Shopify theme product pages back to `https://app.vibetv.shop/install/<theme_id>` only after the hosted Control Center path is customer-available end to end. That means signed Mac App installer assets are attached to a release, the clean-Mac install path is verified, and the app gives customers one clear next action instead of exposing internal setup states.

## Sources

- Shopify Liquid metafields: `product.metafields.namespace.key.value`
- Shopify Liquid `url_encode` filter
- Control Center implementation: `apps/control-center/src/lib/themes.ts`
- Customer readiness doc: `docs/control-center-customer-readiness.md`
