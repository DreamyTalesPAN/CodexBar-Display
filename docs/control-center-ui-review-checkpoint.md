# Control Center UI Review Checkpoint

This file is the deterministic UI review marker.

The CI gate counts commits since the last commit that changed this file. If customer-facing Control Center UI changed and at least five commits have passed since this marker, CI fails and asks for a UI review.

To reset the gate:

1. Review the UI against [Control Center UI Principles](control-center-ui-principles.md).
2. Delete or simplify unnecessary UI before adding anything new.
3. Update the notes below.
4. Commit this file with the reviewed UI changes or in a dedicated UI review commit.

## Last Review Notes

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

- Reviewed scope: hosted Preview local-network access, connected-state navigation locks, Theme Library catalog loading, customer Mac App package theme-install enablement, and Theme Library hero copy after setup is complete.
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
