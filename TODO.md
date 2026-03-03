# codexbar-display TODO (v0, Open Work)

## Scope Lock
- Release-gated env: `esp8266_smalltv_st7789`.
- Non-blocking env: `lilygo_t_display_s3` (experimental fallback).
- Runtime themes only (`classic`, `crt`, `mini`) on the same firmware.
- Theme contract: capability-aware with MVP fallback (`theme` is blocked only on explicit `known && !supportsTheme`; unknown hello uses optimistic send).
- GIF core is reusable/modular; current product scope keeps GIF playback only in `mini`.
- No runtime media upload protocol in v0.

## P0 (Ship Blockers)
- [ ] E2E acceptance on at least 2 macOS machines.
- [ ] Execute the full release readiness checklist in `docs/operator-runbook.md`.
- [ ] Execute the `RC -> soak -> final` flow from `docs/operator-runbook.md` and document the decision.

## Current Status (2026-03-02, Machine A)
- [x] `setup --yes --firmware-env esp8266_smalltv_st7789 --theme mini` (flash + runtime config + launch agent) works.
- [x] `go test ./...` (companion), `pio run -d firmware_esp8266 -e esp8266_smalltv_st7789`, and `./scripts/check-esp8266-soak-gate.sh` are green.
- [x] `upgrade --firmware-env esp8266_smalltv_st7789` works.
- [x] `restore-known-good` with manifest/device verification works (explicit image+manifest path).
- [x] `rollback --skip-companion --image ... --manifest ...` works when the port is free.
- [x] `rollback --port ...` falls back to backup discovery when state known-good firmware image path is stale/missing.
- [ ] Machine-B E2E run still open.

## P1 (Next, Non-Blocking)
- [x] Split `firmware_esp8266/src/renderer_esp8266.cpp` into theme-focused modules (`classic`, `crt`, `mini`) without behavior changes.
- [x] Extract probe rendering path into its own module to shrink renderer responsibilities.
- [x] Add targeted tests for GIF-core fallback/backoff and request switching behavior.

## v0 Done Criteria
- [ ] No open P0/P1 bugs on `esp8266_smalltv_st7789`.
- [ ] `classic`, `crt`, `mini` run stable on `esp8266_smalltv_st7789` without reflashing.
- [ ] Mini GIF path remains stable and falls back cleanly when assets are missing/corrupt.
- [ ] `README.md`, `docs/operator-runbook.md`, `docs/hardware-contract.md`, and `protocol/PROTOCOL.md` are consistent.

## Out of Scope (v0)
- External theme SDK or third-party theme packaging.
- `codexbar-display theme init/dev/validate/build/flash/test` command family.
- Separate GIF-player firmware track with its own upload protocol.
