# Vibe TV Theme Development Guide

This guide is the baseline for every customer-ready Vibe TV theme. The goal is not to make themes simple. The goal is to make them complex in the right places so the ESP8266 can render them reliably.

## Core Rule

Use the ThemeSpec JSON only for live data and layout control. Put visual detail into streamed assets.

ThemeSpec JSON costs RAM because the firmware parses the whole JSON into an ArduinoJson object tree while rendering. Sprite and GIF files mostly cost flash storage because the firmware streams them from LittleFS row by row or frame by frame.

The firmware now compiles a stored ThemeSpec into a runtime scene once per active theme. Full render, partial render, and animation ticks should run from that compiled scene instead of repeatedly walking JSON. This is the scalable path for rich themes: every theme gets the same render behavior, and Clippy-style state animation is not a one-off special case.

The compiled scene copies normal strings and `idle`/`coding` `stateAssets` paths into a small fixed pool. That is intentional: predictable memory is better than a theme that works until heap fragmentation changes. Themes that rely on JSON-backed RLE `pixels` can still render, but they keep more JSON memory alive and are not the preferred launch pattern.

## Three Layers of a Theme

Keep these layers separate:

1. `theme-packs/<theme-id>/theme.json` is the stored ThemeSpec. It should contain
   layout, colors, and only the values that change at runtime.
2. `theme-packs/<theme-id>/assets/` contains static or animated visual detail:
   `CBI1` for static sprites, `CBA1` for animated sprites, and GIF only when an
   actual GIF is required.
3. `manifest.json` and `dist/theme-packs/` are packaging outputs. Do not edit
   generated render packs, catalogs, or ZIPs by hand.

The source directory is the authority. The build regenerates the exact revision
render pack used by Theme Studio and the versioned ZIP used by the Mac App and
Companion.

## Do

- Use `CBI1` static sprites for decorative detail: backgrounds, frames, stars, logos, labels, panels, grids, and pixel art.
- Use `CBA1` animated sprites for character animation and state animation.
- Make the main background full-screen at 240x240. If the design uses an inset panel or window, include the surrounding background in the background asset instead of leaving the display uncovered.
- Keep ThemeSpec primitives for dynamic content: usage bars, percentages, reset time, provider identity, time, date, and state-dependent asset selection.
- Never hardcode `VibeTV`, `Codex`, or another provider name into a shipped theme; the same pack must render the active provider correctly. Bind the provider line to `{label}` in a live theme and to `{provider}` in a screensaver.
- Give dynamic provider and usage-window text an explicit width and use `fit: "shrink"` (`ft: "shrink"` in compact specs). Set `fontSize` to the largest size the lane can hold vertically; firmware and previews then choose the largest integer size that also fits the live text horizontally.
- Keep units and suffixes in theme text. When current quota values are unavailable, session/weekly bindings become `??`, reset templates become `Reset unavailable`, and progress bindings keep their last numeric fill (or zero on a cold start).
- Give every live theme exactly one `{label}` / `l` binding for the provider line. It carries the provider display name, and it is the firmware update-notice slot: when an update is available the firmware rotates that text through `Update available` and `Open VibeTV Mac App`, so do not reserve a separate bar for this. A live theme without a label binding instead gets a temporary 24px edge overlay, so keep at least one horizontal edge free of animated GIF/sprite primitives when possible.
- Know the difference between the two bindings before choosing one. On the wire `provider` is the lowercased provider key (`codex`) and `label` is the display name (`Codex`), so `{provider}` on a provider line renders lowercase. Screensavers still use `{provider}`: the update notice must not take over the screensaver.
- Keep all primitives that can change at runtime inside stable bounds. Text without a width is allowed, but the firmware treats it conservatively up to the right display edge for partial render safety.
- Combine many small decorative rects into one sprite asset.
- Combine static text labels into a sprite when they do not need to change.
- Prefer one detailed streamed sprite over many tiny JSON primitives.
- Keep asset paths short, for example `/themes/u/syn-top.cbi`, because ESP8266 LittleFS paths are short.
- Keep each CBI1/CBA1 palette between 1 and 26 colors. For detailed pixel art, use a deliberate, compact palette with nearby shadow and midtone steps instead of maximizing the color count.
- Build pixel art from a softened low-resolution source and upscale with nearest-neighbor blocks. Preserve intentional transitions; do not round every RGB channel to coarse steps.
- Compare the final reference and the Theme Studio render at the same scale. Strong black/bright jumps, repeated horizontal bands, or noisy checkerboard detail usually indicate a bad downscale or quantization step, not a ThemeSpec layout problem.
- Use `stateAssets` for `idle` and `coding`; do not duplicate the whole theme just to change one character sprite.
- Use `providerAssets` / `pa` on sprite primitives when one pack must show different provider logos. Keys must be the lowercase wire `provider` value (`codex`, `claude`, `cursor`), not `{label}` display text.
- Keep state names and paths short. Prefer a small state set (`idle`, `coding`) over many rarely used states.
- Run `node scripts/build-theme-packs.mjs` after every pack change. It validates the source directory and generated ZIP, and regenerates the catalog and exact render pack.
- Test every launch theme on real hardware for at least 10-20 minutes.
- Check `/health` after sending a theme. A customer-ready theme should have `renderOk: true` and stable `renderFailures`.
- Treat low heap as a design bug. A theme that only works once after upload is not launch-ready.

