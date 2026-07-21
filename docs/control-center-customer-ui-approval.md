# Control Center Customer UI Approvals

This append-only log is the machine-checked approval marker for customer-facing
Control Center changes. Every visible UI change needs a new entry that records
the user's explicit approval and the exact visible result. Technical work,
issue scope, or release permission never implies UI permission.

## 2026-07-15 — One update action

- User approval: Explicitly approved by the user in the Codex task on 2026-07-15.
- Approved customer-visible result: App, migration, and firmware update states show one action named `Update`; manual DMG, Applications-folder, replacement, relaunch, and duplicate-copy instructions do not appear in update UI.
- Approved files: `updates-screen.tsx`, `overview-screen.tsx`, `setup-screen.tsx`, and their customer-flow assertions.

## 2026-07-15 — Download action without instructions

- User approval: The user explicitly ordered the remaining hosted DMG and Applications instructions to be deleted in the Codex task on 2026-07-15.
- Approved customer-visible result: The hosted first-install state shows only the `Download Mac App` action and no manual DMG or Applications-folder instructions.
- Approved files: `setup-screen.tsx`, the customer-copy guard, and the hosted customer-flow assertion.

## 2026-07-16 — Theme Studio in Theme Library

- User approval: The user explicitly approved this result with `ok` in direct response to the exact visible-result confirmation in the Codex task on 2026-07-16.
- Approved customer-visible result: Theme Studio opens only from Theme Library and uses the immersive `1180×820` editor with Layers, Preview, Inspector, explicit Save, draft recovery, accessible tabs, undo and redo, and reduced-motion support; no AI interface, separate menu item, or public Theme Studio route appears.
- Approved files: Theme Library, Theme Studio, the immersive Control Center shell, supporting editor and storage modules, styles, and their unit and customer-flow tests.

## 2026-07-16 — Theme Studio component extraction

- User approval: The user explicitly approved the exact Theme Studio result above on 2026-07-16; this checkpoint applies that approval to the subsequent structural component extraction, which does not change the visible result.
- Approved customer-visible result: The approved Theme Studio remains visually and functionally unchanged while preview interaction, editor controls, geometry helpers, and the primitive inspector live in separate maintainable modules.
- Approved files: `theme-studio-screen.tsx`, `editable-theme-preview.tsx`, `editor-controls.tsx`, `editor-geometry.ts`, and `primitive-inspector.tsx`.

## 2026-07-16 — Confirmed selection for another VibeTV

- User approval: The user explicitly approved the multi-VibeTV selection plan and ordered its implementation in the Codex task on 2026-07-16.
- Approved customer-visible result: When the last connected VibeTV is unavailable, one alternative shows `Another VibeTV was found` with `Connect this VibeTV`, `Not now`, and `Search again`; multiple alternatives show `Choose a VibeTV`, and confirmed profiles show only `Previously connected`. No location names are invented and no alternative is selected before the customer confirms it.
- Approved files: `control-center-app.tsx`, `control-center-types.ts`, `setup-screen.tsx`, and their customer-flow assertions.

## 2026-07-16 — Device recovery before Control Center

- User approval: The user explicitly required reconnecting, device search, and alternative-device selection to happen on startup screens instead of inside Overview or Setup in the Codex task on 2026-07-16.
- Approved customer-visible result: After the Mac App runtime starts, an existing unavailable VibeTV is handled in a full-screen startup flow before the Control Center shell appears. The startup flow shows connection/search progress and any alternative-device choice; Overview and Setup are not visible during recovery. A successful connection opens Overview, while `Not now` opens the Control Center without changing the saved device. Overview uses the neutral `Unavailable` state instead of reconnecting progress.
- Approved files: `control-center-app.tsx`, `device-startup-screen.tsx`, `control-center-shell.tsx`, `control-center-types.ts`, `overview-screen.tsx`, and their customer-flow assertions.

## 2026-07-16 — Stable startup recovery polling

- User approval: The user explicitly confirmed in the Codex task on 2026-07-16 that routing an offline configured VibeTV to the startup spinner, reconnecting automatically when it returns, and then opening the correct screen is good.
- Approved customer-visible result: An existing unavailable VibeTV remains on the full-screen startup recovery state while status checks run one at a time. When that VibeTV becomes ready, recovery completes automatically and the correct Control Center screen opens without a redundant device request, a stale intermediate screen, or reconnecting UI inside Overview or Setup.
- Approved files: `control-center-app.tsx` and its customer-flow assertions in `test-customer-flows.mjs`.

