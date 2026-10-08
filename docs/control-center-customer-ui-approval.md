# Control Center Customer UI Approvals

This append-only log is the machine-checked approval marker for customer-facing
Control Center changes. Every visible UI change needs a new entry that records
the user's explicit approval and the exact visible result. Technical work,
issue scope, or release permission never implies UI permission.

## 2026-09-01 — Configured WiFi device continues automatically

- User approval: The user explicitly instructed Codex to fix every sensible
  Codex Bug Detector finding that matches the approved setup design and flow,
  push it, and repeat the review loop until clean.
- Approved customer-visible result: After WiFi credentials are sent through
  Cable, the waiting step automatically connects the same `deviceId` when it
  appears on WiFi, even if another VibeTV is also visible. The phone path has no
  known identity and therefore still connects one result directly or shows the
  existing list for multiple results. No new control or visual treatment.
- Approved files: `setup-wizard.tsx`, its identity regression test, and this
  approval record.

## 2026-09-01 — Direct setup retry remains automatic

- User approval: The user explicitly instructed Codex to fix every sensible
  Codex Bug Detector finding that matches the approved setup design and flow,
  push it, and repeat the review loop until clean.
- Approved customer-visible result: If the automatic connection to the only
  discovered VibeTV fails, `Search again` may return that same VibeTV and the
  app automatically retries it instead of showing an idle automatic-connection
  screen. Connection-mode requests also keep waiting for the Companion's
  supported transition window. No control, layout, or visual treatment changes.
- Approved files: `setup-wizard.tsx`, its regression test,
  `control-center-app.tsx`, the customer-flow timeout contract, and this
  approval record.

## 2026-09-01 — Cable and WiFi setup follows reachable devices

- User approval: The user explicitly supplied the six-case Cable/WiFi discovery
  matrix for PR #407, required the connection choice only when both methods are
  factually available, required multiple Cable devices to use the existing
  device-list semantics, and required the labels `Cable` and `WiFi` without a
  `Recommended` badge.
- Approved customer-visible result: One reachable device connects directly;
  multiple devices of the same transport show a device list; the Cable/WiFi
  chooser appears only when both methods are currently available. With no
  device, setup offers Cable and the existing phone-based WiFi path. WiFi
  credentials are entered in the app only while a Cable device is connected,
  and visible WiFi networks can be scanned, selected, rescanned, or entered
  manually. Device rows show the VibeTV name, firmware, and previous-connection
  hint without a serial-port path.
- Approved files: Existing setup components and tests, the setup connection
  decision helper, Companion discovery/setup endpoints and tests, firmware WiFi
  scan support and tests, the serial protocol, and this approval record.

## 2026-08-31 — Unsupported Cable controls never stay on Loading

- User approval: The user instructed Codex to keep reviewing PR #407, fix every
  sensible Codex review finding, push the fixes, and repeat the review loop
  without asking again. Codex reported the exact current finding before the
  fix: a Cable device without brightness or standby controls must not leave
  Settings in a permanent loading state.
- Approved customer-visible result: On a Cable VibeTV that explicitly reports
  no brightness support, the existing Brightness row reads `Not supported`
  instead of `Loading` and remains disabled. Supported VibeTVs keep the existing
  percentage, slider, save action, layout, and connection-mode controls.
- Approved files: `settings-screen.tsx`, its component regression test, and this
  approval record.

## 2026-08-28 — Native Cable restart completes after Helper startup

- User approval: The user granted all remaining implementation and hardware-test
  approvals for this chat and instructed Codex to continue without asking again.
  During the authorized saved-Cable restart rehearsal, Codex reported before
  implementation that the native app stayed on the old WiFi setup fallback after
  its Helper and Cable device were already ready.
- Approved customer-visible result: When the native app restarts with Cable
  already selected, its bounded incomplete-setup poll continues while the Helper
  finishes starting, including while the WebView is temporarily backgrounded.
  The existing Cable connecting state advances to the connected Control Center;
  it neither starts WiFi discovery nor remains on stale WiFi setup copy.
- Approved files: `control-center-app.tsx`, the matching native saved-Cable
  regression in `test-customer-flows.mjs`, and this approval record.

## 2026-08-28 — Saved Cable mode never falls into WiFi recovery

- User approval: The user granted all remaining implementation and hardware-test
  approvals for this chat and instructed Codex to continue without asking again.
  During the authorized real-hardware restart, the app incorrectly replaced the
  saved Cable connection with `Searching your WiFi`; Codex reported the exact
  visible defect before correcting it.
- Approved customer-visible result: A saved Cable connection stays on the
  existing Cable connecting state while the Helper or first live frame is still
  starting. Neither normal startup nor confirmed-loss recovery starts WiFi
  discovery, shows `Looking for your VibeTV`, or tells the customer to configure
  WiFi. Explicitly selecting WiFi in Settings remains available and unchanged.
- Approved files: `control-center-app.tsx`, the matching saved-Cable regression
  in `test-customer-flows.mjs`, and this approval record.

## 2026-08-28 — Cable first-frame wait never starts WiFi search

- User approval: The user explicitly granted all approvals, including corrected
  hardware retests, for the remaining work in this chat and instructed Codex to
  continue without asking again. In
  the authorized cold-start hardware rehearsal, Codex identified and stated the
  exact visible correction before implementing it: after `Use Cable`, the
  existing first-preview wait must not be replaced by a WiFi search screen.
- Approved customer-visible result: Throughout the complete first-frame wait
  after `Use Cable`, an active VibeTV remains on the existing `Connecting to VibeTV`
  state with `Waiting for live preview…`. The app does not show `Looking for
  your VibeTV`, claim that it is searching WiFi, or start a WiFi discovery while
  that Cable device is already bound. Overview still opens only after the first
  real preview frame.
- Approved files: `control-center-app.tsx`, the matching regression in
  `test-customer-flows.mjs`, and this approval record.

## 2026-08-28 — Connection mode belongs in Settings

- User approval: The user explicitly required the Cable connection banner and
  its `Change connection` button to be removed from Overview, required the
  Cable/WiFi switch to live in Settings, required it to reuse the existing
  Settings elements and structure without inventing a new UI, and instructed
  Codex to implement that exact result.
- Approved customer-visible result: Overview contains no separate Cable banner
  or connection-change button. Settings contains one flat `Connection` section
  in the existing two-column Settings layout, with the existing labeled Select
  pattern showing `Cable` or `WiFi`. Cable keeps Usage, Settings, Appearance,
  Updates, and Support available. During first Cable setup, the existing
  full-screen `Connecting to VibeTV` state remains until the first real preview
  frame; only then does the connected Control Center appear.
- Approved files: `control-center-app.tsx`, `overview-screen.tsx`,
  `settings-screen.tsx`, their component tests, the matching regression in
  `test-customer-flows.mjs`, and this approval record.

## 2026-08-27 — Neutral Cable and WiFi choice cards

- User approval: The user reviewed the rendered connection chooser, required
  both options to use the same neutral card treatment, required only Cable to
  carry a `Recommended` badge, rejected a full primary-color Cable card, and
  then explicitly approved the resulting design with "jo so gebe ich es frei".
- Approved customer-visible result: When both connection methods are supported,
  Cable and WiFi appear as equal neutral cards side by side with large icons;
  Cable alone carries the `Recommended` badge. When the connected VibeTV
  advertises only Cable support, the same approved Cable card is shown alone and
  the unavailable WiFi action stays hidden, including immediately after
  `Run setup again`.
- Approved files: `control-center-app.tsx`, the matching regression in
  `test-customer-flows.mjs`, and this approval record.

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

## 2026-08-31 — A refusal the provider step could not act on

- User approval: The same standing instruction as the entries above ("fix alle
  findings vom codex bug detector, sofern sie sinnvoll sind ... mach das so lang,
  bis der codex bug detector nichts mehr findet", 2026-08-31).
- Approved customer-visible result: **Turning off the provider that "Always
  show" names now takes the customer to the display step, where the choice can
  be changed.** Coming back from a later step to the provider list and turning
  that provider off makes the companion refuse the completion — and the refusal
  asks for a provider to display, which the provider screen has no control for.
  The Back override held the customer on that screen with a next action that was
  not on it, and re-enabling the provider they had just turned off was the only
  way out.
- Approved files: `apps/control-center/src/components/setup/setup-step.ts` and
  its test, `setup-wizard.tsx`, `control-center-app.tsx`.

## 2026-08-31 — "Always show one" no longer demands the other providers be off

- User approval: The same standing instruction as the entries above ("fix alle
  findings vom codex bug detector, sofern sie sinnvoll sind ... mach das so lang,
  bis der codex bug detector nichts mehr findet", 2026-08-31).
- Approved customer-visible result: **A customer who picks "Always show one" can
  keep their other providers on.** Coming back to the provider list and pressing
  Continue used to be refused with "Every enabled provider must be included for
  display", and the only one of the three offered actions that exists on that
  screen is turning the other providers off — the opposite of what the customer
  had just chosen. Only the Automatic pool is the set VibeTV rotates through and
  therefore has to name every enabled provider; "Always show one" names one by
  definition, which is what the screen says and what Settings writes and keeps.
- Approved files: `companion/internal/companionapi/provider_display.go` and its
  test.

## 2026-08-31 — The Automatic pool comes back, and Continue waits for the check

- User approval: The same standing instruction as the entries above ("fix alle
  findings vom codex bug detector, sofern sie sinnvoll sind ... mach das so lang,
  bis der codex bug detector nichts mehr findet", 2026-08-31).
- Approved customer-visible result:
  1. **Leaving "Always show one" restores the Automatic rotation the customer
     had.** This was approved on 2026-08-03 ("Returning to `Automatic` restores
     the saved automatic selection") and the picker remembered that pool but
     never used it: switching back wrote the pinned provider alone, and every
     other provider silently left the rotation. A provider switched off in the
     meantime is left out, because a selection naming it is refused.
  2. **`Continue` on the provider step waits for a check that is still
     running.** A provider reports its own health before the exact check the
     companion asks for has answered, so a row could read healthy while that
     check was still queued — and `Continue` was open on a gate that refuses it.
     Every row keeps its on/off switch throughout, as rule 3 requires.
- Approved files: `apps/control-center/src/components/provider-picker.tsx`,
  `setup/setup-providers-screen.tsx`, `setup/setup-wizard.tsx`,
  `control-center-app.tsx`, `setup/setup-preview-gallery.tsx`, and their tests.

## 2026-08-31 — No control stays live while the write it started is running

- User approval: The same standing instruction as the entries above ("fix alle
  findings vom codex bug detector, sofern sie sinnvoll sind ... mach das so lang,
  bis der codex bug detector nichts mehr findet", 2026-08-31).
- Approved customer-visible result: three controls that answered while the write
  they belong to was still on its way.
  1. **The display step takes nothing more while it is saving.** `Continue`, the
     two mode cards and the provider rows are closed for the length of the
     write. A second `Continue`, or a changed choice, raced the first write: the
     first answer released the step, and what VibeTV kept was whichever landed
     last rather than what the customer had chosen.
  2. **A provider row says a check is running instead of offering to start
     another.** Repeated presses queued more probes of the same provider,
     repeating the sign-in work behind them, and the first answer reopened
     `Continue` while the rest were still on their way. The row keeps its on/off
     switch throughout, as rule 3 requires.
  3. **Theme cards are not selectable while a theme is installing.** `Install`
     is already closed then, so a new pick had nothing to act on: the running
     install still activated the theme it started with, and its status poll put
     that one back as selected. The card answered and then changed its mind.
- Approved files: `apps/control-center/src/components/setup/`
  `setup-display-mode-screen.tsx`, `setup-provider-row.tsx`,
  `setup-providers-screen.tsx`, `setup-theme-screen.tsx`, `setup-wizard.tsx`,
  and their tests.

## 2026-08-31 — A check that never reached the Mac App, and an enable kept out of the pool

- User approval: The same standing instruction as the entries above ("fix alle
  findings vom codex bug detector, sofern sie sinnvoll sind ... mach das so lang,
  bis der codex bug detector nichts mehr findet", 2026-08-31).
- Approved customer-visible result:
  1. **A provider check that could not be made can be made again.** The step
     remembers having asked so it does not ask against an answer the Mac App
     already holds — but it remembered a request that never arrived, so for five
     minutes nothing asked again: the row read healthy with nothing on it to
     press, `Try again` in the dialog only re-read, and `Continue` was refused
     the whole time. `Try again` now reaches the check.
  2. **A provider switched on under "Always show one" is not added to the
     Automatic pool behind the customer's back.** Switching back to Automatic
     restores the saved pool, and a provider deliberately kept out of it used to
     be put back in by the repair that exists for a different case — finishing
     an Automatic enable, which is the only one that writes to the pool at all.
- Approved files: `apps/control-center/src/components/control-center-app.tsx`,
  `provider-picker.tsx`, and its test.

## 2026-08-31 — The switch stays open in Settings too, and Automatic still rotates

- User approval: The same standing instruction as the entries above ("fix alle
  findings vom codex bug detector, sofern sie sinnvoll sind ... mach das so lang,
  bis der codex bug detector nichts mehr findet", 2026-08-31).
- Approved customer-visible result:
  1. **A provider VibeTV is showing can be switched off in Settings.** The row
     locked its switch while the provider was in the display selection and told
     the customer to remove it from that selection first — which, for anyone
     with one provider, is impossible: the last Include cannot be unchecked
     either. This is the same rule whose companion-side twin was removed earlier
     in this branch as a rule 3 violation; a selection left naming a provider
     that was turned off reports that itself.
  2. **Automatic still rotates after leaving Settings and coming back.** The
     pool the customer had is remembered for the visit only, so a return to
     Automatic in a later visit had nothing to restore and wrote the pinned
     provider alone — an Automatic that rotates through one thing. It now falls
     back to every provider that is on, which is what Automatic means and what a
     fresh save writes.
- Approved files: `apps/control-center/src/components/provider-picker.tsx` and
  its tests.

## 2026-09-01 — Two controls left open by the unlock

- User approval: The same standing instruction as the entries above ("fix alle
  findings vom codex bug detector, sofern sie sinnvoll sind ... mach das so lang,
  bis der codex bug detector nichts mehr findet", 2026-08-31).
- Approved customer-visible result:
  1. **A provider's switch on the setup step closes while its own write is
     running.** The switch shows the new value the moment it is pressed, so a
     second press before the first write answered started a race, and both the
     row and what was saved ended on whichever answer landed last rather than on
     the customer's last press. Settings already closed its switch this way.
  2. **A provider switched off inside Automatic can still be taken out of the
     pool.** The selection then names a provider that is off, which is refused,
     and the `Include` control was locked for exactly that provider — so
     switching it back on was the only way to mend the choice. Putting a
     provider that is off *into* the pool stays impossible.
- Approved files: `apps/control-center/src/components/provider-picker.tsx`,
  `setup/setup-provider-row.tsx`, `setup/setup-providers-screen.tsx`,
  `setup/setup-wizard.tsx`, `setup/setup-preview-gallery.tsx`,
  `control-center-app.tsx`, and their tests.

## 2026-09-01 — Existing customers keep Overview, and three controls mean what they say

- User approval: The same standing instruction as the entries above ("fix alle
  findings vom codex bug detector, sofern sie sinnvoll sind ... mach das so lang,
  bis der codex bug detector nichts mehr findet", 2026-08-31).
- Approved customer-visible result:
  1. **A VibeTV that was already set up opens Overview after this update.** It
     has no display choice stored and never had a step that could store one, so
     the wizard would have taken the screen from every existing customer to ask
     for one — the extra confirmation rule 4 forbids. The rotation it already
     has is what choosing Automatic would write. A setup that is actually being
     run is still asked.
  2. **A refusal about the Automatic pool takes the customer to the display
     step.** Switching a second provider on after Automatic was saved is refused
     on the provider screen, which has no Include control: of the three actions
     offered, only turning that provider back off exists there, and it undoes
     what the customer had just done.
  3. **The uncheck that takes a provider out of Automatic actually writes.** The
     control was unlocked for a provider that had been switched off, but the
     handler still refused to act on it, so the one control that mends the
     selection did nothing.
  4. **A broken usage service opens the repair, not the provider's app.** The
     companion says which of the two failures it is, and both were sent to the
     provider app — where the customer meets the same broken service again.
- Approved files: `apps/control-center/src/components/provider-picker.tsx`,
  `setup/setup-step.ts`, `setup/setup-wizard.tsx`, `control-center-app.tsx`,
  their tests, and `companion/internal/companionapi/provider_display.go`,
  `companion/internal/runtimeconfig/runtimeconfig.go` with their tests.

## 2026-09-01 — A search that was never finished is not a finished setup

- User approval: The same standing instruction as the entries above ("fix alle
  findings vom codex bug detector, sofern sie sinnvoll sind ... mach das so lang,
  bis der codex bug detector nichts mehr findet", 2026-08-31).
- Approved customer-visible result: **A customer who searched for a VibeTV once
  and stopped there is still asked for everything.** Searching writes the
  address it found before anything is paired, and that alone was read as an
  install from before the completion flag existed — so on the next launch the
  wizard carried them past choosing providers and the display mode, or, with no
  provider able to show usage yet, held them on the VibeTV step with nothing
  left that could ask for one. Proof of pairing is now the device id, or the
  address together with the token pairing writes.
- Approved files: `companion/internal/runtimeconfig/runtimeconfig.go` and its
  test.

## 2026-09-01 — A broken usage service can be repaired inside setup

- User approval: The same standing instruction as the entries above ("fix alle
  findings vom codex bug detector, sofern sie sinnvoll sind ... mach das so lang,
  bis der codex bug detector nichts mehr findet", 2026-08-31).
- Approved customer-visible result:
  1. **A provider whose usage service is broken offers `Repair the usage
     service` on the provider step.** It used to say `Check timed out` and offer
     another check, which meets the same broken service — so a customer whose
     only provider was in that state could not finish setup at all: `Continue`
     asks for a provider that is ready, and switching it off leaves none. The
     row keeps its on/off switch, as rule 3 requires.
  2. **Leaving `Enter IP address` cancels what it started.** The lookup can take
     a while, and its result went on to connect and pair the VibeTV — and could
     begin a firmware install — after the customer had pressed `Cancel`.
- Approved files: `apps/control-center/src/components/setup/`
  `setup-provider-row.tsx`, `setup-wizard.tsx`, `control-center-app.tsx`, and
  their tests.

## 2026-09-01 — A dimmed provider row can still be checked

- User approval: The same standing instruction as the entries above ("fix alle
  findings vom codex bug detector, sofern sie sinnvoll sind ... mach das so lang,
  bis der codex bug detector nichts mehr findet", 2026-08-31).
- Approved customer-visible result: **`No usage data on this account` and
  `Service outage — try again later` now offer `Check again`.** Both rows were
  inert. The account can gain usage — the guidance for it is to use the provider
  once and check again — and an outage ends, which is the whole point of "try
  again later"; neither had anything to try it with. A customer whose only
  provider said either had no way on at all: `Continue` asks for a provider that
  is ready, and switching it off leaves none. The rows stay dimmed, because
  right now they cannot be used, and they say a check is running rather than
  offering a second one.
- Approved files: `apps/control-center/src/components/setup/setup-provider-row.tsx`
  and its test.

## 2026-09-01 — The VibeTV that failed is still the one Connect offers

- User approval: The same standing instruction as the entries above ("fix alle
  findings vom codex bug detector, sofern sie sinnvoll sind ... mach das so lang,
  bis der codex bug detector nichts mehr findet", 2026-08-31).
- Approved customer-visible result: **After closing a firmware dialog without
  using it, `Connect` runs the same attempt again.** Connecting empties the list
  of VibeTVs found on the WiFi, so the step — deliberately held for that failure
  — showed an empty list and a closed `Connect`, and a full rescan was the only
  way back to the retry the dialog had just offered.
- Approved files: `apps/control-center/src/components/setup/setup-wizard.tsx`
  and its test.

## 2026-09-01 — One recovery at a time, and a display choice that is on offer

- User approval: The same standing instruction as the entries above ("fix alle
  findings vom codex bug detector, sofern sie sinnvoll sind ... mach das so lang,
  bis der codex bug detector nichts mehr findet", 2026-08-31).
- Approved customer-visible result:
  1. **Every recovery on a provider row says it is running.** The wait replaced
     the sign-in action but left `Allow access in macOS` and `Repair the usage
     service` live, so each press started the recovery again and queued another
     check behind it. Those rows now read `Waiting for access…` and
     `Repairing…` while their attempt runs, beside the existing
     `Waiting for sign-in…`, and keep their on/off switch.
  2. **`Continue` on the display step waits for a provider that is on the
     list.** A saved `Always show one` whose provider has since been switched
     off is exactly what sends the customer back to this step, and it arrived
     naming a provider the list no longer has: nothing drawn as chosen, and a
     `Continue` that resubmitted the same refused provider.
- Approved files: `apps/control-center/src/components/setup/`
  `setup-provider-row.tsx`, `setup-providers-screen.tsx`,
  `setup-display-mode-screen.tsx`, and their tests.

## 2026-09-01 — Switching a provider off calls off its recovery, and Continue waits

- User approval: The same standing instruction as the entries above ("fix alle
  findings vom codex bug detector, sofern sie sinnvoll sind ... mach das so lang,
  bis der codex bug detector nichts mehr findet", 2026-08-31).
- Approved customer-visible result:
  1. **Switching a provider off ends the recovery it was waiting for.** The wait
     after a sign-in, a macOS permission or a repair finishes with a real
     provider check, and that still ran 45 seconds later against a provider the
     customer had switched off in the meantime — work they had just said they
     did not want. The switch stays theirs to press at any time.
  2. **`Continue` on the provider step waits for the completion it asked for.**
     A second press started a second one, each forcing a live provider read
     before writing anything, so the customer paid for the same slow check twice
     and either answer could move the step or raise a refusal on its own.
- Approved files: `apps/control-center/src/components/setup/`
  `setup-providers-screen.tsx`, `setup-wizard.tsx`, and their tests.

## 2026-09-01 — Back during a display save is kept

- User approval: The same standing instruction as the entries above ("fix alle
  findings vom codex bug detector, sofern sie sinnvoll sind ... mach das so lang,
  bis der codex bug detector nichts mehr findet", 2026-08-31).
- Approved customer-visible result: **Pressing `Back` while the display choice
  is being saved keeps the customer where they went.** The save landing used to
  carry them forward from the step they had just gone back to. `Back` stays
  available throughout, rather than being taken away for the length of a write.
- Approved files: `apps/control-center/src/components/setup/setup-wizard.tsx`
  and its test.

## 2026-09-01 — The welcome screen is what the customer meets, and Settings offers the wizard's own controls

- User approval: While testing the PR #331 candidate the user reported eight
  findings and, on the first, instructed: "doch, dieser pr kann und wird das
  lösen. änder das, die screens fliegen raus, bis sie exakt so aussehen wie im
  design". On the third: "änder das so, dass der wlan scan auf dem welcome
  screen läuft, so wie es ja auch im design ist". On the fourth ("dann mach
  das"), on the second ("fix das"), and on the log ordering: "alles ausgrauen,
  außer immer den letzten ... es geht um die reihenfolge in der das gestartet
  wird". Separately: "bau den settings tab um, der hat noch scheiß design. das
  muss so aussehen wie hier", naming the `Settings Tab Redesign` board.
- Approved customer-visible result:
  1. **The first screen at launch is the welcome step.** The native window and
     the WebView now draw the same brand and the same running log on the same
     background, so the handover between them is invisible. Two loading screens
     titled `Starting Control Center` are gone.
  2. **The WiFi search runs on the welcome step.** The customer leaves it when
     there is a VibeTV to choose, not when the first background-service check
     answers. `Enter IP address manually` is offered there throughout — a
     deliberate departure from the board, which gives the step no controls, so
     that a customer who already knows the address is not made to sit out a
     40-second scan (the capability the 2026-07-22 entry required).
  3. **The setup log reads as an order of events.** Every line above the newest
     is dimmed; the newest carries the caret.
  4. **The chosen VibeTV stays on screen while it is being set up.** Pairing no
     longer empties the discovered list, so the card keeps its selection and the
     count can no longer read `0 VibeTVs found on your WiFi.` while a VibeTV is
     connected. The button names the phase it is in — `Checking firmware`,
     `Updating firmware` — instead of `Connecting` throughout.
  5. **`Ask AI to fix` asks for a fix.** It names the repository, the file that
     draws the failing screen, the Mac App version separately from the
     background service version, the error the app is holding, every provider
     state, and the log the screen is actually showing.
  6. **Settings offers the same controls as the wizard.** `Display mode` is its
     own section with the two preview cards, and the AI provider rows are the
     wizard's rows. Removed with it: the per-provider `Include in Automatic`
     checkbox, the health badges, the `Show all providers` collapse, and the
     `Always show one` wording — Settings and the wizard now say `Manual`.
     Enabling or disabling a provider under Automatic writes the whole enabled
     set, which is what the checkbox and its repair effect did between them.
     Rows keep their switch whatever the provider reports, per rule 3, which the
     board's no-control row would have reversed. `Screensaver` and `Setup` keep
     their sections; the board does not draw them and their controls exist
     nowhere else.
  7. **The brightness reading sits beside its label** in a mono face instead of
     riding the slider thumb.
- Approved files: `apps/control-center/src/components/` `settings-screen.tsx`,
  `provider-picker.tsx`, `control-center-app.tsx`, `setup/` and their tests;
  `macos/VibeTVControlCenter/main.swift`.

## 2026-09-01 — One working AI provider finishes setup

- User approval: While testing the PR #331 candidate the user reported being
  stuck on the provider step and instructed: "8 das ist quatsch, der muss
  funktionieren, sobald ein ai provider ausgewählt ist und funktioniert".
- Approved customer-visible result: **`Continue` on the provider step opens as
  soon as one switched-on provider has passed its check.** It used to demand
  every switched-on provider, and CodexBar switches providers on by itself — so
  a single one merely not signed in closed the only step that offers no `Back`
  and no `Skip`, on a Mac whose own provider was working. What VibeTV shows is
  unaffected: the rotation already skips a provider it cannot read. The
  companion's completion applies the same sentence, so the button cannot open
  on a gate that would refuse it. Without any ready provider it stays closed —
  there would be nothing real to put on the screen.
- Approved files: `apps/control-center/src/components/setup/setup-providers-screen.tsx`,
  `companion/internal/companionapi/provider_display.go`, and their tests.

## 2026-09-01 — The sign-in control leads somewhere

- User approval: The user reported that pressing sign-in did nothing and stated
  the intent: "die idee von der funktionalität war, dass wir den kunden bspw.
  direkt zu codex bzw. openai oder auf www.claude.ai/login oder wo auch immer hin
  schicken … wenn das bedeutet, dass wir für alle provider speichern müssen, wo
  sich der kunde einloggt, dann so be it." On the proposal below: "finde ich gut
  … wir zeigen codexbar", and after the release check, "ja mach".
- Approved customer-visible result:
  1. **The sign-in control opens where the customer actually signs in.** It used
     to activate a menu-bar app with no window, so nothing happened, ever. A
     provider read from a browser session opens that provider's own page; one
     whose credential is written by its own CLI hands over the command to copy,
     because a browser login would put nothing where the usage service looks.
  2. **A blocked cookie read goes to the macOS setting, not to a login page.**
     On a Mac where the usage service cannot read Safari's cookie file, the
     customer is already signed in and only Full Disk Access is missing. This is
     checked before the sign-in branch.
  3. **The row says what the usage service said**, redacted. Its sentence is the
     only per-provider guidance that exists, and it is often the better one:
     "Please sign in at https://ollama.com/signin in your browser."
  4. **Two of its sentences are never shown.** "Please log in via the CodexBar
     menu" (Cursor, Augment) names a product the app does not mention and points
     away from what works — both are read from browser cookies. "No available
     fetch strategy for <id>." is its answer for 34 of 65 providers and reads as
     a dead end where a working sign-in exists.
  5. **A provider we have no destination for offers another check** rather than
     a control that leads nowhere.
- Deliberate departure, recorded rather than smuggled: the destination table is
  the Mac App holding provider knowledge, which the AGENTS.md CodexBar boundary
  otherwise reserves for the engine. It was checked against the pinned 0.46.0
  and against the current 0.56.2: neither publishes a sign-in destination in any
  field, both still carry the two wrong sentences, and five of their messages
  embed the account's home directory. Forwarding alone cannot do the job.
- Approved files: `apps/control-center/src/components/setup/`
  `provider-sign-in.ts`, `setup-provider-row.tsx`, `setup-providers-screen.tsx`;
  `apps/control-center/src/components/control-center-runtime.ts`;
  `companion/internal/codexbar/providers.go`;
  `companion/internal/companionapi/` `provider_reported.go`, `preferences.go`;
  `macos/VibeTVControlCenter/main.swift`; and their tests.

## 2026-09-01 — Nothing switches a provider on but the customer, and the usage read no longer waits for a VibeTV

- User approval: On the provider list filling itself in, the user chose option C
  from three offered ("7c finde ich am elegantesten") after being told what it
  costs. On starting the read earlier: "ja aber der state ist ja scheiße so. 🙂
  meine frage war ja, ob wir den scheiss scan nicht schon auf dem welcome screen
  starten sollten zb". Confirmed with "mach".
- Approved customer-visible result:
  1. **No provider switches itself on any more.** The first run used to ask the
     usage service for every provider it could reach and then switch each one on
     with a separate write. That is what the customer watched: minutes of
     silence, then providers appearing and toggling themselves on under their
     hands, with `Continue` closing again on each one. The list now shows what
     the usage service already has switched on — on a fresh Mac that is Codex —
     and every other switch is the customer's to press.
  2. **The read starts when the Mac starts, not when the VibeTV is connected.**
     Reading this Mac's AI usage has nothing to do with pairing, and waiting for
     it meant the first read began the moment the customer pressed `Connect` —
     three silent minutes on a screen whose log had already finished. Nothing
     reaches a device that is not there: the cycle that sends a frame resolves
     the device itself and returns without one.
- Honest cost, named rather than discovered later: on a Mac whose customer uses
  Claude or Cursor but not Codex, the provider list now opens with one
  pre-armed switch that is not theirs. Search reaches any provider, and the list
  shows ten at a time.
- Approved files: `companion/internal/codexbar/` `codexbar.go`,
  `provider_setup.go`; `companion/internal/companionapi/provider_setup.go`;
  `companion/internal/daemon/` `collector.go`, `daemon.go`; and their tests.
  Net on the Go side: 737 lines deleted, 107 added.

## 2026-09-01 — A search the background service did not survive is not an answer

- User approval: After installing the preview the user reported the wizard had
  handed them "0 VibeTVs found on your WiFi." with a dead Connect on a fresh
  Mac ("ein satz mit x!", with the screens), then approved the fix: "jo mach".
- Approved customer-visible result: **The customer stays on the welcome step
  until there is a VibeTV to choose, including while the background service is
  still starting.** On a fresh Mac that service restarts several times as it
  installs its usage engine — three times in the first minute, measured — and a
  search running into one of those gaps came back empty. That empty result was
  shown as a count, with a Connect the service could not serve behind it: the
  customer pressed it and got "Mac App did not answer", a failed firmware check
  and a repair dialog, one after the other. A search the service did not survive
  is now discarded and run again once it is back. A service that is genuinely
  gone is not hidden: its recovery dialog is drawn over the welcome step.
- Approved files: `apps/control-center/src/components/control-center-app.tsx`,
  `apps/control-center/src/components/setup/setup-step.test.ts`,
  `apps/control-center/scripts/test-customer-flows.mjs`.

## 2026-09-01 — Never two dialogs on top of each other

- User approval: While testing preview 99.0.911 the user reported being stuck
  after pressing Connect: "jetzt bin ich hier stuck, 2 pop ups übereinander,
  chaos", with the screen showing "Could not check VibeTV's firmware" lying over
  "Finish AI setup on this Mac".
- Approved customer-visible result: **Setup shows one dialog at a time.** Every
  one of them is centred, so a second lands on the first and the lower one's
  buttons cannot be reached — the customer could answer neither. The dialog
  about what they just did wins; the ambient usage-service incident stands down
  while a step has a failure of its own and is raised again the moment that one
  is answered. It is no longer drawn from outside the wizard at all: the step
  decides, because only the step knows whether it already has something to say.
- Approved files: `apps/control-center/src/components/setup/setup-wizard.tsx`,
  `apps/control-center/src/components/control-center-app.tsx`, and their tests.

## 2026-09-01 — The app stops taking its own background service down

- User approval: The user asked why the background service restarts at all and
  proposed repairing it quietly instead ("wieso startet der verfickte dienst
  überhaupt neu", "sollten wir ihn einfach im hintergrund repairen"), then
  approved the fix and the removal of what it made redundant: "mach und wirf
  auch überschüssigen code den du in diesem zuge vorher eingebaut hast, wieder
  weg".
- Approved customer-visible result: **A Mac sitting on the provider step no
  longer tears its own background service down, and a service that stops
  answering is given the time to come back before anything is said about it.**
  A VibeTV reporting `provider_setup_required` means nobody has switched a
  provider on yet — the ordinary state of this wizard now that the first run no
  longer switches providers on by itself. It was being read as a broken usage
  service, which sent the automatic recovery after it; that recovery
  unregisters the background service for some twenty seconds before it
  reinstalls the engine, after which the VibeTV reported "no provider" again and
  it started over. Measured on the bench: nine restarts while the customer did
  nothing but sit on the provider list, each one killing the Connect flow's
  firmware check and raising "Repairing VibeTV Control Center" for a teardown
  the app had asked for itself. Only CodexBar's own verdict on its engine
  decides now — reinstalling an engine that reports ready cannot switch a
  provider on. A service that really does stop answering is left to launchd,
  which restarts it within about seventeen seconds; the customer hears nothing
  until that has had its chance and the app has to step in. One that never
  answered at all has no restart coming and is still reported at once.
- Approved files: `apps/control-center/src/components/control-center-app.tsx`,
  `apps/control-center/src/components/control-center-types.ts`,
  `apps/control-center/scripts/test-customer-flows.mjs`. Net: the provider
  incident latch carried on the device session and the recovery dialog's own
  dismissal bookkeeping are gone.

## 2026-09-01 — A dismissed incident stays dismissed, and a probe is not an answer

- User approval: While testing this build on the bench the user reported being
  hard-stuck on "Choose your VibeTV" under stacked popups: "öffnen sich mehrere
  pop ups übereinander und ich komme nicht mehr weiter … finish ai setup on
  this mac kann ich bspw. gar nicht schließen".
- Approved customer-visible result: **Closing "Finish AI setup on this Mac"
  works, and what was closed stays closed.** The dialog's close control did
  nothing inside setup; now it puts the incident away and the step behind it
  stays usable, with the provider step still carrying the broken state on its
  rows. The incident returns only when the current one has ended and a new one
  starts. What used to bring it back was the usage service's own probe: it
  answers "checking" during every half-minute cache refresh, and the app read
  that as the incident ending — un-hiding the dismissed dialog on the next
  failing answer, with a fresh pop-in each time, and re-arming the automatic
  repair so the app tore its own background service down once per probe cycle.
  A "checking" answer is a probe still running, not a verdict, and no longer
  ends an incident. And a scan that could not be made is a failure of the
  device step itself, so "We couldn't search for your VibeTV" now wins over the
  ambient incident the same way every other step failure does — never two
  stacked cards.
- Approved files: `apps/control-center/src/components/setup/setup-wizard.tsx`,
  `apps/control-center/src/components/setup/setup-wizard.test.tsx`,
  `apps/control-center/src/components/control-center-app.tsx`,
  `apps/control-center/scripts/test-customer-flows.mjs`.

## 2026-09-01 — WiFi off is said, not searched around

- User approval: While testing the rebuilt setup the user found the scan
  running with WiFi switched off: "mir ist gerade aufgefallen, dass er auch
  scant, wenn ich gar kein wifi an habe und dann einfach irgendwann kommt,
  dass er nichts gefunden hat. es braucht noch nen pop up mit der meldung,
  dass wifi aus ist."
- Approved customer-visible result: **A Mac without a network is told so
  instead of being searched around.** The automatic scan used to fan out over
  the saved VibeTV addresses into a void for its whole thirty-second window
  and then settle on "0 VibeTVs found on your WiFi" — an answer about
  VibeTVs when the actual problem was the Mac. The background service now
  refuses such a search immediately, and the refusal carries the reason and
  the way out: "This Mac isn't connected to a WiFi network. Turn on WiFi and
  connect this Mac to the WiFi your VibeTV uses, then search again." — shown
  in the existing "We couldn't search for your VibeTV" dialog over the device
  step. Manual IP entry still probes exactly the typed address and reports
  its own failure in its own dialog. A remembered VibeTV on this Mac itself
  (the virtual one used for testing) still answers without WiFi, and an
  unusual but connected network is not accused of being off — it searches
  like today.
- Approved files: `companion/internal/companionapi/server.go`,
  `companion/internal/companionapi/server_test.go`.

## 2026-09-02 — A connected VibeTV with no usage to draw reaches the provider step

- User approval: After connecting on the rebuilt setup the user reported being
  parked: "ok ich glaube er hat sich connected, allerdings bin ich jetzt hier
  stuck für ca. ne minute. dort oben steht wieder 0 vibetvs found. das macht
  ja keinen sinn, weil er hat ja schon einen gefunden und sich mit dem
  connected. außerdem wieso gehts nicht weiter jetzt?"
- Approved customer-visible result: **A VibeTV that connects and pairs but has
  no AI usage to draw carries the customer on to the provider step.** The
  device step already let a VibeTV reporting `provider_setup_required` through
  to the one screen that can fix a provider — but a Mac whose switched-on
  provider cannot deliver usage (signed out, nothing fresh to read) reports a
  running stream with no usage and no error code instead, and that shape
  parked the customer on the device step forever: connect finished, firmware
  checked, and the headline falling back to "0 VibeTVs found on your WiFi"
  over a VibeTV it had just connected. Both shapes are the provider step's
  case, and both pass now — only while the provider selection is still open,
  so a provider that dies after setup still keeps its recovery instead of a
  live screen. The finished-setup gates are untouched: setup still ends only
  on a working provider and a real first frame.
- Approved files: `apps/control-center/src/components/control-center-app.tsx`,
  `apps/control-center/scripts/test-customer-flows.mjs`.

## 2026-09-02 — Back sits top left and reaches the device step

- User approval: The user asked for it from the running wizard on the bench:
  the ghost Back buttons were missing top left, and there was no way back to
  the previous setup step (2026-09-02).
- Approved customer-visible result: **Every setup step with a step before it
  shows a ghost `Back` button in the top left corner**, where it used to sit
  bottom left. **The provider step now offers Back as well**, to the device
  step: the VibeTV that was connected is still on the list there, and pressing
  `Connect` runs the connect and firmware check again and carries the customer
  forward once it finishes. Back from Display Mode and from the theme step is
  unchanged. The welcome and device steps still have none: there is no choice
  before them to return to.
- Approved files: `apps/control-center/src/components/setup/setup-wizard-screen.tsx`,
  `apps/control-center/src/components/setup/setup-step.ts`,
  `apps/control-center/src/components/setup/setup-connect.ts`,
  `apps/control-center/src/components/setup/setup-wizard.tsx`, their tests,
  and this approval record.

## 2026-09-02 — The Mac App stops reading CodexBar's error text

- User approval: The product owner chose this after the diagnosis of the
  device-step hang ("ok mach a und direkt auch die folgearbeit textsuche nach
  rate limit als ganzes rausnehmen", 2026-09-02).
- Approved customer-visible result: **A switched-on provider that has never
  delivered usage now carries the customer from the device step to the
  provider step within one collector cycle, and the VibeTV shows its honest
  "AI usage is not ready" frame instead of nothing.** The runtime used to keep
  silent whenever CodexBar's error text happened to contain the words "rate
  limit" -- which is what CodexBar says for a signed-out Codex -- and neither
  the device nor the wizard was told anything. The runtime no longer reads that
  text at all. This replaces the wizard-side guess approved earlier today ("A
  connected VibeTV with no usage to draw reaches the provider step"): the
  device step again reads only the runtime's own `provider_setup_required`
  signal, and that promise is kept through the runtime -- a provider that has
  never delivered yields the error frame at once; one that delivered before
  keeps its last-good values on the VibeTV and sends an unavailable frame once
  they expire. The Usage screen no longer has a "Refresh is temporarily
  limited" state. A provider CodexBar cannot read keeps showing its last-good
  values as up to date for their ten-minute lifetime and then reads as
  unavailable, whatever reason CodexBar gives; a manual refresh in that time
  says "Refreshing usage" and settles as unavailable after fifteen minutes
  without new data.
- Approved files: `companion/internal/codexbar/codexbar.go`,
  `companion/internal/codexbar/dashboard_fetch.go`,
  `companion/internal/daemon/collector.go`,
  `companion/internal/daemon/daemon.go`,
  `companion/internal/companionapi/server.go`, their tests,
  `apps/control-center/src/components/control-center-app.tsx`,
  `apps/control-center/src/components/control-center-types.ts`,
  `apps/control-center/src/components/usage-screen.tsx`, their tests,
  `apps/control-center/scripts/test-customer-flows.mjs`,
  `docs/usage-polling-architecture.md`, and this approval record.

## 2026-09-02 — Continue uses the provider health already on screen

- User approval: After the three provider-step failures were diagnosed, the
  product owner explicitly instructed the B, A, C package to be implemented in
  that order. For option B, the owner explicitly decided that token history by
  itself is not a healthy provider (2026-09-02).
- Approved customer-visible result: **`Continue` opens as soon as one provider
  that is switched on reads healthy on the provider row, and the Companion
  accepts that same answer.** The step no longer starts a second serial check
  of every enabled provider, waits for a queued check, or mirrors the
  Companion's five-minute verification clock in the browser. `Check again`
  remains available on a row for a check the customer chooses. Token history
  without usable provider usage stays visibly unavailable and does not open
  `Continue`.
- Approved files: `companion/internal/companionapi/preferences.go`,
  `provider_display.go`, `provider_setup.go`,
  `apps/control-center/src/components/control-center-app.tsx`,
  `provider-preferences-polling.ts`,
  `setup/setup-providers-screen.tsx`, their regression tests,
  `apps/control-center/scripts/test-customer-flows.mjs`, and this approval
  record.

## 2026-09-02 — CodexBar owns the provider sign-in guidance

- User approval: In the same explicit B, A, C instruction, the product owner
  approved option A with `Open CodexBar` instead of a web sign-in link, the
  CodexBar sentence shown exactly as reported, a copy control, and token
  history kept separate from provider readiness (2026-09-02).
- Approved customer-visible result: **A provider that needs attention shows
  CodexBar's own sentence, with `Copy`, `Open CodexBar`, and `Check again`.**
  `Open CodexBar` opens the existing CodexBar app, where its own provider help
  and `Add Account…` live. The Control Center no longer chooses a sign-in
  website, opens `chatgpt.com`, guesses from error words that Full Disk Access
  is needed, or shows a 45-second `Waiting for sign-in…` state. Codex signed
  out therefore shows the sentence its bundled CodexBar CLI actually reports,
  rather than inventing the separate `codex login --device-auth` instruction
  that exists only inside the CodexBar GUI binary. When CodexBar reports no
  sentence, the existing generic provider detail remains the fallback.
- Approved files: `companion/internal/companionapi/preferences.go`,
  `provider_setup.go`, `provider_reported.go`,
  `apps/control-center/src/components/setup/setup-provider-row.tsx`,
  `setup-providers-screen.tsx`, `provider-sign-in.ts`,
  `apps/control-center/scripts/check-customer-ui-copy.mjs`,
  `apps/control-center/src/components/control-center-runtime.ts`,
  `macos/VibeTVControlCenter/main.swift`, their regression tests,
  `apps/control-center/scripts/test-customer-flows.mjs`, and this approval
  record.

## 2026-09-02 — Provider rows never stop the Mac App service

- User approval: In the same explicit B, A, C instruction, the product owner
  approved option C: remove provider-row repair and waiting actions, keep the
  automatic engine repair for a real engine failure, and let only the runtime
  recovery screen report a Companion outage (2026-09-02).
- Approved customer-visible result: **No action on a provider row shuts down
  the Companion.** The row no longer offers `Repair the usage service` or a
  guessed recovery wait; it offers CodexBar and the explicit provider check.
  A connection gap reported as `COMPANION_UNREACHABLE` is not also rendered as
  a provider-step failure dialog: the existing status poll and runtime
  recovery screen own a real Companion outage. The automatic repair for a
  genuine CodexBar engine failure remains, and the provider list is refreshed
  after that repair so a stored connection error cannot appear afterwards.
- Approved files: `companion/internal/companionapi/preferences.go`,
  `apps/control-center/src/components/settings-screen.tsx`,
  `setup/setup-provider-dialogs.tsx`,
  `setup/setup-provider-row.tsx`, `setup-providers-screen.tsx`,
  `setup/setup-wizard.tsx`, `control-center-app.tsx`, their regression tests,
  `apps/control-center/scripts/test-customer-flows.mjs`, and this approval
  record.

## 2026-09-02 — The approved CodexBar action passes the copy guard

- User approval: In option A, the product owner explicitly approved the
  customer action `Open CodexBar` and a copy control beside CodexBar's exact
  reported provider sentence (2026-09-02).
- Approved customer-visible result: **The row keeps the exact `Open CodexBar`
  action.** The copy control's accessible name reads `Copy provider message
  for <provider>` while the copied sentence remains exactly what CodexBar
  reported. The customer-copy guard permits only the explicitly approved
  `Open CodexBar` label rather than permitting the internal name generally.
- Approved files: `apps/control-center/scripts/check-customer-ui-copy.mjs`,
  `apps/control-center/src/components/setup/setup-provider-row.tsx`, its
  regression test, `apps/control-center/scripts/test-customer-flows.mjs`, and
  this approval record.

## 2026-09-02 — Overview waits for a real VibeTV preview

- User approval: The product owner explicitly said the customer must never
  reach Overview without a working preview after seeing `Connected` together
  with `Waiting for first image` (2026-09-02).
- Approved customer-visible result: **The closing `Your VibeTV is live` step
  remains on screen until the connected device reports ready and the Mac App
  has received a real display frame. Only then does the short handover delay
  start and Overview become reachable.**
- Approved files: `apps/control-center/src/components/setup/setup-wizard.tsx`,
  its regression test, and this approval record.

## 2026-09-02 — Provider Continue goes directly to Display Mode

- User approval: The product owner reported that `Continue` became disabled,
  appeared to do nothing, then briefly returned to `Connect your VibeTV` before
  reaching Display Mode. They explicitly asked for that flow to be fixed and
  tested without further manual clicking (2026-09-02).
- Approved customer-visible result: **`Continue` accepts the same healthy
  provider state already visible on the screen, without starting a second live
  provider scan. After the successful request, setup goes directly to Display
  Mode and never flashes the device-connection step.**
- Approved files: `companion/internal/companionapi/provider_display.go`,
  `apps/control-center/src/components/control-center-app.tsx`,
  `apps/control-center/src/components/setup/setup-step.ts`, their regression
  tests, and this approval record.

## 2026-09-02 — Provider rows keep only Copy and Retry

- User approval: The product owner explicitly removed the arrow/external
  action because it did not lead anywhere and asked for enabled providers to
  sort automatically above disabled providers (2026-09-02).
- Approved customer-visible result: **A provider that needs attention offers
  only Copy when CodexBar supplied a message and Retry.** No provider row shows
  `Open CodexBar` or an external-link arrow. The shared setup-and-Settings list
  puts switched-on providers first and preserves CodexBar's order inside the
  switched-on and switched-off groups.
- Approved files: `apps/control-center/src/components/setup/setup-provider-row.tsx`,
  `setup/setup-providers-screen.tsx`, their regression tests,
  `apps/control-center/scripts/check-customer-ui-copy.mjs`,
  `apps/control-center/scripts/test-customer-flows.mjs`, and this approval
  record.

## 2026-09-02 — Initial AI provider scan stays visible

- User approval: The product owner supplied the exact loading-state design and
  explicitly asked for another `still checking, hang tight` log line roughly
  every 20 seconds while the provider list is not ready (2026-09-02).
- Approved customer-visible result: **After the firmware check, setup moves to
  `Choose AI providers` while the Mac App reads the first provider inventory.**
  The screen shows `reading provider usage on this Mac`, appends another
  `still checking, hang tight` line every 20 seconds, keeps Search, three
  provider placeholders, and Continue disabled, then replaces the loading
  state with the real provider list as soon as it answers. The former
  `Starting AI usage` dialog no longer covers this ordinary wait.
- Approved files: `apps/control-center/src/components/control-center-app.tsx`,
  `setup/setup-wizard.tsx`, `setup/setup-providers-screen.tsx`, their regression
  tests, `apps/control-center/scripts/test-customer-flows.mjs`, and this
  approval record.

## 2026-09-02 — Theme choice stays explicit and the live headline leads

- User approval: The product owner reported that the theme list, headline, and
  subheadline were too small compared with the preceding `Choose AI providers`
  screen; that setup jumped to `Your VibeTV is live` without a theme choice;
  and that the live headline belonged above the VibeTV image (2026-09-02).
- Approved customer-visible result: **The theme step has a 40px headline, an
  18px subheadline, and larger theme names and previews. It stays on `Choose
  your theme` until the customer explicitly starts and completes the selected
  theme install in this setup. A theme retained from an earlier Mac or updated
  automatically in the background cannot skip that choice. On the final
  screen, `Your VibeTV is live` appears above the VibeTV image.**
- Approved files: `apps/control-center/src/components/control-center-app.tsx`,
  `setup/setup-wizard.tsx`, `setup/setup-wizard-screen.tsx`,
  `setup/setup-theme-screen.tsx`, `setup/setup-live-screen.tsx`, their
  regression tests, `apps/control-center/scripts/test-customer-flows.mjs`, and
  this approval record.

## 2026-09-02 — The final live screen shows the real preview

- User approval: The product owner reported that Overview showed the correct
  live preview while the preceding `Your VibeTV is live` screen still showed
  `WAITING FOR AI SETUP…`, and explicitly required the missing final preview
  to be shown there as well (2026-09-02).
- Approved customer-visible result: **A real display frame takes precedence
  over a briefly stale provider-setup error on the final screen. `Your VibeTV
  is live` remains visible until the selected theme has actually rendered that
  real frame inside the VibeTV image; only then does the short automatic
  handover to Overview begin.**
- Approved files: `apps/control-center/src/components/control-center-app.tsx`,
  `live-vibetv-preview.tsx`,
  `live-vibetv-preview.recovery.test.tsx`,
  `setup/setup-live-screen.tsx`, `setup/setup-wizard.tsx`,
  `setup/setup-wizard.test.tsx`,
  `apps/control-center/scripts/test-customer-flows.mjs`, and this approval
  record.

## 2026-09-03 — The final preview must remain visible through handover

- User approval: In the final clarified flow, the product owner reported that the closing setup screen could
  show `Live preview paused` and still redirect to Overview, explicitly
  required setup never to continue before the preview is certainly visible
  even when waiting takes five minutes or longer, and then explicitly required
  the implementation to follow the repository's simplest possible design
  principle (2026-09-03).
- Approved customer-visible result: **After theme installation, the final `Your VibeTV is live` step
  has no maximum wait timeout. It remains on screen while the preview is
  unavailable. Theme installation allows up to five minutes for a fresh display
  stream. Once the same real preview used by Overview renders, it remains
  visible for three seconds before Overview opens.**
- Approved files: `apps/control-center/src/components/live-vibetv-preview.tsx`,
  `live-vibetv-preview.recovery.test.tsx`, `control-center-app.tsx`,
  `setup/setup-live-screen.tsx`, `setup/setup-wizard.tsx`,
  `setup/setup-wizard.test.tsx`,
  `companion/internal/companionapi/server.go`, its regression tests, and this
  approval record.

## 2026-09-03 — Provider and theme handover stays on the chosen path

- User approval: The product owner reported that setup briefly returned from
  Display Mode to Choose AI providers and then moved forward again. They asked
  for the complete flow to be reviewed against the repository's simplicity
  rules, required the rehearsal to use a true new-customer Mac state, and
  explicitly approved implementing the simplified result with `ja dann mach`
  (2026-09-03).
- Approved customer-visible result: **After a successful provider Continue,
  setup stays on Display Mode even if an older status request finishes late.
  A Mac whose first provider setup is still open must make the explicit theme
  choice before the final live handover; an already completed healthy setup
  may return directly to Overview. The live handover still waits for a real
  renderable preview before Overview opens.**
- Approved files: `apps/control-center/src/components/control-center-app.tsx`,
  `apps/control-center/src/components/setup/setup-wizard.test.tsx`,
  `apps/control-center/scripts/test-customer-flows.mjs`, and this approval
  record.

## 2026-09-03 — Completed setups keep their direct Overview path

- User approval: During the same approved setup-flow review, the product owner
  required the solution to remain as simple as possible and told us to proceed
  with the corrected complete flow (2026-09-03).
- Approved customer-visible result: **Only a genuinely unfinished first-time
  provider setup adds the explicit theme choice after connecting. A healthy Mac
  whose provider setup was already completed continues directly to Overview.**
- Approved files: `apps/control-center/src/components/control-center-app.tsx`,
  `apps/control-center/scripts/test-customer-flows.mjs`, and this approval
  record.

## 2026-09-03 — Setup only returns by explicit customer choice

- User approval: The product owner reported that installing a theme or
  screensaver after reaching Overview reopened the setup wizard, explicitly
  required that this must never happen after Overview was reached once, and
  clarified that `Run setup again` is the deliberate exception. They also
  explicitly required `Ask AI to fix` to restore the local setup first and
  never clone a repository or create a pull request without a later customer
  decision (2026-09-03). During the same review they instructed us to resolve
  the remaining real Bug Detector findings before another candidate test.
- Approved customer-visible result: **The first completed setup waits for a
  real preview and then opens Overview. From that point on, theme installs,
  screensaver installs, provider refreshes, and temporary reconnects keep the
  Control Center open; only the explicit `Run setup again` action may return
  to the wizard. Automatic display keeps every enabled provider, and Manual
  display chooses a provider that can currently render. `Ask AI to fix` tells
  the agent to repair and verify this Mac first, then inspect the source and
  ask before any pull request; it never instructs the agent to clone, commit,
  push, or open a pull request.**
- Approved files: `apps/control-center/src/components/control-center-app.tsx`,
  `settings-screen.tsx`, `setup/setup-ai-prompt.ts`, `setup/setup-step.ts`,
  `setup/setup-wizard.tsx`, their regression tests,
  `apps/control-center/scripts/test-customer-flows.mjs`, and this approval
  record.

## 2026-09-03 — Reloads preserve completed setup

- User approval: The product owner explicitly required that once Overview was
  reached, installing themes or screensavers must never return to the wizard,
  and clarified that only `Run setup again` may reopen setup (2026-09-03).
- Approved customer-visible result: **After Overview has opened, a reload,
  pairing loss, theme or screensaver install, and a VibeTV restart during an
  already-running firmware update keep the Control Center shell open. A first
  setup still waits for provider choice, display choice, a completed theme,
  and a real preview before Overview opens.**
- Approved files: `apps/control-center/src/components/control-center-app.tsx`,
  `apps/control-center/scripts/test-customer-flows.mjs`, and this approval
  record.

## 2026-09-03 — Cable/WiFi setup keeps the current wizard fixes

- User approval: After reviewing PR 407 against the current PR 331 head, the
  product owner explicitly instructed us to integrate the reviewed changes on
  PR 407 while leaving PR 331 untouched (2026-09-03).
- Approved customer-visible result: **The Cable/WiFi decision stays inside the
  current setup wizard: one matching Cable or WiFi VibeTV connects
  automatically, multiple matching VibeTVs require a choice, and Cable-based
  WiFi setup remains available. Provider, display, theme, and final-preview
  handovers retain the current wizard behavior. Settings presents Connection
  as one flat section alongside the other settings.**
- Approved files: `apps/control-center/src/components/control-center-app.tsx`,
  `settings-screen.tsx`, `setup/setup-device-screen.tsx`,
  `setup/setup-wizard.tsx`, their regression tests,
  `apps/control-center/scripts/test-customer-flows.mjs`, and this approval
  record.

## 2026-09-03 — Completed setup survives a restart; a pinned provider must be ready

- User approval: The product owner reviewed the PR #331 bug-detector findings
  and required all three fixed before the merge (2026-09-03): "Nach Neustart
  wieder Wizard" for a customer who had already reached Overview, "fester
  Provider ist kaputt, anderer funktioniert", and provider messages that carry a
  token or an e-mail address.
- Approved customer-visible result: **Starting the app on a Mac whose setup is
  already recorded opens the Control Center directly, with every tab available,
  while its connected VibeTV is still coming up and has not drawn a frame yet;
  before, it opened the wizard on "looking for your VibeTV" or held its closing
  step. Overview renders no theme and no usage until a real frame arrives. A
  VibeTV that is switched off when the app starts keeps the device step with
  its recovery picker, as approved before. On the provider step, Continue is refused with
  "The provider VibeTV shows is not ready." and the display step opens when the
  provider under "Always show" cannot produce a reading while another one can;
  Automatic is unchanged. A provider's own message on the provider row keeps its
  wording but shows `[redacted]` in place of an e-mail address, a cookie or
  token value, or a key inside an echoed response, in the row and in what Copy
  puts on the clipboard.**
- Approved files: `apps/control-center/src/components/control-center-app.tsx`,
  `apps/control-center/src/components/setup/setup-step.ts`, their regression
  tests, `apps/control-center/scripts/test-customer-flows.mjs`, the Companion
  provider-completion gate and provider-message redaction with their tests,
  `docs/control-center-ui-principles.md` rules 4 and 6, and this approval
  record.

## 2026-09-03 — Detector follow-up on the three fixes

- User approval: Same instruction as the entry above (2026-09-03): fix the
  bug-detector findings, push, tag the detector, and repeat until nothing
  real remains. This entry records the review round on `f3c72a6`.
- Approved customer-visible result: **No new screen or wording. Two
  hardenings of the results approved above: a provider message now also
  redacts a short alphabetic value after `=` or under a password key
  (`password=letmein` reads `password=[redacted]`), and a launch whose
  display-selection read fails transiently keeps waiting for a real frame
  as before instead of deciding for the whole session that setup was never
  completed. The theme-step assertion in the customer flows reports what was
  on screen when it fails.**
- Approved files: `apps/control-center/src/components/control-center-app.tsx`,
  `apps/control-center/src/components/setup/setup-step.ts`, their regression
  tests, `apps/control-center/scripts/test-customer-flows.mjs`, the Companion
  provider-message redaction with its tests, and this approval record.

## 2026-09-03 — Detector round 3 on the three fixes

- User approval: Same instruction as the two entries above (2026-09-03): fix
  the bug-detector findings and repeat until nothing real remains. This entry
  records the review round on `406b250`.
- Approved customer-visible result: **No new screen or wording. A provider
  message keeps its words only after a browser's `cookies:` prefix, the one
  prose family the pinned usage engine produces, so `token: letmein` reads
  `token: [redacted]`. A display-selection read that failed at startup is
  asked again every five seconds until it answers, so a customer coming back
  reaches Overview after one dropped request instead of waiting for a frame
  all launch. Two provider switches saved in the same moment both reach the
  Automatic pool; before, the second could undo the first.**
- Approved files: `apps/control-center/src/components/control-center-app.tsx`,
  `apps/control-center/src/components/control-center-types.ts`, their
  regression tests, `apps/control-center/scripts/test-customer-flows.mjs`, the
  Companion provider-message redaction with its tests, and this approval
  record.

## 2026-09-03 — Detector round 4 on the three fixes

- User approval: Same instruction as the entries above (2026-09-03): fix the
  bug-detector findings and repeat until nothing real remains. This entry
  records the review round on `e95035a`.
- Approved customer-visible result: **A provider whose last reading is older
  than the ten minutes the Mac App keeps one is no longer shown as having a
  saved reading: its row reads unavailable, the display step no longer offers
  it, and setup no longer completes on a pin to it. In Settings, `Run setup
  again` waits while a display-mode save is still in flight. A provider
  message also redacts credential values inside a URL query string
  (`?token=…&session=…`).**
- Approved files: `apps/control-center/src/components/settings-screen.tsx` and
  its test, the Companion provider descriptors and provider-message redaction
  with their tests, and this approval record.

## 2026-09-03 — Detector round 5 on the three fixes

- User approval: Same instruction as the entries above (2026-09-03): fix the
  bug-detector findings and repeat until nothing real remains. This entry
  records the review round on `86f3225`.
- Approved customer-visible result: **`Run setup again` no longer greys out
  during a display-mode save; instead the reset itself, from Settings and from
  Support alike, shows `Resetting` until a save still in flight has landed and
  then proceeds. A provider message also redacts a credential value after a
  URL's `#`.**
- Approved files: `apps/control-center/src/components/control-center-app.tsx`,
  `apps/control-center/src/components/settings-screen.tsx` and its test
  (restored), `apps/control-center/scripts/test-customer-flows.mjs`, the
  Companion provider-message redaction with its tests, and this approval
  record.

## 2026-09-04 — Final detector findings before candidate test

- User approval: The product owner instructed us to review every remaining Bug
  Detector finding on PR #331, fix real findings, close extreme edge cases, and
  report only when the final candidate is ready to test (2026-09-04).
- Approved customer-visible result: **No new screen, wording, or control. A
  provider message containing credentials inside URL userinfo now shows one
  `[redacted]` marker instead of the username and password. After `Run setup
  again`, an older display-selection read that finishes late cannot restore the
  deleted choice, so the existing Display Mode step is not skipped.**
- Approved files: `apps/control-center/src/components/control-center-app.tsx`,
  the Companion provider-message redaction and its regression test, and this
  approval record.

## 2026-09-04 — Retained provider readings stay honest and usable

- User approval: Same instruction as the entry above: resolve every real Bug
  Detector finding on PR #331 before reporting the candidate ready to test.
- Approved customer-visible result: **A switched-on provider whose bounded
  last-good reading is retained shows the Companion's existing stale-status
  message and a Check-again action while keeping its on/off switch. If it is the
  only provider with a usable reading, Continue remains available because the
  Companion and Display Mode already accept the same retained reading.**
- Approved files: `apps/control-center/src/components/setup/setup-provider-row.tsx`,
  `apps/control-center/src/components/setup/setup-providers-screen.tsx`, their
  regression tests, and this approval record.

## 2026-09-04 — Retained provider status is read-only

- User approval: Same instruction as the entries above: resolve every real Bug
  Detector finding on PR #331 before reporting the candidate ready to test.
- Approved customer-visible result: **A stale provider row shows the existing
  retained-reading message and keeps its switch, but does not add a Check-again
  action that could replace the still-usable retained state with a temporary
  retry failure. A slow display-selection read can no longer visibly undo a
  newer mode saved in Settings.**
- Approved files: `apps/control-center/src/components/control-center-app.tsx`,
  `apps/control-center/src/components/setup/setup-provider-row.tsx`, its test,
  and this approval record.

## 2026-09-04 — Latest display read wins

- User approval: Same instruction as the entries above: resolve every real Bug
  Detector finding on PR #331 before reporting the candidate ready to test.
- Approved customer-visible result: **No new screen, wording, or control. When
  display-selection reads overlap, only the newest result may update Settings;
  an older failure cannot show an error after a newer read already succeeded.**
- Approved files: `apps/control-center/src/components/control-center-app.tsx`
  and this approval record.

## 2026-09-04 — One display read at a time

- User approval: Same instruction as the entries above: resolve every real Bug
  Detector finding on PR #331 before reporting the candidate ready to test.
- Approved customer-visible result: **No new screen, wording, or control. A
  slow display-selection read is allowed to finish within its normal timeout;
  repeated refresh ticks share that request instead of continually replacing
  it, so a returning setup cannot remain stuck on a false read error.**
- Approved files: `apps/control-center/src/components/control-center-app.tsx`
  and this approval record.

## 2026-09-04 — Reset waits for provider toggles

- User approval: Same instruction as the entries above: resolve every real Bug
  Detector finding on PR #331 before reporting the candidate ready to test.
- Approved customer-visible result: **No new screen, wording, or control. When
  `Run setup again` is pressed during a provider toggle, its existing Resetting
  state waits for the provider and resulting Automatic display save before it
  clears setup, so an old display choice cannot return afterward.**
- Approved files: `apps/control-center/src/components/control-center-app.tsx`,
  `apps/control-center/scripts/test-customer-flows.mjs`, and this approval
  record.

## 2026-09-04 — Keep an installed VibeTV theme during setup

- User approval: After connecting a real VibeTV that already had a theme, the
  product owner reported that setup still opened `Choose your theme` and began
  uploading theme files, and required this incorrect setup path to be fixed.
- Approved customer-visible result: **After Connect, setup uses the VibeTV's
  confirmed theme state. A VibeTV with an active, successfully rendered theme
  skips theme selection and no theme install request is made. Only a VibeTV
  that explicitly reports no active theme is sent to `Choose your theme`.**
- Approved files: `apps/control-center/src/components/control-center-app.tsx`,
  `apps/control-center/scripts/test-customer-flows.mjs`, and this approval
  record.

## 2026-09-04 — Preview waiting is not theme setup

- User approval: Same final-candidate instruction as above. The Bug Detector
  found that a delayed first preview could still send a VibeTV with a confirmed
  active theme to `Choose your theme`, matching the product owner's fresh
  real-device report.
- Approved customer-visible result: **Theme state and preview readiness remain
  separate. A VibeTV with an active rendered theme waits on `Your VibeTV is
  live` for its first preview; it never offers an unnecessary theme install.
  An explicit `theme-missing` state still opens the theme chooser.**
- Approved files: `apps/control-center/src/components/control-center-app.tsx`,
  `apps/control-center/scripts/test-customer-flows.mjs`, and this approval
  record.

## 2026-09-04 — Native welcome keeps Ask AI recovery

- User approval: Same instruction as above: fix every real Bug Detector finding
  before the final candidate test.
- Approved customer-visible result: **The Help menu on the native welcome
  screen again offers `Ask AI to fix`. It copies the same safe recovery intent
  as the Web setup: repair and verify the existing Mac first, identify the
  repository and native screen, and never clone, commit, push, or open a pull
  request without a later explicit decision.**
- Approved files: `macos/VibeTVControlCenter/main.swift`,
  `macos/VibeTVControlCenter/URLSchemeTests.swift`, and this approval record.

## 2026-09-04 — Existing themes still complete the live handoff

- User approval: Same final-candidate instruction as above. The next exact-head
  Bug Detector review found that the first frame could close setup early when
  the connected VibeTV already had a theme.
- Approved customer-visible result: **A setup that reuses an installed theme
  still shows the real preview on `Your VibeTV is live` for the approved three
  seconds before Overview opens. Only a customer whose setup was completed
  before this app session skips that handoff.**
- Approved files: `apps/control-center/src/components/control-center-app.tsx`,
  `apps/control-center/scripts/test-customer-flows.mjs`, and this approval
  record.

## 2026-09-04 — Automatic drops providers that were switched off

- User approval: Same final-candidate instruction as above. The next exact-head
  Bug Detector review found that switching off the last Automatic provider and
  then enabling another one could carry the disabled provider into the next
  display save.
- Approved customer-visible result: **When Automatic cannot save an empty
  provider pool, the next provider enabled replaces any explicitly disabled
  IDs instead of adding to them. The new working provider reaches VibeTV without
  requiring a manual Display Mode repair.**
- Approved files: `apps/control-center/src/components/control-center-types.ts`,
  `control-center-types.test.ts`, `control-center-app.tsx`, and this approval
  record.

## 2026-09-04 — Retained readings survive health refreshes

- User approval: Same instruction as above: fix every real Bug Detector finding
  before the final candidate test.
- Approved customer-visible result: **A bounded last-good provider reading
  remains visibly stale and usable for setup even if the latest background
  health check now reports sign-in or setup required. Once that saved reading
  expires, it remains unavailable as before.**
- Approved files: `companion/internal/companionapi/preferences.go`, its tests,
  `provider_display_test.go`, and this approval record.

## 2026-09-04 — Invalid saved display choices stay repairable

- User approval: Same instruction as above: fix every real Bug Detector finding
  before the final candidate test.
- Approved customer-visible result: **When a saved display choice becomes
  invalid and the connected VibeTV cannot render because of it, setup opens
  Display Mode instead of sending the customer back to the device connection
  step.**
- Approved files: `apps/control-center/src/components/control-center-app.tsx`,
  `apps/control-center/src/components/setup/setup-step.ts`, their tests, and
  this approval record.

## 2026-09-04 — Saved provider readings stay visibly stale

- User approval: Same instruction as above: fix every real Bug Detector finding
  before the final candidate test.
- Approved customer-visible result: **When the app keeps a bounded last-good
  reading, the provider row always says that the value is saved rather than
  live. Safe provider-specific recovery guidance remains visible after that
  warning.**
- Approved files: `companion/internal/companionapi/preferences.go`, its tests,
  and this approval record.

## 2026-09-04 — Setup reset blocks later provider writes

- User approval: Same instruction as above: fix every real Bug Detector finding
  before the final candidate test.
- Approved customer-visible result: **After `Run setup again` starts, later
  provider switches and display-mode changes cannot write the old setup back
  while reset is in flight. Existing writes still finish before reset as
  before.**
- Approved files: `apps/control-center/src/components/control-center-app.tsx`,
  `apps/control-center/scripts/test-customer-flows.mjs`, and this approval
  record.

## 2026-09-04 — Theme-step failures stay recoverable

- User approval: Same instruction as above: fix every real Bug Detector finding
  before the final candidate test. The exact-head review found two dead ends on
  `Choose your theme`: an unavailable catalog and a failed install.
- Approved customer-visible result: **When no theme catalog can be loaded, the
  existing theme step stays visible behind a `Themes unavailable` dialog with
  `Reload catalog`. When a theme install fails, its exact message and next
  action appear in a dialog over the same step with `Try again`.**
- Approved files: `apps/control-center/src/components/control-center-app.tsx`,
  `apps/control-center/src/components/setup/setup-provider-dialogs.tsx`,
  `apps/control-center/src/components/setup/setup-wizard.tsx`, its test,
  `apps/control-center/scripts/test-customer-flows.mjs`, and this approval
  record.

## 2026-09-04 — Canceling manual IP lookup restarts discovery

- User approval: Same instruction as above: fix every real Bug Detector finding
  before the final candidate test. The exact-head review found that canceling a
  submitted manual IP lookup could leave the Welcome scan permanently running.
- Approved customer-visible result: **No new screen, wording, or control. When
  a submitted manual IP lookup replaces the running WiFi scan and is then
  canceled, setup starts a fresh WiFi scan instead of remaining on Welcome
  forever. A canceled lookup still cannot connect later.**
- Approved files: `apps/control-center/src/components/control-center-app.tsx`,
  `apps/control-center/src/components/setup/setup-wizard.tsx`, its test, and
  this approval record.

## 2026-09-04 — Provider writes win over older reads

- User approval: Same instruction as above: fix every real Bug Detector finding
  before the final candidate test. The exact-head review found that a provider
  read started before a toggle could arrive later and restore the old value.
- Approved customer-visible result: **No new screen, wording, or control. A
  confirmed provider toggle remains visible and authoritative when an older
  provider read finishes afterward; Automatic display keeps the confirmed
  switched-on provider pool.**
- Approved files: `apps/control-center/src/components/control-center-app.tsx`,
  `apps/control-center/scripts/test-customer-flows.mjs`, and this approval
  record.

## 2026-09-04 — Provider checks win over older reads

- User approval: Same instruction as above: fix every real Bug Detector finding
  before the final candidate test. The exact-head review found that a provider
  read started before `Check again` could later restore the old provider state.
- Approved customer-visible result: **No new screen, wording, or control. After
  `Check again` succeeds, the row waits for a fresh provider read and cannot be
  reverted by a response that started before the check.**
- Approved files: `apps/control-center/src/components/control-center-app.tsx`,
  `apps/control-center/scripts/test-customer-flows.mjs`, and this approval
  record.

## 2026-09-04 — Credential-named provider output is redacted

- User approval: Same instruction as above: fix every real Bug Detector finding
  before the final candidate test. The exact-head review found that short values
  under `credential` or `credentials` keys could reach the provider message.
- Approved customer-visible result: **Provider guidance and its Copy action
  replace scalar or structured values under credential-named keys with the
  existing `[redacted]` marker.**
- Approved files: `companion/internal/companionapi/provider_reported.go`, its
  test, and this approval record.

## 2026-09-04 — Failed setup reset finishes pending provider changes

- User approval: Same instruction as above: fix every real Bug Detector finding
  before the final candidate test. The exact-head review found that a failed
  setup reset could interrupt the Automatic-pool half of an earlier provider
  change.
- Approved customer-visible result: **No new screen, wording, or control. If
  setup cannot restart, a provider change that was already saving finishes its
  Automatic display update instead of leaving the provider switch and VibeTV
  selection inconsistent. A successful reset still discards the old setup.**
- Approved files: `apps/control-center/src/components/control-center-app.tsx`,
  `apps/control-center/scripts/test-customer-flows.mjs`, and this approval
  record.

## 2026-09-04 — Passphrase provider output is redacted

- User approval: Same instruction as above: fix every real Bug Detector finding
  before the final candidate test. The exact-head review found that short values
  under `passphrase` or `passcode` keys could reach the provider message.
- Approved customer-visible result: **Provider guidance and its Copy action
  replace scalar or structured passphrase and passcode values with the existing
  `[redacted]` marker. The shared sensitive-field list governs both shapes.**
- Approved files: `companion/internal/companionapi/provider_reported.go`, its
  test, and this approval record.

## 2026-09-04 — Token history keeps saved quota visibly stale

- User approval: Same instruction as above: fix every real Bug Detector finding
  before the final candidate test. The exact-head review found that a successful
  token-history scan could drop the retained marker from an older quota reading.
- Approved customer-visible result: **A fresh token-history scan may update
  token totals, but it cannot make saved quota percentages look live. They stay
  visibly stale until a fresh quota collection replaces them.**
- Approved files: `companion/internal/daemon/collector.go`, its test, and this
  approval record.

## 2026-09-04 — Provider race tests wait for an idle read

- User approval: Same instruction as above: make every real finding safe and
  leave the final candidate fully green. The exact-head CI exposed that the
  provider race fixture could reuse an earlier allowed single-flight read on a
  slow runner instead of starting the read the test meant to race.
- Approved customer-visible result: **No product UI change. The existing
  provider read/write and provider check/read behavior remains covered, while
  the browser regression waits for its setup read to finish before creating the
  intended race.**
- Approved files: `apps/control-center/scripts/test-customer-flows.mjs` and this
  approval record.

## 2026-09-04 — Usage API keeps saved quota visibly stale

- User approval: Same instruction as above: fix every real Bug Detector finding
  before the final candidate test. The exact-head review found that retained
  quota was stale on the device frame but could still look fresh in Usage.
- Approved customer-visible result: **Saved quota percentages remain stale in
  the Usage screen and cannot produce `Usage is up to date`. Independently
  refreshed token history remains available with its own freshness.**
- Approved files: `companion/internal/daemon/daemon.go`, its test, and this
  approval record.

## 2026-09-04 — Provider race tests count before navigation

- User approval: Same instruction as above: leave the final candidate fully
  green. The exact-head CI showed that Overview could start the intended stale
  provider read before the fixture took its baseline count.
- Approved customer-visible result: **No product UI change. The provider race
  regressions count reads before either navigation can start one and keep the
  intended stale response open until after the competing write or check.**
- Approved files: `apps/control-center/scripts/test-customer-flows.mjs` and this
  approval record.

## 2026-09-04 — Automatic pool retries a failed save

- User approval: Same instruction as above: fix every real Bug Detector finding
  before the final candidate test. The exact-head review found that a provider
  switch could succeed while its following Automatic-pool save failed once.
- Approved customer-visible result: **No new screen, wording, or control. The
  confirmed provider switch stays authoritative and the Automatic display pool
  retries in the background until a save succeeds or a newer display choice
  replaces it.**
- Approved files: `apps/control-center/src/components/control-center-app.tsx`,
  `apps/control-center/scripts/test-customer-flows.mjs`, and this approval
  record.

## 2026-09-04 — Provider health remains live while visible

- User approval: Same instruction as above: fix every real Bug Detector finding
  before the final candidate test. The exact-head review found that carried
  provider health could stop polling before the background result arrived.
- Approved customer-visible result: **While Settings or provider setup is
  visible, enabled provider health keeps refreshing without running duplicate
  provider retries. A carried result shows `Checking` until the current
  background health result has actually been observed.**
- Approved files: `companion/internal/companionapi/preferences.go`, its test,
  `apps/control-center/src/components/provider-preferences-polling.ts`, its
  test, and this approval record.

## 2026-09-04 — Exact provider checks beat older health scans

- User approval: Same instruction as above: fix every real Bug Detector finding
  before the final candidate test. The exact-head review found that an older
  full health scan could finish after a newer successful manual provider check.
- Approved customer-visible result: **A successful `Check again` result remains
  authoritative. Any provider-health scan that started earlier is discarded
  instead of reverting the row or closing setup again.**
- Approved files: `companion/internal/companionapi/provider_setup.go`,
  `companion/internal/companionapi/preferences_test.go`, and this approval
  record.

## 2026-09-04 — Final exact-head provider corrections

- User approval: Fix every real Bug Detector finding before the final candidate
  test. The exact-head review found three remaining provider-state mismatches.
- Approved customer-visible result: **Continue requires actual usage or an
  exact successful check; Automatic always follows CodexBar's current enabled
  providers; provider descriptions make no Companion-owned claims about what a
  particular integration represents.**
- Approved files: `companion/internal/codexbar/providers.go`, its test,
  `companion/internal/companionapi/preferences.go`,
  `companion/internal/companionapi/provider_display.go`, their tests,
  `companion/internal/daemon/daemon.go`, its test, and this approval record.

## 2026-09-04 — Empty setup theme catalog recovery

- User approval: Fix every real Bug Detector finding before the final candidate
  test. The exact-head review found that a successful catalog with no live
  themes left the first setup on an empty chooser.
- Approved customer-visible result: **When no installable live theme exists,
  setup shows `Themes unavailable` with `Reload catalog` instead of an empty
  chooser with a permanently disabled Install button.**
- Approved files: `apps/control-center/src/components/control-center-app.tsx`,
  its unit test, and this approval record.

## 2026-09-04 — Disabled-provider polling and complete Automatic retries

- User approval: Fix every real Bug Detector finding before the final candidate
  test. The exact-head review found that an all-disabled provider list stopped
  observing later CodexBar changes and that a newer toggle could replace an
  incomplete Automatic-pool repair.
- Approved customer-visible result: **No new screen, wording, or control. While
  Settings or provider setup remains visible, switching on a provider directly
  in CodexBar appears without reloading even when every row was off. If display
  saving fails across multiple provider changes, the background retry preserves
  every currently enabled provider instead of retrying only the last toggle.**
- Approved files: `apps/control-center/src/components/control-center-app.tsx`,
  `apps/control-center/src/components/control-center-types.ts`,
  `apps/control-center/src/components/provider-preferences-polling.ts`, their
  tests, `apps/control-center/scripts/test-customer-flows.mjs`, and this approval
  record.

## 2026-09-05 — Arbitrary cookie values are redacted

- User approval: Fix every real Bug Detector finding before the final candidate
  test. The exact-head review found that an arbitrary short alphabetic value
  after `cookies:` could pass through the diagnostic prose exception.
- Approved customer-visible result: **Provider guidance and its Copy action
  redact arbitrary values after `cookies:`. Only the evidenced diagnostic
  beginnings `missing` and `permission` remain readable.**
- Approved files: `companion/internal/companionapi/provider_reported.go`, its
  test, and this approval record.

## 2026-09-07 — Continue the Claude Design Cable/WiFi setup

- User approval: The user supplied their Claude Design setup as the reference
  for PR #407, required access through MCP, and then explicitly asked to
  continue with that design: "lass mal hier weitermachen, review kommt dann
  ganz am ende". The reference read through MCP is `Setup Wizard Redesign.dc.html`
  in project `36eb7a1c-bd59-42f0-b120-3f1eb3905e4b`.
- Approved customer-visible result: The existing discovery matrix still decides
  whether to connect directly, list devices, or offer Cable/WiFi. The connection
  chooser uses the reference's two selectable cards, actual discovery counts,
  and one `Connect` button. Device rows label Cable/WiFi and keep the device
  name readable on narrow screens. WiFi credentials use the full-width network
  picker; after submission the same form stays visible and disabled while the
  app waits, with a sent status only after confirmed submission. The existing
  rescan recovery remains available. The no-device dialog offers Cable or the
  phone setup; phone instructions use a dismissible, reopenable dialog with
  manual IP entry and rescan. Back is available before a connection operation.
- Approved files: `setup-device-screen.tsx`, `setup-device-card.tsx`,
  `setup-device-dialogs.tsx`, `setup-wizard.tsx`, their tests,
  `setup-preview-gallery.tsx`, `test-customer-flows.mjs`, and this record.

## 2026-09-08 — Settings connection cards and hardware rehearsal fixes

- User approval: Implement the Settings design accessed through Claude Design
  MCP, test Cable and WiFi on the connected VibeTV, fix empty-password submission
  and native paste, and finish the requested fresh-start rehearsal. The user
  subsequently requested the tested changes be pushed to PR #407.
- Approved customer-visible result: Settings shows the reference's USB-C and
  WiFi cards with the currently confirmed mode selected. Switching uses a
  confirmation dialog and opens WiFi setup when credentials are needed; a
  completed switch returns to Settings. Theme, providers and brightness survive
  transport changes. Secured and manually entered networks require a nonempty
  password. Native Edit shortcuts support paste, and submitted WiFi details can
  be edited while waiting. Setup and Settings previews use the usage-window
  labels returned by CodexBar and refresh when the app becomes visible.
- Device identity remains known when the initial status is disconnected. Setup
  requires an explicit selection before replacing it with another discovered
  device. Firmware verification uses the selected device's verified handshake.
  Cable discovery runs before network probing and remains available when WiFi
  is off or denied; a detected Cable device needs only one WiFi sweep. The setup
  picker uses the recovery gate's bound identity without treating a disconnected
  snapshot as a connected session. Transport worker replacement keeps the shared
  CodexBar service and does not
  overwrite valid usage with the canceled worker's error.
- Observed validation: The same local production build of the tested source
  (`1b0a176-final-0eb5ce1a45-dirty`, app and firmware `99.0.1027`) completed fresh
  WiFi and separate fresh Cable setup on VibeTV `5804508`, including Mini Classic
  installation and the visible native Overview. Settings WiFi -> USB-C -> WiFi
  reused saved credentials and retained the theme and 20% brightness. Brightness
  20 -> 21 -> 20 was confirmed from device settings. Both runs ended with a healthy
  stream and successful firmware render status. The final Cable run followed
  another complete Mac cleanup and full device erase/verified firmware restore.
  The source passed 543 UI unit tests. These are local hardware results, not a
  signed Sparkle upgrade rehearsal or a completed review of the pushed SHA.
- Approved files: `settings-screen.tsx`, `settings-connection.test.tsx`,
  `control-center-app.tsx`, `device-recovery-gate.ts`, `usage-surface-polling.ts`,
  `setup-connection.ts`, `setup-wizard.tsx`, `setup-device-screen.tsx`,
  `setup-display-mode-screen.tsx`, `setup-display-previews.ts`,
  `setup-preview-gallery.tsx`, their tests, the native Edit menu, the Companion
  device/provider/collector/USB fixes and their regression tests, and this record.

## 2026-09-08 — Keep theme verification on its entered step

- User approval: Finish the requested setup fixes and push PR #407, including
  the final CI/review corrections.
- Approved customer-visible result: A failed quiet device read after installing
  a theme leaves setup waiting for display confirmation. It does not declare
  the entire Mac App unavailable or restart the welcome screen. The existing
  status poll still reports a real connection loss, and explicit device checks
  retain their error handling.
- Validation: The full customer-flow regression covers the failed readback;
  subsequent status responses are delayed so recovery cannot rely on a fast
  poll. This scenario is also included in the focused theme-missing suite.
- Approved files: `control-center-app.tsx`, `test-customer-flows.mjs`, and this
  record.

## 2026-09-08 — Resume setup with saved WiFi details

- User approval: Finish the setup fixes and push PR #407, including final
  review corrections.
- Approved customer-visible result: Choosing WiFi after a Cable connection
  failure resumes discovery when the device reuses its saved network. Setup
  reconnects the same device without asking for the password again.
- Validation: Regression reproduces Cable-only discovery, a failed Cable
  connection, the saved-network response, and reconnection to the rediscovered
  WiFi identity. It fails before the delayed rescan is added.
- Approved files: `setup-wizard.tsx`, `setup-wizard.test.tsx`, and this record.

## 2026-09-08 — Return to Settings after confirmed WiFi

- User approval: Finish the setup and Settings fixes, including PR #407 review
  corrections, and push the result.
- Approved customer-visible result: A later status confirmation of the same
  connected WiFi device closes the Settings connection flow even when the
  earlier discovery found nothing. An offline saved binding does not finish it.
- Implementation: Both status polling paths share the connection-state update
  and use the existing confirmation predicate, which now requires connectivity.
- Validation: Browser regression starts in Cable Settings, returns no search
  results, observes offline WiFi, and then returns to the selected WiFi Settings
  card after a connected status without another device-selection write.
- Approved files: `control-center-app.tsx`, `control-center-app.test.ts`,
  `test-customer-flows.mjs`, and this record.

## 2026-09-08 — Bound WiFi transition recovery

- User approval: Finish the authorized setup rehearsal and PR #407 review fixes, then push the result; no repeated approval requests in this chat.
- Approved customer-visible result: Pending WiFi setup keeps searching after an empty or temporarily failed scan. After 60 seconds it returns to editable WiFi details with a short explanation and the existing Back control, instead of waiting indefinitely. Only the same device can complete an identified transition.
- Validation: Regressions cover failed scans, unrelated devices, status rerenders, eventual same-device connection, deadline recovery and cancellation of automatic searches.
- Approved files: `setup-wizard.tsx`, `setup-wizard.test.tsx`, and this record.

## 2026-09-08 — Correct saved-network regression fixture

- User approval: Complete PR #407 corrections and push.
- Approved customer-visible result: The approved saved-network and bounded WiFi recovery behavior is unchanged; the test candidate contains only its actual supported fields.
- Validation: TypeScript checking and the setup regression suite.

## 2026-09-08 — Pixel Battery takeover and editable remaining-color thresholds

- User approval: In the owner's submitted review of PR #419 on 2026-09-07,
  Paul explicitly requested a single segmented Pixel Battery theme, removal
  of the separate solid-bar catalog entry without adding a variant switch,
  and editable color thresholds with a clear distinction from the fallback
  bar color. On 2026-09-08, after the remaining focus-loss and import-alias
  defects were explained, he instructed us to take over and implement the
  fixes: "ok dann leg los".
- Approved customer-visible result: The catalog offers one segmented Pixel
  Battery with provider logos and quota-based colors. Its existing Theme
  Studio progress inspector exposes up to four remaining-percentage
  thresholds and their colors, explains when the fallback color applies,
  and can return to a solid fill. A threshold stays in the same editable row
  and keeps keyboard focus while its number changes. Imported themes use
  the same long-form feature-container precedence as the VibeTV, including
  explicitly empty containers. The takeover preserves the theme's existing
  layout and vertically centered provider label.
- Evidence boundary: This records the owner's explicit requested results;
  it is not a claim of hardware acceptance or approval to merge or release.

### Follow-up — validate imported provider maps before export

- User approval: Carries forward Paul's 2026-09-08 instruction to take over
  PR #419 and fix its remaining defects ("ok dann leg los"). This is a
  validation correction within that work; no separate design approval or
  hardware acceptance is claimed.
- Approved customer-visible result: Imported provider-logo maps attached to
  non-sprite elements are rejected in Theme Studio using its existing
  "providerAssets is only supported on sprites" validation message, before
  export produces a pack that installation would reject. The existing message
  and validation flow are reused; the correction extends the same check from
  GIFs to every unsupported element type. Valid themes and the inspector's
  controls keep their existing behavior.

### Follow-up — keep incomplete theme update checks unresolved

- User approval: Carries forward Paul's 2026-09-08 takeover and defect-fix
  instruction ("ok dann leg los"). No separate design approval or hardware
  acceptance is claimed.
- Approved customer-visible result: When the catalog cannot identify the active
  theme's requirements, missing provider-logo, threshold-color, or text-alignment
  firmware support keeps the existing catalog-attention state visible. The app
  does not report the theme update as complete before those requirements can be
  checked. Existing wording and controls are reused.

### Browser regression coverage for capability readback

- User approval: The same 2026-09-08 takeover and defect-fix authorization
  covers the accompanying browser regression tests.
- Approved customer-visible result: The existing catalog-attention message
  persists for each missing firmware capability; a complete capability
  readback can show "Update complete". Browser fixtures now distinguish those
  outcomes explicitly, without weakening the visible assertions.

### 2026-09-08 — Pixel Battery bench refinements and immediate provider selection

- User approval: Paul requested larger reset text and consistently large,
  vertically centered percentages, reported battery-area redraw flicker and
  delayed manual provider switching, then approved the installed result
  ("ok passt so") and instructed us to push and fix relevant CI/review findings.
- Approved customer-visible result: Pixel Battery revision 16 keeps percentage digits at size 2,
  centers both rows against their batteries, places a smaller percent glyph
  alongside, and enlarges the reset line. Countdown-only changes invalidate
  reset text without repainting battery progress. Manual provider selection
  wakes the existing display loop immediately using collector-owned snapshots;
  explicit usage refresh still collects before waking the display.
- Bench evidence: VibeTV 14799300 on firmware 99.1.835 rendered revision 16 with
  zero reported render failures. The native Mac overview displayed the updated
  layout. App 99.1.836 sent Codex and Claude frames after 0.225 s and 0.413 s
  respectively in the API-to-device measurement; the user accepted this state.
  The final settings-button walkthrough was not completed because provider
  status checks temporarily hid its choices; no completed UI-click proof is
  claimed for that final measurement.
- Scope: The user explicitly requested local, unsigned candidate work and
  deferred signing. Full signed cold/warm update rehearsals remain a separate
  acceptance gate and are not claimed here. This records local validation and
  approval to push the PR branch, not approval to merge, release, or sign.

## 2026-09-08 — Integrate current main into PR #407

- User approval: Complete the authorized setup/Settings corrections and push PR #407.
- Result: Preserve the approved Cable/WiFi flow together with the #419 ThemeSpec capabilities and immediate provider selection now on main.
- Validation: Keep both countdown regression suites and await the hidden-network control after the asynchronous WiFi scan. This changes test synchronization, not the approved flow.

## 2026-09-08 — Require committed WiFi before closing Settings setup

- User approval: Finish the authorized PR #407 corrections and push.
- Approved customer-visible result: Retained Cable health during a mode transition does not close WiFi setup or stop discovery. Only a connected same-device snapshot with committed WiFi mode can finish it.
- Validation: Unit and browser regressions include the server grace-period snapshot with connected=true but no committed mode.

## 2026-09-08 — Keep status polling through Settings WiFi recovery

- User approval: Complete the authorized PR #407 setup/Settings fixes and push.
- Approved customer-visible result: An offline WiFi snapshot during an explicit Settings switch does not stop status polling. A later connected same-device WiFi status returns the user to Settings.
- Validation: The browser regression reproduces retained Cable health, offline WiFi and connected WiFi; it failed before the polling condition was corrected.

## 2026-09-08 — Await the failed Cable dialog in recovery tests

- User approval: Complete the authorized PR #407 CI/review corrections and push.
- Approved customer-visible result: The approved saved-WiFi recovery flow is unchanged. Its tests await the actual asynchronous failure dialog before closing it and choosing WiFi.
- Validation: Full UI unit suite; assertions still require reconnection to the same saved device. Tiny Office geometry tests use the existing zero default for optional y coordinates so standalone TypeScript validation also passes.

## 2026-09-08 — Show failed WiFi submissions in the existing form

- User approval: Paul authorized completing the setup/Settings fixes without further questions and pushing PR #407.
- Approved customer-visible result: If sending WiFi details fails, the existing form error line shows the failure and recovery instruction. Entered details remain available and Connect to WiFi can be retried; successful submission clears the error and shows the existing waiting state.
- Validation: Wizard regressions reject the submission, verify visible message/instruction and retained inputs, then successfully retry. No new control or screen.

## 2026-09-09 — Reuse the existing device installation screen

- User request: Cable theme installs and screensaver installs must show the existing WiFi installation screen with its progress bar; remove the separate plain-text status screen.
- Result: Both transports and both slots send the unchanged `installingThemeSpec`. Firmware renders that same spec and holds it between files; activation, failed uploads, or the bounded idle timeout restore the selected theme. WiFi screensaver installs restore the live theme before selecting the screensaver preview.
- Validation: Theme installer and Companion API suites pass. Cable tests compare the exact screen payload, including its progress primitive, before uploads in both slots; WiFi screensaver tests require installation and restoration before selection. Frame-render policy tests and firmware size budgets pass (484816 bytes).
- Local rehearsal: Mac App and firmware 9999.0.99 on device 5804508, USB /dev/cu.usbserial-11240. Device rendering telemetry confirms the existing install ThemeSpec and restoration after idle timeout for both slots. Native Mac UI completes Mini Classic, Tiny Office, and Token Fire installs. Final state: Tiny Office, brightness 75%, screensaver disabled. This run does not claim a physical-screen photograph or a WiFi hardware rehearsal.
- Candidate: Local arm64 DMG, no Developer ID signing or notarization. These are local changes on top of PR head 02a306c, not a release.

## 2026-09-09 — Brand neon for the VibeTV device title

- User request: Globally use the brandbook neon yellow for the VIBETV wordmark on the device instead of blue.
- Source: `vibetv-shopify-app/docs/vibetv-brandbook.md`, primary brand color `#CCFF00`.
- Result: The shared status renderer uses that color (RGB565 `0xCFE0`) for the title, covering boot, Cable/WiFi status, reset, update, error and missing-theme screens.
- Scope: Firmware-only color change; the existing install screen and Mac App are unchanged.
- Validation: Build and existing firmware size budgets pass; firmware 9999.0.100 flashed with verified hash on device 5804508. Boot health records the Cable setup screen.

## 2026-09-09 — Use saved pairing for startup

- User approved the central startup fix after comparing the wizard with Claude Design. Returning customers open Overview while their saved VibeTV reconnects; missing/rejected pairing and first setup remain in the wizard.
- Accept the Companion's configured offline device snapshot without marking it reachable or resetting recovery failure counts. Keep foreign-device rejection intact.
- Consolidate the two session entry flags into one. Wait for a successful saved-setup read and the display selection before deciding; the final live preview still owns completion of a fresh setup. Preserve the selected Cable candidate during connection and firmware checking.
- Validation: 108 focused unit tests; ten browser scenarios covering offline/connected startup, late status/display reads, rejected pairing, first setup, discovery, firmware update/failure, and a running-device outage. TypeScript passes.
- Native local candidate 9999.0.101 (02a306c-dirty), VibeTV 5804508 via Cable: Overview was visible while disconnected/not ready, then stayed open when Connected/Live arrived. Run setup again completed provider selection and display mode back to Overview with the existing tiny-office theme. No new firmware flash; device remains 9999.0.100. This is local unsigned validation, not a signed cold/warm release rehearsal. Pairing rejection and a genuinely fresh Mac were covered by fixtures, not reproduced physically in this round.


## 2026-09-09 — Remove the undesigned empty setup picker

- User approval: Paul reported an empty `Choose your VibeTV` screen before providers and explicitly requested the fix, then accepted the tested result with "ok passt jetzt. push erstmal den aktuellen stand." in task `01a07b46-26d4-7830-bc84-20a5c6d7eb85`.
- Approved customer-visible result: Claude Design's single-Cable route remains Welcome, connecting log with firmware check, providers, display mode, theme, live preview; errors use existing dialogs. Empty discovery keeps Welcome behind the recovery dialog instead of showing an empty device picker. The browser regression follows this approved state without changing the UI.
- A fresh successful Cable health response now proves connection independently of the first usage frame. Readiness still requires the existing rendered-frame gate; stale hello data cannot keep a disconnected device online after the bounded loss grace.
- Reuse the currently connected setup device when returning from providers and reset the existing connect sequence on Back. Remove the usage-wait override of discovery state. An unknown saved mode no longer silently means WiFi.
- Render the existing Welcome screen when there is no connection or selection to show. Preserve the completed connecting log until the next setup snapshot can advance. Remove the misleading automatic-connection fallback sentence; no new screen or timer.
- Candidate 9999.0.102 failed the native rehearsal: the user saw an empty picker and the completed log briefly returned to the chooser. It is superseded by 9999.0.103.
- Validation: Companion API suite passes, including fresh health without a frame followed by real connection loss; 127 focused component tests, TypeScript and twelve focused browser scenarios pass. Five new assertions failed before the transition correction. The Cable browser regression observes heading mutations throughout first connection and Back, rejecting even a transient empty picker.
- Native candidate 9999.0.103 (02a306c-dirty), built locally without Developer ID signing/notarization and installed from its matching DMG. Both native executable and helper match the mounted DMG byte for byte. Mac VibeTV/CodexBar state was cleaned, including `.codexbar` and CLI cookies/cache. Device 5804508 (MAC d8:bf:c0:58:91:dc, USB /dev/cu.usbserial-11240) was fully erased and reflashed with unchanged firmware 9999.0.100; prelaunch readback confirmed unpaired and theme-missing.
- Native visible proof: Welcome -> Connecting to VibeTV with firmware log -> providers. Back repeated the connect log, held its completed state, and returned to providers without the observed chooser flash. Provider selection, Automatic display mode, Tiny Office installation, live preview and Overview completed through the native UI. Final device readback: paired=true, connected=true, ready=true, healthy Cable stream, active theme `/themes/u/to-7-d7799cec.json`, hash `6b398ec9`, renderOk=true. This is Cable cold-start proof, not a physical-screen photograph, WiFi rehearsal or signed update rehearsal.
- DMG: `VibeTV-Control-Center-PR407-cold-fix-9999.0.103.dmg`, SHA-256 `5585e751b8e3497d784fe94c969818bcd30f09d73df2616ddebd5d86d0ebfc05`. Evidence is retained locally under `/tmp/CODEX-pr407-cold-20260909/cold-fix-103-*`.
- After a final Mac/device purge for an independent customer test, Paul confirmed "ok passt jetzt" and explicitly approved pushing this tested state to PR #407. Review remains deferred until the end of the requested work.

## 2026-09-10 — Align remaining setup recovery regression

- User approval: Paul requested green CI for PR #407 before the next independent cold/warm candidate test. The visible result remains the accepted 2026-09-09 result recorded above.
- Approved customer-visible result: Losing the device before first setup completes returns to the existing Welcome screen while no device can be selected. The theme chooser and Control Center navigation remain hidden. Only the stale browser assertion changes; product behavior is unchanged.

## 2026-09-10 — Wait for actual provider usage

- User approval: Paul requested a spinner on each enabled provider until actual CodexBar usage is available and approved implementation with "ok dann bau das so um". He clarified that one provider with real usage is sufficient, including 0%; other enabled providers need not be ready.
- Approved customer-visible result: Continue stays disabled until at least one enabled, healthy provider has a displayable reading in the same usage snapshot used by Display Mode. A provider with healthy status but missing usage keeps its spinner. Existing errors and their actions remain visible, and the provider switch remains usable except during its own save. A 0% reading is valid without a reset time or token history. The existing read-only poll updates the usage and provider list together.
- Validation: Unit and browser regressions cover health arriving before usage, a delayed real zero, other providers needing authentication, the available switch and the resulting Display Mode preview. Native candidate testing remains a separate customer check.

## 2026-09-10 — Provider recovery regression fixture

- User approval: The approved provider-usage gate above remains unchanged: one enabled provider with actual usage, including 0%, is sufficient.
- Approved customer-visible result: Repairing the usage service only unlocks Continue after the recovered provider supplies displayable usage. The browser fixture now delivers that reading after successful recovery instead of returning an empty usage list forever. Both recovery and delayed-zero browser scenarios pass; no product code changes in this follow-up.

## 2026-09-10 — App-first setup with WiFi available

- User approval: Paul approved "Download Mac App from app.vibetv.shop" on first power with WiFi setup available in the background, then the Cable/WiFi selector when the Mac App discovers the device: "ok dann bau das so".
- Approved customer-visible result: A single newly discovered Cable device offers both connection choices. WiFi can be provisioned over that cable without an existing WiFi discovery; the chooser says "Set up over Cable". Saved choices survive later starts. Fresh firmware shows only the Mac App address; it does not infer a connected Mac from power. After updating, older devices retain their settings and may switch in both directions.
- Legacy boundary: firmware 1.0.41/1.0.42 accepts serial display frames but lacks the new serial identity, pairing, and firmware-transfer protocol. Its existing first-update route remains WiFi. A separate first-update bootloader path is not implemented or claimed by this change.

## 2026-09-10 — Preserve WiFi-only production hardware

- User approval: Paul clarified that devices with identical old firmware exist both with and without working Cable data; WiFi-only devices must remain connected over WiFi.
- Approved customer-visible result: Settings asks for a data cable before switching. The app verifies the selected device over USB before turning WiFi off; without that identity, the existing WiFi connection and saved settings remain untouched. Firmware version or advertised USB protocol support alone never establishes physical Cable availability.


## 2026-09-10 — Mac App owns the first WiFi instructions

- User approval: Paul corrected the first-power screen: the entry on new firmware is always "Download Mac App"; when the Mac App finds no VibeTV over USB, it must guide WiFi setup.
- Approved customer-visible result: Fresh VibeTV shows "VIBE TV", "Download Mac App", and "app.vibetv.shop". Its setup access point starts in the background. After discovery finds neither USB nor an already configured WiFi device, the Mac App directly opens "Connect to WiFi" with phone setup instructions. Search errors retain their recovery message. Existing USB discoveries retain the Cable/WiFi selector, and existing WiFi devices remain connectable.


## 2026-09-10 — Count open setup networks as WiFi discoveries

- User approval: Paul explicitly requested that both an existing VibeTV on the local network and an open VibeTV-Setup network count as "1 VibeTV found", without "Setup required" or "Set up over Cable".
- Approved customer-visible result: The existing startup search also scans for open VibeTV-Setup networks through the native Mac App. Both kinds of WiFi discovery share the same found-count label. Cable/WiFi selection appears when both paths were found. An open setup network without USB leads to the WiFi instructions. No internet check is involved. macOS Location Services permission is requested solely for the network scan; denied scans remain errors, not zero discoveries.

## 2026-09-10 — Settings errors use the setup popup

- User approval: During the PR #407 physical matrix continuation, Paul approved showing the failed USB action, but explicitly rejected an inline banner: "ja, aber nicht so wie jetzt, sondern in nem pop up. error states sind ab jetzt immer pop ups. schau dir den setup wizard an, die siehste wie ich meine".
- Approved customer-visible result: Settings action and provider failures use the same `SetupStepFailedDialog` as the setup wizard. A single popup shows the existing error and recovery text; OK dismisses it. The saved connection and underlying controls remain available for retry. No new banner or parallel error-dialog component.
- Validation: 36 focused component tests cover dialog dismissal, preserved WiFi selection, USB retry, provider failures and one-dialog priority. The browser regression proves that healthy status polling cannot dismiss a failed USB action; the full customer smoke suite passed before the poll correction, and focused WiFi/status cases passed after it. Customer-copy and TypeScript checks pass. Native preview verification follows separately.

- User approval: The same 2026-09-10 popup instruction covers the shared setup-style error result verified in local build 117.
- Approved customer-visible result: Reserve space beside long dialog titles for the existing close button, so the error text does not touch it. No new control or copy.
- Native evidence: App 117 with device 14799300 / firmware 115, WiFi active. An exclusive USB-port test caused the real Settings action to fail; its popup remained visible across multiple healthy status polls and live Codex data returned behind it. The original WiFi choice and 20% brightness remained selected.
- Dialog dismissal: the shared error component now unmounts when dismissed instead of clearing its text during an exit animation. App 118 verifies the complete popup visually, title spacing, and removal of the dialog after OK. Intermittent window captures alone are not treated as evidence of a WebKit rendering defect.

## 2026-09-10 — Keep Cable available after a denied optional WiFi scan

- User approval: Paul explicitly requested fixing discovered matrix issues along the way and "error states sind ab jetzt immer pop ups ... schau dir den setup wizard an". This correction applies that instruction to the existing native-scan failure.
- Approved customer-visible result: A native setup-SSID scan failure retains the Cable devices already found by the Companion. The existing search error popup explains the denied scan; after dismissal, setup continues with the same discovered Cable identity. No new copy or control.
- Validation: the setup-entry browser regression covers a denied native scan, visible popup before any selection, dismissal, and exactly one selection of the expected Cable device. Existing WiFi-only denial still shows an error, and discovered LAN devices do not require a native SSID scan.

## 2026-09-10 — Reliable setup-style error display on the Mac

- User approval: Paul requested "error states sind ab jetzt immer pop ups" using the setup wizard as the reference. This follow-up fixes that requested popup being invisible during the real Mac test.
- Approved customer-visible result: The shared setup dialog appears immediately, without its enter/exit keyframe animation. Layout, blur, message, recovery text and controls remain the existing setup design. App 118 sometimes showed only the scrim; app 119 visibly passed two consecutive missing-USB failures, dismissal by OK and by Close, while the same WiFi device kept streaming with unchanged settings and boot ID.
- Test maintenance: failed Settings actions are acknowledged before the browser test navigates away. The retained timeout control is disabled when screensaver is off, matching the existing screen contract, rather than incorrectly expected to disappear.

## 2026-09-10 — Firmware update errors use the shared popup

- User approval: Paul instructed "error states sind ab jetzt immer pop ups" with the setup wizard as the reference, and requested fixing failures while completing the hardware matrix.
- Approved customer-visible result: Updates uses the same setup dialog for failed firmware jobs, preserving the existing error text, retry policy and report action. A failed update no longer shows an inline red banner or a completed progress bar. Dismissal survives repeated status polls for the same job; a new failed attempt opens its own popup.
- Evidence: App 119 installed from the local DMG rejected an intentionally wrong SHA-256 during artifact validation, before upload. Firmware 115, boot ID, saved settings and animation remained unchanged. The original inline error text overlapped its buttons, prompting this popup correction.
- Native validation: local DMG 120, device 14799300 / firmware 115, repeated invalid-hash rejection before upload. The shared Update failed popup rendered correctly and closed; unchanged boot ID/settings and increasing animation frames verified. Eleven DOM tests, focused firmware browser cases, TypeScript, lint and customer-copy checks pass.


## 2026-09-10 — Enforce animation-free popup dismissal

- User approval: Paul requested "error states sind ab jetzt immer pop ups" using the setup wizard as the reference, and fixing matrix issues along the way.
- Approved customer-visible result: The shared popup remains immediately visible and closes immediately. An inline animation override enforces the already-approved absence of enter/exit keyframes despite inherited stylesheet ordering; layout, text and controls stay the same.
- Validation: A browser regression checks computed animation names for both open and closed states against the actual production stylesheet.


## 2026-09-10 — Provider-result errors use the shared popup

- User approval: Paul explicitly directed "error states sind ab jetzt immer pop ups. schau dir den setup wizard an" and requested fixing issues found while completing the matrix. This applies that standing presentation instruction to the real OpenAI provider failure observed in setup; the provider-owned message is unchanged.
- Approved customer-visible result: Provider-result failures appear in the existing setup-style popup, titled with the existing provider name and containing the exact CodexBar guidance. OK/Close dismiss it; Copy provider message remains available there. The row retains its on/off switch and retry, and an error icon reopens its message. Only one provider popup appears at a time. Polling does not reopen acknowledged messages; explicit retry can show the result again. The shared provider list gives Setup and Settings the same behavior.
- Validation: Focused tests cover dismissal through polling, exact message preservation, retry of the same error, provider disable, queued failures and the existing one-ready-provider/zero-usage gates. Native quick-DMG123 confirms the real OpenAI failure popup in both Setup and Settings, OK/Close dismissal, retry of the same error, disabling OpenAI and continuing through Manual Codex to Overview Live on device14799300/fw115. No signing.

## 2026-09-10 — Keep WiFi setup failures and recovery visible

- User approval: The explicit instruction “error states sind ab jetzt immer pop ups” applies to these existing setup error states.
- Approved customer-visible result: WiFi selection, scan, credential and timeout errors use one existing setup-style popup, titled “WiFi setup failed”. OK/Close dismisses it without clearing the entered network or password. A failed selection or expired Cable-free wait restores the discovery recovery actions. Existing API error and recovery text is preserved; no inline WiFi banner remains.
- Validation: Both review findings are reproduced in component tests. The suite verifies rejection from the mode chooser and not-found recovery, repeat attempts, one visible dialog, timeout search termination and recovery after dismissal. The complete 630-test unit suite, TypeScript, focused lint and customer-copy guard pass. All 19 setup-entry browser flows pass, including rejected connection selection and credential submission for single- and multi-device setup; the popup screenshot was visually inspected. The Mac is currently locked, so native candidate proof remains pending.

## 2026-09-11 — Select the device before its connection method

- User approval: The user explicitly instructed Codex in this task to continue
  every matrix case and fix discovered issues along the way, without further
  implementation approval questions.
- Approved customer-visible result: When Cable and WiFi identify different
  VibeTVs, setup uses the existing device list. Selecting the WiFi device connects
  that identity; selecting the Cable device offers only its available paths.
  Two paths to the same device retain the existing connection-method chooser.
  Mixed results use the neutral count `2 VibeTVs found.` instead of claiming
  that the Cable device was found on WiFi. The existing list component is reused.
- Approved files: `setup-connection.ts`, `setup-device-screen.tsx`, matching setup unit/browser tests,
  and this approval record.

## 2026-09-11 — Preserve the approved device list with multiple Cables

- User approval: The standing instruction to fix discovered core-flow issues and the preceding device-before-transport approval apply to this correction of the same selection result.
- Approved customer-visible result: The existing mixed-device list retains a distinct WiFi VibeTV even when two Cable devices are present. Its existing count reflects all three identities; selecting the WiFi device connects only that device. No new control, layout or wording.
- Validation: The previous two-device identity test now covers one and two Cable devices; the browser regression uses two Cables plus one WiFi device and rejects any Cable mode write.

## 2026-09-11 — Theme recovery uses the approved error popup

- User approval: Paul explicitly instructed “error states sind ab jetzt immer pop ups” using the setup wizard as the reference, and requested fixing issues discovered in the core cases.
- Approved customer-visible result: Theme-install failures use the shared setup error popup with the existing failure text and Try again. Closing the popup preserves a retry action in the theme row; polling does not reopen the dismissed failure. A theme that was written but failed rendering can be retried on the connected paired device. Recovery guidance points to reinstalling the theme instead of a nonexistent Reload image control.
- Validation: Regression tests cover missing render proof, a reported-active but unready Cable theme, popup dismissal, polling, one retry and a later failure. Browser tests check popup, dismissal, retry and unchanged successful progress.


## 2026-09-12 — Remove nearby setup-network discovery and location permission

- User approval: Paul rejected the location permission and explicitly requested removing open VibeTV-Setup network discovery: “dann bau das so um ... ausschließlich code wegnehmen”. USB users finish setup by Cable and can switch to WiFi later in Settings; existing retry and manual-IP dialogs are sufficient.
- Approved customer-visible result: The Mac App discovers USB devices and devices already reachable on the local network. A USB-only device connects directly; only two discovered paths to the same device show the existing Cable/WiFi chooser. Nearby setup access points are no longer counted and no location permission or scan-error popup is requested. Existing phone instructions, retry, manual IP and Settings WiFi setup remain. No new UI element. This supersedes the September 10 approval for native setup-SSID scanning.
- Regression correction: Discovery of an existing LAN path exposed premature connection while the WiFi mode request was still pending. The existing waiting screen now distinguishes the pending selection internally and begins discovery/connection only after the request succeeds; rejected choices remain retryable. No new UI.


## 2026-09-12 — Require a valid preview before leaving setup

- User approval: Paul reported the candidate opening Overview without a preview after exchanging VibeTVs and explicitly required: “ich darf niemals den wizard verlassen, wenn es keine gültige preview gibt”.
- Approved customer-visible result: Saved pairing, provider and display choices cannot bypass the wizard on launch. The existing final preview step releases the Control Center only with a rendered theme/frame and a currently connected, ready VibeTV. Losing readiness or changing devices cancels the pending handover. After a successful handover, transient outages preserve the open Control Center. Existing choices are reused; no new UI element.
- Supersedes the earlier saved-setup shortcut that admitted a configured offline device directly to Overview.


## 2026-09-12 — Apply the preview requirement to Settings WiFi setup

- User approval: Paul's current requirement “ich darf niemals den wizard verlassen, wenn es keine gültige preview gibt” applies to every entry into the existing wizard, including the WiFi switch from Settings.
- Approved customer-visible result: Opening that WiFi wizard clears the previous handover. A confirmed WiFi status alone cannot return to Settings; the existing live preview must render while the selected VibeTV is connected and ready. Browser fixtures for previously admitted sessions establish a valid preview before simulating later outages, and Theme Studio fixtures provide matching active render packs.


## 2026-09-12 — Preserve progress while waiting for the required preview

- User approval: Paul's current instruction “ich darf niemals den wizard verlassen, wenn es keine gültige preview gibt” requires retaining setup during first-frame waits, including after WiFi verification, and when reopening an unfinished installation.
- Approved customer-visible result: A verified Cable or WiFi connection advances to the existing preview wait without repeating connection or firmware writes. Running firmware and theme jobs restored on launch show their existing progress log inside the wizard; they cannot bypass preview admission or start a second install. Browser regressions replace the superseded saved-setup shortcut with the required no-preview boundary.

## 2026-09-12 — Validate the accepted preview gate in Theme Studio

- User approval: Paul confirmed the candidate with “top, passt” and explicitly requested pushing this state, fixing valid review/CI findings and repeating the review loop. His requirement “ich darf niemals den wizard verlassen, wenn es keine gültige preview gibt” remains the approved visible result.
- Approved customer-visible result: The accepted preview gate is unchanged. The Screensaver browser fixture now supplies the tracked active Clippy render pack with a matching device path before navigating out of setup. The UI principles now document the already approved preview requirement for every launch and Settings WiFi setup instead of the superseded saved-setup shortcut.
- Validation: The complete Theme Studio safety browser suite passed. This correction changes only test data and documentation; no app, firmware, layout or copy changes.

## 2026-09-12 — Recover missing previews and bind Cable frames to identity

- User approval: Paul accepted the candidate, required that the wizard never finish without a valid preview, and explicitly instructed Codex to fix legitimate Bug Detector findings and repeat the push/review loop without further confirmation. Both current findings affect that exact setup requirement.
- Approved customer-visible result: Selecting another Cable VibeTV waits for a frame acknowledged by that device; the previous device's cached picture cannot admit setup. The existing Back control on the final preview returns to the existing theme selection, allowing replacement of a custom theme whose local preview was lost after purging the Mac. Installation errors retain the normal retry flow; successful installation still requires a valid preview before admission. No automatic theme or firmware write is added.
- Validation: New regressions cover foreign/missing/matching Cable frame identities in status, the frame endpoint and preview admission. The browser flow starts with an irretrievable custom theme, returns to the catalog, installs a theme once and enters Control Center only after its preview renders. The existing parent-owned theme-choice state handles recovery.

## 2026-09-09 — Windows token-history unavailable state

- User approval: Marcus requested iterative VM QA and direct fixes: "Ja gut, dann kannst du ja jetzt selber iterativ testen, also QA machen und dann auch direkt fixen. Ja, leg mal los."
- Approved customer-visible result: Fix the reported indefinitely loading token history. A completed scan without complete local history shows "Token history is unavailable" with the existing Refresh action, while available quota windows remain visible. Do not replace missing history with zero consumption. This records the implementation scope; final visual acceptance is still pending.

### 2026-09-09 — Final Windows token-history visual acceptance

- User approval: Marcus answered "ja" when asked whether the linked final Usage screenshot (`outputs/qa-9e4f4ab/usage-2.png` in the Windows QA workspace) was acceptable. The screenshot was captured from installed build `9e4f4ab6a85147aa119a1875b6d4eee1c20e2c0d` in the Windows VM.
- Approved customer-visible result: The Usage screen displays "Token history is unavailable" and "Complete local token history is not available for every selected provider. Available usage limits are shown below." with the existing Refresh button. Available provider quota cards remain visible; incomplete token history is not represented as a complete zero or combined total. This supersedes the pending visual acceptance above.
- Approved files: `apps/control-center/src/components/usage-screen.tsx` and `apps/control-center/src/components/usage-screen.test.tsx` at the reviewed build.
- Scope: Approval of this visible result only; it does not approve unrelated Session-limit semantics, provider defaults, a push, merge, release, or hardware changes.

## 2026-09-09 — Windows first-run provider selection is opt-in

- User approval: Marcus answered "leg los" to the proposal that fresh Windows installations start with all providers off and the customer enables their provider, while existing settings remain unchanged.
- Approved customer-visible result: No provider is preselected when Windows has no CodexBar settings yet. Customers enable their providers using the existing controls. Previously saved selections are preserved; unavailable credentials do not silently change a selection.
- Scope: Windows configuration bootstrap and its regression coverage, using the existing UI. No provider-specific detection, authentication changes, macOS default changes, push, merge, release, or hardware changes are approved by this entry.

## 2026-09-17 — Windows Claude browser sign-in row

- User approval: Marcus answered "Ja trag das so ein" to the described provider row for the case where Claude on Windows needs a signed-in claude.ai browser session (Claude Code is signed in, but Anthropic refuses the OAuth usage endpoint and no browser cookies are readable). He asked to test it himself on the Windows laptop before the review round.
- Approved customer-visible result: On the setup provider step (and the same row in Settings), a provider whose usage service reports a browser sign-in shows the guidance "Claude usage needs a signed-in claude.ai session in your browser. Sign in to claude.ai in your browser, close the browser, then check again." with an "Open Claude sign-in in your browser" action next to the existing "Check again" action and the on/off switch. Opening the page starts automatic re-checks every 15 seconds for at most three minutes, until the row leaves the browser-sign-in state. No other row state, copy, or control changes.
- Scope: Files `apps/control-center/src/components/setup/setup-provider-row.tsx`, `setup-provider-row.test.tsx`, `setup-providers-screen.tsx`, `setup-wizard.tsx`, `provider-picker.tsx`, `settings-screen.tsx`, `control-center-app.tsx`, and `control-center-types.ts` on PR #447. The sign-in page and the diagnosis come from the bundled usage service (VibeTV Win-CodexBar fork); the app keeps no provider table. This approves the visible result and the push to the PR branch only, not merge, release, or signing.

## 2026-09-17 — Sign-in button for a signed-out provider, and the four offered providers

- User approval: Marcus tested the fresh-customer journey on the Windows laptop with Codex and Claude signed out, saw the usage service's developer text ("Provider not installed: Codex auth.json not found. Run codex login…", "Claude usage failed from all configured sources…") and asked for a customer-facing sentence with a button that starts the sign-in ("noch geiler wäre, wenn irgendwie ein Button da wäre … Sign In … da klick ich drauf und dann am liebsten öffnet sich dann schon irgendwie ein Login-Screen"), and to offer only Codex, Claude, Antigravity and Cursor for the start ("ich will für den start auch erstmal nur codex claude antigravity und cursor anbieten"). He answered "leg los" to the described implementation.
- Approved customer-visible result: On the setup provider step and in Settings, a provider whose tool is not signed in (`auth_required`, `setup_required`) shows "<Provider> is not signed in on this computer" with a "Sign in to <Provider>" button, the existing copy action (which still copies the usage service's own message) and "Check again". Pressing the button starts the provider's own sign-in through the Companion: `codex login` or `claude auth login` in a visible terminal window (the tool opens the browser itself), the Cursor or Antigravity app when installed, or the official install page when nothing is installed. Afterwards the row re-checks itself every 15 seconds for at most three minutes, as it already did after the browser sign-in page. The provider list in setup and Settings shows only Codex, Claude, Cursor and Antigravity; other providers keep their saved values in the usage service but are not listed.
- Scope: `apps/control-center/src/components/setup/setup-provider-row.tsx`, `setup-providers-screen.tsx`, `settings-screen.tsx`, `control-center-app.tsx`, their tests, `apps/control-center/scripts/test-customer-flows.mjs`, and the Companion's `/v1/providers/sign-in` (`companion/internal/companionapi/provider_sign_in_launch.go`, `provider_setup.go`, `childproc`). This approves the visible result and the push to the PR branch after Marcus's own laptop test only, not merge, release, or signing.

## 2026-09-17 — The Mac app stays exactly as it is today

- User approval: After testing the sign-in flow on the Windows laptop, Marcus asked what a Mac test would mean and then instructed that this release must not change the Mac app at all, including its available providers: "alles in diesem Release darf eigentlich die komplette Mac-App nicht ändern, auch nicht die verfügbaren Provider. Also die Mac-App muss genauso wie sie heute ist weiter funktionieren." He then chose to keep the whole feature Windows-only: "Nein, lass das alles strikt unter Windows."
- Approved customer-visible result: The shortened provider list (Codex, Claude, Cursor, Antigravity) and the "Sign in to <Provider>" button are shown only by the Windows shell. On macOS the setup provider step and Settings keep every provider the usage service reports and keep exactly the rows, copy and actions they show today; a signed-out provider there still shows the usage service's own message with the existing copy and "Check again" actions and no sign-in button. The Companion decides this from the platform it runs on and reports it as `companion.features.providerSignInEnabled`; the app never infers it from the user agent.
- Scope: `companion/internal/companionapi/server.go`, `provider_sign_in_launch.go` and their tests, `apps/control-center/src/components/control-center-app.tsx`, `control-center-types.ts`, `settings-screen.tsx`, `settings-screen.test.tsx` and `apps/control-center/scripts/test-customer-flows.mjs` on PR #447. This approves the visible result and the push to the PR branch only, not merge, release, or signing.

## 2026-09-18 — A provider the customer switched on keeps its row on Windows

- User approval: After the review of PR #447 reported that the shortened Windows list can hide a provider the customer had already switched on, Marcus was shown the customer consequence (the hidden provider keeps its switch on, the Automatic display is then refused as incomplete, and the customer cannot reach the next step or switch that provider off) and answered "ja mach wie du es empfiehlst".
- Approved customer-visible result: On Windows, the provider list in setup and Settings shows Codex, Claude, Cursor and Antigravity, plus any other provider that is currently switched on, so every switched-on provider always has a row with its on/off switch. Once the customer switches such a provider off it leaves the list. Nothing else changes: no new copy, control, row state or ordering, and switched-off providers outside the four stay unlisted as approved on 2026-09-17.
- Scope: `apps/control-center/src/components/setup/setup-providers-screen.tsx` and the tests `setup-providers-screen.test.tsx` and `settings-screen.test.tsx` on PR #447. This follows the setup-flow rule that every provider row keeps its on/off switch, because a provider that cannot be switched off cannot be kept off the display. macOS is untouched: it does not shorten the list at all. This approves the visible result and the push to the PR branch only, not merge, release, or signing.

## 2026-09-18 — No sign-in button where no sign-in can be started

- User approval: Marcus approved working through the review findings on his own judgement ("ja mach wie du es empfiehlst"). The review then showed that the entry above had created a button that can only fail, and this is the narrow correction of that same approved result.
- Approved customer-visible result: A provider that is listed only because the customer had switched it on shows its switch, its own message and "Check again", but no "Sign in to <Provider>" button, because VibeTV has no sign-in it could start for it. The four offered providers keep the button exactly as approved on 2026-09-17, and any provider whose usage service names a browser sign-in page keeps its button too.
- Scope: `apps/control-center/src/components/setup/setup-providers-screen.tsx` and `setup-providers-screen.test.tsx` on PR #447. macOS is untouched: it shows no sign-in button at all. This approves the visible result and the push to the PR branch only, not merge, release, or signing.

## 2026-09-18 — The Mac keeps the provider's own message on a signed-out row

- User approval: This restores the standing instruction Marcus gave on 2026-09-17, that this release must not change the Mac app at all ("alles in diesem Release darf eigentlich die komplette Mac-App nicht ändern"), after the review found that a signed-out row on macOS had started showing the new Windows sentence.
- Approved customer-visible result: Our shorter sentence "<Provider> is not signed in on this computer" appears only on a row that also carries the "Sign in to <Provider>" button. Every row without that button, which is every row on macOS, keeps the usage service's own message with the existing copy and "Check again" actions exactly as it shows today.
- Scope: `apps/control-center/src/components/setup/setup-provider-row.tsx` and `setup-provider-row.test.tsx` on PR #447. Verified by the full control-center customer flow run, which still shows the Windows sentence and button on the rows that have the sign-in action. This approves the visible result and the push to the PR branch only, not merge, release, or signing.

## 2026-09-14 — Firmware update completion and first-theme onboarding (#445)

- User approval: Marcus tested the installed candidate from PR #445 at
  `e3d628bd4cae7c6349c499d43047356891a05def`, confirmed "ok hat geklappt",
  repeated the fresh setup, and then explicitly requested "ne nur den
  getstetet firmware fix mergen". His approval is limited to the tested
  firmware-update behavior; the separate provider-readiness checking problem
  observed during the repeated test remains open and is not covered here.
- Approved customer-visible result: Firmware updates stop waiting when their
  actual result is known. Successful updates continue first-time setup even
  when the device has no theme yet. A result requiring attention ends the
  busy state and shows the existing support/report recovery instead of
  waiting until a misleading timeout or starting a second firmware upload.
  Existing theme-loss and render failures remain actionable. No provider
  selection behavior, theme design, or unrelated UI is changed.
- Evidence: The signed candidate 9999.0.99 (run 34848902448) replaced the old
  Mac App through its customer update flow. Device 16201042 updated from
  1.0.41 to the candidate and reported firmware, health, stream, and render
  verification complete; its stored Clippy theme was restored automatically.
  Marcus then tested first-theme onboarding using the same PR App after
  firmware 1.0.41, empty theme assets, WLAN reset, and clean Mac state were
  established. The app reached provider selection on firmware 1.0.42;
  the separately observed provider-check refusal is not claimed fixed.
- Approved files: The firmware polling and setup changes in
  `control-center-app.tsx`, `setup-connect.ts`, `setup-firmware-dialogs.tsx`,
  `setup-wizard.tsx`, their regression tests, and `test-customer-flows.mjs`.
- Scope: Approval to merge this firmware fix only. No production release,
  new firmware flash, provider fix, or additional feature is authorized.

## 2026-09-14 — Repair the blocking test checks for #445

- User approval: Marcus explicitly requested "Und ja behebe vorher die
  Probleme" after the repeated CI failure and broken local static test were
  reported. This authorizes repairing those checks, not the provider issue.
- Approved customer-visible result: No new customer-visible change. The
  firmware onboarding behavior tested and approved above remains unchanged.
  The browser fixture now returns the Companion's actual device-not-found
  API response instead of simulating loss of the Companion connection.
  The same assertions still require setup to stay incomplete until device
  confirmation and prohibit a second theme installation.
- Scope: Test fixtures, focused test coverage, shell syntax failure detection,
  and checking the currently catalogued screensaver archive. No additional
  product, provider, firmware, installation, or release change is included.

## 2026-09-15 — Merge the firmware onboarding fix from main into PR #407

- User approval: Paul explicitly requested “merge main in pr 407, dann wieder bug detector + ci fixen until green”. This authorizes integrating main and fixing resulting review/CI regressions on the PR branch.
- Approved customer-visible result: Preserve the required matching live preview before leaving the wizard while retaining main's completed firmware-update and attention handling. Fresh devices without an installed theme can continue setup after a verified firmware update; loss of an existing theme remains visible. Cable reads its baseline over USB and WiFi over HTTP, then both apply the same existing theme-verification rule. Attention never starts another automatic firmware upload.
- Validation: Both sides' wizard/browser regressions are retained. The main firmware-onboarding table now runs for Cable and WiFi, with Cable requests forbidden from contacting the saved WiFi target. No device write, new candidate installation, main-branch merge or release is authorized by this integration.

## 2026-09-18 — app.vibetv.shop offers the download for the system the customer is on

- User approval: Marcus was shown the exact screen sketch for the hosted download page — "Welcome to / VIBETV CONTROL CENTER / Get the app, then it takes you through the rest.", one large "Download for Windows" button for the recognised system, the numbered install steps below it, and a quiet text link "Using a Mac? Download for macOS" — and answered "Okay, das klingt sehr gut".
- Approved customer-visible result: The hosted setup page at app.vibetv.shop recognises the customer's system and offers one primary download for it. On macOS nothing changes at all: the same "Get the Mac App, then it takes you through the rest." subtitle, the same single "Download" button for the verified DMG, the same three DMG install steps, and the same "The signed download is not ready yet. Please try again later." state when no DMG is published. On Windows the page shows a single "Download for Windows" button for the verified installer, the steps "Open the downloaded installer.", "Confirm the installation and wait for it to finish.", "Open VibeTV Control Center from the Start menu.", an honest note that Windows may warn about an unknown publisher because the installer is not signed yet, and a quiet text link "Using a Mac? Download for macOS". When no Windows installer is published, the Windows button shows the existing disabled "not ready yet" state instead of a dead link. When the browser reports no usable system, the page offers macOS and, only if it is actually published, Windows.
- Scope: `apps/control-center/src/components/setup/mac-app-download-screen.tsx`, `apps/control-center/src/lib/customer-platform.ts`, `apps/control-center/src/lib/companion-release.ts`, `apps/control-center/src/app/api/companion/latest/route.ts`, `apps/control-center/src/components/control-center-app.tsx` and their tests. The Windows installer goes through the same GitHub asset verification as the DMG and stays behind its own feature flag `CONTROL_CENTER_ENABLE_WINDOWS_APP_SETUP_DOWNLOAD`. The Mac path, its copy and its behaviour are unchanged and covered by regression tests. This approves the visible result and the push to the PR branch only, not merge, release, or signing.

### 2026-09-18 — Customer flow coverage for the same download page

- User approval: This adds no new visible result. It is the test coverage for the screen Marcus approved above with "Okay, das klingt sehr gut", after CI showed that the existing hosted-download flow checks only passed by accident of the runner's own operating system.
- Approved customer-visible result: Unchanged from the entry above. The customer flow run now states the customer's system explicitly instead of inheriting it from the machine running the test, so the Mac checks really check the Mac screen, and a new check covers the Windows screen: the disabled "Download for Windows" button while no installer is published, the Windows install steps instead of the DMG steps, and the quiet "Using a Mac? Download for macOS" link pointing at the verified DMG.
- Scope: `apps/control-center/scripts/test-customer-flows.mjs` only. No product code, copy, control or state changes with this entry. Verified by a full local `npm run test:customer-flows` run. This approves the push to the PR branch only, not merge, release, or signing.

## 2026-09-18 — The Windows download no longer announces an unknown publisher

- User approval: After the Windows download was switched live on app.vibetv.shop, the rendered Windows screen still carried the note "Windows may warn that the publisher is unknown, because this installer is not signed yet. Choose More info, then Run anyway." The installer in v1.0.58 is signed — the shipped `VibeTV-Control-Center-Setup.exe` carries an Authenticode certificate table naming `O=DreamyTales GmbH, CN=DreamyTales GmbH` (issuer `Microsoft ID Verified CS AOC CA 03`, Azure Trusted Signing) — so the note is no longer true. Paul was shown the live screen and the signature evidence and answered "ja, nimm den Absatz raus und mach den PR".
- Approved customer-visible result: On the Windows download screen the paragraph about an unknown publisher is gone. Everything else on that screen is unchanged: the same "Get the app, then it takes you through the rest." subtitle, the same single "Download for Windows" button for the verified installer, the same three install steps, and the same quiet "Using a Mac? Download for macOS" link. The macOS screen, the unknown-system screen, and the disabled "not ready yet" state are untouched.
- Scope: `apps/control-center/src/components/setup/mac-app-download-screen.tsx` and its test, plus this approval record. No copy, control, state, flag, or release behaviour changes beyond removing the paragraph. The removed regression test asserted the false claim and is deleted rather than inverted. This approves the visible result and the push to the PR branch only, not merge, release, or signing.

## 2026-09-19 — Fix the recurring Claude sign-in dialog in PR #407

- User approval: After the remaining Claude-dialog UI failure was reported, Marcus explicitly requested "Ok kannst du den Fehler noch Fixen?". This entry records that narrow bug-fix request.
- Approved customer-visible result: Starting provider sign-in does not immediately reopen the same error message the customer already acknowledged. New or changed errors still appear, and an explicit Check again can show the result again. Existing labels, layout, sign-in requests, and background checks are unchanged.
- Scope: Remove the dismissal reset from the shared provider list's sign-in handler and add regression coverage. PR-branch fix only; no merge, release, installation, or device operation.

### 2026-09-19 — Preserve the approved Windows copy when integrating main

- User approval: The Windows-copy removal is covered by Paul's explicit approval recorded above for PR #462; the Claude-dialog correction is covered by Marcus's bug-fix request above. This integration introduces no further visible result.
- Approved customer-visible result: Retain both approved outcomes: the Windows download omits the obsolete unsigned-publisher warning, and starting sign-in leaves an acknowledged provider error dismissed. The shared approval-log conflict is resolved without dropping either record.
- Scope: Integrate main commit `e5529c23` into PR #407 and retain its existing copy/test deletion unchanged. No merge into main, release, installation, or device operation.

### 2026-09-19 — Provider dialog regression coverage

- User approval: Covered by the Claude-dialog bug-fix request above; this is test-only follow-up, with no additional visible change.
- Approved customer-visible result: Unchanged. Provider errors show their original message and copy action in the existing dismissible dialog; sign-in and retry remain on the provider row after dismissal.
- Scope: Update the stale provider-readiness browser assertions that still expected inline error text, and include those cases in the focused provider-settings suite. No production behavior changes.

## 2026-09-19 — Recover when only the other connection mode is found

- User approval: Marcus answered "Ja" to the explicit proposal to show the existing reconnection dialog instead of searching indefinitely, with "Use the cable", WiFi setup, and retry, and no automatic connection-mode switch.
- Approved customer-visible result: When a completed device search finds only a device on the other transport, the saved connection mode shows the existing device-not-found recovery dialog. The customer can explicitly choose the available cable connection, configure WiFi, or search again. Existing dialog copy and layout are unchanged; no connection is made automatically.
- Scope: `apps/control-center/src/components/setup/setup-wizard.tsx`, its regression tests, and this approval record. This approves the recovery behavior and fix preparation only, not a main-branch merge, release workflow, or publication.

### 2026-09-19 — Complete the same explicit recovery for discovered WiFi

- User approval: Covered by Marcus's "Ja" to the existing recovery dialog and no automatic transport switch above. This closes the reverse-direction recovery gap identified in review, without adding controls or changing copy.
- Approved customer-visible result: After the customer chooses WiFi recovery, an already discovered WiFi device follows the existing device-selection path instead of trying to provision an absent cable device. Multiple devices still require selection; no device connects before the recovery action.
- Scope: The same setup-wizard handler and regression tests only. No merge, release workflow, or publication.

### 2026-09-19 — Preserve recovery after a selected cable device disappears

- User approval: Same explicitly approved recovery behavior above; review regression coverage only extends the sequence leading into it.
- Approved customer-visible result: A stale selection of a disconnected cable device does not hide WiFi devices found by the next scan. Explicit WiFi recovery returns to the existing device picker, and another identity still requires its own Connect action.
- Scope: Clear the stale candidate filter in the existing WiFi recovery branch and test the failed-cable-to-WiFi sequence. No new controls, copy, merge, or release.

## 2026-09-17 — Idle reset text and rate-limited provider check (#448)

- User approval: Marcus forwarded customer Bernd's report that his new VibeTV
  shows `Resets in Reset unavailable` on the Claude theme at 0 % session usage,
  and that the Claude provider check failed repeatedly during setup with
  cookie, timeout, and too-many-requests errors. After both visible results
  were presented for review, Marcus approved them with "ja".
- Approved customer-visible result: A usage slot whose countdown is unknown no
  longer produces a doubled sentence. A line whose only substituted value is
  that countdown collapses to `Reset unavailable` instead of
  `Resets in Reset unavailable`. Slots with a real deadline keep rendering the
  full sentence, for example `Resets in 4d 0h`, and lines that also carry a
  label or percentage keep substituting in place. During setup, a provider that
  answers with a rate limit now reports "Claude is limiting usage checks right
  now." with "Wait a few minutes, then check again. Nothing needs to be fixed."
  instead of the previous "The usage service could not read this provider." and
  "Repair the usage service." No theme design, provider selection flow, or
  unrelated UI is changed.
- Evidence: The new native ThemeSpec renderer test reproduces the customer
  string exactly; with the fix disabled it fails with
  `Expected 'Reset unavailable' Was 'Resets in Reset unavailable'`. 147/147
  native renderer tests, 541/541 Control Center tests, the companion codexbar,
  companionapi, and protocol packages, customer-copy, customer-docs,
  frame-render-policy, and theme-pack checks pass. The ESP8266 cross build is
  left to CI because the xtensa toolchain cannot run on this Mac, and no
  hardware test with an idle Claude session is claimed.
- Approved files: The renderer rule in `theme_spec_renderer_core.h`, its mirror
  in `live-vibetv-preview.tsx`, the rate-limit status in
  `setup-provider-row.tsx` and `control-center-types.ts`, the companion
  provider-setup and preferences mapping, their regression tests, and this
  approval record.
- Scope: Approval covers this fix and pushing the PR branch. No release, no
  firmware flash for the customer, and no Fable credit display is included.

## 2026-09-17 — Codex review follow-up for #448

- User approval: Marcus approved the two visible results above with "ja" and
  asked for the fix to be carried through. The automated Codex review on PR
  #449 then found that the same approved results were not actually reached on
  every path; repairing those paths is part of delivering what he approved and
  changes no promise made to him.
- Approved customer-visible result: Unchanged from the entry above, now also
  reached where it previously was not. A theme written with the compact tokens
  `{us1r}` or `{pv1r}` collapses to `Reset unavailable` like the long token
  names, so devices on those themes stop showing the doubled sentence. A
  provider-scoped check that answers with a rate limit keeps telling the
  customer to wait instead of claiming the account exposes no usage. A sign-in
  failure that merely names rate-limit data still asks the customer to sign in
  rather than to wait.
- Evidence: The new native test fails with
  `Expected 'Reset unavailable' Was 'Resets in Reset unavailable'` when the
  compact-alias rule is removed and passes with it; 148/148 native renderer
  tests pass. The companion codexbar and companionapi packages pass uncached
  with the two new regression tests. No hardware test is claimed.
- Approved files: The compact-alias rule in `theme_spec_renderer_core.h`, the
  throttling matcher and stand-in translation in `provider_setup.go`, their
  regression tests, and this approval record.
- Scope: Corrections to the already approved fix only. No new customer-visible
  behavior, no release, and no firmware flash is included.

## 2026-09-21 — Idle countdown reads as idle, not as a fault (#448)

- User approval: Marcus asked for issue #448 to be worked to a solution and
  fully tested ("bitte arbeite an einer lösung für dieses issue. und teste es
  komplett durch"). The issue's own acceptance criteria require that a session
  at 0 % with no deadline "must not look like an error"; the previously
  approved collapse removed the doubled sentence but still showed the error
  wording, so this completes what was approved rather than changing it.
- Approved customer-visible result: A usage window that is current and measured
  but has no reset time at all now reads `No active session` instead of
  `Reset unavailable`. On the Claude theme with an idle session the bottom
  line therefore reads `No active session` where it previously read
  `Resets in Reset unavailable` and then `Reset unavailable`. A line that
  also carries a label renders `Session No active session`. Nothing else
  changes: a countdown the device cannot stand behind (stale basis, offline
  beyond the trust horizon, usage unreadable) keeps `Reset unavailable`, a
  countdown that merely ran out keeps `Reset unavailable` until the next frame
  carries the new deadline, and one line binding both an idle and an
  untrustworthy countdown keeps `Reset unavailable`. Windows with a real
  deadline still render `Resets in 4d 0h`. No theme design, layout, provider
  flow, or setup copy is changed, and both strings are 17 characters so no
  shipped lane changes its fitted font size.
- Evidence: 152/152 native ThemeSpec renderer tests, including a new test that
  feeds the customer's exact wire frame (Claude, session 0 % with no
  `resetSecs`, weekly with one) and asserts the session window is read as idle
  while the weekly one keeps counting down, and asserts that past the trust
  horizon nothing is idle any more. 543/543 Control Center tests, including new
  tests separating an idle window from a countdown that ran out and from a
  mixed line. No hardware test with an idle Claude account is claimed.
- Approved files: The idle window state in `theme_spec_renderer_core.h` and
  `codexbar_display_core.h`, its frame wiring in
  `renderer_esp8266_theme_spec.cpp`, its mirror in `live-vibetv-preview.tsx`,
  the renderer and theme-pack tests, the protocol and theme-guide notes, and
  this approval record.
- Scope: This wording fix only. No release, no firmware flash for a customer,
  and no change to the stale/offline trust path.

## 2026-09-21 — A discontinued Gemini account stops offering a sign-in

- User approval: Marcus selected issue #425 as one of the three P1 issues to implement in this batch and instructed Codex to work autonomously until each fix was ready. Codex reported the exact visible consequence before the change: Google discontinued the Gemini consumer tier, the stored credential is still valid, and the row therefore offered "Sign in to Gemini" above guidance explaining that signing in cannot help, so every attempt ended on the same refusal.
- Approved customer-visible result: When the usage service reports that the provider no longer supports this account, the provider row shows the provider's own end-of-support message and keeps only its on/off switch. The sign-in button and the Check again action are gone, because neither can resolve the state, and turning the provider off is how the customer moves on. Antigravity remains offered beside it. Every other provider state is unchanged: a signed-out Gemini still shows its sign-in, an unrelated error still shows its message with Check again, and no label, layout, or visual treatment changes elsewhere.
- Scope: `setup-provider-row.tsx`, `setup-providers-screen.tsx`, the shared readiness types, their regression tests, the customer-flow fixtures pinned to the new CodexBar version, and this approval record. This approves the visible result and the pull-request branch only, not merge, release, installation, or a device operation.
- Superseded on 2026-09-22: This change was withdrawn from `main` by the pre-#466 rollback recorded below. It stays on `codex/integration-p1-batch` for hardware verification.

## 2026-09-21 — A full usage value keeps its percent sign at desk distance

- User approval: Marcus selected issue #258 as one of the three P1 issues in this batch and, when the missing hardware rehearsal was raised as the remaining blocker, chose to run the real-device verification rather than defer it.
- Approved customer-visible result: Both changed themes give every percentage an explicit symmetric lane wide enough for a rendered "100%", so no valid value loses its percent sign, and the reading text is larger. Mini Classic percentages render at font 2 size 3 in a 108px lane; Claude Creature keeps size 3 in a 108px lane with a larger reset line. Every other value, label, and layout is unchanged.
- Verification: Performed against the connected VibeTV `16199591` (board `esp8266-smalltv-st7789`, firmware 1.0.43, 240x240 panel), reached over the cable transport at `cable://vibetv` because this bench device is not on WiFi. The device reported Claude at 100% at that moment, which is exactly the reported failure value, so the rehearsal frame is the customer's real state rather than a constructed one. Both themes were rendered at 240x240 through the production preview renderer and compared against the pre-fix definitions from `4785e4f3^`. Measured lanes: Mini Classic slot 1 had no lane and slot 2 had 90px, both now 108px with `fit: shrink`; Claude Creature slot 1 had no lane and slot 2 had 75px, both now 108px. A rendered "100%" no longer exceeds any lane it lives in.
- Known limitation: The repository rehearsal scripts drive the device over HTTP and cannot run against a cable-connected VibeTV, so the scripted cold- and warm-start flows were not executed. The legibility and clipping question they exist to answer was verified directly instead, on this device's real state and panel geometry. A scripted rehearsal remains outstanding for the release gate.
- Scope: `theme-packs/mini-classic/theme.json`, `theme-packs/claude-creature/theme.json`, their generated render packs and tests, and this approval record. This approves the visible result and the pull-request branch only, not merge, release, installation, or a device operation.
- Superseded on 2026-09-22: This layout was withdrawn from the published catalog by the superseding theme versions recorded below. It stays on `codex/integration-p1-batch` for hardware verification.

## 2026-09-22 — Return main to its pre-#466 customer-visible state

- User approval: Marcus stated that merging PR #466 before the three P1 fixes were verified on real VibeTV hardware was a mistake, asked for the merge to be undone, and chose the full revert when shown that it also withdraws the two published theme versions.
- Approved customer-visible result: The Control Center shows exactly what it showed before #466 was merged. Marcus chose to withdraw the two published themes by publishing a superseding version rather than deleting the ones already offered to customers. The catalog therefore lists Claude Creature 1.3.1 and Mini Classic 1.2.1, whose rendered layout is byte-identical to the pre-merge 1.2.1 and 1.1.4 revisions: the earlier text positions, sizes, and colors return, and the #258 legibility layout is withdrawn. Every other screen, control, and copy string returns to its pre-merge state. A customer who already installed 1.3.0 or 1.2.0 keeps that theme on the device and is offered the superseding version by the ordinary catalog update.
- Scope: Revert squash commit `bb7dfa45` in full, then republish the two affected theme packs at a higher version and ThemeSpec revision so no published asset is deleted. Outside `theme-packs/`, `dist/theme-packs/`, and this approval record, the resulting tree is identical to `db281000`, so the only files that differ from the pre-merge state are the theme sources, their generated artifacts, and this file. No release, installation, or device operation. The withdrawn firmware and Control Center work stays on `codex/integration-p1-batch` for hardware verification.

### 2026-09-22 — Withdraw the two published themes by superseding them

- User approval: Shown that reverting #466 would delete Claude Creature 1.3.0 and Mini Classic 1.2.0, which the merge had already published to the live catalog, Marcus chose the option that republishes them at a higher version instead of deleting assets customers may already have installed.
- Approved customer-visible result: The theme catalog offers Claude Creature 1.3.1 and Mini Classic 1.2.1. Their rendered layout is byte-identical to the pre-merge revisions, so the #258 legibility layout is withdrawn and the earlier text positions, sizes, and colors are what customers see again. The previously published 1.3.0 and 1.2.0 downloads stay available, so a device that already installed one keeps working and updates through the ordinary catalog path. No control, copy, or screen changes beyond the theme rendering itself.
- Scope: `theme-packs/claude-creature`, `theme-packs/mini-classic`, and the regenerated `dist/theme-packs` artifacts. No release, installation, or device operation.

## 2026-09-23 — Setup hardening batch: one provider skips Display Mode, a late WiFi answer keeps Cable, Windows stops saying Mac

- User approval: On 2026-09-23 Marcus delegated issues #453, #204, #440, #423 and #438 plus part 2 of #460 as one setup-hardening branch, with the explicit instructions to skip the Manual/Automatic step when exactly one provider toggle is on (#423), to let the customer's latest Cable/WiFi choice win over a late WiFi answer (#440), and to make the "Mac"/"Mac App" wording platform-neutral in the Windows app while leaving the macOS texts unchanged (#460 part 2, #438).
- Approved customer-visible result: In setup, a customer with exactly one provider switched on goes from Choose AI providers straight to the next step; that provider is saved as the one VibeTV shows, and Back from the theme step returns to the provider list. With two or more providers switched on, Display Mode appears exactly as before, and with none Continue stays closed as before. A customer who picks WiFi and then Cable stays on Cable even when the WiFi answer arrives later. In the Windows app only, "Mac App" reads "App" ("App offline", "Waiting for app", "Update the app first", "Checking the app"), and "this Mac" reads "this computer" on the Overview, Settings, Updates, the setup provider log and the AI usage dialog ("Finish AI setup on this computer"), matching the "on this computer" wording approved on 2026-09-17. The Windows app knows its platform from the runtime, never from the user agent. Every macOS text is unchanged and pinned by tests.
- Scope: `setup-wizard.tsx`, `overview-screen.tsx`, `settings-screen.tsx`, `updates-screen.tsx`, `setup-usage-dialog.tsx`, `setup-providers-screen.tsx`, `control-center-app.tsx`, `control-center-types.ts`, the runtime's new `companion.runtime.os` field, their tests and customer flows, and this approval record. This approves the visible result and the pull-request branch only, not merge, release, installation, or a device operation.

## 2026-09-23 — Setup hardening batch follow-up: the Windows app does not say Mac before its runtime answers

- User approval: Covered by Marcus's 2026-09-23 delegation of #438 and #460 part 2 (platform-neutral wording in the Windows app), which includes answering the Codex review of this pull request. The review of 16a4fbc6 found that a cold Windows start showed "reading provider usage on this Mac" until the first runtime status arrived, and kept Mac wording indefinitely when the runtime never answered. No new text is introduced.
- Approved customer-visible result: The Windows app shows the approved Windows wording ("this computer", "App") from the first frame, including the setup welcome log and the offline states before the runtime has ever answered. The runtime's reported platform still wins once it arrives and is kept afterwards; until then the platform the WebView reports stands in. This corrects the previous entry's "never from the user agent": the shells still replace the user agent, and the stand-in is the WebView's platform, not the user agent. Every macOS text is unchanged.
- Scope: `control-center-app.tsx`, the Windows customer flow `testWindowsAppDoesNotSpeakOfAMac`, and this approval record. This approves the visible result and the pull-request branch only, not merge, release, installation, or a device operation.

## 2026-09-23 — Setup hardening batch follow-up: the remaining Mac wording in the Windows app

- User approval: On 2026-09-23 Marcus asked Codex to fix the remaining Mac texts in the Windows app, limited to the Control Center interface with the runtime (Companion) left unchanged, and to start right away.
- Approved customer-visible result: In the Windows app only, the remaining "Mac App" wording reads "App"/"app" and "this Mac"/"your Mac" reads "this computer"/"your computer", using the wording approved earlier today. This covers the Usage empty state, the Support screen and its activity log, the Appearance install hint ("Install the app first") and Theme Studio messages, the firmware-blocked dialogs in setup ("Your app is out of date"), the cable option in "We couldn't find your VibeTV", the copied AI help prompt, and error and activity messages shown in the interface; "open it again from Applications" reads "from the Start menu". Messages the runtime sends are reworded only where the interface shows them, so the runtime itself is unchanged. Every macOS text is unchanged and pinned by tests.
- Scope: a shared `copyForHost` helper in `customer-platform.ts`, `control-center-app.tsx`, `usage-screen.tsx`, `logs-screen.tsx`, `theme-library-screen.tsx`, `theme-studio-screen.tsx`, `setup-firmware-dialogs.tsx`, `setup-device-dialogs.tsx`, `setup-usage-dialog.tsx`, `setup-wizard.tsx`, `setup-ai-prompt.ts`, their tests, the Windows customer flow, and this approval record. This approves the visible result and the pull-request branch only, not merge, release, installation, or a device operation.

## 2026-09-23 — Setup hardening batch follow-up: the Windows Help menu and AI prompt do not say Mac

- User approval: Covered by Marcus's 2026-09-23 request to fix the remaining Mac texts in the Windows app, interface only with the runtime unchanged, which includes answering the Codex review of this pull request. The review of b04e4e78 found that the copied AI help prompt still carried the runtime's Mac wording in its errors and events, and that the setup Help menu still said "The Mac App did not answer" after a partial support report. No new text is introduced.
- Approved customer-visible result: In the Windows app only, the whole copied AI help prompt, including the errors, events and setup log it carries, and the setup Help menu's "Report saved with gaps" note use the approved Windows wording ("app", "this computer", "from the Start menu"). Every macOS text is unchanged.
- Scope: `setup-ai-prompt.ts`, `setup-help-menu.tsx`, `setup-wizard-screen.tsx` and the setup step screens that pass the platform to it, `setup-wizard.tsx`, `control-center-app.tsx`, their tests, and this approval record. This approves the visible result and the pull-request branch only, not merge, release, installation, or a device operation.

## 2026-09-23 — Setup hardening batch follow-up: the Windows setup install logs do not say Mac

- User approval: Covered by Marcus's 2026-09-23 request to fix the remaining Mac texts in the Windows app, interface only with the runtime unchanged, which includes answering the Codex review of this pull request. The review of aa8b90a3 found that a theme install that failed because the background service disappeared still showed "Mac App did not answer" in the visible setup log. No new text is introduced.
- Approved customer-visible result: In the Windows app only, the theme and firmware install logs shown during setup use the approved Windows wording ("app", "this computer", "from the Start menu"). Every macOS text is unchanged.
- Scope: `control-center-app.tsx` and this approval record. This approves the visible result and the pull-request branch only, not merge, release, installation, or a device operation.

## 2026-09-28 — USB rescue update: setup updates a VibeTV on pre-Cable firmware over USB-C by itself

- User approval: On 2026-09-28 Paul asked to build the USB rescue update from #478 directly into this pull request and to test it on the connected VibeTV and this Mac. Shown a confirmation dialog for it, he chose no dialog: setup updates the VibeTV right away and shows the existing firmware update view, like every other setup firmware update.
- Approved customer-visible result: In setup, when the connected VibeTV runs firmware from before USB-C support (it answers over the cable without a device identity), the device search no longer ends in "Connect to WiFi" or "We couldn't search for your VibeTV". The app starts the firmware update over the cable by itself and shows the existing update log ("Preparing VibeTV update.", "Checking VibeTV.", "Updating VibeTV.", "Restarting VibeTV."), then searches again and connects the VibeTV by Cable as usual. No new text is introduced. The update runs once per app launch: if it fails, the existing "We couldn't search for your VibeTV" dialog shows the update error with "Search again", and the next search shows the existing "Your VibeTV needs a firmware update before it can use USB-C." with "Connect VibeTV to WiFi, install the update, then reconnect the cable." instead of flashing again. A VibeTV whose USB-C carries power only, or a charge-only cable, shows no serial port, so nothing changes for it.
- Scope: `control-center-app.tsx`, the customer flows `testPreUsbCVibeTVIsUpdatedOverTheCable` and `testFailedCableRescueRunsOnceAndPointsToWiFi`, and this approval record. This approves the visible result and the pull-request branch only, not merge, release, installation, or a device operation.

## 2026-09-29 — Setup hardening batch follow-up: Continue waits for a provider switch that is still saving

- User approval: On 2026-09-29 Paul asked to fix the Codex review findings on this pull request where sensible. The review of aa8b90a3 found that switching one of two providers off and pressing Continue at once skipped Display Mode on a write that could still be refused, leaving VibeTV pinned to one provider after the switch rolled back. No new text is introduced.
- Approved customer-visible result: On Choose AI providers, Continue is closed while a provider switch is still saving, exactly as it already is while the completion is on its way, and opens again as soon as the write answered. Every text and every other screen is unchanged.
- Scope: `setup-providers-screen.tsx`, its test, and this approval record. This approves the visible result and the pull-request branch only, not merge, release, installation, or a device operation.

## 2026-09-29 — Setup hardening batch follow-up: firmware and theme job failures use Windows wording

- User approval: Covered by Marcus's 2026-09-23 request to fix the remaining Mac texts in the Windows app, interface only with the runtime unchanged, which includes answering the Codex review of this pull request. The review of 1710cb9a found that a firmware update on Updates and a theme install on Appearance that lose the background service still showed the runtime's "Mac App" and "from Applications" recovery. No new text is introduced.
- Approved customer-visible result: In the Windows app only, the firmware update status on Updates and the theme install status on Appearance, including their failure dialogs and log lines, use the approved Windows wording ("app", "this computer", "from the Start menu"). Every macOS text is unchanged.
- Scope: a shared `statusForHost` helper in `customer-platform.ts`, `updates-screen.tsx`, `theme-library-screen.tsx`, the helper's test, and this approval record. This approves the visible result and the pull-request branch only, not merge, release, installation, or a device operation.

## 2026-09-29 — USB rescue update shows its progress

- User approval: On 2026-09-29 Paul reported waiting a long time on "Updating VibeTV." during the USB rescue update, asked for intermediate progress, and chose variant 08a ("Setup Status Lines" in the Claude Design project "Screen-Redesign mit VibeTV") after seeing the three variants.
- Approved customer-visible result: While the USB rescue update writes the firmware, the update log line "Updating VibeTV." counts up in place in steps of ten percent ("Updating VibeTV: 10%." … "Updating VibeTV: 100%."), and the update progress bar follows it. The line replaces itself instead of adding lines, so the earlier steps stay in the log. If the write has to start again after a transfer error, the count starts again from the beginning. On a failure the line keeps its last value. No other text changes.
- Scope: the runtime's update progress wording (`companion/internal/companionapi/server.go`), the rescue flasher's progress callback, their tests, and this approval record. This approves the visible result and the pull-request branch only, not merge, release, installation, or a device operation.

## 2026-09-29 — The rescued VibeTV connects without a second search

- User approval: On 2026-09-29 Paul tested the USB rescue update and asked that setup not jump back to "looking for your VibeTV" after the update, but go straight on to Choose AI providers, because the VibeTV is already connected by USB-C.
- Approved customer-visible result: After the USB rescue update finishes, setup no longer starts a new device search. It connects the VibeTV the update just verified over the cable, the same way as a single VibeTV found on the cable ("Connecting to VibeTV"), and then shows Choose AI providers. If the update does not report the VibeTV's identity, setup searches again as before. Every other screen and text is unchanged.
- Scope: `control-center-app.tsx`, the customer flow test, and this approval record. This approves the visible result and the pull-request branch only, not merge, release, installation, or a device operation.

## 2026-09-29 — The USB rescue update runs as the setup's normal firmware update

- User approval: On 2026-09-29 Paul compared the USB rescue update with the setup's normal firmware update and asked for one way: the same loading states as the normal update, and a faster rescue.
- Approved customer-visible result: A VibeTV on firmware from before USB-C support is no longer updated on the Welcome screen. Setup treats it as the one VibeTV on the cable and shows the normal "Connecting to VibeTV" sequence: "connecting to cable://vibetv", "connected", "checking firmware version", "firmware update available · 1.0.39 → <current>", then "updating firmware · N% — keep VibeTV powered on", where N counts up in steps of ten as the firmware is really written, and "update complete". Setup then connects that VibeTV by Cable and shows Choose AI providers. A failed rescue opens the normal "Firmware update did not finish" dialog with "Try update again" and "Create support report"; it never flashes again on its own. The rescue writes at a higher cable speed and takes about half as long as before. This replaces the Welcome-screen log and the "Updating VibeTV: N%." line of the earlier rescue entries; every other screen and text is unchanged.
- Scope: `control-center-app.tsx`, `control-center-types.ts`, `setup-connect.ts`, `setup-connect-log.ts`, `setup-wizard.tsx`, their tests, the customer flow test, and this approval record. This approves the visible result and the pull-request branch only, not merge, release, installation, or a device operation.

## 2026-09-29 — Retrying after a successful USB rescue repeats only the Cable step

- User approval: On 2026-09-28 Paul asked to fix every valid finding of the automated Codex review on this pull request. The review found that "Try update again" after a successful rescue started a second rescue that cannot find the already updated VibeTV.
- Approved customer-visible result: No screen, dialog, button, or text changes. When the USB rescue wrote and verified the firmware but connecting by Cable failed, the existing "Firmware update did not finish" dialog's "Try update again" now repeats only the Cable connection for the VibeTV the rescue verified, instead of failing every retry; it never writes the firmware a second time. Every other screen and text is unchanged.
- Scope: `control-center-app.tsx`, the customer flow test, and this approval record. This approves the visible result and the pull-request branch only, not merge, release, installation, or a device operation.

## 2026-09-29 — Setup connection failures use the Windows wording

- User approval: On 2026-09-28 Paul asked to fix every valid finding of the automated Codex review on this pull request, and approved on this branch that the Windows app never speaks of a Mac. The review found that the setup's connection-failure dialog still showed the Companion's own "Mac App" and "this Mac" wording on Windows.
- Approved customer-visible result: On Windows, the setup dialog for a failed connection and the firmware "attention needed" dialog word "Mac App" as "app" and "this Mac" as "this computer", like every other Windows text. On macOS nothing changes. No other screen or text changes.
- Scope: `setup-wizard.tsx`, its test, and this approval record. This approves the visible result and the pull-request branch only, not merge, release, installation, or a device operation.

## 2026-09-22 — Republish the legibility layout above the withdrawn versions

- User approval: Marcus asked for PR #470 to be brought back to review readiness after the #466 revert, keeping the approved #258 legibility layout and resolving the theme conflicts against `main` without touching any published asset.
- Approved customer-visible result: Once this branch is merged, the theme catalog offers Claude Creature 1.3.2 and Mini Classic 1.2.2 at ThemeSpec revision 9. Their rendered layout is byte-identical to the approved 1.3.0 / 1.2.0 legibility revisions: every percentage keeps its symmetric 108px lane with `fit: shrink`, so a rendered "100%" keeps its percent sign, and the reading text stays at the larger size. The superseding 1.3.1 / 1.2.1 versions from the revert and every earlier published download remain available. No other screen, control, or copy string changes.
- Scope: `theme-packs/claude-creature`, `theme-packs/mini-classic`, the regenerated `dist/theme-packs` artifacts, the revision assertion in `theme-legibility.test.ts`, and this approval record. This approves the visible result and the pull-request branch only, not merge, release, installation, or a device operation. The real-VibeTV hardware test for the batch is recorded on the pull request.

## 2026-09-29 — Windows lists every provider CodexBar reports

- User approval: Marcus decided that Windows should again offer every provider the bundled Win-CodexBar supports, with the provider's own tool installed and signed in as the customer's prerequisite: "wir würden gerne wieder alle Anbieter anbieten, die auch WinCodex Bar hat. Und da muss halt dann ... die Voraussetzung dann sein, dass jeweils die jeweilige Software ... installiert ist auf dem Rechner." He accepted the proposal to keep the sign-in button only where the Companion can start a sign-in and to raise the provider check time limit.
- Approved customer-visible result: On Windows, setup and Settings list every provider CodexBar reports, exactly as the Mac app already does; the list is no longer shortened to Codex, Claude, Cursor and Antigravity. Those four keep the "Sign in to <Provider>" button approved on 2026-09-17; every other row shows its switch, the provider's own message with the existing copy action, and "Check again". A single provider check may now take up to 40 seconds before the row reports "The provider check timed out.", on Windows and on the Mac, instead of 18 seconds. No copy, layout or control changes otherwise; the Mac rows are unchanged apart from the longer check.
- Scope: `setup-providers-screen.tsx`, `settings-screen.tsx`, `control-center-app.tsx`, their tests, `apps/control-center/scripts/test-customer-flows.mjs`, and the Companion's provider check timeouts (`companion/internal/codexbar/providers.go`, `provider_setup.go`, `companion/internal/companionapi/provider_setup.go`, `preferences.go`). The prerequisite notice with a link to the setup guide is not part of this entry; its wording awaits Marcus's approval. This approves the draft pull request only, not merge, release, or a device operation.

## 2026-09-29 — Windows provider prerequisite notice

- User approval: Marcus approved the proposed wording for the prerequisite notice: "Ja, also Hinweistext passt für mich so."
- Approved customer-visible result: On Windows, when a provider without the "Sign in to <Provider>" button needs a sign-in or setup (`auth_required` or `setup_required`), its message dialog reads "VibeTV reads <Provider> usage from <Provider>'s own app on this computer. Make sure it is installed and signed in, then click Check again." Below it the dialog shows the provider's own message and an "Open setup guide" link that opens https://vibetv.shop/pages/setup in the default browser. OK and "Copy provider message for <Provider>" stay as they are. Codex, Claude, Cursor and Antigravity, every other state, and the Mac app are unchanged.
- Scope: `setup-providers-screen.tsx`, `setup-wizard.tsx`, `provider-picker.tsx`, `settings-screen.tsx`, `control-center-app.tsx`, their tests, and the Companion's fixed `POST /v1/providers/setup-guide` (`companion/internal/companionapi/provider_setup.go`, `server.go`). This approves the draft pull request only, not merge, release, or a device operation.

## 2026-09-30 — USB firmware update without false alarms, with progress

- User approval: Paul tested the customer state with a USB VibeTV, saw "We couldn't search for your VibeTV — VibeTV update is still running", "Finish AI setup on this Mac" and a background-service dialog while the firmware update ran, and asked: "fix das und mach PR. außerdem wieso dauert firmware update so lange? und ich brauche da nen status indicator". He then asked to speed up the upload in the same pull request: "mach das in den gleichen pr".
- Approved customer-visible result: While a firmware or theme job is installing, missed status polls no longer count toward declaring the VibeTV lost, so no device search starts and "We couldn't search for your VibeTV" no longer appears mid-update. On the setup device step, "Finish AI setup on this Mac" is held back while the connect-and-firmware sequence runs and appears as before once it settles. A Cable firmware update now shows the existing percentage line "updating firmware · N% — keep VibeTV powered on" and fills the existing Updates progress bar, as the Cable rescue already did. "Provider settings need a newer Mac App" appears only for a CodexBar version that was read and is too old; an unanswered version check shows the existing "Settings are not available right now." No new copy, control, layout or visual treatment.
- Scope: `device-recovery-gate.ts`, `setup-wizard.tsx`, `control-center-app.tsx`, `control-center-types.ts` (support-report field `operationFailureLimit` removed), their tests, and the Companion/firmware changes of this pull request. This approves the pull request only, not merge, release, or a device operation.

## 2026-09-30 — Recovery grace only for a job the Companion still reports

- User approval: Paul enabled Auto-fix for this pull request, which covers addressing its automated review findings. The Codex review found that after a Companion restart the UI could keep a stale "installing" firmware status and then never count a missed device poll again.
- Approved customer-visible result: Unchanged from the 2026-09-30 entry "USB firmware update without false alarms, with progress": missed polls are not counted while the same `/v1/status` answer reports an installing firmware or theme job. When the Companion no longer reports one, missed polls count again and device recovery can open as before. No copy, control, layout or visual change.
- Scope: `control-center-app.tsx`. This approves the pull request only, not merge, release, or a device operation.

## 2026-10-01 — Setup never waits for a newer app release

- User approval: Marcus reproduced a Windows customer stuck in setup on "Your app is out of date" after a new release published, and approved the proposed permanent fix: every app installs only the firmware of its own release, so the block disappears entirely ("dann machst du bitte einen PR für den dauerhaften Vorschlag").
- Approved customer-visible result: During setup, the firmware step no longer shows "Your Mac App is out of date" / "Your app is out of date" or "Could not check the Mac App". The app updates VibeTV to the firmware of its own release and setup continues. The remaining firmware dialogs ("Could not check VibeTV's firmware", "The Mac App is restarting") are unchanged. The Updates screen is unchanged and still offers the app update before the firmware update. No new copy, control, layout or visual treatment, on macOS and Windows.
- Scope: `setup-firmware-dialogs.tsx`, `setup-wizard.tsx`, `setup-preview-gallery.tsx`, `control-center-app.tsx`, `control-center-runtime.ts`, their tests, and the Companion change of this pull request (`companion/cmd/codexbar-display/main.go`, `companion/internal/companionapi/server.go`). This approves the pull request only, not merge, release, or a device operation.

## 2026-09-30 — Recovery grace also for this window's own operation

- User approval: Paul enabled Auto-fix for this pull request, which covers fixing its failing CI. The customer flow "Firmware update must refresh the active slot theme exactly once" failed because the previous entry's change took the grace only from the status answer.
- Approved customer-visible result: Unchanged from the 2026-09-30 entry "USB firmware update without false alarms, with progress": missed polls are not counted while this window runs its own firmware update or theme install, or while the same `/v1/status` answer reports an installing job. A job only remembered from an earlier status answer no longer suspends counting. No copy, control, layout or visual change.
- Scope: `control-center-app.tsx`. This approves the pull request only, not merge, release, or a device operation.

## 2026-09-25 — Turning off the Manual provider keeps VibeTV showing usage

- User approval: Marcus reported that after pinning Manual to Codex and switching Codex off in Settings, the Manual preview read "No usage yet", no provider was checked, and VibeTV showed nothing although Claude had usage. Codex proposed keeping the pinned provider while it is on, switching the selection to Automatic when it is turned off, and saying so with a short hint. Marcus answered "ok".
- Approved customer-visible result: While the Manual provider stays on, nothing changes. When the customer turns it off in Settings, Display mode switches to Automatic over the providers that are still on, and the Display mode section shows "<Provider> is off, so VibeTV now switches automatically." until the display choice changes again. VibeTV itself keeps showing the remaining providers instead of going blank, also when the provider is turned off outside this app. No other control, copy, or layout changes.
- Scope: `control-center-types.ts`, `control-center-app.tsx`, `provider-picker.tsx`, `settings-screen.tsx`, the daemon provider-display fallback in `companion/internal/daemon/daemon.go`, their tests, and this approval record. This approves the visible result and the pull-request branch only, not merge, release, installation, or a device operation.

## 2026-09-25 — Review follow-up: the hint stays through unrelated provider toggles

- User approval: Covered by Marcus's "ok" to the entry above, which asked for a short hint when the switch happens. The review of PR #477 found that toggling another provider cleared the hint although the display mode did not change, and the live preview test showed the same.
- Approved customer-visible result: The hint explains the automatic switch while this app window stays open. It disappears once a new display mode is saved or when the provider it names is switched on again, because it would then be wrong. Turning another provider on or off only adjusts the Automatic pool and leaves it visible, and a failed save leaves it in place. After the app is reopened, Automatic is simply the saved mode and no hint is shown.
- Scope: `control-center-app.tsx` and this approval record. Pull-request branch only.

## 2026-09-25 — Review follow-up: only a provider switched off triggers the switch

- User approval: Covered by Marcus's "ok" to the first entry of this date, which approved switching when the Manual provider is turned off. The review of PR #477 found that a Manual provider missing from the provider list entirely was treated as turned off too.
- Approved customer-visible result: Only a Manual provider that the provider list shows as switched off triggers the switch to Automatic and the hint. A Manual provider that no longer appears in the list at all stays selected exactly as before this pull request.
- Scope: `control-center-types.ts`, `control-center-app.tsx`, the matching daemon inventory check, their tests, and this approval record. Pull-request branch only.

## 2026-09-25 — Review follow-up: an old hint does not come back

- User approval: Covered by Marcus's "ok" to the first entry of this date. The review of PR #477 found that a hint hidden because its provider was switched on again reappeared when that provider was switched off later, although the display mode had not changed.
- Approved customer-visible result: Switching the named provider on again ends the hint for good. Switching it off later while Automatic is already active shows no hint, because nothing switched.
- Scope: `control-center-app.tsx` and this approval record. Pull-request branch only.

## 2026-10-01 — Review follow-up: the automatic switch survives one failed CodexBar read

- User approval: On 2026-10-01 Paul asked to review this pull request together with #474, test it on this Mac with the connected VibeTV, and fix every issue found directly. The review found that while the switch was active, a single failed CodexBar read replaced the remaining provider's usage on VibeTV with the no-providers screen.
- Approved customer-visible result: No screen, dialog, button, or text changes. Once VibeTV has switched to the providers that are still on, it keeps showing them through one failed CodexBar read. A second failed read in a row ends the switch, because the Manual provider may have been switched on again meanwhile. After a restart of the background service the strict behaviour decided on 2026-09-25 stays: until CodexBar confirms the Manual provider is off, nothing else is shown in its place.
- Scope: `companion/internal/daemon/collector.go`, `companion/internal/daemon/daemon.go`, their tests, and this approval record. This approves the pull-request branch only, not merge, release, installation, or a device operation.

## 2026-09-24 — Setup log, Run diagnostics and usage engine identity (#313 #337 #335 #334)

- User approval: Marcus assigned package A "Setup- und Support-Diagnose" (#313 live setup logs in support reports, #337 Run diagnostics action, #335 incompatible version instead of engine_error, #334 runtime path, version and source, #475 doctor status) for one bundled pull request and set the binding product rule: customers never see the name CodexBar in the app; the UI calls it neutrally "Usage engine" with version, path and source, and the name may appear only in the support report/diagnostics export.
- Approved customer-visible result: The Support screen gains a "Diagnostics" card with a "Run diagnostics" button. It runs the same snapshot the support report downloads and shows a "Usage engine" block (version, required version, source in plain words, path with the home folder shortened to ~) and every check with icon plus text (Pass / Needs attention / Failed), its detail and one next action; a partial result says "Some checks could not run." An engine that is too old reads "Usage engine X is too old. Version Y or newer is required." with the existing Repair action. A "Setup log" card shows the Mac App's ordered setup events live (time, step, status, message, next action, ×N for repeats, "Older entries were removed." when truncated, "No setup activity recorded yet." when empty, "Jump to latest" when scrolled up). The setup Help menu gains "Show setup log" / "Hide setup log", revealing the same log while Create support report stays available. Settings gains a "Run diagnostics" button under AI providers that opens Support and runs diagnostics. A provider row for a too-old engine shows its own update text instead of "Check timed out", and the usage dialog gains the cause "Update the usage engine". Any server text naming CodexBar is shown as "usage engine". No other screen, control or copy changes.
- Scope: `diagnostics-panel.tsx`, `setup-event-log.tsx`, `customer-support-text.ts`, `logs-screen.tsx`, `settings-screen.tsx`, `control-center-app.tsx`, `control-center-types.ts`, `support-report.ts`, `setup/setup-help-menu.tsx`, `setup/setup-provider-row.tsx`, `setup/setup-usage-dialog.tsx`, their tests, and this approval record. This approves the visible result on the pull-request branch only, not merge, release, installation, or a device operation.

### 2026-09-24 — Setup log names provider choices, checks and display mode

- User approval: Testing the local preview, Marcus found the setup log too coarse (it showed only VibeTV search, connection and "AI providers Done ×2") and approved ("ok") logging the provider steps and replacing the repeat sign with words.
- Approved customer-visible result: The setup log also shows each provider switched on or off ("AI provider choice": "<Provider> turned on." / "<Provider> turned off."), the result of the check that follows switching one on ("AI provider check": "<Provider> is ready." or "<Provider>: <problem>" with its next action) and every display mode save ("Display mode": "Automatic: VibeTV switches between your providers." or "Always show <Provider>.", or the refusal with its next action). A repeated entry reads "N times" in muted text instead of "×N"; its accessible name stays "Repeated N times". No other screen, control or copy changes.
- Scope: `setup-event-log.tsx`, its test, the Mac App's setup event recording, and this approval record. This approves the visible result on the pull-request branch only, not merge, release, installation, or a device operation.

### 2026-10-05 — Hardware review follow-up: the setup log survives a restart, Windows says App, no made-up engine location

- User approval: On 2026-10-05 Paul had this pull request rehearsed on the bench Mac and the Windows laptop (cold and warm start), was shown the findings and asked to fix everything that belongs to this pull request and to make it ready to merge.
- Approved customer-visible result: The setup log keeps its entries when the Mac App's background service restarts in the middle of a setup, and marks the restart with one entry ("Mac App": "The Mac App's background service started again."); a new setup or a log older than a day starts empty as before. A VibeTV found on the cable that setup then updates by itself is logged as "VibeTV search — Done: Found a VibeTV on the cable that needs a firmware update." instead of "Failed" with the advice to use WiFi. In the Windows app the Diagnostics checks and the setup log use the approved Windows wording ("App", "this computer"). The "Usage engine" block no longer shows a "Location": with the engine's name replaced, the path shown did not exist on disk; the real path stays in the support report. The Gemini migration message that reached `main` meanwhile reads "Enable Antigravity, sign in to Antigravity or run `agy`, then refresh." rather than naming the engine ("Enable CodexBar's Antigravity provider"), which this pull request's rule forbids. No other screen, control or copy changes.
- Scope: `diagnostics-panel.tsx`, `setup-event-log.tsx`, `customer-support-text.ts`, `logs-screen.tsx`, `setup/setup-help-menu.tsx`, `setup/setup-provider-row.test.tsx`, their tests, the Mac App's setup event recording, and this approval record. This approves the visible result on the pull-request branch only, not merge, release, installation, or a device operation.

### 2026-10-05 — Hardware review follow-up: the restart entry's label on Windows

- User approval: Covered by Paul's 2026-10-05 request to fix what the hardware rehearsal of this pull request found and make it ready to merge. The Windows run showed the new restart entry under the step label "Mac App".
- Approved customer-visible result: In the Windows app the setup log's step labels use the approved Windows wording too, so the restart entry reads "App — Done: The app's background service started again." The Mac wording is unchanged. No other screen, control or copy changes.
- Scope: `setup-event-log.tsx`, its test, and this approval record. This approves the visible result on the pull-request branch only, not merge, release, installation, or a device operation.

## 2026-09-30 — Setup and pairing only over the USB cable

- User approval: Marcus decided in issue #489 (decision of 2026-09-30) that setup and pairing run only over the USB cable and that the Mac App guides setup over the cable ("Mac-App führt durch die Einrichtung per Kabel"). On 2026-09-30 he added that WiFi changes and other critical changes happen only over USB ("Änderungen des Wi-Fis oder Änderungen der kritischen Sachen nur per USB") and left the details to Codex.
- Approved customer-visible result: The phone path is gone. The help link on the device step reads "How to connect VibeTV" and opens "Connect the USB cable" with three steps: plug VibeTV into this computer with the USB cable, wait until the screen lights up and scan again, choose WiFi after VibeTV is connected. "Scan again" and "Enter IP manually" stay. The not-found dialog says "Setup runs over the USB cable. Connect it, then scan again."; its second option reads "Already on WiFi — For a VibeTV that is already set up on your WiFi." The Overview reconnect notice reads "If VibeTV shows “Connect USB cable”, plug it into this computer with the cable and choose the new WiFi. Your pairing and settings stay saved." A VibeTV without a USB connection shows "VIBE TV / Connect USB cable / app.vibetv.shop" and no longer opens a VibeTV-Setup network. No other screen, control or layout changes.
- Scope: `setup-device-dialogs.tsx`, `setup-wizard.tsx`, `setup-device-screen.tsx`, `setup-preview-gallery.tsx`, `overview-screen.tsx`, their tests, `apps/control-center/scripts/test-customer-flows.mjs`, and the firmware/Companion changes of this pull request. This approves the pull request only, not merge, release, installation, or a device operation.

## 2026-09-30 — A VibeTV that pairs only over the cable leads to the cable

- User approval: Same decision as the entry "Setup and pairing only over the USB cable" (issue #489, "Mac-App führt durch die Einrichtung per Kabel"; "Änderungen des Wi-Fis … nur per USB"). The automated Codex review on this pull request found that the stated recovery action was not reachable.
- Approved customer-visible result: When pressing Connect on a WiFi VibeTV answers "VibeTV pairs only over the USB cable." with "Connect VibeTV to this Mac with the USB cable, then press Connect.", the connection-failure dialog's main button reads "Use the cable" instead of "Search again" and switches setup to the cable search. "Enter IP manually" stays. Every other connection failure is unchanged.
- Scope: `setup-connect.ts`, `setup-device-dialogs.tsx`, `setup-wizard.tsx` and its test. This approves the pull request only, not merge, release, installation, or a device operation.

## 2026-09-30 — Updates and erasing only over the USB cable

- User approval: Marcus approved the simple package for issue #489 on 2026-09-30: "Ja, das gefällt mir viel besser. Damit kannst du direkt loslegen." The package keeps everything critical on the USB cable: firmware updates only over the cable, a factory reset over the cable, and a pairing token from the hardware random generator. Sold devices are out of scope.
- Approved customer-visible result: In Settings, the Setup section shows a second button "Erase VibeTV" below "Run setup again", only while VibeTV is connected by USB-C. It opens the dialog "Erase VibeTV?" — "VibeTV forgets its WiFi details, pairing, settings and themes, then setup starts again. Use this before you give VibeTV away." — with "Keep VibeTV" and "Erase VibeTV". While it runs, the button reads "Erasing"; afterwards setup starts again as with "Run setup again". When an update is started on a VibeTV that is connected by WiFi and only accepts updates over the cable, the update fails with "VibeTV installs updates only over the USB cable." and "Connect VibeTV to this Mac with the USB cable, switch to USB-C in Settings, then update again." The VibeTV status page no longer links to an update page; its update notice reads "Update with the Mac app over the USB cable." No other screen, control or layout changes.
- Scope: `settings-screen.tsx`, `control-center-app.tsx`, the settings test, and the firmware/Companion changes of this pull request. This approves the pull request only, not merge, release, installation, or a device operation.

## 2026-10-01 — Factory reset wording and a neutral restart screen

- User approval: After his own new-customer test on 2026-10-01 Marcus asked to replace the word "Erase" with the usual wording "wie das üblich ist auch beim Mac-System … auf Werkszustand zurücksetzen … als Englisch", and reported that VibeTV briefly showed "WiFi connected! / Now go to: / app.vibetv.shop" after joining WiFi and a similar screen when switching back to USB-C, which made him wonder whether VibeTV had gone back to setup.
- Approved customer-visible result: In Settings the button reads "Reset to factory settings" (while running: "Resetting"). Its dialog reads "Reset VibeTV to factory settings?" with the unchanged text and the buttons "Cancel" and "Reset". The activity entries read "VibeTV reset to factory settings" and "VibeTV was not reset". On the VibeTV display, the screen after joining WiFi reads "VIBE TV / Waiting for app / IP: …", and a VibeTV starting in cable mode reads "VIBE TV / Waiting for app"; neither shows a setup instruction or the app address. Fresh devices keep "Connect USB cable / app.vibetv.shop". No other screen, control or layout changes.
- Scope: `settings-screen.tsx`, `control-center-app.tsx`, the settings test, and the firmware display texts of this pull request. This approves the pull request only, not merge, release, installation, or a device operation.

## 2026-10-05 — Early VibeTVs without USB data keep WiFi updates, USB-C stays greyed out

- User approval: On 2026-10-05 Marcus said that early VibeTVs have no USB connection and work only over WiFi, and asked that they keep receiving new firmware while "für die die kabel option einfach immer ausgegraut ist". He added that USB-C is greyed out as well while a VibeTV still runs the old firmware ("bei der alten Firmware … ist dann zuerst USB-C ebenfalls rausgegraut"), and accepted that these early VibeTVs are not EN 18031 compliant ("das würde ich einfach mal hinnehmen").
- Approved customer-visible result: In Settings, the USB-C card is greyed out while VibeTV is connected over WiFi, unless its firmware takes setup and updates only over the cable. That covers older firmware such as 1.0.39, and VibeTVs that came from older firmware and have not answered over the USB cable yet. When such a VibeTV is plugged into this computer with a data cable while the app is open, the app asks it once over the cable; from then on it follows the cable-only rules and USB-C becomes available. A VibeTV that never answers over the cable keeps installing updates from the app over WiFi and, without a WiFi network, opens VibeTV-Setup with "VIBE TV / Download Mac App / app.vibetv.shop" as before. A VibeTV in cable mode and an offline WiFi binding keep USB-C as before. No copy, layout or other control changes.
- Scope: `control-center-types.ts`, `settings-screen.tsx`, their tests, the Companion status check, the firmware legacy WiFi mode, and this approval record. This approves the pull request only, not merge, release, installation, or a device operation.

## 2026-10-05 — Customer-flow tests model current firmware

- User approval: Same decision as the entry "Early VibeTVs without USB data keep WiFi updates, USB-C stays greyed out" (2026-10-05, "für die die kabel option einfach immer ausgegraut ist").
- Approved customer-visible result: Unchanged from that entry. The WiFi VibeTVs in the customer-flow tests now report current firmware (`cableOnlyUpdates:true`), so their USB-C card stays available as approved. On a legacy WiFi VibeTV the device status page reads "Update with the VibeTV App on your Mac." instead of linking to a separate update page that said the same. No other screen, control or layout changes.
- Scope: `apps/control-center/scripts/test-customer-flows.mjs` and the legacy device status page text. This approves the pull request only, not merge, release, installation, or a device operation.

## 2026-10-05 — The usage service is repaired on its own at most every ten minutes

- User approval: On 2026-10-05 Claude listed the customer-visible issues of
  the overnight batch (#507, #358, #483, #508) as needing UI approval, and the
  user answered in chat "du hast erstmal alle freigaben" (all approvals granted
  for now; they review the batch the next morning).
- Approved customer-visible result: When the usage service fails, the
  automatic repair still runs once for that incident. If the service recovers
  and fails again within ten minutes, the app no longer tears the background
  service down a second time on its own; the existing "Finish AI setup on this
  Mac" dialog shows instead, and its "Try automatic repair again" button still
  repairs at any time. After ten quiet minutes the automatic repair is armed again. No new
  control, copy, or layout (#508).
- Approved files: `control-center-app.tsx`, its customer-flow regression test,
  and this approval record.

## 2026-10-05 — A pre-USB-C Cable VibeTV stays in the list next to another WiFi VibeTV

- User approval: On 2026-10-05 Claude listed #483 among the customer-visible
  issues of the overnight batch, and the user answered in chat "du hast
  erstmal alle freigaben" (all approvals granted for now).
- Approved customer-visible result: When a VibeTV with firmware from before
  USB-C is on the Cable and a different VibeTV answers on WiFi, setup's
  existing "Choose your VibeTV" list shows both, and choosing the Cable one
  runs the existing Cable rescue update. A WiFi VibeTV with the same board and
  firmware as the Cable one may be the same device, so only the WiFi entry is
  shown then, as before. No new control, copy, or layout; the Control Center
  files are unchanged.
- Approved files: Companion device search (`server.go`), its tests, and this
  approval record.

## 2026-10-05 — Theme readback test waits for the theme step (test only)

- User approval: On 2026-10-05 the user granted all approvals for the
  overnight batch in chat ("du hast erstmal alle freigaben").
- Approved customer-visible result: None. The customer-flow test for a failed
  post-install device read now waits up to ten seconds for "Choose your
  theme" instead of sampling the screen one second in, and reports headings,
  dialogs, screen text and recent requests when it fails (#430). Setup must
  still not complete before a successful readback.
- Approved files: `apps/control-center/scripts/test-customer-flows.mjs` and
  this approval record.

## 2026-10-05 — A Cable VibeTV that setup updates keeps connecting on its own

- User approval: On 2026-10-05 the user gave explicit approval in chat for the customer-visible UI changes of this batch ("du hast erstmal alle freigaben") after issue #507 was listed as needing UI approval.
- Approved customer-visible result: A VibeTV on firmware from before USB-C support that is the only one on the Cable, and that setup updates over the Cable and then connects by itself, stays on "Connecting to VibeTV" after "update complete" until the next setup step appears. The "Choose your VibeTV" title, the device card still showing the firmware from before the update, and its Connect button no longer appear there. Like every Cable connect once its Cable step is done, the screen keeps the disabled "Use WiFi instead" link. Back from the AI provider step reconnects that VibeTV by Cable on its own, like any Cable VibeTV, instead of showing the list, and never updates it a second time. No new copy, control, layout, or visual treatment.
- Approved files: `apps/control-center/src/components/control-center-app.tsx`, `apps/control-center/scripts/test-customer-flows.mjs`, and this approval record. This approves the pull-request branch only, not merge, release, or a device operation.

## 2026-10-05 — Lost VibeTV can be chosen again over the current tab

- User approval: The user explicitly approved customer-visible UI changes for
  this batch in chat on 2026-10-05 ("du hast erstmal alle freigaben") after
  issue #358 was listed as needing UI approval.
- Approved customer-visible result: When the saved VibeTV is lost after the
  customer entered the Control Center and the automatic recovery search finds
  VibeTVs it does not reconnect on its own (the saved one is not among them, or
  reconnecting it failed), a dialog opens over the current tab with the
  navigation still visible. It reuses the setup dialog and the setup device
  cards: title `Choose your VibeTV` and `Your VibeTV is not reachable. Choose it
  to connect again.`, or the failed attempt's own message and next step; the
  previously connected VibeTV (otherwise the first) is preselected; one
  `Connect` action and the close button. Connect reconnects the chosen VibeTV
  at its new address and the dialog closes; closing it leaves the current tab,
  with Overview reporting the VibeTV as not reachable. The saved VibeTV found
  at a new address still reconnects without a dialog. Settings does not show
  the same failure in a second dialog, and the usage-service dialog waits while
  this one is open.
- Approved files: `control-center-app.tsx`, `setup/setup-device-dialogs.tsx`,
  the customer-flow regression test, and this approval record.

## 2026-10-05 — Theme Studio offers CodexBar's reserve pace for usage windows 1 and 2

- User approval: On 2026-10-05 the user granted every customer-visible change
  of the batch in chat: "du hast erstmal alle freigaben" (all approvals granted
  for now). #412 is part of that batch.
- Approved customer-visible result: Theme Studio's existing "Binding" list and
  variable tokens gain six entries, "Usage window 1 pace %", "Usage window 1
  pace", "Usage window 1 lasts" and the same three for window 2. The editor,
  catalog and live previews render them like the VibeTV does: CodexBar's signed
  pace (`-25%`, `+14%`), `reserve` / `on pace` / `deficit`, and `lasts until
  reset` / `runs out`, empty when CodexBar sent no pace or the window's
  countdown is gone. The catalog preview's neutral example windows carry an
  example pace. A theme that needs `usage-pace-v1` shows the existing "Firmware
  update needed" state on a VibeTV without it, and Theme Studio exports declare
  that capability. No other new control, copy, or layout.
- Approved files: `control-center-types.ts`, `theme-library-screen.tsx`,
  `live-vibetv-preview.tsx`, `theme-studio/primitive-inspector.tsx`,
  `theme-studio/editor-geometry.ts`, `lib/theme-studio.ts`,
  `lib/theme-studio-capabilities.ts`, `lib/active-theme-upgrade.ts`, their
  tests, and this approval record.

## 2026-10-05 — Review follow-up: lost-VibeTV picker, repair pause, Pace Meter

- User approval: Covered by the user's "du hast erstmal alle freigaben" on
  2026-10-05 for this batch. An independent review of the batch found these
  gaps in the results approved above.
- Approved customer-visible result: The lost-VibeTV picker (#358) lists only
  VibeTVs it can reconnect over WiFi; a VibeTV found only on the Cable no
  longer appears there, because choosing it could not connect. The picker
  also waits while Updates shows "Update failed" or Appearance shows a failed
  theme install, so it never opens on top of them. The automatic usage-service
  repair (#508) pauses for ten minutes after it last ran, measured from that
  repair; "Try automatic repair again" still works at any time. The new theme
  "Pace Meter" (#412) appears in Appearance and in setup's theme step like
  every live theme. On firmware without `usage-pace-v1` its Install is blocked
  with the existing "Firmware update needed" state, like other themes that
  need newer firmware. No other copy, control, or layout changes.
- Approved files: `control-center-app.tsx`, the customer-flow tests, the
  Pace Meter theme pack, and this approval record.

## 2026-10-06 — Pace Meter redrawn as two lanes

- User approval: On 2026-10-06, while this pull request was rehearsed on the
  bench Mac, Paul saw Pace Meter on the VibeTV, asked for other designs, was
  shown four and chose in chat: "Bau Pace Meter als Entwurf B (zwei Spuren)".
- Approved customer-visible result: Pace Meter (#412) shows the provider name
  small at the top and one lane per usage window: the window's label, its
  signed pace large on the right (`-11%`, `+8%`), a full-width bar of the
  window's usage coloured by remaining quota like other themes, and below it
  `lasts until reset` or `runs out`. The words `reserve` / `on pace` /
  `deficit` and the separate usage percent are gone from this theme. A marker
  for the expected usage and a colour that follows the pace state need new
  firmware bindings and are not part of this change. No app screen, control or
  copy changes.
- Approved files: the Pace Meter theme pack, its generated render pack and
  catalog entry, its test, and this approval record.

## 2026-10-06 — Pace Meter gets the design's state colour and expected line

- User approval: The two-lane build above lacked the state colour and the
  expected marker of the design Paul chose ("Entwurf B"). On 2026-10-06 he
  sent a photo of the VibeTV with "das sieht nicht so aus wie dein entwurf.
  mach erstmal alles auf diesem mac was geht."
- Approved customer-visible result: In each Pace Meter lane the signed pace is
  drawn larger and, together with the bar, is green in reserve, yellow on pace
  and coral in deficit; without a pace the bar is grey. A thin white line
  below the bar reaches to where CodexBar expects the window to be by now and
  is empty without a pace. This replaces the quota colouring and the "not part
  of this change" note of the entry above. The catalog and live previews draw
  the same. No app screen, control or copy changes.
- Approved files: the Pace Meter theme pack, its generated render pack and
  catalog entry, its test, the firmware and preview rules for pace colours and
  the expected fill (`theme_spec_renderer_core.h`, `live-vibetv-preview.tsx`,
  `lib/theme-studio.ts`, `themespec.go`), and this approval record.

## 2026-10-06 — Pace bindings and Pace Meter taken out of this batch again

- User approval: On 2026-10-06 the Windows rehearsal of this pull request showed
  Pace Meter almost empty and a wrong weekly value, because the Windows usage
  engine loses Claude's weekly window and reset times whenever it falls back to
  its CLI source (marcus7989/Win-CodexBar#3). Paul decided in chat: "dann bau
  das pace meter zeug wieder aus aus dem pr und kommentier im issue, dass man
  das erst machen kann, wenn dieser upstream pr gemerged usw ist."
- Approved customer-visible result: Everything the three entries above added
  for #412 is gone from this pull request: the Pace Meter theme no longer
  appears in Appearance or in setup's theme step, and Theme Studio's "Binding"
  list and variable tokens no longer offer the six pace entries. Themes,
  previews and the VibeTV behave as on `main` in this respect. #412 stays open
  until the Windows engine delivers the reset times a pace needs.
- Approved files: the files named in the three entries above, restored to
  their state without #412, and this approval record.
## 2026-10-06 — Lost-VibeTV picker searches again after it is closed

- User approval: On 2026-10-06 Marcus was asked whether, after closing the
  lost-VibeTV dialog, the app should keep looking and show the dialog again if
  the VibeTV is still missing after three more checks, and answered "ja".
  The Codex review of PR #509 found that closing the picker ended the search
  until the app was restarted.
- Approved customer-visible result: Closing the lost-VibeTV picker (#358) with
  × or Escape no longer ends the search. If the saved VibeTV is still missing
  after the next three checks, the app searches once more: the saved VibeTV at
  a new address reconnects on its own, other VibeTVs found are offered in the
  same picker again. No other copy, control, or layout changes.
- Approved files: `control-center-app.tsx`, `device-recovery-gate.ts`, its
  test, and this approval record.

## 2026-10-05 — A legacy WiFi VibeTV that answers the cable switches to USB-C

- User approval: On 2026-10-05 Marcus approved the fix for issue #498 ("ja mach das"): a VibeTV that setup found and updated over WiFi stays in WiFi mode, where an animated theme can run out of memory. Setup switches it to the cable when the same VibeTV answers over the USB cable; a VibeTV without USB data stays on WiFi.
- Approved customer-visible result: While the app runs and the VibeTV it uses over WiFi leaves legacy WiFi mode because it answered over the USB cable, the app switches it to USB-C once, the same switch as choosing USB-C in Settings. Settings then shows USB-C selected. If the switch fails, VibeTV keeps working over WiFi without an error dialog and Settings still offers USB-C. A WiFi VibeTV that never answers the cable, and one whose customer chose WiFi on current firmware, stay on WiFi. No copy, layout or other control changes.
- Scope: `control-center-app.tsx`, `control-center-types.ts` and its test. This approves the pull request only, not merge, release, installation, or a device operation.

## 2026-10-06 — Merge of main into the legacy WiFi cable switch (#504)

- User approval: Same decision as the entry "A legacy WiFi VibeTV that answers the cable switches to USB-C" (2026-10-05, Marcus: "ja mach das"). No new decision was needed.
- Approved customer-visible result: Unchanged from that entry. `main` now contains #490 as one squashed commit, so this branch was merged with `main`; the result is `main` plus the unchanged change of that entry. No screen, copy, control or layout changes.
- Scope: The merge commit only. This approves the pull request only, not merge, release, installation, or a device operation.

## 2026-10-06 — The cable switch for a legacy WiFi VibeTV no longer depends on the open window

- User approval: Same decision as the entry "A legacy WiFi VibeTV that answers the cable switches to USB-C" (2026-10-05, Marcus: "ja mach das"). On 2026-10-06 Paul asked for the switch to be made more robust after one hardware run stayed on WiFi ("noch nicht mergen … die Umschaltung robuster haben, falls das nötig ist", relayed by his release coordination session, which also relayed his choice of this variant).
- Approved customer-visible result: Unchanged from that entry: the app switches such a VibeTV to USB-C once, the same switch as choosing USB-C in Settings; a failed switch leaves WiFi working without an error dialog; a VibeTV that never answers the cable and one whose customer chose WiFi on current firmware stay on WiFi. New is only when it works: the switch also happens when the app window did not itself see legacy WiFi mode, for example because another reader of the status or the app's own device search reached the VibeTV first, or because the window was opened later. No copy, layout or other control changes.
- Scope: `control-center-app.tsx`, `control-center-types.ts` and its test, plus the Companion (`server.go`, `runtimeconfig.go`). This approves the pull request only, not merge, release, installation, or a device operation.

## 2026-10-06 — A WiFi VibeTV that takes updates only over the cable is updated over the cable (#522)

- User approval: On 2026-10-06 Paul named issue #522 a blocker for the 1.0.62 release (recorded in the issue). In chat on 2026-10-06 he asked for #520, #521 and #522 to be fixed in one pull request ("bearbeite diese 3 issues, mach PR fertig"); the behaviour chosen for it: when such a VibeTV answers on the USB cable the update runs over the cable, otherwise it is refused before the upload with a message that says what to do. On 2026-10-06 Paul approved the shortened sentence below in chat: asked "Gibst du den neuen Satz frei?" with the new and the old wording side by side, he chose "Freigeben". Hardware run on 2026-10-06 (Mac, VibeTV 16198106): update started while the app was on WiFi, the app switched to USB-C within 11 s and the update finished with "Update complete."
- Approved customer-visible result: When an update is started for a VibeTV that is connected by WiFi and accepts updates only over the cable, and this VibeTV answers on the USB cable, the app connects it by USB-C (the same switch as choosing USB-C in Settings) and installs the update over the cable; Settings then shows USB-C selected. When it does not answer on the cable, the update stops before "Uploading firmware" with "VibeTV installs updates only over the USB cable." and "Connect VibeTV to this Mac with the USB cable, then update again." (before: the same message after the upload had failed, with "switch to USB-C in Settings" as an extra step; the Windows app shows "this computer" instead of "this Mac", as for every Companion message). A VibeTV still in legacy WiFi mode keeps updating over WiFi. No layout or control changes. The customer-flow contract test now expects the long request timeout on the update start as well.
- Scope: The Companion (`server.go` and its test) and the request timeout of the update start in `control-center-app.tsx`. This approves the pull request only, not merge, release, installation, or a device operation.
## 2026-10-01 — A stale provider no longer opens its message by itself

- User approval: On 2026-10-01 Paul reported that starting the app opened a "Codex — Live usage is unavailable; the last successful reading is still saved." dialog on Choose AI providers. That state appears for every enabled provider while CodexBar starts after the runtime restarted, and it recovers by itself.
- Approved customer-visible result: A provider row in the "stale" state (last reading still shown, live usage briefly unavailable) keeps its warning icon, but its message no longer opens as a dialog by itself on Choose AI providers or in Settings → AI providers. Clicking the warning icon still shows it. Every other provider message (sign-in, unsupported, outage, permission, no usage) opens exactly as before.
- Scope: `setup-providers-screen.tsx` (the provider list shared by setup and Settings), its test, and this approval record. This approves the pull-request branch only, not merge, release, installation, or a device operation.

## 2026-10-06 — "We couldn't find your VibeTV": the two choices look like cards

- User approval: On 2026-10-06 Paul asked for this after clicking the wrong choice in the dialog: "da sehen die beiden optionen gar nicht klickbar aus … ändere das, dass die klickbarer aussehen, wie die karten in den settings, mit nem anderen hintergrund oder so".
- Approved customer-visible result: In the dialog "We couldn't find your VibeTV" the two choices "Use the cable" and "Already on WiFi" are drawn like the connection cards in Settings: an outline, the card background, more padding, a hover tint and a pointer cursor, with a larger gap between them. Icons, titles, descriptions, the order, the two buttons below and what each choice does are unchanged.
- Scope: `SetupDeviceNotFoundDialog` in `apps/control-center/src/components/setup/setup-device-dialogs.tsx`. This approves the pull request only, not merge, release, installation, or a device operation.
## 2026-10-01 — The Gemini message names Antigravity without CodexBar

- User approval: On 2026-10-01 Paul asked that the Gemini message "Google no longer supports Gemini CLI OAuth for individual, AI Pro, or Ultra accounts. Enable CodexBar's Antigravity provider, sign in to Antigravity or run `agy`, then refresh." no longer name CodexBar, so that it only says to enable Antigravity.
- Approved customer-visible result: Wherever the app shows or copies CodexBar's Gemini migration message (the provider message dialog in setup and Settings and its Copy button), "CodexBar's Antigravity provider" reads "Antigravity": "… Enable Antigravity, sign in to Antigravity or run `agy`, then refresh." The rest of the sentence is unchanged.
- Scope: `companion/internal/companionapi/provider_reported.go` (the one place the reported provider message leaves the Companion), its test, the matching Control Center test fixture, and this approval record. The Companion's classification of the message still reads CodexBar's original sentence. This approves the pull-request branch only, not merge, release, installation, or a device operation.


## 2026-10-06 — A theme VibeTV cannot show is named as a theme problem (#498)

- User approval: Confirmed by Paul on 2026-10-07 (see the entry "Paul confirms the drafted entries" of that date); drafted during the unattended night batch of 2026-10-06.
- Approved customer-visible result: Approved by Paul on 2026-10-07. (1) When a theme install ends because VibeTV cannot draw the installed theme, the dialog reads "VibeTV can't show this theme." with "Choose another theme." (before: "Theme install failed: theme-pack/render-health: theme render not healthy: … renderError="low_heap_cba_buffer" …" with "keep VibeTV powered and retry theme install; if this repeats, contact support with `codexbar-display health` output"). The "Try again" button stays. The same two sentences appear for this entry in the setup log on the Support page. (2) Overview, Display tile, while a connected VibeTV reports that it cannot draw its active theme and an AI provider is ready: "Theme not shown" with "VibeTV can't show this theme. Choose another theme." (before: "Waiting for first image" with "Waiting for a fresh image from VibeTV."). (3) Support page, card "Connected VibeTV": the badge reads "Connected" and the description "The VibeTV currently controlled by this Mac." whenever the VibeTV is connected and paired, as the Overview already says (before: "Not connected" and "No VibeTV is currently connected." until the display was live, so also while only the theme failed or usage was still pending). No layout or control changes.
- Scope: The Companion (`server.go` and its test: connection state `display_render_failed`, the theme install error for a failed render check), `overview-screen.tsx`, `logs-screen.tsx`, `control-center-types.ts`, their tests, and this approval record. This is a draft for the pull request only, not approval for merge, release, installation, or a device operation.
## 2026-09-22 — The idle reset text verified on real hardware (#448)

- User approval: Marcus asked for the #448 fix to be tested on the real device
  ("mach den test auf echter hardware"). Issue #448 makes that verification an
  acceptance criterion, so this records the hardware evidence the earlier
  entries could not claim. No customer-visible behaviour is changed by this
  entry.
- Approved customer-visible result: Unchanged from the entries above. The
  hardware run confirms them: on VibeTV `16199591`
  (`esp8266-smalltv-st7789`) running the candidate firmware built from this
  branch, the published Claude Creature theme shows `No active session` for an
  idle Claude session, `Resets in 2h 0m` when a deadline exists, and
  `Reset unavailable` when the basis cannot be trusted. Night Clock, which
  binds only provider slots, behaves the same way.
- Evidence: `CODEX Test VibeTV Merge` run `35729768498` built firmware
  `9999.0.116` from this branch head; every job passed. Its `firmware.bin`
  matched the manifest SHA-256
  `8f2a0920b3de55bab6469f746e05885a8ff9444e0b0b1fd6d2ab64b873cdd855` and was
  installed over the device's cable transport, which then reported that exact
  firmware, a healthy display stream, and the published Claude Creature spec
  `/themes/u/claude--6-546f9e.json` active with `renderOk`. The device
  accepted the customer's exact idle wire frame from the issue. Rendering that
  same stored spec and frame through this branch's renderer prints
  `No active session`, while the pre-fix renderer on `main` prints
  `Resets in Reset unavailable` for identical inputs.
- Approved files: This approval record only.
- Scope: Recording hardware evidence. No code, theme, release, or customer
  device operation is part of this entry.

## 2026-10-06 — Idle reset text carried onto the current branch, with the stale cases kept honest (#448)

- User approval: Confirmed by Paul on 2026-10-07 (see the entry "Paul confirms the drafted entries" of that date); drafted during the unattended night batch of 2026-10-06.
- Approved customer-visible result: No new text. The results recorded for #448 on 2026-09-17, 2026-09-21 and 2026-09-22 are unchanged: an idle Claude session reads `No active session` instead of `Resets in Reset unavailable`, and a rate-limited provider check reads "Claude is limiting usage checks right now." with "Wait a few minutes, then check again. Nothing needs to be fixed." Three cases now show the already approved wording where the earlier branch showed the wrong one. The Control Center preview shows `Reset unavailable`, as the VibeTV does, when the frame is marked stale, when its five-hour trust budget has run out, or when it carries no reset time at all; it showed `No active session` there before. On the VibeTV, `No active session` changes back to `Reset unavailable` when the trust budget runs out even if no other countdown changes at that moment; it could stay on the screen before. In setup, a rate-limit answer that ends in "credentials were preserved" shows the wait message instead of asking the customer to sign in again.
- Scope: the merge of `codex/issue-448-idle-reset-text` into this branch, `live-vibetv-preview.tsx`, `codexbar_display_core.h`, `renderer_esp8266.cpp`, `renderer_esp8266_theme_spec.cpp`, `companion/internal/codexbar/provider_setup.go`, their tests, and this approval record. Not verified on hardware in this batch. This covers the branch only, not merge, release, installation, or a device operation.

## 2026-10-06 — "No active session" only for a window with nothing used (#448, review of #524)

- User approval: Confirmed by Paul on 2026-10-07 (see the entry "Paul confirms the drafted entries" of that date); drafted during the unattended night batch of 2026-10-06.
- Approved customer-visible result: Approved by Paul on 2026-10-07. No new text. On the VibeTV and in the Control Center preview, a usage window reads `No active session` only when it has no reset time and nothing used (0 % in "used" mode, 100 % in "remaining" mode). A window that shows usage but has no reset time reads `Reset unavailable` again, as it did before #448 (before this change: `No active session` beside, for example, 93 %, whenever the reset time had run out before the frame was sent or the provider reports none). A provider-slot countdown (`{pv1r}`, `{pv2r}`) with no reset time always reads `Reset unavailable`. The idle Claude session of #448 (0 %, no reset time, weekly window with a reset time) still reads `No active session`.
- Scope: `firmware_shared/codexbar_display_core.h`, `firmware_shared/theme_spec_renderer_core.h`, `apps/control-center/src/components/live-vibetv-preview.tsx`, their tests, `docs/theme-dev-guide.md`, `protocol/PROTOCOL.md`, and this approval record. Not verified on hardware in this batch. This is a draft for the pull request only, not approval for merge, release, installation, or a device operation.

## 2026-10-06 — Review fixes for #524: no new text, narrower conditions (#448, #498)

- User approval: Confirmed by Paul on 2026-10-07 (see the entry "Paul confirms the drafted entries" of that date); drafted during the unattended night batch of 2026-10-06.
- Approved customer-visible result: Approved by Paul on 2026-10-07. No new text and no layout change; four already drafted results appear in fewer cases. (1) Overview, Display tile: "Theme not shown" with "VibeTV can't show this theme. Choose another theme." no longer appears while the VibeTV is recovering by itself — an animation that is drawing into its frame buffer again after one tight moment, or a full redraw that found no memory and retries. Those show "Waiting for first image" as before #498. A theme whose animation never gets a frame buffer (the #498 case) and a broken theme file still show "Theme not shown". (2) Theme install dialog: "VibeTV can't show this theme." with "Choose another theme." appears only when the installed theme is active and reports that it cannot be drawn. When the health check could not be read, the theme is not active yet, or another theme is still up, the dialog keeps the earlier "Theme install failed: …" text with the retry advice. (3) Providers: a row whose check was rate-limited shows the working or the saved-reading state when a usage reading exists, and no longer blocks Continue in setup; without any reading it still shows the rate-limit message. (4) Providers: an error that only contains the digits 429 inside another number (a request id, a duration) shows its sign-in or time-out message instead of the rate-limit message. The setup provider row for a rate-limited provider looks the same as before; only a redundant code branch was removed.
- Scope: `companion/internal/companionapi/server.go`, `companion/internal/companionapi/preferences.go`, `companion/internal/themeinstall/themeinstall.go`, `companion/internal/codexbar/provider_setup.go`, `apps/control-center/src/components/setup/setup-provider-row.tsx`, `firmware_shared/codexbar_display_core.h` (unused helper removed), their tests, `protocol/PROTOCOL.md`, and this approval record. Not verified on hardware in this batch. This is a draft for the pull request only, not approval for merge, release, installation, or a device operation.

## 2026-10-06 — Review follow-up: another theme can be installed while the active one cannot be shown (#498)

- User approval: Confirmed by Paul on 2026-10-07 (see the entry "Paul confirms the drafted entries" of that date); drafted during the unattended night batch of 2026-10-06. The Codex review of PR #524 found that the Overview tells the customer to choose another theme while the theme library still refused every install with "Connect VibeTV first." because the display is not ready.
- Approved customer-visible result: No new screen, dialog, button, or text. While VibeTV reports that it cannot draw its active theme (`display_render_failed`), the Install buttons in Appearance stay usable for a connected, paired VibeTV instead of showing "Connect VibeTV first." A full redraw that found no memory on older firmware (`low_heap_full_render`) is treated like `low_heap` and does not show "Theme not shown".
- Scope: `theme-library-screen.tsx`, its test, the render rule in `companion/internal/companionapi/server.go`, its test, and this approval record. This approves the pull-request branch only, not merge, release, installation, or a device operation.

## 2026-10-07 — Review follow-up: the preview keeps retained usage unavailable (#448)

- User approval: Confirmed by Paul on 2026-10-07 (see the entry "Paul confirms the drafted entries" of that date); drafted during the unattended night batch of 2026-10-06. The Codex review of PR #524 found that the Control Center preview could read "No active session" for a 0 % window kept from a failed collection, while VibeTV shows "Reset unavailable" for it.
- Approved customer-visible result: No new screen, dialog, button, or text. When usage is marked unavailable, the preview shows "Reset unavailable" for a window without a reset time, the same as VibeTV.
- Scope: `live-vibetv-preview.tsx`, its test, and this approval record. This approves the pull-request branch only, not merge, release, installation, or a device operation.

## 2026-10-07 — Review follow-up: the preview needs a named reset source; a retried render is not a theme problem (#448, #498)

- User approval: Confirmed by Paul on 2026-10-07 (see the entry "Paul confirms the drafted entries" of that date); drafted during the unattended night batch of 2026-10-06. Two further findings of the Codex review of PR #524.
- Approved customer-visible result: No new screen, dialog, button, or text. The preview shows "No active session" only when the frame also names where its reset time came from, as VibeTV requires. A theme whose scene found no memory and is being retried (`parse_fail`) does not show "Theme not shown".
- Scope: `live-vibetv-preview.tsx`, its test, the render rule in `companion/internal/companionapi/server.go`, its test, and this approval record. This approves the pull-request branch only, not merge, release, installation, or a device operation.

## 2026-10-07 — "No active session" for an account with no reset time anywhere (#532)

- User approval: Confirmed by Paul on 2026-10-07 (see the entry "Paul confirms the drafted entries" of that date); drafted on 2026-10-07 for PR #524.
- Approved customer-visible result: Approved by Paul on 2026-10-07. No new text. An account in which no usage window has a reset time and nothing is used (for example a new Claude account at 0 % session and 0 % weekly) reads `No active session` on the VibeTV and in the Control Center preview code, where it read `Reset unavailable` before. This needs the new Mac App and the new firmware together; with only one of them updated the screen stays at `Reset unavailable`. It applies only to a current usage reading: after a failed provider check, when usage is unavailable, or once the five-hour trust budget has run out, the text is `Reset unavailable` as before. A window that shows usage but has no reset time still reads `Reset unavailable`. The running preview receives the frame's trust fields from the Companion (commit 8751a977) and shows the same text as the VibeTV.
- Scope: `companion/internal/protocol/protocol.go`, `firmware_shared/codexbar_display_core.h`, `apps/control-center/src/components/live-vibetv-preview.tsx`, their tests, `protocol/fixtures/v2/reset_trust_golden.json`, `docs/theme-dev-guide.md`, `protocol/PROTOCOL.md`, and this approval record. Not verified on hardware. This is a draft for the pull request only, not approval for merge, release, installation, or a device operation.

## 2026-10-07 — The window follows the VibeTV the Companion reports as connected

- User approval: Confirmed by Paul on 2026-10-07 (see the entry "Paul confirms the drafted entries" of that date); drafted on 2026-10-07 for PR #524.
- Approved customer-visible result: Approved by Paul on 2026-10-07. No new screen, dialog, button, or text. When the connection is changed to another VibeTV outside the open window (observed on 2026-10-07: from a WiFi VibeTV to one on the cable), the window shows that VibeTV as connected as soon as the Companion reports it connected, active and paired. Before, the window kept waiting for the earlier VibeTV: the Overview read "Not connected" with "VibeTV: Not connected" and "Display: Waiting for first image", and the dialog "No VibeTV device was found." with the earlier VibeTV marked "Previously connected" stayed open until the window was reloaded. That dialog now closes by itself in this case and its list is emptied. Unchanged: a VibeTV that is really lost still opens the dialog after three missed checks, the dialog only ever reconnects the saved VibeTV by itself, any other VibeTV needs the customer's Connect, and closing the dialog still searches again after three more missed checks.
- Scope: `apps/control-center/src/components/device-recovery-gate.ts`, its test, the new `control-center-app.lost-device.test.tsx`, and this approval record. Not verified on hardware. This is a draft for the pull request only, not approval for merge, release, installation, or a device operation.

## 2026-10-07 — #532 entry corrected: the running preview shows the same text as VibeTV

- User approval: Confirmed by Paul on 2026-10-07 (see the entry "Paul confirms the drafted entries" of that date); drafted on 2026-10-07 for PR #524.
- Approved customer-visible result: Approved by Paul on 2026-10-07. No new text. The #532 entry above first named a gap in the running preview; that gap was closed in commit 8751a977 and the entry's last sentence was corrected. The Control Center preview receives the frame's reset trust from the Companion and reads `No active session` for an account with no reset time anywhere, as the VibeTV does. Paul read `No active session` on the VibeTV itself on 2026-10-07.
- Scope: this approval record only; the code is the sent-frame log line in `companion/internal/daemon/daemon.go` and its reader in `companion/internal/companionapi/server.go`. This approves the pull-request branch only, not merge, release, installation, or a device operation.

## 2026-10-07 — Paul confirms the drafted entries of PR #524

- User approval: On 2026-10-07 Paul asked to be shown everything he has to approve, was given the list of all entries of 2026-10-06 and 2026-10-07 that were marked "not yet confirmed by Paul", asked about two of them (the Overview Display tile "Theme not shown" with "VibeTV can't show this theme. Choose another theme.", and the increased-contrast styles), and answered "ok passt beides, trag meine freigabe ein".
- Approved customer-visible result: The results of those entries as written, without changes to their wording: the theme-install dialog "VibeTV can't show this theme." with "Choose another theme."; the Display tile "Theme not shown" for a theme the VibeTV reports twice that it cannot draw, with "Waiting for first image" unchanged for every other case; "Connected" on the Support page in that state; "No active session" for an idle window and for an account with no reset time anywhere, "Reset unavailable" otherwise; the rate-limit message for a "credentials were preserved" answer; Install staying usable while a theme is not shown; the lost-VibeTV dialog closing once the Companion reports a connected VibeTV; and, in PR #525, the support timeline in the downloaded report, the screen-reader names and focus behaviour, and the styles that apply only with the system setting "Increase contrast".
- Scope: the entries above that now read "Confirmed by Paul on 2026-10-07" and this approval record. This approves the customer-visible results on the pull-request branch only, not merge, release, installation, or a device operation.

## 2026-10-08 — Usage display preference in Settings (#183)

- User approval: Drafted in the overnight batch of 2026-10-08 and covered by Paul's blanket approval of 2026-10-07 for that batch. Paul has not yet seen this wording.
- Approved customer-visible result: Not yet seen by Paul; covered by the blanket approval only. Settings, section `Display`, gets one new row under `Brightness`: the label `Usage display` with a select offering exactly `Default`, `Used` and `Remaining`. `Default` shows usage the way it was shown before this row existed and does not name where that comes from; `Used` and `Remaining` set it for the VibeTV, the Usage page and the previews, and the change is saved as soon as it is chosen. The row is greyed out while another Settings action is running and is not shown when the Mac App does not offer the preference. A refused change leaves the select on the stored value and opens the existing error dialog with the Mac App's existing text `This setting could not be updated.` and `Try again in a moment.`; when the app has no answer to show, the dialog reads `Display settings need attention.` No other screen, dialog, or text changes.
- Scope: `settings-screen.tsx`, `preference-control.tsx` (the select carries its preference ID so the label points at it), `control-center-app.tsx`, their tests, the descriptor label and options in `companion/internal/companionapi/display_preferences.go`, `docs/preferences.md`, and this approval record. Not verified on hardware in this batch. This covers the branch only, not merge, release, installation, or a device operation.

## 2026-10-08 — Automatic can switch providers on a timer (#322)

- User approval: Drafted in the overnight batch of 2026-10-08 and covered by Paul's blanket approval of 2026-10-07 for that batch. Paul has not yet seen this wording.
- Approved customer-visible result: Not yet seen by Paul; covered by the blanket approval only. Settings, section `Display mode`, keeps the two cards `Automatic` and `Manual` and gets one new row below them, shown only while `Automatic` is chosen: the label `Switch providers` with a select offering `When activity changes` (the default, today's behaviour), `Every 30 seconds`, `Every minute` and `Every 5 minutes`. The choice is saved as soon as it is made. With an interval chosen, VibeTV shows each provider that has a current reading for that long and then the next one; usage on another provider no longer changes the screen early, a provider without a reading is skipped, and a single remaining provider stays on screen. While an interval is chosen, the `Automatic` card in Settings reads `VibeTV switches between your providers on a timer.` instead of `VibeTV switches between your providers based on recent activity and usage.`; with `When activity changes` it reads as before. The setup wizard's `Display Mode` step is unchanged and does not offer the timer. A refused change behaves like the `Usage display` row of #183. `docs/customer-setup.md` step 4 now says `Automatic` switches between providers, follows activity, and can be put on a timer in Settings.
- Scope: `settings-screen.tsx`, `setup/setup-display-mode-screen.tsx` (optional description for the Automatic card), their tests, the descriptor label and options in `companion/internal/companionapi/display_preferences.go`, the rotation in `companion/internal/daemon/daemon.go`, `docs/preferences.md`, `docs/customer-setup.md`, and this approval record. Not verified on hardware in this batch. This covers the branch only, not merge, release, installation, or a device operation.

## 2026-10-08 — Theme Studio: one color of a sprite can be made transparent (#83)

- User approval: Drafted in the overnight batch of 2026-10-08 and covered by Paul's blanket approval of 2026-10-07 for that batch. Paul has not yet seen this wording.
- Approved customer-visible result: Not yet seen by Paul. Theme Studio, Inspector of a selected sprite element whose sprite is loaded in the draft and has at least two colors: below Frames / FPS / Columns there is a new group with the heading "Transparent color" and one square swatch per color of the sprite. Each swatch carries its color value, for example "#000000", as its tooltip and its screen-reader name. Clicking a swatch marks it, clicking it again unmarks it. While a swatch is marked, the button "Make transparent" is shown below the swatches. Clicking it makes every pixel of that color transparent in all frames of that sprite, in the preview and in the saved, exported and sent theme, and removes the swatch; every element that uses the same sprite changes with it, and Undo brings the color back. The other colors stay as they are, so black pixels survive when another color is picked. The group is not shown for GIF elements or for a sprite with a single color. No other screen, dialog, or text changes, and a theme changes only when the button is used.
- Scope: `primitive-inspector.tsx`, `theme-studio-screen.tsx`, `theme-studio-assets.ts`, their tests, `docs/themes.md`, and this approval record. Not looked at in the running app and not verified on hardware in this batch. This is a draft for the branch only, not approval for merge, release, installation, or a device operation.

## 2026-10-08 — Theme Studio: five display defects found by testing the Windows app

- User approval: Drafted in the overnight batch of 2026-10-08 and covered by Paul's blanket approval of 2026-10-07 for that batch. Paul has not yet seen this wording or these screens.
- Approved customer-visible result: Not yet seen by Paul; covered by the blanket approval only. Five corrections in the Theme Studio, no new control. (1) `Advanced`: the four tabs `Project`, `Assets`, `JSON` and `Device` stay in two rows inside the grey tab bar, and the panel starts below the bar. Before, the bar was one row high, so `JSON` and `Device` lay on top of the `Name` label and of the `Device` card. (2) Inspector of a text element, group `Variables`: the 13 buttons are listed one per row instead of two per row, and each shows its whole label and its whole token, for example `Usage window 1 label` and `{usageSlot1Label}`; where both do not fit on one line the token moves to a second line inside the button. Before, 11 of the 13 were cut to texts like `Usage …` and `{usag…`. Labels, tokens, their order and what a click inserts are unchanged. (3) The selects `Show when` and `Binding` show `Always` and `None` when that is the current choice, where they were an empty box. Their options and the saved theme are unchanged. (4) The element count reads `1 element` for exactly one element and `2 elements`, `3 elements`, … otherwise, where it read `1 elements`. The last status badge has one new word: a theme that is not in the library and has no changes yet — a new theme, or a published theme opened for editing — reads `Draft` in the grey badge style, where it read `Saved` in green. `Saved` now appears only for a theme that is in the library and has no unsaved changes: after `Save theme`, or for a theme opened from the library. `Unsaved changes` is unchanged, and so is which buttons are enabled; `Send to VibeTV` is still enabled for an unchanged draft. (5) The dashed box around a selected text element is as wide as the text the preview draws, for the two fonts the preview draws with the VibeTV's own letter widths (fonts 1 and 2); a new `Text` element at font size 2 gets a 48-pixel box where it got 39. The same width now decides three more things for a text element: `Fit box to text` sets the box to the width the text is drawn with, the note `Text is shrunk to fit the …px box.` appears exactly when the drawn text is wider than its box, and dragging the resize handle cannot make the box narrower than the drawn text. No other screen, dialog, or text changes, and no saved theme changes by itself.
- Scope: `theme-studio/advanced-panel.tsx`, `theme-studio/editor-fields.tsx`, `theme-studio/primitive-inspector.tsx`, `theme-studio/editor-geometry.ts`, `theme-studio-screen.tsx`, their tests, and this approval record. Looked at in a local browser on the Mac at window widths 960, 1024, 1180, 1280 and 1600, with the Theme Studio opened on a new theme outside the app; not looked at in the running Windows or Mac app and not verified on hardware in this batch. This is a draft for the branch only, not approval for merge, release, installation, or a device operation.

## 2026-10-08 — Theme Studio: the transparent-color control says what VibeTV shows (#83)

- User approval: Drafted in the overnight batch of 2026-10-08 and covered by Paul's blanket approval of 2026-10-07 for that batch. Paul has not yet seen this wording.
- Approved customer-visible result: Not yet seen by Paul; covered by the blanket approval only. In the group "Transparent color" of the sprite Inspector, below the swatches and the "Make transparent" button, there is always one muted line: "On VibeTV, transparent areas show the theme background." It was added after the code review of the batch: the preview shows what lies underneath a keyed sprite, the device fills those pixels with the theme background. Nothing else changes.
- Scope: `primitive-inspector.tsx`, its test, and this approval record. Not looked at in the running app in this batch. This is a draft for the branch only, not approval for merge, release, installation, or a device operation.

## 2026-10-08 — The reset countdown reads the same on Overview, Usage and Settings

- User approval: Drafted in the overnight batch of 2026-10-08 and covered by Paul's blanket approval of 2026-10-07 for that batch. Paul has not yet seen this result. Exploratory testing in that batch read `Reset in 23m` on the Overview, `Reset in 26m` on the Usage page and `RESET IN 26M` in the Settings display-mode preview at the same moment, with 23.7 minutes actually left.
- Approved customer-visible result: Not yet seen by Paul; covered by the blanket approval only. No new screen, dialog, button, or wording. The reset time on the Usage page (`Reset in …` beside each usage bar) and in the display-mode preview (Settings and the setup wizard's `Display Mode` step) is counted from the moment the usage was read to the current time, as the Overview preview already does, and is rounded down to whole minutes like the VibeTV itself. In the observed case the Usage page and the Settings preview read `Reset in 23m` like the Overview, where they read 26. The text keeps counting down between two usage readings; it moves each time the window redraws, which is every second while a VibeTV is connected and about every five seconds otherwise. Because of the shared rounding the Usage page reads `Reset in 0m` during the last minute, where it read `Reset in 1m`. Once the reset time has passed without a new reading, the Usage page shows no reset text beside that bar and the display-mode preview reads `Reset unknown`, where both kept the last value before. The Overview preview and what the VibeTV shows are unchanged.
- Scope: the new `apps/control-center/src/lib/reset-countdown.ts`, `usage-screen.tsx`, `setup/setup-display-previews.ts`, `live-vibetv-preview.tsx` (same result, now through the shared helper), the new `reset-countdown.test.tsx`, and this approval record. Not looked at in the running app and not verified on hardware in this batch. This covers the branch only, not merge, release, installation, or a device operation.

## 2026-10-08 — The live theme stays "Installed" while the screensaver is on screen

- User approval: Drafted in the overnight batch of 2026-10-08 and covered by Paul's blanket approval of 2026-10-07 for that batch. Paul has not yet seen this result. Exploratory testing in that batch found that once VibeTV was in standby and showed the `Night Clock` screensaver, Appearance › Themes offered `Install` on all six themes, the live theme included, and Support read `Active theme` `Night Clock`.
- Approved customer-visible result: Not yet seen by Paul; covered by the blanket approval only. No new screen, dialog, button, or wording. While VibeTV shows its screensaver in standby, Appearance › Themes keeps the customer's live theme marked `Installed` (button greyed out, tooltip `Theme is already installed.`) as it is while VibeTV is awake, and Support › `Connected VibeTV` › `Active theme` names that live theme, for example `Mini Classic`, instead of the screensaver. Known limits: this holds for themes from the catalog. A theme made in Theme Studio cannot be recognised from what VibeTV reports during standby, so during standby it still offers `Install` and Support still names the screensaver; a Theme Studio theme derived from a catalog theme can share the start of that theme's file name on VibeTV, and during standby the catalog theme is then the one marked `Installed`. For the roughly ten seconds in which a freshly installed screensaver is previewed on VibeTV, the live theme still offers `Install` and Support names the screensaver. All of this is right again as soon as VibeTV shows the live theme. The Overview preview is unchanged: it mirrors the screen and therefore shows the screensaver during standby.
- Scope: `apps/control-center/src/lib/active-theme-upgrade.ts`, `theme-library-screen.tsx`, `logs-screen.tsx`, `control-center-app.tsx` (hands the catalog to the Support page), their tests, and this approval record. The Mac App's status answer and the firmware are unchanged. Not looked at in the running app and not verified on hardware in this batch. This covers the branch only, not merge, release, installation, or a device operation.

## 2026-10-08 — A provider that delivers usage opens no browser sign-in message, and that message is in our words again

- User approval: Drafted in the overnight batch of 2026-10-08 and covered by Paul's blanket approval of 2026-10-07 for that batch. Paul has not yet seen this result. It answers a finding from testing the Windows app in that batch: with Claude on and delivering usage, switching Codex on opened a dialog titled "Claude" by itself that showed the usage engine's list of failed sources ("Claude usage failed from all configured sources. Web: No cookies available for web API; OAuth: [redacted] error: Claude OAuth usage endpoint is rate limited. Retrying in about 1s; … [claude:browser-sign-in-required https://claude.ai/login]").
- Approved customer-visible result: Not yet seen by Paul; covered by the blanket approval only. Two results in Settings → AI providers and on Choose AI providers. (1) A provider whose current usage reading has arrived keeps its row as it is — no warning icon, no "Open <Provider> sign-in in your browser" action, no dialog, and it stays available for Continue and the display mode — when a check of it reports a browser sign-in. Before, one throttled check put the row into the browser sign-in state and opened its dialog by itself although the provider kept delivering. Without a current reading the browser sign-in row and its dialog appear as before. (2) The dialog of a provider that needs a browser sign-in shows the sentence approved for that row on 2026-09-17, "Claude usage needs a signed-in claude.ai session in your browser. Sign in to claude.ai in your browser, close the browser, then check again.", instead of the usage engine's list of failed sources with its bracketed marker and sign-in address. The row showed that sentence until provider messages moved into the dialog with PR #407. In this state the dialog no longer has the "Copy provider message for <Provider>" button, because the Mac App no longer keeps the engine's text for it, and a row that is "stale" after such a check shows "Live usage is unavailable; the last successful reading is still saved." without that text appended. Only the Windows usage engine reports this state today. Unchanged: every other provider state still shows the usage engine's own sentence with the Copy button as approved on 2026-09-02, 2026-09-10 and 2026-09-29, including a rate-limited check without a reading and a signed-out provider; OK, the warning icon, "Check again" and the switch behave as before.
- Scope: `companion/internal/codexbar/providers.go` and `provider_setup.go`, `companion/internal/companionapi/preferences.go`, their tests, one Control Center test in `setup-providers-screen.test.tsx` (no Control Center code changed), and this approval record. Not looked at in the running app and not verified on hardware in this batch. This covers the branch only, not merge, release, installation, or a device operation.

## 2026-10-08 — The screensaver activity entry says "1 minute"

- User approval: Drafted in the overnight batch of 2026-10-08 and covered by Paul's blanket approval of 2026-10-07 for that batch. Paul has not yet seen this wording. It answers a finding from testing the Windows app in that batch: the entry read "The screensaver starts after 1 minutes at …".
- Approved customer-visible result: Not yet seen by Paul; covered by the blanket approval only. Support → Recent activity: after a screensaver that starts after one minute is saved, the entry "Screensaver saved" reads "The screensaver starts after 1 minute at 20% brightness." instead of "… after 1 minutes at 20% brightness." Every other duration reads as before, for example "… after 5 minutes at 20% brightness." No other screen, dialog, or text changes.
- Scope: `control-center-app.tsx` (the entry now uses the label of the "Show after" list in Settings), one test in `control-center-app.display-preferences.test.tsx`, and this approval record. Not looked at in the running app and not verified on hardware in this batch. This covers the branch only, not merge, release, installation, or a device operation.

## 2026-10-08 — A Theme Studio theme is not replaced by a catalog theme while the screensaver is on screen

- User approval: Drafted in the overnight batch of 2026-10-08 and covered by Paul's blanket approval of 2026-10-07 for that batch. Paul has not yet seen this result. It answers a finding from that batch, reproduced in tests with the shipped catalog and the file name Theme Studio really produces: a copy of `Mini Classic` edited in Theme Studio is stored on VibeTV as `mini-cl-1-…`, the catalog theme as `mini-cl-9-…`. While VibeTV showed its screensaver in standby, the open app took the copy for an old revision of `Mini Classic` and installed the catalog theme over it by itself, which also removed the customer's theme files from VibeTV. The same held for copies of `Synthwave` and `Claude Creature` and for any own theme whose ID starts with `mini-cl`, `synthwa` or `claude-`.
- Approved customer-visible result: Not yet seen by Paul; covered by the blanket approval only. No new screen, dialog, button, or wording. While VibeTV shows its screensaver in standby and its live theme is such a Theme Studio theme, the app leaves it alone: no install screen on VibeTV, no `Theme install started` / `Theme installed` entries under Support › Recent activity, no pending VibeTV update on the Updates tab, and after standby VibeTV shows the customer's own theme again instead of the catalog theme. During standby Appearance › Themes then offers `Install` on the catalog theme instead of marking it `Installed`, and Support › `Connected VibeTV` › `Active theme` names the screensaver instead of the catalog theme, as for every other Theme Studio theme; this replaces the limit recorded for that case in the entry "The live theme stays "Installed" while the screensaver is on screen". One case gets slower: a VibeTV that still holds the very first revision of a catalog theme (file name `…-1-…`, as installed by public release v1.0.52) is not recognised during standby either, because Theme Studio themes carry the same revision number. Its theme update starts once VibeTV shows the live theme again and the app is open, and until then Themes offers `Install` for it and Support names the screensaver. Every later catalog revision is still recognised and updated during standby as before. Nothing changes while VibeTV is awake.
- Scope: `apps/control-center/src/lib/active-theme-upgrade.ts`, its test, the new `control-center-app.custom-theme-standby.test.tsx`, and this approval record. The Mac App's status answer, Theme Studio's file names, the screensaver slot and the firmware are unchanged. Not looked at in the running app and not verified on hardware in this batch. This covers the branch only, not merge, release, installation, or a device operation.

## 2026-10-08 — "Refreshing usage" ends within seconds of the new values (#544)

- User approval: Drafted in the overnight batch of 2026-10-08 and covered by Paul's blanket approval of 2026-10-07 for that batch. Paul has not yet seen this result. It answers a finding from testing the Windows app in that batch: after a click on Refresh on the Usage page, "Refreshing usage" stayed for about 70 seconds although the Mac App had the new values after about 40.
- Approved customer-visible result: Not yet seen by Paul; covered by the blanket approval only. No new screen, dialog, button, or wording. While a refresh the customer asked for is still waiting for new values, the window asks the Mac App for usage every 3 seconds instead of every 30, so the notice "Refreshing usage" with "Current values stay visible while VibeTV waits for a new usage snapshot." disappears at most about 3 seconds after the new values are there. This applies on Usage, Overview and Settings, the pages that read usage. Without a pending refresh the window reads usage every 30 seconds as before. The Refresh button itself is unchanged: it still reads "Refreshing" only for the moment the request takes.
- Scope: `usage-surface-polling.ts`, `control-center-app.tsx`, the new `control-center-app.usage-refresh.test.tsx`, and this approval record. The Mac App is unchanged. Not looked at in the running app and not verified on hardware in this batch. This covers the branch only, not merge, release, installation, or a device operation.

## 2026-10-08 — Support: Download confirms on Windows that the report was saved (#545)

- User approval: Drafted in the overnight batch of 2026-10-08 and covered by Paul's blanket approval of 2026-10-07 for that batch. Paul has not yet seen this wording. It answers a finding from testing the Windows app in that batch: Support › Download wrote the report into the Downloads folder without any sign, and a second click created a second file.
- Approved customer-visible result: Not yet seen by Paul; covered by the blanket approval only. Support, card `Support report`, on Windows: after a click on `Download` the button reads `Downloaded`, as `Copy` reads `Copied`, and one muted line appears below the buttons: `Saved as vibetv-support-report-2026-10-07T06-58-00-000Z.json in your Downloads folder.` with the name of the file that was written. The button stays usable. `Create again`, or a new report from `Run diagnostics`, puts the button back to `Download` and removes the line, because that report has not been saved. On the Mac nothing changes: there macOS asks where to save the file and the customer can cancel, so the app does not claim a saved file. Known limit: a second click on Windows saves a second file to which Windows adds ` (1)`; the line still shows the first name.
- Scope: `support-report-actions.tsx`, `logs-screen.tsx` (hands over that the app runs on Windows), `support-report-actions.test.tsx`, and this approval record. Not looked at in the running app in this batch. This covers the branch only, not merge, release, installation, or a device operation.

## 2026-10-08 — "Run setup again" asks first (#546)

- User approval: Drafted in the overnight batch of 2026-10-08 and covered by Paul's blanket approval of 2026-10-07 for that batch. Paul has not yet seen this dialog or its wording. It answers a finding from the Windows walk-through of that batch: `Run setup again` started at once, while `Reset to factory settings` beside it asks first.
- Approved customer-visible result: Not yet seen by Paul; covered by the blanket approval only. A click on `Run setup again`, in Settings › Setup and on the Support page alike, opens a dialog over the current page instead of starting at once: title `Run setup again?`, text `You connect VibeTV and choose your AI providers and display mode again. VibeTV keeps its WiFi details, settings and themes.`, and the buttons `Cancel` and `Run setup again`. `Cancel` and the Escape key close the dialog and change nothing. `Run setup again` in the dialog does what the button did before: the button reads `Resetting` (Settings) or `Resetting setup` (Support) and the setup wizard opens. The dialog has no close cross and is built like the factory-reset question (title, text, two buttons); its confirming button is the primary one, not the red one, because nothing is erased. The factory reset, which runs setup afterwards, asks only its own question as before.
- Scope: `control-center-app.tsx` (the question, built with the existing `SetupDialog`), one test in `control-center-app.display-preferences.test.tsx`, the seven places in `apps/control-center/scripts/test-customer-flows.mjs` that press `Run setup again` (they now confirm the question; that suite was not run in this batch), and this approval record. `settings-screen.tsx`, `logs-screen.tsx` and the Mac App are unchanged. Not looked at in the running app and not verified on hardware in this batch. This covers the branch only, not merge, release, installation, or a device operation.

## 2026-10-08 — Five small corrections from the Windows walk-through (#548)

- User approval: Drafted in the overnight batch of 2026-10-08 and covered by Paul's blanket approval of 2026-10-07 for that batch. Paul has not yet seen these results or the two changed sentences. They answer five of the points collected in issue #548 from testing the Windows app in that batch.
- Approved customer-visible result: Not yet seen by Paul; covered by the blanket approval only. No new screen, dialog, or button. (1) Appearance › Screensavers: the notice `Screensaver is turned off` with `Turn on Show screensaver to install and use a screensaver.` is shown in the normal text color with an info icon, where it was red with a warning icon. Its wording is unchanged. (2) Settings › Display mode and the setup wizard's `Display Mode` step: the preview sits at the top edge of both cards, `Automatic` and `Manual`. Before, in Settings the preview in the `Manual` card sat 9 pixels lower than in the `Automatic` card, because its description is one line shorter and the card content was centred. (3) Theme Studio: a Bar added with the `Bar` button starts with the binding `Usage window 1 %`, the one the built-in themes use, where it started with `Session (legacy)`. Existing bars and saved themes are unchanged, and the Binding list still offers the legacy entries. Like the built-in themes, a theme with such a bar declares `usage-slots-v1` and can be sent only to a VibeTV whose firmware reports that; an older one gets the existing message `This VibeTV needs a firmware update before it can use this theme.` (4) Support › Recent activity: an entry that has the same title and text as the newest entry is not added again, so `Settings loaded` with `Brightness is set to 20%.` appears once instead of several times in a row; the entry keeps the time of its first occurrence. The same entry appears again after a different entry. `Theme installed`, `Screensaver installed` and `Waiting for VibeTV confirmation` now carry the time at which they are written instead of a time taken about a second earlier, so they are no longer listed above a `Settings loaded` entry with a later time. The same list is what the support report and the `Ask AI to fix` prompt carry. (5) Two sentences in plain words: Support › Diagnostics, row `Mac App` (`App` on Windows), reads `Mac App is running.` (`App is running.` on Windows) where it read `Mac App is responding on loopback.`; in the downloaded report the same check reads `Companion API is running.` And the first entry of Recent activity, `Control Center opened`, reads `This session started.` where it read `Browser session started.` Not changed: the support report on Windows still says `Mac App is up to date.` and `installationMode: "dmg"`; both are internal values other code compares against, and the report is not translated.
- Scope: `theme-library-screen.tsx`, `setup/setup-display-mode-screen.tsx`, `theme-studio/editor-geometry.ts`, `control-center-app.tsx`, their tests, the fixture in `setup/setup-ai-prompt.test.ts`, the check sentence in `companion/internal/companionapi/server.go` with one assertion in `server_test.go`, and this approval record. The 9-pixel offset and its correction were reproduced in a headless browser with a static copy of the card layout; nothing was looked at in the running app or verified on hardware in this batch. This covers the branch only, not merge, release, installation, or a device operation.

## 2026-10-08 — A display setting keeps the value just chosen when an older read answers late

- User approval: Drafted in the overnight batch of 2026-10-08 and covered by Paul's blanket approval of 2026-10-07 for that batch. Paul has not yet seen this result.
- Approved customer-visible result: Not yet seen by Paul; covered by the blanket approval only. No new screen, dialog, button, or wording. In Settings, `Usage display` and `Switch providers` keep the value the customer just chose when a read of these settings that had started earlier answers afterwards; before, the control could jump back to the old value although the new one was stored. Found by the automated review of pull request #541.
- Scope: `control-center-app.tsx`, one test in `control-center-app.display-preferences.test.tsx`, and this approval record. This is a draft for the branch only, not approval for merge, release, installation, or a device operation.

## 2026-10-08 — A repeated activity entry shows the time of its latest occurrence

- User approval: Drafted in the overnight batch of 2026-10-08 and covered by Paul's blanket approval of 2026-10-07 for that batch. Paul has not yet seen this result.
- Approved customer-visible result: Not yet seen by Paul; covered by the blanket approval only. No new wording. Support, `Recent activity`: when the same entry would be written again directly after itself (same title and detail), the one entry that stays now carries the time of the latest occurrence instead of the first. Before this correction three identical failures in a row showed as one entry with the oldest time. Found by the second code review of the batch.
- Scope: `recentEventsWith` in `control-center-app.tsx`, its test in `control-center-app.test.ts`, and this approval record. This is a draft for the branch only, not approval for merge, release, installation, or a device operation.

## 2026-10-08 — A test shows that a Theme Studio theme never reaches VibeTV under a catalog theme's id

- User approval: Drafted in the overnight batch of 2026-10-08 and covered by Paul's blanket approval of 2026-10-07 for that batch. Paul has not yet seen this result.
- Approved customer-visible result: Not yet seen by Paul; covered by the blanket approval only. Nothing the customer sees changes: this adds a test and no product code. The test records what the app already does. In Theme Studio, after `Mini theme`, after a catalog id typed into `ID`, after `Import theme JSON` and after `Apply JSON`, `Send to VibeTV` stays disabled until `Save theme`. Save changes an id that a catalog theme already has, for example `mini-classic` to `mini-classic-2`, and the `ID` field shows the new id. `Send to VibeTV` and `Install` on the theme's library row then send it under that id, and the automatic theme update leaves it alone. A copy opened with `Edit` on a catalog theme can be sent without saving and goes out as `mini-classic-custom`.
- Scope: the new test `theme-library-screen.catalog-id.test.tsx` and this approval record. Checked in a unit test with the shipped catalog only; nothing was looked at in the running app or verified on hardware. This is a draft for the branch only, not approval for merge, release, installation, or a device operation.

## 2026-10-08 — While "Refreshing usage" is shown only usage is read faster

- User approval: Drafted in the overnight batch of 2026-10-08 and covered by Paul's blanket approval of 2026-10-07 for that batch. Paul has not yet seen this result.
- Approved customer-visible result: Not yet seen by Paul; covered by the blanket approval only. No visible change against the entry for #544: `Refreshing usage` still ends within a few seconds of the new values. Behind it, only the usage reading is asked for every 3 seconds while a refresh is pending; the provider list keeps its 30 second cadence, so a pending refresh no longer starts a provider check in the usage engine every ten seconds. Found by the second code review of the batch.
- Scope: `control-center-app.tsx`, `control-center-app.usage-refresh.test.tsx`, and this approval record. This is a draft for the branch only, not approval for merge, release, installation, or a device operation.

## 2026-10-08 — Two quick changes of a display setting are stored in the order they were made

- User approval: Drafted in the overnight batch of 2026-10-08 and covered by Paul's blanket approval of 2026-10-07 for that batch. Paul has not yet seen this result.
- Approved customer-visible result: Not yet seen by Paul; covered by the blanket approval only. No new screen, dialog, button, or wording. In Settings, when the customer changes `Usage display` or `Switch providers` twice in quick succession, the second choice is the one that is stored and shown; before, a slow first write could finish last and leave the first choice stored. Found by the automated review of pull request #541.
- Scope: `control-center-app.tsx`, one test in `control-center-app.display-preferences.test.tsx`, and this approval record. This is a draft for the branch only, not approval for merge, release, installation, or a device operation.

## 2026-10-08 — A provider message closed with OK stays closed when Settings is opened again

- User approval: Drafted in the overnight batch of 2026-10-08 and covered by Paul's blanket approval of 2026-10-07 for that batch. Paul has not yet seen this result. It answers a finding from testing the Windows app in that batch (build of `deedf84b`, seen twice): in Settings › AI providers Codex was switched on while signed out, its dialog (reported as "Codex – Authentication required") was closed with OK, and after a visit to Overview the same dialog opened again in Settings about a second later. It did so on every visit and took a click meant for the `Show screensaver` switch.
- Approved customer-visible result: Not yet seen by Paul; covered by the blanket approval only. No new screen, dialog, button, or wording. A provider message the customer closed with OK or Close stays closed for that provider while the provider reports the same message, until the app is restarted: also after leaving Settings and coming back, and between Choose AI providers in setup and Settings › AI providers, which show the same list. Before, it stayed closed only as long as that page stayed on screen; the rule itself was approved on 2026-09-10 ("Polling does not reopen acknowledged messages"). The dialog still opens by itself when the provider reports a different message, and on request as before: from the warning icon on the row, after `Check again`, and after the provider's switch is pressed. Starting the sign-in still leaves it closed (2026-09-19), and a row in the "stale" state still opens its message only from the warning icon (2026-10-01), also on a later visit. After the app was quit and started again, or its page was reloaded, a message that still applies opens once. Known limit, unchanged from the behaviour inside one visit: a provider that worked in between and then reports exactly the same message again does not open its dialog by itself; its row shows the warning icon and its actions.
- Scope: `setup/setup-providers-screen.tsx` (the provider list shared by setup and Settings), its test, one step of `apps/control-center/scripts/test-customer-flows.mjs` that closed the reopened dialog a second time after returning to Settings (it now expects no dialog; that suite was not run in this batch), and this approval record. `control-center-app.tsx` and the Mac App are unchanged. Not looked at in the running app and not verified on hardware in this batch. This covers the branch only, not merge, release, installation, or a device operation.

## 2026-10-08 — With Automatic chosen, the Manual card previews the provider Manual would show

- User approval: Drafted in the overnight batch of 2026-10-08 and covered by Paul's blanket approval of 2026-10-07 for that batch. Paul has not yet seen this result. It answers a finding from testing the Windows app in that batch (seen three times): in Settings › Display mode with `Automatic` chosen and two providers switched on, the first in the list signed out and the second (Claude) delivering usage, the preview on the `Manual` card read `No usage yet` (shown in capitals), although a click on `Manual` then showed Claude.
- Approved customer-visible result: Not yet seen by Paul; covered by the blanket approval only. No new screen, dialog, button, or wording. Settings › Display mode, while `Automatic` is chosen: the preview on the `Manual` card shows, with its usage, the provider a click on `Manual` would put on VibeTV. That is the first provider of the saved Automatic choice when it delivers usage, otherwise the first switched-on provider in the list that does. Before, the card looked only at the first provider of the saved choice and read `No usage yet` when that one delivered none. It still reads `No usage yet` when no switched-on provider delivers usage. While `Manual` is chosen nothing changes: the card shows the provider VibeTV is set to, and `No usage yet` when that provider delivers none. The `Display Mode` step of setup is unchanged.
- Scope: `settings-screen.tsx`, one test in `settings-screen.test.tsx`, and this approval record. Not looked at in the running app and not verified on hardware in this batch. This covers the branch only, not merge, release, installation, or a device operation.

## 2026-10-08 — Theme Studio: a theme with a single imported picture can be sent to VibeTV

- User approval: Drafted in the overnight batch of 2026-10-08 and covered by Paul's blanket approval of 2026-10-07 for that batch. Paul has not yet seen this result. It answers a finding from testing the Windows app in that batch: Themes › Create Theme › Sprite with a 32×32 PNG, `Save theme`, `Send to VibeTV` ended in `Theme install needs attention. Check the install status.` although the badge said `Valid`, and nothing was sent.
- Approved customer-visible result: Not yet seen by Paul; covered by the blanket approval only. No new screen, dialog, button, or wording. A picture that Theme Studio imports as one frame is now stored under a name ending in `.cbi` where it ended in `.cba`; the customer sees that in the line `face-on-magenta.cbi imported.` and in the Assets list. `Send to VibeTV`, `Install` on the theme's library row and the exported ZIP then carry a file the Mac App and VibeTV accept, where the Mac App refused it before. A sprite sheet that Theme Studio imports as two or more frames keeps its `.cba` name and behaves as before. Themes saved before this change still hold the picture under the `.cba` name and are not converted by this entry.
- Scope: `importSpriteFile` in `theme-studio-assets.ts`, its tests in `theme-studio-assets.test.ts`, one test in `companion/internal/themepack/themepack_test.go` (no product code there), and this approval record. Firmware and Mac App are unchanged. Checked with unit tests; in addition a pack built from the tester's picture passed the Mac App's pack check and the picture file passed the firmware's sprite check compiled on the Mac. Not looked at in the running app and not verified on hardware in this batch. This covers the branch only, not merge, release, installation, or a device operation.

## 2026-10-08 — Theme Studio no longer calls a sprite valid whose file name does not match its content

- User approval: Drafted in the overnight batch of 2026-10-08 and covered by Paul's blanket approval of 2026-10-07 for that batch. Paul has not yet seen this result or the new sentence. It answers two findings from testing the Windows app in that batch: Theme Studio showed `Valid` for a theme the Mac App then refused, and `Install` on that saved theme under Appearance › Themes went back to `Install` with no message on the page.
- Approved customer-visible result: Not yet seen by Paul; covered by the blanket approval only. No new screen, dialog, or button; one new sentence. It concerns themes saved before the entry above, which still hold a single picture under a name ending in `.cba`. In Theme Studio such a theme shows `Fix` instead of `Valid` and, where the other checks are listed, `Element 1: /themes/u/face-on-magenta.cba is a single picture saved as an animation. Remove this element and import the sprite again.` As with every other check that fails, `Save theme`, `Send to VibeTV` and the export stay unavailable until the element is removed; importing the picture again stores it under the `.cbi` name. Under Appearance › Themes, `Install` on such a theme shows the existing red notice `Theme action failed` with the same sentence, and nothing is sent to the Mac App. The opposite case, an animation under a `.cbi` name, which Theme Studio itself never writes, reads `... is an animation saved as a single picture. Remove this element and import the sprite again.` Saved themes are not converted: they stay unusable until the customer does this. Not solved here: when the Mac App refuses a Theme Studio theme for another reason and an earlier install exists in this session, the failure dialog on the Themes page is still replaced within a second by that earlier install's `Installed` notice; that needs a change in `control-center-app.tsx`, which this entry does not touch.
- Scope: the sprite check in `validateThemeSpec` (`theme-studio.ts`), its test in `theme-studio.test.ts`, the new test `control-center-app.custom-theme-install.test.tsx`, and this approval record. `control-center-app.tsx`, `theme-library-screen.tsx`, the Mac App and the firmware are unchanged. Checked with unit tests only; not looked at in the running app and not verified on hardware in this batch. This covers the branch only, not merge, release, installation, or a device operation.

## 2026-10-08 — A failed install of an own theme keeps its message

- User approval: Drafted in the overnight batch of 2026-10-08 and covered by Paul's blanket approval of 2026-10-07 for that batch. Paul has not yet seen this result.
- Approved customer-visible result: Not yet seen by Paul; covered by the blanket approval only. No new wording. When the Mac App refuses a theme before an install starts (seen on the Windows app on 2026-10-07 with a theme from Theme Studio that could not be installed), the existing install failure message now stays until the customer closes it. Before, it disappeared within half a second and `Installed` was shown under the theme that had been installed earlier, because every status read applied that older finished install again. A finished install reported by the status is now applied once.
- Scope: `control-center-app.tsx` (`statusThemeInstallIsNews`), `control-center-app.custom-theme-install.test.tsx`, and this approval record. Not looked at in the running app in this batch. This is a draft for the branch only, not approval for merge, release, installation, or a device operation.

## 2026-10-08 — An automated accessibility check runs on the Control Center screens (#214)

- User approval: Drafted in the overnight batch of 2026-10-08; covered by Paul's blanket approval of 2026-10-07 for this batch; wording not yet seen by him.
- Approved customer-visible result: Not yet seen by Paul; covered by the blanket approval only. Nothing the customer sees or hears changes: this adds tests and no product code. The unit tests now run axe-core on the markup of Overview, Usage, Settings with its factory reset and connection questions, the six setup steps, the device step with its WiFi form, the Help menu with the setup log, the setup log entries, and a customer's own theme with its delete question. None of these had a finding. The check cannot measure contrast and does not know what a screen reader reads out.
- Scope: the helper `apps/control-center/src/test/axe.ts`, `axe-core` 4.12.1 as a direct dev dependency (it was already in the lock file), one check each in `overview-screen.test.tsx`, `usage-screen.test.tsx`, `settings-screen.test.tsx`, `settings-connection.test.tsx`, `setup-event-log.test.tsx`, `theme-library-screen.custom.test.tsx`, `setup/setup-device-screen.test.tsx`, `setup/setup-help-menu-log.test.tsx` and `setup/setup-wizard.test.tsx`, and this approval record. Not looked at in the running app and not verified on hardware in this batch. This covers the branch only, not merge, release, installation, or a device operation.

## 2026-10-08 — Screen readers get the lists, headings and names the accessibility check asked for (#214)

- User approval: Drafted in the overnight batch of 2026-10-08; covered by Paul's blanket approval of 2026-10-07 for this batch; wording not yet seen by him.
- Approved customer-visible result: Not yet seen by Paul; covered by the blanket approval only. Nothing changes on screen and no wording is new. What changes is what VoiceOver and Narrator are given; the automated check had seven findings, all fixed here. Navigation: the dot beside `Updates` is announced as an image named `Update available`; the name was there before, on an element a screen reader does not name. Updates: the progress bar of a running update carries the title shown below it (`Updating VibeTV`, `VibeTV is restarting`, `Update complete`, `Firmware current — attention needed`). Themes and Screensavers: the progress bar of an install is named `Installing`, then `Installed`, like the line below it. Support: the five card titles (`Connected VibeTV`, `Support report`, `Diagnostics`, `Setup log`, `Recent activity`) are second-level headings directly under the page title, where they were third-level ones with no level in between; the entries of `Recent activity` are announced as list items. Setup, `We couldn't find your VibeTV`: the two choices `Use the cable` and `Already on WiFi` are plain buttons and no longer sit in a list that has no entries. Settings › AI providers and Choose AI providers in setup: `No AI providers match your search.` stands after the provider list instead of inside it. One more place had the same fault without counting as a finding: in the setup log a repeated entry now reads `Repeated 3 times` to a screen reader as text; on screen it still shows `3 times`.
- Scope: `control-center-shell.tsx`, `updates-screen.tsx`, `theme-library-screen.tsx`, `logs-screen.tsx`, `ui/card.tsx` (a card title can now be given its heading level), `setup/setup-device-dialogs.tsx`, `setup/setup-providers-screen.tsx`, `setup-event-log.tsx`, the checks that found these in `control-center-shell.test.tsx`, `updates-screen.test.tsx`, `theme-library-screen.test.tsx`, `logs-screen.test.tsx`, `setup/setup-device-dialogs.test.tsx`, `setup/setup-providers-screen.test.tsx` and `control-center-app.display-preferences.test.tsx` (every tab inside the real navigation and the `Run setup again?` question), one changed assertion in `setup-event-log.test.tsx`, and this approval record. Checked with unit tests only; no screen reader was used, nothing was looked at in the running app or verified on hardware in this batch. This covers the branch only, not merge, release, installation, or a device operation.

## 2026-10-08 — Progress bars tell a screen reader how far they are (#214)

- User approval: Drafted in the overnight batch of 2026-10-08; covered by Paul's blanket approval of 2026-10-07 for this batch; wording not yet seen by him.
- Approved customer-visible result: Not yet seen by Paul; covered by the blanket approval only. Nothing changes on screen and no wording is new. The progress bar of a firmware update, of a theme install and of each usage lane now reports its percentage to VoiceOver and Narrator. Before, every progress bar was announced as busy without a value, because the shared bar did not pass its value on. A usage lane whose limits are unavailable reports no percentage, as it shows `??` on screen; it does not report 0%.
- Scope: `ui/progress.tsx` (the bar every screen uses), `usage-screen.tsx`, one assertion in `usage-screen.test.tsx`, one test in `updates-screen.test.tsx`, and this approval record. Checked with unit tests only; no screen reader was used, nothing was looked at in the running app or verified on hardware in this batch. This covers the branch only, not merge, release, installation, or a device operation.

## 2026-10-08 — Keyboard focus returns after a dialog and follows setup to the next step (#214)

- User approval: Drafted in the overnight batch of 2026-10-08; covered by Paul's blanket approval of 2026-10-07 for this batch; wording not yet seen by him.
- Approved customer-visible result: Not yet seen by Paul; covered by the blanket approval only. No new screen, dialog, button, or wording. When a dialog closes, keyboard focus goes back to the control that had it when the dialog opened, for example `Reset to factory settings`, a connection card, `Run setup again` or a theme's preview button. Before, focus fell back to the top of the window and Tab started again at the navigation. This holds for every dialog built on the shared dialog: the questions in Settings, `Run setup again?`, the setup dialogs, provider messages, `Update failed` and the theme preview. When that control is gone or disabled by then, focus stays where it fell before this change. The Theme Studio question `Save your changes?` and the delete question for an own theme keep their own handling, which already returned focus. In setup, when the customer goes on and the pressed button disappears, the new title takes keyboard focus, also when the title changes inside the VibeTV step. Nothing is drawn around the title; a screen reader reads it, and Tab continues with the first control below it.
- Scope: `ui/dialog.tsx`, `setup/setup-wizard-screen.tsx`, one test each in `settings-connection.test.tsx`, `setup/setup-device-dialogs.test.tsx` and `setup/setup-wizard.test.tsx`, and this approval record. Checked with unit tests only; not tried with a keyboard or a screen reader in the running Mac App or Windows App, and not verified on hardware in this batch. This covers the branch only, not merge, release, installation, or a device operation.

## 2026-10-08 — Updates shows when the app and VibeTV were last checked

- User approval: Drafted in the overnight batch of 2026-10-08; covered by Paul's blanket approval of 2026-10-07 for this batch; wording not yet seen by him. It answers a finding from testing the Windows app in that batch (issue #551): `Check for updates` showed `Checking updates` for less than a second and then the same page as before.
- Approved customer-visible result: Not yet seen by Paul; covered by the blanket approval only. One new line, no new button or dialog. On Updates, each of the two cards shows under its two version rows `Last checked` followed by the date and the time with seconds in the computer's own format, for example `Last checked Oct 7, 2026, 2:32:07 PM`. It is the time at which the version beside `Available` or `Available firmware` was read. A click on `Check for updates` reads the VibeTV firmware again every time, so the time on the `VibeTV update` card moves with every click. The app reads its own latest version at most every six hours, as before; a click inside that time leaves the time on the `Mac App` card (`App` on Windows) where it was, and the line says so truthfully instead of claiming a new check. A card whose check did not answer or has not answered yet shows no such line. The heading (`Up to date`, `Update available`, `Update check failed`, `Checking updates`), the cards and the button are otherwise unchanged.
- Scope: `updates-screen.tsx`, two tests in `updates-screen.test.tsx`, and this approval record. The six-hour limit in the Mac App is unchanged. Checked with unit tests, and looked at once in a local browser on the Mac at 1280 px width, with the Updates page opened outside the app on example data through a temporary page that is not part of the branch. Not looked at in the running Mac or Windows app and not verified on hardware in this batch. This covers the branch only, not merge, release, installation, or a device operation.

## 2026-10-08 — Theme Studio: the JSON tab shows the theme as it is after Save, Undo and Redo

- User approval: Drafted in the overnight batch of 2026-10-08; covered by Paul's blanket approval of 2026-10-07 for this batch; wording not yet seen by him. It answers a finding from testing the Windows app in that batch (issue #551): after `Save theme` had changed the theme's id, Advanced › JSON still showed the old id until the next edit.
- Approved customer-visible result: Not yet seen by Paul; covered by the blanket approval only. No new screen, dialog, button, or wording. Theme Studio, Advanced › JSON: as long as the customer has not typed in the field, it shows the theme exactly as it is. That now also holds directly after `Save theme` gave the theme another id (for example `my-theme` became `my-theme-2`) and after `Undo` and `Redo`, which left the old text standing in the same way. Text the customer typed and has not applied stays untouched as before, with the existing notices `JSON has local edits.` and `JSON is out of date. Apply or reset it before editing JSON.` One more difference: a field the customer emptied now stays empty, so new JSON can be pasted into it; before, the theme's JSON reappeared in the emptied field and a paste landed inside it. `Reset JSON` and `Apply JSON` work as before.
- Scope: `theme-studio-screen.tsx`, one test in `theme-studio-screen.test.tsx`, and this approval record. Checked with unit tests only; not looked at in the running app in this batch. This covers the branch only, not merge, release, installation, or a device operation.

## 2026-10-08 — Theme Studio: the theme's name is edited in the header

- User approval: Drafted in the overnight batch of 2026-10-08; covered by Paul's blanket approval of 2026-10-07 for this batch; wording not yet seen by him. It answers a finding from testing the Windows app in that batch (issue #551): the name could only be changed under Advanced › Project, so themes were saved as `New Theme`.
- Approved customer-visible result: Not yet seen by Paul; covered by the blanket approval only. No new dialog or button and no new wording. In Theme Studio and Screensaver Studio the name at the top left of the editor, under `Library`, is now a text field the customer can type in; before, it was a heading that could not be edited. It holds the same name as before (`New Theme`, `New Screensaver`, `Mini Classic Custom`, or the saved name) in a smaller bold type (24 px where the heading had 30 px), and shows `Untitled theme` or `Untitled screensaver` in grey while it is empty; those two were the heading's texts for an empty name. Typing there counts as a change like any other: the badge reads `Unsaved changes` and `Save theme` stores the name. The separate `Name` field under Advanced › Project is gone, and so is the one in the `Properties` panel of a narrow window, because the field in the header is on screen at every window width. `ID`, `Background`, `Mini theme` and `Import theme JSON` stay under Advanced › Project.
- Scope: `theme-studio-screen.tsx`, one test in `theme-studio-screen.test.tsx`, and this approval record. The field keeps the accessible name `Name`, which `apps/control-center/scripts/test-customer-flows.mjs` fills in two places; that suite was not run in this batch. Checked with unit tests, and looked at in a local browser on the Mac at window widths 960, 1024 and 1280, with Theme Studio opened on a new theme outside the app through a temporary page that is not part of the branch: the field is as wide as the space left of the buttons allows, at most 576 px, and typing `Retro Clock` into it turned the badge to `Unsaved changes`. Not looked at in the running Mac or Windows app. This covers the branch only, not merge, release, installation, or a device operation.

## 2026-10-08 — Theme Studio says why Send to VibeTV is unavailable

- User approval: Drafted in the overnight batch of 2026-10-08; covered by Paul's blanket approval of 2026-10-07 for this batch; wording not yet seen by him. It answers a finding from testing the Windows app in that batch (issue #551): a greyed-out `Send to VibeTV` gave no reason.
- Approved customer-visible result: Not yet seen by Paul; covered by the blanket approval only. No new dialog or button, and no newly written sentence: one line of small grey text appears directly above the row of `Export ZIP`, `Send to VibeTV` and `Save theme`, right-aligned, whenever `Send to VibeTV` is greyed out, and disappears when the button can be used. While a check fails, the line is the first failing check, word for word as the `Validation` box in the Inspector lists it, for example `Theme ID must be lowercase and 3-64 characters.`; `Export ZIP` and `Save theme` are greyed out for the same reason then, so the line does not ask the customer to save. Otherwise, while the theme has unsaved changes, it reads `Save this theme before sending it to VibeTV.` (in Screensaver Studio `Save this screensaver before sending it to VibeTV.`). That sentence already existed in the app but could never appear, because it was only shown after a click on the button that was greyed out. When the theme is saved and passes its checks but the connected VibeTV cannot take it, the line is the first reason from Advanced › Device, for example `This VibeTV needs a firmware update before it can use this theme.`; before, that reason was only readable after opening Advanced › Device. The button is greyed out in exactly the same cases as before.
- Scope: `theme-studio-screen.tsx`, `theme-studio/theme-studio-toolbar.tsx`, three tests in `theme-studio-screen.test.tsx`, and this approval record. The three branches in `sendTheme` that set these messages after a click could not be reached and are replaced by the one reason the button and the line share. Checked with unit tests, and looked at in a local browser on the Mac at window widths 960, 1024 and 1280, with Theme Studio opened on a new theme outside the app through a temporary page that is not part of the branch: the line stands above the buttons, right-aligned, and at 1280 px the header keeps its height when the line appears. That a sentence of two lines breaks at the width of the row of buttons was looked at with a long example sentence put into the line by hand. Not looked at in the running Mac or Windows app. This covers the branch only, not merge, release, installation, or a device operation.

## 2026-10-08 — Theme Studio: Export ZIP says on Windows where the file was saved

- User approval: Drafted in the overnight batch of 2026-10-08; covered by Paul's blanket approval of 2026-10-07 for this batch; wording not yet seen by him. It answers a finding from testing the Windows app in that batch (issue #551): after `Export ZIP` the notice read `vibetv-theme-my-theme.zip exported. Nothing was sent.` and did not say where the file went.
- Approved customer-visible result: Not yet seen by Paul; covered by the blanket approval only. No new screen, dialog, or button; one changed sentence, on Windows only. After `Export ZIP` in Theme Studio or Screensaver Studio the green `Export` notice reads `Saved as vibetv-theme-my-theme.zip in your Downloads folder. Nothing was sent.`, with the exported file's own name. The first half is the sentence Support › `Download` shows on Windows since #545 (`Saved as … in your Downloads folder.`); `Nothing was sent.` is kept from the old notice. On the Mac the notice is unchanged (`vibetv-theme-my-theme.zip exported. Nothing was sent.`): the Mac asks where to save and can be cancelled, so the app makes no claim about a folder there, the same rule as in #545. A failed export shows its error as before.
- Scope: `exportThemePack` in `theme-studio-screen.tsx`, one test in `theme-studio-screen.test.tsx` covering both platforms, and this approval record. Checked with unit tests only; that the Windows app saves the ZIP into Downloads without asking is taken from #545 and from this batch's test of the Windows app, not checked again here. This covers the branch only, not merge, release, installation, or a device operation.

## 2026-10-08 — Theme Studio: the notices for Save, Export and Send stand above the Inspector, at every window width

- User approval: Drafted in the overnight batch of 2026-10-08; covered by Paul's blanket approval of 2026-10-07 for this batch; wording not yet seen by him. It answers a finding from testing the Windows app in that batch (issue #551): the notices sat at the bottom of the Inspector and were partly below the lower edge of the window when the selected element had many fields.
- Approved customer-visible result: Not yet seen by Paul; covered by the blanket approval only. No new wording, button, or dialog; three existing notices change their place. In Theme Studio and Screensaver Studio the notices `Library` (for example `Saved to library.`), `Export` and `VibeTV` (for example `Theme installed through the Mac App.`) now stand at the top of the right-hand column, in that order and looking as before, directly under the buttons that cause them. The `Inspector` box with the fields of the selected element follows below them and scrolls inside the window as before; the `Validation` box stays inside it under the fields. Before, the three notices came last inside the `Inspector` box, under the fields and under `Validation`. In a window narrower than 1024 px, where the right-hand column is not shown (the Windows app can be made as narrow as 960 px), the three notices now stand across the full width between the header and the preview; before, they were not shown there at all. A notice still appears only once its action was used and then stays, so what is below it moves down by its height when it first appears. Without a notice nothing moves and no gap is left.
- Scope: `theme-studio-screen.tsx` (the three notices moved out of the Inspector box into the column that holds it; no notice, wording, or condition changed), two tests in `theme-studio-screen.test.tsx`, and this approval record. Checked with unit tests on the order and on the notices standing outside the box a narrow window hides, and looked at in a local browser on the Mac at 960×640, 1024×700, 1280×720 and 1280×900, with Theme Studio opened on a new theme outside the app through a temporary page that is not part of the branch, with the `Library` and `VibeTV` notices on screen and without any. The `Export` notice was not looked at there, because the click downloads a file. Not looked at in the running Mac or Windows app. This covers the branch only, not merge, release, installation, or a device operation.

## 2026-10-08 — Themes list: an own theme and a later catalog theme with the same id stay two rows

- User approval: Drafted in the overnight batch of 2026-10-08; covered by Paul's blanket approval of 2026-10-07 for this batch; wording not yet seen by him. It answers a finding made by reading the code in that batch (issue #551), not one seen in the app.
- Approved customer-visible result: Not yet seen by Paul; covered by the blanket approval only. No new screen, dialog, button, or wording, and nothing changes for a customer whose own themes share no id with the catalog. `Save theme` gives a new theme an id no catalog theme has, but a later catalog can add a theme under an id the customer already used. Under Appearance › Themes (and Screensavers) both then appear, the customer's with its `Custom` badge and the catalog's without. The list told its rows apart by that id alone, which React does not support for two rows: when the list changed, a row could be shown twice or left out. The rows are now told apart by kind (own or catalog) and their own entry, so both always appear once. Not solved here: the customer's theme keeps the shared id until it is saved again in Theme Studio, which then gives it a free one. Until then both rows show `Installed`, `Installing` and the highlighted row together, because those are still decided by the theme id, and a VibeTV showing the customer's theme under that id can have it replaced by the catalog theme's automatic update (the case the entry of 2026-10-08 titled `A test shows that a Theme Studio theme never reaches VibeTV under a catalog theme's id` describes).
- Scope: the row key in `theme-library-screen.tsx`, one test in `theme-library-screen.custom.test.tsx`, and this approval record. Checked with a unit test only; not looked at in the running app in this batch. This covers the branch only, not merge, release, installation, or a device operation.

## 2026-10-08 — Settings names the keyboard shortcut for the next provider

- User approval: Drafted in the overnight batch of 2026-10-08; covered by Paul's blanket approval of 2026-10-07 for this batch; wording not yet seen by him. It implements issue #424, which asks for a global keyboard shortcut that shows the next provider, for the key combination to be visible in Settings, and for a clear explanation when it cannot be registered. The key combinations were chosen in this batch; Paul has not seen them either.
- Approved customer-visible result: Not yet seen by Paul; covered by the blanket approval only. One new line of text under Settings › Display mode, below the two mode cards and, while Automatic is chosen, below `Switch providers`. In the Mac App the line reads `Press ⌃⌥⌘P in any app to show the next provider. This switches to Manual.` In the Windows App the keys read `Ctrl+Alt+Shift+P`. When the system refused the keys as the app started, the line reads instead `The shortcut ⌃⌥⌘P for the next provider is not available: another app may already be using these keys.`, in the Windows App with `Ctrl+Alt+Shift+P`. A browser shows no such line, because only the Mac App and the Windows App have the shortcut. A press shows the next provider that Manual offers, after the last one the first again, and stores it like a choice under Manual, so Automatic does not take the screen back; with fewer than two such providers nothing changes. While Settings is open, the Manual card and `Show this provider` follow a press without a reload. The sentence about refused keys is a plain line in Settings and not a dialog, although the UI principles ask for a dialog for new error states: it describes a standing state of the app, not an action of the customer that failed, and a dialog would come up at every start of the app. That choice is Paul's to confirm. No other screen, dialog, or button changes.
- Scope: `settings-screen.tsx` (the line), `control-center-runtime.ts` (reads from the app's user agent whether the keys were refused), `control-center-app.tsx` (hands that to Settings and reads the display choice again when the app reports a press), their tests in `settings-screen.test.tsx`, `control-center-runtime.test.ts` and the new `control-center-app.provider-shortcut.test.tsx`, the shortcut itself in `macos/VibeTVControlCenter/main.swift` and `windows/src-tauri/src/main.rs`, `docs/preferences.md`, and this approval record. Checked with unit tests, a Swift type check, and `cargo check` for the Windows target run on the Mac. The shortcut was not pressed in a running app, Settings was not looked at in the running app, and nothing was verified on hardware or on Windows in this batch. This covers the branch only, not merge, release, installation, or a device operation.

## 2026-10-08 — Overview and Support say when VibeTV's WiFi signal is weak (#265)

- User approval: Drafted in the overnight batch of 2026-10-08; covered by Paul's blanket approval of 2026-10-07 for this batch; wording not yet seen by him. It implements the Control Center part of issue #265, which asks for a plain warning with a next step when VibeTV is on WiFi but its connection is too poor for reliable updates. The wording follows the issue's example sentence; the wording and the threshold were chosen in this batch, and Paul has not seen either.
- Approved customer-visible result: Not yet seen by Paul; covered by the blanket approval only. No new screen, dialog, or button. On Overview, in the row of four tiles, the `VibeTV` tile reads `Weak WiFi signal` instead of `Connected`, with the line `Move VibeTV closer to your router.` below it, for as long as the Mac App reports that the signal of a VibeTV on WiFi is weak. The heading `VibeTV is connected` and the `Connected` badge above the picture stay, because VibeTV is still connected. The Mac App reports a weak signal when VibeTV measured -80 dBm or less on two readings in a row; the page reads the status every 5 seconds while its window is visible, so the tile changes on the reading after the one that first saw the low value. One reading above -80 dBm returns the tile to `Connected`. -80 dBm is a first value that has not been tried in a place with a really weak signal. Nothing changes for a VibeTV on the Cable, for a good signal, for a VibeTV that is not connected (`Not connected` as before) or for firmware that reports no signal. On Support, the `Connected VibeTV` card gets a fifth field `WiFi signal` after `Active theme`, reading `Weak (-82 dBm)` while the Mac App reports a weak signal and otherwise only the value VibeTV measured, for example `-48 dBm`; no word is put on a value the Mac App has not judged, so a single low reading is not called good. The field is absent for a VibeTV on the Cable, for one that is not connected and for firmware that reports no signal, and the card then looks as before. The note on Overview is a line in an existing tile, like `Theme not shown` in the `Display` tile, and not a dialog, although the UI principles ask for a dialog for new error states: it describes a standing state in which VibeTV keeps working, not an action of the customer that failed, and a dialog would come up again with every dip of the signal. That choice is Paul's to confirm. What VibeTV itself draws does not change.
- Scope: `overview-screen.tsx`, `logs-screen.tsx`, the signal reading in the device type in `control-center-types.ts`, one test each in `overview-screen.test.tsx` and `logs-screen.test.tsx`, and this approval record. The decision is made in the Mac App (`wifiSignalStaysWeak` in `companion/internal/companionapi/server.go`) and reaches the page as `device.health.wifi.weak`; the page compares no number itself. Checked with unit tests only when this entry was written: not looked at in the running app, and not verified on a VibeTV, neither with a weak signal nor with the threshold moved for the bench. This covers the branch only, not merge, release, installation, or a device operation.

## 2026-10-08 — Weak WiFi signal: when the note ends (correction to the entry above, #265)

- User approval: Drafted in the overnight batch of 2026-10-08; covered by Paul's blanket approval of 2026-10-07 for this batch; wording not yet seen by him. An independent review of the batch found that the note would flip between `Weak WiFi signal` and `Connected` with every reading around the threshold, and that polls without an answer, which is what a weak signal produces, ended it.
- Approved customer-visible result: Not yet seen by Paul; covered by the blanket approval only. No wording changes. The earlier entry says one reading above -80 dBm returns the tile to `Connected`; that is no longer so. Once the tile reads `Weak WiFi signal` it stays until VibeTV measures -77 dBm or better, and status reads that get no answer from VibeTV do not end it. A single low reading still does not raise it, and a low reading is forgotten after 5 minutes without another one.
- Scope: `wifiSignalStaysWeak` in `companion/internal/companionapi/server.go`, its test, `docs/operator-runbook.md`, and this approval record. No file of the Control Center page changes. Checked with unit tests when this entry was written; not yet verified on a VibeTV.

## 2026-10-08 — Updates: Check for updates also checks the app again

- User approval: Drafted in the overnight batch of 2026-10-08; covered by Paul's blanket approval of 2026-10-07 for this batch; wording not yet seen by him. It answers a finding from clicking through the Windows app in that batch: after `Check for updates` the time under the `App` card stood still, so the customer could not tell whether the click had checked the app at all.
- Approved customer-visible result: Not yet seen by Paul; covered by the blanket approval only. No new screen, dialog, button, or wording. A click on `Check for updates` now also reads the app's own latest version again, so `Last checked` under the `Mac App` card (`App` on Windows) moves with the click, like the one under `VibeTV update`. This replaces what the entry of 2026-10-08 titled `Updates shows when the app and VibeTV were last checked` says about a click inside six hours. Without a click nothing changes: on its own the app still reads its latest version at most every six hours. When the page is already reading the app's status at the moment of the click, the check runs with the next status read instead, which follows within about five seconds; in that case the time can move shortly after the button is back. A check that does not answer shows no time, as before.
- Scope: one query flag on the status read in `control-center-app.tsx` that only `Check for updates` sets, its counterpart in `companion/internal/companionapi/server.go` (`/v1/status?checkAppUpdate=1` forgets the remembered answer for that one read; `macAppReleaseCheckGap` stays six hours), the new `control-center-app.update-check.test.tsx` with two tests, one Go test, and this approval record. Checked with these tests only; not clicked in the running Mac or Windows app and not verified on hardware in this batch. This covers the branch only, not merge, release, installation, or a device operation.

## 2026-10-08 — Theme Studio: a theme is saved before it can be sent to VibeTV

- User approval: Drafted in the overnight batch of 2026-10-08; covered by Paul's blanket approval of 2026-10-07 for this batch; wording not yet seen by him. It answers a finding from clicking through the Windows app in that batch: a new theme opened with `Create Theme` (badge `Draft`) could be sent with `Send to VibeTV` without ever being saved. VibeTV then showed a theme that was in no library, and the Themes list had no row marked `Installed`.
- Approved customer-visible result: Not yet seen by Paul; covered by the blanket approval only. No new screen, dialog, button, or wording. In Theme Studio and Screensaver Studio `Send to VibeTV` is greyed out for as long as the theme is not in the library, that is while the badge reads `Draft`, and the grey line above the buttons reads `Save this theme before sending it to VibeTV.` (in Screensaver Studio `Save this screensaver before sending it to VibeTV.`). That is the sentence a theme with unsaved changes already shows. After `Save theme` the badge reads `Saved`, the line goes and the button can be used. This holds for a theme from `Create Theme` or `Create Screensaver` and also for the copy of a catalog theme opened with `Edit`: until now such a copy could be sent unchanged without saving, and it ended up on VibeTV in the same way without a row in the list. A failed check is still named first, as before. A theme opened from its own row in the library is unchanged: it can be sent right away.
- Scope: one condition in `theme-studio-screen.tsx`, tests in `theme-studio-screen.test.tsx` and `theme-library-screen.catalog-id.test.tsx` (its test of the unsaved copy now saves first), four steps in `apps/control-center/scripts/test-customer-flows.mjs` that sent an unsaved theme and now save first, one word in `docs/themes.md`, and this approval record. Checked with the unit tests only; the changed steps in `test-customer-flows.mjs` were not run in this batch. Not clicked in the running Mac or Windows app and not verified on hardware. This covers the branch only, not merge, release, installation, or a device operation.

## 2026-10-08 — Theme Studio: the send line does not ask to save while saving is locked

- User approval: Drafted in the overnight batch of 2026-10-08; covered by Paul's blanket approval of 2026-10-07 for this batch; wording not yet seen by him. It answers a finding from a review of that batch's commits: while the theme storage is locked, `Save theme` is greyed out, and the grey line above the buttons still read `Save this theme before sending it to VibeTV.`
- Approved customer-visible result: Not yet seen by Paul; covered by the blanket approval only. No new screen, dialog, button, or newly written sentence. Theme Studio and Screensaver Studio cannot save while the app could not read its stored themes or its recovery copy; the Themes page then shows `Theme storage needs attention` with the reason, and the editor shows that reason as its `Library` notice, for example `Saved themes contain invalid data. The original data was left unchanged.` In that state, for a theme that is not saved yet or has unsaved changes, the grey line above `Export ZIP`, `Send to VibeTV` and `Save theme` now shows that same reason instead of `Save this theme before sending it to VibeTV.` The button is greyed out in the same cases as before. A failed check is still named first. With working storage nothing changes.
- Scope: one condition in `theme-studio-screen.tsx`, one test in `theme-studio-screen.test.tsx`, and this approval record. Checked with the unit test only; not looked at in the running app in this batch. This covers the branch only, not merge, release, installation, or a device operation.

## 2026-10-08 — A closing dialog no longer takes keyboard focus out of the next dialog

- User approval: Drafted in the overnight batch of 2026-10-08; covered by Paul's blanket approval of 2026-10-07 for this batch; wording not yet seen by him. It answers a finding from a review of that batch's commits: the focus return added in the entry of 2026-10-08 titled `Keyboard focus returns after a dialog and follows setup to the next step (#214)` also ran when focus was already somewhere it belonged.
- Approved customer-visible result: Not yet seen by Paul; covered by the blanket approval only. No new screen, dialog, button, or wording. When one dialog closes and another opens in its place, keyboard focus stays in the new dialog. Example in setup: `We couldn't search for your VibeTV` › `Enter IP manually` opens `Enter IP address`, and the customer can type the address at once; with the earlier change focus jumped back to the step title behind the dialog a moment later and typing went nowhere. The same holds when `Repairing VibeTV Control Center` is replaced by `VibeTV Control Center needs attention`. When `Repairing VibeTV Control Center` closes by itself while the customer has clicked into a field behind it, focus stays in that field instead of jumping to whatever had focus when the dialog opened. A dialog that closes with nothing else holding focus still gives it back to the control that had it before, as the earlier entry describes.
- Scope: one more condition in `ui/dialog.tsx` (focus is handed back only when it fell to the window), three tests in `setup/setup-device-dialogs.test.tsx`, and this approval record. The existing focus tests in `setup/setup-device-dialogs.test.tsx`, `settings-connection.test.tsx` and `setup/setup-wizard.test.tsx` still pass. Checked with unit tests only; not tried with a keyboard in the running Mac or Windows app and not verified on hardware in this batch. This covers the branch only, not merge, release, installation, or a device operation.

## 2026-10-08 — Theme Studio: the Windows export notice names the folder and no file

- User approval: Drafted in the overnight batch of 2026-10-08; covered by Paul's blanket approval of 2026-10-07 for this batch; wording not yet seen by him. It answers a finding from a review of that batch's commits: the notice from the entry of 2026-10-08 titled `Theme Studio: Export ZIP says on Windows where the file was saved` named the wrong file from the second export of the same theme on, because Windows saves that one as `vibetv-theme-my-theme (1).zip`.
- Approved customer-visible result: Not yet seen by Paul; covered by the blanket approval only. No new screen, dialog, or button; one shortened sentence, on Windows only. After `Export ZIP` in Theme Studio or Screensaver Studio the green `Export` notice reads `Saved in your Downloads folder. Nothing was sent.` It no longer contains a file name; before, it read `Saved as vibetv-theme-my-theme.zip in your Downloads folder. Nothing was sent.` This replaces the Windows sentence of the earlier entry. On the Mac the notice is unchanged (`vibetv-theme-my-theme.zip exported. Nothing was sent.`). A failed export shows its error as before.
- Scope: `exportThemePack` in `theme-studio-screen.tsx`, its test in `theme-studio-screen.test.tsx`, and this approval record. Checked with the unit test only. That Windows numbers the second file is taken from the review, and that it saves into Downloads without asking from #545; neither was checked again here. This covers the branch only, not merge, release, installation, or a device operation.

## 2026-10-08 — Theme Studio: emptying the name is not an error, and a recovery notice leaves again

- User approval: Drafted in the overnight batch of 2026-10-08; covered by Paul's blanket approval of 2026-10-07 for this batch; wording not yet seen by him. It answers a finding from clicking through the Windows app in that batch: selecting the name in the header and deleting it raised a red `Library` notice `The theme recovery contains invalid data and was not saved.`, and the notice stayed after a new name was typed.
- Approved customer-visible result: Not yet seen by Paul; covered by the blanket approval only. No new screen, dialog, button, or wording. In Theme Studio and Screensaver Studio, an empty name field no longer raises a notice. The field shows `Untitled theme` (or `Untitled screensaver`) in grey as before, and the customer goes on typing. The recovery copy the app keeps of unsaved work is still written while the name is empty; it carries the name `Save theme` gives a theme without a name, which is the theme's ID in words, for example `My Theme` for `my-theme`. A customer who closes the app with an empty name and later chooses `Resume` therefore finds that name in the field. `Save theme` with an empty name behaves as before: the theme is saved under that same name and the field shows it at once. New: a name of only spaces is treated the same way; before, `Save theme` answered it with `The theme library contains invalid data and was not saved.` Separately, when the recovery copy really cannot be written, for example `Browser storage is full. Remove unused themes or assets, then try again.`, the red `Library` notice now goes away by itself as soon as a later write of the copy succeeds; before, it stayed until the editor was closed. The notices of `Save theme` are not removed by this.
- Scope: the write of the recovery copy in `theme-studio-screen.tsx` (now one function for the timed write and the write on closing, where there were two copies of it), one word in `saveThemeFromEditor` in `theme-library-screen.tsx`, two tests in `theme-studio-screen.test.tsx`, one test in `theme-library-screen.catalog-id.test.tsx`, and this approval record. Checked with unit tests only; not looked at in the running Mac or Windows app in this batch. This covers the branch only, not merge, release, installation, or a device operation.

## 2026-10-08 — Theme Studio: one notice at a time for Save, Export and Send

- User approval: Drafted in the overnight batch of 2026-10-08; covered by Paul's blanket approval of 2026-10-07 for this batch; wording not yet seen by him. It answers a finding from clicking through the Windows app in that batch: `Library` › `Saved to library.` stayed above the Inspector after the next change, while the badge already read `Unsaved changes` and the grey line asked to save first; and `Export` › `… Nothing was sent.` stayed beside `VibeTV` › `Theme installed through the app.`
- Approved customer-visible result: Not yet seen by Paul; covered by the blanket approval only. No new screen, dialog, button, or wording; existing notices leave earlier. In Theme Studio and Screensaver Studio the notices `Library`, `Export` and `VibeTV` above the Inspector each say what the last click on `Save theme`, `Export ZIP` or `Send to VibeTV` answered. From now on only the newest of them is shown: a click on one of the three buttons takes away what the other two said, whether that was a success or an error. In addition, the `Library` notice of a save, for example `Saved to library.` or `Theme could not be saved.`, goes away with the next change to the theme, `Undo` and `Redo` included, because it was about the theme as it was. Selecting an element is not a change. The `Export` and `VibeTV` notices stay through a change until the next click on one of the three buttons, as before. Two `Library` notices are not answers to a click and stay as before: the reason why nothing can be saved while the theme storage is locked, and the notice that the recovery copy could not be written, which leaves with the next copy that is written. This replaces the sentence `A notice still appears only once its action was used and then stays` in the entry of 2026-10-08 titled `Theme Studio: the notices for Save, Export and Send stand above the Inspector, at every window width`.
- Scope: `theme-studio-screen.tsx` (one place through which every change to the theme passes clears the save notice; the three actions clear each other's notices; the two idle texts that were repeated in six places are two constants), three tests in `theme-studio-screen.test.tsx`, and this approval record. Checked with unit tests only; not looked at in the running Mac or Windows app in this batch. This covers the branch only, not merge, release, installation, or a device operation.

## 2026-10-08 — Screensavers list: the installed screensaver stays marked after a theme install

- User approval: Drafted in the overnight batch of 2026-10-08; covered by Paul's blanket approval of 2026-10-07 for this batch; wording not yet seen by him. It answers a finding from clicking through the Windows app in that batch: after `Install` on Retro 3D under Appearance › Screensavers the row read `Installed`; after a theme was installed under Themes, the same row read `Install` again, although Retro 3D was still VibeTV's screensaver.
- Approved customer-visible result: Not yet seen by Paul; covered by the blanket approval only. No new screen, dialog, button, or wording. Under Appearance › Screensavers the row of the screensaver that VibeTV has in its screensaver slot reads `Installed`, for as long as VibeTV reports it there. That no longer depends on which install was made last from the app, so it also holds after a theme was installed, after the app was closed and opened again, and on a second computer. Until now the row only read `Installed` while that screensaver was the last thing installed in the running app. A catalog screensaver counts as installed in whichever revision VibeTV holds; the automatic update to a newer revision is unchanged. The customer's own screensaver counts as installed while VibeTV holds exactly the version saved in the library; after it was changed and saved again its row reads `Install`, because VibeTV still has the older version. While `Show screensaver` is switched off the row can read `Installed` as well: the screensaver is still on VibeTV and is used again when the switch is turned on. The Themes list is unchanged; the mirror case there is the entry of 2026-10-08 about the live theme staying installed while the screensaver is on screen.
- Scope: `theme-library-screen.tsx` (the row asks what VibeTV reports for its slot; the screensaver slot is read from `standby.screensaverPath` in the device status), `resolveInstalledScreensaver` in `lib/active-theme-upgrade.ts` (the lookup the automatic screensaver update already used, now shared), one test each in `theme-library-screen.test.tsx` and `theme-library-screen.custom.test.tsx`, and this approval record. Checked with unit tests only; that VibeTV keeps reporting the path after a theme install is taken from the finding and was not checked on hardware here. Not looked at in the running Mac or Windows app. This covers the branch only, not merge, release, installation, or a device operation.

## 2026-10-08 — Support does not name the screensaver as active theme when a Theme Studio theme is live

- User approval: Drafted in the overnight batch of 2026-10-08; covered by Paul's blanket approval of 2026-10-07 for this batch; wording not yet seen by him. The second Windows walk-through of the batch found it (issue #551) and the automated review of the pull request raised it again: during standby the app took the screensaver that VibeTV was drawing for the customer's live theme when that theme came from Theme Studio.
- Approved customer-visible result: Not yet seen by Paul; covered by the blanket approval only. No new screen, dialog, or button. On Support, in the `Connected VibeTV` card, the field `Active theme` reads `Custom theme` while the screensaver is on screen and the live slot holds a theme the catalog does not list. Before, it read the screensaver's name built from its id, for example `Retro 3d`. A catalog theme is named as before, also during standby, and outside standby nothing changes. In the Themes list no row is marked `Installed` from the screensaver's id in that state.
- Scope: `activeLiveThemeId` in `apps/control-center/src/lib/active-theme-upgrade.ts`, `activeThemeLabel` in `logs-screen.tsx`, their tests, and this approval record. Checked with unit tests when this entry was written; not yet looked at in the running app. This covers the branch only, not merge, release, installation, or a device operation.

## 2026-10-08 — The customer's own screensaver is not replaced by a catalog screensaver with a similar file name

- User approval: Drafted in the overnight batch of 2026-10-08; covered by Paul's blanket approval of 2026-10-07 for this batch; wording not yet seen by him. The automated review of the pull request found that the rule which protects a Theme Studio theme in the live slot (issue #549) was missing for the screensaver slot.
- Approved customer-visible result: Not yet seen by Paul; covered by the blanket approval only. No wording and no screen changes. A screensaver saved in Screensaver Studio whose file on VibeTV starts like a catalog screensaver's file is no longer taken for an old revision of that catalog screensaver: the app does not install the catalog screensaver over it, and the Screensavers list does not mark the catalog row `Installed` for it. A catalog screensaver in an older revision is still updated by the app as before. One limit follows: a catalog screensaver that sits on VibeTV in its very first revision is not updated by itself; today every catalog screensaver is past its first revision.
- Scope: `resolveInstalledScreensaver` in `apps/control-center/src/lib/active-theme-upgrade.ts`, its test, and this approval record. Checked with unit tests when this entry was written. This covers the branch only, not merge, release, installation, or a device operation.

## 2026-10-08 — Settings and Updates: a control keeps keyboard focus while its change is saved

- User approval: Drafted in the overnight batch of 2026-10-08; covered by Paul's blanket approval of 2026-10-07 for this batch; wording not yet seen by him. It answers the first point of issue #558 from the third Windows walk-through of that batch: with the keyboard on `Brightness`, two presses of the right arrow moved the slider by 1 % only. The control was closed while the change was saved, the focus dropped to the page, and the second press went nowhere. The same happened on `Brightness in screensaver`, `Show screensaver`, the Display mode cards and `Check for updates`.
- Approved customer-visible result: Not yet seen by Paul; covered by the blanket approval only. No new screen, dialog, button, or wording. In Settings, saving brightness, a screensaver setting or the display mode no longer closes any control: `Brightness`, `Show screensaver`, `Show after`, `Brightness in screensaver`, `Choose screensaver`, the cards `Automatic` and `Manual` and the list `Show this provider` keep their look and the keyboard focus, and take the next press at once. Several arrow presses on a slider end on the last value. The other controls in Settings (`USB-C`, `WiFi`, `Usage display`, `Switch providers`, `Run setup again`, `Reset to factory settings`) no longer turn grey for that moment either. All of them still close while the connection is switched, setup is reset, VibeTV is reset to factory settings or VibeTV is updated, as before. The changes reach VibeTV one after the other in the order they were made. While one is on its way, only the newest value of the same setting waits behind it, so an arrow key that is held down sends the first and the last value and not every step in between. Only the newest change moves the control and writes its `Brightness saved` or `Screensaver saved` entry under Support › Recent activity; a change that was replaced before it was answered shows neither an entry nor an error. Under Appearance › Screensavers, `Show screensaver` likewise stays usable and keeps the focus while it is saved; the `Install` buttons there still close for that moment, as before. On Updates, `Check for updates` keeps the keyboard focus during the check it started: it reads `Checking updates` with the spinner and is dimmed as before, a second press does nothing, and afterwards it reads `Check for updates` again with the focus still on it. While Updates checks by itself after opening, and during an update, the button is disabled as before.
- Scope: `control-center-app.tsx` (one queue for the brightness and screensaver writes to VibeTV, which were sent at once and answered in any order before), `settings-screen.tsx` (a brightness or screensaver save is no longer in the list that closes the controls; the Display mode cards are no longer closed while the mode is saved, whose writes were already queued), `provider-picker.tsx` (the prop that only served that closing is removed), `theme-library-screen.tsx` (`Show screensaver`), `updates-screen.tsx` (`Check for updates` is marked unavailable for screen readers and ignores presses during its own check instead of being disabled), `src/test/focus.ts`, six tests in `control-center-app.display-preferences.test.tsx`, one in `control-center-app.update-check.test.tsx`, two paragraphs in `docs/control-center-accessibility.md`, and this approval record. The setup wizard's Display Mode step still closes its cards and `Continue` while it saves. Checked with unit tests in jsdom only, which does not move focus by itself; not looked at in the running Mac or Windows app, and the customer-flow browser suite was not run. Not covered: when a check finds a new app version, the button is replaced by the `Update` link and the focus is lost; `Update` is still disabled while VibeTV is updated. This covers the branch only, not merge, release, installation, or a device operation.

## 2026-10-08 — Settings: the Screensaver block says which screensaver is installed, or that none is

- User approval: Drafted in the overnight batch of 2026-10-08; covered by Paul's blanket approval of 2026-10-07 for this batch; wording not yet seen by him. It answers the second point of issue #558 from the third Windows walk-through of that batch: `Show screensaver` could be switched on with no screensaver installed, and Settings said neither that none is chosen nor which one is. `Choose screensaver` was only a link.
- Approved customer-visible result: Not yet seen by Paul; covered by the blanket approval only. No new screen, dialog, or button. Settings › Screensaver gets one line of grey text, on the same line in front of the link `Choose screensaver`. It is shown while `Show screensaver` is on and VibeTV reports its screensaver slot, and reads one of three sentences. `<name> is installed.`, for example `Night Clock is installed.`: the name is the title of the catalog screensaver, in whichever revision VibeTV holds, or the name under which the customer saved their own screensaver in the library. `A custom screensaver is installed.`: VibeTV holds a screensaver that neither the catalog nor the library on this computer lists in that version, for example the customer's own after it was changed and saved again, or one installed from another computer. `No screensaver is installed yet.`: VibeTV reports an empty slot. The link `Choose screensaver` keeps its wording and where it leads. While `Show screensaver` is off the block is unchanged: no line, and the link greyed out. While the status that VibeTV sends does not include its screensaver slot, there is no line either, because nothing is known about the slot then. The line follows what VibeTV reports with its status, which is also what marks a row `Installed` under Appearance › Screensavers.
- Scope: `settings-screen.tsx`, `installedScreensaver` in `lib/active-theme-upgrade.ts` (the lookup behind the `Installed` mark, moved there from `theme-library-screen.tsx` and now returning the name with the id, so both places ask one function), `theme-library-screen.tsx` (uses it; the list is unchanged), `control-center-app.tsx` (hands the catalog to Settings), four tests in `settings-screen.test.tsx` and the line added to its accessibility check, one test in `settings-preferences.test.tsx`, one in `control-center-app.display-preferences.test.tsx`, and this approval record. Checked with unit tests only; not looked at in the running Mac or Windows app, and the customer-flow browser suite was not run. Not changed: `Show screensaver` can still be switched on with no screensaver installed. This covers the branch only, not merge, release, installation, or a device operation.

## 2026-10-08 — Themes: an own theme and a catalog theme with the same id are told apart by their file

- User approval: Drafted in the overnight batch of 2026-10-08; covered by Paul's blanket approval of 2026-10-07 for this batch; wording not yet seen by him. The automated review of the pull request found it on the change that lists such a pair as two rows (issue #551): both rows took their state from the shared id, so installing one marked both `Installed` and closed the other row's `Install`.
- Approved customer-visible result: Not yet seen by Paul; covered by the blanket approval only. No new screen, dialog, button, or wording. It applies only when a later catalog gives one of its themes the id of a theme the customer made earlier; every other row behaves as before. In that case the Themes list and the Screensavers list mark only the row whose theme file VibeTV holds as `Installed`, and the other row keeps `Install`, so the customer can switch between the two. The progress of an install, `Opening` on `Edit` and the wait before an own theme is sent appear only in the row that was pressed. If VibeTV does not report which file it holds, neither of the two rows is marked `Installed` and both can be installed. Both rows of such a pair are still highlighted together as the selected theme.
- Scope: `theme-library-screen.tsx` (the row, not the theme id, names what is being opened, prepared and installed; for a shared id the installed mark compares the path VibeTV reports, or the path of the install just made from here, with the path the own theme is sent under), two tests in `theme-library-screen.custom.test.tsx`, and this approval record. Checked with unit tests when this entry was written; a pair with a shared id was not produced on a real VibeTV. This covers the branch only, not merge, release, installation, or a device operation.

## 2026-10-08 — Overview: the Display tile says Screensaver while the screensaver is on screen

- User approval: Drafted in the overnight batch of 2026-10-08; covered by Paul's blanket approval of 2026-10-07 for this batch; wording not yet seen by him. It answers a point of issue #558 from the third Windows walk-through of that batch: Overview read `Display` › `Live` while VibeTV was showing the screensaver.
- Approved customer-visible result: Not yet seen by Paul; covered by the blanket approval only. No new screen, dialog, or button. On Overview the tile `Display` reads `Screensaver` while VibeTV reports that its screensaver is on screen. Before, it read `Live` then. As soon as VibeTV shows usage again the tile reads `Live`, as before. The other values of the tile (`Update running`, `Theme not shown`, `Waiting for usage`, `Waiting for first image`) and the tiles `Mac App` or `App`, `VibeTV` and `VibeTV firmware` are unchanged; so are the heading `VibeTV is connected` and the picture of VibeTV, which already drew the screensaver in that state. The word is the one the app uses for the screensaver elsewhere, for example the Settings block `Screensaver`.
- Scope: `overview-screen.tsx` (one condition on `standby.active` from the device status), one test in `overview-screen.test.tsx`, and this approval record. Checked with unit tests only; not looked at in the running Mac or Windows app. This covers the branch only, not merge, release, installation, or a device operation.

## 2026-10-08 — A tab opens at the top of its page

- User approval: Drafted in the overnight batch of 2026-10-08; covered by Paul's blanket approval of 2026-10-07 for this batch; wording not yet seen by him. It answers a point of issue #558 from the third Windows walk-through of that batch: Settings › `Run diagnostics` opened Support scrolled 1086 px down, with the results above the view, and Settings › `Choose screensaver` opened Appearance › Screensavers with the heading `Screensavers` cut off.
- Approved customer-visible result: Not yet seen by Paul; covered by the blanket approval only. No new screen, dialog, button, or wording. Whenever another tab or another Appearance section is opened, the page starts at its top. That holds for every way of getting there: the navigation, `Run diagnostics` and `Choose screensaver` in Settings, `Create support report` in Updates, and the jump the app makes by itself to Appearance or Updates while an install or update is running. Before, the new tab kept the scroll position of the tab the customer came from. Support therefore opens with `Connected VibeTV`, `Support report` and, below them, `Diagnostics` with its results; in a low window the results can still be below the first screenful, as on any visit to Support. While the customer stays on one tab the page does not move by itself.
- Scope: `control-center-shell.tsx` (one effect on the open tab and Appearance section), one test in `control-center-shell.test.tsx`, and this approval record. Checked with a unit test in jsdom only, which has no real scrolling; not looked at in the running Mac or Windows app, and the customer-flow browser suite was not run. Not changed: where keyboard focus goes after such a jump. This covers the branch only, not merge, release, installation, or a device operation.

## 2026-10-08 — Screensaver Studio: the Save button reads Save screensaver

- User approval: Drafted in the overnight batch of 2026-10-08; covered by Paul's blanket approval of 2026-10-07 for this batch; wording not yet seen by him. It answers a point of issue #558 from the third Windows walk-through of that batch: Screensaver Studio's button read `Save theme`, although what it saves is a screensaver. The line above the buttons already read `Save this screensaver before sending it to VibeTV.` there.
- Approved customer-visible result: Not yet seen by Paul; covered by the blanket approval only. No new screen, dialog, or button. In Screensaver Studio the button `Save theme` reads `Save screensaver`; while it saves it reads `Saving`, as before. When saving fails and the app has no better reason to give, the `Library` notice there reads `Screensaver could not be saved.` instead of `Theme could not be saved.` In Theme Studio both stay `Save theme` and `Theme could not be saved.` Where earlier entries name the button `Save theme` for Screensaver Studio, it is `Save screensaver` there from now on. Not changed in Screensaver Studio, and still worded for a theme: under `Advanced` the buttons `Mini theme` and `Import theme JSON` and the field `Theme JSON`, the notices `Theme opened.` and `Theme could not be opened.`, and the texts of the checks under `Validation`.
- Scope: `theme-studio-screen.tsx`, `theme-studio/theme-studio-toolbar.tsx` (the label is handed in), two tests in `theme-studio-screen.test.tsx`, one assertion in `scripts/test-customer-flows.mjs` (the screensaver flow presses `Save screensaver`), and this approval record. Checked with unit tests only; not looked at in the running Mac or Windows app, and the customer-flow browser suite was not run. This covers the branch only, not merge, release, installation, or a device operation.

## 2026-10-08 — A screensaver install says screensaver in its progress and under Recent activity

- User approval: Drafted in the overnight batch of 2026-10-08; covered by Paul's blanket approval of 2026-10-07 for this batch; wording not yet seen by him. It answers a point of issue #558 from the third Windows walk-through of that batch: under Appearance › Screensavers, `Install` on Retro 3D showed `Uploading theme files.` above `Preparing theme install.` and `Preparing theme files.`
- Approved customer-visible result: Not yet seen by Paul; covered by the blanket approval only. No new screen, dialog, or button. While a screensaver is installed, from the Screensavers list or with `Send to VibeTV` in Screensaver Studio, the lines of its progress say `screensaver` where they said `theme`: `Preparing screensaver install.`, `Preparing screensaver files.`, `Uploading screensaver files.`, `Uploaded screensaver file 1.` with the number counting up, `Uploaded screensaver layout.`, `Screensaver installed.`, and after an interruption `Retrying screensaver file upload.` The lines `Checking VibeTV.`, `Showing install screen on VibeTV.`, `Upload interrupted. Retrying.` and the last line `Screensaver is ready on VibeTV.` are unchanged, and so are `Installing` and `Installed` above them. When the install fails, the progress ends with `Screensaver install failed.`; the same sentence is the heading of the failure dialog when the Mac App gives no reason of its own, and `Screensaver install needs attention.` when the app itself could not carry the install out. Under Support › Recent activity such an install is entered as `Screensaver install started` and, when it fails, `Screensaver install needs attention`; a finished one already read `Screensaver installed`. The install of a theme keeps every one of its sentences. Not changed, and still worded for a theme during a screensaver install: the reasons and next steps the Mac App gives for a refused or failed install, for example `Wait for the update to finish, then install the theme again.`; the note `Theme installs are not available right now.`; and the Recent activity entries of an install that was still running when the window was opened again.
- Scope: `companion/internal/companionapi/server.go` (every line of an install job goes through one place, which says `screensaver` for a job in the screensaver slot), `control-center-app.tsx` (`installTheme`: the first line, the two Recent activity labels and the two fallback sentences), one Go test in `server_test.go`, the new `control-center-app.screensaver-install.test.tsx`, and this approval record. Checked with unit tests only; not looked at in the running Mac or Windows app, and the customer-flow browser suite was not run: it plays the Mac App's lines from fixtures and asserts none of the changed ones. This covers the branch only, not merge, release, installation, or a device operation.

## 2026-10-08 — Setup log: a screensaver install is entered as Screensaver install

- User approval: Drafted in the overnight batch of 2026-10-08; covered by Paul's blanket approval of 2026-10-07 for this batch; wording not yet seen by him. It answers a point of issue #558 from the third Windows walk-through of that batch: on Support the Setup log entered the install of a screensaver as `Theme install` › `Started` › `Installing theme.`, followed by `Theme install` › `Done` › `Screensaver is ready on VibeTV.`
- Approved customer-visible result: Not yet seen by Paul; covered by the blanket approval only. No new screen, dialog, or button. In the Setup log on Support, the install of a screensaver is entered under `Screensaver install` instead of `Theme install`, and its first entry reads `Installing screensaver.` instead of `Installing theme.` The entries after it, `Done` with `Screensaver is ready on VibeTV.` or `Failed` with the reason, stand under `Screensaver install` as well. The install of a theme is entered as before: `Theme install`, `Installing theme.`, `Theme is active on VibeTV.` One thing changes for both: an install that the Mac App refuses before it has read what is to be installed, because another install or an update is running or because the request cannot be read, is entered as `Theme install` › `Failed` with the reason only, without a `Started` entry before it. That is also where a refused screensaver install is still entered under `Theme install`. Entries written before this change keep the name they were written under. The downloaded support report carries the same entries; there the stage of a screensaver install is `screensaver_install`.
- Scope: `companion/internal/companionapi/server.go` and `setup_events.go` (the install opens its Setup log entry once the request has named the slot, and the route logs the result under that stage), one Go test in `setup_events_test.go`, one test in `setup-event-log.test.tsx`, and this approval record. The page itself is unchanged: it words a stage it has no name for from the stage itself. Checked with unit tests only; not looked at in the running Mac or Windows app. This covers the branch only, not merge, release, installation, or a device operation.

## 2026-10-08 — The support report from the Windows app does not speak of the Mac

- User approval: Drafted in the overnight batch of 2026-10-08; covered by Paul's blanket approval of 2026-10-07 for this batch; wording not yet seen by him. It answers a point of issue #558 from the third Windows walk-through of that batch: the report a Windows customer downloads on Support contained `Mac App is up to date.`, `The Mac App's background service started again.`, `"installationMode": "dmg"` and `"native-mac-app"`, while the screens themselves have no `Mac`.
- Approved customer-visible result: Not yet seen by Paul; covered by the blanket approval only. No screen, dialog, or button changes. The report that `Copy` and `Download` hand out in the Windows App, on Support and behind `Help` in setup, words every text in it the way the Windows App's screens do: `Mac App` reads `App` at the start of a sentence and `app` inside one, `this Mac` reads `this computer`, and `from Applications` reads `from the Start menu`. So the two sentences above read `App is up to date.` and `The app's background service started again.` The field `surface` of that report reads `native-windows-app` instead of `native-mac-app`. Not changed: `"installationMode": "dmg"`, in the report and everywhere else. It is the name of the mode in which the app itself owns the background service, as opposed to `legacy`; the Windows App runs in that mode as well, the app and its checks compare against that word, and renaming it is not part of this entry. Field names such as `macAppSelfUpdateEnabled` and `installedInApplications` stay too. The Mac App's report is unchanged, character for character. A report created in a browser keeps the Mac wording on every system, as before.
- Scope: `support-report.ts` (the report records the Windows App as its surface; the one place that turns a report into text words it for that surface with the function the screens use), `control-center-types.ts` (the new surface name), `control-center-app.tsx` (hands over which system the app runs on), three tests in `support-report.test.ts`, one paragraph in `docs/architecture.md`, and this approval record. Checked with unit tests only; no report was downloaded from the running Windows or Mac app. This covers the branch only, not merge, release, installation, or a device operation.

## 2026-10-08 — Updates: the second card is titled VibeTV

- User approval: Drafted in the overnight batch of 2026-10-08; covered by Paul's blanket approval of 2026-10-07 for this batch; wording not yet seen by him. It answers a point of issue #558 from the third Windows walk-through of that batch: the two cards on Updates were titled `App` and `VibeTV update`, one after what is updated and the other after the update.
- Approved customer-visible result: Not yet seen by Paul; covered by the blanket approval only. No new screen, dialog, or button. On Updates the title of the second card reads `VibeTV` instead of `VibeTV update`. The first card keeps `Mac App`, in the Windows App `App`. Everything else in both cards is unchanged: `Software running on your VibeTV.`, `Installed firmware`, `Available firmware`, `Last checked`, the badge `Update available`, and the notes and progress of an update. Other texts that speak of the `VibeTV update` as the update itself, for example `The VibeTV update unlocks when it finishes.` and `Preparing VibeTV update.`, stay. The title is a heading of the card and no other heading on Updates reads `VibeTV`.
- Scope: `updates-screen.tsx` (one word), one test in `updates-screen.test.tsx`, one locator in `scripts/test-customer-flows.mjs` (the firmware card is found by its heading, now `VibeTV` matched exactly), and this approval record. Checked with unit tests and the screen's accessibility check; not looked at in the running Mac or Windows app, and the customer-flow browser suite was not run. This covers the branch only, not merge, release, installation, or a device operation.

## 2026-10-08 — Themes: saving an edited catalog theme never replaces the customer's own theme with the same id

- User approval: Drafted in the overnight batch of 2026-10-08; covered by Paul's blanket approval of 2026-10-07 for this batch; wording not yet seen by him. The automated review of the pull request found it next to the entry before this one: when a later catalog gives one of its themes the id under which the customer saved a theme of their own, `Edit` on the catalog row followed by `Save theme` stored the copy in the place of the customer's theme, which was gone from the library.
- Approved customer-visible result: Not yet seen by Paul; covered by the blanket approval only. No new screen, dialog, button, or wording. A catalog theme opened with `Edit` and saved is always added to the library as a new theme, as it is for every other catalog theme. The customer's own theme with that id stays in the list unchanged. Saving one of the customer's own themes still updates that theme.
- Scope: `saveThemeFromEditor` in `theme-library-screen.tsx` (only a theme opened from the customer's own row is looked up among their saved themes), the new test `theme-library-screen.catalog-copy.test.tsx`, and this approval record. Checked with unit tests when this entry was written; such a pair was not produced in the running app. This covers the branch only, not merge, release, installation, or a device operation.

## 2026-10-08 — A catalog screensaver in its first revision is updated again; a saved own screensaver is still never replaced

- User approval: Drafted in the overnight batch of 2026-10-08; covered by Paul's blanket approval of 2026-10-07 for this batch; wording not yet seen by him. The automated review of the batch found it on the entry `The customer's own screensaver is not replaced by a catalog screensaver with a similar file name` above: that change took every screensaver file in its first revision for the customer's own, but catalog screensavers were shipped in their first revision too, for example Token Fire 0.1.3, and a VibeTV that still holds one was no longer updated.
- Approved customer-visible result: Not yet seen by Paul; covered by the blanket approval only. No new screen, dialog, button, or wording. A catalog screensaver that VibeTV still holds in its first revision is updated by the app by itself again, as before this batch. The Screensavers list marks its row `Installed` and Settings › Screensaver names it, for example `Token Fire is installed.`; since the entry above the list left it unmarked and Settings read `A custom screensaver is installed.` A screensaver the customer saved in the library is still never replaced by a catalog one, also when its file on VibeTV starts like a catalog screensaver's: its own row is marked `Installed` and Settings names it by the name it was saved under. What makes a file the customer's is now the library on this computer: it is the file one of their saved screensavers is sent under. One limit follows, and it is the state before this batch: a screensaver of the customer's that was changed and saved again since it was sent, deleted from the library, or sent from another computer is told by its file name alone. If that name is a catalog screensaver's up to the revision, which today takes the id `rcf` or `r3d`, the app takes it for an old revision of that screensaver, names it so and installs the catalog screensaver over it. The limit named in the entry above, that a catalog screensaver in its first revision is not updated by itself, no longer holds.
- Scope: `resolveInstalledScreensaver`, `installedScreensaver`, `resolveScreensaverUpgrade` and the new `ownThemePaths` in `lib/active-theme-upgrade.ts`, `control-center-app.tsx` (the automatic update reads the saved library whenever VibeTV reports another screensaver file), two tests in `active-theme-upgrade.test.ts`, one of them the rewritten test of the entry above, the new `control-center-app.own-theme-update.test.tsx`, and this approval record. Checked with unit tests only; not looked at in the running Mac or Windows app, and no VibeTV holding a first-revision screensaver was updated. This covers the branch only, not merge, release, installation, or a device operation.

## 2026-10-08 — Themes: the customer's saved theme is not replaced by a catalog theme with the same id while VibeTV is awake

- User approval: Drafted in the overnight batch of 2026-10-08; covered by Paul's blanket approval of 2026-10-07 for this batch; wording not yet seen by him. An independent review of the batch found it: for a pair with a shared id, the rule that tells the two apart by their file held during standby only. Awake, VibeTV names its theme by the id, the app took the customer's theme for an old revision of the catalog theme and installed the catalog theme over it, again after every app start.
- Approved customer-visible result: Not yet seen by Paul; covered by the blanket approval only. No new screen, dialog, button, or wording. It applies only when a later catalog gives one of its themes the id of a theme the customer saved in the library; every other theme behaves as before. While VibeTV is awake and draws that saved theme, the app no longer installs the catalog theme over it, neither by itself nor as part of a VibeTV update, and the `VibeTV` card on Updates does not show `Update available` because of it. What makes the theme the customer's is the library on this computer: VibeTV draws the file one of their saved themes is sent under. A file that no saved theme is sent under is still judged by the id, and the catalog theme is installed over it as before: the customer's theme after it was changed and saved again without being sent, after it was deleted from the library, or sent from another computer. A VibeTV that reports no file is judged by the id as well. A catalog theme that VibeTV holds in an old revision, its first included, is updated as before. During standby nothing changes. In the Themes and Screensavers lists, for the two rows of such a pair: an install that no row started, for example the automatic update or `Send to VibeTV` in the Studio, no longer shows its progress only under the row whose `Install` was pressed last. While it runs or after it failed it appears in both rows, as it does when no row was pressed; once it is finished, `Installed` with its line appears in the row whose file VibeTV holds. The install started from a row still shows in that row only, and a failed one stays there with `Try again`. Not changed: while a failed install stands in a row, a later install that no row started still shows under that row.
- Scope: `resolveActiveThemeUpgrade` in `lib/active-theme-upgrade.ts` (takes the paths of the saved themes), `control-center-app.tsx` (hands them over in the four places that ask whether the active theme needs an update; the one on every render reads the library only when VibeTV reports another file), `theme-library-screen.tsx` (the pressed row is forgotten once its install succeeded), one test in `active-theme-upgrade.test.ts`, two in `control-center-app.own-theme-update.test.tsx`, the extended test in `theme-library-screen.custom.test.tsx`, and this approval record. Checked with unit tests only; such a pair was not produced on a real VibeTV, and nothing was looked at in the running Mac or Windows app. This covers the branch only, not merge, release, installation, or a device operation.

## 2026-10-08 — Themes: a catalog row reads Installed only for a file that can be the catalog theme's

- User approval: Drafted in the overnight batch of 2026-10-08; covered by Paul's blanket approval of 2026-10-07 for this batch; wording not yet seen by him. An independent review of the batch and the automated review of the pull request found it on the entry `Themes: an own theme and a catalog theme with the same id are told apart by their file` above: the catalog row of such a pair read `Installed` for every file that was not the own theme's current one, and once the customer had changed and saved the own theme, which gives the saved copy another id, the catalog row read `Installed` from the id alone.
- Approved customer-visible result: Not yet seen by Paul; covered by the blanket approval only. No new screen, dialog, button, or wording. In the Themes and Screensavers lists a catalog row reads `Installed` only when the file VibeTV holds can be that catalog theme's: its file in the current or an older revision. Two cases change. For a pair with a shared id, a file that is neither theme's, for example the own theme's file from before it was changed and saved again, no longer marks the catalog row; both rows offer `Install`. And when the own theme of such a pair was changed and saved, so that the saved copy has another id and the two no longer share one, the awake VibeTV still reports the old id and holds the old file: the catalog row now offers `Install`, where it read `Installed` with `Install` closed. Nothing changes where the file cannot be compared: VibeTV reports no file, the catalog names no file for the theme, or the held file has no revision in its name, as early theme files had; there the id decides as before. One limit: a file is told by its name up to the revision. A theme of the customer's is sent under the first seven characters of its id, and the catalog names some of its files the same way, today Claude Creature, Clippy, Duo, Mini Classic and Synthwave. An old file of the customer's with one of those ids still counts as that catalog theme, and its row reads `Installed`. The customer's own row is unchanged.
- Scope: `theme-library-screen.tsx` (one more condition on the `Installed` mark of a catalog row), the new `pathMayNameCatalogTheme` in `lib/active-theme-upgrade.ts`, one new test in `theme-library-screen.test.tsx`, two more cases in a test in `theme-library-screen.custom.test.tsx`, whose catalog fixture now has a path VibeTV could hold, and this approval record. Checked with unit tests only; not looked at in the running Mac or Windows app, such a pair was not produced on a real VibeTV, and the customer-flow browser suite was not run. This covers the branch only, not merge, release, installation, or a device operation.

## 2026-10-08 — Run setup again and Reset to factory settings wait for a brightness or screensaver change that is still being saved

- User approval: Drafted in the overnight batch of 2026-10-08; covered by Paul's blanket approval of 2026-10-07 for this batch; wording not yet seen by him. An independent review of the batch found it on the entry `Settings and Updates: a control keeps keyboard focus while its change is saved` above: since brightness and screensaver changes are sent one after the other and their controls stay usable meanwhile, both resets could be started while such a change was still on its way or waiting, and they waited only for the provider and display mode changes.
- Approved customer-visible result: Not yet seen by Paul; covered by the blanket approval only. No new screen, dialog, button, or wording. `Run setup again`, in Settings and on Support, and `Reset to factory settings` first let a brightness or screensaver change that is still being saved reach VibeTV and then start. The button shows `Resetting` during that wait, as it does during the reset itself, and the other controls in Settings are closed. Before, the reset started at once: a change on its way reached VibeTV while it was being reset or erased, and one waiting behind it was sent afterwards or dropped. With no change being saved, both start at once as before.
- Scope: `resetSetup` and `eraseDevice` in `control-center-app.tsx` (both wait for the queue of brightness and screensaver writes), one test for each in `control-center-app.display-preferences.test.tsx`, and this approval record. Checked with unit tests only; not looked at in the running Mac or Windows app, and no VibeTV was reset. This covers the branch only, not merge, release, installation, or a device operation.

## 2026-10-08 — Settings: the Brightness thumb stays where it is dragged while an earlier change is saved

- User approval: Drafted in the overnight batch of 2026-10-08; covered by Paul's blanket approval of 2026-10-07 for this batch; wording not yet seen by him. An independent review of the batch found it on the entry `Settings and Updates: a control keeps keyboard focus while its change is saved` above: since Brightness stays usable while a change is saved, the customer can drag it again before the first save is answered, and that answer set the thumb back.
- Approved customer-visible result: Not yet seen by Paul; covered by the blanket approval only. No new screen, dialog, button, or wording. When the customer drags `Brightness` again while an earlier brightness change is still being saved, the thumb and the percentage beside the label stay where the customer holds them when that save is answered. Before, the answer set both back to the earlier value until the pointer moved again. Letting go saves the new value as before, and `Brightness saved` is entered under Recent activity for each saved value as before. Not changed: `Brightness in screensaver` still jumps back in the same situation.
- Scope: `saveBrightness`, `changeBrightness` and the note of an unconfirmed brightness in `control-center-app.tsx` (it now holds the value the customer chose last, and an answer is only written to the control when it is the answer to that value), one test in `control-center-app.display-preferences.test.tsx`, which drags with a simulated pointer, and this approval record. Checked with unit tests only; not dragged in the running Mac or Windows app. This covers the branch only, not merge, release, installation, or a device operation.

## 2026-10-08 — Setup log: a refused upload of the customer's own screensaver is entered as Screensaver install

- User approval: Drafted in the overnight batch of 2026-10-08; covered by Paul's blanket approval of 2026-10-07 for this batch; wording not yet seen by him. An independent review of the batch found it on the entry `Setup log: a screensaver install is entered as Screensaver install` above: the Mac App named the stage only after it had read the request, although an uploaded theme file names its slot in the address of the request.
- Approved customer-visible result: Not yet seen by Paul; covered by the blanket approval only. No new screen, dialog, button, or wording. In the Setup log on Support, and in the downloaded support report, a screensaver the customer made that the Mac App refuses while it reads the uploaded file is entered as `Screensaver install` › `Failed` with the reason, where it was entered as `Theme install` › `Failed`: the file is too large, empty, not a valid theme file, or the upload took too long. As before there is no `Started` entry in front of it. Still entered under `Theme install`, for a screensaver as well: an install refused before anything is read, because another install or an update is running or the Mac App is restarting, and a catalog screensaver whose request cannot be read. This narrows the last limit named in the entry above.
- Scope: `handleThemeInstall` in `companion/internal/companionapi/server.go` (the stage is taken from the address of the request before the upload is read), one Go test in `setup_events_test.go`, and this approval record. No file of the app's pages changed. Checked with unit tests only; not looked at in the running Mac or Windows app. This covers the branch only, not merge, release, installation, or a device operation.

## 2026-10-08 — A theme the customer sent and has edited since is still their own

- User approval: Drafted in the overnight batch of 2026-10-08; covered by Paul's blanket approval of 2026-10-07 for this batch; wording not yet seen by him. The automated review of the pull request found the gap in the entries above: the app told the customer's file on VibeTV by the library saved in this browser, and a theme that was edited and saved after it was sent has another path there (and, when its id is also a catalog theme's, another id). On the next start the automatic update then installed the catalog theme over the file VibeTV still showed.
- Approved customer-visible result: Not yet seen by Paul; covered by the blanket approval only. No new screen, dialog, button, or wording. The app remembers the files it sent to VibeTV for themes and screensavers the customer made (the last fifty, in this browser). A file VibeTV reports under one of them is never taken for a catalog theme or screensaver and never replaced by the automatic update, also after the theme was edited, saved under another name, or deleted from the library. A theme sent from another computer is not known here and is judged as before.
- Scope: the new `lib/sent-own-theme-paths.ts` with its test, `installCustomTheme` and `savedThemePaths` in `control-center-app.tsx`, one test in `control-center-app.own-theme-update.test.tsx`, and this approval record. Checked with unit tests when this entry was written. This covers the branch only, not merge, release, installation, or a device operation.

## 2026-10-08 — Themes: a file the app sent for an own theme does not mark the catalog row Installed

- User approval: Drafted in the overnight batch of 2026-10-08; covered by Paul's blanket approval of 2026-10-07 for this batch; wording not yet seen by him. The automated review of the pull request found that the list of sent files from the entry before this one was used by the automatic update only, not by the `Installed` mark in the Themes list.
- Approved customer-visible result: Not yet seen by Paul; covered by the blanket approval only. No new screen, dialog, button, or wording. When VibeTV reports the id of a catalog theme but holds a file this app sent for a theme the customer made (an own theme with that id that was edited and saved under another id since), the catalog row keeps `Install` instead of reading `Installed`, also when the file's name starts like the catalog theme's. Every other row is unchanged.
- Scope: the `installed` mark of a catalog row in `theme-library-screen.tsx`, one test in `theme-library-screen.custom.test.tsx`, and this approval record. Checked with unit tests when this entry was written. This covers the branch only, not merge, release, installation, or a device operation.

## 2026-10-08 — Two tests only: a refused setting change and a refused install after a finished one

- User approval: Drafted in the overnight batch of 2026-10-08; covered by Paul's blanket approval of 2026-10-07 for this batch; wording not yet seen by him. The automated review of the pull request asked whether a refused change of a display setting stays on screen after a later change was stored, and whether a finished install can replace the failure of a later refused one. Both were checked and neither happens.
- Approved customer-visible result: Not yet seen by Paul; covered by the blanket approval only. Nothing changes for the customer: no screen, dialog, button, wording, or behaviour. Two tests were added that hold the existing behaviour in place.
- Scope: one test in `control-center-app.display-preferences.test.tsx` (with a small change to that file's test double: a write can be refused once, after it was held), one test in `control-center-app.custom-theme-install.test.tsx` (its test double can run a first install as a job), and this approval record. No file of the app itself changed. This covers the branch only, not merge, release, installation, or a device operation.

## 2026-10-08 — Settings: the Brightness in screensaver thumb stays where it is dragged while an earlier change is saved

- User approval: Drafted in the overnight batch of 2026-10-08; covered by Paul's blanket approval of 2026-10-07 for this batch; wording not yet seen by him. It is the limit the entry `Settings: the Brightness thumb stays where it is dragged while an earlier change is saved` above names as not changed.
- Approved customer-visible result: Not yet seen by Paul; covered by the blanket approval only. No wording changes, and no new screen, dialog, or button. When the customer drags `Brightness in screensaver` again while an earlier screensaver change is still being saved, the thumb and the percentage beside the label stay where the customer holds them when that save is answered. Before, the answer set both back to the earlier value until the pointer moved again. Letting go saves the new value as before, and `Screensaver saved` is entered under Recent activity for each saved change as before. Not changed: a save that fails still sets the screensaver controls back to what VibeTV holds, also while the thumb is held.
- Scope: `saveStandby`, `changeStandbyBrightness` and the note of an unconfirmed screensaver change in `apps/control-center/src/components/control-center-app.tsx` (it now holds the screensaver brightness the customer chose last, and an answer is only written to the controls when it is the answer to that value), the drag test in `control-center-app.display-preferences.test.tsx`, which now runs for both sliders, and this approval record; checked with unit tests only.

## 2026-10-08 — A screensaver install picked up again, and the Screensavers list in its own lines, say screensaver

- User approval: Drafted in the overnight batch of 2026-10-08; covered by Paul's blanket approval of 2026-10-07 for this batch; wording not yet seen by him. These are leftovers of issue #558 that the entry `A screensaver install says screensaver in its progress and under Recent activity` above names as not changed: the Recent activity entries of an install that was still running when the window was opened again, and the note `Theme installs are not available right now.` Reading both places found the lines the page words itself beside them.
- Approved customer-visible result: Not yet seen by Paul; covered by the blanket approval only. No new screen, dialog, or button. Every sentence below is said for a screensaver only; for a theme, and on the Themes list, each keeps its wording. A screensaver install that was still running when the window was opened again is entered under Support › Recent activity as `Screensaver installed` or `Screensaver install needs attention`, where it was entered as `Theme installed` or `Theme install needs attention`. While the Mac App has sent no line for it, the start screen and the progress on the Screensavers list read `Preparing screensaver install.` instead of `Preparing theme install.` When the Mac App names no theme for it, its Recent activity entry calls it `Screensaver` instead of `Theme`. When the app itself cannot follow it, the failure dialog is headed `Screensaver install needs attention.` instead of `Theme install needs attention.` A screensaver install the page has asked about for seven and a half minutes, picked up again or started from this window, ends with `Screensaver install is taking longer than expected.` and `Keep VibeTV powered on, then check the screensaver again.`, where it read `Theme install is taking longer than expected.` and `Keep VibeTV powered on, then check the theme again.` On the Screensavers list, a failed install the page has no reason for opens the failure dialog as `Screensaver install failed.` with `Keep VibeTV connected and try installing the screensaver again.`, where it read `Theme install failed.` and `Keep VibeTV connected and try installing the theme again.`; a running install the page has no line for reads `Preparing screensaver install.`; and while the Mac App does not offer installs, the tooltip of the `Unavailable` button reads `Screensaver installs are not available right now.` instead of `Theme installs are not available right now.` Not changed, and still worded for a theme on the Screensavers list: every reason and next step the Mac App sends, and the other tooltips of the install button, for example `Another theme install is already running.` and `Theme is already installed.`
- Scope: `resumeThemeInstallJob`, `themeInstallStatusFromJob` and `pollThemeInstallJob` in `apps/control-center/src/components/control-center-app.tsx`, `InlineInstallProgress` and `buildInstallReadiness` in `apps/control-center/src/components/theme-library-screen.tsx`, one test in `control-center-app.screensaver-install.test.tsx` (its setup is now a function both tests use), one test in `theme-library-screen.test.tsx`, and this approval record; checked with unit tests only.

## 2026-10-08 — Overview: the picture of VibeTV is named as a screensaver while the screensaver is on screen

- User approval: Drafted in the overnight batch of 2026-10-08; covered by Paul's blanket approval of 2026-10-07 for this batch; wording not yet seen by him. Found while reading the batch: in standby VibeTV reports its screensaver as the active theme, so a screen reader read the picture on Overview as a theme with the screensaver's id.
- Approved customer-visible result: Not yet seen by Paul; covered by the blanket approval only. Nothing changes on screen. The name a screen reader reads for the picture of VibeTV on Overview, and on the last screen of setup, which shows the same picture, changes while the screensaver is on screen: `Rendered VibeTV screensaver Night Clock showing Codex, Weekly 29% used`, with the screensaver's title, where it read `Rendered VibeTV theme night-clock showing Codex, Weekly 29% used`, with its id. When the app has no title for the screensaver, the name reads `Rendered VibeTV screensaver showing Codex, Weekly 29% used`. The part after `showing` is built as before. While VibeTV is awake the name is unchanged, `Rendered VibeTV theme` followed by the theme's id, and so are the names of the previews in the Themes and Screensavers lists and in the Studio.
- Scope: `themeSpecAriaLabel`, `ThemeSpecSVG` and the picture in `LiveVibeTVPreview` in `apps/control-center/src/components/live-vibetv-preview.tsx`, one test in `live-vibetv-preview.recovery.test.tsx`, and this approval record; checked with unit tests only.

## 2026-10-08 — Settings: the two setup actions side by side, Run diagnostics only on Support

- User approval: Paul asked for it in chat on 2026-10-08, with a screenshot of the Setup block in Settings: "run setup again und reset to factory settings nebeneinander. run diagnostics aus dem settings tab entfernen."
- Approved customer-visible result: Settings › Setup shows `Run setup again` and `Reset to factory settings` next to each other in one row; before, the second stood below the first. On a narrow window the second wraps below. The button `Run diagnostics` at the end of Settings › AI providers is gone; `Run diagnostics` on Support is unchanged. No wording changes.
- Scope: `settings-screen.tsx`, `control-center-app.tsx` (the handler that only served that button), the test in `settings-screen.test.tsx`, the removed `settings-diagnostics.test.tsx`, two comments, and this approval record. Checked with unit tests when this entry was written. This covers the branch only, not merge, release, installation, or a device operation.

## 2026-10-08 — Paul has seen the new sentences of the overnight batch

- User approval: Paul was given the list of the new and changed customer-visible sentences of the entries dated 2026-10-08 above in chat on 2026-10-08 and answered: "rest der sätze passt so". Before that he took three things out of the batch, which this branch follows: the Duo theme ("raus, hier müssen wir nochmal ans design"), the Retro 3D screensaver ("den auch nochmal raus, da müssen wir auch nochmal ans design") and the button `Run diagnostics` in Settings. He also decided that the shortcut for the next provider may stay as built, that the page `Your VibeTV is live` stays while usage is starting, and that the Mac background service runs at standard priority.
- Approved customer-visible result: The sentences listed for him are approved as worded: `Usage display` with `Default` / `Used` / `Remaining`; `Switch providers` with its four choices and `VibeTV switches between your providers on a timer.`; the two lines about the shortcut; `<name> is installed.` / `A custom screensaver is installed.` / `No screensaver is installed yet.`; the `Run setup again?` dialog; `Weak WiFi signal` with `Move VibeTV closer to your router.`; the Display tile `Screensaver`; `Last checked …`; the Updates card title `VibeTV`; `Downloaded` with `Saved as … in your Downloads folder.`; the `WiFi signal` field; `Custom theme`; the screensaver install, Setup log and Recent activity lines that say `screensaver`; `Transparent color`, `Make transparent`, `On VibeTV, transparent areas show the theme background.`; `Save this theme before sending it to VibeTV.` and its screensaver form; `Untitled theme` / `Untitled screensaver`; `Draft`; `Save screensaver` and `Screensaver could not be saved.`; `Saved in your Downloads folder. Nothing was sent.`; the two sentences about a single picture saved as an animation and the reverse; the browser sign-in sentence for Claude; and the theme name `Token Counter`. He saw the sentences as a list, not each of them on its screen. The names `Duo` and `Retro 3D` are not approved; both are removed from this branch.
- Scope: this approval record only; it changes no file of the app. The earlier entries of 2026-10-08 keep their own status lines as written at the time.

## 2026-10-08 — Settings: the screensaver brightness thumb stays where it is dragged when an earlier save is refused

- User approval: Not separately approved by Paul. Correction from the automated review of head `08214e7c` on 2026-10-08, inside the batch his blanket approval of 2026-10-07 covers; the entry `Settings: the Brightness in screensaver thumb stays where it is dragged while an earlier change is saved` above did the same for a save that is answered with success.
- Approved customer-visible result: No wording, no new screen, dialog, or button. Settings › Screensaver › `Brightness in screensaver`: when a save is refused while the customer is already dragging the thumb to a next value, the thumb stays where they hold it, and letting go saves that value. Before, the thumb jumped back to the last stored value and letting go saved that one. The message about the refused save appears as before. When nothing was dragged on, the controls go back to what VibeTV holds, as before.
- Scope: the `catch` branch of `saveStandby` in `apps/control-center/src/components/control-center-app.tsx`, one test in `control-center-app.display-preferences.test.tsx` (its fake Mac App can now refuse a settings write), and this approval record; checked with unit tests only.

## 2026-10-08 — An own theme is noted as the customer's when it is sent, not when the install is confirmed

- User approval: Not separately approved by Paul. Correction from the automated review of head `2c91f319` on 2026-10-08, inside the batch his blanket approval of 2026-10-07 covers; it completes the entry `Themes: a file the app sent for an own theme does not mark the catalog row Installed` above.
- Approved customer-visible result: No wording, no new screen, dialog, or button, and nothing changes at the moment of the install. The app notes the file of a theme or screensaver from Theme Studio as the customer's own when it sends it; before, it noted it only after an install that ended as confirmed. That left out an install during which VibeTV had not confirmed its display yet, and one that failed after the file was already on VibeTV. For such a file the rules of the entries above now hold as well: it is not shown as an installed catalog theme and is not replaced by a catalog theme with the same id by the automatic theme update.
- Scope: `installCustomTheme` in `apps/control-center/src/components/control-center-app.tsx`, one test in `control-center-app.custom-theme-install.test.tsx`, and this approval record; checked with unit tests only.

## 2026-10-08 — Settings and the Screensavers list do not name a sent own screensaver after a catalog one

- User approval: Not separately approved by Paul. Correction from the automated review of head `0320527d` on 2026-10-08, inside the batch his blanket approval of 2026-10-07 covers; the sentences are the ones he approved as worded on 2026-10-08.
- Approved customer-visible result: No new wording, screen, dialog, or button. A screensaver the customer made and sent, then changed and saved again or deleted, still lies on VibeTV under the file it was sent as. When that file name starts like a catalog screensaver's, Settings › Screensaver said `<catalog name> is installed.` and the Screensavers list marked the catalog row `Installed`. Settings now says `A custom screensaver is installed.` and the catalog row is not marked. A file the app did not send is told by its name as before, so an older revision of a catalog screensaver is still named.
- Scope: `installedScreensaver` in `apps/control-center/src/lib/active-theme-upgrade.ts`, one test in `active-theme-upgrade.test.ts`, and this approval record; checked with unit tests only.

## 2026-10-08 — Settings: a read beside a pending change of Usage display does not put the old value back

- User approval: Not separately approved by Paul. Correction from the automated review of head `6a4f118e` on 2026-10-08, inside the batch his blanket approval of 2026-10-07 covers.
- Approved customer-visible result: No wording, no new screen, dialog, or button. Settings › Display › `Usage display`: when the customer changes the value, leaves Settings and comes back while the change is still on its way to the Mac App, the control keeps the value they chose. Before, the read that starts on coming back could find the old value and, answered after the change was stored, show it again until the next read, although the new value was stored.
- Scope: `refreshDisplayPreferences` in `apps/control-center/src/components/control-center-app.tsx`, one test in `control-center-app.display-preferences.test.tsx`, and this approval record; checked with unit tests only.

## 2026-10-08 — Settings: after a refused save the Brightness slider shows VibeTV's value again

- User approval: Not separately approved by Paul. Correction from the automated review of head `4e6b3bf4` on 2026-10-08, inside the batch his blanket approval of 2026-10-07 covers.
- Approved customer-visible result: No wording, no new screen, dialog, or button. Settings › Display › `Brightness`: when a save is refused, the message appears as before and the thumb stays where the customer put it for the moment. The next time the app reads what VibeTV holds, for example when Settings is opened again, the slider shows VibeTV's value. Before, it kept showing the value that was never stored until the app was started again. A thumb the customer has dragged on to a newer value keeps that value.
- Scope: the `catch` branch of `saveBrightness` in `apps/control-center/src/components/control-center-app.tsx`, one test in `control-center-app.display-preferences.test.tsx`, and this approval record; checked with unit tests only.

## 2026-10-08 — Theme Studio and the previews know a progress element drawn as an arc (#414)

- User approval: Paul decided on 2026-10-08 that the gauge is worth the firmware space (issue #414); the theme, its name and its look have not been seen by him.
- Approved customer-visible result: Not yet seen by Paul. In Theme Studio the `Style` of a progress element has a third choice, `Arc`, beside `Solid` and `Segments`. With `Arc` chosen the Inspector shows three number fields, `Start angle`, `Sweep` and `Thickness`, and no longer shows `Border color` and `Border radius`, which an arc does not use. Choosing `Arc` on an element that has no arc values yet sets a start angle of 225, a sweep of 270 and a thickness of 12, or less when the element's box is smaller than 24 pixels on one side. The preview draws such an element as a ring inside its box instead of a bar, wherever a theme is previewed: on Overview, in the Themes list and in Theme Studio. A theme with an arc opens, saves, exports and is sent with the arc unchanged. Theme Studio refuses an arc VibeTV would not draw, with one of three new sentences: `Element 1: arc start must be between 0 and 359.`, `Element 1: arc sweep must be between 1 and 360.` and `Element 1: arc thickness must be between 1 and half the smaller of width and height.` (with the element's number). One existing sentence is reworded from `Element 1: progress style must be solid or segments.` to `Element 1: progress style must be solid, segments or arc.`; the app drops an unknown style before that check, so the tests could not make it appear. For a VibeTV whose firmware does not draw arcs the existing wording is reused and nothing new is said: Theme Studio shows `This VibeTV needs a firmware update before it can use this theme.` for a theme with an arc, and a catalog theme that needs the arc is held back in the Themes list like a theme that needs one of the earlier firmware features (`Update firmware first.`). As with those features, a VibeTV that does not announce the arc counts as not up to date where the app cannot tell which theme is active, so `The firmware is current, but VibeTV still needs attention.` can appear after a firmware update that did not bring the arc. No theme in the catalog uses an arc with this change alone.
- Scope: `lib/theme-studio.ts` (the arc fields, their limits, export and import, and `progress-arc-v1` in a saved pack), `lib/theme-studio-capabilities.ts`, `lib/active-theme-upgrade.ts`, `components/control-center-types.ts`, the capability lists in `components/theme-library-screen.tsx`, the arc in `components/live-vibetv-preview.tsx`, the three fields in `components/theme-studio/primitive-inspector.tsx`, tests in `theme-studio.test.ts`, `theme-studio-capabilities.test.ts`, `active-theme-upgrade.test.ts`, `live-vibetv-preview.test.ts` and `primitive-inspector.test.tsx`, the new capability in the device fixtures of three more test files and of `scripts/test-customer-flows.mjs`, and this approval record; checked with unit tests only, not on a device. The customer-flow browser suite was not run, and the Inspector was not looked at in the running app.

## 2026-10-08 — Themes: a new live theme, Gauge (#414)

- User approval: Paul decided on 2026-10-08 that the gauge is worth the firmware space (issue #414); the theme, its name and its look have not been seen by him.
- Approved customer-visible result: Not yet seen by Paul. The Themes list offers a new live theme named `Gauge`. On VibeTV and in its previews it shows, from top to bottom: the provider's name; a half ring from 9 o'clock over the top to 3 o'clock for the first usage window, a dark track that fills from the left by the window's percentage, in green, yellow, orange or red by how much is left (from 75, 50, 25 and 0 percent left); in the opening of the ring that percentage as a large number, for example `64%`; the window's name and the usage mode, for example `Session used` or `Session remaining`; a small line for a second usage window when VibeTV is sent one, for example `Weekly 28%`; and at the bottom `Reset in 2h 14m`. The number, the window line and the reset line are white or grey text, so none of them is told by colour. With no reset time the bottom line reads `Reset unavailable`, or `No active session` for a window with nothing used and nothing scheduled, as in the other themes; the ring and the number stay. With no usage window only the provider's name is shown: the ring, the number and the lines below are left out, not drawn empty. The only words the theme itself adds are `Reset in` and the `%` sign; every other word comes from VibeTV's data. On a VibeTV whose firmware does not draw arcs the theme cannot be installed before a firmware update, with the existing wording of the Themes list.
- Scope: the new `theme-packs/gauge/` (`theme.json`, `manifest.json`), its built `dist/theme-packs/vibetv-theme-gauge-v0.1.0.zip`, render pack `dist/theme-packs/render/gauge.json` and `render/gauge/ga-2-ad19500f.json`, its entry in `dist/theme-packs/vibetv-theme-packs-v2.json`, the new test `apps/control-center/src/theme-packs/gauge-theme.test.ts`, and this approval record; checked with unit tests only, not on a device. The theme lists and pictures in `README.md` and `docs/themes.md` do not name it yet.

## 2026-10-08 — Paul has seen Gauge and chose the half ring

- User approval: Paul was shown three drawn variants of the Gauge theme in chat on 2026-10-08 (A: half ring, B: three-quarter ring, C: half ring with a needle) and answered: "gauge variante a find ich gut."
- Approved customer-visible result: The look of the live theme `Gauge` as the pack in this branch draws it, which is variant A: provider name on top, a half ring that fills with the first usage window and changes colour with the remaining quota, the percent value inside it, the second window as one small line, and the reset countdown. The picture was titled with the name `Gauge` and showed the screen at 0, 50, 64 and 100 percent and without a reset time. The row in the Themes list and the Theme Studio fields for an arc of the entry above have not been seen by him.
- Scope: this approval record only; it changes no file of the app. The two entries above keep their status lines as written at the time.

## 2026-10-08 — Theme Studio: choosing Arc is one step of Undo

- User approval: Not separately approved by Paul. Correction from the automated review of head `5a849d94` on 2026-10-08 to the entry `Theme Studio and the previews know a progress element drawn as an arc (#414)` above, whose fields he has not seen.
- Approved customer-visible result: No wording, no new field. Inspector › Style › `Arc` on a bar without arc values sets the style and the ring's start angle, sweep and thickness as one change. One Undo takes the whole arc back to the bar. Before, the choice was four changes, and one Undo removed only the thickness and left an arc that could not be saved or exported until three more Undos.
- Scope: `setPrimitiveField` in `apps/control-center/src/components/theme-studio/editor-geometry.ts`, the Style select in `primitive-inspector.tsx`, the test in `primitive-inspector.test.tsx` (its harness now applies changes with `setPrimitiveField`, as the editor does, and counts them), and this approval record; checked with unit tests only.

## 2026-10-08 — Theme Studio: a bar that kept part of an arc gets what is missing

- User approval: Not separately approved by Paul. Correction from the automated review of head `78773bbf` on 2026-10-08 to the entry `Theme Studio: choosing Arc is one step of Undo` above.
- Approved customer-visible result: No wording, no new field. Inspector › Style › `Arc` on a bar that already holds a sweep but no thickness, as an imported theme may, adds the thickness in the same change, so the theme can be saved and exported; the sweep it holds stays, and a start angle that is left out stays left out (12 o'clock). A bar that holds a start angle or a thickness but no sweep keeps them and gets the sweep. A bar without any arc value gets all three, as before.
- Scope: `setPrimitiveField` in `apps/control-center/src/components/theme-studio/editor-geometry.ts`, two tests in `editor-geometry.test.ts`, and this approval record; checked with unit tests only.
- What's new: none — a fix inside the arc fields this pull request adds

## 2026-10-08 — Theme Studio: an arc's ring gets thinner when its box is made smaller

- User approval: Not separately approved by Paul. Correction from the automated review of head `13739155` on 2026-10-08 to the arc fields of this pull request, which he has not seen.
- Approved customer-visible result: No wording, no new field. When an arc's box is made smaller than twice its ring, by dragging the handle in the preview or by the `Width` and `Height` fields, `Thickness` goes down with it to half the smaller side, in the same change. Before, the arc disappeared from the preview and Save and Export were off until Thickness was lowered by hand. The box of an arc is at least 2 px on each side. A box that grows leaves the ring as it is, and a straight bar is not touched.
- Scope: `setPrimitiveField` in `apps/control-center/src/components/theme-studio/editor-geometry.ts`, the resize handler in `theme-studio-screen.tsx` (it now sets both sides with that function), one test in `editor-geometry.test.ts`, and this approval record; checked with unit tests only.
- What's new: none — a fix inside the arc fields this pull request adds

## 2026-10-08 — Previews: an empty long-form progress style decides, as on VibeTV

- User approval: Not separately approved by Paul. Correction from the automated review of head `d9baa3cf` on 2026-10-08.
- Approved customer-visible result: No wording, nothing changes for a theme built in Theme Studio or shipped in the catalog. A hand-written theme that holds both `"progressStyle":""` and `"ps":"arc"` (or `"ps":"segments"`) is drawn in the app's previews as a straight bar, which is what VibeTV draws for it. Before, the previews drew the arc or the segments.
- Scope: the style a progress element is drawn with in `apps/control-center/src/components/live-vibetv-preview.tsx`, one test in `live-vibetv-preview.test.ts`, and this approval record; checked with unit tests only.
- What's new: none — a preview correction for hand-written themes

## 2026-10-08 — What's new: a notice on Overview after an update, readable again under Updates

- User approval: Paul was shown two drawn variants in chat on 2026-10-08, A with a dialog in the middle of Overview and B with a card on top of Overview, both with the three items and all texts below, and answered: "a. texte passen so." He asked for the rule that goes with it with: "wie bauen wir das so, dass das in zukunft für jede änderung berücksichtigt wird, die wir machen?" He has seen the drawing, not the built dialog.
- Approved customer-visible result: A new dialog `What's new`. It opens by itself the first time a customer who was already set up is on Overview after an update, as long as the list has an entry they have not seen; it shows the newest of those, at most three. It does not open during setup, during a firmware update, while the Mac App has stopped, or while the dialog about a lost VibeTV or about usage that cannot start is open; it opens once that is over. A customer who is setting VibeTV up never gets it. Above the title stands `Version` followed by the installed app version, for example `Version 1.0.63`, in small capital letters; when the app does not know its version, the line is left out. Below the title are three items, each with a small icon: `Switch providers with a shortcut` with `Press ⌃⌥⌘P in any app to show the next provider on VibeTV.`, the four keys drawn as key caps; `Choose how often VibeTV switches` with `In Automatic mode VibeTV can switch when your activity changes, or every 30 seconds, every minute or every 5 minutes.` and the link `Show me in Settings`; `Show what is used or what is left` with `Choose whether VibeTV shows how much of your limit you have used or how much remains.` and the link `Show me in Settings`. At the bottom stand `You can read this again under Updates.` on the left and the button `Got it` on the right. `Got it`, Escape and a click beside the dialog close it. Closing it counts every entry of the list as seen, also an older one that was not among the three shown, so it does not come again until an update adds an entry. `Show me in Settings` closes it in the same way and opens Settings at the top of the page; it does not scroll to the setting. On Updates, a new link `What's new` at the right of the heading opens the same dialog with the three newest entries at any time. Not on the drawing, and so not seen by Paul: on Windows the first sentence reads `Press Ctrl+Alt+Shift+P in any app to show the next provider on VibeTV.`, with one key cap per key and the plus signs between them; the place and look of the link on Updates; that the keyboard starts on `Got it`; and that the first item is shown also on a computer where Settings says that the shortcut is not available. The dialog is built from the app's own dialog parts, so its sizes, spacing and colours are those of the other dialogs, not those of the drawing.
- Scope: the entries and the seen list in `apps/control-center/src/lib/whats-new.ts`, the dialog in `whats-new-dialog.tsx`, when it opens in `control-center-app.tsx`, the link in `updates-screen.tsx`, `providerShortcutKeys` in `settings-screen.tsx` (the keys Settings already named, now read by both), the tests `whats-new.test.ts` and `control-center-app.whats-new.test.tsx`, seven existing `control-center-app.*.test.tsx` files and `scripts/test-customer-flows.mjs`, which now start as a customer who has read the notice, and this approval record. For the rule: `scripts/check-control-center-ui-review-gate.mjs` now also asks every new approval entry for a `What's new:` line that names entries of that list or says `none` with a reason, its test script, and the section `What's New` in `docs/control-center-ui-principles.md`; `docs/control-center-accessibility.md` lists the new check. Checked with unit tests only: nobody has looked at the built dialog in the app yet, and the customer flows were adjusted but not run. This covers the branch only, not merge, release, installation, or a device operation.
- What's new: none — this change is the notice itself

## 2026-10-08 — What's new: new themes always get an entry and stand first

- User approval: Asked in chat on 2026-10-08 whether the Gauge theme should get an entry, Paul answered: "ja, neue themes immer." and "die immer vorziehen". He was then shown a drawing of the dialog with the two theme items on top and their texts; his answer to those two texts is still open when this entry is written.
- Approved customer-visible result: The dialog `What's new` now starts with one item for each theme that is new to the customer, above the three other items: `New theme: Gauge` with `A half ring that fills as you use your limit.` and `New theme: Token Counter` with `The tokens of your session as one large number.`, each with the link `Show me in Themes`. The link closes the dialog, counts it as read and opens Appearance › Themes. Theme items do not count against the three other items; at most three theme items are shown. With both themes the first notice has five items. The same holds when the dialog is opened again from Updates. Paul asked for the rule, the place on top and an entry for Gauge; the wording of the two theme items is drafted and not yet approved by him.
- Scope: the two entries, the field `theme` and the order in `apps/control-center/src/lib/whats-new.ts`, the link in `whats-new-dialog.tsx`, `onShowThemes` in `control-center-app.tsx`, the tests in `whats-new.test.ts` (among them the check that every live theme added to the catalog has an entry and no entry names a theme the catalog lacks) and `control-center-app.whats-new.test.tsx`, the section `What's New` in `docs/control-center-ui-principles.md`, and this approval record. Also in this change, from the automated review of `b5d7d0e3`: the approval gate asks every approval entry that one change adds for its own `What's new:` line, with a new case in its test script. Checked with unit tests only; the built dialog has not been seen yet.
- What's new: `theme-gauge`, `theme-token-counter`

## 2026-10-08 — What's new: opened again from Updates, it steps back for another dialog

- User approval: Not separately approved by Paul. Correction from the automated review of head `28d14630` on 2026-10-08 to the dialog he chose from a drawing ("a. texte passen so.").
- Approved customer-visible result: No wording, no new control. When `What's new` was opened again from Updates and a dialog that needs the customer comes up — the Mac App has stopped, usage cannot start, a VibeTV was lost — or setup or a firmware update begins, the notice is taken away and comes back once that is over. Before, it stayed open under or over the other dialog. This is what the notice that opens by itself on Overview already did.
- Scope: when the dialog shows, in `apps/control-center/src/components/control-center-app.tsx`, one test in `control-center-app.whats-new.test.tsx`, and this approval record. Also in this change, from the same review: the approval gate accepts an entry id from one approval entry only, with a new case in its test script and one sentence in `docs/control-center-ui-principles.md`. The line below names the three entries the notice started with: the entry about the notice itself above added them and said none, and they are named here so that no later change can name them as its own. Checked with unit tests only.
- What's new: `provider-shortcut`, `switch-providers-interval`, `usage-display`

## 2026-10-08 — What's new: opened from Updates and interrupted, it stays closed

- User approval: Not separately approved by Paul. Correction from the automated review of head `34c3dc84` on 2026-10-08 to the entry `What's new: opened again from Updates, it steps back for another dialog` above.
- Approved customer-visible result: No wording, no new control. This replaces one sentence of the entry above: a notice that was opened from Updates and is taken away by something else — setup, a firmware update, the stopped Mac App, a lost VibeTV, usage that cannot start — does not come back by itself; the customer opens it again with `What's new` on Updates. Before, it came back as soon as the other thing was over, and after a firmware update that failed it then stood together with the `Update failed` dialog. While one of those things holds, Updates does not show the link `What's new`. The notice that opens by itself on Overview is unchanged: it waits and opens afterwards.
- Scope: when the reopened dialog shows and when Updates offers the link, in `apps/control-center/src/components/control-center-app.tsx`, the test in `control-center-app.whats-new.test.tsx`, and this approval record; checked with unit tests only.
- What's new: none — a correction to the notice itself

## 2026-10-08 — What's new: in a short window the notice opens at its first entry

- User approval: Not separately approved by Paul. Correction from the automated review of head `74dfef14` on 2026-10-08 to the dialog he chose from a drawing.
- Approved customer-visible result: No wording, no new control. In a window too short for all five items the list scrolls. The notice now opens showing its first items, the new themes; before, putting the keyboard focus on `Got it` scrolled the list to its end. The focus is on `Got it` as before, and Enter closes the notice.
- Scope: the focus call in `apps/control-center/src/components/whats-new-dialog.tsx`, one assertion in `control-center-app.whats-new.test.tsx`, and this approval record; checked with unit tests only, not in a real window.
- What's new: none — a correction to the notice itself

## 2026-10-08 — What's new: it waits while a newer app is on offer

- User approval: Not separately approved by Paul. Correction from the automated review of head `768769e0` on 2026-10-08 to the dialog he chose from a drawing.
- Approved customer-visible result: No wording, no new control. While the app knows of a newer app version, the notice does not open by itself on Overview: the app's own update prompt asks first, and the two no longer come up together. After that update the notice opens as before, with whatever the customer has not seen. `What's new` on Updates still opens it at any time.
- Scope: when the dialog opens by itself, in `apps/control-center/src/components/control-center-app.tsx`, one test in `control-center-app.whats-new.test.tsx`, and this approval record; checked with unit tests only.
- What's new: none — a correction to the notice itself

## 2026-10-08 — What's new: in a short window only the list scrolls

- User approval: Not separately approved by Paul. Correction from the automated review of head `fb6b8bbb` on 2026-10-08; it replaces the way the entry `What's new: in a short window the notice opens at its first entry` above did it.
- Approved customer-visible result: No wording, no new control. In a window too short for all items, the title and the bar with `You can read this again under Updates.` and `Got it` stay in place and only the list between them scrolls. The notice opens at its first items, and `Got it`, which has the keyboard focus, is in view. Before, the whole dialog scrolled: either the list jumped to its end, or the focused button was below the visible part. In a window that fits everything nothing changes.
- Scope: the layout classes and the focus call in `apps/control-center/src/components/whats-new-dialog.tsx`, the assertion in `control-center-app.whats-new.test.tsx`, and this approval record; checked with unit tests only. A picture of the dialog in a 960 × 640 window follows from the Windows run.
- What's new: none — a correction to the notice itself

## 2026-10-08 — What's new: Paul approved the wording of the two theme items

- User approval: Paul had the two texts in front of him in chat on 2026-10-08, first in a drawing of the dialog with the theme items on top, then quoted word for word: "New theme: Gauge – A half ring that fills as you use your limit." and "New theme: Token Counter – The tokens of your session as one large number." He answered: "ok".
- Approved customer-visible result: The wording of the two theme items of the dialog `What's new`, as the entry `What's new: new themes always get an entry and stand first` above lists it: `New theme: Gauge` with `A half ring that fills as you use your limit.`, and `New theme: Token Counter` with `The tokens of your session as one large number.`, each with the link `Show me in Themes`. He has seen them drawn and quoted, not in the built dialog.
- Scope: this approval record only; it changes no file of the app. The entry named above keeps its status line as written at the time.
- What's new: none — the two theme entries are named by the entry about the theme rule above

## 2026-10-08 — What's new: the notice opened from Updates stays on Updates

- User approval: Not separately approved by Paul. Correction from the automated review of head `90b6d050` on 2026-10-08 to the dialog he chose from a drawing.
- Approved customer-visible result: No wording, no new control. The notice that was opened with `What's new` on Updates is shown on Updates only. When the app moves the window to another page under it — to Themes, for example, because a theme install was started in another window — the notice is closed and does not come back by itself. Before, it stayed open on that page and could stand together with that page's own dialog, such as the one for a failed install. The notice that opens by itself is shown on Overview only, as before.
- Scope: when the reopened dialog shows, in `apps/control-center/src/components/control-center-app.tsx`, one test in `control-center-app.whats-new.test.tsx`, and this approval record; checked with unit tests only.
- What's new: none — a correction to the notice itself

## 2026-10-08 — What's new: a customer with a new VibeTV is not told what is new, also without a provider step

- User approval: Not separately approved by Paul. Correction from the automated review of head `419c5e1f` on 2026-10-08 to the rule he was told with the dialog: a customer who is setting VibeTV up never gets it.
- Approved customer-visible result: No wording, no new control. A new customer whose AI providers were set up before, so that setup has no provider step, got the notice right after setup. The app now also takes a VibeTV that has no theme yet as a first setup and counts every entry as read. A set-up customer who starts the app after an update still gets the notice, also when their VibeTV is not plugged in at that moment.
- Scope: when the entries count as read during setup, in `apps/control-center/src/components/control-center-app.tsx`, one test in `control-center-app.whats-new.test.tsx`, and this approval record; checked with unit tests only.
- What's new: none — a correction to the notice itself

## 2026-10-09 — Windows: the app installs its own update at launch (#565)

- User approval: Covered by Paul's blanket approval for the night shift of 2026-10-08/09; wording not yet seen by him.
- Approved customer-visible result: Draft, to be confirmed by Paul. The Windows app asks for its own update on every start, before it starts the background service and looks for a VibeTV, as the Mac App does since #561. If a newer version is published, the start screen changes from "Starting the VibeTV Companion…" to "Updating VibeTV Control Center…" with the line "Installing version x.y.z. The app restarts by itself.", the installer runs with its progress window and without a question, and the app reopens. With no newer version, no answer within 5 seconds, a failed download, or a running VibeTV update or theme install, the start goes on as before with no message; in particular no "VibeTV Control Center is up to date." box, which stays the answer to the tray item "Check for Updates…" only. A version is installed at launch once: if the same version is offered again at a later start, the app starts without installing it, and the tray item and the Updates tab can still install it. Not seen on a screen: written without a Windows build, the first build is the CI job of the pull request.
- Scope: `windows/src-tauri/src/main.rs`, `windows/src-tauri/src/launch_update.rs`, `windows/ui/index.html`, `docs/windows-shell.md`, `.github/workflows/ci.yml`, and this approval record. This is a draft for the pull request only, not approval for merge, release, installation, or a device operation.
- What's new: none — the app updates itself at start; there is nothing new for the customer to find or use

## 2026-10-09 — Windows: the app window opens inside the screen, above the taskbar (#548)

- User approval: Covered by Paul's blanket approval for the night shift of 2026-10-08/09; wording not yet seen by him.
- Approved customer-visible result: Draft, to be confirmed by Paul. No wording, no new control. The Windows app window still asks for 1280 × 900, but it is now made no larger than the free area of the main screen (the screen without the taskbar) and opens in the middle of that area. Before, Windows chose the position and the size was not limited, so on a 1080p screen scaled to 125 % or more the lower edge lay behind the taskbar. The smallest size the window can be dragged to stays 960 × 640. The app does not remember a size or position, as before. Not seen on a screen: written without a Windows build.
- Scope: two lines at the creation of the window in `windows/src-tauri/src/main.rs`, `docs/windows-shell.md`, and this approval record. This is a draft for the pull request only, not approval for merge, release, installation, or a device operation.
- What's new: none — a correction to where the window opens

## 2026-10-09 — Theme Studio: Mini theme and an opened file ask before they replace changes

- User approval: Covered by Paul's blanket approval for the night shift of 2026-10-08/09; wording not yet seen by him.
- Approved customer-visible result: In Theme Studio and Screensaver Studio, `Mini theme` and `Import theme JSON` under Advanced › Project, and `JSON` in `Layers & assets` of the narrow window, replace the whole draft, its name and ID included. When the draft has changes that are not saved, they now ask first: a dialog titled `Replace your changes?` with `What you open takes the place of this draft, including its name. Your changes are not saved yet.` and the buttons `Keep editing` and `Replace`. `Keep editing` has the keyboard focus and changes nothing; `Replace` does what the button did before, and Undo still brings the draft back. A draft without changes is replaced at once, as before.
- Scope: the question in `apps/control-center/src/components/theme-studio-screen.tsx`, two tests in `theme-studio-screen.test.tsx`, and this approval record (issue #558); checked with unit tests only, not in the built app.
- What's new: none — a safety question on an existing control

## 2026-10-09 — Theme Studio: the exported file is named after the theme

- User approval: Covered by Paul's blanket approval for the night shift of 2026-10-08/09; wording not yet seen by him.
- Approved customer-visible result: No new screen, dialog, or button. The file `Export ZIP` saves in Theme Studio and Screensaver Studio is named after the theme's name instead of its ID: a theme called `QA3 Night` is saved as `vibetv-theme-qa3-night.zip`; before, it was `vibetv-theme-my-theme-5.zip`. The name is written in small letters, and everything that is not a letter a–z, a digit, `_` or `-` becomes `-`. A name that leaves nothing that way keeps the ID as before. On the Mac the green `Export` notice names the same file (`vibetv-theme-qa3-night.zip exported. Nothing was sent.`); on Windows the notice is unchanged. The ID inside the file is unchanged.
- Scope: the file name in `buildThemePack` in `apps/control-center/src/lib/theme-studio.ts`, one test in `theme-studio.test.ts`, the expected name in two tests of `theme-studio-screen.test.tsx`, and this approval record (issue #558); checked with unit tests only.
- What's new: none — a file name

## 2026-10-09 — Themes: a theme with token numbers says when they are missing

- User approval: Covered by Paul's blanket approval for the night shift of 2026-10-08/09; wording not yet seen by him.
- Approved customer-visible result: One new line, no new control. On Appearance › Themes, the row of a theme that draws token numbers (today `Token Counter` and `Token Fire`, and any theme the customer made with such an element) shows under its name `Shows -- while token history is unavailable. See Usage.` The line stands exactly while Usage shows its notice `Token history is unavailable`, and is gone otherwise; it is decided from the same usage data, and which themes get it is read from the theme's own elements. Before, such a theme showed `--` on VibeTV (`-- SESSION TOKENS`) and Themes gave no reason. A catalog theme gets the line once its preview picture has loaded. Install is not blocked.
- Scope: the line and the prop `tokenHistoryUnavailable` in `apps/control-center/src/components/theme-library-screen.tsx`, `onPack` in `theme-render-preview.tsx`, `themeShowsTokenTotals` in `live-vibetv-preview.tsx`, `usageTokenHistoryUnavailable` in `usage-screen.tsx` (the notice's own condition, moved into a function), one line in `control-center-app.tsx`, tests in `theme-library-screen.custom.test.tsx`, `usage-screen.test.tsx` and `token-counter-theme.test.ts`, and this approval record (issues #548, #551, #558); checked with unit tests only, not on a computer without token history.
- What's new: none — a hint on an existing row

## 2026-10-09 — "Copy provider message" says Copied after the click (#558)

- User approval: Covered by Paul's blanket approval for the night shift of 2026-10-08/09; wording not yet seen by him.
- Approved customer-visible result: Not yet seen by Paul; covered by the blanket approval only. In the dialog of a provider that needs attention (Settings › AI providers and Choose AI providers in setup), the button `Copy provider message for <Provider>` reads `Copied` once the message is on the clipboard, like `Copy` on Support. It reads `Copy provider message for <Provider>` again when the dialog shows another provider or another message; a copy the system refused changes nothing. The copied text, the dialog's sentence, OK and Close are unchanged.
- Scope: `apps/control-center/src/components/setup/setup-providers-screen.tsx` (the provider list shared by setup and Settings), one test in `setup-providers-screen.test.tsx`, and this approval record. Checked with unit tests only; not looked at in the running app and not verified on hardware or on Windows.
- What's new: none — a small confirmation on an existing button

## 2026-10-09 — The browser sign-in dialog has "Copy provider message" again, and still shows our sentence (#551)

- User approval: Covered by Paul's blanket approval for the night shift of 2026-10-08/09; wording not yet seen by him. The entry of 2026-10-08 "A provider that delivers usage opens no browser sign-in message, and that message is in our words again" took the button off this dialog only because the Mac App stopped keeping the usage engine's text; Paul did not ask for the button to go.
- Approved customer-visible result: Not yet seen by Paul; covered by the blanket approval only. No new wording. The dialog of a provider that needs a browser sign-in (Settings › AI providers and Choose AI providers in setup; only the Windows usage engine reports this state today) keeps the sentence approved on 2026-09-17, "Claude usage needs a signed-in claude.ai session in your browser. Sign in to claude.ai in your browser, close the browser, then check again.", and has the button `Copy provider message for <Provider>` again beside OK. The button copies what the usage engine reported, its list of the sources it tried with its bracketed marker and sign-in address, with account names, paths and credentials replaced as for every other provider message. That text is not shown in the dialog or on the row. After the click the button reads `Copied`, as the entry above describes. A row that is "stale" after such a check still shows only "Live usage is unavailable; the last successful reading is still saved." and has no Copy button. Every other provider state is unchanged.
- Scope: `companion/internal/codexbar/providers.go` and `provider_setup.go` (the engine's text is kept for this state again), `companion/internal/companionapi/preferences.go` (the stale row does not take it over), `apps/control-center/src/components/setup/setup-provider-row.tsx` (the dialog's sentence for this state never comes from the engine's text), their tests, and this approval record. Checked with unit tests only; not looked at in the running app and not verified on hardware or on Windows.
- What's new: none — an existing button returns to one dialog

## 2026-10-09 — Settings: the shortcut line says what a press does now (#558)

- User approval: Covered by Paul's blanket approval for the night shift of 2026-10-08/09; wording not yet seen by him. It answers a finding from the third walk-through of the Windows app: with a second provider switched on that had no usage, a press changed nothing and nothing said why, and the line read "This switches to Manual." while Manual was already chosen.
- Approved customer-visible result: Not yet seen by Paul; covered by the blanket approval only. The line under Settings › Display mode that names the keyboard shortcut (entry of 2026-10-08 "Settings names the keyboard shortcut for the next provider") now has three forms; the keys read `Ctrl+Alt+Shift+P` in the Windows App and `⌃⌥⌘P` in the Mac App. With Automatic chosen and at least two providers Manual offers: `Press ⌃⌥⌘P in any app to show the next provider. This switches to Manual.`, as before. With Manual chosen and at least two such providers: `Press ⌃⌥⌘P in any app to show the next provider.` With fewer than two such providers, in either mode, also when further providers are switched on but have no usage: `Press ⌃⌥⌘P in any app to show the next provider. This needs two providers with usage.` The providers counted are the ones listed under `Show this provider`. The sentence about refused keys is unchanged. A press itself behaves as before and still shows no message; no dialog and no notice were added.
- Scope: `apps/control-center/src/components/settings-screen.tsx` (the line), tests in `settings-screen.test.tsx` and `control-center-app.provider-shortcut.test.tsx`, and this approval record. Checked with unit tests only; the shortcut was not pressed in a running app and nothing was verified on hardware or on Windows.
- What's new: none — a correction to a line that is itself new in this update

## 2026-10-09 — Themes: an own theme with a catalog theme's id is kept, also when this app does not know its file

- User approval: Covered by Paul's blanket approval for the night shift of 2026-10-08/09; wording not yet seen by him.
- Approved customer-visible result: No wording, no new control. The theme catalog now names the files of each theme's and screensaver's earlier versions. A file on VibeTV that has the id or the file name start of a catalog theme, but is neither that theme's current file nor one of those earlier ones, is the customer's own: the automatic theme update does not install the catalog theme over it, while VibeTV is awake and during standby, and the catalog row offers `Install` and is not shown as installed. This also holds when the app's data was cleared or the theme was sent from another computer. Every version of a catalog theme or screensaver that was shipped is still updated by itself; a first version in the live slot is now also updated during standby and no longer waits for VibeTV to wake up. With a catalog that does not name earlier files, the app decides as before.
- Scope: the decision in `apps/control-center/src/lib/active-theme-upgrade.ts`, the catalog field in `apps/control-center/src/lib/themes.ts`, the installed check of a row in `apps/control-center/src/components/theme-library-screen.tsx`, their tests, and this approval record; checked with unit tests only, such a pair was not produced on a device (#559).
- What's new: none — nothing the customer has to learn; an own theme simply stays

## 2026-10-09 — A screensaver is called a screensaver in the remaining places

- User approval: Covered by Paul's blanket approval for the night shift of 2026-10-08/09; wording not yet seen by him. It answers the wording point of issue #558 from the third Windows walk-through: what still said "theme" on a screensaver flow, and "Show after 10 minutes" not saying minutes of what.
- Approved customer-visible result: No new screen, dialog, or button. (1) When a screensaver cannot be installed, the dialog and the Setup log name the screensaver: `Screensaver install failed.`, `Screensaver file is invalid.` with `Export the screensaver again, then retry.`, `Screensaver file is too large.`, `VibeTV pairing is required before installing a screensaver.`, and the advice `… then retry screensaver install`. A theme keeps `Theme …`. The technical detail after `Screensaver install failed:` is not reworded. (2) A refusal because something else is running does not guess what it is: `A theme or screensaver is already being installed.` with `Wait for it to finish, then try again.` (before: `Another theme install is already running.`), `A theme or screensaver is still being installed.` (before: `Theme install is still running.`), and after `Mac App is restarting.` and `VibeTV update is still running.` the advice ends with `then try again.` (3) Appearance › Screensavers: the reason a disabled Install button gives when the pointer rests on it names the screensaver, for example `Screensaver is already installed.`, `This screensaver does not support this VibeTV.`, `Screensaver installs are not available right now.`; while another install runs it reads `Another install is already running.` on both lists. The page's own notices do the same: `Screensaver storage needs attention`, `Screensaver action failed`, `Continue your unsaved screensaver`, `Screensaver could not be deleted`, and in the Delete dialog `It does not remove or change the screensaver currently active on VibeTV.` (4) Screensaver Studio › Advanced: `Import screensaver JSON`, the field `Screensaver JSON`, and the notices `Screensaver opened.`, `Screensaver could not be opened.`, `Screensaver file was not opened.` Theme Studio keeps `theme`. The button `Mini theme` is unchanged: it loads the theme Mini Classic. (5) Settings › Screensaver › `Show after`: the choices read `1 minute without AI usage`, `5 minutes without AI usage` … `60 minutes without AI usage`. The label `Show after` and the Recent activity line `The screensaver starts after 5 minutes at 20% brightness.` are unchanged.
- Scope: `companion/internal/companionapi/server.go` with tests in `server_test.go` and `setup_events_test.go`; `wordsForUsage` in `apps/control-center/src/lib/theme-studio.ts`, used in `theme-library-screen.tsx` and `theme-studio-screen.tsx`; the choices in `settings-screen.tsx`; two fallback lines in `control-center-app.tsx`; tests in `theme-library-screen.test.tsx`, `theme-library-screen.custom.test.tsx`, `theme-studio-screen.test.tsx` and `settings-preferences.test.tsx`; and this approval record. Checked with unit tests only; not seen in the built app.
- What's new: none — wording corrections only

## 2026-10-09 — Theme Studio says in plain words that it sends and that VibeTV has the theme

- User approval: Covered by Paul's blanket approval for the night shift of 2026-10-08/09; wording not yet seen by him. It answers a wording point of issues #551 and #558 from the Windows walk-throughs: the two notices sounded like the app talking to itself.
- Approved customer-visible result: No new screen, dialog, or button. In Theme Studio the notice `VibeTV` reads `Sending the theme to VibeTV.` while `Send to VibeTV` runs (before: `Sending theme after your click.`) and `Theme is installed on VibeTV.` when it is done (before: `Theme installed through the Mac App.`, on Windows `… through the app.`). Screensaver Studio reads `Sending the screensaver to VibeTV.` and, as before, `Screensaver is ready on VibeTV.` The sentence does not say that the theme is active, because a VibeTV without a ready AI provider does not draw it yet.
- Scope: two lines in `apps/control-center/src/components/theme-studio-screen.tsx`, one test in `theme-studio-screen.test.tsx`, the sentence the customer flow looks for in `apps/control-center/scripts/test-customer-flows.mjs` (not run here), and this approval record. Checked with unit tests only; not seen in the built app.
- What's new: none — wording corrections only

## 2026-10-09 — Support: the cable, the usage check and the report entry in the customer's words

- User approval: Covered by Paul's blanket approval for the night shift of 2026-10-08/09; wording not yet seen by him. It answers the Support wording points of issues #551 and #558 from the Windows walk-throughs.
- Approved customer-visible result: No new screen, dialog, or button. (1) Support › Connected VibeTV: for a VibeTV on the cable the field reads `Connection` with `USB-C cable` (before: `Address` with `cable://vibetv`). A VibeTV on WiFi keeps `Address` with its address. (2) Support › Diagnostics, row `Display updates`: the healthy answer reads `VibeTV is receiving your usage.` (before: `Display stream is sending usage frames.`). (3) Support › Diagnostics, box `Usage engine`, field `Source`: `Included with the app` (before: `Built into VibeTV`). (4) Support › Recent activity, entry `Support report ready`: `The report has 6 checks.` (before: `6 items ready for support.`). Not changed: the title `Usage engine`, which Marcus set on 2026-09-24 as the neutral name for the usage service; the other answers of the check `Display updates`; and the downloaded support report, which keeps the Mac App's own sentences and the address `cable://vibetv`, except that its copy of Recent activity carries the new entry text.
- Scope: `apps/control-center/src/components/logs-screen.tsx`, `customer-support-text.ts`, `diagnostics-panel.tsx` and one line in `control-center-app.tsx`; tests in `logs-screen.test.tsx` and `diagnostics-panel.test.tsx`; and this approval record. The entry text of (4) has no test of its own. Checked with unit tests only; not seen in the built app.
- What's new: none — wording corrections only

## 2026-10-09 — Recent activity lists an entry that comes back once

- User approval: Covered by Paul's blanket approval for the night shift of 2026-10-08/09; wording not yet seen by him. It answers a point of issues #548 and #558: `Settings loaded` with `Brightness is set to 20%.` still stood several times under Recent activity, each time after another entry.
- Approved customer-visible result: No new wording. Support › Recent activity: an entry with the same title and the same text as an earlier one takes its place: it stands once, at the top, with the time of its latest occurrence. This replaces one sentence of the entry of 2026-10-08 that began this, `The same entry appears again after a different entry.`; before, only an entry directly after itself was left out. An entry with the same title and another text, for example another brightness, is a different entry. The support report and the `Ask AI to fix` prompt carry the same list. The list stays newest first. Not changed: the Setup log above it still runs oldest first and follows its newest line at the bottom with `Jump to latest`; that is how it was approved on 2026-09-24 as a live log, also for the setup Help menu, and both lists running the same way is left for Paul to decide. The Setup log keeps every occurrence, with `N times` for repeats.
- Scope: `recentEventsWith` in `apps/control-center/src/components/control-center-app.tsx`, its tests in `control-center-app.test.ts`, and this approval record. Checked with unit tests only.
- What's new: none — a correction to a list on Support

## 2026-10-09 — The provider message about missing access no longer names macOS

- User approval: Covered by Paul's blanket approval for the night shift of 2026-10-08/09; wording not yet seen by him. It answers a point of issue #548: the sentence was found in the source and could reach a customer on Windows.
- Approved customer-visible result: No new screen, dialog, or button. When an AI provider needs a permission and neither the provider nor the Mac App gives a sentence of its own, the provider message reads `Allow access on this computer` (before: `Allow access in macOS`), on the Mac and on Windows. A sentence the provider gives itself is shown as before.
- Scope: one fallback text in `apps/control-center/src/components/setup/setup-provider-row.tsx`, its case in `setup-provider-row.test.tsx`, and this approval record. Checked with a unit test only; the state was not produced on a computer.
- What's new: none — wording correction only

## 2026-10-09 — Settings says what Default shows, and Usage names the one provider without token history

- User approval: Covered by Paul's blanket approval for the night shift of 2026-10-08/09; wording not yet seen by him. It answers two wording points of issue #558 from the third Windows walk-through.
- Approved customer-visible result: No new control. (1) Settings › Display › `Usage display`: while `Default` is chosen, one line under the row says what it shows at the moment: `Default is the same as Used.` or `Default is the same as Remaining.` With `Used` or `Remaining` chosen there is no line. As before, the row does not name where the default comes from. The row and its three choices are unchanged. (2) Usage, notice `Token history is unavailable`: with exactly one provider shown, the text reads `No token history was found for Codex on this Mac. Your usage limits are shown below.` with that provider's name, and `… on this computer.` on Windows. With two or more providers it reads as before: `Complete local token history is not available for every selected provider. Available usage limits are shown below.` The title and the `Refresh` button are unchanged.
- Scope: `apps/control-center/src/components/settings-screen.tsx` and `usage-screen.tsx`, tests in `settings-preferences.test.tsx` and `usage-screen.test.tsx`, and this approval record. Checked with unit tests only; not seen in the built app.
- What's new: none — an explanation and a wording correction

## 2026-10-09 — Customer flow test follows the export name

- User approval: Covered by Paul's blanket approval for the night shift of 2026-10-08/09; no wording, nothing for him to see.
- Approved customer-visible result: Nothing changes for the customer. The automated customer flow now expects the Theme Studio export under the theme's name (`vibetv-theme-synthwave-customer-copy.zip`), as the entry `Theme Studio: the exported ZIP is named after the theme's name` above describes it; before, it still expected the name built from the id.
- Scope: one expectation in `apps/control-center/scripts/test-customer-flows.mjs` and this approval record.
- What's new: none — a test only

## 2026-10-09 — The macOS installer script tells a Windows user where to get the Windows app (#418)

- User approval: Covered by Paul's blanket approval for the night shift of 2026-10-08/09; wording not yet seen by him.
- Approved customer-visible result: Not yet seen by Paul; covered by the blanket approval only. No Control Center screen changes. The Terminal installer served at `app.vibetv.shop/install-control-center-companion.sh` (the macOS support fallback) stops on any system other than macOS with `This installer is for macOS only. On Windows, open https://app.vibetv.shop and choose Download for Windows.` instead of `this installer currently supports macOS only`. The lines around it ("VIBETV setup needs attention.", the retry hint and the support log path) are unchanged. The developer installer in the repository prints the same as two lines: `error: this installer is for macOS only` and `hint: on Windows, open https://app.vibetv.shop and choose Download for Windows`.
- Scope: `scripts/install-control-center-companion-release.sh` and its identical hosted copy `apps/control-center/public/install-control-center-companion.sh`, `scripts/install-control-center-companion.sh`, a Windows section in `docs/customer-setup.md`, and this approval record. Checked with `bash -n` only; the scripts were not run on Windows or Linux.
- What's new: none — an error message of a support script, not a screen

## 2026-10-09 — Test only: saving a preference leaves Theme Studio's themes alone (#183)

- User approval: Covered by Paul's blanket approval for the night shift of 2026-10-08/09; wording not yet seen by him. This adds no visible result.
- Approved customer-visible result: Unchanged. A new test opens Settings with a saved theme and a theme with unsaved changes in the app's storage, saves the usage display twice, and checks that both are stored exactly as before.
- Scope: `apps/control-center/src/components/control-center-app.display-preferences.test.tsx` and this approval record. No product code, copy, control or state changes.
- What's new: none — a test, nothing a customer sees

## 2026-10-09 — Test only: a provider's row in Settings follows the next read (#368)

- User approval: Covered by Paul's blanket approval for the night shift of 2026-10-08/09; wording not yet seen by him. This adds no visible result.
- Approved customer-visible result: Unchanged. A new test opens Settings with a provider that needs a sign-in, lets the app's regular read of the providers answer "working" and then "checking", and checks that the same row on the screen loses its message button and then shows the spinner, without a retry of the provider.
- Scope: `apps/control-center/src/components/control-center-app.display-preferences.test.tsx` and this approval record. No product code, copy, control or state changes.
- What's new: none — a test, nothing a customer sees

## 2026-10-09 — Windows: the update at launch gives up on a download that stalls or takes longer than 3 minutes (#565)

- User approval: Covered by Paul's blanket approval for the night shift of 2026-10-08/09; wording not yet seen by him.
- Approved customer-visible result: Draft, to be confirmed by Paul. No wording changed. Correction from the review of the #565 entry above: the start waited for the download of a found update without any limit, so a connection that stopped in the middle left the start screen on "Updating VibeTV Control Center…" for good, at every start. The download now ends after 3 minutes in all, or after 20 seconds in which nothing arrives. The app then starts as usual with the version that is installed, with no message, and the tray item "Check for Updates…" works again. The installer is about 14 MB, so 3 minutes are enough from roughly 0.6 Mbit/s. Not seen on a screen: written without a Windows build.
- Scope: `windows/src-tauri/src/main.rs`, `docs/windows-shell.md`, and this approval record. This is a draft for the pull request only, not approval for merge, release, installation, or a device operation.
- What's new: none — a correction to the update at launch

## 2026-10-09 — Windows: "Reload Control Center" during the update at launch only shows the start screen (#565)

- User approval: Covered by Paul's blanket approval for the night shift of 2026-10-08/09; wording not yet seen by him.
- Approved customer-visible result: Draft, to be confirmed by Paul. No wording, no new control. Correction from the review of the #565 entry above: while the update at launch was downloading, the tray item "Reload Control Center" started the app behind the line "Updating VibeTV Control Center…", and the installer then closed the app under the customer. Until the update at launch has ended, "Reload Control Center" now only brings the window with the start screen forward, as "Open VibeTV Control Center" and a second start of the app already did. Not seen on a screen: written without a Windows build.
- Scope: `windows/src-tauri/src/main.rs`, `docs/windows-shell.md`, and this approval record. This is a draft for the pull request only, not approval for merge, release, installation, or a device operation.
- What's new: none — a correction to the update at launch

## 2026-10-09 — Windows: the update at launch tries a version again after 24 hours (#565)

- User approval: Covered by Paul's blanket approval for the night shift of 2026-10-08/09; wording not yet seen by him.
- Approved customer-visible result: Draft, to be confirmed by Paul. No wording changed. Correction from the review of the #565 entry above, which said "A version is installed at launch once": an installer that failed left that version away from the update at launch for good. The rule is now: the update at launch tries a version at most once in 24 hours. The attempt counts from the moment the download starts, so it also covers a download that stalled or took longer than 3 minutes and a VibeTV update or theme install that was running; a customer on a slow line therefore waits on "Updating VibeTV Control Center…" at most once a day, not at every start. A start within those 24 hours goes on with the installed version and no message; the tray item "Check for Updates…" and the Updates tab install the version at any time. A newer version is tried at once.
- Scope: `windows/src-tauri/src/launch_update.rs` with its unit tests, `windows/src-tauri/src/main.rs`, `docs/windows-shell.md`, and this approval record. This is a draft for the pull request only, not approval for merge, release, installation, or a device operation.
- What's new: none — a correction to the update at launch

## 2026-10-09 — A provider's message says how long it has had no usage reading (#368)

- User approval: Covered by Paul's blanket approval for the night shift of 2026-10-08/09; wording not yet seen by him.
- Approved customer-visible result: Not yet seen by Paul; covered by the blanket approval only. The message popup of a provider that is switched on and not working (Settings › AI providers and the setup step "AI providers", opened by the warning icon or by itself as before) gets one more grey line under its text: `No usage reading for 16d 1h.` with the time since the last reading in the form the reset countdowns use (`23m`, `2h 14m`, `16d 1h`), `No usage reading for less than a minute.` below one minute, or `No usage reading yet.` when the provider was never read. For a provider that never delivered, the time counts from its first failed reading, so the sentence stays true. The line is not part of the acknowledged message: an acknowledged popup stays closed while the time moves. A working provider and a switched-off provider show no popup and no such line. No threshold, no new status word, nothing on Usage or Overview.
- Scope: `apps/control-center/src/components/setup/setup-providers-screen.tsx` and its test, the field `noReadingSince` in `control-center-types.ts`, in the Companion's provider preferences and in the support report JSON (`companion/internal/companionapi/preferences.go`, `server.go`), Go tests, and this approval record. Checked with unit tests only; not seen in the built app.
- What's new: none — one added line in an existing message

## 2026-10-09 — A closed provider message offers its copy again

- User approval: Covered by Paul's blanket approval for the night shift of 2026-10-08/09; wording not yet seen by him. It corrects a point an independent review found in the entry on the `Copied` button (#558).
- Approved customer-visible result: No new wording or control. In the AI providers list, the provider message's button reads `Copied` after a click, as approved. Once the message is closed (with `OK`, Escape or a click outside) and opened again from the row's warning icon, the button reads `Copy provider message for OpenAI` again, with the provider's name; before, it still read `Copied` although nothing had been clicked in the reopened message.
- Scope: `apps/control-center/src/components/setup/setup-providers-screen.tsx`, its case in `setup-providers-screen.test.tsx`, and this approval record. Checked with a unit test only; not seen in the built app.
- What's new: none — a correction to the `Copied` confirmation of the provider message

## 2026-10-09 — The Themes hint about token numbers follows the provider on VibeTV

- User approval: Covered by Paul's blanket approval for the night shift of 2026-10-08/09; wording not yet seen by him. It corrects a point an independent review found in the entry `Themes says why a token theme shows --` (#551).
- Approved customer-visible result: No new wording or control. On Appearance › Themes, the line `Shows -- while token history is unavailable. See Usage.` under a theme with token numbers now stands only while the provider that is on VibeTV has no token history; when no provider is on VibeTV, only while none of the shown providers has one. Before, it stood as soon as any shown provider had none: with Codex (with token history, on VibeTV) and Cursor (without), the line said `--` while VibeTV showed Codex's real numbers. This replaces, for this line only, the sentence of the earlier entry that it stands exactly while Usage shows its notice. The notice `Token history is unavailable` on Usage keeps its own condition and text.
- Scope: `usageTokenHistoryUnavailableOnVibeTV` next to `usageTokenHistoryUnavailable` in `apps/control-center/src/components/usage-screen.tsx`, its one use in `control-center-app.tsx`, a case in `usage-screen.test.tsx`, and this approval record. Checked with a unit test only; not seen with two providers on a computer.
- What's new: none — a correction to when the token hint on Themes is shown

## 2026-10-09 — Theme Studio also asks before typed JSON is replaced

- User approval: Covered by Paul's blanket approval for the night shift of 2026-10-08/09; wording not yet seen by him. It corrects a point an independent review found in the entry on the question `Replace your changes?` (#558).
- Approved customer-visible result: No new wording or control. In Theme Studio, text typed into Advanced › JSON that was not applied with `Apply JSON` and differs from the theme as it is now counts as a change for the question `Replace your changes?`: `Mini theme`, `Import theme JSON` and the `JSON` button of the narrow window ask first, with the approved title, text and the buttons `Keep editing` and `Replace`. Before, the typed text was thrown away without a question whenever the theme itself had no changes, and Undo did not bring it back. Typed text that equals the theme's JSON asks nothing. The header keeps saying `Saved` or `Draft` in this state, and leaving Theme Studio asks as before, only for changes to the theme itself.
- Scope: one condition in `replaceDraft` in `apps/control-center/src/components/theme-studio-screen.tsx`, a case in `theme-studio-screen.test.tsx`, and this approval record. Checked with a unit test only; not seen in the built app.
- What's new: none — a correction to the question before a draft is replaced

## 2026-10-09 — The exported theme file spells out umlauts and stays short

- User approval: Covered by Paul's blanket approval for the night shift of 2026-10-08/09; wording not yet seen by him. It corrects two points an independent review found in the entry `Theme Studio: the exported file is named after the theme` (#558).
- Approved customer-visible result: No new screen, dialog, or button. The name of the file `Export ZIP` saves is still built from the theme's name in small letters. (1) `ä`, `ö`, `ü` and `ß` are written `ae`, `oe`, `ue` and `ss`, and other letters with accents lose the accent: `Größe` is saved as `vibetv-theme-groesse.zip` and `Grüße` as `vibetv-theme-gruesse.zip` (before, both were `vibetv-theme-gr-e.zip`), `Café Olé` as `vibetv-theme-cafe-ole.zip`. This replaces, for these letters, the sentence of the earlier entry that everything that is not a letter a–z becomes `-`. (2) At most 80 characters of the name are used, without a `-` at the end; before, a name of 300 characters gave a file name of 317 characters, which a computer can refuse to save. A name without any such letter or digit keeps the ID as before. On the Mac the green `Export` notice names the same file. The ID and the name inside the file are unchanged.
- Scope: `fileSlug` and its one use in `buildThemePack` in `apps/control-center/src/lib/theme-studio.ts`, cases in `theme-studio.test.ts`, and this approval record. The theme ID keeps its own rule. Checked with unit tests only; no file was saved from the built app.
- What's new: none — a correction to the name of the exported file

## 2026-10-09 — The shortcut line claims nothing before usage has been read

- User approval: Covered by Paul's blanket approval for the night shift of 2026-10-08/09; wording not yet seen by him. It corrects a point an independent review found in the entry on the shortcut line under Display mode (#558).
- Approved customer-visible result: No new wording or control. Settings › Display mode, the line about the shortcut: as long as the app has not read usage (right after opening, or when the read failed), it reads only `Press ⌃⌥⌘P in any app to show the next provider.` (`Ctrl+Alt+Shift+P` on Windows), without a second sentence. Before, it added `This needs two providers with usage.` in that state, although a press worked. Once usage has been read, the line is as approved: with fewer than two providers that have usage it adds `This needs two providers with usage.`, with Automatic chosen it adds `This switches to Manual.`, with Manual chosen it adds nothing. The line for a shortcut that is not available is unchanged.
- Scope: one condition in `apps/control-center/src/components/settings-screen.tsx`, a case in `settings-screen.test.tsx`, and this approval record. Checked with a unit test only; not seen in the built app.
- What's new: none — a correction to the shortcut line under Display mode

## 2026-10-09 — The Themes hint about token numbers is never cut off

- User approval: Covered by Paul's blanket approval for the night shift of 2026-10-08/09; wording not yet seen by him. It corrects a layout point an independent review found in the entry `Themes says why a token theme shows --` (#551).
- Approved customer-visible result: No new wording or control. On Appearance › Themes, the line `Shows -- while token history is unavailable. See Usage.` under a theme with token numbers is shown in full on as many lines as it needs. Before, it was limited to two lines, so a narrow window could cut it off with `…` before `See Usage.` In a window where it fits on one or two lines nothing changes.
- Scope: one class on that line in `apps/control-center/src/components/theme-library-screen.tsx`, an assertion in `theme-library-screen.custom.test.tsx`, and this approval record. Checked by the class in a unit test only; the row was not looked at in a narrow window.
- What's new: none — a correction to the layout of the token hint on Themes

## 2026-10-09 — The support report carries a list of state changes (#213)

- User approval: Covered by Paul's blanket approval for the night shift of 2026-10-08/09; wording not yet seen by him.
- Approved customer-visible result: No screen, text, button or layout in the app changes. The file a customer gets from "Download support report" on Support gains one entry, `timeline`: the state changes the app recorded on this computer (background service started or stopped, VibeTV reachable or unreachable, pairing required, stream, provider, theme and firmware in use, usage shown or unavailable, setup steps, firmware and app update phases), each with a number, time, component, state, error code, VibeTV ID and a grouping ID. It holds identifiers, versions and error codes only: no message texts, addresses, WiFi names, account names, tokens or file paths; a value of any other shape is written as `redacted`. At most 400 entries from the last 30 days are kept. A report from an older app, or one written while the app's background service cannot be reached, says `"timeline": { "unavailable": true }` instead.
- Scope: `apps/control-center/src/components/support-report.ts`, `control-center-types.ts`, `support-report.test.ts`, the runtime that records and reports the list (`companion/internal/timeline`, `companionapi`, `daemon`, `cmd/codexbar-display/main.go`), and this approval record. Ported from PR #525; the entry drafted there on 2026-10-06 is replaced by this one. Not verified in an installed app in this batch.
- What's new: none — an entry in the downloaded support file, no screen changes

## 2026-10-09 — A copied provider message hides the account name in every home path and keeps the engine's "OAuth:" label (#551)

- User approval: Covered by Paul's blanket approval for the night shift of 2026-10-08/09; wording not yet seen by him. Correction from an independent review of the entry of 2026-10-09 above, "The browser sign-in dialog has "Copy provider message" again", which made the usage engine's summary copyable for that state.
- Approved customer-visible result: Not yet seen by Paul; covered by the blanket approval only. No new wording, button or dialog. It changes what the usage engine's sentence contains where the app shows it or copies it (the provider dialog, `Copy provider message for <Provider>`), for every provider state. (1) The account's folder is replaced by `~` in every home path: `C:\Users\<name>` on any drive and with either slash, `/home/<name>`, and `/Users/<name>` also when the name has spaces, so `/Users/Paul Anduschus/Library/…` reads `~/Library/…` and no longer `~ Anduschus/Library/…`. Before, only `/Users/<name>` up to the first space was replaced. A home path with nothing after the name may take the words up to the next punctuation mark with it. (2) The Windows engine's list of the sources it tried keeps its label `OAuth:`; the summary of a browser sign-in reads `… OAuth: OAuth error: Claude OAuth usage endpoint is rate limited. …` and no longer `… OAuth: [redacted] error: …`. A value after `OAuth:` that is not a plain word, `OAuth=…`, and every other key are replaced as before.
- Scope: `companion/internal/companionapi/provider_reported.go`, tests in `provider_reported_test.go` and `preferences_test.go`, the sample text of one test in `apps/control-center/src/components/setup/setup-providers-screen.test.tsx`, and this approval record. The same rule also cleans the one log line of a provider check. Checked with unit tests against the sentences in the pinned engines' sources; not looked at in the running app and not verified on hardware or on Windows.
- What's new: none — a correction to text that is copied for support

## 2026-10-09 — Windows: a running VibeTV update does not use up the day's update attempt at launch (#565)

- User approval: Covered by Paul's blanket approval for the night shift of 2026-10-08/09; wording not yet seen by him.
- Approved customer-visible result: Draft, to be confirmed by Paul. No wording changed. Correction from the review of the entry "the update at launch tries a version again after 24 hours" above, which counted a running VibeTV update or theme install as an attempt: nothing was installed in that case, and the version was still kept away from the update at launch for 24 hours. Now that case does not count; the next start of the app tries the version again. A download that stalled or took longer than 3 minutes and an installer that failed still count, so a customer on a slow line waits on "Updating VibeTV Control Center…" at most once a day, as before.
- Scope: `windows/src-tauri/src/launch_update.rs` with one unit test, `windows/src-tauri/src/main.rs`, `docs/windows-shell.md`, and this approval record. This is a draft for the pull request only, not approval for merge, release, installation, or a device operation.
- What's new: none — a correction to the update at launch

## 2026-10-09 — Screensavers: a message that names the customer's screensaver is shown as it is

- User approval: Not separately approved by Paul. Correction from the review of the entry `A screensaver is called a screensaver in the remaining places` above; covered by his blanket approval for the night shift of 2026-10-08/09.
- Approved customer-visible result: No new wording. On Appearance › Screensavers the notices `Screensaver storage needs attention` and `Screensaver action failed` and the Delete dialog's `Screensaver could not be deleted` keep their titles, but the message under them is no longer rewritten: it is shown as storage, the app or the Mac App gave it. Before, every `theme` in that message became `screensaver`, also inside the name the customer gave their screensaver: a screensaver called `Dark Theme` was named `Dark Screensaver` in such a message. The page's own fixed sentences still name the screensaver (`Screensaver could not be opened.`, `Screensaver could not be deleted.`, `Screensaver could not be prepared.`, `Browser storage must be repaired before saving screensavers.`), as do the reasons of a disabled Install button, which carry no name. A message from storage about the shared library reads as on Themes, for example `Saved themes use an invalid format. The original data was left unchanged.`
- Scope: where the word is chosen in `apps/control-center/src/components/theme-library-screen.tsx`, one test in `theme-library-screen.custom.test.tsx` with a screensaver named `Dark Theme`, and this approval record. Checked with unit tests only.
- What's new: none — a correction to wording of this night's batch

## 2026-10-09 — The support report's list of state changes also says what each part is now (#213)

- User approval: Covered by Paul's blanket approval for the night shift of 2026-10-08/09; wording not yet seen by him.
- Approved customer-visible result: No screen, text, button or layout in the app changes. In the file from "Download support report", the entry `timeline` gains `current`: for every part (background service, VibeTV, stream, provider, firmware, usage, each setup step, updates) its latest state and the time it began, also when the list of changes no longer reaches back that far. The list itself keeps at most 100 changes per part within its 400, so a state that changes every few seconds, such as two providers shown in turn, no longer pushes the other parts out. Same contents as before: identifiers, versions and error codes only.
- Scope: `companion/internal/timeline`, `apps/control-center/src/components/control-center-types.ts`, `support-report.test.ts`, and this approval record. Not verified in an installed app in this batch.
- What's new: none — an entry in the downloaded support file, no screen changes

## 2026-10-09 — Themes and Screensavers offer Update while VibeTV holds an earlier version (#209)

- User approval: Covered by Paul's blanket approval for the night shift of 2026-10-08/09; wording not yet seen by him.
- Approved customer-visible result: Not yet seen by Paul; covered by the blanket approval only. One new word on a button, no new dialog. On Appearance › Themes and Appearance › Screensavers, the row of a catalog theme or screensaver reads `Update` instead of `Installed` while VibeTV holds a file the catalog lists as an earlier version of it. The button is open and starts the same install as `Install`, with the same progress and messages under the row; its tooltip reads `Update <name>`. When it is done the row reads `Installed`. The app still updates the theme and the screensaver on its own; the button shows in the cases where it does not: while an app update is waiting, after that update failed once in this run of the app, and for a screensaver while VibeTV is in standby. If VibeTV cannot take an install, the button is closed with the reason it has for `Install` (`Update Needed`, `Turn On First`, `Unavailable`, …), or reads `Update` closed where `Install` would. Before, the row read `Installed` with the button closed and the tooltip `Theme is already installed.`, although VibeTV showed the earlier version. A theme whose current file VibeTV holds reads `Installed` as before; so does a catalog that does not list earlier files.
- Scope: `apps/control-center/src/components/theme-library-screen.tsx`, one new test and one corrected assertion in `theme-library-screen.test.tsx`, and this approval record. Checked with unit tests only; not looked at in the running app and not verified on hardware.
- What's new: none — a button word for a state the app normally resolves on its own

## 2026-10-09 — Windows: the two pages the background service writes itself no longer name the Mac (#548)

- User approval: Covered by Paul's blanket approval for the night shift of 2026-10-08/09; wording not yet seen by him. It answers issue #548 ("no Mac on Windows"): everything else the background service says is reworded by the Windows App where it is shown (entry of 2026-10-08 "The support report from the Windows app does not speak of the Mac" names the rule); these two pages are plain pages outside the app's screens, so nothing reworded them.
- Approved customer-visible result: Not yet seen by Paul; covered by the blanket approval only. No screen of the app changes. (1) The page a browser gets when someone opens the app's local address instead of the app. Mac, unchanged: `VibeTV Control Center moved to the Mac App.` / `Open VibeTV Control Center from Applications.` Windows: `VibeTV Control Center moved to the app.` / `Open VibeTV Control Center from the Start menu.` (2) The page shown when an install has no Control Center files. Mac, unchanged: `VibeTV Control Center is not bundled with this Mac App. Run setup again.` Windows: `VibeTV Control Center is not bundled with this app. Run setup again.` The Windows words are the ones the Windows App's screens already use (`Mac App` → `app`, `from Applications` → `from the Start menu`).
- Scope: `companion/internal/companionapi/server.go` (both pages read the system from the variable the provider permission copy already uses), a comment in `preferences.go`, one test in `server_test.go` that reads both pages for both systems, and this approval record. Checked with unit tests and a Windows cross-build only; neither page was opened on a Windows computer.
- What's new: none — wording correction on two fallback pages outside the app

## 2026-10-09 — Windows: three dialogs showed the background service's sentence with "Mac App" in it (#548)

- User approval: Covered by Paul's blanket approval for the night shift of 2026-10-08/09; wording not yet seen by him. It answers issue #548 ("no Mac on Windows"). The background service keeps one wording, the Mac's, and the Windows App rewords it where it is shown (`Mac App` → `App` at the start of a sentence and `app` inside one, `this Mac` → `this computer`, `from Applications` → `from the Start menu`; entry of 2026-10-08 "The support report from the Windows app does not speak of the Mac"). A walk through every place that shows such a sentence found three that did not apply the rule.
- Approved customer-visible result: Not yet seen by Paul; covered by the blanket approval only. No new wording, dialog or button, and nothing changes in the Mac App. In the Windows App: (1) setup, dialog `WiFi setup failed` (after `Connect to WiFi`, after choosing WiFi, or after a failed scan): the sentence under the title is reworded, for example `App did not answer. Quit VibeTV Control Center, then open it again from the Start menu. If it still does not answer, replace it with the latest app from app.vibetv.shop.` (Mac, unchanged: `Mac App did not answer. Quit VibeTV Control Center, then open it again from Applications. If it still does not answer, replace it with the latest Mac App from app.vibetv.shop.`); a sentence with `this Mac` in it reads `this computer`. (2) setup, dialog `Enter IP address`: the red line under the field after a failed `Connect` is reworded the same way. (3) Settings, the dialog after a refused change of an AI provider or of the display mode: `Provider settings need a newer app.` / `Update the app, then try again.` (Mac, unchanged: `Provider settings need a newer Mac App.` / `Update the Mac App, then try again.`) and `Settings are not available right now.` / `Make sure the app is open, then try again.` (Mac, unchanged: `… Make sure the Mac App is open, then try again.`).
- Scope: `apps/control-center/src/components/setup/setup-wizard.tsx` (two places), `settings-screen.tsx` (one place), tests in `setup-wizard.test.tsx` and `settings-connection.test.tsx`, and in `src/lib/customer-platform.test.ts` a list of the background service's sentences in both forms plus a check that reads every sentence in the background service's source and fails when one would still name the Mac in the Windows App. Checked with unit tests only; not looked at in the running Windows or Mac app.
- What's new: none — wording correction in three error dialogs of the Windows App

## 2026-10-09 — Support: the diagnostics row for a VibeTV on the cable reads Connection / USB-C cable

- User approval: Not separately approved by Paul. Correction from the click-through of the Windows app to the entry `Support: the cable, the usage check and the report entry in the customer's words` above; covered by his blanket approval for the night shift of 2026-10-08/09.
- Approved customer-visible result: No new wording. Support › Diagnostics: for a VibeTV on the cable the row that was titled `VibeTV address` and read `cable://vibetv` is titled `Connection` and reads `USB-C cable`, like the field in the box `Connected VibeTV` above it. For a VibeTV on WiFi the row stays `VibeTV address` with its address. The downloaded support report keeps `cable://vibetv`. Not changed: the setup wizard's line `connecting to cable://vibetv`, which Paul approved in that form on 2026-09-29, and the `Ask AI to fix` prompt, which is text for an AI tool and keeps the raw value.
- Scope: the row in `apps/control-center/src/components/diagnostics-panel.tsx`, one test in `diagnostics-panel.test.tsx`, and this approval record. Checked with unit tests only.
- What's new: none — a correction to wording of this night's batch

## 2026-10-09 — Themes and Screensavers: the labels of a closed Install button are in sentence case

- User approval: Covered by Paul's blanket approval for the night shift of 2026-10-08/09; wording not yet seen by him. From the click-through of the Windows app: `Turn On First` stood in title case on a page whose other buttons are in sentence case.
- Approved customer-visible result: No new control and no new words, only capital letters. On Appearance › Themes and Appearance › Screensavers a closed Install button reads `Turn on first` (before: `Turn On First`), `Update needed` (before: `Update Needed`), `Not supported` (before: `Not Supported`) and `Checkout needed` (before: `Checkout Needed`). `Unavailable`, `Installed`, `Installing`, `Wait`, `Install` and `Update` are unchanged. Not changed: `Create Theme` and `Create Screensaver`, which are in title case as well; they are left for Paul to decide. Also not changed: with `Show screensaver` off, the row of a screensaver that was just installed still reads `Screensaver is ready on VibeTV.`; the notice `Screensaver is turned off` stands above the list at the same time, and no shorter line for that state exists in the app.
- Scope: four labels in `apps/control-center/src/components/theme-library-screen.tsx`, two assertions in `theme-library-screen.test.tsx`, the three button names the customer flow looks for in `apps/control-center/scripts/test-customer-flows.mjs` (not run here), and this approval record. Checked with unit tests only.
- What's new: none — capital letters only
