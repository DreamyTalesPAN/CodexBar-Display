# AI Theme Studio: local implementation decision (#151)

## Decision

September 10 follow-up supersedes the single-crop/ellipse experiment below.
An actual cat test returned HTTP 200 but visibly redrew the head and fur instead
of just blinking. Scene edits now receive the full 240x128 original, enlarged
proportionally to 1200x640, with the same bounded edit area in global coordinates.
The ellipse heuristic is removed; this is still an edit window, not segmentation.
Generate intermediate and peak poses from the same original and assemble A-B-C-B.
The return reuses B exactly rather than asking for another inconsistent pose.
Planning must choose reversible gestures. Existing scenes cost at most two image
calls, new ones at most three. No model/quality/provider change and no AI reviewer.
The UI labels director notes as an AI plan, not a verified visual result.
This is an UNVERIFIED visual-quality hypothesis until real-provider comparison;
unit tests only establish full-scene coordinates, retained pixels and call bounds.

Image generation and image edits use `gpt-image-2` with one centrally
pinned `low` quality setting, per the September 9 user-approved rollback after
Flare model verification returned an actual HTTP 404 `model_not_found`. This includes
scene-animation sheets; no image path may override quality to medium/high.
The text/vision director is unchanged. This is a fixed model selection, not an
automatic provider fallback or a bypass of credential verification.

The September 8 unified-creation revision supersedes the procedural scene-motion
UI. One input and one **Create with AI** button always submit `target: auto`,
regardless of selection. A vision director sees the current composed artwork and
animation reference and chooses static art, an independent character or a coherent
scene loop. No separate animation composer, effect menu or editable motion region
is shown. Text, readings, Undo/Redo, save and export remain manual options.

September 9 user-requested correction: the polygon-layer and eight-frame
pixel-transform approaches were rejected by the customer and removed. Scene
animation uses the image-edit transport to DRAW different poses. The director chooses the
subject/action and a padded region within64x64; this is an asset boundary, not
a scrolling/warping effect. The original first frame and outer three pixels
are restored exactly. Interior pose pixels come from the image model.

September 10 single-pose experiment: the customer observed a smaller, displaced
cat inside the generated sheet. The resting 56x56 overlay matched the background
exactly; the generated pose contents did not. Replace model-generated grids with
three individual edits, each using the identical enlarged original crop and
identical PNG alpha mask. The original is frame one. The program alone assembles
the four-frame 2x2 sheet, preserving existing renderer/export compatibility.
The edit mask is an ellipse around the director's unpadded detail bounds plus
two pixels, clipped inside the padded context's stationary border; it is not
semantic segmentation. The same mask is enforced when composing each result,
so protected scenery cannot be replaced even if the provider edits it.
This does not guarantee coherent anatomy or perfect framing within the mask;
visual benefit must be established with the real cat-cafe comparison.

September 10 user decision: remove the post-generation AI visual reviewer,
its verdict schema, rejection and feedback-based regeneration entirely.
Return readable generated frames directly; the customer judges their appearance.
The browser likewise no longer rejects identical frames or extensive redraws.
At most one background image and three pose images are generated per request;
the customer consent copy discloses up to four generated images.
Technical image decoding, dimensions, bounds, cancellation and security checks
remain. The vision director still plans the subject/action before generation;
it does not approve or reject generated pictures afterward.
There is NO procedural or silent static fallback. Provider/technical failures
remain possible; mocked tests do not establish visual quality.

The browser retains its palette and one-CBA
compiler. Eight-frame import support remains for existing designs, but new scene
sheets have four frames. Independent character generation, manual usage labels,
Undo/Redo and the current document are unchanged. Real-provider quality of this
corrected path remains UNVERIFIED; earlier successful procedural runs are not
evidence for it. Local preview only, not release or hardware qualification.

September 9 diagnostic revision: failures now carry the exact pipeline stage and
a bounded, secret-redacted explanation; AI assessments are explicitly labelled.
Malformed responses are distinguished from infeasible motion regions. There is
no new persistent logging. The September 10 decision above removes the former
post-generation visual verdict.

Implement the approved single-screen workflow using the existing Theme Studio
document, reducer, preview renderer, asset validation, library storage, and export.
The test entry point is `/internal/theme-studio-preview`, disabled unless
`VIBETV_AI_THEME_PREVIEW=1`. The normal product entry points are unchanged.

Provider calls run in an isolated, loopback-only Go helper from the Companion
codebase, not on the hosted Next.js server. This helper registers only AI routes:
no device, daemon, pairing, firmware, or customer-runtime endpoints. It never
loads the installed Mac App's state. Only OpenAI's fixed HTTPS model/image paths
are allowed. Reject redirects and non-public resolved addresses; bound inputs,
provider responses, deadlines, concurrent generation, and request frequency.

