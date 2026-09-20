# VibeTV Theme Development Guide

This guide covers visual design, asset preparation, packaging, and validation for
customer-ready VibeTV themes. Keep the design expressive and the implementation
small: use the shared renderer, existing bindings, and a few well-designed assets.

## Current Runtime and Approved Design Direction

Implemented on the agent lifecycle feature branch; this is not yet a production
release. Packs and runtime ship together after the release gates pass.

| Area | Runtime contract |
| --- | --- |
| Character activity | `stateAssets` / `sa`: `idle`, `coding`, `needs_you`, `done`, `error`. New keys require `agent-theme-states-v1`. |
| Live heading | `label` / `l` shows the observed agent status when `agentName` is supplied; existing firmware-update notices keep priority. |
| Missing state asset | One central, two-pulse full-display inversion on a grouped state transition; persistent status text. No per-theme flash settings. |

Wire phases stay precise: working/thinking/tool_use/compacting use `coding`;
waiting_for_permission/waiting_for_answer/waiting_for_review use `needs_you`.
`done`, `error`, and `idle` map directly. Unknown/stale observations show
“Agent status unavailable” and do not announce. The quota provider never supplies
the agent name. Older firmware receives its existing coding/idle contract and
cannot install packs declaring the new capability.

Do not invent state keys such as `working` or `finished`. CodexBar continues to
own provider usage/authentication; Clawd owns observed lifecycle facts. Themes
consume those facts and must never infer activity from usage changes.

## Visual and Interaction Guidelines

### Preserve the Theme's Identity

Extend the established layout, typography, palette, and animation language.
Approved Working and Idle animations are the baseline; preserve them when adding
other states. Keep unrelated scenery, usage values, and UI geometry stable
between animation frames.

Review at **240 × 240 pixels**, including the final character or prop size inside
that canvas. A large reference sheet is not evidence that an icon reads well on
the display. Use crisp pixel edges, consistent scale, and aligned sprite frames.

### Use the Existing Label Line

Use the dynamic provider/label area for agent status. In Battery and Synthwave,
this is the upper heading that says “VibeTV” in the neutral preview—not Battery's
reset row or Synthwave's “USAGE” label. Other themes may position the same binding
differently; use the binding, not a hard-coded screen coordinate.

Keep exactly one live `label` binding. Do not add a second status bar, move usage
data, or replace reset information to make room for agent status. Preserve
existing update and system-message priority. Test long status messages as well
as provider names in the same bounded text slot.

Use consistent wording. “Codex” below is an example; insert the actual agent's
display name at runtime, never a name painted into an asset.

| Design state | Example text | Visual treatment |
| --- | --- | --- |
| Working | Codex is working | Existing working animation or a dedicated active pose/prop. |
| Needs you | Codex needs you | A clear attention gesture or small attention prop. |
| Finished | Codex is done | A relaxed pose or clear success cue. |
| Error | Codex hit an error | A readable error pose or restrained glitch. |
| Nothing running | Nothing running | Existing Idle animation; no announcement flash. |

### Prefer Dedicated Animation; Share the Fallback

Character themes can express a state through a pose, gesture, or a small animated
prop next to the character. Usually two or three deliberate frames are enough
for a new state; this is not a limit on approved existing loops. Use one stable
scene and animate only the necessary region. Do not independently regenerate
the whole background for each frame.

Choose the fallback **per state**: use the dedicated asset when one exists;
otherwise use the shared announcement and persistent label text. A theme does
not need five custom animations to participate. Intentionally calm Idle behavior
remains valid, including Mini's eyes-only Idle.

The universal fallback inverts the **entire composed display**, including the
status line, twice:

| Time after transition | Display |
| --- | --- |
| 0–200 ms | Fully inverted |
| 200–350 ms | Normal |
| 350–550 ms | Fully inverted |
| From 550 ms | Normal; current status text remains |

