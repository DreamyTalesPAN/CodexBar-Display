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
6. [ ] Expose the same status through Companion API and frames (implemented);
   design and implement customer presentation after the independent design pass.
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

## Presentation reset, 2026-09-19

At the user's request, the issue #172 Control Center presentation, its browser
wiring/types and UI-specific tests were removed. The new lifecycle-to-animation
mapping was also removed from both browser and firmware renderers. The #427
setup/usage/provider UI and its main-integration fixes remain intact.

The engine, managed observation hooks, session semantics, Companion API,
packaging and device protocol/expiry remain implemented. Full-phase transport
is not a finished visual treatment: existing renderers again recognize only
their previous `coding` asset condition. Customer presentation and device
animation behavior must be designed and tested before release. The independent
brief is `agent-lifecycle-design-brief.md`; it prescribes no UI placement.
Earlier screenshots and presentation test results are historical evidence,
not the current UI or approval. The earlier presentation approval request is
superseded by this reset.

Rollback validation: 677 Control Center unit tests, TypeScript, customer-copy
guard, the customer browser smoke suite and 150 native firmware renderer/core
tests pass. Source comparison against `013eff6e` confirms the prior frontend
components are restored (apart from an existing trailing-whitespace cleanup);
only #427 provider-dialog test corrections remain in the browser test runner.
No device writes were performed.

## Implementation evidence before presentation reset, 2026-09-19

- Main integration preserves Windows provider sign-in, the current serial
  discovery deadline and alternative-transport recovery. #427 owns theme-first
  setup, usage mode and inline provider guidance. Removed duplicate brightness
  controls and retained local Back navigation required by the new step order.
- 682 Control Center unit tests, TypeScript and customer-copy checks pass.
  Desktop/mobile lifecycle browser flow passes (two independent sessions,
  explicit connect/disconnect, collector-loss clears displayed work). The full
  customer-flow suite also passes after reconciling #427's removed dialogs.
  The new lifecycle case is part of that regular suite, not only its focused flag.
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
  transport; the full Go suite is green. The inherited parallel-discovery
  assertion now separates legitimate concurrent Cable ownership from WiFi
  ownership and passes 20 consecutive runs. Process tests exercise invalid-output restart, the silent-child
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

## Theme implementation, 2026-09-20

The approved device treatment is now implemented on this feature branch:
central agent label, five-state asset selection, and exactly two full-panel
inversions for states without custom assets. The new `agent-theme-states-v1`
capability gates packs and wire fields. Mini 1.2.1, Tiny Office 0.7.0, Claude
Creature 1.3.0, Synthwave 1.2.0, and Pixel Battery 1.17.0 are versioned together
with the runtime. Battery/Synthwave and future themes reuse the shared fallback
without per-theme announcement assets. Synthwave uses font 2 in its existing
heading slot; Battery uses four more pixels of its empty right margin so the
observed Claude Code error label fits.

The separate Control Center lifecycle presentation removed above remains outside
this theme implementation. Native Windows, signed update, and physical-device
release evidence is still required; local builds cannot substitute for it.

Local validation for this theme implementation:

- 687 Control Center unit tests, TypeScript, lint (three pre-existing warnings),
  customer-copy and UI review gates pass. Full customer browser flows and the
  separate Theme Studio safety suite pass; the Studio fixture now advertises
  the text-alignment and state capabilities of the firmware it simulates.
- 153 native firmware tests and both ESP8266/ESP32 builds pass. Coverage includes
  pulse boundaries and timer wrap, quiet activation/idle, dedicated assets,
  animation-off, notice priority, and expiry of explicit idle observations.
- 66 packaged engine tests, Go tests/vet/staticcheck, frame budget/soak checks,
  virtual-device cold/warm and provider-less theme-install checks pass.
- Theme source, ZIP and immutable-history checks pass. Original Office baseline
  frames are reconstructed pixel-for-pixel; the Mini eyes GIF is unchanged.
  The production preview was inspected in a browser with all five render packs,
  including hard inversion steps, state changes, and animation-off.

The next physical canary must check controller inversion polarity and two visible
pulses, six-tile Office cadence/heap under WiFi load, sprite transitions, update
notice priority, and writer-loss expiry over both Cable and WiFi. No connected
VibeTV was written to. This remains a feature-branch candidate; publishing packs,
merging main, and release actions are separate approvals. CI/review evidence is
recorded on the PR for its exact pushed head.

CI integration follow-up: the first Codex review found the inherited macOS
runtime pin still at 0.46.0 while #427 ships 0.56.8. The Companion version/hash
now match the shipped manifest; a manifest regression and real signed-archive
staging test pass. The Windows hook-refresh test inspects the decoded command.
The first firmware candidate exceeded the unchanged size gate; shared slot and
state-asset loops plus removal of duplicate frame initialization now pass all
153 native cases within 46.0% flash, 60.1% static RAM, 485104-byte binary and
343115-byte gzip. Runtime tile cadence/heap still needs physical proof. Empty
agent names skip unnecessary normalization in the frame benchmark. The Mini
vector golden changes only for the intentional single-frame GIF representation
under reduced motion; the focused browser preview suite passes.

