# #614: Control Center fetch wrappers and job pollers

Audited `apps/control-center/src/lib` and `apps/control-center/src/components`
on 2026-10-21 at `35152cc885ed5051f6d5ed77d3e13cff16592160` (the fetched
`origin/main` used for this branch). Locations below refer to that baseline;
all paths are relative to `apps/control-center/src`.

## Companion fetch inventory

| Wrapper / location | Request, timeout and abort | Response and error behavior | Decision |
| --- | --- | --- | --- |
| `lib/ai-theme.ts:1014` — `aiRequest` | Companion URL; `cache: no-store`; caller method/body/headers/signal; no added timeout or retry. | JSON parse failure becomes `null`; only HTTP failure is rejected, so HTTP-success `null` and `ok: false` remain accepted. AI-specific code/stage mapping, bounded/redacted connection diagnostics; fetch/abort rejection passes through. | Share only fetch + nullable JSON parsing with theme-send. Keep all AI interpretation here. |
| `lib/theme-install.ts:55` — `sendThemeToVibeTV`'s `runCompanion` | Companion URL; `cache: no-store`; new `AbortSignal.timeout(30_000)` per request, overriding any supplied signal; ZIP POST or job-status read. | JSON parse failure becomes `null`; reject non-OK HTTP, missing payload or `ok: false`; `Error` uses `nextAction`, then `message`, then `Open the VibeTV Mac App and connect your display.`, retaining `error.code`. Network/abort errors pass through. | Same shared fetch + nullable JSON parsing; timeout, checks and messages stay here. |
| `components/control-center-app.tsx:984` — `runCompanion` | Companion URL; adds JSON Content-Type for a body lacking one; own AbortController replaces caller signal; default 45,000 ms or `timeoutMs`; adds loopback address-space hint; records request time and optionally clears last error. No cache override. | JSON parse failure becomes `{}`; rejects HTTP failure / `ok: false` via `normalizeError`; may inspect local-network permission after connection failure; maps AbortError to `COMPANION_TIMEOUT` / `Mac App took too long to answer.` / `Run setup again, then try again.`; always clears timeout. | Kept (conflicts with redesign stack). Also not equivalent to either lib wrapper: different parse fallback, headers, permission checks, state and cancellation. |
| `components/control-center-app.tsx:1362` — `verifyLocalControlCenterAvailable` | Local Control Center page URL; GET, no-store, loopback hint; no timeout or abort signal. | Checks HTTP status only, never parses body; non-OK becomes `localControlCenterUnavailableError()`. | Kept (conflicts with redesign stack); this is page reachability, not JSON transport. |
| `components/live-vibetv-preview.tsx:320` — `refreshDisplayFrame` | `/v1/display-frame/latest`; no-store, loopback hint; own 5,000 ms controller; abort on cleanup; skips hidden window and concurrent read. | Dedicated frame parser; failures retain last frame. Immediate read, 1,000 ms interval and visibility-triggered reads; cleanup stops it. | Kept: continuous frame stream, not a job; different response validation and state ownership. |
| `components/live-vibetv-preview.tsx:1499` — `fetchThemeRenderPackRevision` | Exact render-pack revision first; supplied signal, no timeout/cache override. If exact HTTP fails and spec path is nonempty, one immediate legacy theme-ID read. | Successful response JSON is passed through (parse errors propagate). Chooses `theme pack unknown` (404) vs `theme pack unavailable`, preserving the exact transient failure when appropriate. Caller validates revision and retries failures/mismatches after 5,000 ms; cleanup aborts and clears retry. | Kept: two-request compatibility and revision policy differ from one-read wrappers. |
| `components/theme-render-preview.tsx:49` — render-pack effect | One render-pack read; own controller, aborted on cleanup; no timeout/cache override/retry; no request if pack already supplied or theme ID missing. | HTTP error `theme preview unavailable`; JSON parse errors propagate into effect catch; AbortError ignored, other errors set error state; payload without spec is unavailable; invokes `onPack` before state update. | Kept with the render-pack component group below; its lifecycle and response handling differ. |
| `components/theme-library-screen.tsx:1841` — `fetchThemePackForEditing` | One render-pack read; no timeout/signal/cache override/retry. | HTTP failure or missing spec: `Theme could not be opened.`; parse failures propagate; returns only assets/name/spec and defaults assets to `{}`. | Kept (conflicts with redesign stack). Extracting the complete wrapper would exceed the component edit budget; partial overlap with preview/sample does not justify splitting its validation. |
| `components/theme-studio/ai-theme-studio-screen.tsx:506` — `loadSample` | One `token-fire` render-pack read; no timeout/signal/cache override/retry; skips while locked. | HTTP error `Sample unavailable`; then imports/remaps/validates sample, with `Invalid sample` on validation failure; all errors become `The built-in sample could not be loaded.` and busy state is cleared. | Kept: sample transformation and catch policy differ; no duplicate whole wrapper. |

