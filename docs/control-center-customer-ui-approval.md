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

## 2026-07-21 — Stable Theme Studio keyboard assertion

- User approval: The user explicitly approved the exact Theme Studio result with accessible tabs on 2026-07-16; the current CI repair changes only the automated wait for that already approved result.
- Approved customer-visible result: The approved Theme Studio remains visually and functionally unchanged. Pressing `ArrowRight` on the `Project` tab selects `Assets`, and the regression test waits for Radix's asynchronous focus transition before checking the result.
- Approved files: The Theme Studio keyboard assertion in `test-customer-flows.mjs`.

## 2026-07-21 — Stable Overview preview assertion

- User approval: The user explicitly approved the exact Overview theme rendering with real zero-percent usage on 2026-07-18; the current CI repair changes only the automated wait for that already approved result.
- Approved customer-visible result: The approved Overview remains visually and functionally unchanged. The regression test allows the same standard 10-second CI window for the device image layout before it checks the already rendered Synthwave preview.
- Approved files: The Overview preview assertion in `test-customer-flows.mjs`.

## 2026-07-21 — Customer preview feedback batch

- User approval: While reviewing the preview Mac App on 2026-07-21, the user explicitly reported each visible defect and ordered the fixes: restore Usage token history, load Settings brightness when the tab opens, enlarge Theme Library previews, keep widthless text stable when alignment changes, open the native asset picker for GIF and Sprite, remove the redundant preview-dialog description, remove the misleading provider-repair box from Usage, and reduce and clean up the Support screen.
- Approved customer-visible result: Usage shows available token history without a contradictory provider-repair box. Settings loads the current brightness and enables its slider. Theme previews render at a readable size, widthless Theme Studio text no longer jumps left when alignment changes, and GIF, Sprite, and JSON file actions open the macOS file picker. The Theme preview dialog shows only its title and preview. Support shows a compact VibeTV summary, one primary `Create report` action that becomes `Creating report`, then only `Copy`, `Download`, and `Create again`; detailed checks stay inside the copied or downloaded report, and Recent activity is compact and scrollable.
- Approved files: `control-center-app.tsx`, `live-vibetv-preview.tsx`, `logs-screen.tsx`, `support-report-actions.tsx`, `theme-library-screen.tsx`, `usage-screen.tsx`, the shared `slider.tsx` accessibility label forwarding, the native `main.swift`, and the matching customer-flow assertions in `test-customer-flows.mjs`.

## 2026-07-21 — Shared setup and recovery presentation

- User approval: After reviewing the preview, the user explicitly required the setup screens to share their UI elements and approved implementing the resulting review recommendations. The user also explicitly required a spinner on the boot screen, a secondary `Create report` action there, and a primary report action on the Support screen.
- Approved customer-visible result: Boot, device startup, setup, and Mac App recovery use one consistent status hierarchy, spinner treatment, device list, WiFi instructions, and accessible state announcements. The native startup screen mirrors the same title and detail hierarchy and preserves a specific repair action when reopened. `Create report` remains secondary only during boot and primary on Support.
- Approved files: Shared setup, brand, shell-status, device-candidate, spinner, and support-report components; `control-center-app.tsx`, `control-center-shell.tsx`, `hosted-setup-shell.tsx`, `setup-screen.tsx`, `device-startup-screen.tsx`, `mac-app-recovery-screen.tsx`, native `main.swift`, `URLSchemeTests.swift`, and their unit and customer-flow tests.

## 2026-07-22 — Provider management in Usage

- User approval: The user explicitly requested GitHub issues #183 and #188 to be implemented together in the delegated Codex task on 2026-07-22, with #188 limited to provider enable/disable and customer-safe health status.
- Approved customer-visible result: Usage keeps its existing provider usage overview and adds a compact `AI providers` list below it. The list shows every provider reported by the VibeTV Mac App, supports search, changes the real provider enablement with one switch per row, and shows only safe local and service health labels. Failed changes restore the previous switch value; no credentials, raw provider errors, or provider-selection controls appear.
- Approved files: `control-center-app.tsx`, `control-center-types.ts`, `preference-control.tsx`, `usage-screen.tsx`, and their customer-flow assertions.

