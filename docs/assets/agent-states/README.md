# Approved agent-state source assets

These inputs belong to the approved Theme States design at
https://claude.ai/design/p/36eb7a1c-bd59-42f0-b120-3f1eb3905e4b?file=Theme+States.dc.html
(retrieved 2026-09-20).

- Tiny Office: approved native 120x54 frames from the local Cozy/Office design
  handoff. Needs you: two frames, large monitor question mark; Finished: three
  frames; Error: three frames, floor cat removed. Existing working/idle source
  art and their 4 fps cadence are reconstructed losslessly from the original
  CBI/CBA files. Six 80x54 draw tiles keep the shared animation buffer bounded.
- Mini: approved native 32x32 two-frame props, displayed at 64x64 beside the
  original eyes GIF. Loops: working 1100 ms, needs you 900 ms, done 1300 ms,
  error 1200 ms. The GIF bytes are unchanged.
- Battery/Synthwave: unchanged art, shared renderer announcement; only the
  existing heading fit is adjusted for status strings.
- Claude Creature: five original SVGs from Claude Design, including their
  provenance metadata. The downloaded SVGs contain static poses, not animation
  styles or keyframes. The build rasterizes their 62x66 design into the existing
  77x77 slot without inventing motion. This explicit redesign replaces the
  previous Creature poses. No additional footer replaces reset information.

Run `node scripts/build-agent-state-themes.mjs`, then
`node scripts/build-theme-packs.mjs`. Raster conversion uses one palette per loop,
up to 26 colors, without dithering. Never replace a published ZIP/revision;
bump versions for subsequent releases. Branch builds do not publish the catalog.
