# Vibe TV Theme Development Guide

This guide is the baseline for every customer-ready Vibe TV theme. The goal is not to make themes simple. The goal is to make them complex in the right places so the ESP8266 can render them reliably.

## Core Rule

Use the ThemeSpec JSON only for live data and layout control. Put visual detail into streamed assets.

ThemeSpec JSON costs RAM because the firmware parses the whole JSON into an ArduinoJson object tree while rendering. Sprite and GIF files mostly cost flash storage because the firmware streams them from LittleFS row by row or frame by frame.

## Do

- Use `CBI1` static sprites for decorative detail: backgrounds, frames, stars, logos, labels, panels, grids, and pixel art.
- Use `CBA1` animated sprites for character animation and state animation.
- Keep ThemeSpec primitives for dynamic content: usage bars, percentages, reset time, provider label, time, date, and state-dependent asset selection.
- Combine many small decorative rects into one sprite asset.
- Combine static text labels into a sprite when they do not need to change.
- Prefer one detailed streamed sprite over many tiny JSON primitives.
- Keep asset paths short, for example `/themes/u/syn-top.cbi`, because ESP8266 LittleFS paths are short.
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

## Practical Targets

These are not hard limits, but good launch targets for ESP8266 themes:

- ThemeSpec JSON: preferably below 1000 bytes.
- Primitive count: preferably below 16 for static themes, below 20 for animated themes.
- Static visual detail: pushed into `CBI1` sprites.
- Animated characters: pushed into `CBA1` sprites.
- Dynamic primitives: only what must update from usage data.
- Device health after activation: `renderOk: true`; no rising `renderFailures`; heap should not be critically low.

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
