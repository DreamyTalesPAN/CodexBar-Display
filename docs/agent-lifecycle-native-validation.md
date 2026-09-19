# Native observation validation — 2026-09-19

Platform: this ARM Mac, Claude Code 2.1.273 and the running Codex Desktop session.
Engine: the pinned Clawd revision in `integrations/clawd/upstream.lock.json`,
packaged Node 22.23.2 plus the current fork overlay. Tests used the actual
observation installer with invocation-only Claude settings. Customer-global
agent settings and the connected VibeTV were not modified.

| Test | Observed result |
| --- | --- |
| Claude print-mode Read | idle → working → tool_use → working → done; CLI exit can precede Clawd's deferred completion and briefly display unavailable |
| Native Write permission | Native Yes/No dialog stayed in Claude; helper reported waiting_for_permission |
| Native Yes once | The scratch file was created only after choosing Yes; native question followed |
| AskUserQuestion | waiting_for_answer while the Blue/Green menu was visible; selecting Blue continued the original task |
| Completion and child | Parent reached done, then idle; later background-child completion did not restart it; child remained separate |
| Native No | The scratch file remained absent; exact tool-result evidence changed waiting_for_permission to error |
| Native plan review | waiting_for_review while Claude showed its ExitPlanMode review dialog; Escape cancelled the review and exact failure evidence cleared the wait |
| Manual /compact | compacting → idle in the generated-hook interactive run |
| Codex concurrently | The current real Desktop session appeared separately as tool_use |
| Companion API | A locally built Companion with its adjacent packaged helper exported that real Codex session through /v1/status.agents |
| Helper SIGKILL | Companion exported unavailable with zero sessions, then restarted with a new helper instance |
| Companion shutdown | Its child helper exited; the authenticated endpoint file was removed |

The real No test caught a contract gap that a synthetic callback did not:
[Claude's PermissionRequest](https://code.claude.com/docs/en/hooks#permissionrequest)
omits `tool_use_id`, and manually declining a dialog does not emit the usual
PostToolUseFailure callback. The Clawd overlay reuses upstream's bounded
transcript reader and correlates only a unique unresolved tool with the same
session, name and complete input. Only its exact result settles the wait.
Ambiguous, unrelated and missing records do not settle it. No transcript text,
input or path leaves the metadata export; the observer emits only neutral `{}`.

A second native regression was Clawd's visual SubagentStop bookkeeping clearing
the parent completion flag. Explicit child events now update their separate
entry in Clawd's same bounded session map before parent bookkeeping can run.
Both failures have executable regressions alongside the original adapter tests.

Local evidence, metadata only:
- `/tmp/CODEX-172-interactive/transitions.jsonl`
- `/tmp/CODEX-172-native-check/report.json`
- `/tmp/CODEX-172-product-runtime/report.json`

The Companion run used an isolated customer home and a loopback-only device
target; usage was supplied by the repository fixture. Its agent data was real.
This proves the engine/Companion path, not a physical display or real quota read.

Still open: native Windows installation and DPAPI execution, interrupted running tools, helper restart while a native question remains open,
sleep/resume, other clients' native acceptance, signed upgrade/rollback,
visible UI approval and separately approved Cable/WiFi device qualification.

Read-only bench check at the end of this run: the installed Companion selected
`virtual-vibetv-001` at a loopback address (not connected). A complete
`POST /v1/device/search` returned no devices. No pairing, selection, firmware,
theme or frame writes were attempted on physical hardware.
