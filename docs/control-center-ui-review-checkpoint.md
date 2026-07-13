# Control Center UI Review Checkpoint

This file is the deterministic UI review marker.

The CI gate counts commits since the last commit that changed this file. If customer-facing Control Center UI changed and at least five commits have passed since this marker, CI fails and asks for a UI review.

To reset the gate:

1. Review the UI against [Control Center UI Principles](control-center-ui-principles.md).
2. Delete or simplify unnecessary UI before adding anything new.
3. Update the notes below.
4. Commit this file with the reviewed UI changes or in a dedicated UI review commit.

## Last Review Notes

- Reviewed scope: required ESP8266 firmware recovery before the first DMG
  display frame, setup navigation locks, and the existing Updates screen on
  mobile and desktop.
- Customer rule: unsafe firmware must stop setup before the Mac App sends an
  image. In that exact state, Updates is the one newly available recovery
  destination; Settings, Theme Library, Support, and Overview remain locked.
  The customer sees only the existing Firmware update action, not heap,
  ThemeSpec, transport, manifest, or runtime details.
- Simplifications accepted: no new screen, button, paragraph, or technical
  choice was added. The existing Updates tab and primary `Update now` action
  are reused, and optional firmware availability alone cannot bypass setup
  locks.
- Verification: the firmware recovery state was reviewed against
  `docs/control-center-ui-principles.md` at 405-pixel mobile and 1280-pixel
  desktop viewports. Screenshots are in
  `/tmp/vibetv-firmware-recovery-review/firmware-recovery-mobile.png` and
  `/tmp/vibetv-firmware-recovery-review/firmware-recovery-desktop.png`.
  Navigation stayed uncrowded, the existing primary action remained obvious,
  tap targets measured at least 44 pixels, and no horizontal overflow was
  present. `npm run lint`, `npm run check:customer-ui-copy`, and `npm run
  test:customer-flows` passed locally.

- Reviewed scope: legacy local-Control-Center migration to the DMG, native
  VibeTV WiFi verification, first-frame readiness, stuck-image recovery, the
  connected Overview handoff, and Mac App replacement guidance in Updates.
- Customer rule: the hosted site owns the verified Mac App download; the
  installed Mac App owns WiFi and VibeTV verification. Setup must remain
  visible until a fresh frame is confirmed, while service registration,
  pairing retries, heap limits, and frame transport stay invisible.
- Simplifications accepted: no new customer decision was added by the runtime
  hardening. The initial native state has one primary `VibeTV is on WiFi`
  action and locks unavailable navigation. The manual address and one `Fix
  connection` action appear only after the automatic check cannot finish.
- Verification: the current branch was reviewed in the local browser at the
  native setup start, failed automatic verification fallback, and a 390-pixel
  mobile viewport. Accepted screenshots are in
  `tmp/ui-review-dmg-first-frame/`. The DOM showed semantic headings, one
  enabled primary action, and disabled unavailable navigation; the mobile
  setup content and primary action measured 334 pixels inside the 390-pixel
  viewport. `npm run lint`, `npm run check:customer-ui-copy`, and `npm run
  test:customer-flows` passed locally. The customer-flow suite covers hosted
  download-only behavior, legacy DMG replacement, setup locks, bounded repair,
  first-frame proof, direct Overview handoff, stuck-image recovery, and mobile
  overflow. Keyboard, screen-reader, and measured contrast checks remain
  outside this screenshot review.

- Reviewed scope: hosted Mac App download entry, fresh native WiFi onboarding,
  one-shot VibeTV verification, direct Overview handoff, healthy existing
  installs, setup retry, and failed device discovery.
- Customer rule: `app.vibetv.shop` owns only the verified Mac App download.
  This remains the hosted action on later visits. The installed Mac App never
  asks customers to download itself; it explains how to connect VibeTV to
  WiFi, verifies the connection after the customer's confirmation, and opens
  Overview automatically when the device is usable.
- Simplifications accepted: the shared three-step hosted/native setup was split
  by surface; Agentic and Terminal installer fallbacks were removed from the
  hosted customer path; incomplete devices are no longer repaired or
  force-paired passively before WiFi confirmation; a late healthy status skips
  the repair write; `Run setup again` returns to WiFi setup instead of a Mac App
  download step.