## Don't

- Do not draw decorative stars, borders, grid lines, or pixel art as many individual `rect` primitives.
- Do not use the 4096-byte stored ThemeSpec limit as a design target. That is a hard ceiling, not a safe target.
- Do not put large static scenes into JSON `pixels` unless there is a specific reason. Use a sprite file.
- Do not use animated repaint work for static art.
- Do not add new primitive types when an existing streamed asset can solve the same visual problem.
- Do not hardcode a provider or product name where a provider binding belongs.
- Do not replace a live theme's `{label}` binding with `{provider}`. That silently removes the update-notice slot and renders the lowercased provider id instead of the display name. `node scripts/build-theme-packs.mjs` rejects it.
- Do not quantize a reference by independently snapping every RGB channel to large intervals. That creates posterized shadows, excessive contrast, and visible banding in pixel art.
- Do not judge a palette only from a small browser thumbnail. Inspect the 240x240 render pack and the final-size Theme Studio preview.
- Do not ship a theme only because it looks right in Theme Studio. The hardware result is the source of truth.
- Do not solve runtime stalls with theme-specific firmware branches. If a theme exposes a render problem, fix the global ThemeSpec runtime path or tighten the general theme rules.
- Do not depend on multicolor RLE `pixels` for launch themes unless you have measured the hardware. Use `CBI1`/`CBA1` assets instead so the compiled runtime scene can release JSON memory after activation.

## Practical Targets

These are not hard limits, but good launch targets for ESP8266 themes:

- ThemeSpec JSON: preferably below 1000 bytes.
- Primitive count: preferably below 16 for static themes, below 20 for animated themes.
- Static visual detail: pushed into `CBI1` sprites.
- Animated characters: pushed into `CBA1` sprites.
- CBI1/CBA1 palette: 26 colors maximum; fewer, closely spaced colors are usually better for soft pixel art.
- Large static sprites are allowed only after hardware testing. Treat anything above roughly 10k source pixels, for example `106x105`, as a RAM-risk item; full-width art such as `240x128` must be tested through repeated theme switches.
- GIFs: at most one GIF per ESP8266 theme, max 24 KiB and 80x80 draw box. Use `mini.gif` as the reference size.
- Dynamic primitives: only what must update from usage data.
- Device health after activation: `renderOk: true`; no rising `renderFailures`; heap should not be critically low.
- Normal idle/coding and usage updates should use partial render after the first full render.
- Full render count may increase after activation, reconnect, explicit theme change, clear, or render recovery. It should not climb continuously during steady live data updates.

## Asset Pipeline

For a static pixel-art reference, use this order:

1. Crop and compose the final reference at the display aspect ratio.
2. Reduce it to a small working image with area/box averaging. This preserves
   soft transitions before the image becomes pixel art.
3. Apply a restrained palette. Keep dark background, shadow, midtone, and
   highlight colors close enough that the scene does not become a collection of
   high-contrast blocks. Keep important highlight colors as explicit palette
   anchors.
4. Upscale to the target dimensions with nearest-neighbor sampling. This makes
   intentional pixel blocks without inventing anti-aliased edges.
5. Encode the result as `CBI1` rows. A static sprite starts with `CBI1`, its
   width/height, a palette count from `1` to `26`, the palette colors, and one
   RLE row per image row.

Do not repeatedly resize an already quantized image. Do not apply a second
contrast pass after palette reduction. Both operations amplify the gaps between
palette colors and were the source of the overly contrasty Forest preview.

Split a large composition into a small number of sprites only when it makes the
ThemeSpec layout clearer or keeps each asset reusable. If the sprites are split,
their bounds must cover the intended canvas without gaps or accidental overlap.

## Provider Bindings

Use long bindings in source themes when readability matters:

```json
{
  "t": "tx",
  "x": 112,
  "y": 56,
  "w": 120,
  "v": "{label}",
  "ft": "shrink",
  "al": "center"
}
```

Common live bindings include `{label}`, `{provider}`, `{reset}`, `{usageMode}`,
`{usageSlot1Label}`, `{usageSlot1Reset}`, `{usageSlot1Percent}`, and their
slot-2 equivalents. Compact binding keys are supported for shipped specs, but
the meaning must remain the same; a compact key is not permission to invent a
provider-specific fallback.

