# VibeTV Shopify Theme Shop

This is the target architecture for `vibetv.shop`. Do not mix this with any other Shopify business.

## Decision

Use **Shopify Files + app-owned Metaobjects** for the free theme catalog.

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

[metaobjects.app.vibetv_theme.fields.download_file]
name = "Download File"
type = "file_reference"
required = true

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

## Customer Flow

1. Customer visits `vibetv.shop/themes`.
2. Storefront lists `vibetv_theme` metaobjects.
3. Customer downloads the Theme Pack `.zip`.
4. Companion installs it:

```bash
codexbar-display theme-pack install --pack https://vibetv.shop/cdn/shop/t/1/assets/vibetv-theme-cozy-meadow.zip --target http://vibetv.local
```

5. Companion uploads assets to `/assets`, activates the stored ThemeSpec via `/theme/active`, then sends one live frame.

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
