# Control Center UI Review Checkpoint

This file is the deterministic UI review marker.

The CI gate counts commits since the last commit that changed this file. If customer-facing Control Center UI changed and at least five commits have passed since this marker, CI fails and asks for a UI review.

To reset the gate:

1. Review the UI against [Control Center UI Principles](control-center-ui-principles.md).
2. Delete or simplify unnecessary UI before adding anything new.
3. Update the notes below.
4. Commit this file with the reviewed UI changes or in a dedicated UI review commit.

## Last Review Notes

- Reviewed scope: public theme catalog failure states, install deep-link fallback path, customer-copy guard coverage for App Router files, and customer-copy guard coverage for the theme catalog data source.
- Customer rule: public JSON and any copy that can later be surfaced by the UI must use customer language too; Shopify/API/env/config errors stay internal and collapse to simple theme-unavailable wording.
- Simplifications accepted: no new visible UI, no new buttons, no added explanatory text; theme catalog errors now say only that themes are unavailable or could not load, and the guard scans `src/app` plus `src/lib/themes.ts` so the same internal wording cannot re-enter through a route or catalog helper.
- Verification: `check:customer-ui-copy`, `lint`, `test:customer-flows`, and `git diff --check` passed locally after the guard expansion, catalog-copy cleanup, and `/api/themes` failed-catalog runtime assertion.

- Reviewed scope: Mac App setup status copy, Overview missing-Mac-App setup card, Updates Mac App download row, customer release download states, setup-locked navigation, Theme Library readiness, Support report, recent activity, and mobile overflow coverage.
- Customer rule: one next action when an action is possible; unavailable actions stay hidden or become passive status; setup text should not repeat the button action; no internal bridge/API/release-gate/debug/target/protected/package URL/script-installer explanations in setup, theme, update, support, timeline, or release-check flows.
- Simplifications accepted: `Checking installer`, `Mac installer`, and `Installer is not ready yet.` were replaced with direct Mac App wording; the duplicate Overview sentence under `Install Mac App first` was removed; script-only releases still expose no customer install link; Theme Library and Updates remain locked until setup can actually use them.
- Verification: customer-flow browser tests cover setup locks, desktop header state, Updates action states, Support report exports, recent activity copy, setup-jargon guards, customer-safe release API messages, customer release API download states, hidden duplicate setup explanation, and mobile overflow; `check:customer-ui-copy` blocks internal and indirect installer wording; lint and the deterministic UI review gate run green locally.