## 2026-07-22 — Shadcn startup failure presentation

- User approval: While testing the signed preview on 2026-07-22, the user explicitly reported that the `VibeTV could not connect` pairing-failure screen still used the old UI and required it to follow the current design.
- Approved customer-visible result: Startup and recovery remain outside the Control Center navigation, but now use the compact VibeTV brand, the shared shadcn Card hierarchy, semantic status icon, shadcn Alert, current buttons, and a secondary support-report footer. Pairing failures name the visible `Search again` action instead of referring to a hidden `Fix connection` action.
- Approved files: `setup-status-screen.tsx`, `device-startup-screen.tsx`, `mac-app-recovery-screen.tsx`, and their unit and customer-flow assertions.

## 2026-07-21 — Offer final releases to prerelease builds in update checks

- User approval: The user explicitly ordered issue #173 to be implemented and the resulting PR #198 CI to be fixed in the Claude session on 2026-07-21.
- Approved customer-visible result: Update checks treat prerelease builds as older than the matching final release, so a Mac App or VibeTV running an RC build is offered the final update instead of wrongly showing up to date. A version value that cannot be interpreted shows the existing check-failed state with a clear message instead of a wrong update decision. Theme Library firmware requirements use the same version ordering. No new customer controls and no new technical copy appear.
- Approved files: the hosted firmware and Mac App update check routes, `theme-library-screen.tsx`, the shared version comparison in `lib/semver.ts`, and their route and unit tests.

## 2026-07-21 — Physical pairing recovery and Mac-App-first updates

- User approval: After the security sweep described the visible recovery problem, the user explicitly answered `dann ... fixen` and approved implementing that customer-visible fix in the Codex task on 2026-07-21.
- Approved customer-visible result at that time: A closed pairing window or rejected saved token used a destructive physical recovery. The WiFi/pairing recovery part of this decision is superseded by the 2026-07-22 KISS WiFi-change decision below. A temporary pairing rate limit only asks the customer to wait briefly. When Mac App and VibeTV firmware updates are both available, the single Update action updates the Mac App first and exposes the firmware update only afterward.
- Approved files: `control-center-types.ts`, `control-center-app.tsx`, `updates-screen.tsx`, `protocol/compatibility_matrix.json`, `docs/customer-setup.md`, and their customer-flow assertions.

## 2026-07-22 — Manual IP alongside WiFi discovery

- User approval: After reviewing the exact rendered automatic-search and no-result screens, the user explicitly ordered `mach PR` in the Codex task on 2026-07-22.
- Approved customer-visible result: While Control Center searches WiFi, the search spinner appears before an always-visible minimal IP-address field introduced by `Or enter the IP address shown on your VibeTV screen:`. When no VibeTV is found, the screen shows `We couldn't find your VibeTV`, the seven WiFi setup steps, `Scan WiFi again`, and only then the same alternative IP-address entry. The former `Enter VibeTV IP` and `VibeTV is on WiFi` buttons do not appear.
- Approved files: `device-startup-screen.tsx`, `device-target-form.tsx`, `setup-screen.tsx`, and their customer-flow assertions in `test-customer-flows.mjs`.

## 2026-07-22 — Shadcn manual IP and secure pairing integration

- User approval: After merging the manual-IP work to `main`, the user explicitly ordered its functionality to be carried into the new Shadcn setup screens, rejected the old presentation, and requested a new preview in the Codex task on 2026-07-22.
- Approved customer-visible result at that time: Automatic discovery stays the default, while startup and setup expose the same manual VibeTV address path through the existing Shadcn Card, Field, Input, Button, Spinner, and Alert components. The search spinner remains before the address field, and the no-result flow keeps WiFi instructions and `Scan WiFi again` before manual entry. The customer-visible destructive WiFi-reset instructions from this decision are superseded by the 2026-07-22 KISS WiFi-change decision below.
- Approved files: `control-center-app.tsx`, `device-startup-screen.tsx`, `device-target-form.tsx`, `setup-screen.tsx`, `updates-screen.tsx`, and their unit and customer-flow assertions.

