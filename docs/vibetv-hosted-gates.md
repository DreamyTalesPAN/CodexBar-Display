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

`CODEX Record VibeTV Hardware Canary` stores a successful physical-canary
record only after it matches the candidate manifest and complete artifact-hash
map. `CODEX Publish VibeTV Release` then requires the exact candidate and
hardware run IDs, validates the signed DMG, Sparkle signature, notarization
evidence, firmware manifest, and all hashes, and promotes only the candidate's
`publish=true` files. Its post-publish job compares every public release asset
byte-for-byte with the validated payload before running the release canary.

The matrix uses disposable GitHub-hosted `macos-15` runners for `clean_os`,
`current_public`, and `previous_public`; it never uses Tart, a self-hosted
runner, or physical VibeTV hardware. It verifies signed DMGs/apps and signed
Sparkle metadata, checks the Companion's loopback port `47832`, captures JSON
and a screenshot, and drives health, render, stream, OTA, and duplicate-OTA
no-op behavior through the Core branch's `virtual-vibetv` executable.

The guided physical canary always uses the device's real update path: an
authenticated OTA update over local WiFi. Current customer VibeTV units expose
no USB data or recovery port, so they run the canary without a USB backup.
Future lab hardware can supply an optional recovery port; the canary then
creates a full backup before the WiFi OTA. Both paths require the exact device
ID and an explicit hardware-risk confirmation. If the OTA result is unclear,
the canary stops without a retry or automatic rollback.

## Current dependency

The current main branch contains Issue #177 Core's
`companion/cmd/virtual-vibetv`. The candidate app still has no test-only
Sparkle feed override, so the hosted v1 validates the signed candidate appcast
and public baseline appcast but cannot force a live Sparkle download from a
private Actions artifact. Adding that override belongs with the Core/update
interface; no production feed is changed or invented here.
