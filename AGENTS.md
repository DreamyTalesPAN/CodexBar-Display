Use this naming convention for n8n workflows: always prefix the name with CODEX. Do the same for GitHub repositories.
Before using trial and error on an error, search for the error or read the official documentation first.
When the task is complete, do not overwhelm the user with "If you want, I can..." suggestions unless they are genuinely useful.
When writing in German, use umlauts.
Before building anything, check once per chat whether the remote branch is ahead of the local branch. If it is, fetch first. Perform this check only once per chat.

## Primary Development Principle: Maximum Simplicity, Minimum Code

- The goal of every change is the desired outcome with as little code, complexity, state, abstraction, and special-case handling as possible.
- Always work in this order:
  1. Delete unnecessary code.
  2. Simplify or consolidate existing code.
  3. Write new code only when the first two steps are insufficient.
- Before adding code, check whether deleting or simplifying existing code can achieve the goal.
- Prefer one small central solution over multiple local special cases.
- Do not add speculative abstractions, frameworks, configuration options, fallbacks, or compatibility layers without a concrete current requirement.
- When multiple solutions are correct, choose the one with less code and fewer moving parts.
- Before finishing, review the complete diff against `main` and remove everything that is not strictly required for the desired outcome.
- Simplicity does not mean omitting required functionality, tests, error handling, or safety mechanisms.

## CodexBar Integration Boundary

- CodexBar owns provider integrations, provider-specific behavior, usage-window meaning, authentication, quota mapping, and provider errors.
- Before changing usage behavior, inspect the exact bundled CodexBar version and its real output. Do not infer the contract from an older release, upstream `main`, or VibeTV wrappers.
- The Mac App is a thin, provider-neutral adapter. It may supervise CodexBar, transport generic data, enforce the device wire budget, and keep one bounded last-good state. It must not reimplement provider semantics.
- Keep one authoritative usage path. Do not add provider-specific probes, alternate CLI fallbacks, duplicate caches, duplicate freshness rules, or browser-owned usage state.
- Preserve the distinction between collection freshness, provider activity, token-history freshness, manual-refresh state, and the last sent device frame.
- Missing, unavailable, stale, or synthetic data must stay visibly unavailable. Never invent windows, percentages, reset times, or readiness.
- Diagnose usage bugs end to end before editing: bundled CodexBar output -> collector -> persisted snapshot -> Companion API -> Control Center -> VibeTV frame.
- Fix usage bugs in this order: remove the conflicting local rule, remove a duplicate data path, reuse the existing central owner, and only then add code.

## Customer Rehearsal (Cold And Warm Start)

Every change to the VibeTV product is validated on the connected bench Mac with
both rehearsal scripts before it is handed over, and the real screen is shown.
Green unit tests, green CI, and a healthy Companion API say nothing about what
the customer sees. A message can point at an action that does not exist in the
UI, and only the rendered screen shows that.

- `scripts/vibetv-rehearse-cold-start.sh` -- wipes every VibeTV and CodexBar trace from this Mac, then installs the Mac App and firmware from the candidate under test. No update path: the "unboxed today, already on the new build" state.
- `scripts/vibetv-rehearse-warm-start.sh` -- restores today's public customer state (current public Mac App + released firmware), then publishes the candidate so both updates appear in the Updates tab. You drive the visible customer flow yourself: Mac App through Sparkle first, then firmware.
- Shared logic lives in `scripts/lib/vibetv-rehearsal.sh`. Both take `--main`, `--pr <number>`, `--run-id`, `--device-target`, `--companion-override`, `--keep-codexbar`, `--restore`, `--yes`; warm start also takes `--skip-firmware-baseline`.

`--main` is what a release is validated with: the current `main` tip is the
candidate, tested against the published customer state. It resolves the release
candidate built from that exact SHA and stops when there is none, instead of
reaching for a different candidate.

```bash
scripts/vibetv-rehearse-cold-start.sh --main
scripts/vibetv-rehearse-warm-start.sh --main
scripts/vibetv-rehearse-cold-start.sh --pr 348
scripts/vibetv-rehearse-cold-start.sh --restore
```

`--companion-override` swaps a locally built Companion into the installed,
notarised bundle and re-signs it ad-hoc. `SMAppService` still holds the
Developer ID launch constraint from the production install, so the app's own
runtime registration fails and the Mac App stops at "VibeTV's background service
couldn't start" however healthy the Companion is. Use the override for
companion- and API-level checks only. It now refuses outright unless the binary
carries the installed app's version: a plain `go build` leaves that at 1.0.0,
which the app rejects forever -- and reports as a port conflict naming its own
runtime, which sends you hunting the wrong problem.

To drive a local build through the real UI, build the app itself with
`scripts/build-macos-control-center-app.sh --local-preview`. That sets
`VibeTVLocalPreviewRuntime`, and the app then registers its own preview
LaunchAgent instead of the Developer-ID-constrained bundled one. The rehearsal
scripts themselves install candidate DMGs only, so a run that has to produce
evidence for an exact pull request head still needs the signed merge-gate
candidate (`CODEX Test VibeTV Merge`, `workflow_dispatch`, `pr_number`).

