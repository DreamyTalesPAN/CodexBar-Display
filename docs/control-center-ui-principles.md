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
- **State gating:** the full-screen startup gate owns first-time onboarding and cold-start recovery. After the customer enters Control Center, temporary device or Mac App outages keep the current tab and navigation mounted until setup is explicitly reset.
- **Visual hierarchy discipline:** no button stacks with equal weight. If multiple actions appear, the design is probably exposing implementation detail.
- **Low text density:** short labels and short status rows are preferred. If a paragraph is needed, first try to delete it or convert it into a button label/status value.
- **Approval before visible change:** implementation work never authorizes a visible UI change by itself. Any added, changed, or removed customer-facing copy, control, hierarchy, or state requires explicit user approval recorded in `control-center-customer-ui-approval.md`.
- **One update action:** whenever an app or firmware update is available, the customer action is exactly `Update`. Do not expose DMG handling, Applications-folder replacement, relaunch mechanics, Sparkle, or duplicate-copy prevention in the customer UI.

## Setup Flow Rules

1. The hosted website owns exactly one customer action: download the verified
   Mac App DMG. It never owns VibeTV WiFi, discovery, pairing, or local checks.
2. The installed Mac App never asks the customer to download itself during
   normal onboarding. A fresh setup searches the current WiFi for VibeTVs
   before showing setup instructions.
3. Setup is a full-screen wizard whose step is derived from real state, never
   advanced by a button. Its steps are: a welcome step with no controls that
   shows the background service, the usage read and the VibeTV search as a
   running log; choosing a VibeTV from the ones found on this WiFi, with manual
   IP entry as the quieter alternative; choosing AI providers; choosing the
   display mode; choosing a theme; and the live screen, which hands the app back
   on its own. Firmware is checked and, where needed, installed inside the
   connect step. Every failure is a dialog over the step that caused it, never a
   screen of its own, and every step carries one Help control offering `Ask AI
   to fix` and `Create support report`. The Control Center shell and navigation
   stay hidden for the whole wizard.
   On the provider step, every row keeps its on/off switch whatever the provider
   reports. The health state decides what help the row offers -- sign in, allow
   access in macOS, check again -- never whether the customer may switch the
   provider off. A provider that cannot be switched off is one that cannot be
   kept off the display, and only providers that can actually produce a reading
   reach the display step. This is a deliberate departure from the design's
   "Provider row states" board, decided by the product owner on 2026-08-30.
4. An existing setup opens Overview without setup writes or extra
   confirmation, also on a launch where its connected VibeTV is still coming
   up: a completed setup is remembered by the Mac App, and Overview reports
   what is not ready yet rather than reopening setup. A VibeTV that is
   switched off when the app starts still opens on the device step, where the
   recovery picker and the automatic reconnect live. If VibeTV or the Mac App
   becomes unavailable after Control
   Center was entered, the current tab and navigation remain visible, and
   Overview reports the saved VibeTV as not reachable rather than presenting
   stale readings as current. A background service failure is announced in a
   dialog over the current screen and must not take that screen away. Starting
   over is a deliberate action in Settings or Support, never something the app
   does on its own.
5. Settings, Appearance, and Updates stay locked until setup is complete for
   the first time. A temporary outage in the running app does not lock them
   again or change the active tab.
6. Setup is complete when the background service answers, VibeTV is connected
   and paired with its firmware brought up to date inside the connect step, at
   least one switched-on AI provider has passed its check, a display mode is
   stored wherever the Mac App can store one, a theme is installed, and the
   first display frame carries real usage data. That is decided once: a
   later launch does not wait for the frame again, but Overview renders no
   theme and no usage until a real one arrives.
7. Appearance is additionally locked until theme installs are allowed by the release gate.
8. During setup, help is the Help control on every wizard screen, offering
   `Ask AI to fix` and `Create support report`. Afterwards Support may stay
   available because it only creates support reports and shows recent activity,
   not a setup workflow.
9. A theme install deep link must not bypass setup gating.

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
