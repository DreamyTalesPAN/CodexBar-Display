# Control Center UI Principles

This is the customer-facing design standard for VibeTV Control Center. The target user has no technical context. They should not need to understand agents, AI, firmware internals, local APIs, release assets, bridge services, transport layers, or GitHub releases.

## Design Language

- **Progressive disclosure:** show only the next useful step. Hide every action that cannot work yet.
- **One primary action per state:** each screen state should have one obvious next action. Secondary actions must be rare and visually quieter.
- **Task-first information architecture:** navigation follows the customer setup journey, not the internal system architecture.
- **Cognitive load reduction:** remove explanatory paragraphs, duplicate status text, and implementation details unless they directly unblock the next action.
- **Error prevention over error explanation:** disable or hide actions that would fail instead of explaining why they failed after the click.
- **Plain-language labels:** use customer words: Mac App, VibeTV, Install, Connect, Update. Avoid internal words such as bridge, asset, package signing, protocol, transport, daemon, write gate, API, Companion, or agent.
- **Automation-first workflows:** buttons should do the background work in sequence. Customers should not choose between technical substeps such as discover, pair, check bridge, check installer, or find device.
- **State gating:** tabs and controls that are not usable in the current setup state stay locked. Overview owns setup recovery.
- **Visual hierarchy discipline:** no button stacks with equal weight. If multiple actions appear, the design is probably exposing implementation detail.
- **Low text density:** short labels and short status rows are preferred. If a paragraph is needed, first try to delete it or convert it into a button label/status value.
- **Approval before visible change:** implementation work never authorizes a visible UI change by itself. Any added, changed, or removed customer-facing copy, control, hierarchy, or state requires explicit user approval recorded in `control-center-customer-ui-approval.md`.
- **One update action:** whenever an app or firmware update is available, the customer action is exactly `Update`. Do not expose DMG handling, Applications-folder replacement, relaunch mechanics, Sparkle, or duplicate-copy prevention in the customer UI.

## Setup Flow Rules

1. The hosted website owns exactly one customer action: download the verified
   Mac App DMG. It never owns VibeTV WiFi, discovery, pairing, or local checks.
2. The installed Mac App never asks the customer to download itself during
   normal onboarding. A fresh setup begins with VibeTV WiFi instructions.
3. Device discovery and verification start only after the customer confirms
   that VibeTV joined WiFi. Saved but incomplete devices are not repaired
   passively. A successful check opens Overview automatically.
4. An existing healthy setup opens Overview without setup writes or extra
   confirmation.
5. Settings, Theme Library, and Updates stay locked until setup is complete.
6. Setup is complete when the Mac App is running and VibeTV is connected and paired.
7. Theme Library is additionally locked until theme installs are allowed by the release gate.
8. Support may stay available because it only creates support reports and shows recent activity, not a setup workflow.
9. A Shopify theme install deep link must not bypass setup gating.

## Review Checklist

Before shipping customer-facing UI changes, answer these in order:

1. Is the exact visible result explicitly approved in `control-center-customer-ui-approval.md`?
2. Can a non-technical customer identify the next step in under 5 seconds?
3. Is there exactly one primary action for the current state?
4. Can any visible button fail because another visible setup step should have happened first?
5. Are there internal implementation words visible to the customer?
6. Are tabs or controls visible when they cannot be used?
7. Is any paragraph explaining something that could be solved by hiding, disabling, merging, or automating an action?
8. Did the change add a new customer decision that the software could make automatically?
9. Does mobile have the same decision order and no wrapped or crowded action rows?

## Automated Copy Guard

Run `npm run check:customer-ui-copy` in `apps/control-center` before shipping customer-facing UI changes. It parses customer-facing TSX copy and blocks internal wording such as `Companion`, `Bridge`, local API terms, release/package diagnostics, and technical setup substeps.

The repository gate also blocks every customer-facing UI diff until the same change includes a new approval entry with both `User approval:` and `Approved customer-visible result:`. A general implementation or release approval is not enough; the visible result must be named.

## Verification Budget

- Copy-only deletion or wording changes: run `npm run check:customer-ui-copy` and `git diff --check`. Do not run the full customer-flow browser suite unless the text change also changes state, navigation, actions, or layout risk.
- Small UI state changes: run `npm run test:customer-smoke` in `apps/control-center`.
- Flow, API, setup gating, install, update, or release changes: run `npm run test:customer-flows`.
- Merge-readiness claims: run the repository customer-ready gate.

## Delete First

When the UI feels confusing, simplify in this order:

1. Delete internal explanation.
2. Hide unavailable actions.
3. Merge technical substeps into one customer action.
4. Rename labels into customer language.
5. Only then add new UI.