Switch directly between normal and inverted colors: no fading, intermediate
colors, colored border, or theme-specific tint. Apply one shared effect to the
rendered theme; it must need no theme-specific assets, palette, mask, coordinates,
or firmware branch. This is a behavior contract, not a requirement to allocate
a full-screen framebuffer on the ESP8266.

Run it once per actual agent-state transition. Repeated snapshots, quota updates,
countdown ticks, and update-notice rotation must not retrigger it. Nothing running
does not flash. When animation is disabled, update the label without flashing;
disabling animation mid-flash must restore normal colors immediately. Browser
prototypes must also respect `prefers-reduced-motion`. Preview replay controls
may repeat the announcement for review; production must not loop it endlessly.

## Core Rule

Use the ThemeSpec JSON only for live data and layout control. Put visual detail into streamed assets.

ThemeSpec JSON costs RAM during activation, when the firmware parses it into an
ArduinoJson tree and compiles a runtime scene. Static `CBI1` assets are read row
by row from LittleFS. Animated `CBA1` assets additionally need a shared RGB565
buffer sized to their **draw dimensions**; GIFs need decoder memory. Stored asset
bytes alone do not describe runtime RAM cost.

The firmware now compiles a stored ThemeSpec into a runtime scene once per active theme. Full render, partial render, and animation ticks should run from that compiled scene instead of repeatedly walking JSON. This is the scalable path for rich themes: every theme gets the same render behavior, and Clippy-style state animation is not a one-off special case.

The compiled scene copies normal strings and `idle`/`coding` `stateAssets` paths
into a bounded string pool. Themes that rely on JSON-backed RLE `pixels` retain
the JSON document; streamed-asset themes can release it after compilation.

## Three Layers of a Theme

Keep these layers separate:

1. `theme-packs/<theme-id>/theme.json` is the stored ThemeSpec. It should contain
   layout, colors, and only the values that change at runtime.
2. `theme-packs/<theme-id>/assets/` contains static or animated visual detail:
   `CBI1` for static sprites, `CBA1` for animated sprites, and GIF only when an
   actual GIF is required.
