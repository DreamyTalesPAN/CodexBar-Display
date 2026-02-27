# vibeblock Protocol v1

Transport is line-delimited JSON over USB CDC serial at `115200` baud.

Each frame must be a single JSON object followed by `\n`.

## Usage Frame

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
- `theme` (string, optional): requested UI theme (`classic` or `crt`).
- `error` (string, optional): if present, firmware should render error screen.

Theme registry source of truth:
- `protocol/theme_registry.json` (`id -> protocolName -> compileDefaultMacro`)

Golden frame fixtures:
- `protocol/fixtures/v1/companion_frame_golden.json`

## Error Frame

```json
{"v":1,"error":"codexbar unavailable"}
```

## Device Hello (Firmware -> Host)

On boot (or after serial reconnect), firmware may emit a capability line:

```json
{"kind":"hello","protocolVersion":1,"board":"esp8266-smalltv-st7789","firmware":"2026.02","features":["theme"],"maxFrameBytes":512}
```

Fields:
- `kind` (string): must be `hello`
- `protocolVersion` (number): protocol compatibility signal from firmware
- `board` (string): board identity for setup/runtime compatibility checks
- `firmware` (string): firmware version/build string
- `features` (array[string]): optional capabilities (for example `theme`)
- `maxFrameBytes` (number): maximum safe frame payload size for this firmware

Legacy firmware may emit plain readiness lines (`vibeblock_ready*`) instead of JSON hello.
Companion treats missing/legacy hello as unknown capabilities and falls back safely.

## Rules
- Unknown fields are ignored.
- Missing numeric fields default to `0` on firmware side.
- `theme` is optional and should only be sent when device `hello.features` includes `theme`.
- Unknown `theme` values should be ignored by firmware.
- Host should send at least every 60 seconds.
- Firmware ticks down `resetSecs` locally between host updates.
- Companion may resend the last known good frame during short CodexBar outages (current default max age: 10 minutes).

## Next
- Protocol v2 draft for rich rendering/media: `protocol/PROTOCOL_V2_DRAFT.md`
