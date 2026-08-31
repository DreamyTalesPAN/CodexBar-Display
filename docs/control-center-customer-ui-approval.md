# Control Center Customer UI Approvals

This append-only log is the machine-checked approval marker for customer-facing
Control Center changes. Every visible UI change needs a new entry that records
the user's explicit approval and the exact visible result. Technical work,
issue scope, or release permission never implies UI permission.

## 2026-08-25 — First AI provider check finishes before theme selection

- User approval: During the clean-Mac PR #406 rehearsal, the user observed that
  the mandatory theme chooser appeared while the first 65-provider check was
  still running, making the selected theme remain on `Installing` for more than
  two minutes. The user explicitly required that the provider check finish on
  the existing AI-usage checking screen before theme selection begins.
- Approved customer-visible result: On a fresh setup with no installed theme,
  `Starting AI usage` remains visible until CodexBar's one-time complete provider
  inventory has settled. Only then does `Choose your VibeTV theme` appear. The
  theme install no longer overlaps the initial provider scan; existing provider
  recovery, theme choices, install progress, and Overview entry remain unchanged.
- Approved files: `control-center-app.tsx`, `control-center-types.ts`, their
  regression tests, the Companion provider-setup gate and tests, and this
  approval record.

## 2026-08-13 — Collapsed sidebar click opens Appearance directly

- User approval: Continuation of the standing instruction to fix CI and the
  Codex review loop until both pass.
- Approved customer-visible result: In the icon-collapsed desktop sidebar,
  clicking the Appearance icon opens the Appearance tab in its current
  section instead of toggling an invisible submenu. The expanded sidebar
  keeps its existing collapsible Themes/Screensavers submenu. Token totals
  now also reach the Overview preview through the sent-frame snapshot, and
  an availability change repaints token bindings on the device; visible
  values stay the same otherwise.
- Approved files: `control-center-shell.tsx`, the Companion sent-frame log
  and snapshot parser with their tests, the firmware repaint detection with
  its native test, and this approval record.

## 2026-08-11 — Screensaver toggle first, everything else follows it

