# README image sources

Updated for issue #431 on 2026-09-08.

## Product renders

Web exports from the existing **VibeTV 21-image set, 2026-09-08**
(`vibetv-complete-set-20260908/final/`). These are Blender + AI product renders,
originally 1448 × 1086 pixels, with illustrative example data. They are not hardware
screenshots. Mini Classic uses the image set's larger usage-label typography.

| Repository file | Original file |
| --- | --- |
| [vibetv-theme-mini.jpg](vibetv-theme-mini.jpg) | `mini-classic__01_neon_lime.png` |
| [vibetv-theme-claude.jpg](vibetv-theme-claude.jpg) | `claude-creature__02_cozy_desk.png` |
| [vibetv-theme-clippy.jpg](vibetv-theme-clippy.jpg) | `clippy__03_amber_studio.png` |
| [vibetv-theme-synthwave.jpg](vibetv-theme-synthwave.jpg) | `synthwave__01_neon_lime.png` |
| [vibetv-screensaver-night-clock.jpg](vibetv-screensaver-night-clock.jpg) | `night-clock__02_cozy_desk.png` |
| [vibetv-screensaver-reset-countdown.jpg](vibetv-screensaver-reset-countdown.jpg) | `reset-countdown__01_neon_lime.png` |
| [vibetv-screensaver-token-fire.jpg](vibetv-screensaver-token-fire.jpg) | `token-fire__03_amber_studio.png` |

JPEG exports use quality 85: Mini Classic is 1120 × 840 for the 560-pixel hero;
the other product renders are 480 × 360 for the 240-pixel gallery cells.
Only size and encoding changed; the full-resolution originals stay in the source
image set outside the repository.

## Current screen previews

Pixel Battery and Tiny Office were captured from the repository's
`ThemeSpecPreview` component at commit `c9192e6`, using unmodified render packs,
`THEME_CATALOG_PREVIEW_FRAME`, and `animate={false}`. The 240 × 240 SVGs were
captured at 3× resolution (720 × 720 PNG). They show static example states.

| Preview | Render pack | ThemeSpec path | Spec hash |
| --- | --- | --- | --- |
| [pixel-battery](vibetv-theme-pixel-battery.png) | [render pack](../../dist/theme-packs/render/pixel-battery.json) | `/themes/u/pba-16-f46829.json` | `6c0dcf25` |
| [tiny-office](vibetv-theme-tiny-office.png) | [render pack](../../dist/theme-packs/render/tiny-office.json) | `/themes/u/to-7-d7799cec.json` | `6b398ec9` |
