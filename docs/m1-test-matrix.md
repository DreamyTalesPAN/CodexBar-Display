# Milestone 1 Test Matrix

This matrix validates robust provider detection while keeping firmware dumb.

## Execution Modes

- Deterministic regression (30 scenarios): `cd companion && go test ./internal/codexbar -run TestProviderSelectionMatrix30Scenarios -v`
- Hardware smoke checks (single-session): `doctor` + `daemon --once` against the connected device.

Hardware smoke commands:

```bash
cd companion
go run ./cmd/vibeblock doctor
go run ./cmd/vibeblock daemon --port /dev/cu.usbmodem101 --once
```

## Deterministic Scenario Matrix (30)

| ID | Category | Repro Step | Expected Result |
|---|---|---|---|
| 01 | Switch | Use Codex once, then wait one poll | Display switches to Codex |
| 02 | Switch | Use Claude once, then wait one poll | Display switches to Claude |
| 03 | Switch | Codex -> Claude within 1 minute | Ends on Claude |
| 04 | Switch | Claude -> Codex within 1 minute | Ends on Codex |
| 05 | Switch | Codex active, Claude idle 5+ min | Stays on Codex |
| 06 | Switch | Claude active, Codex idle 5+ min | Stays on Claude |
| 07 | Switch | Codex usage increases only | Codex selected via usage delta |
| 08 | Switch | Claude usage increases only | Claude selected via usage delta |
| 09 | Switch | Both usage increase, Codex session increase is larger | Codex selected |
| 10 | Switch | Both usage increase, Claude session increase is larger | Claude selected |
| 11 | Switch | Weekly-only increase on Codex | Codex selected |
| 12 | Switch | Weekly-only increase on Claude | Claude selected |
| 13 | Conflict | Codex and Claude activity within 15s, current is Codex | Keep Codex |
| 14 | Conflict | Codex and Claude activity within 15s, current is Claude | Keep Claude |
| 15 | Conflict | Conflict window + no current + Codex delta stronger | Codex selected |
| 16 | Conflict | Conflict window + no current + Claude delta stronger | Claude selected |
| 17 | Conflict | Conflict window + equal deltas + Codex first in CodexBar list | Codex selected |
| 18 | Conflict | Conflict window + equal deltas + Claude first in CodexBar list | Claude selected |
| 19 | Conflict | Activity timestamp older than `VIBEBLOCK_ACTIVITY_MAX_AGE` for Codex | Codex local activity ignored |
| 20 | Conflict | Activity timestamp older than `VIBEBLOCK_ACTIVITY_MAX_AGE` for Claude | Claude local activity ignored |
| 21 | Idle | No new local activity, no deltas for 3 polls | Sticky provider remains |
| 22 | Idle | Sticky provider disappears from CodexBar output | Fallback to first CodexBar provider |
| 23 | Idle | Codex reset timer jumps up with no session increase | Codex selected via resetGain |
| 24 | Idle | Claude reset timer jumps up with no session increase | Claude selected via resetGain |
| 25 | Error | Temporarily break CodexBar binary path | Error frame or stale-last-good (if available) |
| 26 | Error | Restore CodexBar binary path | Normal provider frame resumes |
| 27 | Error | Force serial port unavailable | Cycle logs serial error, no crash |
| 28 | Error | Reconnect serial port | Frame sending resumes automatically next cycle |
| 29 | Error | Codex returns `openai-web` with `0/0` | CLI repair kicks in; Codex frame recovers |
| 30 | Error | Multiple concatenated CodexBar JSON payloads | Parser tolerates output; frame still sent |

## Hardware Smoke Checks

| ID | Check | Expected Result |
|---|---|---|
| HS-01 | `vibeblock doctor` | CodexBar binary detected, serial port listed, provider preview returned |
| HS-02 | `vibeblock daemon --port /dev/cu.usbmodem101 --once` | Frame is sent to device with `reason`/`detail` in log output |

## Pass Criteria

- 30/30 deterministic scenarios pass (target error rate < 1/30 exceeded).
- Hardware smoke checks HS-01 and HS-02 pass on target setup.
- No persistent wrong-provider lock without a newer activity event in deterministic conflict/sticky tests.
- Logs always show `reason=` and `detail=` for diagnosis.
