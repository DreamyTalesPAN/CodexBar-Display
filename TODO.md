# vibeblock TODO (v0, Open Work)

## Scope Lock
- Release-gated env: `esp8266_smalltv_st7789`.
- Non-blocking envs: `esp8266_smalltv_st7789_alt` (supported variant), `lilygo_t_display_s3` (experimental fallback).
- Runtime themes only (`classic`, `crt`, `mini`) on the same firmware.
- Theme contract remains strict feature-gated (`theme` only when `hello.features` includes `theme`).
- GIF core is reusable/modular; current product scope keeps GIF playback only in `mini`.
- No runtime media upload protocol in v0.

## P0 (Ship Blockers)
- [ ] E2E acceptance on at least 2 macOS machines.
- [ ] Execute the full release readiness checklist in `docs/operator-runbook.md`.
- [ ] Execute the `RC -> soak -> final` flow from `docs/operator-runbook.md` and document the decision.

## P1 (Next, Non-Blocking)
- [ ] Split `firmware_esp8266/src/renderer_esp8266.cpp` into theme-focused modules (`classic`, `crt`, `mini`) without behavior changes.
- [ ] Extract probe rendering path into its own module to shrink renderer responsibilities.
- [ ] Add targeted tests for GIF-core fallback/backoff and request switching behavior.

## v0 Done Criteria
- [ ] No open P0/P1 bugs on `esp8266_smalltv_st7789`.
- [ ] `esp8266_smalltv_st7789_alt` runs as best-effort non-blocking variant.
- [ ] `classic`, `crt`, `mini` run stable on `esp8266_smalltv_st7789` without reflashing.
- [ ] Mini GIF path remains stable and falls back cleanly when assets are missing/corrupt.
- [ ] `README.md`, `docs/operator-runbook.md`, `docs/hardware-contract.md`, and `protocol/PROTOCOL.md` are consistent.

## Out of Scope (v0)
- External theme SDK or third-party theme packaging.
- `vibeblock theme init/dev/validate/build/flash/test` command family.
- Separate GIF-player firmware track with its own upload protocol.
