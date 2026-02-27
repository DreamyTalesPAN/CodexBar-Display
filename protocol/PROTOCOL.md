# vibeblock Protocol v1

Transport is line-delimited JSON over USB CDC serial at `115200` baud.
Each frame must be a single JSON object followed by `\n`.

Status:
- Baseline v1 (`usage` + `theme` + error frames + device hello) is implemented.
- Rich-render fields below are the v1 ship target and remain optional until Milestone 8 is fully closed.

## Host -> Device Frame

Minimal usage frame:

```json
{"v":1,"provider":"claude","label":"Claude","session":73,"weekly":45,"resetSecs":8040}
```

Rich-render frame (optional extension):

```json
{
  "v": 1,
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
  "mediaLoop": "forever"
}
```

Fields:
- `v` (number, required): protocol version. V1 is `1`.
- `provider` (string, optional): provider machine key.
- `label` (string, optional): display label.
- `session` (number, optional): session usage percent `0..100`.
- `weekly` (number, optional): weekly usage percent `0..100`.
- `resetSecs` (number, optional): seconds remaining until reset.
- `theme` (string, optional): requested built-in UI theme (`classic` or `crt`).
- `error` (string, optional): if present, firmware should render error screen.
- `renderMode` (string, optional): `usage` (default) | `usage_with_shapes` | `usage_with_media` | `media_only`.
- `shapePreset` (string, optional): predefined ornament preset on firmware side.
- `mediaSlot` (string, optional): logical asset ID (for example `provider/claude`).
- `mediaFit` (string, optional): `contain` | `cover` | `stretch`.
- `mediaLoop` (string, optional): `once` | `forever` | `n:<count>`.

Theme registry source of truth:
- `protocol/theme_registry.json` (`id -> protocolName -> compileDefaultMacro`)
- `protocol/compatibility_matrix.json` (`companion <-> firmware` SemVer compatibility rules)

Golden frame fixtures:
- `protocol/fixtures/v1/companion_frame_golden.json`

## Error Frame

```json
{"v":1,"error":"runtime/codexbar-command"}
```

## Device Hello (Firmware -> Host)

On boot (or after serial reconnect), firmware may emit a capability line:

```json
{
  "kind": "hello",
  "protocolVersion": 1,
  "board": "esp8266-smalltv-st7789",
  "firmware": "1.0.0",
  "features": ["theme"],
  "codecs": ["gif"],
  "maxFrameBytes": 512,
  "maxAssetBytes": 524288
}
```

Fields:
- `kind` (string): must be `hello`.
- `protocolVersion` (number): protocol compatibility signal from firmware.
- `board` (string): board identity for setup/runtime compatibility checks.
- `firmware` (string): firmware SemVer (for example `1.0.0`).
- `features` (array[string], optional): capabilities (for example `theme`, `rich_rendering`, `media_layer`).
- `codecs` (array[string], optional): supported media codecs (`gif`, `jpg`).
- `maxFrameBytes` (number, optional): maximum safe frame payload size for this firmware.
- `maxAssetBytes` (number, optional): maximum safe single-asset size for this firmware.

Legacy firmware may emit plain readiness lines (`vibeblock_ready*`) instead of JSON hello.
Companion treats missing/legacy hello as unknown capabilities and falls back safely.

## Rules
- Unknown fields are ignored.
- Missing numeric fields default to `0` on firmware side.
- Host should prefer stable error codes in `error` (for example `runtime/*`, `protocol/*`) over free-form text.
- `theme` is optional and should only be sent when device `hello.features` includes `theme`.
- Unknown `theme` values should be ignored by firmware.
- Host should send render/media fields only when device capabilities explicitly support them.
- Unknown `renderMode` should degrade to `usage` (KISS fallback).
- In `usage_with_media`, media failure must degrade media layer only (usage stays visible).
- Host should send at least every 60 seconds.
- Firmware ticks down `resetSecs` locally between host updates.
- Companion may resend the last known good frame during short CodexBar outages (current default max age: 10 minutes).

## v1 Scope Boundary
- v1 ships built-in themes only (`classic`, `crt`).
- External theme SDK/runtime plugin loading is out of scope for v1.
