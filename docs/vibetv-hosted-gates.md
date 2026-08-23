# GitHub-hosted VibeTV gates

`CODEX Test VibeTV Merge` is a manually dispatched, owner-restricted PR gate.
It resolves the submitted PR to its immutable head SHA, builds that SHA without
Apple or Sparkle secrets, then checks out the trusted main workflow revision for
archive extraction, signing, notarization, and status publication. The final
commit status is `CODEX VibeTV Merge Gate`.

`CODEX Prepare and Release VibeTV` is owner-restricted and builds only the exact
`main` SHA that dispatched it. It freezes the final Mac App and firmware
versions, creates one signed candidate bundle named `vibetv-release-candidate`,
and retains its manifest and evidence for 30 days. After the hosted matrix, the
same workflow waits at the `Production` environment before it can create a tag
or public endpoint. Preparation refuses to build unless `Production` has a
required reviewer, so the YAML cannot silently turn into an automatic release
when repository environment settings drift.

`candidate-manifest.json` has schema version `1` and records `repository`,
`sourceSha`, `version`, `candidateRunId`, `createdAt`, plus named artifact
entries (`name`, candidate-relative `path`, SHA-256, and role). Its
`virtualGate` references this Actions run with `result: pending`: the immutable
candidate bundle is produced before the matrix runs, while the final matrix
result remains in the separate result artifact instead of rewriting the tested
candidate.

The Production-gated job validates the signed DMG, Sparkle signature,
notarization evidence, firmware manifest, successful candidate result, and all
hashes from the same run. It promotes only `publish=true` files, targets the
candidate's recorded source SHA even when `main` later moves, and performs no
rebuild. Its post-publish job compares every public release asset byte-for-byte
with the validated payload before running the release canary.

The matrix uses disposable GitHub-hosted `macos-15` runners for `clean_os`,
`current_public`, and `previous_public`; it never uses Tart, a self-hosted
runner, or physical VibeTV hardware. It verifies signed DMGs/apps and signed
Sparkle metadata, checks the Companion's loopback port `47832`, captures JSON
and a screenshot, and drives health, render, stream, OTA, and duplicate-OTA
no-op behavior through the Core branch's `virtual-vibetv` executable.

An explicitly requested physical rehearsal still uses the device's real update
path: an authenticated OTA update over local WiFi. It is no longer a separate
mandatory publication workflow. Current customer VibeTV units expose no USB
data or recovery port, so they run the rehearsal without a USB backup. Every
hardware write still requires the exact device ID and explicit confirmation;
an unclear OTA result stops without retry or automatic rollback.

## Current dependency

The current main branch contains Issue #177 Core's
`companion/cmd/virtual-vibetv`. The candidate app still has no test-only
Sparkle feed override, so the hosted v1 validates the signed candidate appcast
and public baseline appcast but cannot force a live Sparkle download from a
private Actions artifact. Adding that override belongs with the Core/update
interface; no production feed is changed or invented here.
