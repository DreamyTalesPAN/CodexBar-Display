# Unified AI Theme Studio — design draft

Related to [#151](https://github.com/DreamyTalesPAN/CodexBar-Display/issues/151).
This captures the reviewed interaction concept, not the production implementation.
The older implementation draft [#231](https://github.com/DreamyTalesPAN/CodexBar-Display/pull/231)
is historical context; this prototype does not depend on or replace its branch.

## Try it

Download or check out this directory and open `index.html` in a modern browser.
It is self-contained and works offline; GitHub's source viewer does not execute HTML.
No build, server, account, API key, or connected VibeTV is needed.

1. Select the cat, artwork, or a usage reading directly in the preview.
2. Drag it, use the position buttons or arrow keys, or remove it. Shift + arrow
   moves further; Delete removes the selected element.
3. Try **Warmer sky**, **Remove the cabin**, or **Change movement**, then
   **Update theme**. Undo/Redo covers both manual and simulated AI edits.
4. Pause the cat, change its speed, or switch to a sleeping animation.
5. Try **New theme**, **Cozy cabin**, then explicitly **Add animation**.
6. Explore sample data states and the disabled API-key setup walkthrough.

## Design decisions

- One studio and one theme document: describe, preview, refine, and save in the
  same screen. No separate AI wizard followed by another editor.
- Keep the canvas stable when selecting elements. Show only relevant tools:
  labels for readings, movement and speed for sprites, image guidance for artwork.
- Let AI propose the visual palette instead of forcing a four-color selector.
- Keep background artwork and transparent animated sprites separate. A sprite
  can move or disappear without regenerating the background or usage layout.
- Background details such as the cabin are pixels within one image, not
  independently draggable objects. Their edits use the simulated AI action.
- Keep playback state separate from document edits. Reduced-motion preference
  pauses autoplay; the user can explicitly play. Hidden pages pause rendering.
- Use a small preset loop rather than exposing a timeline or frame editor.

## Honest prototype boundaries

The scene and four-frame cat are hand-drawn browser samples. Text prompts select
predefined changes; they do not call or evaluate a model. Unrecognized prompts
also produce an example change, not a literal interpretation of the request.

The OpenAI walkthrough illustrates a proposed provider setup. The key field is
disabled. Keychain storage, real model selection, billing/cost confirmation,
authentication, validation, retry/error handling, and image/sprite generation
remain implementation work under #151.

**Save draft** only marks an in-memory snapshot; reloading loses all changes.
**Send to VibeTV** only displays an explanatory message. Usage values and reset
times are illustrative samples, not live provider data. The file has no storage,
network, Companion API, device, or filesystem integration, and its Content
Security Policy blocks network connections and external resources.

The illustrative 240 × 240 preview and 32 × 32 sample sprite do not prove device
compatibility. Production work must reuse the existing Theme Studio document,
asset validation, export budget, and provider-neutral usage path; validate the
actual supported sprite format and rendering limits before promising animation.
This draft does not implement the security requirements of #151, close that
issue, change product routes, or authorize firmware/device writes.

## Reproducible checks

Use the existing Control Center Playwright dependency (no new package):

```sh
npm ci --prefix apps/control-center
cd apps/control-center
npx playwright install chromium
cd ../..
node docs/design/ai-theme-studio/check-editor.cjs
node docs/design/ai-theme-studio/check-animation.cjs
git diff --check
```

The checks load this exact standalone file, exercise the shared edit history,
AI cancellation and layout preservation, new-draft recovery, disabled setup,
sample data, sprite pixels/transparency/playback/speed/removal, reduced motion,
and light/dark layouts at 320, 360, 736, and 1024 content pixels. They fail on
JavaScript errors or unexpected resource requests.

Optionally set `THEME_STUDIO_SCREENSHOTS` to an existing local output directory
to capture review images. Screenshots are not committed. Product builds,
provider integration, and cold/warm hardware rehearsals are outside this
documentation-only draft and have not been validated by these checks.
