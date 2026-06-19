# VibeTV Shopify Theme Journey

This document is the current Shopify rollout plan for the hosted Control Center flow.

## Current Decision

The MVP uses normal Shopify products as the visible theme catalog:

- Shop domain: `vibetv.shop`
- Theme collection handle: `themes-2`
- Hosted app: `https://app.vibetv.shop`
- Product entry URL: `https://app.vibetv.shop/install/<theme_id>`

The Control Center already reads products from Shopify Storefront API through `apps/control-center/src/lib/themes.ts`. App-owned Shopify Metaobjects can still be revisited later, but they are not the current MVP source of truth.

## Product Model

Each customer-visible theme should be a Shopify product in the `themes-2` collection.

Required:

- Product title, description, and preview images/GIFs.
- Product price `0`, because the MVP only installs free themes.
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

Use this Custom Liquid block on VibeTV theme product pages:

```liquid
{% liquid
  assign theme_product = product
  if theme_product == blank
    assign theme_product = closest.product
  endif
  assign theme_id = theme_product.metafields.vibetv.theme_id.value | default: theme_product.metafields.theme.theme_id.value
  assign readiness_url = ''
  if theme_id != blank
    assign encoded_theme_id = theme_id | url_encode
    assign readiness_url = 'https://app.vibetv.shop/install/' | append: encoded_theme_id
  endif
%}

<div class="vtv-theme-readiness" data-vtv-theme-readiness>
  {% if readiness_url != blank %}
    <a class="button add-to-cart-button" href="{{ readiness_url }}" target="_blank" rel="noopener">
      Check compatibility in the app
    </a>
    <p class="vtv-theme-readiness__note">
      Opens the hosted Control Center. Install only starts after Companion, VibeTV pairing, device checks, and the protected write gate are ready.
    </p>
  {% else %}
    <button type="button" class="button add-to-cart-button" disabled>
      Theme check unavailable
    </button>
    <p class="vtv-theme-readiness__note">Add the theme_id metafield before sending this theme page to customers.</p>
  {% endif %}
</div>
```

The validated source is also stored in `docs/vibetv-theme-product-custom-liquid.liquid`.

Do not use customer-facing copy like `Jetzt installieren` while #129 is open. The correct public promise is readiness/compatibility checking. Real theme-install writes remain protected until the hardware write gate is approved.

Live rollout status on 2026-06-19: the main `vibetv.shop` theme template `templates/product.themes.json` uses the readiness button for the product handles `synthwave-theme`, `clippy-theme`, and `claude-creature-theme`. Those buttons link to the technical Control Center theme IDs `synthwave`, `clippy`, and `claude-creature`. The old `theme-pack install --target http://vibetv.local` command-copy block is no longer present on those public product pages.

## Customer Flow

1. Customer visits `https://vibetv.shop/collections/themes-2`.
2. Customer opens a VibeTV theme product.
3. Product page button opens `https://app.vibetv.shop/install/<theme_id>`.
4. The hosted app opens the selected theme readiness screen.
5. If Companion is missing, the app shows Companion package/script download actions directly.
6. If Companion is running but VibeTV is not found, the app shows a `VibeTV target` field in the same install flow.
7. If multiple VibeTV devices are found, the app asks for the exact target instead of guessing.
8. If the catalog is empty or the requested `theme_id` is not found, the app shows a blocked catalog state instead of demo themes or the first available theme.
9. If the selected theme is paid, missing a pack URL, incompatible with the detected board, or requires newer firmware, the button names the blocker directly, for example `Pack Missing`, `Not Supported`, or `Update Needed`.
10. If Companion is missing or the write gate is closed, the button names that blocker directly, for example `Needs Companion` or `Protected`.
11. Once Companion, VibeTV discovery, free theme status, pack URL, board compatibility, firmware compatibility, and the write gate are ready, the customer can start install from the app.
12. Firmware updates stay in a separate explicit update flow. The hosted install journey must not silently flash firmware while installing a theme.

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

That check only reads public HTTP pages and the hosted app. It fails if `/api/themes` is empty, served from the wrong catalog source, missing the selected `theme_id`, returning a paid theme for that ID, missing a free theme `themeId`, missing the resolved `packUrl`, returning a `packUrl` that is not an `http(s)` download URL, exposing any free collection theme that is not installable, if the selected `/install/<theme_id>` route is not reachable, if any free collection theme's `/install/<theme_id>` route is not reachable, if a free Shopify catalog item has neither `productUrl` nor `handle`, if a Shopify product page does not link to `https://app.vibetv.shop/install/<theme_id>`, or if the old terminal install command is still present on the product page.

Allowed without extra hardware approval:

- Shopify product/collection browsing.
- Hosted app readiness checks.
- Companion installer availability checks.
- Read-only Companion status, diagnostics, device discovery, and settings reads.

Not allowed without current explicit approval:

- `POST /v1/themes/install`
- `POST /assets`
- `POST /theme/active`
- firmware updates
- any repeated hardware write test after a failed write

## Legacy Support Command

The old command-copy path is support/testing only:

```bash
curl -fsSL https://github.com/DreamyTalesPAN/CodexBar-Display/releases/latest/download/install.sh | bash && codexbar-display theme-pack install --theme clippy --target http://vibetv.local
```

Do not present this as the normal customer journey.

## Sources

- Shopify Liquid metafields: `product.metafields.namespace.key.value`
- Shopify Liquid `url_encode` filter
- Control Center implementation: `apps/control-center/src/lib/themes.ts`
- Customer readiness doc: `docs/control-center-customer-readiness.md`
