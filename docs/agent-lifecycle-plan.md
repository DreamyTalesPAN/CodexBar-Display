# Agent lifecycle implementation — issue #172

Decision, 2026-09-16: use a pinned Clawd-on-Desk engine with a small maintained
headless/observation patch. One feature branch and one PR:
`codex/issue-172-clawd-lifecycle`. This document is the implementation and test
plan, not a declaration that the unchecked gates pass.

## Integration base

| Dependency | Exact inspected head | Treatment |
| --- | --- | --- |
| main | `db281000054c4b42c42f6d84b881565a2077de73` | Updated 2026-09-19; Windows support/signing, #407 and #447 are now merged |
| #427 setup/usage/provider notices | `47cabe4d565db942af49cad5225bb1e65b82426c` | Still open; inherited dependency, reconciled with current main |
| #407 Cable/WiFi | Final implementation on main | Use main's bounded parallel discovery, device identity and cross-transport recovery |
| #447 Windows provider sign-in | Final implementation on main | Preserve Windows sign-in actions and inventory gating alongside #427 inline notices |

Published baseline inspected: v1.0.58. The preliminary windows-integration merge
is superseded by the shared main implementation. Mac CodexBar 0.56.8 is inherited
from #427; Windows keeps main's pinned Win-CodexBar 0.60.3-vibetv.3.

The single PR must describe inherited dependency commits separately. Reconcile
against the final merged predecessor heads before calling it merge-ready.
Existing Cable/device-readiness and theme-first setup behavior must survive.

## Ownership and deliverable

`native hooks/logs -> Clawd engine -> versioned local snapshot -> Companion ->
Control Center / device frame / compatible themes`.

- Clawd owns all source parsing, hooks, process/session identity, reconciliation,
  source capabilities, lifecycle semantics and bounded completion indication.
- VibeTV supervises the packaged helper, validates/bounds its generic contract,
  transports one snapshot and renders it. No provider-specific parser in Go or
  the browser; no parallel session database or quota-based activity inference.
- CodexBar exclusively owns usage, authentication and quotas. A client is not a
  quota provider. Unknown source-to-provider identity must not guess or switch
  the displayed provider. Manual provider choice wins.
- The helper cannot approve, deny, answer, send prompts or control agents. It
  must not start desktop UI, quota collection or unrelated network services.
- Pin upstream source and runtime, preserve a small inspectable patch, license
  and modification provenance, and ship verified platform artifacts with the
  app. No second customer installer/updater and no runtime download of latest.
- Clawd is AGPL-3.0-only. Keep its complete corresponding modified source,
  build instructions and notices available with distribution. No mascot/assets
  are reused. Process separation is not asserted to be a license exemption.

## Contract to implement

Schema-versioned snapshots with engine version, collector health, generated
time, stable session/parent identity, source and capabilities, observed time,
turn/completion identity where the source supplies it, and optional verified
provider association. Export only bounded metadata; no prompt, reasoning,
command, answer, transcript path or working-directory contents.

Phases: `idle`, `working`, explicit `thinking`, `tool_use`, `compacting`,
`waiting_for_permission`, `waiting_for_answer`, `waiting_for_review`, bounded
`done`, `error`, `stale`, `unavailable`. Unsupported distinctions remain unknown
or a truthful coarser phase. Ordinary idle awaiting the next prompt is not a
question. Tool failure and terminal failure remain distinguishable.

Collector heartbeat, last lifecycle observation and agent/process liveness are
different facts. Quiet long-running work must not become idle on a timer.
Missing collector/source evidence must never imply healthy ongoing work.
Completion must not replay after reconnect/restart. Concurrent sessions and
subagents remain separate before deterministic aggregation.

Legacy themes retain the existing coding/idle contract with bounded device
freshness; capable themes can consume the full phase. Activation and stopping
must reach the display within 10–15 seconds; test both directions. Device
writer disappearance must clear active animation within the device's bound.

## Implementation order

1. [x] Select Clawd and record source-backed feasibility/native evidence.
2. [x] Update #172, finish platform-base integration, record conflicts/resolutions.
3. [x] Define executable schema/fixtures and capability matrix before wiring UI.
4. [ ] Package the observation engine; harden ingress, lifecycle continuity,
   shutdown, recovery and source discovery. Reuse original upstream adapters.
5. [x] Add one supervised Companion integration and remove the conflicting old
   activity inference from the authoritative display path.
6. [x] Expose the same status through Companion API, Control Center and frames;
   update compatible theme/firmware handling without breaking older themes.
7. [ ] Bundle helper/runtime in Mac and Windows app builds and normal updates.
8. [ ] Run the matrix below; open/update the one PR as a draft until gates pass.

## Tests and acceptance matrix