## 2026-07-22 — Pairing recovery and truthful usage state

- User approval: While testing preview 99.0.61, the user reported the rotating `Starting Control Center`, `Reconnecting to your VibeTV`, and first-time WiFi screens plus stale Usage values, and explicitly ordered an independent cleanup and review including the Usage problem.
- Approved customer-visible result at that time: A reachable VibeTV whose local pairing key is missing is never presented as connected, as needing first-time WiFi setup, or as waiting for an AI provider. The customer-visible destructive WiFi-reset instructions from this decision are superseded by the 2026-07-22 KISS WiFi-change decision below. The stale last-sent usage frame stays hidden until pairing is restored, and the initial Control Center check is not held open by a slow provider usage probe.
- Approved files: `control-center-app.tsx`, `device-startup-screen.tsx`, `overview-screen.tsx`, `live-vibetv-preview.tsx`, Companion provider setup status handling, and their unit and customer-flow assertions.

## 2026-07-22 — KISS WiFi change without device reset

- User approval: During physical preview testing, the user explicitly rejected
  the read-only automatic setup hotspot and any WPA2/PIN recovery design.
- Approved customer-visible result: If saved WiFi credentials fail, VibeTV
  returns to the ordinary open `VibeTV-Setup` hotspot and immediately shows the
  normal writable WiFi form. Choosing a new network changes only SSID/password;
  pairing, themes and device settings remain intact. A normal WiFi change never
  asks the customer to reset the device and never opens a new pairing window on
  an already paired device.
- Approved files: ESP8266 setup-AP/portal behavior, firmware WiFi/pairing policy,
  native firmware regression tests, and the WiFi hardware/customer contract.

## 2026-07-22 — One cardless setup language and working re-pair

- User approval: While testing the signed preview on 2026-07-22, the user explicitly required every setup state to use the cardless `Starting Control Center` presentation, required support-report creation to remain available during search, required the address field to show and accept only the IP address, and reported that `Pair again` must repair pairing instead of returning to device selection.
- Approved customer-visible result: Boot, search, WiFi help, device selection, connecting and pairing errors use one shared cardless full-screen hierarchy. `Create report` remains available while another setup action runs. The VibeTV address field displays a bare IP address while normalizing it internally. After a selected VibeTV rejects the saved pairing token, `Pair again` explicitly re-pairs that same verified device and opens Control Center instead of restarting discovery.
- Approved files: `control-center-app.tsx`, `device-startup-screen.tsx`, `setup-screen.tsx`, `setup-status-screen.tsx`, `device-target-copy.ts`, `device-target-form.tsx`, `support-report-actions.tsx`, Support and Updates consumers, and their unit and customer-flow assertions.

## 2026-07-22 — Usage self-repair, centered update indicator and draft brightness

- User approval: While testing the signed preview on 2026-07-22, the user explicitly reported that token history did not load, the Updates notification was not centered, and the brightness slider sometimes returned to 100. The user required brightness changes to remain local until `Save brightness` is clicked, required a stalled `cost --json` scan to repair itself in the background, and then explicitly requested a refresh button for token usage.
- Approved customer-visible result: Usage immediately uses an available local token-history cache when the full CodexBar cost scan is slow, then refreshes that history through one longer background repair scan. The token-history card includes a visible `Refresh` action that requests a fresh usage scan, shows `Refreshing` while it runs, and cannot be clicked twice. The Updates notification is vertically centered in its navigation row. Moving the brightness slider never writes to VibeTV and a delayed settings response cannot replace the unsaved value; `Save brightness` sends that value exactly once.
- Approved files: Companion token-history cache and background-repair handling, `control-center-app.tsx`, `control-center-shell.tsx`, `usage-screen.tsx`, and their Go, unit, and customer-flow assertions.

## 2026-07-22 — Approved shadcn stack merge checkpoint

