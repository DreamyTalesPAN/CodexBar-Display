# vibeblock Roadmap (Open Work Only)

## Release Framing (v1)
- There is no public vibeblock release yet.
- There is no market device fleet yet.
- Current real hardware baseline is the connected ESP8266 SmallTV development unit.
- First release scope includes rich rendering (`usage` + media on one screen) with built-in themes only.
- External theme SDK/third-party themes are explicitly out of v1 scope.

## Backlog Hygiene
- This file tracks only open work.
- Completed milestones were moved to `docs/completed-milestones.md`.

## Product Assumptions (v1)
- Supported board targets:
  - ESP8266 SmallTV ST7789 (including alt mapping variants)
  - LILYGO T-Display-S3 (ESP32-S3)
- Runtime transport remains USB serial (no WiFi/BLE for vibeblock runtime).
- Companion stays "smart"; firmware stays renderer- and protocol-only.
- Runtime frame is control-plane only; asset transfer remains a separate tooling flow.

## Milestone 4: Dual-Target Hardening (P0)
Goal: Software is robust against production variance across both board families.

- [ ] Document hardware contract as software artifact (`docs/hardware-contract.md`) for both targets.
- [ ] Extend `doctor` with explicit board/protocol/capability contract checks.

Acceptance:
- [ ] Wrong/incompatible hardware is detected clearly within 5s (ESP8266 and ESP32).
- [ ] Correct ESP8266 and ESP32 hardware shows a valid frame within 15s after daemon start.

## Milestone 6: Observability & Supportability (P1)
Goal: Diagnose field issues quickly without code changes.

- [ ] Add optional debug mode with increased detail (without increasing default log noise).
- [ ] Build support-bundle command (doctor output, recent logs, relevant env/runtime config snapshot).
- [ ] Expand troubleshooting guide for top field failures and coded recoveries.

Acceptance:
- [ ] Common support cases are solvable reproducibly with `doctor` + support bundle.
- [ ] Support bundle generation completes in <30s on macOS baseline hardware.

## Milestone 8: Rich Rendering & Built-in Themes (P0, v1 ship-blocker)
Goal: Ship hybrid rendering in v1 (`usage` + GIF/JPG on one screen) without losing the CodexBar usage core.

KISS ship path:
- [ ] Freeze first-release rich-render protocol fields directly in `protocol/PROTOCOL.md` (`renderMode`, `shapePreset`, `mediaSlot`, `mediaFit`, `mediaLoop`).
- [ ] Extend companion + firmware parser for render fields (unknown fields ignored).
- [ ] Add capability handshake gating (`features`, `codecs`, `maxAssetBytes`) before sending render fields.
- [ ] Implement one shared media pipeline in firmware core (decode + guardrails).
- [ ] Implement layered renderer (usage -> shapes -> media -> overlay/error) with media-only degradation on failures.
- [ ] Implement device asset store + `vibeblock media sync` (simple + reliable; atomic commit before ship).
- [ ] Migrate built-in themes (`classic`, `crt`) to the rich-render pipeline.
- [ ] Add essential test gates: corrupted asset, missing slot, reconnect/sleep-wake, long soak, budget checks.

Acceptance:
- [ ] `usage_with_media` renders usage + media concurrently on one screen.
- [ ] Usage data remains correctly visible in all render modes except explicit `media_only`.
- [ ] Backward compatibility mode remains intact (firmware without render support ignores new render fields).
- [ ] Broken assets do not cause reboots/hangs.
- [ ] Slot/decode failures degrade media only (no black screen, no reboot loop).
- [ ] Runtime remains robust under USB reconnect and sleep/wake.
- [ ] ESP8266 baseline remains stable (no OOM/watchdog resets under soak and bad assets).

Out of scope for v1:
- External theme SDK + third-party theme packaging/tooling (`docs/theme-sdk-v2-outlook.md` is v2 outlook only).
- `vibeblock theme init/dev/validate/build/flash/test` command family.

Later (not v1 ship-blockers):
- [ ] Threshold-triggered GIF behaviors tied to usage levels.
- [ ] Expanded media telemetry beyond core error counters.
- [ ] Additional convenience commands around media/theme workflows if needed.
- [ ] Revisit Theme SDK scope for v2 after v1 stability goals are met.

## Milestone 7: Production Gate (Go/No-Go)
Goal: Binding acceptance criteria before first production rollout.

- [ ] Create final Go/No-Go checklist (functionality, stability, setup, upgrade, docs).
- [ ] Run E2E acceptance on at least 2 macOS devices.
- [ ] Introduce release candidate process (RC -> soak -> final).

Go-live criteria:
- [ ] Milestones 4, 6, and 8 completed.
- [ ] No open P0/P1 bugs.
- [ ] Setup, upgrade, rollback, and troubleshooting docs are current.
