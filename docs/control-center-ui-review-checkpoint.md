# Control Center UI Review Checkpoint

This file is the deterministic UI review marker.

The CI gate counts commits since the last commit that changed this file. If customer-facing Control Center UI changed and at least five commits have passed since this marker, CI fails and asks for a UI review.

To reset the gate:

1. Review the UI against [Control Center UI Principles](control-center-ui-principles.md).
2. Delete or simplify unnecessary UI before adding anything new.
3. Update the notes below.
4. Commit this file with the reviewed UI changes or in a dedicated UI review commit.

## Last Review Notes

- Reviewed scope: Overview setup flow, setup-locked navigation, Theme Library install readiness, Updates Companion actions, Support report, Timeline events, and Companion installer download copy.
- Customer rule: one next action when an action is possible; unavailable actions stay hidden or become passive status; no internal bridge/API/release-gate/debug/target/protected/package URL explanations in setup, theme, update, support, or timeline flows.
- Simplifications accepted: setup recovery stays on Overview; Theme Library stays locked until setup is complete; Support report uses `VibeTV address` instead of `Target`; Timeline events use customer language; installer download copy says `downloaded installer` instead of package internals.
- Verification: customer-flow browser tests cover setup locks, desktop header state, Updates action states, Support report exports, Timeline copy, setup-jargon guards, and mobile overflow; lint and customer-ready gate local checks run green.