- User approval: This merge checkpoint combines the user's explicit 2026-07-22 approvals recorded above for the shadcn manual-IP and one-cardless re-pair flow with the separately approved Usage refresh, centered update indicator, and draft brightness behavior.
- Approved customer-visible result: The merged shadcn branch preserves the approved cardless setup and recovery flow, including the bare-IP manual address field and working `Pair again`, while Usage retains its approved refresh and self-repair behavior and Settings retains its approved save-only brightness behavior. The merge introduces no additional customer-facing state, copy, or action.
- Approved files: `device-target-form.tsx`, `control-center-app.tsx`, `control-center-shell.tsx`, `usage-screen.tsx`, and their unit and customer-flow assertions in `test-customer-flows.mjs`.

## 2026-07-23 — One-click Connect and explicit 1.0.38 recovery

- User approval: The user explicitly ordered pairing to be reduced to selecting
  a visible VibeTV and pressing `Connect`, while keeping the unavoidable legacy
  recovery only for already locked firmware `1.0.38` devices.
- Approved customer-visible result: Explicit Connect always establishes the
  current internal key and never waits for the first display image. Firmware
  `1.0.38` rejection shows `Reconnect this VibeTV`, the three-power-cycle,
  `VibeTV-Setup`, and 30-minute Connect steps. It shows neither `Pair again`,
  the old generic powered-on instruction, nor an additional settings sentence.
  Support-report access remains available.
- Approved files: ESP8266 pairing policy and compatibility version, Companion
  Connect routing/error mapping, Control Center startup recovery, and their
  firmware, Go, unit, and customer-flow tests.

## 2026-07-23 — Restore Connect after a lost local key

- User approval: After testing the signed preview against the real VibeTV, the
  user explicitly accepted the successful result with `ja geil` and asked
  whether the branch was ready to merge.
- Approved customer-visible result: When the reachable VibeTV no longer has a
  matching local key, the startup screen keeps that VibeTV visible with the
  normal `Connect` action. Pressing it establishes the new internal key, opens
  Overview, and reaches the green connected state with a live display image
  without another reset or WiFi setup.
- Approved files: `control-center-app.tsx`, `control-center-types.ts`, their
  unit tests, and the matching customer-flow assertions in
  `test-customer-flows.mjs`.

## 2026-07-23 — Stable connected Overview preview width

- User approval: The user's explicit acceptance of the real-device connected
  Overview covers the same visible result while fixing its collapsed-width CI
  case.
- Approved customer-visible result: The connected Overview continues to show
  the VibeTV case and live theme image at the approved size. Its preview
  container now keeps an explicit available width so the exact same image
  cannot collapse to zero width during a slow image load.
- Approved files: `overview-screen.tsx` and the existing connected Overview
  customer-flow assertion in `test-customer-flows.mjs`.

## 2026-07-23 — Automatic Mac runtime port fallback

- User approval: After requiring the Mac App to use another port automatically,
  the user reviewed the exact terminal-failure screenshot and explicitly
  approved it with `ja` in the Codex task on 2026-07-23.
- Approved customer-visible result: If another process uses VibeTV's preferred
  local port, the Mac App starts on a free private loopback port without showing
  an error screen. Only if automatic fallback also fails, the existing native
  screen shows `VibeTV couldn’t start` and identifies the process name, PID, and
  port followed by `Quit the app or stop the process, then click Try again.`
  The existing `Try again`, `Create report`, and `Open support log` actions
  remain unchanged.
- Approved files: `companion-installer-actions.tsx`,
  `mac-app-install-command.ts`, `mac-app-install-command.test.ts`, native
  `main.swift`, `URLSchemeTests.swift`, runtime endpoint handling, and their
  regression tests.

## 2026-07-23 — Single-writer fallback safety

- User approval: After the merge-risk review identified a possible second
  display writer and stale fallback endpoint, the user explicitly ordered both
  risks to be fixed in the Codex task on 2026-07-23.
- Approved customer-visible result: An unrelated process on VibeTV's preferred
  port still causes automatic background fallback without a new screen. If the
  port belongs to another VibeTV service, the Mac App never starts a second
  display writer and uses the already approved `VibeTV couldn’t start` screen.
  After a fallback runtime restart, Control Center verifies the newly published
  port before reloading. No copy, control, or layout changes.
