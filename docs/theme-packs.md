# VibeTV Theme Packs

A theme pack is the downloadable unit for customer themes. Shopify can host it as a file download; the VibeTV companion installs it over WiFi from a local file, local directory, or direct HTTP(S) ZIP URL.

The source of truth lives in `theme-packs/<theme-id>/` as plain files. The ZIPs and Shopify catalog are build output under `dist/theme-packs/` and should not be committed.

## Format

Each pack is either a directory or a `.zip` with `manifest.json` at the root.

```json
{
  "kind": "vibetv-theme-pack",
  "schemaVersion": 1,
  "id": "cozy-meadow",
  "name": "Cozy Meadow",
  "version": "0.1.0",
  "minFirmware": "1.0.0",
  "themeSpec": {
    "path": "/themes/u/cm.json",
    "file": "theme.json",
    "contentType": "application/json"
  },
  "assets": [
    {
      "path": "/themes/u/cm.cbi",
      "file": "assets/cm.cbi",
      "contentType": "text/plain"
    }
  ]
}
```

Rules:

- Device paths must start with `/themes/`.
- Device paths must be 31 characters or shorter because ESP8266 LittleFS paths are short.
- ThemeSpec `gif` and `sprite` primitives must reference files listed in `assets`.
- ESP8266 GIF assets are intentionally small: one `.gif` per ThemeSpec, max 24 KiB, max 80x80 draw box.
- Optional `bytes` and `sha256` fields pin downloaded files when packs are published.

## CLI

Sync the built-in Theme Studio presets into versioned pack sources:

```bash
node scripts/sync-theme-studio-packs.mjs
```

Build all pack ZIPs and the Shopify catalog:

```bash
node scripts/build-theme-packs.mjs
```

The build validates every source directory and every generated ZIP with the Companion CLI. Output:

```text
dist/theme-packs/vibetv-theme-packs.json
dist/theme-packs/vibetv-theme-<theme-id>.zip
```

Upload those files to Shopify theme assets/files so the catalog URL remains:

```text
https://vibetv.shop/cdn/shop/t/1/assets/vibetv-theme-packs.json
```

List the published VibeTV theme catalog:

```bash
go run ./cmd/codexbar-display theme-pack catalog
```

Validate a downloaded pack:

```bash
go run ./cmd/codexbar-display theme-pack validate --pack ../theme-packs/cozy-meadow
```

Install it on a connected VibeTV:

```bash
go run ./cmd/codexbar-display theme-pack install --pack ../theme-packs/cozy-meadow --target http://vibetv.local
```

Install a ZIP directly from the VibeTV shop:

```bash
go run ./cmd/codexbar-display theme-pack install --pack https://vibetv.shop/cdn/shop/t/1/assets/vibetv-theme-cozy-meadow.zip --target http://vibetv.local
```

Install by catalog theme ID:

```bash
go run ./cmd/codexbar-display theme-pack install --theme clippy --target http://vibetv.local
```

Install uploads assets, uploads the stored ThemeSpec, activates it via `/theme/active`, then sends a live frame so the theme is visible immediately.
