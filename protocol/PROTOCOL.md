# codexbar-display Protocol (USB-first transition: v1 + v2)

Transport is line-delimited JSON over USB CDC serial at `115200` baud.
Each frame must be a single JSON object followed by `\n`.

Status:
- v1 usage/error/theme frames remain supported.
- USB-first transition adds v2 handshake negotiation and ThemeSpec v1 payload support.
- Negotiation prefers v2 and falls back to v1.

## Host -> Device Frame

Usage frame (v1 or v2, negotiated):

```json
{"v":2,"provider":"claude","label":"Claude","session":73,"weekly":45,"resetSecs":8040}
```

Fields:
- `v` (number, required): negotiated protocol version (`1` or `2`).
- `provider` (string, optional): provider machine key.
- `label` (string, optional): display label.
- `session` (number, optional): session usage percent `0..100`.
- `weekly` (number, optional): weekly usage percent `0..100`.
- `resetSecs` (number, optional): seconds remaining until reset.
- `usageMode` (string, optional): semantic of `session`/`weekly` (`used` or `remaining`).
- `sessionTokens` (number, optional): absolute token total for the current provider session/window when available.
- `weekTokens` (number, optional): rolling 7-day token total when available.
- `totalTokens` (number, optional): lifetime token total when available.
- `theme` (string, optional): requested built-in UI theme (`classic`, `crt`, `mini`).
- `themeSpec` (object, optional): ThemeSpec v1 payload (see schema below).
- `error` (string, optional): if present, firmware should render error screen.

Example with additive token stats + theme:

```json
{"v":2,"provider":"codex","label":"Codex","session":17,"weekly":42,"resetSecs":15480,"sessionTokens":1437166,"weekTokens":384312010,"totalTokens":1078397605,"theme":"mini"}
```

Theme registry source of truth:
- `protocol/theme_registry.json` (`id -> protocolName -> compileDefaultMacro`)
- `protocol/compatibility_matrix.json` (companion <-> firmware SemVer compatibility rules + default env -> firmware version mapping)

Golden frame fixtures:
- `protocol/fixtures/v1/companion_frame_golden.json`

## ThemeSpec v1 (declarative)

Schema:
- `protocol/theme_spec_v1.schema.json`

Example:
- `protocol/fixtures/v2/theme_spec_mini_transport.json`

Design constraints:
- No user code execution on device.
- Primitives are declarative (`text`, `rect`, `progress`) and validated by companion before send.
- Compatibility is checked against device capability limits (`maxThemeSpecBytes`, `maxThemePrimitives`, `builtinThemes`).

## Error Frame

```json
{"v":1,"error":"runtime/codexbar-command"}
```

## Device Hello (Firmware -> Host)

On boot (or after serial reconnect), firmware emits a capability line:

```json
{
  "kind": "hello",
  "protocolVersion": 2,
  "supportedProtocolVersions": [2, 1],
  "preferredProtocolVersion": 2,
  "board": "esp8266-smalltv-st7789",
  "firmware": "1.0.0",
  "features": ["theme", "theme-spec-v1"],
  "maxFrameBytes": 1024,
  "capabilities": {
    "display": {"widthPx": 240, "heightPx": 240, "colorDepthBits": 16},
    "theme": {
      "supportsThemeSpecV1": true,
      "maxThemeSpecBytes": 1024,
      "maxThemePrimitives": 32,
      "builtinThemes": ["classic", "crt", "mini"]
    },
    "transport": {"active": "usb", "supported": ["usb"]}
  }
}
```

Fields:
- `protocolVersion` (number): legacy single-value signal.
- `supportedProtocolVersions` (array[number]): negotiated protocol candidates.
- `preferredProtocolVersion` (number): firmware preference.
- `features` (array[string], optional): capabilities (for example `theme`, `theme-spec-v1`).
- `capabilities` (object, optional): extended block for display/theme/transport limits.

Firmware may emit plain readiness lines (`codexbar_display_ready*`) instead of JSON hello.
Companion treats missing hello as unknown capabilities.

## Negotiation Rule

Companion host support set: `[2, 1]`.

Algorithm:
1. Build device support set from `supportedProtocolVersions`, else legacy `protocolVersion`.
2. Pick highest host-preferred version in intersection.
3. If no intersection exists, fallback to `v1`.

Result:
- v2 preferred whenever both sides advertise support.
- v1 fallback remains available for older firmware/hello shapes.

## Rules
- Unknown fields are ignored.
- Missing numeric fields default to `0` on firmware side.
- Host should prefer stable error codes in `error` (for example `runtime/*`, `protocol/*`) over free-form text.
- `theme` is optional.
- Token stats are optional and additive; existing percentage/quota rendering remains valid when they are absent.
- If device capabilities are explicitly known and `theme` is unsupported, host must omit `theme`.
- If hello is missing (unknown capabilities), host may send `theme` on MVP USB path and rely on device-side ignore/fallback behavior.
- Unknown `theme` values should be ignored by firmware.
- Host should send at least every 60 seconds.
- Firmware ticks down `resetSecs` locally between host updates.
- Companion may resend the last known good frame during short CodexBar outages (current default max age: 10 minutes).
- If frame payload exceeds `maxFrameBytes`, companion drops `theme` first, then token stats, before falling back to an error frame.

## Local USB ThemeSpec Flow

Companion CLI supports local-only USB flow (no cloud upload):

```bash
cd companion
../codexbar-display theme-validate --spec ../protocol/fixtures/v2/theme_spec_mini_transport.json
../codexbar-display theme-apply --spec ../protocol/fixtures/v2/theme_spec_mini_transport.json
```

If a board does not emit hello during validation windows, use fallback mode:

```bash
../codexbar-display theme-validate --allow-unknown-capabilities --spec ../protocol/fixtures/v2/theme_spec_mini_transport.json
../codexbar-display theme-apply --allow-unknown-capabilities --spec ../protocol/fixtures/v2/theme_spec_mini_transport.json
```

`theme-validate`:
- validates ThemeSpec schema/fields.
- resolves USB device + reads hello capability block.
- rejects incompatible specs with clear protocol error codes.

`theme-apply`:
- performs full validation.
- sends negotiated `v` frame with `themeSpec` payload over USB.

## v1 Scope Boundary (still valid)
- v1 ships built-in themes (`classic`, `crt`, `mini`).
- release-gated MVP hardware target remains ESP8266 SmallTV ST7789 (`esp8266_smalltv_st7789`).
- ESP32 (`lilygo_t_display_s3`) remains experimental/non-blocking.
