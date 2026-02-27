# Versioning & Compatibility (Milestone 5)

This document defines SemVer and the compatibility contract between `companion` and `firmware`.

## SemVer Policy

- Companion uses SemVer (`MAJOR.MINOR.PATCH`) and exposes it via:
  - `vibeblock version`
  - `vibeblock version --json`
- Firmware reports SemVer in device hello:
  - `{"kind":"hello",...,"firmware":"1.0.0",...}`
- Compatibility guarantees are major-version scoped.

## Compatibility Matrix

| Rule | Companion Range | Firmware Range | Protocol |
|---|---|---|---|
| `v1-stable` | `>=1.0.0 <2.0.0` | `>=1.0.0 <2.0.0` | `1` |

Current release defaults:
- Companion: `1.0.0`
- Firmware environments (`esp8266_*`, `lilygo_t_display_s3`): `1.0.0`

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
