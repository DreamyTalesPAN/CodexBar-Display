# GitHub-hosted VibeTV gates

`CODEX Test VibeTV Merge` is a manually dispatched, owner-restricted PR gate.
It resolves the submitted PR to its immutable head SHA, builds that SHA without
Apple or Sparkle secrets, then checks out the trusted main workflow revision for
archive extraction, signing, notarization, and status publication. The final
commit status is `CODEX VibeTV Merge Gate`.

`CODEX Test VibeTV Release Candidate` is also owner-restricted and builds only
the exact `main` SHA that dispatched it. It creates one signed candidate bundle
named `vibetv-release-candidate` and `candidate-manifest.json`, freezes `baseline-manifest.json` before the
matrix starts, and retains all candidate evidence for seven days. Neither
workflow creates tags, releases, or production endpoints.

`candidate-manifest.json` has schema version `1` and records `repository`,
`sourceSha`, `version`, `candidateRunId`, `createdAt`, plus named artifact
entries (`name`, candidate-relative `path`, SHA-256, and role). Its
`virtualGate` references this Actions run with `result: pending`: the immutable
candidate bundle is produced before the matrix runs, while the final matrix
result remains in the separate result artifact instead of rewriting the tested
candidate.

The matrix uses disposable GitHub-hosted `macos-15` runners for `clean_os`,
`current_public`, and `previous_public`; it never uses Tart, a self-hosted
runner, or physical VibeTV hardware. It verifies signed DMGs/apps and signed
Sparkle metadata, checks the Companion's loopback port `47832`, captures JSON
and a screenshot, and drives health, render, stream, OTA, and duplicate-OTA
no-op behavior through the Core branch's `virtual-vibetv` executable.

The guided physical canary uses the customer device's real update path: an
authenticated OTA update over local WiFi. Customer VibeTV units expose no USB
data or recovery port, so the canary does not pretend to create a USB backup.
Before an OTA write it requires the exact device ID and an explicit
hardware-risk confirmation. If the OTA result is unclear, it stops without a
retry or automatic rollback; the device may require service or replacement.

## Current dependency

The current main branch does not yet contain Issue #177 Core's
`companion/cmd/virtual-vibetv`. Both build jobs fail with that precise message
until the Core is integrated. The candidate app currently has no test-only
Sparkle feed override, so the hosted v1 validates the signed candidate appcast
and public baseline appcast but cannot force a live Sparkle download from a
private Actions artifact. Adding that override belongs with the Core/update
interface; no production feed is changed or invented here.
