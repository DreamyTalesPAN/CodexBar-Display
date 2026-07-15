# VibeTV Themes

Themes decide how live VibeTV data appears on the device. The same provider
usage can look compact, playful, retro, or highly information-dense depending
on the active theme.

<p align="center">
  <img src="assets/vibetv-four-themes.png" alt="VibeTV with four included themes" width="560">
</p>

## Included Themes

| Theme | Preview | Notes |
| --- | --- | --- |
| Mini | <img src="assets/vibetv-theme-mini.png" alt="Mini theme" width="140"> | Compact default theme focused on provider, session, weekly, tokens, and reset time. |
| Claude Creature | <img src="assets/vibetv-theme-claude.png" alt="Claude Creature theme" width="140"> | Character-style usage display for Claude-heavy workflows. |
| Clippy | <img src="assets/vibetv-theme-clippy.png" alt="Clippy theme" width="140"> | Animated assistant-style theme with live usage bindings. |
| Synthwave | <img src="assets/vibetv-theme-synthwave.png" alt="Synthwave theme" width="140"> | High-contrast theme with a more visual display style. |

The repository catalog also contains additional theme-pack work such as Cozy
Meadow. The public Control Center catalog comes from Shopify and maps products
to VibeTV theme-pack IDs.

## Customer Flow

1. Open [Control Center](https://app.vibetv.shop).
2. Complete setup if the Mac App or VibeTV is not connected.
3. Open Theme Library.
4. Choose a theme.
5. Select install.

The Mac App uploads the theme assets to VibeTV over local WiFi and activates the
stored ThemeSpec. After that, the Mac App keeps sending live usage values to the
same active theme.

Theme install and firmware update are separate actions. Installing a theme
should not silently run a firmware update.

## Theme Packs

A theme pack is the installable unit for customer themes. Source files live in:

```text
theme-packs/<theme-id>/
```

Published artifacts live in:

```text
dist/theme-packs/
```

The catalog file is:

```text
dist/theme-packs/vibetv-theme-packs.json
```

See [theme-packs.md](theme-packs.md) for the pack format and CLI commands.

## Building Themes

Use Theme Studio for visual editing:

```bash
./scripts/theme-studio.sh
```

Theme Studio can:

- edit 240x240 layouts
- import sprites and GIFs
- preview live usage bindings
- send themes to VibeTV during an approved hardware test
- publish/update theme-pack source files

For reliable hardware themes, keep static visual detail in streamed assets and
keep ThemeSpec JSON focused on live fields. Start with
[theme-dev-guide.md](theme-dev-guide.md) before publishing a customer theme.

## Hardware Safety

Theme install writes to the device. During development, use local validation and
read-only checks before installing themes on real hardware.

Allowed read-only checks:

```bash
curl http://<device-ip>/hello
curl http://<device-ip>/health
curl http://<device-ip>/assets
```

Do not upload assets, activate themes, reset WiFi, or run firmware updates on a
live VibeTV unless that exact hardware test was explicitly approved.