3. `theme-packs/<theme-id>/manifest.json` is source packaging metadata: version,
   capability requirements, device paths, and file checksums. Some themes, such
   as Tiny Office, regenerate it with a dedicated asset compiler; edit that
   compiler's inputs instead of making changes its next run would overwrite.
   `dist/theme-packs/` contains generated render packs, catalogs, and ZIPs. Do not
   edit those outputs by hand.

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
- After shrink changes size, use `valign` / `va` (`middle`/`center` or `bottom`) so the glyphs stay in the lane. Set `h` to the box (for example a 32px logo); omit `h` to use the max `fontSize` lane (`ApproxTextHeight`). Omit `va` or write `top` for today's top alignment. `y` is the top of that box. `va` is not compatible on older firmware (it keeps top alignment), so packs that emit `middle`/`center`/`bottom` must declare `text-valign-v1` and `minFirmware` 1.0.42. Write the exact tokens `top`, `middle`, `center`, or `bottom` — firmware does not lowercase aliases.
- Keep units and suffixes in theme text. When current quota values are unavailable, session/weekly bindings become `??`, reset templates become `Reset unavailable`, and progress bindings keep their last numeric fill (or zero on a cold start).
- Give every live theme exactly one `{label}` / `l` binding for the provider line. It carries the provider display name or observed agent status, and it is the firmware update-notice slot: when an update is available the firmware rotates that text through `Update available` and `Open VibeTV Mac App`, so do not reserve a separate bar for this. A live theme without a label binding instead gets a temporary 24px edge overlay, so keep at least one horizontal edge free of animated GIF/sprite primitives when possible.
- Know the difference between the two bindings before choosing one. On the wire `provider` is the lowercased provider key (`codex`) and `label` is the display name (`Codex`), so `{provider}` on a provider line renders lowercase. Screensavers still use `{provider}`: the update notice must not take over the screensaver.
- Keep all primitives that can change at runtime inside stable bounds. Text without a width is allowed, but the firmware treats it conservatively up to the right display edge for partial render safety.
- Combine many small decorative rects into one sprite asset.
- Combine static text labels into a sprite when they do not need to change.
- Prefer one detailed streamed sprite over many tiny JSON primitives.
- Keep asset paths short, for example `/themes/u/syn-top.cbi`, because ESP8266 LittleFS paths are short.
- Keep each CBI1/CBA1 palette between 1 and 26 colors. For detailed pixel art, use a deliberate, compact palette with nearby shadow and midtone steps instead of maximizing the color count.
- Preserve an existing native pixel grid. For a high-resolution reference, downsample deliberately before nearest-neighbor upscaling; do not soften already-finished pixel art or round each RGB channel to coarse steps.
- Compare the final reference and the Theme Studio render at the same scale. Strong black/bright jumps, repeated horizontal bands, or noisy checkerboard detail usually indicate a bad downscale or quantization step, not a ThemeSpec layout problem.
- Use `stateAssets` for `idle`, `coding`, `needs_you`, `done`, and `error`; do not duplicate the whole theme just to change one character sprite.
- Use `providerAssets` / `pa` on sprite primitives when one pack must show different provider logos. Keys must be the lowercase wire `provider` value (`codex`, `claude`, `cursor`), not `{label}` display text. Always keep `a` as a valid fallback sprite. Packs that use `pa` declare `provider-assets-v1` and `minFirmware` 1.0.42.
- Use `colorStops` / `cs` on progress primitives when fill should track remaining quota (for example green ≥75, yellow ≥50, orange ≥25, red ≥0). `gte` is remaining-style: firmware matches the bound percent as sent when `usageMode` is `remaining`, and `100 - percent` when `usageMode` is `used`, so warning colors stay red at low remaining / high used. Keep at most four stops. Always set solid `c` as the fallback for older firmware. Packs that use `cs` declare `color-stops-v1` and `minFirmware` 1.0.42.
- Run `node scripts/build-theme-packs.mjs` after every pack change. It validates the source directory and generated ZIP, and regenerates the catalog and exact render pack.
- Plan a 10–20 minute real-hardware acceptance run for each launch candidate, including repeated theme switches. Execute device writes only in an explicitly approved test window for that device and action.
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

First respect the current hard limits and the target device's advertised
capabilities. A firmware version alone is not a substitute for capability checks.

| Constraint | Current ESP8266 limit |
| --- | --- |
| Display | 240 × 240 pixels |
| Stored ThemeSpec | 4096 bytes; inline ThemeSpec capability is 2048 bytes |
| Compiled primitives | 32 |
| Compiled string pool | 1024 bytes, including string terminators |
| CBI1/CBA1 palette | 1–26 colors per asset |
| CBA1 animated draw box | At most 80 × 80 pixels; shrinking only the source does not reduce a larger draw box |
| CBA1 frame header | 1–64 frames, 0–30 fps; use a nonzero fps for timed animation |
| GIF | At most one referenced GIF asset, 24 KiB, 80 × 80 draw box |
| LittleFS device path | At most 31 characters |

A CBA draw buffer needs `width × height × 2` bytes: 80 × 80 is 12,800 bytes,
before other renderer memory. The allocator also requires animation headroom
and a large enough contiguous free block. These limits come from the shared
renderer, the ESP8266 runtime policy, and pack validation—not from browser CSS.
Large design GIFs and PNG sprite sheets are review artifacts, not automatically
device-compatible assets.

Within those ceilings, use these launch targets:

