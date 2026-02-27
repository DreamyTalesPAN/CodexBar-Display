# Versioning & Compatibility (Milestone 5, Pre-release)

This document defines SemVer and the compatibility contract between `companion` and `firmware`.

Status:
- There is no public vibeblock release yet.
- The matrix and versions below are the current working pre-release defaults and will be frozen before first shipment.
- Protocol remains `v:1` for first release; rich rendering is modeled as optional v1 fields (no protocol v2 split for v1 ship scope).

## SemVer Policy

- Companion uses SemVer (`MAJOR.MINOR.PATCH`) and exposes it via:
  - `vibeblock version`
  - `vibeblock version --json`
- Firmware reports SemVer in device hello:
  - `{"kind":"hello",...,"firmware":"1.0.0",...}`
- Compatibility guarantees are major-version scoped.

## Compatibility Matrix

Source of truth:
- `protocol/compatibility_matrix.json`

| Rule | Companion Range | Firmware Range | Protocol |
|---|---|---|---|
| `v1-stable` | `>=1.0.0 <2.0.0` | `>=1.0.0 <2.0.0` | `1` |

Current working pre-release defaults:
- Companion: `1.0.0`
- Firmware environments (`esp8266_*`, `lilygo_t_display_s3`): `1.0.0`

## Protocol Contract Note

- Canonical protocol spec: `protocol/PROTOCOL.md`
- Canonical frame schema: `protocol/schema.json`
- Rich-render fields (`renderMode`, `shapePreset`, `mediaSlot`, `mediaFit`, `mediaLoop`) are optional v1 extensions and capability-gated via device hello.

## Version Guard

`vibeblock upgrade` runs a version guard before flashing:
- validates `companion_version` vs `target_firmware_version`
- blocks incompatible pairs with `upgrade/version-guard`
- prints a concrete recovery hint

You can override the target firmware version explicitly:

```bash
cd companion
go run ./cmd/vibeblock upgrade --firmware-env esp8266_smalltv_st7789 --target-firmware-version 1.0.0
```

## Operational Commands

```bash
cd companion

go run ./cmd/vibeblock version

go run ./cmd/vibeblock upgrade --firmware-env esp8266_smalltv_st7789

go run ./cmd/vibeblock rollback --port /dev/cu.usbserial-10
```
