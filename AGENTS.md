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
- Windows exception (bundled Win-CodexBar 0.60.3, VibeTV fork release pinned in `scripts/fetch-win-codexbar.ps1`, issue #415): the CLI has no all-enabled `usage --json` and no credential-consent command, so the per-provider usage/health join in `companion/internal/codexbar/providers.go` and the Claude credential flag in `companion/internal/codexbar/claude_credentials.go` are a time-boxed adapter fork. Remove them as soon as upstream CodexBar ships an all-enabled usage command or a consent command; do not extend them with new provider semantics. The fork pin itself is temporary: return to nesszer/Win-CodexBar once the Claude probe patches land upstream.

## Customer Rehearsal (Cold And Warm Start)

Every change to the VibeTV product is validated on the connected bench Mac with
both rehearsal scripts before it is handed over, and the real screen is shown.
A pull request is checked on Windows as well (see "Reviewing a pull request
head" below).
Green unit tests, green CI, and a healthy Companion API say nothing about what
the customer sees. A message can point at an action that does not exist in the
UI, and only the rendered screen shows that.

- `scripts/vibetv-rehearse-cold-start.sh` -- wipes every VibeTV and CodexBar trace from this Mac, then installs the Mac App and firmware from the candidate under test. No update path: the "unboxed today, already on the new build" state.
- `scripts/vibetv-rehearse-warm-start.sh` -- restores today's public customer state (current public Mac App + released firmware), then publishes the candidate so both updates appear in the Updates tab. You drive the visible customer flow yourself: Mac App through Sparkle first, then firmware.
- Shared logic lives in `scripts/lib/vibetv-rehearsal.sh`. Both take `--main`, `--pr <number>`, `--run-id`, `--device-target`, `--companion-override`, `--keep-codexbar`, `--restore`, `--yes`; warm start also takes `--skip-firmware-baseline`.
- A VibeTV on the USB cable has no address: pass `--device-target cable://vibetv`. Firmware then goes over the cable with this Mac's pairing, so cold start flashes before the purge.

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

### Reviewing a pull request head: Mac and Windows, without a signed candidate

A pull request head is rehearsed on the Mac **and** on Windows, cold start and
warm start each, before anyone talks about merging it. A new commit is a new
head and needs the runs again, so wait for CI and the automated review of the
head first. For this review no signed candidate is built; the signed merge-gate
candidate above stays what the merge gate and a release need.

- **Mac:** a local build of the head, with the head's SHA and the candidate
  version stamped in, from the repository root:

  ```bash
  V=9999.0.<n>; OUT=tmp/quick; mkdir -p "$OUT/fw"
  (cd apps/control-center && npm run build:local)
  rm -rf companion/internal/companionapi/controlcenter_static
  mkdir -p companion/internal/companionapi/controlcenter_static
  cp -R apps/control-center/out-local/. companion/internal/companionapi/controlcenter_static/
  git checkout -- companion/internal/companionapi/controlcenter_static/.gitkeep
  P=github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/buildinfo
  (cd companion && CGO_ENABLED=0 go build \
    -ldflags "-s -w -X $P.Version=$V -X $P.Commit=$(git rev-parse HEAD)" \
    -o "../$OUT/codexbar-display" ./cmd/codexbar-display)
  scripts/build-macos-control-center-app.sh --version "$V" --build <n> --local-preview \
    --companion-binary "$OUT/codexbar-display" --output "$OUT/VibeTV Control Center.app"
  codesign --force --deep --sign - "$OUT/VibeTV Control Center.app"
  scripts/build-macos-control-center-dmg.sh --app "$OUT/VibeTV Control Center.app" \
    --output "$OUT/VibeTV-Control-Center-$V.dmg" --version "$V"
  (cd firmware_esp8266 && CODEXBAR_DISPLAY_FW_VERSION="$V" pio run -e esp8266_smalltv_st7789)
  cp firmware_esp8266/.pio/build/esp8266_smalltv_st7789/firmware.bin "$OUT/fw/"
  ```

  Without `Commit` the Companion reports `dev` and the head cannot be told
  from `/v1/status`; without `--version` the app builder refuses the Companion.
  The copy empties `controlcenter_static`, so commit with exact paths
  afterwards, never `git add -A companion`. Serve `$OUT/fw` with a manifest
  from a local port.
- **Both redirections, before the first app start:**
  `CODEXBAR_DISPLAY_FIRMWARE_MANIFEST_URL` and
  `CODEXBAR_DISPLAY_MAC_APP_RELEASE_API_URL` (a JSON file `{"tag_name":"v<app version>"}`).
  With only the first one, setup stops at the app check. On the Mac set them
  with `launchctl setenv`, on Windows as user variables.
- **Windows:** the unsigned installer of the head's CI run (artifact
  `vibetv-control-center-windows`, version `9999.0.<n>`), on a real Windows
  machine with a VibeTV on the cable. Cold: app state cleared, VibeTV on the
  delivery firmware (1.0.41, the firmware of v1.0.56), install, set up. Warm:
  the public installer with the released firmware first, then the candidate
  over it and the firmware update from Updates.
- **Delivery state of a VibeTV on the cable:** stop the app's service, then
  `esptool.py erase_region 0x200000 0x200000` and `write_flash 0x0` with the
  1.0.41 image. The erase takes the saved WiFi with it; read `0x3FA000`
  (`0x6000` bytes) before and write it back for the warm start. That copy
  holds the WiFi password: delete it after the last run.
- **Passed** means paired, firmware equal to the candidate, theme active with
  `renderOk: true`, a healthy stream, the theme kept across the warm start, and
  `companion.runtime.commit` in `/v1/status` equal to the head.
- What the pull request changes is looked at in the running app on both
  platforms, not only read from the API. The result goes into the pull request
  description: per platform and start the times, the build, the device, and
  what was not checked.
- The purge leaves the app's web storage in place (`localStorage`, on the Mac
  `~/Library/WebKit/shop.vibetv.control-center`, #571). Until the purge does it
  itself: with the app closed, move that folder aside before the cold start
  and again before the public app of the warm start is installed, and put the
  first copy back after the last run (it can hold themes saved in Theme
  Studio). The app creates a fresh one on its next start. Otherwise the cold
  start reads what an earlier candidate stored, and the warm start reads what
  the cold start stored.
- Do not start the Mac's cold start and the Windows preparation in the same
  minute: the Windows VibeTV is on WiFi for a moment, the Mac App then finds
  two VibeTVs and waits for a choice.

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
- Read-only checks are allowed: `GET /hello`, `GET /health`, `GET /assets`, Companion `GET /v1/status`, `GET /v1/device`, and `POST /v1/device/search`. `POST /v1/device/search` only scans; `POST /v1/device/discover` is NOT read-only -- it persists the device target -- and must never be used as a check.
- Before a hardware write test, clearly state in the chat which device and command are involved, what the risk is, and that the user wants to test now.
- After a failed hardware write test, do not retry without new explicit approval.
- Tagging a release, merging, or pushing `main` is also governed by the Merge, Release, and Production Guardrails above.