- Verification: the local browser review covered fresh WiFi setup and direct
  Overview handoff using the existing Control Center design system. Accepted
  screenshots are in `tmp/ui-review-native-onboarding/`; the browser DOM also
  confirmed the connected Overview, navigation, versions, and rendered VibeTV
  preview. `npm run lint`, `npm run check:customer-ui-copy`, and `npm run
  test:customer-flows` passed locally. The customer-flow suite covers hosted
  download-only behavior, unavailable DMG handling, no early native writes,
  one verification attempt, direct Overview handoff, existing healthy setup,
  the initial-status race, failed discovery, setup retry, and the 390-pixel
  layout.

- Reviewed scope: verified DMG setup after WiFi, hosted `vibetv://` handoff,
  missing-asset fallback, Mac App update download, replacement guidance, setup
  locks, and the first failed Mac App check.
- Customer rule: the verified DMG is the only primary Mac App action when the
  exact release asset is available. Customers should not see a Mac App failure
  before they have downloaded, opened, and checked the installed app, and an
  update must replace the Applications copy instead of creating a second app.
- Simplifications accepted: Agentic and Terminal setup choices stay hidden when
  the verified DMG is available; the premature top-level Mac App error was
  removed from the download step; the confirmation remains disabled until the
  download starts; Updates uses one DMG download action and short version rows.
- Verification: UI was reviewed against `docs/control-center-ui-principles.md`
  in the local browser at setup start, verified DMG download, and Mac App update
  states. Accepted screenshots are in `tmp/ui-review-dmg-migration/`.
  `npm run lint`, `npm run check:customer-ui-copy`, and `npm run
  test:customer-flows` passed locally; the customer-flow suite covers the
  390-pixel layout without horizontal overflow and the new pre-check error
  regression.

- Reviewed scope: setup recovery when the Mac App has lost the saved VibeTV
  address, automatic repair from an empty device target, and Companion recovery
  from the last display-stream target or saved config backups.
- Customer rule: setup should recover the VibeTV connection automatically in
  the background. Customers should not need to understand IP addresses,
  discovery, pairing, saved targets, display-stream logs, or config backups.
- Simplifications accepted: no new visible Control Center screen, button,
  label, paragraph, tab, or customer choice was added. The existing setup
  repair path now also runs once when no target is saved, while the manual
  address field remains only a fallback for customers who already have the
  VibeTV address.
- Verification: UI was reviewed against `docs/control-center-ui-principles.md`;
  `go test ./internal/companionapi`, `npm run lint`, `npm run
  test:customer-flows`, and `git diff --check` passed locally. Vercel Preview
  for PR #150 loaded without browser errors, and with local-network permission
  handed off to the local Control Center showing VibeTV connected at
  `192.168.178.163`.

- Reviewed scope: local Companion-served setup command generation, hosted
  installer fallback, and migration hardening for the local Control Center
  install path.
- Customer rule: the setup screen must still show one simple Mac App
  install/update command. Customers should not see or need to understand local
  deployment metadata, Preview origins, Companion API routes, or `127.0.0.1`
  setup internals.
- Simplifications accepted: no new visible screen, button, tab, paragraph, or
  customer decision was added. Local Companion origins now reuse the hosted
  `app.vibetv.shop` installer command instead of exposing a broken local
  `--dev-origin`, while real Preview URLs keep the existing Preview command
  behavior.
- Verification: UI was reviewed against `docs/control-center-ui-principles.md`;
  `npm run lint`, `npm run build`, `npm run test:customer-smoke`, and direct
  command assertions passed locally. Production `app.vibetv.shop` was checked
  with local Companion requests intercepted and showed
  `curl -fsSL https://app.vibetv.shop/install-control-center-companion.sh | bash`
  with no local `--dev-origin`.

- Reviewed scope: VibeTV setup captive portal WiFi list rendering, setup
  scan retry fallback, and the Control Center setup/installer changes already
  present on this branch.
- Customer rule: setup must remain one simple WiFi selection and save action;
  customers should not see scan internals, retries, heap limits, firmware
  memory wording, or multiple technical recovery choices.
