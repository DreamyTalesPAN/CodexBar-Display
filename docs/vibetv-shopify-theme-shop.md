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
Treat the hosted app path as the customer entrypoint, not as the full customer
app. Theme product pages should point customers into hosted setup once the
launch cutover is approved. From there, the Mac App opens the local Control
Center for install and management. The direct Terminal command remains useful as
a rollback or support fallback, not as the preferred product journey.

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

Shopify is the product, price, and preview surface. The installable ZIPs stay
in GitHub release/repo artifacts. For a matching `vibetv.theme_id`, the
Control Center uses the generation-matched GitHub catalog as the technical
source for version, ZIP URL, checksum, size, firmware, and capability
requirements. Shopify pack metadata is only used when that theme ID does not
have complete technical metadata in the current GitHub catalog.

## Product Button

The preferred launch action opens hosted setup with the selected theme:

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
```text
dist/theme-packs/vibetv-theme-packs-v2.json
dist/theme-packs/vibetv-theme-synthwave-v1.1.0.zip
dist/theme-packs/vibetv-theme-clippy-v1.1.0.zip
dist/theme-packs/vibetv-theme-claude-creature-v1.1.0.zip
dist/theme-packs/vibetv-theme-cozy-meadow-v0.2.0.zip
dist/theme-packs/vibetv-theme-mini-classic-v1.1.0.zip
```

The customer-readiness checker may validate the hosted app catalog and its own
install routes. It intentionally does not fetch or inspect Shopify product
pages.

Read-only catalog checks do not write to VibeTV. Installing a theme or
screensaver does write to the device and still requires current approval for
the exact hardware test.
```text
https://raw.githubusercontent.com/DreamyTalesPAN/CodexBar-Display/main/dist/theme-packs/vibetv-theme-packs-v2.json
```

The previous `vibetv-theme-packs.json` catalog and unversioned ZIPs remain
frozen for already shipped app and Companion generations.

## Hardware Test Guardrail

WiFi theme installs write to the device. Do not run them against a device IP as a routine development check.

Before linking customers to a Control Center theme route, verify that the hosted
app is reading the Shopify catalog and that the product resolves to an
installable free theme:

```bash
scripts/check-control-center-companion-customer-readiness.sh \
  --app-url https://app.vibetv.shop \
  --expect-catalog-source shopify \
  --expect-theme-id <theme_id> \
  --expect-all-free-themes-installable \
  --expect-shopify-product-pages
```

That check only reads public HTTP pages and the hosted app. It fails if
`/api/themes` is empty, served from the wrong catalog source, missing the
selected `theme_id`, returning a paid theme for that ID, missing a free theme
`themeId`, missing the resolved `packUrl`, returning a `packUrl` that is not an
`http(s)` download URL, exposing any free collection theme that is not
installable, or if the selected `/install/<theme_id>` route is not reachable.

During staged rollout, the same checker can still assert the fallback Shopify
product-page command when `--expect-shopify-product-pages` is intentionally used.

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

The hosted app path is the intended launch path. A theme product link should
look like:

```text
https://app.vibetv.shop/install/<theme_id>
```

The app must still preserve the Control Center rule: one clear next action at a
time. A theme install link must not bypass setup gating.

## Sources

- Shopify Liquid metafields: `product.metafields.namespace.key.value`
- Shopify Liquid `url_encode` filter
- Control Center implementation: `apps/control-center/src/lib/themes.ts`
- Customer readiness doc: `docs/control-center-customer-readiness.md`