The second Codex review identified a missing producer for the device animation-off
flag. The central outgoing-frame path now reads the host's motion preference on
macOS and Windows and negotiates it with `agent-theme-states-v1`; older firmware
still receives no unsupported flag. Regression coverage checks on/off changes in
actual outgoing JSON and the acknowledged-frame log. That log and its API parser
also retain the observed agent name and motion setting, so the live device preview
uses the same presentation as the sent frame. System preferences were only read;
no OS setting or physical device was changed.

## USB bench follow-up, 2026-09-21

The user authorized unsigned quick DMGs and firmware on the connected Mac and
VibeTV. Device `14799300` (`esp8266-smalltv-st7789`, `/dev/cu.usbserial-10`) was
flashed at 115200 baud with local firmware `1.0.58-dev`; esptool verified the
written hash. Firmware artifact SHA-256:
`e9a9ff5a4ffd5ce87e46bc41be769a4de22ddfbebd1fd5fa9c669bf0dc7ae634`.
Its firmware sources are unchanged from `91a8f697` through the tested runtime
`e5978988`. This is a local development image, not a signed release candidate.

The installed Companion paired device `14799300`, selected Cable, established a
healthy usage stream, and completed all five theme installs through its normal
API. Controlled USB frames then exercised idle, working, needs-you, done and
error, followed by motion-off, with device health read back after each state.
These frames use explicit test values; they are not evidence of real agent
lifecycle observation or real quota values.

Mini 1.2.0 exposed `low_heap_cba_buffer`: its GIF decoder left 7,608 bytes free
before the additional 8,192-byte CBA buffer. Mini 1.2.1 / revision 8 replaces
the current eyes GIF primitive with CBA. It preserves the source eye artwork
and 14-second loop, sampled at 4 fps with a 26-color palette; it does not retain
the GIF's exact intermediate frames or timing. Historical packs and the source
GIF remain byte-exact. Corrected pack SHA-256:
`c7b8657e2790523b546f64699d33286335d7188c0723212f99fbcf028ab19b16`.

Battery and Synthwave passed all state health checks on one uninterrupted boot.
The corrected Mini, Creature and Office passed on a second uninterrupted boot:

| Theme | Lowest free heap | Lowest contiguous block | Render or buffer allocation failures |
| --- | --- | --- | --- |
| Mini 1.2.1 | 14,224 bytes | 10,136 bytes | 0 |
| Creature 1.3.0 | 22,536 bytes | 21,480 bytes | 0 |
| Tiny Office 0.7.0 | 10,680 bytes | 5,200 bytes | 0 |

Mini and Office completed animation frames, and their CBA counters stopped with
motion disabled. Creature's imported poses are static. Physical inversion
polarity, exactly two visible pulses, sprite appearance and whole-scene cadence
still need the operator's visual confirmation. WiFi load, writer-loss expiry,
update-notice priority, Windows and signed release rehearsals remain separate.

The first local helper build omitted the embedded frontend; rebuilding with
the existing workflow's `controlcenter_static` staging corrected HTTP 503.
The UI automation's background app launch showed a blank native window, although
measured web-view bounds were already nonzero. Opening normally through Finder
rendered the UI without a reload or resize. The speculative sizing change and
diagnostic logging were removed; neither is needed for the observed foreground
launch.

The subsequent review found that an initial usage-collection error could hide a
valid independently observed agent state. On capable firmware, the outgoing frame
now carries that state with explicitly unavailable usage. The usage error remains
in the cycle result and API; legacy firmware and unavailable/stale observations
retain the existing error presentation. Regression tests cover both paths.
Raw bench logs and the local artifact manifest are retained under the ignored
`tmp/agent-theme-canary/` directory. Nothing was published to the theme catalog,
merged to main, tagged or released.

## Settings and reset follow-up, 2026-09-21

Source: Claude Design `Control Center - Agent Activity.dc.html`, project
`36eb7a1c-bd59-42f0-b120-3f1eb3905e4b`, etag `1789894480238945`.
The four approved controls are implemented through the existing preferences
registry: Show agent activity, Blink the screen, Remind me again (5/15 minutes
or never), and Quiet from (off, 22:00–08:00, 00:00–07:00). They persist in
VibeTV's existing locked runtime config; provider settings stay with CodexBar.
The master switch affects presentation, not observation. Quiet hours use the
host's local timezone, preserve status text and artwork, and suppress pulses.
Host Reduce Motion still overrides all animation. Reminders use the same two
pulse announcement and stop when the observed waiting state ends. Paul explicitly requested blinking for all themes, with the same off switch.
Sprite themes retain their artwork and also receive the shared inversions.

The photographed single row is Codex's weekly usage. The installed CodexBar
0.56.8 executable itself returned `primary: null`, a weekly secondary window
and `tertiary: null`; the snapshot, usage API and acknowledged device frame
all retain that single known window. No synthetic second limit is introduced.

Reset seconds previously caused a second repaint path on every incoming frame.
Countdown repainting now belongs to the local reset tick, which compares the
last rendered display bucket (hours above one day, minutes below one day).
Only bound countdowns with changed text are redrawn; unrelated partial draws
no longer mark undrawn countdowns as updated. The obsolete minute-bucket cache
was deleted. The same display comparison also applies to the ESP32 reset tick.

The ESP8266 build remains within the original 46.0% flash warning and hard
limits of 486,000 firmware bytes, 350,000 gzip bytes and 82% RAM. Removing the
per-sprite blink exception offsets the settings cost. Reset diagnostics count
actual redraws rather than no-op checks of unbound provider clocks.