| Layer | Required evidence |
| --- | --- |
| Engine contract | Invalid/oversized records rejected; schema/version bounds; deterministic ordering; metadata redaction; all phase meanings/capabilities |
| Native-event regression | PermissionRequest followed by Notification retains wait; native AskUserQuestion works without PermissionRequest; manual PostCompact returns idle; completion survives idle notifications |
| Session correctness | Same project/different sessions; duplicate and out-of-order callbacks; child/parent isolation; turn end; interrupted tools; helper restart/reconnect without replayed done |
| Liveness | Long quiet work; agent exit/crash; collector loss; sleep/resume; source unavailable; timestamp skew; bounded memory |
| Observation-only | Native approval/question/review stays in client; no decision body or steering endpoint; denial/error/timeout does not bypass native behavior |
| Hook lifecycle | Existing user hooks preserved; idempotent enable/disable/update; quoted paths including spaces; no stale versioned paths; unavailable agent diagnostics |
| Companion | Helper missing/crash/invalid output; cancellation/restart; fresh vs stale; race tests; no CodexBar/usage semantics change; manual provider mode |
| UI/protocol | All phases, unavailable source, multiple sessions; existing setup (#407/#427); one authoritative API; v1/v2 wire budget and legacy fallback |
| Platform packaging | Mac arm64/x64 and Windows x64 artifacts; pinned source/runtime hashes; source/license notices; same schema; upgrade and rollback rehearsal |
| Real agents | Desktop Codex, CLI Codex, interactive Claude; remaining Clawd adapters individually marked declared/fixture/native Mac/native Windows, never one blanket support checkbox |
| Physical device | Named connected device, Cable/WiFi separated; real state transition and 10–15s timing both ways; writer loss; old/current theme and firmware compatibility |
| Release readiness | Exact-SHA CI and Codex review; signed update/package and physical evidence remain separate from unit/cross-build results |

Baseline native evidence (local research `CODEX-agent-status-evaluation/
feasibility/native-live/REPORT.md`): working/tool/done/idle on real Codex and
Claude; real Claude approval/question/compaction after three export corrections;
real auth error. 518 focused upstream tests and both pinned-version contract
probes pass. This is not native Windows, review-wait, installed-hook migration,
sleep/resume, packaged update or physical display qualification.

Known breadth gaps to resolve or visibly disclose per source: Kiro fixed session
ID, Gemini hooks' explicit decision output, Codex active-compaction absence,
headless Claude handling, and reliable review/thinking signals. Do not reduce
the state model or quietly label all registered adapters fully supported.

## Hardware boundary

The user reports a connected VibeTV. Read-only identity/health checks are allowed.
Before an actual frame/theme/firmware write, name the discovered device, exact
operation and risk and obtain the specific confirmation required by AGENTS.md.
Prepare the runnable test first; do not use that final boundary to delay local
implementation or checks. No main merge, tag or release is authorized here.

## Implementation evidence, 2026-09-19

- Main integration preserves Windows provider sign-in, the current serial
  discovery deadline and alternative-transport recovery. #427 owns theme-first
  setup, usage mode and inline provider guidance. Removed duplicate brightness
  controls and retained local Back navigation required by the new step order.
- 682 Control Center unit tests, TypeScript and customer-copy checks pass.
  Desktop/mobile lifecycle browser flow passes (two independent sessions,
  explicit connect/disconnect, collector-loss clears displayed work).
- 66 engine tests pass. Eight original hook builders have an owned installer:
  Claude Code, Gemini CLI, Copilot CLI, Qwen Code, Qoder, QoderWork, QwenWork,
  Antigravity CLI. Codex logs are automatic. Three additional pure builders
  (Codex, Kimi, ZCode) are fixture-covered but not all have managed installers.
  See `agent-lifecycle-capabilities.md`; the other upstream registrations are
  deliberately not advertised as installed integrations.
- Packaged runtime observed a real Claude print-mode Read task with the actual
  installer-generated settings: idle -> working -> tool_use -> working ->
  unavailable during Clawd's deferred finalization -> done. The final state is
  retained briefly after CLI exit. The same helper observed this running Codex
  session. Both exited cleanly and removed the authenticated endpoint file.
  Interactive runs with these generated hooks also verified native Write
  approval/denial, AskUserQuestion, plan review/cancellation and late child completion without resetting
  the parent. Manual denial omits both the normal failure callback and the
  tool ID on PermissionRequest; exact transcript correlation now settles it.
  No global agent settings were changed. See `agent-lifecycle-native-validation.md`.
- Go tests, focused race tests and Windows cross-compilation cover the
  transport; the full Go suite is green. Process tests exercise invalid-output restart, the silent-child
  watchdog and cancellation. A real packaged Companion observed the running
  Codex session, cleared activity after helper SIGKILL, restarted automatically
  and reaped the helper on shutdown.
  The #427 used/remaining setting now reads and writes Win-CodexBar's existing
  `show_as_used` field using the existing secure-file/DPAPI adapter. Plain and
  encrypted-fixture preservation tests pass; native DPAPI tests await CI.
- 151 native firmware tests and both ESP8266/ESP32 builds pass. New activity
  expires on the device after 15 seconds without frames, and legacy coding
  assets are reused for working/thinking/tool_use/compacting. Preview matches.
  The new `agent-activity-v1` capability negotiates full phases; old firmware
  retains `coding`/`idle` and does not claim the new writer-loss lease.
- Bundle build paths now include the pinned runtime and complete corresponding
  source on Mac/Windows. A universal Node binary was built and ad-hoc signed
  with JIT entitlement, then executed on this ARM Mac. Bundle contract passes.
  Already enabled hooks refresh during startup using the new bundle and the
  upstream version-compatible event list. Migration/removal fixtures preserve
  foreign hooks and permissions. No signed update or native Windows
  installation has been rehearsed here.
- Remaining release gates: native Windows execution/installer, installed native
  interrupted tools, sleep/resume and hook-wait recovery cases, signed cold/warm update,
  exact visible UI approval, real device Cable/WiFi transitions and exact-SHA
  CI/review. No hardware writes, merges or releases were performed.
