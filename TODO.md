# vibeblock Roadmap (Open Work Only)

## Release Framing (v0)
- No public vibeblock release yet.
- No market device fleet yet.
- Current hardware baseline is the connected ESP8266 SmallTV dev unit.
- v0 scope includes rich rendering (`usage` + media on one screen), including GIF loop playback.
- v0 ship hardware target is ESP8266 SmallTV ST7789.
- ESP32-S3 stays in-repo as experimental/non-blocking for v0.
- External theme SDK/third-party themes are out of v0 scope.

## Backlog Hygiene
- This file tracks only open work.
- Completed milestones are in `docs/completed-milestones.md`.

## Product Assumptions (v0)
- Release-gated board target: ESP8266 SmallTV ST7789 (incl. alt mapping variants).
- Experimental board path (non-blocking): LILYGO T-Display-S3 (ESP32-S3).
- Runtime transport remains USB serial (no WiFi/BLE runtime path).
- Companion stays "smart"; firmware stays renderer/protocol-focused.
- Runtime frame is control-plane only; asset transfer is a separate tooling flow.

## Milestone 4: Device Contract + Runtime Hardening (P0, v0 ship-blocker)
Goal: Robust behavior on real desk setups (multiple USB devices, reconnects, sleep/wake, mixed firmware generations).

- [ ] Document hardware contract as software artifact (`docs/hardware-contract.md`) for ESP8266 ship target.
- [ ] Extend `doctor` with explicit board/protocol/capability contract checks for release-gated target.
- [ ] Keep experimental ESP32 checks as warnings only (must not block v0 go-live).
- [ ] Make `setup` resilient when serial probe is flaky/busy (no partial install state; deterministic recovery path).
- [ ] Make theme negotiation robust for legacy hello paths (avoid false `theme-skipped` when capabilities are unknown).
- [ ] Add deterministic serial port affinity with safe fallback (avoid silently switching to the wrong USB device).
- [ ] Add optional debug mode with increased detail (without increasing default log noise).
- [ ] Build support-bundle command (doctor output, recent logs, relevant env/runtime config snapshot).
- [ ] Expand troubleshooting guide for top field failures and coded recoveries.

Acceptance:
- [ ] Wrong/incompatible hardware is detected clearly within 5s on ESP8266 ship path.
- [ ] Correct ESP8266 hardware shows a valid frame within 15s after daemon start.
- [ ] Common support cases are solvable reproducibly with `doctor` + support bundle.
- [ ] Support bundle generation completes in <30s on macOS baseline hardware.

## Milestone 8: Rich Rendering & Built-in Themes (P0, v0 ship-blocker)
Goal: Ship hybrid rendering in v0 (`usage` + GIF/JPG on one screen) without losing the CodexBar usage core.

KISS ship path:
- [ ] Freeze first-release rich-render protocol fields directly in `protocol/PROTOCOL.md` (`renderMode`, `shapePreset`, `mediaSlot`, `mediaFit`, `mediaLoop`).
- [ ] Extend companion + firmware parser for render fields (unknown fields ignored).
- [ ] Add capability handshake gating (`features`, `codecs`, `maxAssetBytes`) before sending render fields.
- [ ] Implement one shared media pipeline in firmware core (decode + guardrails).
- [ ] Implement layered renderer (usage -> shapes -> media -> overlay/error) with media-only degradation on failures.
- [ ] Implement device asset store + `vibeblock media sync` (simple + reliable; atomic commit before ship).
- [ ] Integrate asset sync into setup/upgrade so required GIF assets are not a manual post-flash step.
- [ ] Keep GIF playback at source timing by default; allow frame drops for catch-up when decode/render falls behind.
- [ ] Emit runtime render metrics (`rendered`, `dropped`, `avgRenderMs`, `estDelayMs`) and document interpretation in runbook.
- [ ] Migrate built-in themes (`classic`, `crt`, `mini`) to the rich-render pipeline.
- [ ] Add essential test gates: corrupted asset, missing slot, reconnect/sleep-wake, long soak, budget checks.

Acceptance:
- [ ] `usage_with_media` renders usage + media concurrently on one screen.
- [ ] `gif_loop` mode can run continuously without watchdog resets on ESP8266 baseline.
- [ ] Usage data remains correctly visible in all render modes except explicit `media_only`.
- [ ] Backward compatibility mode remains intact (firmware without render support ignores new render fields).
- [ ] Broken assets do not cause reboots/hangs.
- [ ] Slot/decode failures degrade media only (no black screen, no reboot loop).
- [ ] Runtime remains robust under USB reconnect and sleep/wake.
- [ ] ESP8266 baseline remains stable (no OOM/watchdog resets under soak and bad assets).

Out of scope for v0:
- External theme SDK + third-party theme packaging/tooling (`docs/theme-sdk-v2-outlook.md` is v2 outlook only).
- `vibeblock theme init/dev/validate/build/flash/test` command family.

Later (not v0 ship-blockers):
- [ ] Threshold-triggered GIF behaviors tied to usage levels.
- [ ] Expanded media telemetry beyond core error counters.
- [ ] Additional convenience commands around media/theme workflows if needed.
- [ ] Revisit Theme SDK scope for v2 after v0 stability goals are met.

## Milestone 7: Production Gate (Go/No-Go)
Goal: Binding acceptance criteria before first production rollout.

- [ ] Create final Go/No-Go checklist (functionality, stability, setup, upgrade, docs).
- [ ] Run E2E acceptance on at least 2 macOS devices.
- [ ] Introduce release candidate process (RC -> soak -> final).

Go-live criteria:
- [ ] Milestones 4 and 8 completed.
- [ ] No open P0/P1 bugs.
- [ ] Setup, upgrade, rollback, and troubleshooting docs are current.
- [ ] GIF rendering path is part of release validation and passes v0 acceptance gates.
- [ ] No open ESP8266 P0/P1 bugs on release-gated flows.