- ThemeSpec JSON: preferably below 1000 bytes.
- Primitive count: preferably below 16 for static themes, below 20 for animated themes.
- Static visual detail: pushed into `CBI1` sprites.
- Animated characters: pushed into `CBA1` sprites.
- CBI1/CBA1 palette: 26 colors maximum; fewer, closely spaced colors are usually better for soft pixel art.
- Static CBI1 backgrounds may cover the whole display. Measure render time and repeated switching; do not confuse their streamed rows with a CBA draw buffer. Keep animated regions small even when the surrounding scene is large.
- For GIF sizing, use `mini.gif` as a reference and run the actual pack validator; file size and dimensions alone do not prove decoder compatibility.
- Dynamic primitives: only what must update from supplied data, including provider, usage windows, supported activity, and clocks.
- Device health after activation: `renderOk: true`; no rising `renderFailures`; heap should not be critically low.
- Normal idle/coding and usage updates should use partial render after the first full render.
- Full render count may increase after activation, reconnect, explicit theme change, clear, or render recovery. It should not climb continuously during steady live data updates.

## Asset Pipeline

Create and review pixel artwork outside Claude Design. Import approved sprites
unchanged and use Claude Design for layout and playback, not to redraw or
reinterpret the artwork. Keep the source art, individual frames, palette,
timing, and final sprite/GIF exports together in the design handoff. Identify
browser-only preview sheets separately from encoded device assets.

For an existing native pixel-art asset, preserve its grid and use nearest-neighbor
scaling. For a high-resolution static reference that still needs conversion:

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

Do not repeatedly resize an already quantized image or apply a second contrast
pass after palette reduction. Both can amplify the gaps between palette colors.

For animation, align every frame on the same pixel grid, hold unchanged regions
stable, and preview the loop at its final draw size. Encode device animation as
CBA1 within the draw-buffer limits; use GIF only within the GIF contract. An
approved full-scene animation may need static CBI1 scenery plus a small CBA1
window before it is ready for hardware. Do not silently degrade approved art to
make it fit—review the encoded result again.

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

Use the slot bindings for supplied usage-window names and values; do not invent
Session/Weekly windows or resets for missing data. Test long names, unavailable
data, and both used/remaining modes. The design's agent-state vocabulary must
not change CodexBar's usage-window meaning or provider-error semantics.

## Generate and Validate the Pack

Run the following from the repository root. Documentation-only changes do not
need theme version bumps or regenerated packs. After changing pack content:

1. Regenerate assets and manifest metadata with the theme's compiler if it has
   one. Bump `manifest.json` `version` in the authoritative source.
2. Bump the ThemeSpec `rev` and change its manifest device path, for example from
   `/themes/s/rcf-3-<hash>.json` to `/themes/s/rcf-4-<hash>.json`.
   Refresh every changed file's declared `bytes` and `sha256`, including the
   ThemeSpec itself. The pack builder validates these values; it does not repair
   stale source-manifest checksums. Declare the capabilities the pack uses and
   the corresponding minimum firmware.
3. Run:

   ```bash
   node scripts/build-theme-packs.mjs
   ```

4. Validate the source pack directly when needed:

   ```bash
   go -C companion run ./cmd/codexbar-display theme-pack validate \
     --pack ../theme-packs/<theme-id>
   ```

5. Check packaging and immutable history:

   ```bash
   node scripts/test-theme-pack-release-flow.mjs
   ./scripts/check-theme-pack-history.sh
   ```

6. Build the local Control Center to include the current catalog, ZIP, and
   exact render pack:

   ```bash
   npm --prefix apps/control-center run build:local
   ```

The build must show the new revision in
`dist/theme-packs/render/<theme-id>/`. A stale render revision or stale ZIP means
Theme Studio and the Mac App can still show the previous asset even when the
source directory is correct.

Never replace a published versioned ZIP or exact revision render pack. Keep the
frozen legacy catalog intact; publish a new version/revision through the existing
generation-2 pipeline. See [theme-packs.md](theme-packs.md) for slot paths,
catalogs, and install commands. Building or validating a pack does not authorize
publishing it or writing to hardware.

## WiFi Upload Safety

Theme install over WiFi is a firmware stress path, not just a file copy. The ESP8266 has little RAM, so asset uploads must be slow and boring.

