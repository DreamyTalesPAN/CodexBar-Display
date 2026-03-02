# vibeblock Protocol v1

Transport is line-delimited JSON over USB CDC serial at `115200` baud.
Each frame must be a single JSON object followed by `\n`.

Status:
- Baseline v1 (`usage` + `theme` + error frames + device hello) is implemented and is the active ship scope.

## Host -> Device Frame

Usage frame:

```json
{"v":1,"provider":"claude","label":"Claude","session":73,"weekly":45,"resetSecs":8040}
```

Fields:
- `v` (number, required): protocol version. V1 is `1`.
- `provider` (string, optional): provider machine key.
- `label` (string, optional): display label.
- `session` (number, optional): session usage percent `0..100`.
- `weekly` (number, optional): weekly usage percent `0..100`.
- `resetSecs` (number, optional): seconds remaining until reset.
- `theme` (string, optional): requested built-in UI theme (`classic`, `crt`, `mini`).
- `error` (string, optional): if present, firmware should render error screen.

Theme registry source of truth:
- `protocol/theme_registry.json` (`id -> protocolName -> compileDefaultMacro`)
- `protocol/compatibility_matrix.json` (`companion <-> firmware` SemVer compatibility rules + default env -> firmware version mapping)

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
  "maxFrameBytes": 512
}
```

Fields:
- `kind` (string): must be `hello`.
- `protocolVersion` (number): protocol compatibility signal from firmware.
- `board` (string): board identity for setup/runtime compatibility checks.
- `firmware` (string): firmware SemVer (for example `1.0.0`).
- `features` (array[string], optional): capabilities (for example `theme`).
- `maxFrameBytes` (number, optional): maximum safe frame payload size for this firmware.

Legacy firmware may emit plain readiness lines (`vibeblock_ready*`) instead of JSON hello.
Companion treats missing/legacy hello as unknown capabilities.
For v1 MVP operations, host continues usage/error frames and may use optimistic `theme`
send when hello is unavailable; if capabilities are explicitly known and do not include
`theme`, host must omit `theme`.

## Rules
- Unknown fields are ignored.
- Missing numeric fields default to `0` on firmware side.
- Host should prefer stable error codes in `error` (for example `runtime/*`, `protocol/*`) over free-form text.
- `theme` is optional.
- If device capabilities are explicitly known and `theme` is unsupported, host must omit `theme`.
- If hello is missing/legacy (unknown capabilities), host may send `theme` on the MVP path and rely on device-side ignore/fallback behavior.
- Unknown `theme` values should be ignored by firmware.
- Host should send at least every 60 seconds.
- Firmware ticks down `resetSecs` locally between host updates.
- Companion may resend the last known good frame during short CodexBar outages (current default max age: 10 minutes).

## v1 Scope Boundary
- v1 ships built-in themes only (`classic`, `crt`, `mini`).
- v1 release-gated MVP hardware target is ESP8266 SmallTV ST7789 (`esp8266_smalltv_st7789`).
- ESP32 (`lilygo_t_display_s3`) is kept as experimental/non-blocking for v1.
- External theme SDK/runtime plugin loading is out of scope for v1.
