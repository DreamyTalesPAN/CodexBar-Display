# vibeblock Protocol v2 (Draft)

Status: Draft  
Date: 2026-02-26

## Goal

V2 extends the existing usage protocol with controlled rendering features
(shapes, local GIF/JPG assets) without changing the core principles:

- CodexBar usage remains the source of truth.
- Companion remains "smart".
- Firmware remains renderer- and protocol-only.
- Runtime frames stay compact and robust over USB serial.

## Principles

1. `Usage first`: provider/session/weekly/reset remain the required core.
2. `Control plane, not pixel stream`: runtime sends control data, not image frames.
3. `Local assets`: GIF/JPG files live on-device (LittleFS), referenced by slot ID.
4. `Graceful fallback`: unknown/invalid render fields fall back to the V1 usage screen.
5. `Backward compatibility`: V1 firmware ignores new fields.

## V2 Frame (Host -> Device)

V2 keeps all V1 fields and adds optional render fields.

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

### New Fields (optional)

- `renderMode`:
  - `usage` (default)
  - `usage_with_shapes`
  - `usage_with_media`
  - `media_only`
- `shapePreset`: predefined shape/ornament preset on firmware side
- `mediaSlot`: logical asset ID (`provider/claude`, `weather/rain_01`, ...)
- `mediaFit`: `contain` | `cover` | `stretch`
- `mediaLoop`: `once` | `forever` | `n:<count>`

## Not Part of the Runtime Frame

Asset transfer (GIF/JPG upload) does not run inside the daemon 60s loop.
It runs through dedicated setup/media tooling:

- `vibeblock media sync` (new companion command)
- writes files + manifest to device LittleFS
- runtime frames reference only `mediaSlot`

## Asset Manifest (Device)

Example `/.sys/assets.json`:

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

Render order per frame:

1. Base usage layer (V1 UI)
2. Shape preset layer (optional)
3. Media layer (optional, region-bounded)
4. Error override (if `error` is set)

## Safety Limits

- Max asset size per file (for example 512 KB ESP8266 / 2 MB ESP32-S3)
- Max concurrent decoders (1)
- Timeout/abort for broken GIFs
- On decode errors: disable slot, continue rendering usage UI

## Rollout Plan

1. Parse-only:
   - Accept V2 fields in companion struct and firmware parser.
   - No new render behavior yet.
2. Shapes:
   - Implement `shapePreset` (without assets).
3. Media:
   - LittleFS + manifest + `mediaSlot` + GIF/JPG decode.
4. Tooling:
   - `vibeblock media sync`, `media ls`, `media verify`.
5. Hardening:
   - soak tests, corrupted assets, reconnect/sleep-wake tests.

## Open Questions

1. MCU scope: V2 media for ESP8266 too, or ESP32-S3 only?
2. Decoder rollout: GIF-only first, or GIF+JPG together?
3. Strict mode: should `v=2` with unknown `renderMode` fail hard, or fall back to `usage`?
