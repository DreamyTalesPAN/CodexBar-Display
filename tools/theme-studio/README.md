# Vibe TV Theme Studio

Local ThemeSpec v1 editor for Vibe TV display layouts.
The MVP targets the Mini theme only. ThemeSpec metadata is kept fixed where possible: `fallbackTheme` is always `mini`, and the UI exposes the stable theme name instead of internal revision/fallback controls.

```bash
../../scripts/theme-studio.sh
```

Open the Vite URL, set the theme background, edit, drag, resize, or rotate primitives on the Konva-backed 240x240 preview, then select `Send to Vibe TV`.
Text fonts are limited to the TFT fonts compiled into the ESP8266 firmware (`TFT Font 1` and `TFT Font 2`).
Set the Vibe TV field to the device URL, for example `http://192.168.178.163` or `http://vibetv.local`.
The Studio clears any cached ThemeSpec, uploads referenced GIF assets, then sends the full `/frame` payload.
GIF uploads use short `/themes/u/...` paths because ESP8266 LittleFS rejects paths longer than 31 characters.
Use `Save Theme` to keep a JSON file locally, or `Copy JSON` for debugging.

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
- `rect`, `text`, `progress`, `gif` primitives
- Konva 240x240 preview with one selected Transformer at a time
- drag-to-position plus resize/rotate handles
- animated built-in GIF preview
- property inspector
- WiFi send flow with asset upload
- JSON editor
- byte and primitive limit checks for the ESP8266 ThemeSpec MVP
