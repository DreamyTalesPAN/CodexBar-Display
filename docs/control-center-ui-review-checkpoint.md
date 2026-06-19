# Control Center UI Review Checkpoint

This file is the deterministic UI review marker.

The CI gate counts commits since the last commit that changed this file. If customer-facing Control Center UI changed and at least five commits have passed since this marker, CI fails and asks for a UI review.

To reset the gate:

1. Review the UI against [Control Center UI Principles](control-center-ui-principles.md).
2. Delete or simplify unnecessary UI before adding anything new.
3. Update the notes below.
4. Commit this file with the reviewed UI changes or in a dedicated UI review commit.

## Last Review Notes

- Reviewed scope: customer release API download states, Mac App installer messages, setup-locked navigation, Theme Library readiness, Updates Mac App actions, Shopify theme install entry copy, Support report, Timeline events, and mobile overflow coverage.
- Customer rule: one next action when an action is possible; unavailable actions stay hidden or become passive status; no internal bridge/API/release-gate/debug/target/protected/package URL/script-installer explanations in setup, theme, update, support, timeline, or release-check flows.
- Simplifications accepted: release API messages now say `Mac App installer is not ready yet.`, `Mac App installer is ready.`, or `Mac App check failed.` instead of exposing Companion/release/package diagnostics; script-only releases still expose no customer install link; Theme Library and Updates remain locked until setup can actually use them.
- Verification: customer-flow browser tests cover setup locks, desktop header state, Updates action states, Support report exports, Timeline copy, setup-jargon guards, customer-safe release API messages, customer release API download states, and mobile overflow; `check:customer-ui-copy` blocks internal customer-facing wording; the deterministic UI review gate is covered by `scripts/test-control-center-ui-review-gate.sh`.