The first two wrappers now call `lib/companion-request.ts:4`
(`fetchCompanionJson`). This helper owns only Companion URL resolution,
`cache: no-store`, fetch and nullable JSON parsing. It does not standardize
HTTP success, error texts, aborts, timeouts, retries or caller state.

Other direct fetch sites were checked and are not Companion wrappers:
`lib/themes.ts:211` (Shopify GraphQL), `lib/themes.ts:339` (GitHub catalog),
`components/companion-installer-actions.tsx:23` (`useCompanionRelease.refresh`,
hosted `/api/companion/latest`, no-store, no timeout/signal, HTTP check followed
by JSON, failures become a `check_failed` release), and
`components/control-center-app.tsx:2935` (`checkFirmwareUpdate`, hosted
`/api/firmware/latest` branch with caller signal, HTTP check + JSON, AbortError
returns null, other errors become `check_failed`). The local firmware-check
branch already delegates to the inventoried `runCompanion`. URL builders in
`control-center-runtime.ts` do not fetch. Next route handlers under `app/api`
are server proxies, outside this lib/components inventory.

## Job poller inventory

| Poller / location | Request sequence and timing | Stop and failure behavior | Decision |
| --- | --- | --- | --- |
| `lib/theme-install.ts:14` — `pollThemeInstallJob` | Wait 500 ms using global `setTimeout` **before every** sequential `/v1/themes/install/status?jobId=<encoded>` read; `init: undefined`, `{ preserveLastError: true }`; at most 900 reads. Request duration is added to the wait, so this is not a fixed interval. No separate abort; the injected request owns it. Used by `sendThemeToVibeTV` and Control Center install/resume at `control-center-app.tsx:2590` / `:1289`. | Apply each job before checking; return the original job on `complete` / `error`; keep polling every other phase. Request/apply errors pass through without retry. Exhaustion: `theme_install_timeout`, `<noun> install is taking longer than expected.`, `Keep VibeTV powered on, then check the <lowercase noun> again.` Default noun `Theme`. | Shared loop, existing exported adapter and behavior retained. |
| `components/update-jobs.ts:93` — `pollFirmwareUpdateJob` | Same sequential 500 ms pre-read delay via existing `delay` (`window.setTimeout`), `/v1/updates/install/status?jobId=<encoded>`, same request arguments; at most 1,200 reads. No separate abort. Caller `control-center-app.tsx:3123`. | Apply first; return original job on `complete` / `attention` / `error`; continue only on `installing`. Unknown phase throws `firmware_update_status_invalid` / `VibeTV returned an unknown update status.` / `Keep VibeTV powered on, then create a support report.` Exhaustion: `firmware_update_timeout` / `VibeTV update is taking longer than expected.` / same next action. Request/apply errors pass through. | Shared loop, existing exported adapter, timer function and phase validation retained. |

Both adapters now use `lib/companion-request.ts:16` (`pollCompanionJob`).
Only their existing path, attempt budget, application callback, terminal
predicate, timeout error and timer function are parameters. No new retry,
cancellation, backoff, cache or state owner was added.

No other loop polls a job endpoint until done. Continuous status, provider,
usage, setup-event and display-frame polling are not job pollers. In
particular, `components/setup/setup-connect.ts:192` retries a stream-recovery
check (40 attempts, 3,000 ms; generation cancellation and swallowed read
failures), not an install job. The two intentionally different `/v1/status`
appliers, `checkCompanion` (`control-center-app.tsx:1377`) and `syncLocalStatus`
(`:1550`), are untouched.

## Validation and limits

- Added 38 contract cases against the original adapters first; all passed
  before production edits. The same cases pass after consolidation.
- Covers exact request arguments and sequence, 499/500 ms boundaries,
  outstanding-request serialization, callback-before-stop order, terminal
  phases, unknown phases, final allowed read, exact exhaustion budget/text,
  network/abort/timeout rejection identity, no retries, ZIP POST followed by
  polling, caller signals, fresh theme-send timeout signals, JSON parse and
  HTTP/payload error distinctions.
- Targeted Vitest: 50 tests across the two new contract files plus existing
  `theme-install.test.ts`, `ai-theme-diagnostics.test.ts` and
  `firmware-update-poll.test.ts`; passed with `nice -n 19`, `--maxWorkers=2`
  and `testslot.sh`.
- TypeScript: `tsc --noEmit --incremental false` through `testslot.sh` with
  `nice -n 19`; passed. UI approval gate: `gate: ok`.
- No changes to the listed redesign-owned component files. No hardware,
  installed-app, browser, cold/warm or Windows rehearsal was run: these were
  explicitly excluded by the dispatched worker rules. CI and the requested
  Codex review remain separate checks; this is not a merge/release approval.

Part of #614.
