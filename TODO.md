# vibeblock Roadmap to Production (Dual-Target)

## Current Priority: Refactor & Improvements
Goal: Reduce the largest maintainability and operations risks after the dual-target merge.

- [x] Further modularize firmware:
  - [x] Split `firmware_esp8266/src/main.cpp` into clearly separated modules for transport, parser, rendering, and runtime state.
  - [x] Establish the same module interface shape for ESP8266 and ESP32 so features can be introduced consistently across both targets.
- [x] Centralize theme registry:
  - [x] Use one central mapping (`theme id -> protocol name -> compile default`) for firmware + companion instead of repeated string constants.
  - [x] Keep theme validation in one shared place (companion + protocol schema + docs in sync).
- [ ] Expand protocol hardening:
  - [x] Maintain V1 golden frame tests (valid/invalid/oversized/capability-gated) centrally under `protocol/`.
  - Verify parser and serializer behavior for ESP8266, ESP32, and companion against the same fixtures.
- [x] Consolidate setup/runtime configuration:
  - [x] Finalize and test precedence rules (`CLI > ENV > runtime config > firmware default`).
  - [x] Extend `vibeblock setup` with `validate-only`/`dry-run` for safe production checks.
- [x] Decouple USB transport and improve testability:
  - [x] Further reduce the `usb` package to explicit interfaces (discover/open/send/read hello) so race/reconnect paths can be tested in isolation.
  - [x] Add serial integration tests with pseudo-tty/mock-device for reconnect/sleep-wake failure modes.
- [x] Standardize error codes and logs:
  - [x] Finalize taxonomy (`transport/*`, `protocol/*`, `runtime/*`, `setup/*`) and mirror it in docs/runbook.
  - [x] Every user-facing error has a stable code + concrete recovery action.
- [x] Expand CI quality gates:
  - [x] Enable `golangci-lint`/`staticcheck` for companion.
  - [x] Extend firmware checks with rough size budgets (warn/fail on clear regressions in flash/RAM).
- [x] Add benchmarks and budget thresholds:
  - [x] Make polling/render cycles measurable on companion and firmware.
  - [x] Document target budgets for latency (frame render), CPU time, and memory per target.

Acceptance:
- [ ] Critical core logic is split into small, isolated, testable modules (firmware + companion).
- [ ] Protocol and theme behavior is consistent across targets and tested fixture-driven.
- [ ] Setup, runtime, and support paths are reproducible without manual exceptions.

## Current Priority: Dual-Target Merge Baseline
Goal: Integrate the branch into `main` so ESP8266 and ESP32 run cleanly under one architecture.

- [x] Introduce board registry (`firmware-env -> project dir -> expected board ids -> capabilities`), no more prefix heuristics.
- [x] Switch setup default target to ESP8266; keep ESP32 as explicit secondary target.
- [x] Standardize firmware handshake (`hello` with `board`, `protocolVersion`, `features`, `maxFrameBytes`) for ESP8266 and ESP32.
- [x] Companion reads device capabilities and gates optional fields (for example `theme`) instead of sending blindly.
- [x] Setup uses handshake for early mismatch feedback (`unsupported-hardware`) when board ID is available.
- [x] Align firmware code paths on shared core (parser/state/render policy), board-specific only for pins/display.
- [x] Expand CI/test gates for both targets (Go tests + PlatformIO build for at least one ESP8266 and one ESP32 env).
- [x] Sync operator/setup docs to dual-target and new default.

Acceptance:
- [ ] `vibeblock setup` works out of the box for ESP8266 (default) and explicitly for ESP32.
- [ ] Companion sends only compatible optional features; core usage frames run on both targets.
- [ ] Board mismatch is reported clearly; legacy/no-hello devices remain usable via fallback.

## Product Assumptions (v1)
- In v1 we support two board targets:
  - ESP8266 SmallTV ST7789 (including alt-mapping as separate firmware env)
  - LILYGO T-Display-S3 (ESP32-S3)
- Runtime remains USB serial (no WiFi/BLE).
- Companion stays "smart"; device/firmware stays renderer- and protocol-only.
- Multi-board abstraction is explicitly limited to these two boards in v1 scope.

## Current State (compact)
- Firmware + companion daemon run on macOS with ESP8266 SmallTV and LILYGO T-Display-S3.
- Protocol V1 (`protocol/PROTOCOL.md`) is defined and in use.
- LaunchAgent operation works.
- Provider selection runs deterministically via local activity signals + fallback rules.
- `vibeblock setup` is idempotent and covers flash + install + LaunchAgent.

## Milestone 1: Harden Provider Detection (P0) - completed
Goal: The display reliably shows the most recently active provider.

- [x] Introduced provider adapter architecture (`provider -> activity detector`).
- [x] Documented activity sources and standardized fallback/conflict rules.
- [x] Implemented reproducible switching test matrix.

Acceptance:
- [x] 30/30 deterministic switching scenarios pass (`TestProviderSelectionMatrix30Scenarios`).
- [x] No persistent lock on wrong provider without newer activity events.

## Milestone 2: Runtime Resilience (P0) - completed
Goal: Stable long-running desk operation.

- [x] Hardened USB reconnect, sleep/wake, and failure paths.
- [x] Added structured runtime logs and expanded `doctor` checks.

Acceptance:
- [x] 24h soak test (simulated) with no daemon crash.
- [x] 10x unplug/replug and 10x sleep/wake without manual intervention.

