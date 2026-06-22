# Control Center UI Review Checkpoint

This file is the deterministic UI review marker.

The CI gate counts commits since the last commit that changed this file. If customer-facing Control Center UI changed and at least five commits have passed since this marker, CI fails and asks for a UI review.

To reset the gate:

1. Review the UI against [Control Center UI Principles](control-center-ui-principles.md).
2. Delete or simplify unnecessary UI before adding anything new.
3. Update the notes below.
4. Commit this file with the reviewed UI changes or in a dedicated UI review commit.

## Last Review Notes

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