Keys are held only in the helper process memory. The password input is cleared
after submission; no key, prompt history, or original full-resolution image is
written to browser storage. Existing browser library storage contains only the
resulting Theme Studio document/assets. Keychain persistence is deferred, not
simulated. Closing the helper forgets its key.

The local Next.js proxy must validate the incoming Host, Origin, and request
metadata before forwarding any AI request. Production-hosted requests are denied;
the upstream target and paths cannot be supplied by a browser. Cancellation is
propagated to the provider; a late result cannot overwrite a changed document.
Generation requires a visible cost acknowledgement and explicit user action.

## Threat model and remaining gates

Untrusted browser origins, DNS rebinding, provider responses, and generated
images are treated as hostile. No redirects, arbitrary URL fetching, raw provider
errors, secrets in URLs/logs, or executable generated content. Local OS compromise
and malicious browser extensions remain outside this boundary.

This is a functional development preview, not approval for release. A live
verification on September 8, 2026 returned HTTP 401 for the pre-existing Theme
Studio credential; it was removed from helper memory without changing Keychain.
Subsequent valid-key tests passed static generation but rejected scene animation;
see the current QA report. Browser animation does not prove
firmware transparency or frame-budget compatibility. No hardware write, Mac App
replacement, merge, release, or production deployment is part of this test.

## Run on this Mac

From the repository root, run `bash scripts/start-ai-theme-preview.sh`, then open
`http://localhost:3015/internal/theme-studio-preview`. Requires Go and Node.js;
the launcher installs locked npm dependencies if missing. Keep the terminal open.
Ctrl-C stops the helper and web server. Existing processes on ports 3015 or 47852
are never terminated automatically.

Use **Try an animated example** for the existing Token Fire artwork.
It is a built-in example, not an AI-generated result. Select or drag the flame,
remove/undo, save, reopen, or export without a provider call.
For AI generation, enter an idea and press **Create with AI**. If needed, the
setup dialog asks for a valid OpenAI API key and billing consent. **Connect and
continue** resumes this original generation request without a second AI click.
Connecting from Settings alone does not start a generation. Manage the key from
the header's **VibeTV settings** gear. This preview does not auto-load Keychain
credentials or change the installed app's settings.

Save writes the editable document to this browser's local library (not to the
installed app). Export editable JSON for a portable backup, or a theme-pack ZIP.
Existing browser data is preserved. The isolated development instance never
opens or installs the exported pack on a device.

## Verification

- `cd companion && go test ./internal/companionapi -run '^TestAITheme' -count=1`
- `cd apps/control-center && npm run test:unit && npx tsc --noEmit`
- With the preview running: `cd apps/control-center && node scripts/test-ai-theme-preview.mjs`

The browser test explicitly stubs paid AI responses after checking the real local
helper and foreign-origin rejection. It covers first-use setup and continuation,
one input regardless of selection, three representations, visual references,
character position, scene playback, manual text/reset preservation, save/reload,
quality failure, cancellation, exact Undo, ZIP/JSON export and import, lost keys,
and light/dark desktop/mobile layouts. It is not proof of live AI image quality.

## Customer-facing editor pass (September 8, 2026)

The main screen is the display, a description field and Save. Element-specific
controls appear only when selected. **+ Add element** explains Text, Usage bar,
Shape, Clock and Image or animation without exposing file formats or internal
primitives. **More options** contains saved designs, an optional element picker,
renaming and file import/export. Before/after and the permanent name/key fields
are removed; shared Undo/Redo remains authoritative.

The description input grows and shrinks with its content (bounded to 256px), has
no manual resize handle, and keeps a stable accessible label. Readings are named
in plain language; their bindings are not exposed as editable template text.
An empty design is an invitation to start, not a validation error.

Only billing consent is remembered in tab sessionStorage, so reload does not
repeat setup while the helper still has its key. Disconnect clears that consent
and the helper credential. Keys, prompts and original images are never written
to sessionStorage. Settings/key management is functional in this isolated
preview; integration into the installed product and durable key storage remain
separate work, not simulated here.

## Connection transport correction (September 8, 2026)

Next supplies an empty body stream for bodyless verification POSTs and credential
DELETEs. The proxy previously treated the stream itself as nonempty JSON input,
returning 415 before the helper was reached (including during cleanup). It now
checks the bounded byte count; nonempty non-JSON bodies are still rejected, and
empty requests are forwarded without a body. Regression tests cover both methods.
Connection failures no longer instruct the customer to start a new concept.

After this fix, the user's already configured credential passed the real
verification endpoint through Next and the helper: HTTP 200, `verified: true`.
No key was read back or exposed, and no image generation was triggered. The
earlier 401 concerned the old Keychain entry; successful new-key verification is
not a claim about generated image quality or device rendering.
