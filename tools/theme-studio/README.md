# Vibe TV Theme Studio

Local ThemeSpec v1 editor for Vibe TV display layouts.
The MVP targets the Mini theme only. ThemeSpec metadata is kept fixed where possible: `fallbackTheme` is always `mini`, and the UI exposes the stable theme name instead of internal revision/fallback controls.

```bash
../../scripts/theme-studio.sh
```

Open the Vite URL, edit or drag primitives on the 240x240 preview, then select `Send to Vibe TV`.
The Studio sends a full `/frame` payload with the current ThemeSpec to `http://vibetv.local`.
From local Vite dev mode, the browser cannot read the device response because the firmware does not expose CORS yet; the request is still sent.
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
- `rect`, `text`, `progress` primitives
- 240x240 preview
- drag-to-position
- property inspector
- JSON editor
- byte and primitive limit checks for the ESP8266 ThemeSpec MVP
