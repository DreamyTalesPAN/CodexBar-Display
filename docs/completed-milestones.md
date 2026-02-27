# Completed Milestones (Pre-release History)

This document tracks major work that is done and removed from `TODO.md`.

## Completed Milestones

### Milestone 1: Harden Provider Detection (P0)
- Provider adapter architecture (`provider -> activity detector`) introduced.
- Activity sources and fallback/conflict rules documented.
- Reproducible switching matrix implemented.
- Acceptance reached (`TestProviderSelectionMatrix30Scenarios`: 30/30 scenarios pass).

### Milestone 2: Runtime Resilience (P0)
- USB reconnect, sleep/wake, and failure paths hardened.
- Structured runtime logs and expanded doctor checks added.
- Acceptance reached (24h simulated soak stability + repeated unplug/replug and sleep/wake passes).

### Milestone 3: Setup "Run Once" (P0)
- `vibeblock setup` completed as the primary onboarding path.
- Port auto-detection and interactive selection stabilized.
- Recovery hints and idempotency implemented.
- Acceptance reached (fresh macOS setup + auto-start after reboot).

### Milestone 5: Versioning, Upgrade, Rollback (P0)
- SemVer and compatibility matrix defined.
- Release process documented.
- Upgrade with preflight + version guard implemented.
- Rollback and known-good recovery flows documented and scripted.
- Acceptance reached (upgrade/guard/rollback path verified).

## Completed Foundation Tracks

### Refactor & Improvements (execution track)
- Firmware modularization and shared interface shape completed.
- Theme registry centralized across protocol, firmware, and companion.
- Setup/runtime configuration precedence completed (`CLI > ENV > runtime config > firmware default`).
- USB transport decoupling + serial integration test coverage completed.
- Error taxonomy + recovery guidance standardized.
- CI quality gates, firmware size budgets, and runtime benchmarks integrated.

### Dual-Target Merge Baseline (execution track)
- Board registry and dual-target setup defaults completed.
- Firmware hello handshake (`board`, `protocolVersion`, `features`, `maxFrameBytes`) standardized.
- Companion capability gating for optional fields implemented.
- Shared firmware core aligned across ESP8266/ESP32 code paths.
- CI coverage and docs aligned for both targets.