- Simplifications accepted: the temporary visible refresh action was removed
  again; WiFi rescans happen automatically when the list is empty, and the
  firmware caps the rendered network options so the existing dropdown stays
  reliable on ESP8266 memory.
- Verification: UI was reviewed against `docs/control-center-ui-principles.md`;
  the local hardware setup log after USB debug flash showed
  `wifi_setup_scan networks=15 options=718 option_count=10`, confirming the
  setup dropdown has options again without adding customer-facing decisions.

- Reviewed scope: local Mac App service lifecycle, Display-Worker restart
  behavior, installer service verification, support log paths, and stale
  `coding` activity fallback.
- Customer rule: customers should always be able to open the local Control
  Center while device/display problems are shown as status or retried in the
  background. Installer output stays simple and customer-facing; technical
  daemon/API details stay in support logs.
- Simplifications accepted: no new visible Control Center screens, tabs,
  buttons, or setup decisions were added. The existing Mac App setup path now
  verifies that the local Control Center stays available before opening it,
  while display sending is isolated from the HTTP Control Center.
- Verification: UI was reviewed against `docs/control-center-ui-principles.md`;
  `git diff --check`, targeted Companion Go tests, release-workflow test, daemon
  installer tests, and CI jobs for Companion, Control Center, firmware, theme
  pack, and Theme Studio passed locally or on the PR before this checkpoint
  update; the deterministic UI review gate required this note.

- Reviewed scope: hosted Setup-only entrypoint, local Control Center handoff,
  Mac App setup command, and local exported Control Center routes.
- Customer rule: `app.vibetv.shop`/Vercel Preview remains only the setup
  entrypoint. It must not expose Overview, Usage, Theme Library, Settings,
  Updates, or Support on the hosted origin; after setup it opens the local
  Control Center Overview on this Mac.
- Simplifications accepted: no hosted management UI, tabs, troubleshooting
  sections, or customer decisions were added. The visible hosted flow still has
  one setup path; theme-specific links do not get a special hosted handoff.
- Verification: UI was reviewed against `docs/control-center-ui-principles.md`;
  Vercel Preview root and theme install routes show the setup launcher with no
  old app tabs; `Open local Control Center` navigates to
  `127.0.0.1:47832/control-center`; `lint`, `test:customer-smoke`,
  `test:customer-flows`, `build:local`, `go test ./...`
  in `companion`, `check-theme-pack-dist`, release-workflow test, shell syntax
  checks, and `git diff --check` passed locally before this checkpoint update.

- Reviewed scope: Overview VibeTV device preview source, local Mac App
  `/v1/display-frame/latest`, and active ThemeSpec preview resolution when the
  VibeTV reports a temporary install state.
- Customer rule: the Overview preview must mirror the last screen the local Mac
  App sent to VibeTV. It must not mix live usage data with an older display
  frame, and it must not expose technical frame, log, API, or ThemeSpec wording
  to the customer.
- Simplifications accepted: no new visible UI, buttons, tabs, labels, or
  troubleshooting choices were added; the existing preview now reads the
  last-sent display frame and falls back from temporary device theme names to
  the active ThemeSpec path.
- Verification: UI was reviewed against `docs/control-center-ui-principles.md`;
  `lint`, `check:customer-ui-copy`, `test:customer-flows`, `build:local`,
  `go test ./...` in `companion`, and `git diff --check` passed locally.
  Playwright against `127.0.0.1:47832/control-center` verified that the
  Overview preview rendered `claude-creature` with the same `session`,
  `weekly`, and `usageMode` values returned by local
  `/v1/display-frame/latest`.

- Reviewed scope: hosted Setup-only entrypoint, local Setup CTA hierarchy,
  shared Control Center primary/secondary buttons, Updates primary action, and
  Theme Library rendered theme previews.
- Customer rule: each setup step must expose one obvious next customer action;
  `Open local Control Center`/`Mac App is installed` stays disabled until the
  customer has copied either the Agentic prompt or Terminal command, and primary
  customer actions use the VibeTV neon action style instead of black buttons.