- User approval: During the candidate test on the connected VibeTV the user
  explicitly required: with the screensaver off, every standby detail must
  read as deactivated ("hier muss alles deactivated sein, wenn der
  screensaver off ist"), the toggle must be usable ("toggle funktioniert
  nicht, in settings auch nicht"), and installing a screensaver must not be
  possible while the toggle is off ("wenn hier toggle off, dann darf ich
  screensaver auch nicht installieren können").
- Approved customer-visible result: The Show screensaver toggle works for a
  connected VibeTV even before any screensaver is installed, in Settings and
  in the Screensavers view. While it is off, the Settings rows Show after,
  Brightness in screensaver, and Choose screensaver grey out completely,
  including their labels, and the link is inert. In the Screensavers view,
  Install buttons read `Turn On First` and stay disabled until the toggle is
  on; Create, Edit, and Preview stay available, and the off-banner explains
  the order.
- Approved files: `settings-screen.tsx`, `theme-library-screen.tsx`, their
  component tests, the realigned customer flows, and this approval record.

## 2026-08-11 — Genuine all-zero token totals render as 0

- User approval: Same instruction: fix CI and the Codex review loop until
  both pass.
- Approved customer-visible result: A completed token-history scan whose
  totals are genuinely zero shows `0` on the device and in every preview;
  only totals the frame does not carry render as `--`. The Companion marks
  completed totals explicitly on the wire (`tokenTotalsKnown`).
- Approved files: `live-vibetv-preview.tsx` and its test, the protocol
  frame marker, collector and firmware handling with their tests, and this
  approval record.

## 2026-08-11 — Theme refresh regressions assert the automatic flow

- User approval: Same instruction: fix CI and the Codex review loop until
  both pass. The approved 2026-08-04 automatic catalog-theme refresh stays
  authoritative.
- Approved customer-visible result: None. The theme-release regressions
  return to main's automatic-refresh assertions (no manual Update button
  for a theme-only refresh), matching the behavior the merged app already
  ships.
- Approved files: `test-customer-flows.mjs` and this approval record.

## 2026-08-11 — No locked tabs after entering the Control Center

- User approval: Same instruction: fix CI and the Codex review loop until
  both pass. The approved 2026-08-05 rule ("no locked tabs" after entry)
  stays authoritative.
- Approved customer-visible result: After the Control Center is entered,
  every tab stays enabled through device unreadiness, outages, and image
  reloads, exactly as approved on 2026-08-05; the merge had reintroduced
  PR-side tab locking, which is removed. Before entry, the startup gate
  keeps all tabs disabled as today.
- Approved files: `control-center-app.tsx` and this approval record.

## 2026-08-11 — Outage tab sweep names the Appearance tab

- User approval: Same instruction as below: fix CI and the Codex review loop
  until both pass.
- Approved customer-visible result: None. The companion-outage regression
  checks the existing `Appearance` tab instead of the pre-merge
  `Theme Library` label; no UI changes.
- Approved files: `test-customer-flows.mjs` and this approval record.

## 2026-08-11 — Codex review fixes for the merged PR #296 candidate

- User approval: The user explicitly instructed Codex to push PR #296, watch
  CI and the Codex review, and fix everything until both pass ("push und
  überwache CI / codex review. fix until pass").
- Approved customer-visible result: The startup gate follows the already
  approved rule again and opens Overview only on the first real preview frame;
  the merge had briefly reintroduced a 30-second auto-entry, which is removed.
  Screensaver token totals that are absent from the device frame render as
  `--` instead of a fabricated `0` on the device and in every preview. A
  failed screensaver-settings save restores the last device-confirmed values
  instead of leaving the unsaved slider value visible. During a screensaver
  install the selection is cleared until the complete pack is staged, with one
  new install log line; a failed install leaves standby without a screensaver
  until the install is retried. No other copy, control, or layout changes.
- Approved files: `control-center-app.tsx`, `live-vibetv-preview.tsx` and its
  tests, the firmware token-total rendering and its native tests, the
  Companion screensaver-install and upload-verification hardening and their
  tests, realigned assertions in `test-customer-flows.mjs`, and this approval
  record.

## 2026-08-04 — Updates keep the live theme identity during standby

- User approval: The user instructed Codex to continue making PR #296 ready to merge and to fix the findings from the Codex reviewer loop.
- Approved customer-visible result: No copy or layout changes. While a screensaver is visible, Updates evaluates the saved live theme instead of the screensaver, so an available live-theme refresh is not hidden.
- Approved files: Device status typing, active-theme upgrade resolution and tests, Companion standby-health pass-through, and this approval record.

## 2026-08-04 — Shopify themes are not a Mac App install path

- User approval: The user explicitly stated that Shopify theme handling is outdated, that Shopify themes currently have no connection to the Mac App, and instructed Codex to remove the obsolete test.
- Approved customer-visible result: Missing or unavailable catalog themes use neutral app-catalog wording. The Theme Library no longer tells customers to open a theme shop, and Shopify product pages are not presented as a Mac App theme-install path.
- Approved files: Theme Library availability wording, its customer-flow assertion, Shopify boundary documentation, customer-readiness checks, and this approval record.
## 2026-08-06 — Never open Overview before the first live preview

- User approval: During the cold-start test, the user explicitly required that
  the state with an unavailable preview must never appear in Overview and that
  customers may enter Overview only after the preview is available. The user
  then explicitly instructed Codex to build this fix together with the preview
  and test it on the connected VibeTV.
- Approved customer-visible result: A connected and paired VibeTV without a
  real display frame remains on the existing full-screen `Connecting to VibeTV`
  startup gate for as long as necessary. It shows `Waiting for live preview…`
  and does not expose Overview or the Control Center navigation. Overview opens
  only after the first valid live preview frame exists.
- Approved files: `control-center-app.tsx`, `device-startup-screen.tsx`, their
  regression assertions in `device-startup-screen.test.tsx` and
  `test-customer-flows.mjs`, and this approval record.

## 2026-08-05 — Give first usage up to 60 seconds

- User approval: The user explicitly instructed Codex to increase the first
  usage wait from 30 seconds to 60 seconds before entering the unavailable
  state.
- Approved customer-visible result: A connected VibeTV waiting for its first
  usage frame keeps the existing startup state for up to 60 seconds. The
  existing startup and Overview helper text says `up to 60 seconds`. If no
  usage arrives by then, Control Center opens the existing unavailable state.
- Approved files: `control-center-app.tsx`, `device-startup-screen.tsx`,
  `overview-screen.tsx`, their regression assertions, and this approval record.

## 2026-08-05 — Close the remaining update and recovery gaps

- User approval: After receiving the concrete list of all remaining P1/P2
  update, theme-refresh, outage, and recovery findings on PR #348, the user
  explicitly instructed Codex to fix all of them with the smallest possible
  code changes or by removing code.
- Approved customer-visible result: No new copy, control, or layout is added.
  Automatic theme refresh waits for the existing Mac App and firmware gates,
  respects install links, and does not repeat a failed job. A disconnected
  VibeTV or unavailable Mac App no longer presents cached data as live; missing
  first usage enters the existing unavailable state after 30 seconds. An
  explicit pairing rejection reopens the existing Connect recovery, while
  ordinary running outages keep the current tab. During firmware installation,
  the existing Settings and Theme Library device actions remain disabled.
- Approved files: `control-center-app.tsx`, `overview-screen.tsx`,
  `settings-screen.tsx`, their regression assertions in
  `test-customer-flows.mjs` and component tests, and this approval record.

## 2026-08-05 — One stable connection truth after an update

- User approval: During the exact customer update test, the user explicitly
  required that the updated Mac App never show reconnect UI, redirect to the
  Connect screen, hide tabs, or show a missing preview. The user also required
  the smallest KISS fix, deleting code wherever possible.
- Approved customer-visible result: After the Mac App update relaunches, the
  ready Control Center shows the existing Overview connection state, real
  preview, status cards, and available tabs without a second transient header
  connection label or a reconnect banner. Genuine first-time and recovery
  gates remain unchanged. No new copy, control, state, or fallback is added.
- Approved files: `control-center-shell.tsx`, `overview-screen.tsx`, their
  regression assertions, and this approval record.

## 2026-08-05 — Stable connected Control Center

- User approval: The user explicitly required the Mac App and VibeTV connection
  to stay stable, with no automatic return to Connect, no locked tabs, and no
  incomplete Overview preview after Connect.
- Approved customer-visible result: Before the first real display frame, the
  existing startup screen remains visible. The first Overview already has that
  verified frame and every Control Center tab is available. Afterward, temporary
  VibeTV or Mac App status failures keep the current tab, navigation, and last
  verified preview visible. Only the existing explicit setup reset starts device
  selection again. No new screen, copy, control, or recovery state is added.
- Approved files: `control-center-app.tsx`, `control-center-types.ts`,
  `overview-screen.tsx`, `live-vibetv-preview.tsx`, their regression assertions,
  and this approval record.

## 2026-08-04 — Automatically refresh the installed catalog theme

- User approval: After the connected VibeTV showed the old Clippy labels even
  though the new Mac App and firmware supplied dynamic Codex usage-window
  labels, the user explicitly required that all installed catalog themes be
  updated automatically by the new Mac App and ordered this behavior to be
  implemented in the new PR.
- Approved customer-visible result: When a ready VibeTV uses an older revision
  of its active bundled catalog theme, the Mac App updates that theme once in
  the background. If the theme requires newer firmware capabilities, it waits
  for the existing VibeTV Update flow and then refreshes the theme. Customers
  do not need to open Updates or press a separate theme-update button, and no
  new copy, control, layout, or technical choice appears. A failed automatic
  attempt does not loop; the existing manual retry remains available.
- Approved files: `control-center-app.tsx`, the matching customer-flow
  assertions in `test-customer-flows.mjs`, and this approval record.

## 2026-07-31 — Token total counts up while its history is still growing

- User approval: After the local preview proved that CodexBar warms its cost
  scan incrementally and reports every intermediate result as a success, the
  user explicitly required that customers see a number quickly instead of
  waiting minutes for the total, and specified the exact behavior: show the
  number right away with a badge such as `still updating`, and remove that badge
  once the same number was reported twice in a row. In the local preview, the
  user explicitly moved that badge to the centered space above the summary
  heading.
- Approved customer-visible result: The `Total tokens in the last 30 days`
  section shows the current total as soon as any token history exists. While
  that history is still growing, a centered `Still counting` badge with a
  spinner sits above the summary heading, and the number rises with each
  completed scan until it stops changing. Once two consecutive scans report
  the same history, the badge disappears and the total stands. The existing
  full-height `Loading usage`
  placeholder remains only while no token history exists at all. No other copy,
  control, or layout changed; the provider list and its refresh action are
  untouched. This supersedes the 2026-07-27 decision only for the headline
  total, which may now be shown before the history is final because it is
  explicitly labeled as still counting.
- Approved files: `usage-screen.tsx`, `usage-screen.test.tsx`,
  `control-center-types.ts`, the Companion collector convergence rule and its
  usage response field, their Go regression tests, and this approval record.

## 2026-07-27 — Reachable VibeTV stays connected while usage loads

- User approval: While testing preview 99.0.109, the user showed that a reachable VibeTV waiting for fresh usage was incorrectly presented as disconnected. Earlier in the same customer test, the user explicitly required that no incomplete preview appear before usage is ready and that this state use an understandable loading message.
- Approved customer-visible result: A reachable and paired VibeTV remains `Connected` while its display waits for fresh usage. Overview and the device card no longer say `Not connected` or ask the customer to reconnect. The display and preview show `Waiting for usage`, with the existing expectation that this can take up to 30 seconds. A genuinely unreachable or rejected device keeps the existing reconnect state.
- Approved files: Overview status semantics, live VibeTV preview loading state, their shared device-state helper and regression tests, and this approval record.

## 2026-07-27 — Dynamic text sizing for provider usage windows

- User approval: After showing that `Weekly used` and `Codex Spark Weekly used` were readable but unnecessarily small on the physical VibeTV, the user explicitly requested that theme text dynamically use the available text-box space like existing fitted status text.
- Approved customer-visible result: Each bundled theme defines the largest label size its existing lane can hold and uses the firmware's shared shrink-to-fit behavior for longer provider window names. Short names render larger, long names shrink only as far as necessary, and the Mac previews mirror the same integer font-size choice.
- Approved files: All five current theme-pack revisions and immutable release metadata, ThemeSpec fit schema and Theme Studio round-trip, Mac ThemeSpec preview sizing, release build preservation, customer-flow and unit assertions, and this approval log.

## 2026-07-27 — Provider labels remain readable in WebKit

- User approval: The user showed that provider labels were unreadable in the installed Mac App and explicitly instructed Codex to fix the problem locally for every bundled theme before pushing.
- Approved customer-visible result: Every ThemeSpec text element uses a WebKit-stable alphabetic baseline with an explicit ascent inside the existing firmware clip box. Provider and usage-window labels remain readable in Overview, Theme Library, and Theme Studio across all bundled themes without provider- or theme-specific offsets.
- Approved files: Live VibeTV ThemeSpec preview renderer, its unit and vector-golden assertions, and this approval log.

## 2026-07-27 — ThemeSpec text uses the VibeTV top edge

- User approval: The user compared the installed Synthwave theme on the physical VibeTV with the Mac App preview and explicitly reported that `SESSION used` and `WEEKLY used` render too high only in the preview.
- Approved customer-visible result: ThemeSpec text uses its `y` coordinate as the top edge in every Mac preview, matching the VibeTV renderer without theme- or provider-specific offsets. Synthwave labels sit at the same vertical positions as the physical display; other approved preview behavior is unchanged.
- Approved files: Live VibeTV ThemeSpec preview renderer, its unit and vector-golden assertions, and this approval log.

## 2026-07-27 — Customer-safe internal preview wording

- User approval: The user explicitly instructed Codex to continue after the KISS implementation and review.
- Approved customer-visible result: No customer-visible change. The live preview test describes the backward-compatible render-cache fallback without exposing the internal Companion service name.
- Approved files: Live VibeTV preview unit test and this approval log.

## 2026-07-27 — KISS refactor preserves approved previews

- User approval: The user explicitly requested a neutral KISS review and instructed that its findings be implemented, with the goal of substantially less code.
- Approved customer-visible result: The already approved exact live previews and neutral Theme Library examples remain visually unchanged. The implementation uses one generated render-pack source, a direct revision cache, and deterministic unit coverage instead of a second proxied browser app.
- Approved files: Hosted render-pack route, Live VibeTV preview resolution, Theme Library preview assertions, Companion revision cache, and their tests.

## 2026-07-27 — Exact live previews and neutral catalog examples

- User approval: After the preview failure and proposed separation of live, catalog, and editor previews were explained, the user explicitly instructed `rest so umsetzen` and clarified that Custom Themes must retain the preview behavior of the older Mac App while large catalog previews may use neutral example data.
- Approved customer-visible result: Overview renders the exact installed published or Custom Theme revision with the latest real VibeTV frame. Known legacy revisions remain previewable. A disconnected VibeTV shows a clear paused-live state instead of loading forever. Theme Library thumbnails and the large preview use short neutral `Session`/`Weekly` example values; only the large preview labels them as example data.
- Approved files: Live VibeTV preview, Theme Library preview, revisioned render-pack storage and serving, local Mac App theme bundle, and their unit, Companion, customer-flow, and visual assertions.

## 2026-07-27 — Theme releases stay compatible by app generation

- User approval: After the exact old-app/old-firmware and new-app/new-firmware theme release matrix was explained, the user explicitly instructed `dann bau das so` in the Codex task on 2026-07-27.
- Approved customer-visible result: An older Mac App keeps its bundled legacy themes. The current Mac App uses the matching current theme generation, upgrades firmware before refreshing the active theme, and never exposes an incompatible current theme pack to an older app generation. Shopify presentation remains unchanged; matching GitHub catalog metadata supplies the generation-correct install package and requirements. No new customer controls or technical compatibility choices appear.
- Approved files: Theme catalog selection and merge logic, the local Mac App theme bundle, immutable theme release metadata, and their unit, customer-flow, and release assertions.

## 2026-07-27 — One update keeps the active theme compatible

- User approval: The user explicitly required in the Codex task on 2026-07-27 that customers with an older VibeTV update everything needed for the new usage display.
- Approved customer-visible result: The existing single `Update` action updates the Mac App first when needed, then VibeTV firmware, and automatically refreshes the active catalog theme after a capability upgrade. If only that final theme refresh fails, the existing `Try again` action repeats the theme step without flashing firmware again. Theme Library shows the existing `Update Needed` state whenever a theme requires a capability the connected VibeTV does not advertise. No technical substep or provider-specific choice appears.
- Approved files: `control-center-app.tsx`, theme catalog metadata, the release firmware target, and their customer-flow and release-gate assertions.

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

## 2026-07-24 — Dynamic usage lanes in Theme Studio

- User approval: The user reviewed the exact final `1180×820` Theme Studio
  screenshot in the Codex task on 2026-07-24 and explicitly approved it with
  `freigegeben`.
- Approved customer-visible result: Theme Studio keeps the approved immersive
  editor and adds one `Usage lane` selector to the Inspector. An element can be
  `Always visible`, `Hide with slot 1`, or `Hide with slot 2`; the approved
  screenshot shows the first usage progress bar selected with
  `Hide with slot 1`. The preview uses the dynamic `Weekly` and
  `Codex Spark Weekly` labels and keeps both lanes inside the 240×240 display.
- Approved files: `primitive-inspector.tsx`, Theme Studio serialization,
  geometry and capability validation, `live-vibetv-preview.tsx`, the display
  frame route, and their unit and customer-flow assertions.

## 2026-07-24 — Provider-neutral ThemeSpec label clipping

- User approval: While testing the signed PR 260 preview against the real
  VibeTV, the user explicitly required the Mac App and VibeTV label rendering
  to be consistent, then rejected a Codex-only hotfix and required a scalable
  solution for all providers.
- Approved customer-visible result: Every provider label in a width-bounded
  ThemeSpec text element stays inside its lane and uses the same overflow
  alignment and clipping as the VibeTV firmware. In the connected
  `claude-creature` Overview preview, the second lane visually shows
  `Codex Spark` like the physical VibeTV instead of allowing the full raw
  `Codex Spark Weekly` label to overlap the first lane or clipping it earlier
  because the Mac uses different font widths. The complete raw label remains
  available to usage data and accessibility text.
- Approved files: `live-vibetv-preview.tsx`, its unit tests, and this approval
  record.

## 2026-07-24 — Firmware-font provider label parity

- User approval: During the signed PR 260 hardware test, the user explicitly
  required the Mac App label to show `Codex Spark` exactly like the connected
  VibeTV and required the solution to scale to every provider rather than
  special-casing Codex.
- Approved customer-visible result: Width-bounded ThemeSpec text uses the
  VibeTV font widths in every provider preview. The connected
  `claude-creature` Overview therefore shows exactly `Codex Spark`, neither the
  overlapping raw `Codex Spark Weekly` nor an earlier browser-only truncation.
  The complete raw provider label remains unchanged in usage data and
  accessibility text.
- Approved files: `live-vibetv-preview.tsx`, its unit tests, and this approval
  record.

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

## 2026-07-27 — Missing-theme chooser before Control Center

- User approval: During two real-device preview tests, the user explicitly
  rejected the temporary Overview screen and required a newly connected
  theme-missing VibeTV to reach `Choose your VibeTV theme` before Overview is
  ever shown.
- Approved customer-visible result: After the customer presses `Connect`, the
  full Control Center shell and Overview remain hidden while the first
  theme-state readback is pending. A VibeTV with no active theme opens the
  already approved `Choose your VibeTV theme` screen directly. A VibeTV with a
  confirmed active theme retains the normal Overview behavior while its first
  display image is delayed.
- Approved files: `control-center-app.tsx`, `control-center-types.ts`, their unit
  tests, and the matching customer-flow assertions in
  `test-customer-flows.mjs`.

## 2026-07-27 — Usage loading stays separate from provider readiness

- User approval: The user explicitly required that customers never see the
  internal `CodexBar` name, that the token area keep showing a spinner with
  `Loading usage` until token history is actually ready, and that the provider
  list may finish and appear independently. After reviewing the KISS plan, the
  user ordered its implementation with `na dann mach das`.
- Approved customer-visible result: Usage never names `CodexBar`. While token
  history is pending, the token area shows only `Loading usage`; it does not
  show a misleading empty or zero state. The independently loaded AI provider
  list remains visible and usable. A successful token-history result containing
  zero shows the real zero/no-data result. No extra global refresh control is
  added.
- Approved files: `control-center-app.tsx`, `control-center-types.ts`,
  `provider-setup-card.tsx`, `usage-screen.tsx`, `usage-screen.test.tsx`, and
  the matching customer-flow assertions in `test-customer-flows.mjs`.

## 2026-08-27 — Cold provider recovery moves to the usage service

- User approval: While rebasing the provider-selection work onto main, the
  user explicitly chose to rely on the usage service's collector warm-up and
  first-run provider scan instead of a UI-level automatic retry in this
  Claude task on 2026-08-27.
- Approved customer-visible result: Startup checks each enabled provider
  exactly once, one at a time. A cold `No usage available` result stays
  visible, and `Check again` is the explicit recovery. This supersedes the
  2026-08-04 startup double-retry; the setup hint behavior from that record
  stays.
- Approved files: `control-center-app.tsx`, the matching customer-flow
  assertions, and this approval record.

## 2026-08-03 — Provider selection in Setup and Settings

- User approval: The user explicitly approved the exact visible
  provider-selection result in the Codex task on 2026-08-03.
- Approved customer-visible result: Usage is read-only and no longer contains
  provider controls. Setup and Settings share the `AI providers` card with
  provider search, `Automatic` and `Always show one`, Include or Always-show
  selection, enable switches, `Check again`, focused recovery actions, and
  setup completion only after every enabled provider is freshly ready and
  included in the valid display selection.
- Approved files: `control-center-app.tsx`, `control-center-types.ts`,
  `provider-picker.tsx`, `settings-screen.tsx`, `setup-screen.tsx`,
  `usage-screen.tsx`, and their unit and customer-flow assertions.

## 2026-08-03 — Unsaved fixed selection blocks setup completion

- User approval: The user's explicit approval of the provider-selection UI
  includes setup completion only after the display selection is valid.
- Approved customer-visible result: Choosing `Always show one` keeps `Finish
  setup` disabled until the customer selects and saves the provider that VibeTV
  should always show. Returning to `Automatic` restores the saved automatic
  selection.
- Approved files: `provider-picker.tsx`, `setup-screen.tsx`, and their unit and
  customer-flow assertions.

## 2026-08-03 — Cancelling fixed mode preserves Automatic

- User approval: The user's explicit approval of the provider-selection UI
  includes a separate Automatic pool that stays selected until the customer
  changes it.
- Approved customer-visible result: If the customer opens `Always show one`
  but returns to `Automatic` without choosing a fixed provider, the complete
  saved Automatic provider pool remains unchanged.
- Approved files: `provider-picker.tsx` and the matching customer-flow
  assertion.

## 2026-08-03 — Provider display saves stay ordered

- User approval: The user's explicit approval requires line-local Pending and
  atomic provider display writes.
- Approved customer-visible result: While one display choice is being saved,
  its provider row alone shows Pending and the remaining display choices wait
  until that save finishes. Provider enablement and readiness controls remain
  separate.
- Approved files: `provider-picker.tsx` and the matching unit and customer-flow
  assertions.

## 2026-08-03 — Empty Usage points to Settings

- User approval: The user's explicit approval makes Usage read-only and moves
  provider management to Settings.
- Approved customer-visible result: When no provider usage is available, Usage
  tells the customer to manage providers in Settings and refresh instead of
  referring to controls below the empty state.
- Approved files: `usage-screen.tsx` and its unit test.

## 2026-08-03 — Provider outage status stays singular

- User approval: The user's explicit approval of the shared provider-selection
  UI includes one clear readiness or service status per provider.
- Approved customer-visible result: A provider whose readiness state already
  says `Service outage` shows that status once instead of rendering a duplicate
  outage badge beside it.
- Approved files: `provider-picker.tsx` and its unit test.

## 2026-08-03 — Display choices wait for saved selection

- User approval: The user's explicit approval requires the provider display
  selection to be stored and changed atomically without losing prior choices.
- Approved customer-visible result: Provider enablement and readiness remain
  available while display selection loads, but display mode and Include or
  Always-show choices unlock only after the saved selection is available.
- Approved files: `provider-picker.tsx`, its unit test, and the matching
  customer-flow assertion.

## 2026-08-04 — Short common-provider list

- User approval: The user explicitly requested a short provider list in Setup
  and Settings with search, four common providers, and a Show More action.
- Approved customer-visible result: Codex, Claude, Cursor, and GitHub Copilot
  appear first. Other providers stay collapsed behind `Show all providers`,
  while search still finds every provider and enabled, selected, or pending
  providers remain visible. Setup explains why `Finish setup` may still be
  disabled while provider checks are running.
- Approved files: `provider-picker.tsx`, `setup-screen.tsx`, their unit and
  customer-flow assertions, and this approval record.

## 2026-08-04 — Provider startup checks stay truthful

- User approval: After reproducing that startup showed `No usage available`
  for Codex until `Check again` returned `Ready`, the user explicitly approved
  fixing that behavior in the Codex task on 2026-08-04.
- Approved customer-visible result: During Setup startup, enabled AI providers
  remain in `Checking` while their fresh exact checks run one at a time. A
  provider shows `Ready` or `No usage available` only after its own fresh check
  completes; the customer does not need to press `Check again` to correct the
  initial state.
- The approved issue plan also requires display selection to validate against
  the current provider inventory. When a removed provider remains in an older
  Automatic selection, the next customer change drops that stale ID instead of
  sending it back and trapping the picker in a rejected state.
- Approved files: `control-center-app.tsx`, `provider-picker.tsx`, the provider
  onboarding assertions in `test-customer-flows.mjs`, and this approval record.

## 2026-08-04 — Removed providers no longer trap Automatic

- User approval: The user approved the Issue #245 implementation plan, which
  explicitly requires the complete display selection to be validated against
  the current CodexBar inventory.
- Approved customer-visible result: If an older Automatic selection contains a
  provider that no longer exists, the next customer selection removes that
  stale ID and saves the remaining current providers normally.
- Approved files: `provider-picker.tsx`, the stale-inventory customer-flow
  assertion in `test-customer-flows.mjs`, and this approval record.

## 2026-08-04 — Cold provider checks retry before blocking setup

- User approval: After reproducing the restart path where Codex showed `No
  usage available` until the customer pressed `Check again`, the user
  explicitly asked to fix it in the Codex task on 2026-08-04.
- Approved customer-visible result: Startup retries transient cold provider
  checks twice with a short delay while the provider remains pending. The
  setup hint names any enabled provider that is outside the saved display pool,
  so a disabled `Finish setup` button has a concrete next action.
- Approved files: `control-center-app.tsx`, `provider-picker.tsx`,
  `setup-screen.tsx`, their unit and customer-flow assertions, and this
  approval record.
## 2026-07-27 — Overview waits for complete usage

- User approval: While testing the signed PR 260 preview with the connected
  VibeTV, the user explicitly required a KISS solution that keeps the existing
  setup state visible until usage is ready and only shows Overview for the
  first time once its preview is complete.
- Approved customer-visible result: A connected and paired VibeTV without its
  first real usage frame stays on `Connecting to VibeTV` with
  `Waiting for usage…`. Neither the Mac App nor VibeTV shows a provider-only,
  empty theme preview. The first Overview already contains the real usage
  lanes. Later temporary reconnects keep the already opened Control Center
  visible.
- Approved files: `control-center-app.tsx`, `overview-screen.tsx`,
  `live-vibetv-preview.tsx`, its unit tests, the Companion daemon frame gate and
  its tests, the setup-flow principles, and the matching customer-flow
  assertions in `test-customer-flows.mjs`.

## 2026-07-27 — Matching development firmware can install themes

- User approval: The user reported that the connected VibeTV already has the
  required firmware and must therefore allow the new themes to be installed.
- Approved customer-visible result: A VibeTV advertising the required
  capabilities on a matching development firmware such as
  `1.0.40-dev.a5f52c7` shows an enabled `Install` action for themes requiring
  `1.0.40`. Lower firmware and devices missing a required capability remain
  blocked with `Update Needed`.
- Approved files: `theme-library-screen.tsx`, the matching customer-flow
  assertion in `test-customer-flows.mjs`, and this approval record.

## 2026-07-27 — Setup screen uses only the VibeTV logo

- User approval: While testing preview 99.0.109, the user explicitly required
  removing the unreadable gray `Control Center` tagline below the VibeTV logo
  on the setup screen.
- Approved customer-visible result: Setup and loading screens show only the
  VibeTV logo. The sidebar branding remains unchanged.
- Approved files: `control-center-brand.tsx`, `setup-status-screen.tsx`, its
  unit test, and this approval record.

## 2026-07-27 — First usage wait sets a time expectation

- User approval: While testing the setup screen, the user explicitly required
  the first-usage message to tell customers how long the wait can take.
- Approved customer-visible result: The waiting screen says that loading the
  first usage data can take up to 30 seconds, matching the collector retry
  cadence.
- Approved files: `device-startup-screen.tsx`, its unit test, and this approval
  record.

## 2026-07-31 — PR #260 exact Control Center preview

- User approval: The user reviewed the Control Center preview for PR #260 at
  commit `f16cc5a` and explicitly approved the exact visible result, including
  its layout, copy, states, and interaction flows.
- Approved customer-visible result: The exact customer-facing Control Center
  result rendered by PR #260 at commit `f16cc5a`, including its current layout,
  copy, screen states, and interaction flows. This approval does not cover any
  later customer-visible change.
- Approved files: All customer-facing Control Center files present in the
  reviewed PR #260 preview at commit `f16cc5a`, plus this approval record.

## 2026-07-31 — PR #260 setup and post-update state fixes

- User approval: The user tested preview `99.0.144` against the real VibeTV,
  clicked the existing `Update` action, and confirmed that the completed
  firmware change to `1.0.39` worked. After that real-device test, the user
  explicitly said the result fits and approved the UI.
- Approved customer-visible result: After a firmware update, Control Center
  evaluates the refreshed VibeTV and theme state, reports the successful
  update normally, and does not show a stale `VibeTV needs attention` result.
  During first-time setup, a failed WiFi connection remains on the required
  WiFi setup screen even when a stored theme exists. No copy, layout, control,
  or additional customer decision changes.
- Approved files: `control-center-app.tsx`, the matching setup and firmware
  regression assertions in `test-customer-flows.mjs`, and this approval
  record.

## 2026-07-31 — Appearance section descriptions

- User approval: The user selected and explicitly approved the proposed short
  descriptions for both Appearance sections and instructed Codex to continue.
- Approved customer-visible result: `Themes` explains that it customizes the
  live usage screen while VibeTV is active. `Screensavers` explains that it
  appears when VibeTV enters standby after being idle. Both descriptions sit
  directly below their section heading and use the approved wording.
- Approved files: `theme-library-screen.tsx`, its focused test, the final
  selected-state correction in `control-center-shell.tsx`, and this approval
  record.

## 2026-07-31 — Flat Settings sections

- User approval: After reviewing the current Settings screen and a compact
  settings-row reference, the user explicitly requested removing the cards,
  separating the screensaver from display brightness, and rebuilding the full
  tab as sections with stronger headings and dividers.
- Approved customer-visible result: Settings uses flat `Display`, screensaver,
  and `Setup` sections separated by native dividers. `Show screensaver` has its
  own section and no longer appears inside the display-brightness area. Existing
  controls, actions, progressive disclosure, and VibeTV brand styling remain.
- Approved files: `settings-screen.tsx`, its focused test and matching
  customer-flow coverage, and this approval record.

## 2026-07-31 — Screensaver section hierarchy

- User approval: After reviewing the local flat Settings preview, the user
  explicitly corrected the screensaver heading to `Screensaver` and requested
  `Show screensaver` as the first toggle option below it.
- Approved customer-visible result: The section heading reads `Screensaver`.
  Its first setting is `Show screensaver`, with the existing explanation and
  toggle beside it. The enabled-only settings continue below that first option.
- Approved files: `settings-screen.tsx`, its focused test, and this approval
  record.

## 2026-07-31 — Lean Settings headings

- User approval: After reviewing the corrected local Settings preview, the user
  explicitly requested deleting the explanatory lines below `Display` and
  `Show screensaver`.
- Approved customer-visible result: `Display` and `Show screensaver` no longer
  repeat their meaning in secondary copy. Their headings, controls, values, and
  all functional behavior remain unchanged.
- Approved files: `settings-screen.tsx`, its focused test, and this approval
  record.

## 2026-07-31 — Screensaver toggle in Appearance

- User approval: The user explicitly requested an on/off toggle at the top of
  Appearance > Screensavers and a prominent disabled-state notice that does not
  lock the tab.
- Approved customer-visible result: Appearance > Screensavers shows `Show
  screensaver` above the library. When off, a native destructive alert explains
  that the screensaver is disabled while every library action remains usable.
  The toggle writes through the same saved standby state as Settings.
- Approved files: `theme-library-screen.tsx`, `control-center-app.tsx`, their
  focused tests and customer-flow coverage, and this approval record.

## 2026-07-31 — Compact shared brightness control

- User approval: After reviewing the flat Settings preview, the user explicitly
  requested compact save actions beside both percentage sliders, removal of the
  minimum/maximum explanation, and one shared UI element for both brightness
  settings.
- Approved customer-visible result: Display brightness and screensaver
  brightness use the same compact control: label and percentage, followed by a
  slider and non-stretched save button in one row. The redundant brightness
  range sentence is removed.
- Approved files: `settings-screen.tsx`, its focused test and matching
  customer-flow coverage, and this approval record.

## 2026-07-31 — Compact screensaver timeout

- User approval: The user explicitly requested placing `Show after` and its
  dropdown in the same row.
- Approved customer-visible result: The screensaver timeout uses the native
  horizontal field layout, with its label on the left and dropdown on the
  right. Its values and save behavior remain unchanged.
- Approved files: `settings-screen.tsx`, its focused test, and this approval
  record.

## 2026-07-31 — Auto-saving brightness sliders

- User approval: The user explicitly requested moving each percentage below
  its slider thumb, removing both primary save buttons, and saving automatically
  when the slider interaction ends.
- Approved customer-visible result: Both brightness controls show their current
  percentage directly below the thumb. Dragging updates the value locally;
  releasing the thumb saves that exact value through the existing setting
  write. No brightness save button remains.
- Approved files: `settings-screen.tsx`, its focused test and matching
  customer-flow coverage, and this approval record.

## 2026-08-02 — Two-column Settings layout

- User approval: The user provided a new Settings reference and explicitly
  requested desktop section rows with the section intro on the left, controls
  on the right, and a clean single-column mobile layout.
- Approved customer-visible result: `Display`, `Screensaver`, and `Setup` use
  two columns on desktop and one column on mobile. Display and Screensaver keep
  only their title on the left; Setup keeps its existing description there.
  Controls and actions stay on the right. Toggle rows place the switch before
  its label. Both brightness sliders keep their percentage below the thumb and
  save only when the interaction ends, without save buttons.
- Approved files: `settings-screen.tsx`, its focused test, and this approval
  record.

## 2026-08-03 — Screensaver selection guard

- User approval: The user explicitly requested that the Settings screensaver
  switch remain unavailable until a `screensaverPath` is selected, while the
  existing `Choose screensaver` path remains the way to select one.
- Approved customer-visible result: Settings keeps the screensaver controls
  visible, disables only activation and dependent controls until a screensaver
  is chosen, and keeps `Choose screensaver` available so the existing
  Appearance > Screensavers flow can be used.
- Approved files: `settings-screen.tsx`, its focused test, the matching
  customer-flow test, and this approval record.

## 2026-08-03 — Stable PR #296 CI assertions

- User approval: The user explicitly ordered all PR #296 CI and Bug Detector
  findings to be fixed with KISS and dead-code removal. The exact visible
  Appearance split and Settings selection guard were already explicitly
  approved in the entries above; this CI repair preserves those results.
- Approved customer-visible result: No new visible UI is introduced. `Themes`
  continues to contain live themes, `Screensavers` contains standby themes,
  and Settings keeps screensaver activation unavailable until a screensaver is
  selected. Reloaded installs continue to reopen their existing progress.
- Approved files: `themes.ts`, `test-customer-flows.mjs`, their focused
  assertions, and this approval record.

## 2026-08-03 — PR #296 merge-readiness test maintenance

- User approval: The user explicitly requested that PR #296 be made ready to
  merge, with its CI repaired and the existing screensaver packaging path ready
  for the next creative phase. No new customer-visible UI was requested.
- Approved customer-visible result: The already approved Appearance,
  Screensavers, Theme Studio, and Settings behavior stays unchanged. This round
  only makes the automated route cleanup and brightness-save assertion
  deterministic and verifies that screensaver artifacts ship in the Mac App.
- Approved files: `test-customer-flows.mjs`, the screensaver packaging tests,
  the matching technical documentation, and this approval record.

## 2026-08-03 — Standby firmware-update migration guard

- User approval: The user explicitly requested that all Codex reviewer findings
  on PR #296 be fixed until the PR is ready to merge. No new customer-visible UI
  was requested.
- Approved customer-visible result: The existing firmware-update flow remains
  visually unchanged. After a restart, it also migrates an outdated live theme
  when the update was started while the screensaver was visible.
- Approved files: `control-center-app.tsx`, its existing customer-flow
  regression test, and this approval record.

## 2026-08-03 — Invalidated live-preview frame

- User approval: The user explicitly requested that every Codex reviewer
  finding on PR #296 be fixed until the PR is ready to merge.
- Approved customer-visible result: When the current display session has not
  produced a usable frame yet, Overview stops showing the invalid frame from
  the prior session and returns to the existing waiting-for-usage state.
- Approved files: `live-vibetv-preview.tsx`, its existing customer-flow
  coverage, and this approval record.

## 2026-08-03 — Live-preview reset countdown parity

- User approval: The user explicitly requested that every Codex reviewer
  finding on PR #296 be fixed until the PR is ready to merge.
- Approved customer-visible result: Reset countdowns in the existing Overview
  preview advance once per second between Mac App frames and stop at zero,
  matching the VibeTV instead of freezing and jumping. No copy, control, or
  hierarchy changes.
- Approved files: `live-vibetv-preview.tsx`, its focused unit test, and this
  approval record.

## 2026-08-03 — Live-preview freshness parity

- User approval: The user explicitly requested that every Codex reviewer
  finding on PR #296 be fixed until the PR is ready to merge.
- Approved customer-visible result: The existing Overview preview advances its
  clock and date between Mac App frames. When the exact frame marks all usage
  unavailable, Overview returns to its existing non-data preview state instead
  of showing stale percentages. No new copy, control, or hierarchy is
  introduced.
- Approved files: `live-vibetv-preview.tsx`, its focused unit test, the matching
  display-frame transport fix and tests, and this approval record.

## 2026-08-03 — Screensaver export asset identity

- User approval: The user explicitly requested that every Codex reviewer
  finding on PR #296 be fixed until the PR is ready to merge and that the
  screensaver packaging path be ready for the next creative phase.
- Approved customer-visible result: No copy, control, hierarchy, or state
  changes. Exporting a screensaver now keeps distinct images distinct when
  their source folders contain the same file name, so the installed result
  matches the Theme Studio design.
- Approved files: `theme-studio.ts`, its focused unit test, and this approval
  record.

## 2026-08-04 — Standby live-theme selection identity

- User approval: The user explicitly requested that every Codex reviewer
  finding on PR #296 be fixed until the PR is ready to merge.
- Approved customer-visible result: While a screensaver is visible, the
  existing `Themes` view keeps the saved live theme selected instead of
  selecting that screensaver. Screensavers remain in the existing
  `Screensavers` view. No copy, control, or hierarchy changes.
- Approved files: `control-center-app.tsx`, `active-theme-upgrade.ts`, its
  focused unit test, and this approval record.
## 2026-08-03 — Restarted stream clears its rejected preview frame

- User approval: In the PR #260 Codex task, the user explicitly instructed that
  every new bug reported by the Codex bug reviewer be fixed according to the PR
  documentation until the reviewer reports no more bugs. The reviewer then
  identified the stale live-preview frame retained across a display-stream
  restart as the next bug to fix.
- Approved customer-visible result: When the Mac App authoritatively reports
  that no frame from the restarted display stream is available yet, Overview
  stops showing percentages from the previous stream and uses its existing
  loading preview until a current frame arrives. Temporary network and server
  failures keep the last verified preview visible. No copy, control, layout, or
  customer decision changes.
- Approved files: `live-vibetv-preview.tsx`, its response regression tests, and
  this approval record.

## 2026-08-06 — Bounded startup gate and honest disconnect states

- User approval: The user explicitly instructed a one-shot rebuild ("Lösung 1")
  making cold and warm starts robust and flake-free, after the analysis showed
  the unbounded first-usage gate locks customers out permanently when no
  renderable frame ever arrives (for example, no provider configured yet).
- Approved customer-visible result: The startup gate still opens Overview only
  on the first real preview frame (the "Never open Overview before the first
  live preview" rule stays). A just-seen VibeTV no longer flips to a
  disconnected/setup experience because of a single missed probe (bounded 75s
  reconnect grace, honest disconnect afterwards). The theme render pack
  retries every 5 seconds instead of parking on a permanent "Preview
  unavailable". When the Mac App runtime becomes unreachable or blocked, the
  device is shown as disconnected instead of replaying stale "connected"
  state, and the app keeps polling for recovery in the blocked state. A cached
  preview frame stops counting as live once the device stays disconnected past
  the reconnect grace. No layout or control changes.
- Approved files: `control-center-app.tsx`, `live-vibetv-preview.tsx`, their
  regression tests, and this approval record.

## 2026-08-07 — A finished update failure stops outliving the update

- User approval: The user reported the exact state from their own screen during
  the hardware rehearsal — "hier steht update failed" while the same card showed
  Installed firmware `1.0.39` and Available firmware `1.0.39` — and instructed
  that the remaining findings be fixed and proven on cold and warm start.
- Approved customer-visible result: When an update job has finished with a
  failure and a fresh firmware check reports that nothing is pending, the
  Updates card no longer shows `Update failed` with the power-cycle advice, its
  `Try again` and `Create report` actions, or the progress bar; the card falls
  back to the plain up-to-date state. While the firmware update really is still
  pending, the failure, its advice, and both actions stay exactly as they were.
  No copy, layout, control, or customer decision changes anywhere else.
- Approved files: `updates-screen.tsx`, its regression tests, and this approval
  record.

## 2026-08-08 — Warm-start pin of the released theme revision (no visible change)

- User approval: The user instructed this session to make the PR #348 candidate
  bulletproof — updates, downgrades, cold start, warm start — including its
  gates. The flagged change carries no customer-visible difference to approve:
  it exports the existing `renderTextPrimitive` helper unchanged so a new
  regression test can pin what an older VibeTV on public firmware `1.0.39`
  shows in the live preview while the Mac App is already the candidate.
- Approved customer-visible result: None. The live preview renders exactly as
  before; the new `released-theme-downgrade` test only locks that the theme
  revision installed by public release v1.0.52 stays retrievable and renders
  real numbers from a candidate Companion frame during warm start. No copy,
  layout, control, or customer decision changes.
- Approved files: `live-vibetv-preview.tsx` (export-only change),
  `released-theme-downgrade.test.ts`, and this approval record.

## 2026-08-09 — Mac-App-first gate closes the firmware-ahead mixed state

- User approval: During the warm-start rehearsal the user hit the mixed state
  on real hardware (candidate firmware, released app): the device rendered
  only unslotted theme elements, the app preview was unavailable, and the
  Updates card claimed "Available 1.0.52" although the runtime knew the
  candidate update. The user rejected a firmware-side legacy fallback and
  instructed: the state must never be enterable, and if it exists the Mac App
  must update immediately — "es muss bulletproof sein, dass dieser zustand
  niemals eintritt, und falls doch, dass dann entsprechend sofort geupdated
  wird. fix das!".
- Approved customer-visible result: While the Mac App release check is still
  unresolved and a VibeTV update is offered, the VibeTV card shows the new
  notice "Checking Mac App — Waiting for the Mac App update check. The VibeTV
  update unlocks when it finishes." and the primary action stays a disabled
  "Checking updates" button. In the installed native app the Mac App card
  announces the update the runtime's own release check reports even when the
  hosted browser check still claims up to date, and a pending Mac App update
  opens the native Sparkle dialog automatically once per offered version.
  Outside the native app an update without a verified DMG stays unannounced,
  exactly as before. A firmware install attempted through any other path is
  refused with "Update the Mac App first." and the existing error surface.
- Approved files: `updates-screen.tsx`, `updates-screen.test.tsx`,
  `control-center-app.tsx`, and this approval record.

## 2026-08-09 — Update failures survive an inconclusive firmware check

- User approval: Part of the same bulletproofing instruction for the update
  path ("es muss bulletproof sein … fix das!"); the Codex review of 0cdafcf
  flagged that a failed `/v1/updates/latest` check silently discarded a
  finished update failure. Hiding failure details on an inconclusive check
  contradicts the approved rule that only a conclusive no-update result may
  clear them.
- Approved customer-visible result: When a firmware update job has failed and
  the next firmware check itself fails (`check_failed`), the Updates card keeps
  showing the failure, its power-cycle advice, and the `Try again` /
  `Create report` actions. Only a conclusive check that reports nothing
  pending clears them, exactly as already approved on 2026-08-08. No other
  copy, layout, control, or customer decision changes.
- Approved files: `updates-screen.tsx`, `updates-screen.test.tsx`, and this
  approval record.

## 2026-08-20 — Support reports name the Mac App surface instead of a dead link

- User approval: The user explicitly assigned issue #341 ("Remove the unusable
  loopback Control Center URL from support reports") in the Codex task of
  2026-08-20, including its acceptance criteria for the native surface, the
  non-navigable loopback field, and the unchanged hosted report.
- Approved customer-visible result: A support report created in the Mac App no
  longer contains a `page` field pointing at `http://127.0.0.1:47832/control-center`,
  which answers `410 Gone` in a normal browser. Instead it records the surface
  (`native-mac-app` or `browser`), the Mac App version and build, and keeps the
  loopback address only in the clearly internal `internalRuntimeAddress`
  diagnostic field. A report created on the hosted page keeps its real,
  openable public page URL. No visible control, screen, or copy changes.
- Approved files: `support-report.ts`, `support-report.test.ts`,
  `control-center-runtime.ts`, `control-center-types.ts`, and this approval
  record.

## 2026-08-09 — Completed updates stop gating newly discovered releases

- User approval: Covered by the standing bulletproofing mandate for the update
  path ("es muss bulletproof sein … fix das!" and the explicit instruction to
  drive PR #348 to a green candidate); the Codex review of 2e6d6ff flagged
  that a completed firmware job suppressed every later update because status
  polling restores the completed job indefinitely.
- Approved customer-visible result: "Update complete" keeps standing alone
  only while the fresh firmware check still reports the version that job
  installed. As soon as a check discovers a different release (or a new active
  theme revision alongside it), the Updates card announces it and the Update
  action works again — no daemon restart or setup reset needed. The pinned
  rule that "Update complete" and "Update available" never describe the same
  version at the same time stays exactly as approved on 2026-08-08.
- Approved files: `updates-screen.tsx`, `updates-screen.test.tsx`, and this
  approval record.

## 2026-08-13 — Provider resets, install preview, and theme list polish

- User approval: Given live in the 2026-08-13 bench session while driving the
  PR #296 candidate on real hardware: "hier sollen nicht die usage windows
  stehen sondern die provider und ihr jeweiliger nächster reset across all
  usage windows" (Night Clock), "jo bau das hier noch direkt" (the ten-second
  post-install screensaver preview), "das löschen." (screensaver-off hint),
  "den kleinen previews hier border radius geben", "entferne das hier
  überall … soll es stattdessen irgendwo ne pille bekommen" (PUBLISHED
  label), "oben vibetv weg … session, 7d und all time größer" and "nein, das
  muss natürlich alles gleich groß sein" (Token Fire totals), plus the
  request that the Appearance sub-entries hover across the full row.
- Approved customer-visible result: Night Clock lists each provider with its
  soonest usage reset and hides rows for providers without live data; themes
  that require the new provider-slots capability show the existing firmware
  update and not-supported blockers on older VibeTVs. After every screensaver
  install the VibeTV shows the chosen screensaver once for ten seconds and
  then returns to the live theme — never while the screensaver toggle is off.
  Token totals render compactly (1.4M, 384M, 1.07B) at one shared size on the
  device and in every preview. Theme lists drop the "PUBLISHED" status line
  and custom themes carry a "Custom" badge instead; the screensaver-off hint
  loses its second sentence; small theme previews gain rounded corners; the
  Appearance sub-entries hover and click across the full sidebar row. The
  Theme Studio offers the provider variables, bindings, and "Provider N has
  data" visibility for custom themes.
- Approved files: `control-center-shell.tsx`, `control-center-types.ts`,
  `live-vibetv-preview.tsx`, `live-vibetv-preview.test.ts`,
  `theme-library-screen.tsx`, `theme-studio/primitive-inspector.tsx`,
  `lib/theme-studio.ts`, `lib/theme-studio-capabilities.ts`, and this
  approval record.

## 2026-08-13 — Honest text boxes in the Theme Studio and the bigger Claude reset line

- User approval: Given live in the 2026-08-13 session: "das ist doch scheiße.
  wie können wir das intuitiver machen" after the stored text box silently
  shrank an enlarged font ("ich hab im editor auf font size 2 gestellt und es
  ist immer noch so klein"), and "ich will dass wir das aktuelle claude
  creature theme, das wir auch mit der mac app ausliefern, durch dieses
  ersetzen. ich hab da die resettime größer gemacht, das haben sich viele
  kunden gewünscht."
- Approved customer-visible result: In the Theme Studio the Width field and
  the canvas selection outline always show the stored clip/fit box of a text
  element instead of the wider rendered text run, and when fit-shrink renders
  a text below its configured size the inspector says "Text is shrunk to fit
  the …px box." next to a "Fit box to text" button that widens the box in one
  click. The shipped Claude Creature theme becomes rev 5 with the
  customer-requested bigger reset line: "Resets in …" renders at font size 2,
  centered across the full display width, with the divider and creature
  nudged up to make room. Nothing else about the theme changes; existing
  customers receive the new revision through the already-approved automatic
  active-theme refresh and the Updates card.
- Approved files: `theme-studio/primitive-inspector.tsx`,
  `theme-studio/editor-geometry.ts`, the `claude-creature` theme pack, and
  this approval record.

## 2026-08-13 — The preview date matches the VibeTV clock

- User approval: Given live in the 2026-08-13 session on the Codex finding
  about the `date` binding: "Fixen + Freigabe", after the reachability check
  showed the Theme Studio offers Date as an insertable variable, so a custom
  theme can hit the mismatch even though no shipped theme pack uses it.
- Approved customer-visible result: Wherever a ThemeSpec uses the Date
  variable, the Live VibeTV preview and the Theme Studio sample values render
  the full `03.07.2026` instead of `03.07` — the same `DD.MM.YYYY` the
  Companion frame and the device clock produce. A date box that fits in the
  Studio therefore fits on the hardware; the previous short date hid width and
  shrink problems until the theme was installed. Nothing else changes.
- Approved files: `live-vibetv-preview.tsx`, `live-vibetv-preview.test.ts`,
  `theme-studio/editor-geometry.ts`, and this approval record.

## 2026-08-18 — Screensaver updates arrive on their own

- User approval: Given live in the 2026-08-18 session after the customer saw
  the Night Clock render "Weekly" and "Codex Spark Weekly" instead of the
  provider names — "und wieso stehen hier jetzt nicht die provider sondern
  wieder die slots?! hier sollte doch codex und claude stehen." — followed by
  the decision to fix it inside PR #296 rather than defer it.
- Approved customer-visible result: When the catalog ships a newer revision of
  the selected screensaver, VibeTV receives it automatically, exactly as it
  already does for the live theme. The customer no longer has to notice a stale
  screensaver and reinstall it by hand from Appearance → Screensavers. The live
  theme keeps priority: only one theme is installed per round, so the screen
  currently on display is never interrupted for the screensaver. A screensaver
  built in the Theme Studio has no catalog entry and is therefore never
  replaced. Nothing about the screensaver list, its previews, or the manual
  install button changes.
- Approved files: `lib/active-theme-upgrade.ts`,
  `lib/active-theme-upgrade.test.ts`, `control-center-app.tsx`, and this
  approval record.

## 2026-08-18 — Exported packs declare what they need to render

- User approval: Given live in the 2026-08-18 session as part of the standing
  instruction to fix the Codex findings on PR #296 — this one reported that a
  Theme Studio design using provider-slot bindings exported a pack claiming
  firmware 1.0.24 and no provider-slots capability.
- Approved customer-visible result: A theme built in the Theme Studio that
  shows provider rows now exports a pack declaring `provider-slots-v1` and
  firmware 1.0.41, the same way the bundled Night Clock does. Installing such a
  pack on a VibeTV without provider slots is refused by the existing capability
  check with the familiar firmware-update hint, instead of installing and
  leaving those rows silently empty. Designs mixing usage and provider rows
  declare both. A plain design still requires nothing and keeps 1.0.24. The
  Theme Studio itself, its editor, and the export button are unchanged.
- Approved files: `lib/theme-studio.ts`, `lib/theme-studio.test.ts`, and this
  approval record.

## 2026-08-18 — The screensaver update actually reaches shipped packs

- User approval: Given live in the 2026-08-18 session — the customer asked for
  the automatic screensaver update to be proven on the device ("ja, will ich",
  then "CI is grün, mach"). That hardware run showed the feature approved
  earlier the same day never fired for any shipped screensaver.
- Approved customer-visible result: The automatic screensaver update from the
  earlier entry now actually happens. Its path matcher only accepted six-hex
  revision suffixes, which is the live-slot convention; every shipped
  screensaver uses eight (nc-3-e18e4217, rcf-6-03e818f0, tf-5-9aeed240) and was
  therefore never recognised as upgradable. On the bench the device sat on
  Night Clock revision 2 — showing usage windows instead of the provider rows —
  and stayed there. Nothing else about the behaviour changes: the live theme
  still has priority, and Theme Studio screensavers are still left alone.
- Approved files: `lib/active-theme-upgrade.ts`,
  `lib/active-theme-upgrade.test.ts`, and this approval record.

## 2026-08-18 — The screensaver update no longer waits for a visit to Settings

- User approval: Given live in the 2026-08-18 session — asked to choose the
  visible result for the fourteenth Codex finding of the day, the customer
  answered "Freigeben, mit Standby-Aufschub".
- Approved customer-visible result: The automatic screensaver update from the
  two earlier entries now runs for everyone. It read the installed screensaver
  path out of the settings screen's own state, and nothing filled that state
  unless the VibeTV happened to be ready on the very first status after launch
  — otherwise the update never ran until someone opened Settings. On the bench
  the device sat on Night Clock revision 2 for 20 minutes of five-second polls
  without a single install attempt. The path now rides the VibeTV snapshot the
  app already polls, exactly like the live theme's own path. Nothing else
  changes: the live theme keeps priority, one install per round, Theme Studio
  screensavers are still left alone, and the Settings screen behaves as before.
  While the screensaver is on display the update is held back rather than
  installed, because installing into the slot restores the live theme first and
  would wake the screen with nobody asking; it resolves on its own with the
  next frame that moves the usage numbers.
- Approved files: `components/control-center-app.tsx`,
  `components/control-center-types.ts`, `lib/active-theme-upgrade.ts`,
  `components/live-vibetv-preview.tsx`, `components/live-vibetv-preview.test.ts`,
  `scripts/test-customer-flows.mjs`, and this approval record.

## 2026-08-18 — A missing AI provider no longer replaces the Control Center

- User approval: A customer support report (Mac App `1.0.53`, firmware
  `1.0.40`) plus a screen recording showed the customer stuck on "Choose your
  VibeTV theme" with every install ending in "Install failed — Theme installed,
  but Mac App did not send a fresh image to VibeTV." The user confirmed the
  diagnosis, ruled out sending customers to CodexBar ("die kunden wissen nicht
  was codexbar ist und sollen auch nie in codexbar kommen"), and instructed to
  file and implement the fix for a release the customer can download: "leg die
  an und fang direkt an, die zu bearbeiten."
- Approved customer-visible result: Installing a theme while AI usage is not
  ready no longer reports a failed installation after the files reached the
  device. A `theme-missing` device with a healthy stream still opens the theme
  chooser exactly as approved on 2026-07-30, and every other stream failure
  keeps its existing handling.
- Approved files: `control-center-types.ts`, `control-center-types.test.ts`,
  `server.go`, `server_test.go`, and this approval record.

## 2026-08-19 — AI usage recovery runs before themes and Overview

- User approval: The user rejected the provider panel on Overview and the
  misleading `LIVE PREVIEW PAUSED — RECONNECT VIBETV TO CONTINUE` state, then
  instructed: "ok dann bau das so. leg meinetwegen auch issues zusammen, wenns
  sinn macht" after reviewing the proposed setup-first recovery flow. During
  implementation the user rejected the provider-specific permission, timeout,
  and sign-in instructions, requested an automatic background CodexBar start,
  and approved naming CodexBar only after `Try again` also fails, with a
  download action.
- Approved customer-visible result: A connected VibeTV with
  `provider_setup_required` stays in the existing full-screen setup language.
  The Mac App automatically repairs and starts the verified bundled CodexBar
  app without taking focus; CodexBar owns provider detection and enablement,
  while VibeTV only accepts a provider after a fresh usable usage check. The
  first failed automatic attempt shows one plain `Try again` action, without
  exposing internal provider status codes. Only when that customer retry also
  fails does the screen explain that CodexBar is required and offer
  `Download CodexBar` from the official release page. `Create support report`
  remains available. Recovery runs before mandatory theme setup and before
  Overview, including when the last usable provider disappears later. Overview
  and Usage contain no duplicate provider panel, and a connected VibeTV is
  never told to reconnect because only AI usage is missing. Full deliberate
  provider selection remains in #245.
- Approved files: `device-startup-screen.tsx`, `control-center-app.tsx`,
  `control-center-types.ts`, `live-vibetv-preview.tsx`, their tests, the
  customer-flow test, native runtime repair files, and this approval record.

## 2026-08-19 — A partly-ready provider list is not a broken Mac

- User approval: After a review of #373 reported that
  `providerSetupRequiresRecovery` treats the Companion's normal
  `{status: "ready", providers: [ready, not-ready]}` payload as a device that
  needs repair, the user instructed: "ok dann fix das." The reported visible
  consequence was that a Mac with one working provider and a second signed-out
  or usage-less provider met the full-screen AI-usage recovery on every cold
  start instead of Overview.
- Approved customer-visible result: The recovery screen appears only when the
  Companion's reconciled provider status is itself not usable. A customer whose
  CodexBar reports several providers, of which at least one delivers usage,
  goes straight to Overview as before; the individual failing providers stay
  visible as unavailable rather than escalating to a repair. Every state
  approved on 2026-08-19 is otherwise unchanged: the same recovery copy, the
  same single `Try again`, the same `Download CodexBar` only after a customer
  retry fails, and `Create support report` throughout.
- Approved files: `control-center-types.ts`, `control-center-types.test.ts`,
  `device-startup-screen.tsx`, the customer-flow test, and this approval record.

## 2026-08-19 — One provider incident cannot inherit the previous one

- User approval: The user instructed "fix CI until green" for #373, which
  includes the automated review gate. The Codex review of `f99d9ad` reported
  that a stale `CodexBar is needed` state survives into a later incident, and
  that the deliberate runtime restart during a repair is mistaken for a
  resolved incident and relaunches the automatic repair instead of showing the
  approved `Try again`.
- Approved customer-visible result: Every AI-usage incident starts at the plain
  `Try again` state. `Download CodexBar` appears only after a customer retry
  fails inside that same incident, never carried over from an earlier one. The
  Mac App restarting itself during a repair no longer counts as a resolved
  incident, so the customer keeps the approved `Try again` instead of watching a
  second automatic repair start. No copy, control, or screen order changes.
- Approved files: `control-center-app.tsx` and this approval record.

## 2026-08-19 — One repair is one screen, not five

- User approval: A live test on this Mac with the PR candidate installed
  (Mac App `99.0.144`, firmware `1.0.40`) walked the user through five screens
  in two minutes for a single `Try again`: the correct recovery screen, then a
  spinner-only "Starting your VibeTV display" with no usable action, then
  "Mac App offline — RECONNECT VIBETV TO CONTINUE" while the VibeTV had been
  connected the whole time, then a premature "CodexBar is needed", and finally
  Overview. The user called it flaky, asked for a read-only diagnosis and simple
  fixes, and approved them with "ja".
- Approved customer-visible result: A repair the app starts is presented as one
  operation. While it runs, the setup screen owns the window, so the runtime the
  repair stops on purpose no longer surfaces as a Mac App outage and no longer
  asks the customer to reconnect a VibeTV that never disconnected. The recovery
  screen always offers `Try again`, and that action is locked only while a check
  or repair is genuinely running — the "AI usage is ready, waiting for the first
  live image" state is a wait with no owner and now keeps its way out. Copy,
  layout, and screen order are unchanged, `Create support report` and the
  existing error alert stay available throughout, and `Download CodexBar` still
  appears only after a customer retry fails.
- Approved files: `control-center-app.tsx`, `device-startup-screen.tsx`,
  `device-startup-screen.test.tsx`, `main.swift`, and this approval record.

## 2026-08-19 — The temporary CodexBar is stopped on reload too

- User approval: The Codex review of `090a8db` reported that reloading the
  Control Center while a repair is outstanding leaves the temporary CodexBar
  this app started running for the rest of the window session. The user's
  standing instruction for #373 is to bring the pull request to a mergeable
  state, which includes clearing valid review findings.
- Approved customer-visible result: None. No screen, copy, control, or order
  changes. The recovery effect now sends the existing finish action when it
  tears down an outstanding repair, so the private CodexBar instance is stopped
  on a reload exactly as it already was on window close. A customer-owned
  CodexBar is still never stopped.
- Approved files: `control-center-app.tsx` and this approval record.

## 2026-08-19 — An incident ends on evidence, not on a quiet sample

- User approval: Testing the candidate on hardware, the user pressed `Try again`
  and landed briefly on Overview before being thrown back onto
  "CodexBar is needed"; `Create support report` flickered the same way. The
  recorded state log shows why: while the display stream restarts it reports no
  error for a single poll, and that quiet sample ended the incident. The user
  asked for a KISS, global fix and approved it with "KISS fix. nimm auch wieder
  code weg, falls möglich und bau ne globale lösung."
- Approved customer-visible result: The AI-usage recovery screen no longer
  flickers to Overview and back while a repair runs or while a support report is
  created. A provider incident now ends only on evidence that the device draws
  again — a healthy display stream, or a different failure — and never on a
  sample that merely reports nothing. A genuinely different stream failure still
  takes over immediately, and no incident is ever invented for a device that
  never reported one. No copy, control, or screen-order changes.
- Approved files: `control-center-app.tsx`, `control-center-app.test.ts`, and
  this approval record.

## 2026-08-19 — The incident, not the sample, decides the screen

- User approval: The previous attempt did not hold. Testing on hardware the user
  reported "ja flackert immer noch. ich komme immer noch auf overview" and asked
  for a KISS, global fix with code removed where possible.
- Approved customer-visible result: The AI-usage recovery screen no longer
  flickers to Overview while a repair runs or a support report is created. A
  provider incident is now carried alongside the device it belongs to and closes
  only on a snapshot that shows the device is fine again. While the repair has
  the Mac App down no snapshot arrives at all, so the incident holds instead of
  ending on the gap. A VibeTV that is genuinely gone still closes the incident so
  the connect screen wins, and a different device failure still takes over. No
  copy, control, or screen-order changes.
- Approved files: `control-center-app.tsx`, `control-center-app.test.ts`, and
  this approval record.

## 2026-08-19 — A support report describes the device, it does not redefine it

- User approval: After three failed attempts the user reported that pressing
  `Create support report` still switched the app to Overview. Measured on the
  live machine: `GET /v1/status` returns `active=true` for the connected VibeTV
  while `GET /v1/diagnostics` returns `active=false` for the same device. The
  user's standing instruction is to fix what makes sense along the way.
- Approved customer-visible result: Creating a support report, and repairing AI
  usage, no longer switch the screen. The report describes the same VibeTV as
  every other endpoint, and it no longer overwrites the live device state — the
  status poll remains the single owner of that. No copy, control, or
  screen-order changes.
- Approved files: `control-center-app.tsx` and this approval record.

## 2026-08-19 — Cleanup after the flicker hunt

- User approval: With the root cause fixed and confirmed on hardware
  ("funktioniert jetzt"), the user asked to work through the remaining review
  findings, push, and watch CI.
- Approved customer-visible result: One change is visible and it removes a trap.
  A provider incident whose Mac App never comes back is now treated as a Mac App
  outage, so the customer reaches the Mac App recovery screen with its restart
  action instead of being held on "AI usage could not start" and offered a
  CodexBar download that cannot restart a stopped runtime. The incident still
  holds for the whole duration of a repair the app started. Everything else is
  internal: dead indirection removed, and the automatic repair can no longer be
  skipped for an incident because its scheduling timer was cancelled by an
  unrelated re-render. No copy, control, or screen-order changes.
- Approved files: `control-center-app.tsx`, `control-center-app.test.ts`, and
  this approval record.

## 2026-08-20 — Do not send a customer after software they already have

- User approval: On the bench the recovery screen offered `Download CodexBar`
  while CodexBar was installed and running; the real cause was that every
  provider was switched off. The user rejected forcing at least one provider to
  stay enabled, asked for the `Open CodexBar` route instead, and asked that
  #245 record its removal.
- Approved customer-visible result: When CodexBar's engine is ready but every
  provider in it is switched off, the recovery screen reads `No AI provider is
  switched on` and offers `Open CodexBar`, which brings CodexBar to the front.
  The `CodexBar is needed` screen with `Download CodexBar` stays exactly as it
  was for the case where CodexBar really is missing. `Try again` and `Create
  support report` are unchanged in both. This is a stopgap: the recovery screen
  has no sidebar, so the provider list in Usage cannot be reached from there.
  #245 removes it once setup and settings own provider selection.
- Approved files: `device-startup-screen.tsx`, `device-startup-screen.test.tsx`,
  `control-center-types.ts`, `control-center-runtime.ts`,
  `control-center-app.tsx`, `check-customer-ui-copy.mjs`, and this approval
  record.

## 2026-08-20 — A provider that timed out is not a provider that was switched off

- User approval: The customer-flow suite went red on the `Open CodexBar`
  stopgap; the user asked to get CI green.
- Approved customer-visible result: `No AI provider is switched on` now needs
  every provider to report `enabled: false`. A provider that reports a failure
  without an `enabled` flag — a timeout, for instance — keeps the existing
  `CodexBar is needed` screen instead of being described as switched off. No new
  copy, controls, or screen order; this only narrows which of the two existing
  screens a customer sees.
- Approved files: `control-center-types.ts` and this approval record.

## 2026-08-20 — The usage service standing in for the inventory is not a provider

- User approval: The user asked for the six review findings on this PR to be
  fixed, this one among them.
- Approved customer-visible result: When CodexBar's own probe times out, it
  reports a single `codexbar` entry standing in for the provider inventory, and
  the enablement flag on that stand-in is a zero value rather than an answer.
  `No AI provider is switched on` and `Open CodexBar` no longer appear for that
  payload; the customer sees the existing `CodexBar is needed` failure screen
  instead. A real inventory in which every provider reports `enabled: false`
  still shows the switched-off screen. No new copy or controls.
- Approved files: `control-center-types.ts`, `device-startup-screen.test.tsx`,
  and this approval record.

## 2026-08-20 — A theme is not "active" while the VibeTV cannot draw it

- User approval: Asked which of the four open Codex findings on PR #373 to take
  on, the user chose "Alle vier", the option covering "die überschriebene
  Provider-Meldung in server.go und das zu kurze Repair-Timeout".
- Approved customer-visible result: When a theme install finishes on a VibeTV
  that has no ready AI provider, the install card now reads `Theme installed.
  VibeTV shows it once AI usage is ready.` instead of `Theme is active on
  VibeTV.` The install still counts as successful and no control changes; only
  the completion sentence differs, and only for that outcome. Every other
  install keeps `Theme is active on VibeTV.`, and a screensaver keeps
  `Screensaver is ready on VibeTV.` The Companion decides the sentence, so the
  card cannot contradict the device again: three layers used to overwrite it —
  the install job at 100%, the app's final status, and the card itself — and a
  customer whose device was still drawing the error frame was told the theme was
  on screen.
- Also approved, not customer-visible: the browser's own repair timeout no
  longer expires while the native repair is still working (55s could not cover
  the repair's bounded 8s + 20s + 2s + 35s worst case, so a successful repair was
  reported as a failure and its result discarded).
- Approved files: `control-center-app.tsx`, `theme-library-screen.tsx`,
  `companion/internal/companionapi/server.go`, `scripts/test-customer-flows.mjs`,
  and this approval record.

## 2026-08-20 — An update cannot start into a Mac App that is stopping

- User approval: Asked how to close the fifth Codex finding (the update/repair
  race across the process boundary), the user chose "Neue Jobs abweisen": "der
  Companion blockt während eines angekündigten Shutdowns neue Update-Jobs mit
  409, Swift meldet den Shutdown vorher an."
- Approved customer-visible result: In the seconds while the Mac App is stopping
  its background work to repair the AI usage service, pressing `Update` in the
  Updates tab reports `Mac App is restarting.` with `Wait a moment, then start
  the update again.` instead of starting an update that would be killed
  mid-flight. No new control and no new screen; this is the existing update
  failure path with its own reason. The opposite order is unchanged: an update
  that is already running still makes the repair wait, and the customer sees
  nothing at all.
- Approved files: `companion/internal/companionapi/server.go`,
  `macos/VibeTVControlCenter/main.swift`, and this approval record.

## 2026-08-20 — The temporary CodexBar is released on reload too (no visible change)

- User approval: Standing instruction for this PR, given as "Alle vier" and then
  "Neue Jobs abweisen" — close the Codex findings on #373. This entry covers a
  finding with no customer-visible result; it is recorded because the gate
  covers every file under `src/components/`, not because anything on screen
  changed.
- Approved customer-visible result: None. No copy, control, hierarchy, or state
  the customer can see changes. The recovery cleanup decided whether a repair
  was still outstanding by looking at the timeout handle, but the success path
  clears that handle before awaiting the provider retry. A reload in that window
  therefore skipped the finish action, and the native side kept the temporary
  CodexBar it had started for the rest of the window session. An explicit flag
  now says whether a recovery is outstanding, and one function both clears it
  and sends the finish.
- Approved files: `control-center-app.tsx` and this approval record.

## 2026-08-20 — Recovery flow drives the frozen clock (no visible change)

- User approval: Standing instruction for this PR — close the Codex findings and
  get #373 green. This entry covers a flaky required check, not a UI decision.
- Approved customer-visible result: None. No copy, control, hierarchy, or state
  changes, and the flow asserts exactly what it asserted before. Only the way
  the test drives time changes: the app reaches `Starting AI usage` through a
  `setTimeout(..., 0)`, and `page.clock` freezes time until the test advances
  it. A single `runFor(0)` right after `goto` fires only what is already
  scheduled, so when the first `/v1/status` lands just after it, the timer that
  sets the busy state stays pending for good and the screen never moves. The
  flow now keeps nudging the clock while it waits.
- Approved files: `scripts/test-customer-flows.mjs` and this approval record.

## 2026-08-20 — "No AI provider is switched on" can finally happen

- User approval: Asked how the aggregate path should learn the real enablement,
  the user chose "Nur im Fehlerfall fragen": drop the invented flag, and ask
  CodexBar's inventory only when the usage probe returns nothing usable.
- Approved customer-visible result: The approved `No AI provider is switched on`
  screen with `Open CodexBar` becomes reachable. Until now it could not appear
  with real data, so a customer who had switched every provider off was sent to
  `CodexBar is needed — Download and open CodexBar` — told to download the app
  whose switches they had just flipped, which is what commit 791d061 in this
  same PR set out to stop. No new copy or controls; an approved screen simply
  starts appearing in the state it was written for. Verified against bundled
  CodexBar 0.46.0: `usage --json` lists only switched-on providers and carries
  no enabled field at all, while `config providers --json` reports all 65 with
  an honest flag. One provider switched on but silent is still a reporting
  failure and keeps the existing screen.
- Approved files: `companion/internal/codexbar/provider_setup.go`,
  `companion/internal/companionapi/provider_setup.go`, and this approval record.

## 2026-08-20 — One repair keeps one screen across the provider retry

- User approval: Standing instruction for this PR — close the Codex findings on
  #373. This one removes a screen that should never have appeared; it adds no
  copy and no control.
- Approved customer-visible result: During a usage-service repair the customer
  keeps the recovery screen until the repair reports back. The repair hands
  straight over to the provider retry, which changes the busy state before the
  Mac App reports itself online again, and in that gap the Mac App recovery
  screen pushed itself in front of a repair that had just succeeded — the same
  flicker this PR removed elsewhere. Both busy states now count as one incident.
  Nothing else changes: a Mac App that genuinely never comes back still reaches
  its own recovery screen, because that path does not depend on the busy state.
- Approved files: `control-center-app.tsx` and this approval record.

## 2026-08-20 — A repair waits for the theme install it would delete

- User approval: Standing instruction for this PR — close the Codex findings on
  #373. This removes a failure, adds no copy and no control.
- Approved customer-visible result: When AI usage drops out while a theme
  install is running, the automatic repair waits for the install to finish
  instead of starting immediately. The install job and its worker live inside
  the Mac App's background process, and the repair stops that process on
  purpose, so firing during an install deleted the running install and the
  progress the customer was watching — it simply stopped answering. The customer
  now sees the install finish, and the usage recovery starts after it. Nothing
  is skipped: the recovery still runs, only later.
- Approved files: `control-center-app.tsx` and this approval record.

## 2026-08-20 — A VibeTV that is gone is a connection problem, not a provider one

- User approval: Standing instruction for this PR — close the Codex findings on
  #373. This restores a screen the customer should already have been getting.
- Approved customer-visible result: When a VibeTV that was waiting for an AI
  provider is switched off or leaves the network, the customer now reaches the
  reconnect screen once the device is confirmed gone. Until now the provider
  incident was carried past the loss, so `AI usage could not start` stayed in
  front of a device that was not there at all, and the reconnect picker never
  appeared. No copy and no controls change; an existing screen simply stops
  being blocked by the wrong one. A single missed poll and a Mac App outage
  still keep the incident, because the repair takes the Mac App down on purpose.
- Approved files: `control-center-app.tsx` and this approval record.

## 2026-08-21 — Extend "software they already have" to a sign-in that is missing

- User approval: Reviewing PR #373 the user was shown that the recovery screen
  still offered `Download CodexBar` when CodexBar was installed and a provider
  was switched on but not signed in, and explicitly asked for that to be fixed
  in the same pull request together with a fresh bench run. This applies the
  principle the user already approved on 2026-08-20 under "Do not send a
  customer after software they already have" to the remaining cases; the
  narrower wording then only covered every provider being switched off.
- Approved customer-visible result: Whenever CodexBar's engine answers, the
  recovery screen offers `Open CodexBar` and reads
  `Finish AI setup in CodexBar` / `CodexBar is installed, but it still cannot
  read your AI usage. Open CodexBar, finish what it asks for, then try again.`
  The `Download CodexBar` action and its `CodexBar is needed` heading remain
  only when the engine never answered. VibeTV does not say which step is
  missing -- a sign-in, a macOS permission, an account without usage -- because
  CodexBar owns that distinction and VibeTV only reads the status it reports.
- Approved files: `control-center-types.ts`, `device-startup-screen.tsx`,
  `check-customer-ui-copy.mjs`, `device-startup-screen.test.tsx`, and this
  approval record.

## 2026-08-21 — Two faults the user found on the bench, not in review

- User approval: Driving the recovery screen himself on the final candidate, the
  user reported both directly: pressing `Try again` left him with "gar keinen
  state, der mir jetzt anzeigt ob etwas passiert im Hintergrund oder nicht, der
  button ist einfach nur inactive", and then `Download CodexBar` appeared while
  CodexBar was installed and running on that Mac. He had asked for that download
  to stop appearing for software customers already have on 2026-08-20, and again
  on 2026-08-21.
- Approved customer-visible result: A retry the customer pressed now shows
  `Starting AI usage` while it runs, instead of leaving the previous error on
  screen with only a greyed-out button; the error from the attempt before no
  longer suppresses that. And a CodexBar that answers with an empty inventory --
  what it returns after providers are switched back on, until one is opened once
  -- is treated as installed, so the screen offers `Open CodexBar` rather than a
  download. `Download CodexBar` remains only when the engine never answered, or
  when CodexBar reports its own probe failed under the `codexbar` stand-in.
- Approved files: `control-center-types.ts`, `device-startup-screen.tsx`,
  `device-startup-screen.test.tsx`, and this approval record.

## 2026-08-24 — Deliver the approved download rule, and stop a mid-probe answer from undoing it

- User approval: The user asked for PR #373 to be made merge-ready and for the
  findings of a bug detector run to be fixed. The findings below are three ways
  the screen still contradicted a result the user had already approved twice --
  on 2026-08-20 under "Do not send a customer after software they already have",
  and on 2026-08-21 as "`Download CodexBar` ... remain only when the engine never
  answered". No new customer-visible rule is introduced here; this makes the
  code produce the result those entries describe. The exact visible wording is
  unchanged from the 2026-08-21 entries -- only which state reaches which of
  them. This entry records work done on the user's instruction and is his to
  confirm on the bench before hand-off.
- Approved customer-visible result: `Download CodexBar` and its `CodexBar is
  needed` heading now appear only when CodexBar's engine did not answer -- that
  is, CodexBar is missing, too old, or broken, the only cases a download fixes.
  Three states that previously reached the download no longer do:
  - CodexBar installed with providers switched on but none opened yet. The
    2026-08-21 entry approved treating this as installed, but the Companion
    never sends the empty provider list that was checked for; it sends a
    `codexbar` stand-in, which the same check excluded. The screen offers
    `Open CodexBar` and reads `Finish AI setup in CodexBar`.
  - The Companion answering `checking` because its own provider probe is
    running. It carries no engine and no providers, arrives on any status poll
    during an incident, and was read as "CodexBar is missing", flipping the
    screen to a download and back seconds later. It now keeps `Starting AI
    usage`, with `Try again` still pressable and the support report still
    reachable. This narrows the stand-in exception named at the end of the
    2026-08-21 entry: a stand-in under an engine that answered no longer routes
    to the download, because finding CodexBar's binary and reading its version
    is already proof it is installed.
  - A CodexBar choice inherited from a previous, already-closed incident. It is
    now cleared when an incident ends, so a new one never opens with a download
    on screen before anything has been tried.
- Approved files: `control-center-types.ts`, `device-startup-screen.tsx`,
  `control-center-app.tsx`, `device-startup-screen.test.tsx`, and this approval
  record.

## 2026-08-24 — A missed poll is not a lost VibeTV

- User approval: Found by the automated review the user asked to be run on this
  pull request and instructed to be fixed. It is a defect against a result the
  user has already approved: the 2026-08-20 entry that put provider recovery in
  front of the reconnect picker, and the approved rule that the first
  unsuccessful automatic attempt is followed by one plain `Try again` rather
  than another automatic repair. No new rule; the code did not hold to that one.
  This entry records work done on the user's instruction and is his to confirm
  on the bench before hand-off.
- Approved customer-visible result: During AI-usage recovery, a single missed
  status poll no longer ends the incident. The recovery screen stays where it
  is, and the customer keeps the `Try again` he was offered, instead of the
  screen flipping to the reconnect picker and a second automatic repair
  starting behind it. The device is still described as reconnecting only once
  the recovery gate has confirmed the loss -- the failure limit -- and only then
  does the reconnect picker take over from AI recovery, exactly as approved on
  2026-08-20. Nothing about the confirmed-loss case changes, and no copy changes.
- Approved files: `control-center-app.tsx`, `device-recovery-gate.ts`,
  `device-recovery-gate.test.ts`, and this approval record.

## 2026-08-24 — Mandatory theme setup explains temporary readiness

- User approval: Issue #400 was assigned for implementation with the explicit
  acceptance criteria that mandatory theme setup replace unexplained `Wait`
  labels with one visible activity indicator and a plain-language reason, keep
  provider recovery owned by #371 / PR #373, advance automatically to `Install`,
  and turn a bounded failure into an actionable error.
- Approved customer-visible result: While VibeTV checks firmware support or
  confirms its connection and theme-install support, one shared status above
  the theme list explains that work and shows one spinner. Theme buttons stay
  disabled but retain `Install` or their concrete blocker such as `Update
  Needed`; they never read `Wait` in mandatory setup. Firmware install keeps its
  existing reboot/reconnect progress, provider recovery keeps its separate
  #371 screen, a completed check exposes enabled `Install` actions
  automatically, and a terminal readiness error offers `Create support report`.
- Approved files: `theme-library-screen.tsx`,
  `theme-library-screen.test.tsx`, `control-center-app.tsx`, and this approval
  record.
## 2026-08-25 — Mandatory theme setup keeps one stacked theme list

- User approval: Continuation of the standing instruction to finish PR #373 and
  get its CI green. Records the visible result of commit 1870680 ("restore
  stacked theme setup list"), authored on the bench on 2026-08-24.
- Approved customer-visible result: In mandatory theme setup, the theme choices
  are one stacked vertical list again — one theme per row at every window size.
  The wide-window two/three-column grid introduced for #398 is removed, and the
  setup page may scroll vertically in the native default window. Every theme's
  install action stays reachable: the customer-flow regression now asserts the
  deliberate vertical list and that the last theme's action can be scrolled
  fully into view inside the native default viewport, replacing the earlier
  no-initial-scrollbar assertion. Theme previews, buttons, copy, and the #400
  readiness status above the list are unchanged.
- Approved files: `theme-library-screen.tsx`, `theme-library-screen.test.tsx`,
  `scripts/test-customer-flows.mjs`, and this approval record.

## 2026-08-25 — Recovery names the customer's tools and their real switch state

- User approval: Issue #405 was assigned for implementation with the explicit
  acceptance criterion that a non-ready provider answer list switched-off
  providers with their real switch state, so the customer sees which tools
  exist and are merely off instead of the generic connect message. The user
  additionally decided in the assigning conversation that first-run detection
  switches on only providers that actually deliver usage, never sign-in-error
  ones. This entry records work done on that instruction and is his to confirm
  on the bench before hand-off.
- Approved customer-visible result: After the customer's own retry fails, the
  AI-usage recovery screen adds short status rows under its verdict: each
  switched-on provider is named with its own failing reason (for example
  `Codex — This provider needs an active sign-in.`), and switched-off tools are
  named with `Switched off.` -- up to four; a fresh setup's dozens of
  untouched-off providers collapse into one `N AI providers — Switched off.`
  row. The first automatic attempt keeps its plain `Try again` without
  internals, the all-off state keeps its dedicated `No AI provider is switched
  on` view, and a checking probe shows no rows. On the Usage screen nothing
  changes: its provider list with switches already shows off providers.
- Approved files: `control-center-types.ts`, `device-startup-screen.tsx`,
  `control-center-types.test.ts`, `device-startup-screen.test.tsx`, and this
  approval record.

## 2026-08-25 — Recovery test does not require a transient paint

- User approval: Continuation of the user's instruction to finish issue #405
  and PR #406 after fixing every automated review finding. This records a test
  correction found while proving that exact approved recovery flow; it adds no
  new copy, control, decision, or customer state.
- Approved customer-visible result: AI-usage recovery remains unchanged. While
  the automatic first attempt is still running, the setup gate may show
  `Starting AI usage`. If that attempt finishes before the browser paints the
  intermediate state, the same gate may proceed directly to the already
  approved `AI usage could not start` result. The customer still gets the same
  recovery action, provider checks, retry behavior, and final successful
  transition. The customer-flow test now accepts either valid entry paint and
  continues to assert the complete recovery contract.
- Approved files: `scripts/test-customer-flows.mjs` and this approval record.

## 2026-08-31 — Setup becomes a six-step wizard

- User approval: The user reviewed this record's wording and instructed on
  2026-08-31 that it be entered (`trag du ein`), on the basis of their
  instruction to continue the setup-wizard handover (`mach weiter`) and their
  explicit decision on 2026-08-30 that a
  provider row keeps its on/off switch whatever its health reports AND that the
  display step only offers providers that can actually produce a reading
  ("beides"). The wizard's own shape — its six steps, its dialogs, and the
  hosted page keeping a single Download action — was decided by the product
  owner before this branch and is recorded in the handover's decision table.
- Approved customer-visible result: Setup is one full-screen wizard whose step
  follows real state instead of button presses: a welcome screen that names
  what it is waiting for, choosing a VibeTV (with manual IP entry behind a link,
  and the firmware check and install inside the connect step), choosing AI
  providers, the display mode, a theme, and a live screen that hands over to
  Control Center by itself. Every failure is a dialog over the step that caused
  it, and every step carries one Help control with `Ask AI to fix` and `Create
  support report`. A typed IP address that nothing answers now keeps its dialog
  open with the address still in the field and the reason under it, instead of
  silently closing. The AI-usage dialog appears over whatever is on screen
  rather than only on the provider step, and does not dim the app behind it. A
  provider row always offers its switch. The theme step still offers all four
  live themes but disables Install with the device's own reason when this
  VibeTV cannot take one. Recent activity in Support holds 20 entries instead of
  10. app.vibetv.shop keeps its single Download action in the new frame.
- Approved files: the setup wizard under `apps/control-center/src/components/setup/`,
  `control-center-app.tsx`, `provider-picker.tsx`, `theme-library-screen.tsx`,
  `scripts/test-customer-flows.mjs`, and this approval record.

## 2026-08-31 — Test correction: scope the installed-theme assertion

- User approval: The product owner's instruction to fix the remaining small
  items ("kleinkram dann auch fixen", 2026-08-31). This records a test-only
  correction found by `scripts/check-before-push.sh`; it adds no new copy,
  control, decision, or customer state.
- Approved customer-visible result: Unchanged. The theme install flow still
  shows the same progress lines and the same `Installed` state on the theme it
  installed. The customer flow now waits for that state inside the row it just
  installed instead of anywhere on the page: a VibeTV that already had another
  theme active shows `Installed` on that row too, which made the unscoped
  locator match two buttons and fail at random.
- Approved files: `scripts/test-customer-flows.mjs` and this approval record.

## 2026-08-31 — Setup wizard: two dead ends, and the rules behind the provider step

- User approval: The product owner asked to see the changes before approving
  ("erst zeigen", 2026-08-31), was walked through them step by step in a running
  wizard in the browser, then asked for the `0 VibeTVs` line to be corrected as
  well and approved the result as the seven points below ("'0 VibeTVs' gleich
  mitfixen ... dann Approval fuer sieben statt sechs Punkte").
- Approved customer-visible result:
  1. **Back returns the customer to where they were.** Going back from Display
     Mode to the provider step and pressing `Continue` moves forward again.
     Before, one Back press held the wizard on the provider step for the rest
     of the session: that step offers no Back by design, and `Continue`
     answered without moving. Restarting the app was the only way out. The same
     applies to going back from the theme step.
  2. **The device step no longer goes blank.** Typing an IP address while the
     automatic scan is still running used to end that scan without putting
     anything in its place: no list, no dialog, no way to scan again, on a step
     that has no Back. The address dialog now keeps the reason a wrong address
     failed, and closing it shows `We couldn't find your VibeTV` with
     `Scan again` and `Enter IP manually`.
  3. **A provider row's switch always turns the provider off.** It used to be
     refused with `This provider is selected for VibeTV.` for every enabled
     provider until a display mode had been saved -- so for the whole of a
     fresh setup, and permanently against an older companion. This is what
     `docs/control-center-ui-principles.md` rule 3 already required.
  4. **`Continue` on the provider step stays closed while a provider that is
     switched on still needs the customer.** It used to open as soon as one
     provider was healthy and then do nothing, because the companion refuses to
     finish setup while any enabled provider is not ready. The ways on are to
     sign that provider in or to switch it off.
  5. **A refusal from the companion on the provider or display step is a dialog
     over the frozen step**, carrying the reason and the next action. It used to
     be silent.
  6. **Setup does not finish against a provider that signed out** after its
     check. The check at the end now reads live provider health instead of the
     health last seen.
  7. **The device step reports a count only once a scan has answered.**
     `0 VibeTVs found on your WiFi.` used to be on screen from the moment the
     step appeared, for the up-to-30 seconds the scan takes and before it had
     even started. It now says `Looking for VibeTVs on your WiFi.` until there
     is a result.
- Approved files: `apps/control-center/src/components/setup/setup-wizard.tsx`,
  `setup-device-screen.tsx`, `setup-providers-screen.tsx`,
  `setup-provider-dialogs.tsx` (new), their tests, `control-center-app.tsx`,
  `scripts/test-customer-flows.mjs`, the companion's `preferences.go`,
  `provider_display.go` and their tests, and this approval record.

## 2026-08-31 — Two controls that rendered as usable and were not

- User approval: The product owner instructed that every Codex bug-detector
  finding be fixed where it is sound, and that unsound ones be answered and
  closed rather than acted on ("fix alle findings vom codex bug detector,
  sofern sie sinnvoll sind ... mach das so lang, bis der codex bug detector
  nichts mehr findet", 2026-08-31), then asked for the pull request to be marked
  ready for review, which is what produced these two findings. Both were judged
  sound: each contradicts a rule this repository already states, and neither
  changes a decision the owner has made.
- Approved customer-visible result:
  1. **The switch on a provider row stays usable while its check is running.**
     It was greyed out for the whole check, and the running check still shows
     its spinner either way. This matters because the step only continues once
     every enabled provider is ready: a check that is slow or stuck used to hold
     the customer on the provider step with the one control that would free them
     — switching that provider off — unavailable until the request timed out.
     `docs/control-center-ui-principles.md` rule 3 already required this.
  2. **Leaving a provider out of Automatic now sticks.** Unchecking
     `Include <provider> in Automatic` saved the smaller pool and was then
     immediately undone: the reconcile that repairs a half-finished enable could
     not tell an intentional exclusion from one, and put the provider straight
     back. The control now does what it says, and re-checking the provider hands
     it back to the reconcile. A provider missing from the pool for any other
     reason is still repaired exactly as before.
- Approved files: `apps/control-center/src/components/setup/setup-provider-row.tsx`,
  `apps/control-center/src/components/provider-picker.tsx`, their tests, and this
  approval record.

## 2026-08-31 — Four walls in the setup flow, and one correction

- User approval: The product owner instructed that every Codex bug-detector
  finding be fixed where it is sound and answered where it is not ("fix alle
  findings vom codex bug detector, sofern sie sinnvoll sind ... mach das so
  lang, bis der codex bug detector nichts mehr findet", 2026-08-31), then asked
  for the pull request to be marked ready for review, which produced these.
  Each of the four below was reproduced before being changed; a fifth was
  reproduced, found to be unreachable, and answered on its thread instead.
- Approved customer-visible result:
  1. **A VibeTV that is connected and waiting only for a provider now reaches
     the provider step.** A customer setting up for the first time has no
     provider signed in, so their VibeTV cannot draw usage and reports itself
     as not ready. The wizard treated that as no usable VibeTV and kept them on
     `Choose your VibeTV`, which has no control that can fix it. It does not
     open afterwards: a customer whose provider stops working later still gets
     the device step rather than being told, on the closing screen, that their
     VibeTV is running.
  2. **A firmware check that could not be made now says so.** The connect step
     logged `firmware is up to date` whenever the check itself failed, and
     carried on. It now stops with `Could not check VibeTV's firmware` and a
     `Try again`, the same shape as the other firmware refusals.
  3. **A search that failed now gives the reason and a way to retry.** Only
     "nothing found" had a dialog; a search that could not be made at all --
     Local Network access refused, the background service not answering, the
     40-second timeout -- showed `0 VibeTVs found on your WiFi.` and nothing
     else. It now opens `We couldn't search for your VibeTV` carrying the real
     reason and its next action.
  4. **The device step carries its own `Search again`.** Every way to rescan
     lived inside a dialog, and dismissing that dialog left the step with only
     the address field. The step now offers a quiet `Search again` beside
     `Enter IP address manually`, shown once a search has answered. This also
     covers the two states that had no dialog at all.
  5. **Correction to the entry above (2026-08-31, "Two controls that rendered
     as usable and were not").** That entry said leaving a provider out of
     Automatic "now sticks". It did not: the exclusion was remembered only for
     as long as the Settings screen stayed open, so reopening Settings or
     restarting the app put the provider back. It sticks now.
  6. **Running setup again no longer carries the old display choice into the
     new run.** It asks for that choice again, and keeping the previous one
     meant a provider switched on during the new run was missing from it, which
     the companion refuses -- on a step that offers no way to change it.
- Approved files: `apps/control-center/src/components/setup/setup-step.ts`,
  `setup-wizard.tsx`, `setup-device-screen.tsx`, `setup-firmware-dialogs.tsx`,
  `setup-preview-gallery.tsx`, their tests, `control-center-app.tsx`,
  `provider-picker.tsx` and its reconcile test, the companion's `server.go` and
  `provider_display_test.go`, and this approval record.

## 2026-08-31 — Three more setup gates, from the same instruction

- User approval: The same standing instruction as the two entries above — every
  Codex bug-detector finding fixed where sound, answered where not, repeated
  until nothing is found ("fix alle findings vom codex bug detector, sofern sie
  sinnvoll sind ... mach das so lang, bis der codex bug detector nichts mehr
  findet", 2026-08-31). All three were reproduced before being changed.
- Approved customer-visible result:
  1. **The device step stays on screen until the firmware work is finished.**
     Pairing publishes the VibeTV before the firmware check and install
     complete, so the wizard could move on while they were still running — and
     the firmware progress and its failure dialogs are part of that step. The
     customer now sees the check and the install through, and a failure appears
     where they are rather than on a screen they have left.
  2. **A display choice that no longer works asks again instead of being
     skipped.** Going back and switching off a provider that the saved choice
     names leaves that choice unusable; the wizard used to carry on to the theme
     step and then refuse to finish, with nothing on that step able to change
     it. It now returns to Display Mode.
  3. **A provider check that has gone stale is made again.** Staying on the
     provider step for more than five minutes let the check the companion holds
     expire while the app still believed it had asked; Continue was then refused
     and the row, which looked healthy, offered no `Check again`. The check now
     re-arms when the readiness it stood for expires. Nothing changes for a
     customer who moves through the step normally.
- Approved files: `apps/control-center/src/components/setup/setup-wizard.tsx`,
  `setup-step.ts`, `setup-providers-screen.tsx`, their tests, and
  `control-center-app.tsx`.

## 2026-08-31 — Two failed reads that passed for answers

- User approval: The same standing instruction as the three entries above —
  every Codex bug-detector finding fixed where sound, repeated until nothing is
  found ("fix alle findings vom codex bug detector, sofern sie sinnvoll sind ...
  mach das so lang, bis der codex bug detector nichts mehr findet",
  2026-08-31). Both were reproduced before being changed.
- Approved customer-visible result:
  1. **The display step is skipped only for a Mac App that cannot keep the
     choice.** Any failure to read the current choice used to skip it, so a
     customer could finish setup without ever being asked what VibeTV should
     show. A read that merely failed now keeps the step, and the failure is
     shown rather than silently deciding the question.
  2. **A provider list that could not be read says so, and offers `Try again`.**
     The step used to report that no providers matched the search — the same
     thing it says for a search with no hits — with Continue closed and no
     explanation, and nothing asked again on its own. The same dialog that
     carries the other provider-step failures now carries this one, with a
     retry.
- Approved files: `apps/control-center/src/components/setup/setup-step.ts`,
  `setup-wizard.tsx`, `setup-provider-dialogs.tsx`, their tests, and
  `control-center-app.tsx`.

## 2026-08-31 — The provider check now comes back on its own

- User approval: The same standing instruction as the entries above — every
  Codex bug-detector finding fixed where sound, repeated until nothing is found
  ("fix alle findings vom codex bug detector, sofern sie sinnvoll sind ... mach
  das so lang, bis der codex bug detector nichts mehr findet", 2026-08-31).
  This one is the follow-up Codex raised against the previous fix: the rule was
  made re-armable but nothing ever re-read it.
- Approved customer-visible result: **Nothing changes for a customer who moves
  through the provider step normally.** For one who stays on it for more than
  five minutes, the check the companion holds expires, and the step now makes it
  again by itself at that moment. Before, it did not: `Continue` was refused
  with no explanation on the step, and the row still looked healthy with no
  `Check again` to press, leaving switching the provider off and on as the only
  way through. There is no new copy and no new control — only a check that
  happens when it needs to.
- Approved files: `apps/control-center/src/components/control-center-app.tsx`,
  `setup/setup-providers-screen.tsx` and its test.

## 2026-08-31 — A display choice that did not save, and one that no longer exists

- User approval: The same standing instruction as the entries above — every
  Codex bug-detector finding fixed where sound, repeated until nothing is found
  ("fix alle findings vom codex bug detector, sofern sie sinnvoll sind ... mach
  das so lang, bis der codex bug detector nichts mehr findet", 2026-08-31).
  Both are follow-ups Codex raised against earlier commits on this branch.
- Approved customer-visible result:
  1. **The display step waits for its save.** Going back from the theme step to
     change what VibeTV shows, and having that save fail, used to return the
     customer to the theme step with nothing said — the old choice was quietly
     kept while they believed the new one had been saved. They now stay on
     Display Mode and see why it did not save.
  2. **Running setup again really does ask for the display choice again.** The
     previous choice was deleted on the Mac but still held on screen, so a slow
     or failed reload could skip the display step over a choice that no longer
     existed.
- Approved files: `apps/control-center/src/components/setup/setup-wizard.tsx`
  and its test, `control-center-app.tsx`, `provider-picker.tsx`.

## 2026-08-31 — Two fixes that had not taken effect

- User approval: The same standing instruction as the entries above ("fix alle
  findings vom codex bug detector, sofern sie sinnvoll sind ... mach das so lang,
  bis der codex bug detector nichts mehr findet", 2026-08-31). Both are the
  review catching earlier fixes on this branch that were written but never
  reached the customer.
- Approved customer-visible result:
  1. **A firmware check or install that fails keeps the customer on the device
     step**, where the dialog explaining it and offering the retry is. Until now
     the step was released the moment the sequence failed, so that dialog was
     removed from the screen as it appeared and setup carried on.
  2. **A display choice that could not be saved really does keep the customer on
     Display Mode.** The entry above claimed this; the call site discarded the
     result, so the behaviour had not changed.
- Not changed, deliberately: a theme install that fails still reports itself in
  the step's own log with `Install` returning, rather than in a dialog. A dialog
  was written for it and reverted — its scrim covers the `Install` button, which
  is the retry the approved flow depends on
  (`test-customer-flows.mjs`, "The failed install has nowhere to go but the
  step's own log, so that is where the customer has to be told, and Install has
  to come back").
- Approved files: `apps/control-center/src/components/setup/setup-wizard.tsx`
  and its test, `control-center-app.tsx`.

## 2026-08-31 — The firmware failure holds, and "Update" updates

- User approval: The same standing instruction as the entries above ("fix alle
  findings vom codex bug detector, sofern sie sinnvoll sind ... mach das so lang,
  bis der codex bug detector nichts mehr findet", 2026-08-31). The first is the
  review catching the previous pin, which released on dismissal.
- Approved customer-visible result:
  1. **Closing a firmware failure dialog no longer carries the customer past
     it.** They stay on the device step, where the check and the retry are; the
     step's own controls — Connect, `Search again`, the address field — remain
     usable, so this holds them at the problem without trapping them.
  2. **`Update` on "Your Mac App is out of date" now opens the Mac App update.**
     It used to run the connect sequence again and meet the same refusal, and
     the usual update prompt does not reach someone still inside setup.
- Approved files: `apps/control-center/src/components/setup/setup-wizard.tsx`
  and its test, `control-center-app.tsx`.

## 2026-08-31 — Waiting for the save, and asking again after a sign-in

- User approval: The same standing instruction as the entries above ("fix alle
  findings vom codex bug detector, sofern sie sinnvoll sind ... mach das so lang,
  bis der codex bug detector nichts mehr findet", 2026-08-31).
- Approved customer-visible result:
  1. **The display step waits for its save before handing over the theme step.**
     The choice is shown as saved straight away so it does not flicker, and the
     wizard used to move on for that — a customer could be picking or installing
     a theme while the save was still in flight, and be pulled back if it failed.
  2. **Coming back from a provider sign-in checks the provider again.** The
     waiting state simply ran out, and the Mac still held the failed check that
     had sent them to sign in, so Continue stayed closed on an answer that was no
     longer true. The check is now made at the end of that wait.
- Approved files: `apps/control-center/src/components/setup/setup-step.ts`,
  `setup-providers-screen.tsx`, their tests, and `control-center-app.tsx`.

## 2026-08-31 — The provider step waits for the companion too

- User approval: The same standing instruction as the entries above ("fix alle
  findings vom codex bug detector, sofern sie sinnvoll sind ... mach das so lang,
  bis der codex bug detector nichts mehr findet", 2026-08-31).
- Approved customer-visible result: **A `Continue` the companion refuses keeps
  the customer on the provider step, where the reason is shown.** This already
  held for a first run; going back from the theme step and pressing Continue
  again used to move them on regardless, and the step they landed on has nowhere
  to report it.
- Also recorded: a second finding from the same review — that enabling a
  provider can start one probe more than necessary, because the client asks for
  a check the companion may already be running — is **not** changed here. It
  costs a duplicate probe rather than misleading the customer, and the remedy
  touches which side owns provider verification, so it deserves its own change
  with evidence rather than an edit at the end of a long chain. The thread is
  left open.
- Approved files: `apps/control-center/src/components/setup/setup-wizard.tsx`
  and its test, `control-center-app.tsx`.

## 2026-08-31 — A stale device choice, and a rerun that skipped its last step

- User approval: The same standing instruction as the entries above ("fix alle
  findings vom codex bug detector, sofern sie sinnvoll sind ... mach das so lang,
  bis der codex bug detector nichts mehr findet", 2026-08-31).
- Approved customer-visible result:
  1. **A VibeTV that a new scan no longer finds stops being the selected one.**
     Picking one, scanning again, and having it be gone left `Connect` live with
     nothing drawn as selected, and pressing it did nothing. The step now falls
     back to the known VibeTV or the first result, as it does before anything is
     picked, and offers `Connect` only when there is something to connect to.
  2. **Run setup again shows the closing screen.** A rerun in the same session
     went straight back to Control Center when it reached the final step,
     because the app still remembered the first run handing the screen over.
- Approved files: `apps/control-center/src/components/setup/setup-wizard.tsx`
  and its test, `control-center-app.tsx`.