- Approved files: Companion port-owner classification and tests, native runtime
  endpoint rediscovery, its macOS contract test, and the matching architecture
  documentation.

## 2026-07-24 — Immediate provider activation with truthful pending usage

- User approval: In the delegated issue #247 task, the user explicitly required
  missing or unknown provider values to use the existing unavailable/`??`
  presentation instead of believable `0 %` or `100 %`, and then reported the
  provider switch timeout plus stale zero-percent card as another bug to fix.
- Approved customer-visible result: Enabling any provider returns immediately
  with `Checking`. While CodexBar obtains that exact provider's fresh usage,
  saved percentages that are no longer trustworthy show `??` without a reset
  time. The same provider card updates automatically as soon as fresh usage
  arrives; there is no timeout error, extra action, provider-specific copy, or
  new UI component.
- Approved files: `control-center-app.tsx`, `control-center-types.ts`,
  `usage-screen.tsx`, Companion provider preferences and usage normalization,
  and their regression tests.

## 2026-07-24 — Truthful partial provider usage

- User approval: While checking the connected VibeTV in the issue #247 task,
  the user explicitly rejected making the entire provider unavailable when
  only one value is missing and required only that value to show `??`.
- Approved customer-visible result: A provider with one known and one unknown
  normalized usage lane stays visible and fresh. The known Session or Weekly
  lane keeps its real percentage, while only the unknown lane shows `??` and
  no believable zero-percent bar. Existing extra or custom usage windows stay
  visible without invented Session or Weekly rows. No new control, screen, or
  provider-specific copy is added.
- Approved files: `control-center-types.ts`, `usage-screen.tsx`, its unit tests,
  Companion usage normalization, the generic display protocol, and firmware
  renderer contract tests.

## 2026-07-24 — Truthful partial usage in the live VibeTV preview

- User approval: During the real-device issue #247 verification, the user
  explicitly required an unavailable Session or Weekly value to show `??`
  instead of `0 %`, while keeping the other real value visible.
- Approved customer-visible result: The existing live VibeTV preview preserves
  the same partial-usage contract as the Usage card and device frame. Only the
  unknown Session or Weekly value renders as `??` with an empty bar; the known
  lane keeps its real percentage. No new component, screen, action, or
  provider-specific copy is added.
- Approved files: `live-vibetv-preview.tsx`, its focused unit test, and the
  Companion last-sent-frame reconstruction that supplies the generic lane
  availability flags.

## 2026-07-24 — Customer flow covers truthful partial usage

- User approval: In the issue #247 task, the user explicitly rejected showing
  a missing device value as `0 %` and required only that value to show `??`.
- Approved customer-visible result: The connected Overview preview shows `??`
  for an unavailable Codex Session while keeping the real Weekly percentage
  visible. This is the same already approved partial-usage state; no copy,
  control, layout, or product behavior changed.
- Approved files: The matching connected Overview assertion in
  `test-customer-flows.mjs`.

## 2026-07-24 — Accessible partial usage percentages

- User approval: The user's explicit issue #247 requirement says an unknown
  lane must show `??`, while every available lane keeps its real percentage.
- Approved customer-visible result: The live preview's accessible image label
  says `??` for an unavailable lane and keeps the `%` suffix on a known lane.
  It never describes an unknown value as a believable percentage.
- Approved files: The matching accessible preview label in
  `live-vibetv-preview.tsx`.

## 2026-07-24 — Usage cards show only CodexBar limit windows

- User approval: After identifying that CodexBar reports Weekly and Codex Spark
  Weekly for Codex but no Session limit, the user explicitly ordered the
  invented `Session: ??` row to be fixed with `dann fix es`.
- Approved customer-visible result: When CodexBar supplies an explicit usage
  window list, the provider card shows exactly those windows in their supplied
  order. A missing Session or Weekly window is absent instead of being invented
  as `??`. Legacy provider payloads without a window list retain the existing
  two-lane fallback.
- Approved files: `usage-screen.tsx` and its focused unit tests.