- Simplifications accepted: hosted and local setup continue to share the same
  Setup screen implementation; the separate black Agentic copy CTA was replaced
  with the same secondary copy button pattern as Manual setup; no new tabs,
  setup decisions, or explanatory sections were added; Theme Library previews
  now render the catalog ThemeSpec instead of showing generic placeholders.
- Verification: UI was reviewed against `docs/control-center-ui-principles.md`;
  `check:customer-ui-copy`, `lint`, `test:customer-flows`, `build:local`, and
  `git diff --check` passed locally; Playwright against
  `127.0.0.1:47832/control-center` verified disabled-before-copy setup gating,
  neon full-width setup CTA after copy, rendered Synthwave ThemeSpec preview,
  and neon Updates primary action.

- Reviewed scope: hosted VibeTV setup launcher, local Control Center handoff,
  removal of hosted Overview/Usage/Settings/Theme Library/Updates/Support
  navigation, and the Chrome Local Network Access fallback.
- Customer rule: `app.vibetv.shop` is only the setup entrypoint. It should show
  one guided setup path and then open the local Control Center on this Mac;
  daily Usage, Themes, Settings, Updates, and Support live only in the local
  Control Center.
- Simplifications accepted: hosted setup no longer runs background loopback
  fetches that can trigger Chrome local-network permission failures; the
  customer action after Mac App setup is one direct `Open local Control Center`
  navigation. The hosted browser-access step is hidden because the local app is
  same-origin once opened.
- Verification: UI was reviewed against `docs/control-center-ui-principles.md`;
  desktop/mobile Vercel Preview screenshots show the branded setup launcher with
  no old app tabs; theme install routes stay in hosted setup; a local PR
  Companion on `127.0.0.1:47832` opens `/control-center`; `lint`, `next build`,
  `test:customer-smoke`, `test:customer-flows`, `build:local`, and PR checks
  passed before this checkpoint update except for the deterministic checkpoint
  gate requiring this note.

- Reviewed scope: Mac App release status in Companion `/v1/status`, Overview and Updates Mac App update indicators, the navigation update badge, legacy hosted release fallback, and Vercel Preview monorepo root configuration.
- Customer rule: Mac App update availability can appear as a short `Update` badge, `Update available`, or one primary update action, but the UI must not expose GitHub releases, local API details, daemon wording, package assets, or separate technical check steps.
- Simplifications accepted: no new tab, setup branch, diagnostic panel, or customer troubleshooting choice was added; the Updates primary action now checks Mac App and VibeTV firmware together, while old Mac Apps keep the existing hosted fallback invisibly.
- Verification: UI was reviewed against `docs/control-center-ui-principles.md`; `check:customer-ui-copy`, `vercel build --yes` from the monorepo root with Vercel Root Directory `apps/control-center`, and PR checks for Vercel Preview, Companion, Control Center, firmware, theme pack, and Theme Studio passed before this checkpoint update.

- Reviewed scope: Overview VibeTV device preview data source, local Mac App `display-frame/latest` read path, Preview deployment inputs, and customer-flow browser coverage for the rendered ThemeSpec preview.
- Customer rule: the existing preview should show the same frame customers see on VibeTV without adding setup choices, diagnostics text, or server-side file errors. The browser asks the local Mac App for the last good frame; when that frame is unavailable, the preview still falls back to usage data instead of surfacing internal file-state wording.
- Simplifications accepted: no new visible UI, buttons, tabs, or explanatory text were added; the stale Vercel-side display-frame dependency was removed from the browser flow, and the test mock now follows the same local Mac App contract.
- Verification: UI was reviewed against `docs/control-center-ui-principles.md`; `lint`, `test:customer-flows`, `go test ./internal/companionapi`, `next build`, `git diff --check`, and Vercel Preview browser verification passed locally. Preview `codex-vibetv-control-center-3k1inlsbw-paul-anduschus-projects.vercel.app` rendered Synthwave from `/v1/display-frame/latest` without calling `/api/display-frame/latest`.

