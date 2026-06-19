# Control Center UI Review Checkpoint

This file is the deterministic UI review marker.

The CI gate counts commits since the last commit that changed this file. If customer-facing Control Center UI changed and at least five commits have passed since this marker, CI fails and asks for a UI review.

To reset the gate:

1. Review the UI against [Control Center UI Principles](control-center-ui-principles.md).
2. Delete or simplify unnecessary UI before adding anything new.
3. Update the notes below.
4. Commit this file with the reviewed UI changes or in a dedicated UI review commit.

## Last Review Notes

- Reviewed scope: Overview setup flow, Settings simplification, Theme Library unavailable states, missing-installer setup state, Shopify entry copy.
- Customer rule: one next action when an action is possible; no dead setup buttons; no internal bridge/API/release-gate/debug explanations.
- Verification: customer flow tests, lint, UI gate, local mobile browser text and overflow check.