## 2026-07-16 — First-time multi-device copy

- User approval: The user explicitly confirmed in the Codex task on 2026-07-16 that first-time setup must use separate text from recovery and ordered the change to be implemented.
- Approved customer-visible result: During first-time setup, one result shows `VibeTV found` and asks `Connect to this VibeTV?`; multiple results show `Choose a VibeTV` and explain that more than one VibeTV was found. The flow never claims that a previous or last-connected VibeTV exists. After `Not now`, it says that no VibeTV is selected and offers another search.
- Approved files: `setup-screen.tsx` and its fresh-setup customer-flow assertion in `test-customer-flows.mjs`.

## 2026-07-16 — No same-boot firmware retry after a partial upload

- User approval: After the critical pre-release review, the user explicitly ordered all identified retry-safety and real-runtime-path fixes except the separately numbered reproducible-build and staged-rollout items in the Codex task on 2026-07-16.
- Approved customer-visible result: When a firmware upload may have started but did not finish safely, the failed update state shows the instruction to disconnect VibeTV from power for 10 seconds and wait for the picture after reconnecting. It does not show `Try again` in that state; creating a support report remains available.
- Approved files: `control-center-app.tsx`, `updates-screen.tsx`, and the customer-flow assertion in `test-customer-flows.mjs`.

## 2026-07-17 — Search before WiFi setup

- User approval: The user explicitly required in the Codex task on 2026-07-17 that Control Center search for VibeTVs first, show the setup instructions only when no VibeTV was found, and start another scan when the customer confirms that VibeTV is now on WiFi.
- Approved customer-visible result: A fresh local start first shows `Looking for your VibeTV`. If the scan finds no VibeTV, Control Center opens `Set up your VibeTV` with the existing WiFi instructions and one `VibeTV is on WiFi` action. Clicking that action starts a fresh scan. One result connects automatically; multiple results show `Choose a VibeTV` without claiming that a previous device exists.
- Approved files: `control-center-app.tsx`, `device-startup-screen.tsx`, `setup-screen.tsx`, the setup-flow principles, and their customer-flow assertions in `test-customer-flows.mjs`.

## 2026-07-17 — WiFi setup belongs to the startup screen

- User approval: The user explicitly corrected the prior result in the Codex task on 2026-07-17 and required that the installed app have no Setup tab and never route a failed startup scan into the old Setup screen.
- Approved customer-visible result: The installed app first shows `Looking for your VibeTV`. If no VibeTV is found, that same white full-screen startup experience changes to `Connect VibeTV to WiFi`, shows the existing seven WiFi instructions, and offers one `VibeTV is on WiFi` action. Clicking it returns to `Looking for your VibeTV` and starts a new scan. No Control Center navigation or Setup tab is visible during this flow, and the ready Control Center navigation has no Setup tab.
- Approved files: `control-center-app.tsx`, `control-center-shell.tsx`, `control-center-types.ts`, `device-startup-screen.tsx`, the setup-flow principles, and their customer-flow assertions in `test-customer-flows.mjs`.

## 2026-07-17 — A found VibeTV is not missing while usage starts

- User approval: The user reported the incorrect `VibeTV was not found` screen after the scan had already reached the real VibeTV, and the previously approved flow requires the WiFi fallback only when no VibeTV was found.
- Approved customer-visible result: If the expected VibeTV is already connected and paired but its first usage frame is still loading, the startup screen shows `Connecting to VibeTV` and `Waiting for usage…`. It continues read-only status polling and opens Overview when the first verified frame arrives. It does not show `VibeTV was not found`, `Search again`, or `Not now` for this waiting state.
- Approved files: `control-center-app.tsx`, `control-center-types.ts`, `device-startup-screen.tsx`, and the regression assertions in `test-customer-flows.mjs`.

## 2026-07-17 — Keep Control Center open during reconnects