- Reviewed scope: hosted Mac App installer script as a public Control Center asset, setup recovery when VibeTV briefly disappears from WiFi, and final background-service target persistence after automatic discovery.
- Customer rule: no new visible Control Center UI, buttons, tabs, or customer decisions were added; setup remains one Mac App install/update action that should recover the VibeTV connection automatically instead of asking customers to understand IP discovery, pairing, LaunchAgents, or local targets.
- Simplifications accepted: the customer-facing app stays unchanged; installer output keeps using Mac App and VibeTV wording while preserving detailed support commands only for diagnostics.
- Verification: UI was reviewed against `docs/control-center-ui-principles.md`; `scripts/test-control-center-companion-legacy-installer.sh`, targeted Companion Go tests, release-workflow tests, customer-ready gate tests, install.sh migration tests, installer sync check, and `git diff --check` passed locally.

- Reviewed scope: setup prompt copy for Mac App install/update, setup step 4 stuck-state fallback, Overview version labels, Mac App release/update request timeout handling, and Theme Library activation retry progress copy.
- Customer rule: setup remains one guided customer action; the prompt may ask the agent to update VibeTV firmware, but the visible UI must still say Mac App, VibeTV, Connect, and Update instead of daemon/API/LaunchAgent/release internals. Version rows must distinguish Mac App from VibeTV firmware so customers do not compare unrelated numbers.
- Simplifications accepted: no new customer setup decision was added; the endless `Connecting VibeTV...` state now falls back to one `Connect VibeTV` action; Theme Library retries are shown as passive progress, not extra troubleshooting buttons.
- Verification: UI was reviewed against `docs/control-center-ui-principles.md`; PR CI passed `check:customer-ui-copy`, `lint`, `test:customer-flows`, theme-pack build, companion tests, and firmware builds before merge. Live VibeTV Synthwave install smoke test passed; only the deterministic checkpoint needed this note.

- Reviewed scope: Updates screen firmware install action, async update progress, retry/report actions, and support-report update status.
- Customer rule: when an update is available, the primary action must install it from Control Center; progress uses plain states (`Checking VibeTV`, `Updating VibeTV`, `Restarting VibeTV`, `Update complete`) and never exposes firmware URLs, hashes, API, daemon, package, or release internals.
- Simplifications accepted: firmware update uses the existing local Mac App update engine; Mac App self-update remains a separate download/install path because macOS installation cannot be treated like a silent device OTA update.
- Verification: pending for this branch update flow; local checks and hardware result are recorded in the task summary.

- Reviewed scope: stale VibeTV image recovery, render-health status in Overview, desktop header status, setup gating while the image is stuck, and the customer `Reload image` action.
- Customer rule: customers should not see render, heap, API, daemon, or firmware-internal wording; when the connection works but the current image is stale, Control Center first tries to reload the image automatically, then exposes one primary `Reload image` action in Overview only.
- Simplifications accepted: no troubleshooting choice was added; Settings, Theme Library, and Updates stay locked while the image is stuck; Support remains available for reports; the visible state uses short customer language (`Image is stuck`, `Reload image`, `Reloading image`) while detailed render errors stay in support diagnostics.
- Verification: UI was reviewed against `docs/control-center-ui-principles.md`; `check:customer-ui-copy`, `lint`, `next build`, and `git diff --check` passed locally.

- Reviewed scope: firmware update failure copy, Mac App release check failure copy, Support diagnostics/log masking, public Shopify theme product install path, Shopify product page readiness guard, and customer-docs guard language.
- Customer rule: until the hosted app path is truly customer-available, Shopify theme product pages show one direct `Copy install command` action instead of sending customers into the unavailable app flow; Control Center UI and support surfaces must keep hiding bridge/API/daemon/target/package details behind Mac App, VibeTV, update, and support language.
- Simplifications accepted: no new Control Center buttons or setup choices were added; firmware errors now say only whether an update is available or the check failed; Support replaces internal diagnostics and URLs with customer-safe terms; unavailable app CTA copy is now blocked on Shopify product page checks.
- Verification: live Synthwave Shopify page shows `Copy install command` and the expected terminal command with no `app.vibetv.shop` link; `scripts/test-control-center-companion-customer-readiness.sh`, the live `--shopify-product-page` readiness check, `scripts/check-control-center-customer-docs.sh`, `scripts/test-control-center-customer-ready-gate.sh`, and `git diff --check` passed locally.

