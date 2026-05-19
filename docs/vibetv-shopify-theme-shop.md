# VibeTV Shopify Theme Shop

This is the target architecture for `vibetv.shop`. Do not mix this with any other Shopify business.

## Decision

Use **Shopify theme assets/files + app-owned Metaobjects** for the free theme catalog.

Do not model free themes as normal Shopify products for the MVP. Products make sense later if themes become paid, need checkout, or need order history. For a free download catalog they add too much checkout/cart behavior.

## Data Model

Define a VibeTV theme metaobject in the VibeTV Shopify app configuration:

```toml
[metaobjects.app.vibetv_theme]
name = "VibeTV Theme"
display_name_field = "title"
access.admin = "merchant_read_write"
access.storefront = "public_read"

[metaobjects.app.vibetv_theme.fields.title]
name = "Title"
type = "single_line_text_field"
required = true

[metaobjects.app.vibetv_theme.fields.short_description]
name = "Short Description"
type = "multi_line_text_field"

[metaobjects.app.vibetv_theme.fields.theme_id]
name = "Theme ID"
type = "single_line_text_field"
required = true

[metaobjects.app.vibetv_theme.fields.theme_rev]
name = "Theme Revision"
type = "number_integer"
required = true

[metaobjects.app.vibetv_theme.fields.preview_image]
name = "Preview Image"
type = "file_reference"

[metaobjects.app.vibetv_theme.fields.min_firmware_version]
name = "Minimum Firmware Version"
type = "single_line_text_field"

[metaobjects.app.vibetv_theme.fields.tags]
name = "Tags"
type = "list.single_line_text_field"

[metaobjects.app.vibetv_theme.fields.featured]
name = "Featured"
type = "boolean"

[metaobjects.app.vibetv_theme.fields.sort_order]
name = "Sort Order"
type = "number_integer"
```

Shopify docs say TOML-defined app-owned metaobjects are version-controlled and deployed with `shopify app deploy`. They also support `access.storefront = "public_read"`, so the storefront can list the themes.

`theme_id` is the key field. It must exactly match the ID in `dist/theme-packs/vibetv-theme-packs.json`, for example `synthwave`, `clippy`, or `claude-creature`.

## Repo Build Flow

Theme source files live in this repo:

```text
theme-packs/<theme-id>/manifest.json
theme-packs/<theme-id>/theme.json
theme-packs/<theme-id>/assets/*
```

Build Shopify upload artifacts from the repo root:

```bash
node scripts/build-theme-packs.mjs
```

Upload these generated files to Shopify:

```text
dist/theme-packs/vibetv-theme-packs.json
dist/theme-packs/vibetv-theme-synthwave.zip
dist/theme-packs/vibetv-theme-clippy.zip
dist/theme-packs/vibetv-theme-claude-creature.zip
dist/theme-packs/vibetv-theme-cozy-meadow.zip
```

## Customer Flow

1. Customer visits `vibetv.shop/themes`.
2. Storefront lists `vibetv_theme` metaobjects.
3. Each theme card uses its `theme_id` to render a copyable install command.
4. Customer copies and runs the command:

```bash
curl -fsSL https://github.com/DreamyTalesPAN/CodexBar-Display/releases/latest/download/install.sh | bash && codexbar-display theme-pack install --theme clippy --target http://vibetv.local
```

5. Companion reads the VibeTV catalog, resolves the Theme Pack ZIP from the `theme_id`, uploads assets to `/assets`, activates the stored ThemeSpec via `/theme/active`, then sends one live frame.

## Why This Stays Small On The Device

`vibetv.local` remains the device portal, not the theme store. It only needs:

- status from `/health`
- upload endpoints `/assets`
- activation endpoint `/theme/active`
- optional link to the external theme shop

The catalog, previews, and downloads live on Shopify.

## Sources

- Shopify Metaobject definitions: https://shopify.dev/docs/apps/build/metaobjects/manage-metaobject-definitions
- Shopify Metaobjects overview: https://shopify.dev/docs/apps/build/metaobjects
- Shopify Admin `fileCreate`: supports Files, including generic files, with async processing.
