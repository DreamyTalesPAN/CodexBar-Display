# Vibe TV Theme Studio

Local ThemeSpec v1 editor for Vibe TV display layouts.
The MVP targets the Mini theme only. ThemeSpec metadata is kept fixed where possible: `fallbackTheme` is always `mini`, and the UI exposes the stable theme name instead of internal revision/fallback controls.

```bash
../../scripts/theme-studio.sh
```

Open the Vite URL, edit or drag primitives on the 240x240 preview, then copy or download the generated ThemeSpec JSON.

Manual development commands:

```bash
npm install
npm run dev
```

Apply through the companion CLI:

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
