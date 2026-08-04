# Shopify Theme Boundary

## Current Decision

Shopify theme products are currently independent from the VibeTV Mac App.
Product pages do not launch Mac App theme installation, and release readiness
must not require Shopify product copy or links to `/install/<theme_id>`.

The hosted web app may still expose a Shopify-backed catalog. That web catalog
is separate from the catalog shipped inside the Mac App and is not an install
contract for Shopify product pages.

## Mac App Theme Catalog

The Mac App uses the generation-matched repository catalog and theme packs:

```text
dist/theme-packs/vibetv-theme-packs-v2.json
dist/theme-packs/vibetv-theme-<theme-id>-<version>.zip
```

`apps/control-center/scripts/build-local-static.mjs` copies that catalog and
the complete `dist/theme-packs` directory into the local Control Center export.
The macOS app build then ships the export with the app. Shopify credentials and
product metadata are not needed for this path.

Theme source files live in:

```text
theme-packs/<theme-id>/manifest.json
theme-packs/<theme-id>/theme.json
theme-packs/<theme-id>/assets/*
```

Build the catalog and immutable packs from the repository root:

```bash
node scripts/build-theme-packs.mjs
```

Both live themes and screensavers use this same packaging path. Their
`manifest.json` selects the usage slot with `live` or `screensaver`. Adding a
screensaver therefore must not require a Shopify product or a separate delivery
system.

## Readiness Boundary

The customer-readiness checker may validate the hosted app catalog and its own
install routes. It intentionally does not fetch or inspect Shopify product
pages.

Read-only catalog checks do not write to VibeTV. Installing a theme or
screensaver does write to the device and still requires current approval for
the exact hardware test.
