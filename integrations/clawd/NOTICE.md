# VibeTV agent observer

Clawd on Desk: https://github.com/rullerzhou-afk/clawd-on-desk
Pinned revision and archive checksum: `upstream.lock.json`.
Copyright belongs to the Clawd on Desk contributors. License: AGPL-3.0-only;
full upstream license and notices are retained in `upstream/`.

VibeTV additions in `src/` and `test/` are an AGPL-3.0-only Clawd fork overlay.
The small patches in `patches/` add Codex Desktop async-question records to
the existing log monitor. `prepare.py` applies them to the pinned source.
The overlay composes Clawd's existing session runtime, log monitor and hook parser
without Electron, permission decisions, telemetry or quota collection. No
upstream mascot, image or sound assets are loaded. The separate full source
archive retains upstream assets as corresponding source.

Complete corresponding source for each distribution is the exact VibeTV
source revision, this directory and the immutable upstream archive pinned by
`upstream.lock.json`. `prepare.py` verifies both upstream and Node downloads.
Redistributions must provide this source and these build instructions together
with the licenses. Separation into a process is not a license exemption.

Build: Python 3.12+, `python3 integrations/clawd/prepare.py --platform
darwin-arm64 --output /absolute/staging/agent-engine` (also `darwin-x64`,
`darwin-universal`, `win-x64`). Test: `node --test integrations/clawd/test/*.test.cjs`.
Node's bundled license is installed as `NODE-LICENSE`.
