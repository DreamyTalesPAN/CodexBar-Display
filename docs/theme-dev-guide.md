# Vibe TV Theme Development Guide

This guide is the baseline for every customer-ready Vibe TV theme. The goal is not to make themes simple. The goal is to make them complex in the right places so the ESP8266 can render them reliably.

## Core Rule

Use the ThemeSpec JSON only for live data and layout control. Put visual detail into streamed assets.

ThemeSpec JSON costs RAM because the firmware parses the whole JSON into an ArduinoJson object tree while rendering. Sprite and GIF files mostly cost flash storage because the firmware streams them from LittleFS row by row or frame by frame.

The firmware now compiles a stored ThemeSpec into a runtime scene once per active theme. Full render, partial render, and animation ticks should run from that compiled scene instead of repeatedly walking JSON. This is the scalable path for rich themes: every theme gets the same render behavior, and Clippy-style state animation is not a one-off special case.

The compiled scene copies normal strings and `idle`/`coding` `stateAssets` paths into a small fixed pool. That is intentional: predictable memory is better than a theme that works until heap fragmentation changes. Themes that rely on JSON-backed RLE `pixels` can still render, but they keep more JSON memory alive and are not the preferred launch pattern.

## Do

- Use `CBI1` static sprites for decorative detail: backgrounds, frames, stars, logos, labels, panels, grids, and pixel art.
- Use `CBA1` animated sprites for character animation and state animation.
- Make the main background full-screen at 240x240. If the design uses an inset panel or window, include the surrounding background in the background asset instead of leaving the display uncovered.
- Keep ThemeSpec primitives for dynamic content: usage bars, percentages, reset time, provider label, time, date, and state-dependent asset selection.
- Keep all primitives that can change at runtime inside stable bounds. Text without a width is allowed, but the firmware treats it conservatively up to the right display edge for partial render safety.
- Combine many small decorative rects into one sprite asset.
- Combine static text labels into a sprite when they do not need to change.
- Prefer one detailed streamed sprite over many tiny JSON primitives.
- Keep asset paths short, for example `/themes/u/syn-top.cbi`, because ESP8266 LittleFS paths are short.
- Use `stateAssets` for `idle` and `coding`; do not duplicate the whole theme just to change one character sprite.
- Keep state names and paths short. Prefer a small state set (`idle`, `coding`) over many rarely used states.
- Test every launch theme on real hardware for at least 10-20 minutes.
- Check `/health` after sending a theme. A customer-ready theme should have `renderOk: true` and stable `renderFailures`.
- Treat low heap as a design bug. A theme that only works once after upload is not launch-ready.

## Don't

- Do not draw decorative stars, borders, grid lines, or pixel art as many individual `rect` primitives.
- Do not use the 4096-byte stored ThemeSpec limit as a design target. That is a hard ceiling, not a safe target.
- Do not put large static scenes into JSON `pixels` unless there is a specific reason. Use a sprite file.
- Do not use animated repaint work for static art.
- Do not add new primitive types when an existing streamed asset can solve the same visual problem.
- Do not ship a theme only because it looks right in Theme Studio. The hardware result is the source of truth.
- Do not solve runtime stalls with theme-specific firmware branches. If a theme exposes a render problem, fix the global ThemeSpec runtime path or tighten the general theme rules.
- Do not depend on multicolor RLE `pixels` for launch themes unless you have measured the hardware. Use `CBI1`/`CBA1` assets instead so the compiled runtime scene can release JSON memory after activation.

## Practical Targets

These are not hard limits, but good launch targets for ESP8266 themes:

- ThemeSpec JSON: preferably below 1000 bytes.
- Primitive count: preferably below 16 for static themes, below 20 for animated themes.
- Static visual detail: pushed into `CBI1` sprites.
- Animated characters: pushed into `CBA1` sprites.
- GIFs: at most one GIF per ESP8266 theme, max 24 KiB and 80x80 draw box. Use `mini.gif` as the reference size.
- Dynamic primitives: only what must update from usage data.
- Device health after activation: `renderOk: true`; no rising `renderFailures`; heap should not be critically low.
- Normal idle/coding and usage updates should use partial render after the first full render.
- Full render count may increase after activation, reconnect, explicit theme change, clear, or render recovery. It should not climb continuously during steady live data updates.

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
- `/health.display.themeSpec.compiled` is `true` after the first successful render. `stringBytes` should be comfortably below `stringCapacity`, and `keepsJsonDocument` should usually be `false` for launch themes.
- `/health.render.partialCount` should rise for normal usage/activity updates. `/health.render.fullCount` should stay stable during steady updates unless the theme is explicitly reactivated or recovered.
