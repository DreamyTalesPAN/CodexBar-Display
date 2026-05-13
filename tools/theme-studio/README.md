# Vibe TV Theme Studio

Local ThemeSpec v1 editor for Vibe TV display layouts.
The MVP targets the Mini theme only. ThemeSpec metadata is kept fixed where possible: `fallbackTheme` is always `mini`, and the UI exposes the stable theme name instead of internal revision/fallback controls.

```bash
../../scripts/theme-studio.sh
```

Open the Vite URL, set the theme background, edit, drag, or resize primitives on the 240x240 device preview, then select `Send to Vibe TV`.
Text uses the single TFT GLCD font compiled into the ESP8266 firmware; use Size to scale it.
Pixel shapes use a compact 1-bit bitmap mask so small icons can be drawn exactly on the device.
Set the Vibe TV field to the device URL, for example `http://192.168.178.163` or `http://vibetv.local`.
The Studio clears any cached ThemeSpec, uploads referenced GIF assets, then sends the full `/frame` payload.
GIF uploads use short `/themes/u/...` paths because ESP8266 LittleFS rejects paths longer than 31 characters.
Use `Save Theme` to keep a JSON file locally, or `Copy JSON` for debugging.
Use `Advanced JSON` -> `Apply JSON` to import a readable ThemeSpec or the compact device form into the preview. Invalid JSON or invalid ThemeSpec content is rejected without changing the current canvas.

Keyboard controls:
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
- `rect`, `text`, `progress`, `gif`, `pixels` primitives
- Konva 240x240 preview with one selected Transformer at a time
- drag-to-position plus resize/rotate handles
- animated GIF preview through `gifler`
- property inspector
- WiFi send flow with asset upload
- JSON editor
- byte and primitive limit checks for the ESP8266 ThemeSpec MVP

Manual JSON import checks for issue #72:
- Paste a valid ThemeSpec with `text`, `rect`, `progress`, and `gif`, then apply; preview, element list, inspector, save, copy, and send should use the imported theme.
- Paste invalid JSON; the current canvas should stay unchanged and a parse error should be shown.
- Paste valid JSON with invalid ThemeSpec content, for example a bad color or too many primitives; the current canvas should stay unchanged and the error should explain the problem.
