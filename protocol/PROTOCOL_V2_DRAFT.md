# vibeblock Protocol v2 (Draft)

Status: Draft  
Date: 2026-02-26

## Ziel

V2 erweitert das bestehende Usage-Protokoll um kontrollierte Render-Features
(Formen, lokale GIF/JPG-Assets), ohne den Kern zu aendern:

- CodexBar-Usage bleibt die Wahrheit.
- Companion bleibt "smart".
- Firmware bleibt render- und protocol-only.
- Runtime-Frames bleiben klein und robust ueber USB serial.

## Prinzipien

1. `Usage first`: Provider/Session/Weekly/Reset bleiben Pflichtkern.
2. `Control plane, not pixel stream`: Runtime sendet Steuerdaten, keine Bildframes.
3. `Local assets`: GIF/JPG liegen auf dem Device (LittleFS), referenziert per Slot-ID.
4. `Graceful fallback`: Unbekannte/ungueltige Render-Felder fallen auf V1-Usage-Screen zurueck.
5. `Backward compatibility`: V1-Firmware ignoriert neue Felder.

## V2 Frame (Host -> Device)

V2 behaelt alle V1-Felder bei und fuegt optionale Render-Felder hinzu.

```json
{
  "v": 2,
  "provider": "claude",
  "label": "Claude",
  "session": 73,
  "weekly": 45,
  "resetSecs": 8040,
  "theme": "crt",
  "renderMode": "usage_with_media",
  "shapePreset": "crt_grid",
  "mediaSlot": "provider/claude",
  "mediaFit": "contain",
  "mediaLoop": "forever",
  "error": ""
}
```

### Neue Felder (optional)

- `renderMode`:
  - `usage` (default)
  - `usage_with_shapes`
  - `usage_with_media`
  - `media_only`
- `shapePreset`: vordefinierte Formen/Ornamente auf Firmware-Seite
- `mediaSlot`: logische Asset-ID (`provider/claude`, `weather/rain_01`, ...)
- `mediaFit`: `contain` | `cover` | `stretch`
- `mediaLoop`: `once` | `forever` | `n:<count>`

## Nicht Teil des Runtime-Frames

Asset-Transfer (GIF/JPG Upload) laeuft nicht im Daemon-60s-Loop, sondern separat
ueber Setup/Media-Tools:

- `vibeblock media sync` (neu, Companion command)
- schreibt Dateien + Manifest auf Device-LittleFS
- Runtime-Frames referenzieren nur `mediaSlot`

## Asset Manifest (Device)

Beispiel `/.sys/assets.json`:

```json
{
  "revision": "2026-02-26.1",
  "slots": [
    {
      "slot": "provider/claude",
      "path": "/media/provider_claude.gif",
      "mime": "image/gif",
      "sha256": "..."
    }
  ]
}
```

## Firmware Render Pipeline (V2)

Reihenfolge pro Frame:

1. Base usage layer (V1-UI)
2. Shape preset layer (optional)
3. Media layer (optional, region-bounded)
4. Error override (falls `error` gesetzt)

## Safety Limits

- Max Assetgroesse pro Datei (z. B. 512 KB ESP8266 / 2 MB ESP32-S3)
- Max gleichzeitige Decoder (1)
- Timeout/abort fuer defekte GIFs
- Bei Decode-Fehler: Slot deaktivieren, Usage-UI weiter rendern

## Rollout-Plan

1. Parse-only:
   - V2-Felder im Companion-Struct und Firmware-Parser akzeptieren.
   - Noch keine neue Renderlogik.
2. Shapes:
   - `shapePreset` implementieren (ohne Assets).
3. Media:
   - LittleFS + Manifest + `mediaSlot` + GIF/JPG decode.
4. Tooling:
   - `vibeblock media sync`, `media ls`, `media verify`.
5. Hardening:
   - soak tests, corrupted assets, reconnect/sleep-wake Tests.

## Offene Fragen

1. MCU scope: V2 Media auch fuer ESP8266 oder nur ESP32-S3?
2. Decoder-Auswahl: GIF-only zuerst oder GIF+JPG gleichzeitig?
3. Strict mode: Soll `v=2` ohne bekannte `renderMode` hart fehlschlagen oder auf `usage` fallen?