- User approval: The user explicitly approved the PR #169 reconnect plan and ordered its implementation in the Codex task on 2026-07-17.
- Approved customer-visible result: First-time setup keeps its white WiFi screen. A later app start with the saved VibeTV offline shows a separate white reconnect screen with automatic search, `Search again`, and `Open Control Center`, without WiFi setup instructions. After Control Center has opened, a temporary VibeTV or Mac App outage keeps the current tab and navigation visible; Overview offers `Search for VibeTV`, a running search state, then `Search again`, with `Set up another VibeTV` as the secondary reset action. Reconnecting the same device, including after an update or IP-address change, never changes the active tab.
- Approved files: `control-center-app.tsx`, `control-center-types.ts`, `device-startup-screen.tsx`, `overview-screen.tsx`, `setup-screen.tsx`, the setup-flow principles, and their customer-flow assertions in `test-customer-flows.mjs`.

## 2026-07-17 — Reconnect race fixes preserve the approved flow

- User approval: After the critical merge review, the user explicitly ordered all identified reconnect blockers to be fixed in the Codex task on 2026-07-17.
- Approved customer-visible result: The approved reconnect flow remains unchanged while late settings or status responses can no longer change the active tab or restore a reset device. Firmware updates keep Updates visible through `ready → reconnecting → ready`, and a legacy paired VibeTV without a saved device ID reconnects only through its exact saved address before the discovered stable identity is pinned.
- Approved files: `control-center-app.tsx`, Companion device search identity matching, and their customer-flow and Go regression tests.

## 2026-07-17 — Safe recovery boundaries

- User approval: After the neutral merge and release review, the user explicitly ordered all newly identified reconnect and firmware-update blockers to be fixed in the Codex task on 2026-07-17.
- Approved customer-visible result: A late settings response cannot make an offline VibeTV appear connected again. While firmware is updating, Overview does not expose VibeTV search or setup-reset actions. A legacy saved address without a stable device ID never adopts a newly discovered VibeTV automatically; choosing another VibeTV still requires an explicit setup reset.
- Approved files: `control-center-app.tsx`, `overview-screen.tsx`, Companion setup-reset and identity matching, and their customer-flow and Go regression tests.

## 2026-07-17 — Restore an active update after reload

- User approval: After the neutral release review identified the remaining reload and second-window race, the user explicitly ordered the KISS fix in the Codex task on 2026-07-17.
- Approved customer-visible result: Reloading the Mac App or opening a second window during a running VibeTV update restores the Updates screen and its visible reconnecting progress. Search and setup-reset actions remain unavailable, and a rejected reset never discards the known VibeTV locally.
- Approved files: `control-center-app.tsx`, `overview-screen.tsx`, Companion status, and their customer-flow and Go regression tests.

## 2026-07-18 — Customer-ready setup, overview, usage, and support flow

- User approval: The user explicitly approved the current Control Center UI in the Codex task on 2026-07-18, including automatic startup discovery and connection, multi-device selection, retry and Local Network recovery, the simplified Overview, provider setup actions, Usage, and support report actions.
- Approved customer-visible result: On startup, the Mac App automatically searches for VibeTVs, connects when exactly one is found, and asks the customer to choose when several are found. Failed discovery shows a clear retry or macOS Local Network instruction. Overview uses the simplified `Connected` and `Waiting for first image` states. Provider setup lives under Setup and Usage with `Open CodexBar`, `Repair CodexBar`, and `Check again`; Support provides the customer-facing support report actions.
- Approved files: `control-center-app.tsx`, `control-center-runtime.ts`, `control-center-shell.tsx`, `control-center-types.ts`, `device-startup-screen.tsx`, `live-vibetv-preview.tsx`, `logs-screen.tsx`, `overview-screen.tsx`, `provider-setup-card.tsx`, `setup-screen.tsx`, `support-report-actions.tsx`, `usage-screen.tsx`, and their customer-flow assertions.

## 2026-07-18 — Show real usage when a percentage is zero

- User approval: The user explicitly reported in the Codex task on 2026-07-18 that the approved Overview still showed `Loading usage` although real Usage data was available and required the real result to be shown there.
- Approved customer-visible result: When a real VibeTV display frame contains a zero-percent Session or Weekly value that Go omits from JSON, Overview renders the active theme with that value as `0%` instead of remaining on `Loading usage`.
- Approved files: `live-vibetv-preview.tsx` and its backend-faithful customer-flow assertion in `test-customer-flows.mjs`.