- Reviewed scope: public theme catalog failure states, install deep-link fallback path, customer-copy guard coverage for App Router files, and customer-copy guard coverage for the theme catalog data source.
- Customer rule: public JSON and any copy that can later be surfaced by the UI must use customer language too; Shopify/API/env/config errors stay internal and collapse to simple theme-unavailable wording.
- Simplifications accepted: no new visible UI, no new buttons, no added explanatory text; theme catalog errors now say only that themes are unavailable or could not load, and the guard scans `src/app` plus `src/lib/themes.ts` so the same internal wording cannot re-enter through a route or catalog helper.
- Verification: `check:customer-ui-copy`, `lint`, `test:customer-flows`, and `git diff --check` passed locally after the guard expansion, catalog-copy cleanup, and `/api/themes` failed-catalog runtime assertion.

- Reviewed scope: Mac App setup status copy, Overview missing-Mac-App setup card, Updates Mac App download row, customer release download states, setup-locked navigation, Theme Library readiness, Support report, recent activity, and mobile overflow coverage.
- Customer rule: one next action when an action is possible; unavailable actions stay hidden or become passive status; setup text should not repeat the button action; no internal bridge/API/release-gate/debug/target/protected/package URL/script-installer explanations in setup, theme, update, support, timeline, or release-check flows.
- Simplifications accepted: `Checking installer`, `Mac installer`, and `Installer is not ready yet.` were replaced with direct Mac App wording; the duplicate Overview sentence under `Install Mac App first` was removed; script-only releases still expose no customer install link; Theme Library and Updates remain locked until setup can actually use them.
- Verification: customer-flow browser tests cover setup locks, desktop header state, Updates action states, Support report exports, recent activity copy, setup-jargon guards, customer-safe release API messages, customer release API download states, hidden duplicate setup explanation, and mobile overflow; `check:customer-ui-copy` blocks internal and indirect installer wording; lint and the deterministic UI review gate run green locally.

- Reviewed scope: automatic VibeTV setup recovery when the browser has a stale saved VibeTV address, the Overview primary `Connect VibeTV` action, and the manual VibeTV address form.
- Customer rule: the primary setup button must do the background work without making the customer understand old IP addresses, discovery, pairing, or target selection; a typed address is only a manual fallback, not the default customer path.
- Simplifications accepted: no new visible UI and no new explanatory text; the primary setup action now searches automatically instead of forcing a stale saved address, while the manual address field still works when a customer deliberately submits it.
- Verification: `check:customer-ui-copy`, `lint`, `test:customer-flows`, and `git diff --check` passed locally; the new browser regression test confirms a saved stale address such as `http://192.168.178.163` does not get sent during automatic discovery.

- Reviewed scope: hosted Preview local-network access, connected-state navigation locks, Theme Library catalog loading, customer Mac App theme-install enablement, and Theme Library hero copy after setup is complete.
- Customer rule: once VibeTV is connected, the Theme Library should show only the theme choices and their direct install state; it should not repeat “selected” or “active” status text above the list.
- Simplifications accepted: the Theme Library status subtitle was deleted instead of replaced; Theme Library remains gated until the Mac App, VibeTV connection, pairing, and theme-install flag are ready; Preview uses the same Shopify catalog envs as production.
- Verification: `lint`, `check:customer-ui-copy`, `test:customer-flows`, and `git diff --check` passed locally; Preview browser check confirmed the subtitle is gone and Synthwave, Clippy, and Claude Creature themes still render.

- Reviewed scope: guided setup recovery actions, VibeTV power/WiFi setup copy, phone captive-portal fallback copy, automatic reconnect status, Theme Library install progress, and post-install display refresh behavior.
- Customer rule: setup can expose emergency recovery actions, but the default state should read like normal reconnecting work, not like the customer broke something; theme install should show one install action plus passive progress, and the physical VibeTV should visibly show that a new theme is loading.
- Simplifications accepted: `Fixing` was renamed to `Reconnecting`; `Run setup again` stays secondary in Setup only; the phone step now says `192.168.4.1` is only needed if the browser does not open automatically; Theme Library keeps progress inside the installing theme row instead of adding another global decision.
- Verification: UI copy was reviewed against `docs/control-center-ui-principles.md`; `scripts/check-control-center-ui-review-gate.mjs`, `staticcheck`, `go test ./...`, `check:customer-ui-copy`, `test:customer-flows`, and `git diff --check` passed locally.

