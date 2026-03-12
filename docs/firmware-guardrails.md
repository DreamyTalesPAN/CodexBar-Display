# Firmware Architecture Guardrails (USB-first v2)

Goal: keep firmware transport/theme evolution modular and prevent monolith regressions.

## Module Boundaries
- `firmware_shared/codexbar_display_core.h`: protocol frame parsing, runtime state, countdown math.
- `firmware_shared/app_transport.h`: transport hello emission + serial consume bridge.
- `firmware_shared/app_runtime.h`: runtime context wrapper.
- `firmware_shared/app_renderer.h`: renderer lifecycle contract.
- `firmware_esp8266/src/renderer_esp8266_*`: board-specific theme rendering details.
- `firmware_esp32/src/renderer_esp32*`: alternate display target implementation.

Rules:
- transport logic must not import board-specific renderer internals.
- renderer modules must not parse raw JSON directly (only consume `core::Frame`).
- theme behavior changes should remain inside theme modules, not in transport loop.

## Protocol/Theme Rules
- Companion->device frame `v` is negotiated (prefer v2, fallback v1).
- ThemeSpec is declarative data only. Never execute scripts on device.
- `themeId/themeRev` cache keys are required to detect unchanged ThemeSpec payloads.

## Split Thresholds (mandatory refactor trigger)
- Any single `.cpp`/`.h` file > 800 LOC and touching > 3 responsibilities:
  - split within same milestone.
- Any function > 120 LOC with > 2 conditional feature branches:
  - extract helper module(s) before adding new feature logic.
- Any feature requiring changes across `core + transport + renderer`:
  - add/update tests and contract docs in same PR.

## PR Checklist (required for firmware-impacting changes)
- [ ] Updated protocol docs if hello/frame shape changed.
- [ ] Confirmed no direct JSON parsing outside `firmware_shared/codexbar_display_core.h`.
- [ ] Confirmed renderer changes do not alter transport/handshake behavior.
- [ ] Added/updated tests or smoke notes for changed behavior.
