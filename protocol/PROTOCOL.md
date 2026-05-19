# codexbar-display Protocol (USB + WiFi: v1 + v2)

The payload protocol is line-delimited JSON. Each frame must be a single JSON object followed by `\n`.

Supported transports:
- USB CDC serial at `115200` baud for development/support.
- HTTP over device WiFi for the VibeTV runtime path.

Status:
- v1 usage/error/theme frames remain supported.
- v2 handshake negotiation and ThemeSpec v1 payload support are available on supported firmware.
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
- `themeSpec` (object, optional): inline ThemeSpec v1 payload (see schema below). Once a ThemeSpec is cached or activated from storage, later live frames may omit this field and only send usage data.
- `confirmClearThemeSpec` (boolean, optional): must be `true` when intentionally sending `themeSpec:null` to clear the active cached ThemeSpec.
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
- Primitives are declarative (`text`, `rect`, `progress`, `gif`, `sprite`, `pixels`) and validated by companion before send.
- Devices accept the readable ThemeSpec keys and a compact device form. Theme Studio keeps the readable editor model, but sends compact keys such as `v/id/rev/p`, primitive `t/w/h/v/b/s/c/bg/bc/a/d`, and type aliases `tx/r/p/g/sp/px`.
- Optional top-level `bgColor` fills the whole 240x240 screen before primitives are drawn.
- Text primitives use the single firmware-loaded TFT GLCD font; scale with `fontSize`.
- Text primitive `bgColor` is optional; when omitted, text is drawn transparent over the theme background.
- `gif` and `sprite` primitives reference uploaded display assets with `assetPath` under `/themes/...`; ESP8266 LittleFS paths are capped at 31 characters.
- Animated state assets use `stateAssets` (compact key `sa`) with `idle` and `coding` states. The renderer selects `coding` for coding activity and otherwise falls back to `idle`, then `assetPath`.
- `sprite` primitives reference uploaded `CBI1` static sprites or `CBA1` animated sprites under `/themes/...`. `CBA1` stores `width height frameCount fps`, one shared palette of up to 26 colors, then RLE rows for each frame. The browser should convert source sprite sheets into this format before upload. Animated sprites may set `bgColor`/`bg` as the local clear color used between frames.
- `pixels` primitives support the existing transparent 1-bit row-major bitmap in hex `data`; set bits are drawn with `color`.
- `pixels` primitives may also use multicolor RLE with palette `p` and rows `r`, for example `{"type":"pixels","width":16,"height":1,"p":["#FF0000"],"r":["5.4a7."]}`. `.` is transparent, `a` maps to `p[0]`, `b` maps to `p[1]`, and an optional decimal run length before the token repeats it. Every expanded row must equal `width`, and row count must equal `height`.
- Compatibility is checked against device capability limits (`maxThemeSpecBytes` for inline frames, `maxStoredThemeSpecBytes` for stored WiFi themes, `maxThemePrimitives`, `builtinThemes`).
- ESP8266 firmware advertises a 4096-byte stored ThemeSpec limit, but JSON parsing also consumes RAM. Theme authors should prefer small specs plus external `CBI1`/`CBA1` visual assets for detailed scenes instead of pushing a ThemeSpec close to the byte ceiling.
- Hosts should budget animated repaint separately from stored bytes. Static background sprites are safe when drawn once, but repeated animation ticks should redraw only animated GIF/`CBA1` regions and should stay within a conservative per-second pixel budget for ESP8266.
- A frame with `"themeSpec": null` clears the cached declarative layout only when the same frame also sets `"confirmClearThemeSpec": true`; unconfirmed null values are ignored so live theme state is not accidentally removed.

## Error Frame

```json
{"v":1,"error":"runtime/codexbar-command"}
```

## HTTP Runtime API

When the ESP8266 is connected to WiFi, it serves:

- `GET /hello`: returns the same Device Hello JSON shape as USB Serial. For WiFi, `capabilities.transport.active` is `wifi` and `supported` includes both `usb` and `wifi`.
- `GET /health`: returns current WiFi/filesystem/display diagnostics plus `system.freeHeap`, `system.resetReason`, and ThemeSpec render status fields (`renderOk`, `renderError`, `renderFailures`), which help detect watchdog resets or render failures after heavy themes.
- `POST /frame`: accepts one newline-delimited JSON frame as the request body and feeds it into the same firmware parser used by USB Serial.
- Frame payloads may include a local `update` object (`available`, `latestVersion`, `status`, `lastError`). This updates the cached display/diagnostic update state and, when `available=true`, renders a firmware-level notice above the active theme that alternates every 1.5 seconds between `Update Available:` and `vibetv.local`. The ESP8266 firmware must not fetch public HTTPS manifests directly.
- `POST /reset-wifi`: clears saved WiFi credentials and restarts the device into setup mode.
- `GET /assets`: returns mounted filesystem status and a generic list of stored asset paths/sizes.
- `POST /assets?path=/themes/<short-id>/<asset>`: uploads one theme asset using multipart field `asset`.
- `DELETE /assets?path=/themes/<short-id>/<asset>`: deletes one stored asset. Firmware rejects deletion of the currently active stored ThemeSpec.
- `POST /theme/active`: activates a stored ThemeSpec JSON file uploaded via `/assets`. Body: `{"path":"/themes/u/<short-id>.json"}`. This loads the spec into the firmware cache, so future `/frame` requests can stay small and only include live usage values. The response and `/health` diagnostics include a content `hash` for firmware that supports stored-theme verification.

Installable customer themes use VibeTV Theme Packs: a directory or `.zip` with `manifest.json`, one ThemeSpec JSON file, and optional asset files. See `docs/theme-packs.md`.

HTTP responses:
- `200 OK`: frame accepted.
- `400 Bad Request`: empty body or invalid request shape.
- `404 Not Found`: stored theme file does not exist.
- `413 Payload Too Large`: body exceeds `maxFrameBytes`.

Example:

```bash
curl http://192.168.178.123/hello
curl -X POST -F asset=@theme.json 'http://192.168.178.123/assets?path=/themes/u/cozy-1-a1b2c3.json'
curl -X POST -H 'Content-Type: text/plain' --data '{"path":"/themes/u/cozy-1-a1b2c3.json"}' \
  http://192.168.178.123/theme/active
printf '{"v":2,"provider":"codex","label":"Codex","session":17,"weekly":42,"resetSecs":15480}\n' \
  | curl -X POST --data-binary @- http://192.168.178.123/frame
```

## Device Hello (Firmware -> Host)

On boot or after serial reconnect, firmware emits a capability line over USB. `GET /hello` returns the equivalent JSON over WiFi:

```json
{
  "kind": "hello",
  "protocolVersion": 2,
  "supportedProtocolVersions": [2, 1],
  "preferredProtocolVersion": 2,
  "board": "esp8266-smalltv-st7789",
  "firmware": "1.0.0",
  "features": ["theme", "theme-spec-v1"],
  "maxFrameBytes": 2048,
  "capabilities": {
    "display": {"widthPx": 240, "heightPx": 240, "colorDepthBits": 16},
    "theme": {
      "supportsThemeSpecV1": true,
      "maxThemeSpecBytes": 2048,
      "maxThemePrimitives": 32,
      "supportsStoredThemes": true,
      "maxStoredThemeSpecBytes": 4096,
      "builtinThemes": ["classic", "crt", "mini"]
    },
    "transport": {"active": "wifi", "supported": ["usb", "wifi"]}
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
- WiFi Companion usage: `codexbar-display daemon --transport wifi --target http://<device-ip>`.
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
