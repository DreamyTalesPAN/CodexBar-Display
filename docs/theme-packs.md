# VibeTV Theme Packs

A theme pack is the downloadable unit for customer themes. GitHub hosts the published catalog and ZIPs; the VibeTV companion installs them over WiFi from a local file, local directory, or a verified catalog entry.

The source of truth lives in `theme-packs/<theme-id>/` as plain files. The customer-facing GitHub artifacts live in `dist/theme-packs/` and are committed so the default install command can resolve packs from GitHub.

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
- Published catalog entries require `bytes` and `sha256`. The Companion verifies both before parsing a ZIP.
- Remote catalogs and packs require HTTPS and must resolve only to public network addresses. Redirects are checked again; private, loopback, link-local, multicast, and carrier-grade NAT targets are rejected.

## CLI

The versioned directories under `theme-packs/` are the source of truth for
published themes. Build all pack ZIPs and the GitHub catalog with:

```bash
node scripts/build-theme-packs.mjs
```

The build validates every source directory and every generated ZIP with the Companion CLI. Committed output:

```text
dist/theme-packs/vibetv-theme-packs.json
dist/theme-packs/vibetv-theme-<theme-id>.zip
```

After these files are committed and merged to `main`, the default catalog URL is:

```text
https://raw.githubusercontent.com/DreamyTalesPAN/CodexBar-Display/main/dist/theme-packs/vibetv-theme-packs.json
```

List the published VibeTV theme catalog:

```bash
go run ./cmd/codexbar-display theme-pack catalog
```

Validate a downloaded pack:

```bash
go run ./cmd/codexbar-display theme-pack validate --pack ../theme-packs/cozy-meadow
```

Install it on a connected VibeTV only during an explicit hardware test window. Theme pack install uploads files to the ESP8266 over WiFi and can destabilize weak firmware/network states. Do not use it as a routine smoke test.

For theme-only tests, skip firmware update explicitly:

```bash
go run ./cmd/codexbar-display theme-pack install --pack ../theme-packs/cozy-meadow --target http://<device-ip> --skip-firmware-update
```

Install by catalog theme ID:

```bash
go run ./cmd/codexbar-display theme-pack install --theme clippy --target http://<device-ip> --skip-firmware-update
```

Without `--skip-firmware-update`, install first runs the WiFi firmware update flow for the same `--target`. If the device is already current, it continues without flashing. Then it uploads assets, uploads the stored ThemeSpec, and activates it via `/theme/active`. The regular daemon keeps sending real live frames after install.
