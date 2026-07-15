# Control Center Customer UI Approvals

This append-only log is the machine-checked approval marker for customer-facing
Control Center changes. Every visible UI change needs a new entry that records
the user's explicit approval and the exact visible result. Technical work,
issue scope, or release permission never implies UI permission.

## 2026-07-15 — One update action

- User approval: Explicitly approved by the user in the Codex task on 2026-07-15.
- Approved customer-visible result: App, migration, and firmware update states show one action named `Update`; manual DMG, Applications-folder, replacement, relaunch, and duplicate-copy instructions do not appear in update UI.
- Approved files: `updates-screen.tsx`, `overview-screen.tsx`, `setup-screen.tsx`, and their customer-flow assertions.