Preview data is deliberately neutral example data. A preview proving that the
provider line renders only proves the binding and geometry; it does not prove
that a specific provider is connected or that the hardware can render the pack.
The preview also never rotates the update notice, so it cannot show whether the
notice lands in the theme or in the overlay bar.

## Generate and Validate the Pack

After changing a source theme:

1. Bump `manifest.json` `version`.
2. Bump the ThemeSpec `rev` and change its device path, for example from
   `/themes/s/rcf-3-<hash>.json` to `/themes/s/rcf-4-<hash>.json`.
3. Run:

   ```bash
   node scripts/build-theme-packs.mjs
   ```

4. Validate the source pack directly when needed:

   ```bash
   go run ./cmd/codexbar-display theme-pack validate \
     --pack theme-packs/<theme-id>
   ```

5. Build the local Control Center to include the current catalog, ZIP, and
   exact render pack:

   ```bash
   npm --prefix apps/control-center run build:local
   ```

The build must show the new revision in
`dist/theme-packs/render/<theme-id>/`. A stale render revision or stale ZIP means
Theme Studio and the Mac App can still show the previous asset even when the
source directory is correct.

## WiFi Upload Safety

Theme install over WiFi is a firmware stress path, not just a file copy. The ESP8266 has little RAM, so asset uploads must be slow and boring.

- Keep Companion asset uploads rate-limited. Do not remove the upload throttle to make installs feel faster.
- Do not immediately retry `connection reset by peer`, EOF, or timeout during `/assets`. First check `/health`; if the device rebooted or is unreachable, stop and let it recover.
- Upload assets first, upload the ThemeSpec second, activate last. Do not activate a ThemeSpec while one of its assets may be partial.
- After install, check `/health`: `system.freeHeap`, `display.themeSpec.renderOk`, `display.themeSpec.renderFailures`, and `display.gif.decoderOpen`.
- A healthy non-GIF ThemeSpec should not leave `display.gif.decoderOpen=true`. If it does, the previous GIF renderer was not released and heap will collapse after repeated switches.
- Test repeated switches, not only a single install. Minimum smoke path: `synthwave -> clippy -> synthwave`, with `/health` green after each activation.

## Good Pattern

Use one or two detailed sprite assets plus a small ThemeSpec:

- `sprite`: static background, title, decorative border, labels.
- `progress`: session usage.
- `text`: session percentage.
- `progress`: weekly usage.
- `text`: weekly percentage.
- optional `text`: reset time.
- optional `sprite` with `stateAssets`: idle/coding character.

This can look rich while keeping RAM pressure low.

## Runtime Pattern

A customer-ready theme should follow this render lifecycle:

1. Upload static assets and the stored ThemeSpec.
2. Activate the stored ThemeSpec once.
3. Let the firmware compile that ThemeSpec into its runtime scene.
4. Send live frames with data only: session, weekly, reset, provider, labels, tokens, and activity.
5. Expect partial render for changed primitives and animation ticks for animated assets.

Do not send full ThemeSpec JSON on every live frame. That reintroduces JSON parsing pressure and makes future themes harder to scale.

For state changes, prefer one bounded `sprite` primitive with `stateAssets`. For usage changes, prefer bounded `progress` and `text` primitives. If a dynamic primitive overlaps a background sprite, the partial renderer clips to the dirty region, clears that region with the theme background color, then replays overlapping primitives from the compiled scene.

## Bad Pattern

Avoid this shape:

- 10+ `rect` primitives for stars and borders.
- 5+ static `text` labels that never change.
- repeated JSON-only pixel art.
- static sprites that still trigger animated repaint work.

It may look small in the editor, but the firmware pays for every JSON object during parsing.

## Review Checklist

Before a theme is published:

- ThemeSpec only contains dynamic primitives and coarse layout primitives.
- Decorative detail is bundled into streamed assets.
- Static assets use `CBI1`; animated assets use `CBA1` or GIF only when needed.
- Theme Studio warnings are understood and not ignored.
- Real device `/health` reports `renderOk: true`.
- `renderFailures` does not increase while the theme is running.
- The Mac Companion can keep sending live frames without clearing or destabilizing the theme.
- `/health.display.themeSpec.active` stays `true` after normal live frames that do not contain `themeSpec`.
- `/health.display.themeSpec.compiled` is `true` after the first successful render. Use local ThemeSpec validation and device heap health for deeper capacity checks.
- `/health.render.partialCount` should rise for normal usage/activity updates. `/health.render.fullCount` should stay stable during steady updates unless the theme is explicitly reactivated or recovered.
