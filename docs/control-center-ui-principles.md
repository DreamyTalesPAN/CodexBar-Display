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

## Setup Flow Rules

1. Overview is the only place for incomplete setup recovery.
2. Settings, Theme Library, and Updates stay locked until setup is complete.
3. Setup is complete when the Mac App is running and VibeTV is connected and paired.
4. Theme Library is additionally locked until theme installs are allowed by the release gate.
5. Logs may stay available because they are support/diagnostics, not a customer workflow.
6. A Shopify theme install deep link must not bypass setup gating.

## Review Checklist

Before shipping customer-facing UI changes, answer these in order:

1. Can a non-technical customer identify the next step in under 5 seconds?
2. Is there exactly one primary action for the current state?
3. Can any visible button fail because another visible setup step should have happened first?
4. Are there internal implementation words visible to the customer?
5. Are tabs or controls visible when they cannot be used?
6. Is any paragraph explaining something that could be solved by hiding, disabling, merging, or automating an action?
7. Did the change add a new customer decision that the software could make automatically?
8. Does mobile have the same decision order and no wrapped or crowded action rows?

## Automated Copy Guard

Run `npm run check:customer-ui-copy` in `apps/control-center` before shipping customer-facing UI changes. It parses customer-facing TSX copy and blocks internal wording such as `Companion`, `Bridge`, local API terms, release/package diagnostics, and technical setup substeps.

## Delete First

When the UI feels confusing, simplify in this order:

1. Delete internal explanation.
2. Hide unavailable actions.
3. Merge technical substeps into one customer action.
4. Rename labels into customer language.
5. Only then add new UI.
