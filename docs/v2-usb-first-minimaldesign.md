# v2 Transport Minimaldesign

Historical note: this document started during the USB-first transition. The
standard Vibe TV customer runtime now uses WiFi for data and USB-C for power.

This document captures the transport-agnostic architecture baseline introduced for issue `#41`.

## Architecture Summary
- Companion runtime now has an explicit transport boundary via `companion/internal/transport`.
- Concrete adapters: `USBTransport` and `WiFiTransport` implement the same
  transport boundary without changing daemon frame selection logic.

## Protocol Handshake + Negotiation
- Device hello advertises:
  - `supportedProtocolVersions`
  - `preferredProtocolVersion`
  - legacy `protocolVersion` for fallback
  - extended `capabilities` block (`display/theme/transport`)
- Companion negotiation policy:
  - host supports `[2,1]`
  - choose highest intersection (v2 preferred)
  - fallback to v1 if no intersection/legacy hello

## ThemeSpec v1
- Schema: `protocol/theme_spec_v1.schema.json`
- Example: `protocol/fixtures/v2/theme_spec_mini_transport.json`
- CLI flow:
  - validate: `codexbar-display theme-validate --spec ...`
  - apply: `codexbar-display theme-apply --spec ...`
- Companion rejects incompatible specs with protocol error codes:
  - `protocol/theme-spec-invalid`
  - `protocol/theme-spec-incompatible`

## Firmware Runtime Notes
- Core parser accepts optional `themeSpec` object in incoming frames.
- Runtime caches `themeId/themeRev` and marks cache-hit for unchanged revisions.
- Hello capability block advertises theme limits (`maxThemeSpecBytes`, `maxThemePrimitives`) and builtin theme list.

## Renderer/HAL Baseline
- Shared primitive contract introduced in `firmware_shared/render_primitives.h`.
- ESP8266 adapter exposes primitive operations through `renderer_esp8266_display_state.*`.
- Built-in theme rendering now routes screen clears/rect fills/progress bars through the primitive layer.

## Non-goals in the original step
- No hosted/cloud backend.
- No user-code execution on firmware.
