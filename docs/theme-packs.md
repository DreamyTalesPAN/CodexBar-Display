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

The directories under `theme-packs/` are the source of truth for the current
app generation. Every content change must bump both `manifest.version` and the
ThemeSpec `rev`, and must use a new ThemeSpec device path. Build all current
pack ZIPs and the GitHub catalog with:

```bash
node scripts/build-theme-packs.mjs
```

The build validates every source directory and every generated ZIP with the
Companion CLI. A published versioned ZIP is immutable: if the same version
would produce different bytes, the build fails and requires another version
bump. Committed current-generation output:

```text
dist/theme-packs/vibetv-theme-packs-v2.json
dist/theme-packs/vibetv-theme-<theme-id>-v<theme-version>.zip
dist/theme-packs/render/<theme-id>/<theme-spec-file>.json
```

The revisioned render packs contain both frozen legacy and current revisions.
They power exact previews in the hosted Control Center and are copied into the
Mac App. The unqualified `render/<theme-id>.json` alias points only to the
current revision for compatibility with older clients.

The legacy generation remains frozen at:

```text
https://raw.githubusercontent.com/DreamyTalesPAN/CodexBar-Display/main/dist/theme-packs/vibetv-theme-packs.json
```

Old Mac Apps bundle that legacy catalog and its unversioned ZIPs. Current Mac
Apps bundle a release-local snapshot of the v2 catalog and versioned ZIPs. The
current Companion defaults to:

```text
https://raw.githubusercontent.com/DreamyTalesPAN/CodexBar-Display/main/dist/theme-packs/vibetv-theme-packs-v2.json
```

When a renderer contract changes incompatibly again, create a new catalog
generation instead of repointing an old Companion at incompatible packs.

## Withdrawing A Theme

Delete `theme-packs/<theme-id>/` and rebuild. The catalog is generated from the
source directories, so the theme disappears from it, and every install and
update flow resolves through the catalog. The Mac App packages only archives
whose theme the catalog still offers, so a withdrawn theme cannot be installed
from the packaged app either.

Already published artifacts stay in `dist/theme-packs/`: the frozen legacy
catalog, the versioned ZIPs and the render revisions. They are immutable
published bytes that older apps still resolve, and `check-theme-pack-history.sh`
fails on any deletion. They are simply no longer referenced or shipped.

A device that already runs the theme keeps rendering it, because the ThemeSpec
lives on the device.

List the published VibeTV theme catalog:

```bash
go run ./cmd/codexbar-display theme-pack catalog
```

Validate a downloaded pack:

```bash
go run ./cmd/codexbar-display theme-pack validate --pack ../theme-packs/clippy
```

Local directories and ZIP files do not need catalog metadata. To validate a
remote ZIP, pass the SHA-256 and byte size from a trusted catalog entry. Remote
downloads require HTTPS and are rejected before parsing when either value is
missing or does not match:

```bash
go run ./cmd/codexbar-display theme-pack validate \
  --pack https://example.com/vibetv-theme-cozy-meadow-v0.2.0.zip \
  --pack-sha256 <64-character-hex-sha256> \
  --pack-size-bytes <exact-byte-size>
```

Install it on a connected VibeTV only during an explicit hardware test window. Theme pack install uploads files to the ESP8266 over WiFi and can destabilize weak firmware/network states. Do not use it as a routine smoke test.

For theme-only tests, skip firmware update explicitly:

```bash
go run ./cmd/codexbar-display theme-pack install --pack ../theme-packs/clippy --target http://<device-ip> --skip-firmware-update
```

Install by catalog theme ID:

```bash
go run ./cmd/codexbar-display theme-pack install --theme clippy --target http://<device-ip> --skip-firmware-update
```

Without `--skip-firmware-update`, install first runs the WiFi firmware update flow for the same `--target`. If the device is already current, it continues without flashing. Then it uploads assets, uploads the stored ThemeSpec, and activates it via `/theme/active`. The regular daemon keeps sending real live frames after install.
