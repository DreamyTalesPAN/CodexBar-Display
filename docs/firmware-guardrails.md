# Firmware Architecture Guardrails (WiFi runtime v2)

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
- ThemeSpec update notices must use the existing label binding. Do not draw the global bottom update bar over ThemeSpec layouts.
- `themeId/themeRev` cache keys are required to detect unchanged ThemeSpec payloads.
- Live theme removal is destructive. Firmware must ignore `themeSpec:null` unless the same frame also sets `confirmClearThemeSpec:true`.
- Companion code must not emit `themeSpec:null` unless the caller explicitly marks that clear as confirmed. Normal recovery paths should reactivate a stored ThemeSpec or repair assets instead of clearing the live theme.

## ESP8266 WiFi Upload Guardrails
- Asset upload crashes are usually RAM pressure first. Do not start by adding retries or longer timeouts.
- `/assets` uploads must remain rate-limited from the Companion. Fast multipart writes can reset the ESP8266 even for small files.
- If an upload returns `connection reset by peer`, EOF, or timeout, stop the upload attempt and check `/health`. Do not immediately resend the same asset.
- Firmware must mark firmware/filesystem/theme asset uploads so upload-related restarts do not count toward the WiFi setup reset counter.
- Firmware must release GIF decoder, sprite caches, and open filesystem handles before asset upload, OTA, and stored ThemeSpec activation.
- A stored ThemeSpec activation must not keep the previous Mini GIF decoder open unless the new ThemeSpec actually uses that GIF.

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
- [ ] Confirmed live ThemeSpec clearing still requires explicit confirmation on both host and firmware paths.
- [ ] For WiFi upload changes, tested `synthwave -> clippy -> synthwave` on ESP8266 and checked `/health` after each activation.
- [ ] Confirmed upload-related restarts do not trigger the WiFi setup reset counter.
- [ ] Added/updated tests or smoke notes for changed behavior.
