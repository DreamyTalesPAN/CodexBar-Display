# Theme SDK (V2 Outlook)

Status:
- Not part of v1 ship scope.
- Kept as a short planning note only.

## v1 Decision (Locked)

v1 ships with built-in themes only:
- `classic`
- `crt`

Explicitly out of v1:
- third-party theme packages
- runtime plugin loading
- `vibeblock theme init/dev/validate/build/flash/test` command family
- compatibility guarantees for external theme APIs

## Why

Shipping rich rendering + media reliably on constrained hardware is already the core risk.
External theme packaging/tooling adds another product surface and support burden.
For v1, stability and clear operational behavior are prioritized over extensibility.

## Candidate v2 Theme SDK Scope

If v1 is stable in production, revisit:
- theme manifest schema (`theme.json`) with explicit target and capability requirements
- stable firmware theme API for external themes
- companion CLI for init/build/flash/test
- CI gates for theme compile/budget/snapshot checks
- sample external theme + docs

## Entry Criteria Before Starting v2 SDK Work

- v1 rich-render acceptance criteria are closed in `TODO.md`.
- field support load is manageable with current observability tooling.
- no open P0/P1 issues related to runtime stability, setup, upgrade, rollback, or recovery.
