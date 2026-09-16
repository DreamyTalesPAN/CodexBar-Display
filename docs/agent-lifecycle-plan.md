# Agent lifecycle implementation — issue #172

Decision, 2026-09-16: use a pinned Clawd-on-Desk engine with a small maintained
headless/observation patch. One feature branch and one PR:
`codex/issue-172-clawd-lifecycle`. This document is the implementation and test
plan, not a declaration that the unchecked gates pass.

## Integration base

| Dependency | Exact inspected head | Treatment |
| --- | --- | --- |
| main | `4a178010ea459beb9f23e33206585b6eeda4db27` | Published-line baseline |
| #407 Cable/WiFi | `b476931710256d20d83876beb19dc6ee1b4f360a` | First predecessor; already contained by #427 |
| #427 setup/usage/provider notices | `47cabe4d565db942af49cad5225bb1e65b82426c` | Feature branch starts here; documented merge order #407 then #427 |
| windows-integration (#434/#439 work) | `b4646a48c0e1ea40c02fc09a249f60df8cf2fe7b` | Integrate platform substrate into this branch; do not merge/release main |
| #447 Claude browser authentication | `0c4f4e8f37e5c1d8ffef72de136ffebbe458a547` | Draft with failing gate; not a lifecycle dependency and not imported |
| #422 Theme Studio prototype | `0335547dcacdde74ef46a86e43d8d3a1190111f0` | Design-only; no implementation dependency |

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
2. [ ] Update #172, finish platform-base integration, record conflicts/resolutions.
3. [ ] Define executable schema/fixtures and capability matrix before wiring UI.
4. [ ] Package the observation engine; harden ingress, lifecycle continuity,
   shutdown, recovery and source discovery. Reuse original upstream adapters.
5. [ ] Add one supervised Companion integration and remove the conflicting old
   activity inference from the authoritative display path.
6. [ ] Expose the same status through Companion API, Control Center and frames;
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