Before re-flashing for a newer head, check what actually changed:
`git diff --name-only <candidate-sha>..<head-sha> -- macos/ firmware/`. When that
is empty, the installed app shell and the flashed firmware already match the
head and only the Companion differs.

Known traps, all paid for on the bench:

- `--restore` does not return the original state. It walks back to the newest run with a non-empty `backup/manifest.txt`, so after cold+warm the original sits one level deeper, and a second `--restore` points at the same emptied warm run while still reporting "restore complete". Recover the original by hand with `ditto` from `<cold-run>/backup/`.
- Every flash rotates the device token, and no code plays a captured token back. After cold+warm both saved tokens are dead and the stream reports `pairing_token_rejected`. Recover with `POST /v1/device/repair {"forcePair":true,"target":...}`; it takes about a minute and still answers `paired:false` -- only the next `/v1/status` shows `paired:true`. Do not write again too early.
- `--keep-codexbar` is a decision, not a default. Without it `~/.codexbar` is gone and the stream reports `provider_setup_required` -- exactly what you want when reproducing a no-provider bug, and a trap otherwise. To force that state without purging, use the regular toggle: `PATCH /v1/preferences/codexbar.providers.<id>.enabled {"value":false}`.
- Firmware is not restored; the restore chain only rebuilds the Mac. If the device was on another pull request's candidate, it stays on the last flashed version.
- If the device already runs the candidate version the script reports "already on X, nothing to flash" and the device keeps its pairing. That is not a real cold start and the new-customer pairing screen will not appear.
- `PREVIEW UNAVAILABLE` for an active custom theme is not a product bug. A Theme Studio theme lives in `/themes/u/` and its spec exists only in the local app, so after a purge the app cannot reload it from the catalog.
- A merge-gate run reports `main` as its head branch and main's tip as its head SHA, because the workflow is dispatched from `main` -- but it builds the **pull request head** it was given. Only `candidate-manifest.json`'s `sourceSha` says what a candidate actually contains. Passing `--main` or `--pr` makes the scripts check that themselves; `--run-id` alone rehearses whatever that run happened to build.
- Only `CODEX Prepare and Release VibeTV` builds an exact `main` SHA. The merge gate cannot: it takes a `pr_number` and resolves an open pull request head.
- Quit the app and detach all images before a run; `hdiutil attach` fails transiently while a volume of the same name is still mounted. Check for foreign listeners with `lsof -nP -iTCP:47832 -sTCP:LISTEN`.
- Warm start needs one manual Sparkle "Install Update" click. That is a native macOS dialog and cannot be scripted headlessly.

`scripts/vibetv-hw-selftest.sh` is the firmware/Companion bench tool and does not
replace this. `scripts/test-companion-coldwarm-e2e.sh` is the cold/warm
simulation against the Virtual VibeTV; it runs in CI and needs no hardware.

## Merge, Release, and Production Guardrails

- Never run `gh pr merge`, merge into `main` with `git merge`, run `git push origin main`, create a tag with `git tag`, run `git push origin refs/tags/*`, run `gh release ...`, or trigger a release workflow unless the user gives explicit approval in the current conversation for that exact action and target.
- Approval to `deploy`, make the `live app ready`, `push branch`, `check`, `prepare`, `test`, or `fix` is not approval to merge, push `main`, release, or tag.
- Before every merge, `main` push, tag, or release action, state the action, target, and risk in a separate message and wait for explicit confirmation. Stop without confirmation.
- Deploying `app.vibetv.shop` is a different action from merging `main` or creating a release tag.
- Local Git guardrails must be active: `./scripts/install-agent-git-guardrails.sh` installs a `pre-push` hook that blocks `main` pushes and tag pushes unless an override is deliberately set.
- If a prohibited action is started accidentally, stop immediately, cancel running release jobs, remove local and remote tags, report the status, and make no further changes to `main` without new approval.

## Live VibeTV Guardrails

- The connected VibeTV is not a routine test target.
- Do not perform firmware updates, theme-pack installs, asset uploads, `POST /v1/themes/install`, `codexbar-display theme-pack install`, `POST /assets`, `POST /theme/active`, `POST /frame`, `POST /reset-wifi`, or similar writes to a device IP without current, explicit user approval for that exact hardware test.
- Read-only checks are allowed: `GET /hello`, `GET /health`, `GET /assets`, Companion `GET /v1/status`, `GET /v1/device`, and `POST /v1/device/discover`.
- Before a hardware write test, clearly state in the chat which device and command are involved, what the risk is, and that the user wants to test now.
- After a failed hardware write test, do not retry without new explicit approval.
- Tagging a release, merging, or pushing `main` is also governed by the Merge, Release, and Production Guardrails above.