- Reviewed scope: old-customer migration setup from an existing VibeTV binding, stale saved device tokens, automatic VibeTV reconnect, confirmed Mac App setup state, and theme install deep links that start from an unpaired VibeTV state.
- Customer rule: customer setup should recover stale local bindings automatically; customers should not need to understand saved IPs, pairing tokens, discovery, or re-pairing. A completed step should always use the completed visual state.
- Simplifications accepted: no new visible setup controls, copy, or customer decisions were added; the existing automatic repair path now re-pairs stale bindings in the background, and the Mac App step uses the same completed checkmark once the flow has advanced.
- Verification: UI was reviewed against `docs/control-center-ui-principles.md`; `go test ./...`, `lint`, `check:customer-ui-copy`, `test:customer-flows`, `next build`, and `git diff --check` passed locally.

- Reviewed scope: Agentic Mac setup prompt, Terminal fallback command, offline Mac App recovery, setup error placement, and the `Fix connection` path when the local Mac setup service is not running.
- Customer rule: `Fix connection` may be visible as the emergency action, but it must first verify the Mac App and guide the customer back to setup instead of firing a VibeTV repair request that cannot work. The default setup path remains Agentic setup; Terminal stays a fallback.
- Simplifications accepted: signed-package language was removed from the installer path; setup keeps two visible recovery actions only, with `Fix connection` primary and `Run setup again` secondary; the Mac App missing state now uses customer language and keeps the customer on the setup step.
- Verification: UI was reviewed against `docs/control-center-ui-principles.md`; `check:customer-ui-copy` and `test:customer-flows` passed locally.

- Reviewed scope: one-process Mac App setup command, Agentic setup prompt wording, hosted installer script copy, and the customer-flow assertion for the manual setup command.
- Customer rule: customers should still see one Mac App install/update command and should not need to understand the internal daemon/API split. Setup copy says the Mac App starts in the background and avoids daemon, API, LaunchAgent, Companion, package, or release internals.
- Simplifications accepted: the `--terminal-session` workaround was removed from the visible command; no new visible setup controls or customer choices were added; installer output uses Mac App/background-service wording while the implementation runs one background process.
- Verification: UI was reviewed against `docs/control-center-ui-principles.md`; `check:customer-ui-copy`, `lint`, `test:customer-flows`, and the customer-ready gate passed except for this deterministic checkpoint before the review note was updated.

- Reviewed scope: old-architecture upgrade error states, local Mac App proxy failure copy, Setup missing-Mac-App notice, Usage unavailable state, Support log masking, and the offline `Fix connection` customer-flow assertion.
- Customer rule: when a customer's VibeTV may still show frames from an old background process, Control Center must not say the Mac App is simply not running. The next step is setup recovery, not explaining daemon/API/process state.
- Simplifications accepted: no new controls, sections, or explanations were added; the wording now uses one recovery action (`Run setup again`) and keeps the same technical error code internally.
- Verification: UI was reviewed against `docs/control-center-ui-principles.md`; `check:customer-ui-copy`, `lint`, `test:customer-flows`, legacy installer migration tests, daemon installer tests, and targeted companion Go tests passed locally.

- Reviewed scope: first-run Mac App setup state, failed `Mac App is installed` check, hidden recovery actions before setup has been attempted, and redundant setup notices.
- Customer rule: a first-time customer should see the install step, not a failure state. `Run setup again` and `Fix connection` stay hidden until the Mac App is reachable or the customer has actually attempted setup; a failed Mac App check explains the immediate next action inside the Mac App step.
- Simplifications accepted: removed the duplicate Mac App setup notice, removed the top-level first-run error, and kept one primary action in the initial Mac App step.
- Verification: UI was reviewed against `docs/control-center-ui-principles.md`; `check:customer-ui-copy`, `lint`, `test:customer-flows`, Go companion tests, install.sh migration test, and daemon installer tests passed locally before this checkpoint update.
