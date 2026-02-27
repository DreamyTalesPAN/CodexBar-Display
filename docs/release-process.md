# Release Process (Milestone 5)

This process defines tagging, checks, artifacts, and changelog expectations.

## Release Inputs

- All CI jobs pass on `main` (`.github/workflows/ci.yml`)
- Compatibility matrix is up-to-date (`docs/versioning-compatibility.md`)
- Operator docs cover setup, upgrade, rollback (`docs/operator-runbook.md`)

## Tagging

- Release tags use: `vMAJOR.MINOR.PATCH` (example: `v1.0.0`)
- Tag target: tested commit on `main`

## Build + Artifact Generation

`release.yml` (tag-triggered) produces:

- Companion binaries:
  - `vibeblock-darwin-amd64-vX.Y.Z`
  - `vibeblock-darwin-arm64-vX.Y.Z`
- Firmware binaries:
  - release-gated envs for v1 (`esp8266_*`): `vibeblock-firmware-<env>-vX.Y.Z.bin`
  - optional experimental envs (for example `lilygo_t_display_s3`) may be attached but are not v1 go-live blockers
- Checksums:
  - `checksums-vX.Y.Z.txt`
- Known-good firmware manifest:
  - `firmware-manifest-vX.Y.Z.json`

All artifacts are attached to the GitHub Release.

## Changelog Expectations

Release notes must include:
- compatibility statement (`companion` <-> `firmware`)
- upgrade notes (`vibeblock upgrade`)
- rollback notes (`vibeblock rollback`)
- known limitations and breaking changes (if any)

## Upgrade/Rollback Gate

A release is valid only if:
- upgrade from previous stable tag works without `setup` on release-gated envs (v1: ESP8266 targets)
- incompatible version pairs are blocked by version guard
- rollback to last-known-good is documented and executable on release-gated envs
