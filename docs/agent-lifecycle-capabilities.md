# Clawd integration coverage — issue #172

This is an evidence matrix, not a list of fully qualified providers. Client
integrations belong to Clawd; usage providers remain owned by CodexBar.
All 12 lifecycle phases exist in the contract. Unsupported distinctions are
coarse work or unavailable; no prompt/animation is treated as reasoning.

| Client | Current connection | Executable coverage | Native product evidence on this Mac |
| --- | --- | --- | --- |
| Claude Code | Managed observation hooks | Original payload builder + ingress + install/update/remove (Mac/Windows command forms) | Real generated-hook CLI: Read, Write allow/deny, AskUserQuestion, plan review/cancellation, compaction, completion and late child completion |
| DeepSeek Harness (web, experimental) | Not yet connected | Declared ingress only | Not run |
| Codex CLI | Automatic local log monitor | Original payload builder + ingress | Live desktop session |
| Copilot CLI | Managed observation hooks | Original payload builder + ingress + install/update/remove (Mac/Windows command forms) | Not run |
| Gemini CLI | Managed observation hooks | Original payload builder + ingress + install/update/remove (Mac/Windows command forms) | Not run |
| Antigravity CLI | Managed observation hooks | Original payload builder + ingress + install/update/remove (Mac/Windows command forms) | Not run |
| Cursor Agent | Not yet connected | Declared ingress only | Not run |
| CodeBuddy | Not yet connected | Declared ingress only | Not run |
| Kiro CLI | Not yet connected | Declared ingress only | Not run |
| Kimi Code | Not yet connected | Original payload builder + ingress | Not run |
| Qwen Code | Managed observation hooks | Original payload builder + ingress + install/update/remove (Mac/Windows command forms) | Not run |
| ZCode | Not yet connected | Original payload builder + ingress | Not run |
| CodeWhale | Not yet connected | Declared ingress only | Not run |
| OpenCode | Not yet connected | Declared ingress only | Not run |
| MiMo Code | Not yet connected | Declared ingress only | Not run |
| Pi | Not yet connected | Declared ingress only | Not run |
| OpenClaw | Not yet connected | Declared ingress only | Not run |
| Hermes Agent | Not yet connected | Declared ingress only | Not run |
| Qoder | Managed observation hooks | Original payload builder + ingress + install/update/remove (Mac/Windows command forms) | Not run |
| Reasonix | Not yet connected | Declared ingress only | Not run |
| QoderWork | Managed observation hooks | Original payload builder + ingress + install/update/remove (Mac/Windows command forms) | Not run |
| QwenWork | Managed observation hooks | Original payload builder + ingress + install/update/remove (Mac/Windows command forms) | Not run |
| WorkBuddy | Not yet connected | Declared ingress only | Not run |
| TraeCode | Not yet connected | Declared ingress only | Not run |
| Grok Build | Not yet connected | Declared ingress only | Not run |

Native Windows execution is pending. Command-format fixtures and cross-compiling
Go are not Windows runtime proof. CI now runs the packaged engine on Mac and
Windows; the full installed-agent/hardware matrix remains separate.

No registered client currently advertises verified explicit reasoning support.
Claude native question/review tools and elicitation have explicit wait mapping.
Permission events are treated as waits only when upstream marks them as actual
approval events; QwenWork/QoderWork's frequent passive events remain work.

The remaining original integrations need an observation-only entry point or
installer before activation: they must not reuse an upstream permission
responder, fixed/default session identity or global account/status-line writes.
The bundled source keeps these implementations available for follow-up porting
and pin upgrades without rebuilding their parsers inside the Companion.


Product-path evidence is recorded in `agent-lifecycle-native-validation.md`.
New profiles start with Agent activity off; saved choices are preserved.
The Show agent activity master switch installs observation hooks for every
supported hook adapter together; switching it off removes only VibeTV-owned
hooks. Codex uses its automatic local log monitor. There are no per-agent
connection controls or public per-source configuration endpoint. All native
configurations are validated before the batch writes; failures do not report
success. Installed hooks refresh on app startup for previously enabled clients;
foreign hooks and native permissions remain unchanged. This covers hook
migration, not a signed Sparkle/NSIS installation or rollback rehearsal.

New firmware advertises `agent-activity-v1` for all phases and its 15-second
activity lease. Older firmware receives legacy `coding`/`idle`; it cannot gain
the new writer-loss expiry without a firmware update.

Disabling the master clears existing observations through upstream session cleanup
and ignores HTTP hook ingress until enabled again, including in-flight requests
from before the toggle. A restarted engine receives the saved master choice from
the Companion. Codex local log observation remains passive and may supply fresh
events while display activity is off; old hook states cannot replay on re-enable.