## 2026-07-18 — Validate the exact sent usage frame

- User approval: The user's explicit 2026-07-18 request to replace the stuck `Loading usage` state with the real VibeTV result covers the exact sent display frame, including zero-percent values, rather than a separate Usage-tab snapshot.
- Approved customer-visible result: Overview renders only a valid, successful, versioned VibeTV display frame. Omitted zero-percent fields render as `0%` from that frame; values are never borrowed from a separately refreshed Usage response. Invalid HTTP-200 frame payloads remain on `Loading usage`.
- Approved files: `live-vibetv-preview.tsx` and the independent-source plus invalid-frame customer-flow assertions in `test-customer-flows.mjs`.

## 2026-07-18 — Support report on every setup screen

- User approval: The user explicitly required a `Create report` button on every setup screen and ordered the Support report to show substantially more useful device and WiFi information in the Codex task on 2026-07-18.
- Approved customer-visible result: Every browser and native setup state, including startup, hosted Mac App setup, setup complete, installation progress, installation failure, and the Applications-folder alert, offers `Create report` as a secondary action. The Support tab additionally shows Mac App and runtime versions, VibeTV firmware and ID, pairing/readiness, and whether and which VibeTVs were found on the current WiFi.
- Approved files: `control-center-app.tsx`, `control-center-types.ts`, `logs-screen.tsx`, `setup-screen.tsx`, `support-report-actions.tsx`, `support-report.ts`, the native `main.swift`, and their customer-flow and native bundle assertions.

## 2026-07-18 — Safe and complete support report collection

- User approval: After approving the report UI, the user explicitly ordered the branch to be made PR-ready and requested an independent merge review of the report changes in the Codex task on 2026-07-18.
- Approved customer-visible result: Creating a native report may keep collecting details for up to 40 seconds without freezing the setup screen. Exported browser and native reports replace recognized credentials with redaction markers, and a WiFi scan that reaches its time limit shows that the search needs attention instead of claiming that no VibeTV was found.
- Approved files: `support-report.ts`, `control-center-types.ts`, the native `main.swift`, and their browser, Go, and Swift assertions.

## 2026-07-19 — Restore Theme Studio work after closing the Mac window

- User approval: After the independent PR #169 review identified draft loss and missing install-job restoration on window close, the user explicitly ordered both findings to be fixed and pushed in the Codex task on 2026-07-19.
- Approved customer-visible result: Closing the Mac window immediately after editing preserves the latest Theme Studio draft. Reopening the Mac App during a running theme installation returns to Theme Library, shows the existing installation progress through completion, and never starts a second installation.
- Approved files: `control-center-app.tsx`, `theme-library-screen.tsx`, `theme-studio-screen.tsx`, Companion theme-install status, native `main.swift`, and their customer-flow, Go, and Mac bundle assertions.

## 2026-07-19 — Keep Overview preview after installing a custom theme

- User approval: After reporting that Overview changed to `Preview unavailable` immediately after installing another theme, the user explicitly answered `ja` to the proposed PR #169 fix and new preview build in the Codex task on 2026-07-19.
- Approved customer-visible result: After Theme Studio installs a custom theme, Overview renders the exact active custom layout and assets with the live VibeTV usage frame instead of showing `Preview unavailable`. The installed render pack survives Mac App restarts, and an older local revision is never substituted for the active device theme. No new customer control or technical copy appears.
- Approved files: `live-vibetv-preview.tsx`, `theme-studio-screen.tsx`, local theme render-pack storage and tests, Companion custom render-pack persistence and serving, and their Go and Control Center regression tests.

## 2026-07-21 — Offer final releases to prerelease builds in update checks

- User approval: The user explicitly ordered issue #173 to be implemented and the resulting PR #198 CI to be fixed in the Claude session on 2026-07-21.
- Approved customer-visible result: Update checks treat prerelease builds as older than the matching final release, so a Mac App or VibeTV running an RC build is offered the final update instead of wrongly showing up to date. A version value that cannot be interpreted shows the existing check-failed state with a clear message instead of a wrong update decision. Theme Library firmware requirements use the same version ordering. No new customer controls and no new technical copy appear.
- Approved files: the hosted firmware and Mac App update check routes, `theme-library-screen.tsx`, the shared version comparison in `lib/semver.ts`, and their route and unit tests.
