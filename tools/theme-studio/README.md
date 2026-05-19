# Vibe TV Theme Studio

Local ThemeSpec v1 editor for Vibe TV display layouts.
The MVP targets the Mini theme only. ThemeSpec metadata is kept fixed where possible: `fallbackTheme` is always `mini`, and the UI exposes the stable theme name instead of internal revision/fallback controls.

```bash
../../scripts/theme-studio.sh
```

Open the Vite URL, set the theme background, edit, drag, or resize primitives on the 240x240 device preview, then select `Send to Vibe TV`.
Text uses the single TFT GLCD font compiled into the ESP8266 firmware; use Size to scale it.
Pixel shapes use a compact 1-bit bitmap mask so small icons can be drawn exactly on the device.
Sprite sheets can be imported from PNG, JPEG, or WebP. The browser slices the sheet into frames, reduces the palette to at most 26 colors, and uploads a compact `CBA1` animated sprite asset instead of making the ESP8266 decode source images.
Animated sprites can use a `Clear` color in the inspector. Set it to the solid local background behind the sprite to prevent frame-to-frame flicker boxes on the ESP8266.
GIF elements can also use `Background` as their local clear color. This does not magically key out every black pixel; it gives the firmware a color to restore behind transparent GIF pixels and between GIF loops.
Use `Cozy Meadow` to load a warm pastoral sample theme with a generated meadow background sprite, birds, a butterfly, flowers, a small GIF, and live usage text.
Set the Vibe TV field to the device URL, for example `http://192.168.178.163` or `http://vibetv.local`.
The Studio clears any cached ThemeSpec, uploads referenced GIF and sprite assets, uploads the compact ThemeSpec JSON as a content-hashed `/themes/u/<short-id>-<hash>.json`, activates it with `/theme/active`, then sends a small live `/frame` with usage values only.
The health confirmation checks the active stored path and firmware-reported content hash so inspector edits such as text color, font, size, and position cannot be mistaken for an older same-id/same-revision theme.
After a stored theme is confirmed, the Studio deletes older stored JSON versions of the same theme. It intentionally keeps referenced GIF/sprite assets and unrelated theme files because those may still be shared by other themes.
After that, the Companion daemon is the source of truth for live fields such as `session`, `weekly`, `resetSecs`, `time`, and `date`. If the daemon is running, it may overwrite the Studio's sample values on the next cycle while keeping the stored theme active.
Older firmware without `/theme/active` still gets a legacy inline `/frame` when the theme fits into the frame limit.
Asset uploads use short `/themes/u/...` paths because ESP8266 LittleFS rejects paths longer than 31 characters.
For ESP8266 themes, treat the 4096-byte stored ThemeSpec limit as a transport/storage ceiling, not a design target. Large JSON trees also need RAM while parsed, so detailed themes should keep the ThemeSpec small and move visual detail into uploaded `CBI1`/`CBA1`/GIF assets. See `../../docs/theme-dev-guide.md` for the required RAM-first theme rules.
The Studio also estimates render cost before sending. Expensive initial scenes show a warning, themes over the conservative initial render budget are blocked, and themes with too much animated repaint work are blocked because those can flicker or reset the ESP8266 watchdog.
Use `Publish` to create a new repo theme pack under `theme-packs/<theme-id>/`, or `Update` when that pack already exists. The local dev server validates the pack, rebuilds `dist/theme-packs/vibetv-theme-packs.json`, and regenerates the ZIPs that customers install from GitHub.
Use `Save Theme` to keep the current ThemeSpec in this browser and reuse it later.
Use `Advanced JSON` -> `Apply JSON` to import a readable ThemeSpec or the compact device form into the preview. Invalid JSON or invalid ThemeSpec content is rejected without changing the current canvas.

Keyboard controls:
- `Cmd/Ctrl+Z`: undo, `Cmd/Ctrl+Shift+Z`: redo
- `Cmd/Ctrl+C`: copy selected element
- `Cmd/Ctrl+V`: paste copied element
- `Cmd/Ctrl+D`: duplicate selected element
- `Delete`/`Backspace`: delete selected element
- Arrow keys: move selected element by 1px, or 10px with `Shift`

Manual development commands:

```bash
npm install
npm run dev
```

Advanced fallback through the companion CLI:

```bash
cd ../../companion
go run ./cmd/codexbar-display theme-validate --transport wifi --target http://vibetv.local --spec ../tools/theme-studio/theme.json
go run ./cmd/codexbar-display theme-apply --transport wifi --target http://vibetv.local --spec ../tools/theme-studio/theme.json
```

Current MVP scope:
- `rect`, `text`, `progress`, `gif`, `sprite`, `pixels` primitives
- Konva 240x240 preview with one selected Transformer at a time
- drag-to-position plus resize/rotate handles
- animated GIF preview through `gifler`
- animated sprite-sheet preview through compact `CBA1` frame assets
- property inspector
- WiFi send flow with asset upload, stored ThemeSpec activation, and legacy inline fallback
- JSON editor
- byte and primitive limit checks for the ESP8266 ThemeSpec MVP. Current ESP8266 builds keep live frames at 2048 bytes and stored ThemeSpecs at 4096 bytes.

Manual JSON import checks for issue #72:
- Paste a valid ThemeSpec with `text`, `rect`, `progress`, `gif`, `sprite`, and `pixels`, then apply; preview, element list, inspector, save, copy, and send should use the imported theme.
- Paste invalid JSON; the current canvas should stay unchanged and a parse error should be shown.
- Paste valid JSON with invalid ThemeSpec content, for example a bad color or too many primitives; the current canvas should stay unchanged and the error should explain the problem.