Use local validation first. A hardware test requires explicit approval for the
specific device and write action. After a failed hardware write, read-only
diagnosis is allowed, but another write attempt needs new approval. Theme-only
CLI tests must use `--skip-firmware-update`; approval to install a theme is not
approval to update firmware. See [theme-packs.md](theme-packs.md).

- Keep Companion asset uploads rate-limited. Do not remove the upload throttle to make installs feel faster.
- Do not immediately retry `connection reset by peer`, EOF, or timeout during `/assets`. First check `/health`; if the device rebooted or is unreachable, stop and let it recover.
- Upload assets first, upload the ThemeSpec second, activate last. Do not activate a ThemeSpec while one of its assets may be partial.
- After install, check `/health`: `system.freeHeap`, `display.themeSpec.renderOk`, `display.themeSpec.renderFailures`, and `display.gif.decoderOpen`.
- A healthy non-GIF ThemeSpec should not leave `display.gif.decoderOpen=true`. If it does, the previous GIF renderer was not released and heap will collapse after repeated switches.
- Test repeated switches, not only a single install. Minimum smoke path: `synthwave -> clippy -> synthwave`, with `/health` green after each activation.

## Good Pattern

Use one or two detailed sprite assets plus a small ThemeSpec:

- `sprite`: static background, decorative border, and genuinely static labels.
- `text`: exactly one dynamic provider/status `label` binding.
- `progress`: usage slot 1.
- `text`: slot 1's supplied label and percentage.
- `progress`: usage slot 2.
- `text`: slot 2's supplied label and percentage.
- optional `text`: reset time.
- optional `sprite` with `stateAssets`: character poses for the five display states.

This can look rich while keeping RAM pressure low.

## Runtime Pattern

A customer-ready theme should follow this render lifecycle:

1. Upload static assets and the stored ThemeSpec.
2. Activate the stored ThemeSpec once.
3. Let the firmware compile that ThemeSpec into its runtime scene.
4. Send normalized live data through the existing Companion path: provider, labels, usage windows, resets, tokens, and supported activity. Keep transport and provider interpretation outside the theme.
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

Review the design before device packaging:

- All five design states are shown together at 240 × 240 and at the actual sprite/prop size.
- Approved Working/Idle assets, unrelated themes, and stable scene geometry are preserved.
- Agent status uses the existing label slot; usage labels and reset information remain intact.
- Long agent names and status text fit without clipping, collisions, or invisible shrinking.
- Dedicated loops have aligned frames; missing state assets use the shared fallback.
- The fallback performs two hard inversions with the exact 200/150/200 ms timing, returns to normal, and does not retrigger on an unchanged state.
- Idle, replay, animation-off during a flash, and browser reduced-motion behavior are checked.
- Preview data is labeled as example data; approved designs are not described as already supported firmware features.

Before a pack is published, complete local validation and the explicitly approved
hardware acceptance run. Record the exact pack version/revision, device and
firmware, checks performed, and any unverified behavior:

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

## Implementation References

- [ThemeSpec schema](../protocol/theme_spec_v1.schema.json) and [Companion validation](../companion/internal/themespec/themespec.go): supported bindings and state-asset keys.
- [Shared renderer](../firmware_shared/theme_spec_renderer_core.h): compiled-scene limits and `LabelText` update-notice substitution.
- [ESP8266 runtime policy](../firmware_esp8266/src/theme_spec_runtime_policy.h) and [asset renderer](../firmware_esp8266/src/renderer_esp8266_theme_spec.cpp): draw-buffer limits and allocation behavior.
- [Update-notice renderer](../firmware_esp8266/src/renderer_esp8266.cpp): existing label slot versus temporary overlay.
- [Pack builder](../scripts/build-theme-packs.mjs) and [pack validation](../companion/internal/themepack/themepack.go): source manifests, checksums, paths, and immutable outputs.
- [Tiny Office](tiny-office-theme.md): a large static scene with a bounded animated region and an explicit design-to-device pipeline.
