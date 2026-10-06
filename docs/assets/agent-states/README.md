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
- Clippy: five original 2x sprite sheets exported from the same Claude Design
  Theme States page on 2026-09-23 live in `clippy/`. Each source frame is 148x148;
  the generator downsamples to a 74x74 device sprite, preserves transparency,
  and writes the authored idle, working, needs-you, done, and error loops at
  3, 7, 8, 7, and 5 fps. No poses or in-between frames are invented.
- Claude Creature: the existing idle and working CBA artwork remains byte-exact
  at 3 and 6 fps in the same 77x77 draw box. Needs-you, done, and error use the
  original animated `sprite_alert.h`, `sprite_happy.h`, and `sprite_dizzy.h`
  RGB565/RLE frames from [clawd-tank](https://github.com/marciogranzotto/clawd-tank)
  commit `a8942d140eeb8bcf549857ad599f7d62fd29eb01`. The exact source
  headers and MIT license are in `claude-creature/clawd-tank/`. Their 40, 20,
  and 32 authored frames run at the upstream 10, 10, and 8 fps. One common crop
  per loop removes only transparent borders across the full animation before
  fitting the complete sequence into 77x77; no effect pixels or motion frames
  are cut. Alert and happy, which play once upstream, loop while their VibeTV
  agent state persists. The older Claude Design SVGs are pose references only.

Run `node scripts/build-agent-state-themes.mjs`, then
`node scripts/build-theme-packs.mjs`. Raster conversion uses one palette per loop,
up to 26 colors, without dithering. Never replace a published ZIP/revision;
bump versions for subsequent releases. Branch builds do not publish the catalog.