## Milestone 3: Setup "run once" (P0) - completed
Goal: New users can start without manual steps.

- [x] Completed `vibeblock setup`.
- [x] Stabilized port auto-detection + interactive selection.
- [x] Implemented recovery hints and idempotency.

Acceptance:
- [x] Setup works on fresh macOS without manual file copy.
- [x] Service starts automatically after reboot.

## Milestone 4: Dual-Target Hardening (P0)
Goal: Software is robust against real production variance across both board families.

- [ ] Document hardware contract as software artifact (`docs/hardware-contract.md`) for both targets:
  - Board ID/SKU, display controller, resolution, rotation, touch controller (if present), expected USB identity.
- [ ] Firmware sends a clear boot handshake (`board`, `fwVersion`, `protocolVersion`).
- [ ] Companion validates handshake and shows clear `unsupported-hardware` on mismatch.
- [ ] Setup validates target hardware before flashing (early abort + recovery hint).
- [ ] Extend `doctor` with explicit device contract checks.

Acceptance:
- [ ] Wrong/incompatible hardware is detected clearly within 5s (ESP8266 and ESP32).
- [ ] Correct ESP8266 and ESP32 hardware shows a valid frame within 15s after daemon start.

## Milestone 5: Versioning, Upgrade, Rollback (P0)
Goal: Safe updates without re-running full setup.

- [x] Define SemVer and compatibility matrix for `companion` <-> `firmware`.
- [x] Define release process (tagging, artifacts, changelog, checks).
- [x] Build upgrade command with preflight (`port busy`, `version guard`, `flash`).
- [x] Document and script rollback to last-known-good firmware + companion.
- [x] Officially provide known-good recovery firmware.

Acceptance:
- [x] Upgrade from N to N+1 works without re-setup.
- [x] Incompatible versions are blocked with concrete fix hints.
- [x] Rollback path is documented and tested.

## Milestone 6: Observability & Supportability (P1)
Goal: Diagnose field issues quickly without code changes.

- [ ] Structure logs into stable categories + error codes (`transport/*`, `codexbar/*`, `protocol/*`, `runtime/*`).
- [ ] Add optional debug mode with increased detail.
- [ ] Build support-bundle command (doctor output, recent logs, relevant env config).
- [ ] Expand troubleshooting guide for top field failures.

Acceptance:
- [ ] Common support cases are solvable reproducibly with `doctor` + support bundle.

## Milestone 7: Production Gate (Go/No-Go)
Goal: Binding acceptance criteria before first production rollout.

- [ ] Create final Go/No-Go checklist (functionality, stability, setup, upgrade, docs).
- [ ] Run E2E acceptance on at least 2 macOS devices.
- [ ] Introduce release candidate process (RC -> soak -> final).

Go-live criteria:
- [ ] Milestones 4 to 6 completed.
- [ ] No open P0/P1 bugs.
- [ ] Setup, upgrade, rollback, and troubleshooting docs are current.

## Milestone 8: Rich Rendering & Media (P1, post-v1)
Goal: Integrate shapes/GIF/JPG without losing the CodexBar usage core.

- [ ] Finalize protocol v2 draft (`protocol/PROTOCOL_V2_DRAFT.md`).
- [ ] Specify V2 fields as optional extensions (`renderMode`, `shapePreset`, `mediaSlot`, `mediaFit`, `mediaLoop`).
- [ ] Extend companion protocol model, defaults set to `usage`.
- [ ] Extend firmware parser for V2 fields (unknown fields still ignored).
- [ ] Implement layered render pipeline (usage -> shapes -> media -> error override).
- [ ] Define asset manifest format (`/.sys/assets.json`, `slot -> path -> sha256`).
- [ ] Introduce device asset store on LittleFS (slot-based references instead of stream).
- [ ] Implement `vibeblock media sync` (upload + verify + manifest write).
- [ ] Add V2 capability handshake (`protocolVersion`, `features`, `codecs`, `maxAssetBytes`) and validate in companion before V2 use.
- [ ] Make `media sync` atomic (staging dir + checksum verify + commit/swap), so no half-written asset state becomes active.
- [ ] Define V2 schema formally (enums + bounds) and add golden-frame tests for companion/firmware pairs.
- [ ] Integrate GIF/JPG decoder with hard guards (size, timeout, single decoder).
- [ ] Implement decoder resource budgets and guardrails (watchdog-safe decode slices, memory caps, decode retry/backoff).
- [ ] Extend runtime/health with media telemetry (`media/decode-error`, `media/slot-miss`, `media/fallback-count`).
- [ ] Define ESP8266-first render profile (asset limits, allowed resolutions, FPS/loop limits, preferred codecs) and document as baseline.
- [ ] Implement fallback strategy: on asset/decode errors automatically return to usage UI.
- [ ] Expand test matrix: corrupted GIF, missing slot, sleep/wake, reconnect, long soak.

Acceptance:
- [ ] Usage data remains correctly visible in all render modes (except `media_only`).
- [ ] V1 compatibility remains intact (V1 firmware ignores new fields).
- [ ] Broken assets do not cause reboots/hangs.
- [ ] Runtime remains robust under USB reconnect and sleep/wake.
- [ ] ESP8266 baseline remains stable (no OOM/watchdog resets under soak and bad assets).
