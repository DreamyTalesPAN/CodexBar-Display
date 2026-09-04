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
- `resetSecs` (number, optional): seconds remaining until reset, valid at the instant the frame is sent (see Reset Freshness and Trust).
- `resetAgeSecs` (number, optional): how old the underlying usage data already was when the frame was sent.
- `resetTrustSecs` (number, optional): remaining trust budget for the deadline at the instant the frame is sent.
- `resetSource` (string, optional): identity of the provider plus usage window the deadline came from, for example `codex:primary`.
- `resetTrust` (string, optional): host assessment of the deadline (`live`, `offline`, `stale`).
- `usageUnavailable` (boolean, optional): both current quota values are not trustworthy; missing/false remains backward compatible. ThemeSpec text bindings show unknown values while progress keeps the numeric carrier values.
- `sessionUnavailable` / `weeklyUnavailable` (boolean, optional): only that legacy usage lane is unknown. Missing/false remains backward compatible. Its text binding shows `??` and its progress primitive is omitted. `usageUnavailable:true` still overrides both lanes, including stale frames.
- `usageMode` (string, optional): semantic of `session`/`weekly` and `usageWindows[].percent` (`used` or `remaining`).
- `usageWindows` (array, optional, v2): generic ordered provider usage windows. Each emitted window carries `id` (max 32 UTF-8 bytes), `label` (max 24 UTF-8 bytes), `percent`, and its own `resetSecs`. Presence means availability; missing or unavailable source windows are omitted rather than coerced to `0`/`100`. Legacy `session`, `weekly`, and shared `resetSecs` remain compatibility aliases for windows 1, 2, and window 1's reset.
- `usageSlots` (array, optional, legacy): compatibility input/output for v1-era two-slot readers. The Companion normalizes slots into `usageWindows` when no windows are present; normalized v2 frames omit `usageSlots`.
- `sessionTokens` (number, optional): absolute token total for the current provider session/window when available.
- `weekTokens` (number, optional): rolling 7-day token total when available.
- `totalTokens` (number, optional): lifetime token total when available.
- `time` (string, optional): pre-formatted local time `HH:MM`. **Fallback only.** The device runs its own SNTP clock and uses it for the `time`/`tm` binding; this string is used only while the device clock is not established, and only while it is still current (max age 2 minutes).
- `date` (string, optional): pre-formatted local date `DD.MM.YYYY`. Same fallback rules as `time`.
- `clockSchedule` (object, optional): the Companion's validated current UTC offset and, when they exist, the next two offset transitions. `currentOffsetMinutes` is the current quarter-hour offset; `transitionEpoch`/`offsetMinutes` are the first upcoming transition and its resulting offset; `followingTransitionEpoch`/`followingOffsetMinutes` are the immediately following pair. The firmware stores both 10-byte transition records and applies them in order against its own SNTP epoch. The device has no timezone database, POSIX TZ string, libc timezone function, or rule parser.
- `theme` (string, optional): requested built-in UI theme (`classic`, `crt`, `mini`).
- `themeSpec` (object, optional): inline ThemeSpec v1 payload (see schema below). Once a ThemeSpec is cached or activated from storage, later live frames may omit this field and only send usage data.
- `confirmClearThemeSpec` (boolean, optional): must be `true` when intentionally sending `themeSpec:null` to clear the active cached ThemeSpec.
- `error` (string, optional): if present, firmware should render error screen.

Example with additive token stats + theme:

```json
{"v":2,"provider":"codex","label":"Codex","session":42,"weekly":7,"resetSecs":15480,"usageWindows":[{"id":"secondary","label":"Weekly","percent":42,"resetSecs":15480},{"id":"codex-spark-weekly","label":"Codex Spark Weekly","percent":7,"resetSecs":604800}],"sessionTokens":1437166,"weekTokens":384312010,"totalTokens":1078397605,"theme":"mini"}
```

Theme registry source of truth:
- `protocol/theme_registry.json` (`id -> protocolName -> compileDefaultMacro`)
- `protocol/compatibility_matrix.json` (companion <-> firmware SemVer compatibility rules + default env -> firmware version mapping)

Golden frame fixtures:
- `protocol/fixtures/v1/companion_frame_golden.json`
- `protocol/fixtures/v2/reset_trust_golden.json`

## Reset Freshness and Trust

```json
{"v":2,"provider":"claude","label":"Claude","session":73,"weekly":45,"resetSecs":8028,"resetAgeSecs":12,"resetTrustSecs":17988,"resetSource":"claude:primary","resetTrust":"live"}
```

Reset values are not absolute timestamps: every reset value is a seconds count
that is valid at the instant the frame arrives.
The device only has to tick those counters down with its own monotonic clock:

- `resetSecs` is the deadline, re-anchored to the send instant. Reaching `0`
  means the reset time has passed.
- `resetTrustSecs` is how much longer the deadline may be counted down before the
  basis is too old to be trusted. It starts at the trust horizon (5 hours) minus
  `resetAgeSecs`. Reaching `0` means `stale`, no matter how long the device was
  without updates or how often it rebooted in between.
- `resetAgeSecs` is how old the basis already was when the frame was sent. It is
  the wall-clock-free form of "collected at": the device adds its own elapsed
  time since the frame arrived to get the current age.
- `resetSource` is the identity of the countdown (`provider` or
  `provider:window`). A changed value is a different countdown.

Trust states:

| State | Meaning | Rendering |
|---|---|---|
| `live` | Deadline from current usage data. | `4h 12m` |
| `offline` | Usage source is not reachable, deadline still inside its trust budget. | `4h 12m` plus a discreet offline hint |
| `stale` | Expired, unknown, unattributable, or beyond the trust budget. | `—` |

Transitions:

- `live -> offline`: the host resends the last known good frame because the usage
  source is unavailable, or the device stops receiving frames at all.
- `offline -> live`: a frame with `resetTrust:"live"` arrives. Fresh data always
  replaces the offline state; no restart or re-pairing is involved.
- `live|offline -> stale`: `resetSecs` reaches `0`, `resetTrustSecs` reaches `0`,
  `resetSource` changes, or the deadline can no longer be attributed.
- `stale -> live`: only a frame with `resetTrust:"live"` leaves `stale`. Passing
  the stored deadline never starts a new cycle locally.

Rules:

- The host value is the best case. The device re-evaluates trust locally and may
  only downgrade it, never upgrade it.
- The host never sends a deadline it does not trust: a `stale` frame carries
  `resetSecs:0` and `resetTrustSecs:0`.
- A deadline is never inherited across a `resetSource` change. On any change the
  device drops the previous deadline instead of continuing it.
- A frame that carries no reset fields at all (for example a ThemeSpec-only apply
  frame) does not change the current trust state.
- A frame with `resetSecs` but without `resetTrust` comes from a Companion that
  predates this contract. Firmware keeps its legacy local countdown for those
  frames; a missing or zero `resetTrustSecs` only means `stale` when `resetTrust`
  is present.
- The trust fields are never dropped to fit `maxFrameBytes`. Theme, token stats,
  and clock strings are dropped first.
- All fields are additive. Firmware that does not know them keeps working
  unchanged and simply ticks `resetSecs` down as before.

### Firmware enforcement

Enforced in `firmware_shared/codexbar_display_core.h`. Every rendering path
reads the countdown through `CurrentRemainingSecs`, which returns `0` for a
stale basis, and the ThemeSpec renderer turns `0` into `Reset unavailable`. A
theme cannot bind its way around this.

- The device does not parse `resetAgeSecs`. The age is exactly
  `kResetTrustHorizonSecs - resetTrustSecs`, so it derives it from the budget.
- A `live` frame whose derived basis age exceeds 150 seconds is shown as
  `offline`. The host is required to send at least every 60 seconds, so this
  covers two missed sends before the device stops calling the value current.
- An `offline` frame for the same `resetSource` may not hand back more deadline
  or more budget than the device is still counting down. Only a `live` frame
  refreshes the basis. This is the downgrade-only rule applied to resends.
- A deadline without a `resetSource` is unattributable and therefore stale.
- Reaching the stored deadline clamps at `0` and stays there. No new cycle is
  ever derived locally.

Restart handover, `/rt` on LittleFS, format `1 <deadlineSecs> <trustSecs>
<resetSource>`:

- Written only in the moment the firmware decides to restart, and consumed and
  deleted once on the next boot. Two writes per deliberate restart, none per
  frame, so a ticking countdown never touches flash.
- Honoured only after `REASON_SOFT_RESTART`. The device has no wall clock, so
  after a power cut or an exception it cannot know how long it was down and
  drops the record instead of guessing.
- A fixed 30 second restart cost is charged to both counters, so the handover
  can only ever under-report the remaining time.
- Only an enforced basis is persisted. A legacy countdown carries no budget and
  must not come back as an unbounded one.
- A restored basis is never `live`: no frame has arrived yet.

## ThemeSpec v1 (declarative)

Schema:
- `protocol/theme_spec_v1.schema.json`

Example:
- `protocol/fixtures/v2/theme_spec_mini_transport.json`

Design constraints:
- No user code execution on device.
- Primitives are declarative (`text`, `rect`, `progress`, `gif`, `sprite`, `pixels`) and validated by companion before send.
- Devices accept the readable ThemeSpec keys and a compact device form. Theme Studio keeps the readable editor model, but sends compact keys such as `v/id/rev/p`, primitive `t/w/h/v/b/s/ft/al/va/c/bg/bc/br/a/d`, and type aliases `tx/r/p/g/sp/px`. `br` is the optional 0-120 pixel border radius for rectangle and progress primitives. `va` is optional vertical text align (`middle`/`center`/`bottom`).
- A primitive may declare usage-lane ownership with `slot: 1|2` (compact `sl`). The renderer skips the entire primitive when that slot is absent, including static decoration and progress tracks. Themes that use slot bindings or ownership require the advertised `usage-slots-v1` capability.
- Optional top-level `bgColor` fills the whole 240x240 screen before primitives are drawn.
- Text primitives scale with `fontSize`. When `fit` is `shrink` (compact `ft`), the renderer treats that size as the maximum and chooses the largest supported integer size that fits `maxWidth`/`width`.
- Text primitive `align` (compact `al`) is horizontal: `center` / `right`; omit is left. `valign` (compact `va`) is vertical and separate: `middle` / `center` (same meaning), `bottom`; omit is top. After shrink chooses a size, firmware offsets `y` using the visual glyph height (`tft.fontHeight()`), not the `fontHeight + 4` clip pad. The vertical box is explicit `h` / `height` when set; otherwise it is `ApproxTextHeight` of the pre-shrink `fontSize` so shrink still sits in the original lane. `y` is the top of that box. Clip height stays `fontHeight + 4` and moves with the glyphs.
- Text primitive `bgColor` is optional; when omitted, text is drawn transparent over the theme background.
- `gif` and `sprite` primitives reference uploaded display assets with `assetPath` under `/themes/...`; ESP8266 LittleFS paths are capped at 31 characters.
- Animated state assets use `stateAssets` (compact key `sa`) with `idle` and `coding` states. The renderer selects `coding` for coding activity and otherwise falls back to `idle`, then `assetPath`.
- Sprite primitives may also declare `providerAssets` (compact key `pa`) as a map from the lowercase wire `provider` key to an asset path. The renderer checks `pa[provider]` first, then `stateAssets`, then `assetPath`. Unknown providers fall back to `assetPath`; omit `assetPath` to hide the sprite when no `pa` entry matches.
- Progress primitives may declare `colorStops` (compact key `cs`) as up to four `{ "gte": N, "c": "#RRGGBB" }` entries. The renderer picks the first stop whose `gte` is `<=` the bound percent after sorting stops descending by `gte`. Missing `cs` keeps the solid `color`/`c` fill. Old firmware ignores `cs`.
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
- `GET /health`: returns current WiFi/filesystem/display diagnostics plus `system.freeHeap`, `system.bootId`, `system.uptimeMs`, `system.resetCount`, `system.resetReason`, and ThemeSpec render status fields (`renderOk`, `renderError`, `renderFailures`). A changed `bootId` proves a reboot; `uptimeMs` lets the Companion calculate the reset timestamp using the Mac clock. The `clock` object reports the device wall clock: `synced` (SNTP delivered a plausible epoch), `source` (`device`, `companion` or `unknown` — which source the rendered time actually came from), `epoch` (device UTC, `0` when unsynced), `utcOffsetMinutes` (learned local offset or `null`), `lastSyncAgeMs`, `syncCount`, and the resolved `time`/`date` texts. The `settings.standby` object reports the persisted standby configuration: `enabled`, `timeoutMinutes`, `brightnessPercent`, and `screensaverPath` (the selected slot reference, or `null` when nothing is selected). All of it survives a reboot. The top-level `standby` object reports live state instead of configuration: `active` (the screensaver is on screen right now) and `idleSecs` (seconds since the last frame that moved the usage numbers). Live state never appears in `/hello`, which is a boot snapshot.
- `POST /frame`: accepts one newline-delimited JSON frame as the request body and feeds it into the same firmware parser used by USB Serial.
- Frame payloads may include a local `update` object (`available`, `latestVersion`, `status`, `lastError`). This updates the cached display/diagnostic update state. On built-in themes, `available=true` renders a firmware-level notice that cycles through the provider, `Update available`, and `app.vibetv.shop`. ThemeSpec themes receive the same values through the existing `{label}` / `label` binding. The ESP8266 firmware must not fetch public HTTPS manifests directly.
- `POST /reset-wifi`: with the current pairing token, clears saved WiFi credentials and restarts the device into setup mode.
- `POST /api/pair`: creates or rotates the local LAN pairing token. Starting with firmware `1.0.39`, an explicit local-WiFi Connect may always replace the previous token; the most recently connected Mac wins. Firmware `1.0.38` retains its legacy 30-minute recovery window. Include `api=1` for a JSON response (`{"ok":true,"token":"..."}`).
- `POST /api/settings`: updates persisted device settings. Form field `b` sets display brightness percent. Standby fields: `sb` enables standby (`0`/`1`), `st` sets the inactivity timeout in minutes, `sbr` sets the brightness that applies only while the screensaver shows, and `ss` selects the screensaver slot by stored ThemeSpec path (empty clears it). Every field is optional and at least one must be present; out-of-range numbers are clamped rather than rejected, while an unusable `ss` path returns `400`. Include `api=1` for a JSON/CORS response; omit it for the built-in IP-based form redirect.
- `GET /assets`: returns mounted filesystem status and stored `/themes/` asset paths/sizes. Internal firmware control files are never listed.
- `POST /assets?path=/themes/<short-id>/<asset>`: uploads one theme asset using multipart field `asset`.
- `DELETE /assets?path=/themes/<short-id>/<asset>`: deletes one stored asset. Firmware rejects deletion of any ThemeSpec that currently owns the screen or holds the way back to it — the active stored ThemeSpec, the configured screensaver, and the saved live ThemeSpec while standby or a screensaver preview is up — and of every asset those specs reference. Rejections return `409`.
- `POST /theme/active`: activates a stored ThemeSpec JSON file uploaded via `/assets`. Body: `{"path":"/themes/u/<short-id>.json"}`. This loads the spec into the firmware cache, so future `/frame` requests can stay small and only include live usage values. The response and `/health` diagnostics include a content `hash` for firmware that supports stored-theme verification.
- `POST /screensaver/active`: selects which stored ThemeSpec the screensaver slot points at. Body: `{"path":"/themes/s/<short-id>.json"}`, or `{"path":""}` to clear the slot. The screensaver slot is independent of the live theme slot: this call never changes the live theme, and `/theme/active` never changes the screensaver. It records the selection only — it does not render and does not enter standby. Returns `404` when the file does not exist and `400` for a path outside `/themes/s/`.

Standby behavior:
- Standby starts when no frame reporting **`activity:"coding"`** has arrived for `settings.standby.timeoutMinutes`. One firmware timer covers both "the Mac is off" (no frames at all) and "the Mac is on but nobody is coding" (frames arrive reporting `idle`). A frame that reports any other activity value, or an error frame, is not activity. The firmware takes the frame's verdict at its word instead of inferring one from usage numbers: percentages are whole numbers, so a customer working against a weekly quota can code for a long time before any value moves, and inferring would keep the screensaver up while they type. The Companion owns the decision, including its hold and idle-evidence rules.
- Frames that omit `activity` entirely are still resolved by the firmware's existing fallback, which fills in `coding` on forward usage progress and `idle` otherwise. Token totals never make that fallback report `coding`, because history scans can move them without any provider consumption.
- The first frame that reports `coding` ends standby on the next firmware loop.
- Both directions load the ThemeSpec from LittleFS; there is no second resident slot. The live theme choice is untouched — no flash write happens on a transition, and a reboot in standby comes back on the live theme.
- `settings.standby.brightnessPercent` applies on entry, and `settings.display.brightnessPercent` is restored on wake.
- An empty screensaver slot, a disabled setting, WiFi setup, a status screen, an error frame, or a screensaver file that no longer loads all leave the live theme on screen.
- `POST /theme/active` during standby ends standby and keeps the newly chosen live theme.

Pairing/auth:
- Firmware `1.0.39` accepts every local-WiFi `/api/pair` request and immediately replaces the previous token. It has no physical pairing gesture or pairing window.
- Firmware `1.0.38` remains compatible with its legacy first-pair and three-power-cycle 30-minute recovery window.
- Protected write APIs require `X-VibeTV-Token: <token>` or the documented query fallback used by native tooling and raw OTA.
- Protected write APIs include `POST /frame`, `POST /api/settings`, WiFi credential writes, `POST /assets`, `DELETE /assets`, `POST /theme/active`, `POST /screensaver/active`, and firmware/filesystem OTA upload paths. OTA upload always requires a configured device and its current token.
- Read APIs such as `GET /hello`, `GET /health`, and `GET /assets` stay open for diagnostics.
- The unauthenticated device page never renders the pairing token. Firmware `1.0.39` WiFi `/hello` reports `capabilities.auth.paired` and `tokenHeader`; legacy firmware may additionally report pairing-window fields. No firmware reports the token value.
- Fresh setup and automatic WiFi fallback use the same open, writable setup portal. Saving WiFi preserves device authentication, themes, and settings.

Installable customer themes use VibeTV Theme Packs: a directory or `.zip` with `manifest.json`, one ThemeSpec JSON file, and optional asset files. See `docs/theme-packs.md`.

HTTP responses:
- `200 OK`: frame accepted.
- `400 Bad Request`: empty body or invalid request shape.
- `404 Not Found`: stored theme file does not exist.
- `413 Payload Too Large`: body exceeds `maxFrameBytes`.

Example:

```bash
curl http://192.168.178.123/hello
TOKEN="$(curl -fsS -X POST -d api=1 http://192.168.178.123/api/pair | jq -r .token)"
curl -X POST -H "X-VibeTV-Token: $TOKEN" -F asset=@theme.json 'http://192.168.178.123/assets?path=/themes/u/cozy-1-a1b2c3.json'
curl -X POST -H "X-VibeTV-Token: $TOKEN" -H 'Content-Type: text/plain' --data '{"path":"/themes/u/cozy-1-a1b2c3.json"}' \
  http://192.168.178.123/theme/active
printf '{"v":2,"provider":"codex","label":"Codex","session":17,"weekly":42,"resetSecs":15480}\n' \
  | curl -X POST -H "X-VibeTV-Token: $TOKEN" --data-binary @- http://192.168.178.123/frame
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
  "features": ["theme", "theme-spec-v1", "provider-slots-v1", "provider-assets-v1", "color-stops-v1", "text-valign-v1"],
  "maxFrameBytes": 2048,
  "capabilities": {
    "display": {
      "widthPx": 240,
      "heightPx": 240,
      "colorDepthBits": 16,
      "brightness": {"supported": true, "minPercent": 1, "maxPercent": 100}
    },
    "standby": {
      "supported": true,
      "minTimeoutMinutes": 1,
      "maxTimeoutMinutes": 240,
      "defaultTimeoutMinutes": 10,
      "screensaverSlot": true
    },
    "theme": {
      "supportsThemeSpecV1": true,
      "supportsUsageSlotsV1": true,
      "supportsProviderSlotsV1": true,
      "supportsProviderAssetsV1": true,
      "supportsColorStopsV1": true,
      "supportsTextValignV1": true,
      "maxThemeSpecBytes": 2048,
      "maxThemePrimitives": 32,
      "supportedPrimitiveTypes": ["text", "rect", "progress", "gif", "sprite", "pixels"],
      "supportsStoredThemes": true,
      "maxStoredThemeSpecBytes": 4096,
      "maxThemeGifAssets": 1,
      "maxThemeGifBytes": 24576,
      "maxThemeGifWidth": 80,
      "maxThemeGifHeight": 80,
      "maxThemeGifPixels": 6400,
      "builtinThemes": ["classic", "crt", "mini"]
    },
    "auth": {
      "paired": false,
      "tokenHeader": "X-VibeTV-Token"
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
  - `display.brightness.supported` describes browser-adjustable backlight support when the board exposes it. `display.brightness.minPercent` and `maxPercent` report the supported range; the current ESP8266 implementation uses 1-100 percent. Hosts that see no range fall back to 10-100 percent.
  - A VibeTV without saved display settings starts at 20 percent brightness.
  - `standby.supported` tells hosts whether this firmware has the standby settings and the screensaver slot at all. It is `false` on builds without the ThemeSpec renderer, because the screensaver is itself a stored ThemeSpec and is loaded from LittleFS on each transition rather than held resident alongside the live theme. Hosts must read this flag instead of inferring standby support from the firmware version, and must hide standby controls when it is `false`.
  - `standby.minTimeoutMinutes`, `maxTimeoutMinutes`, and `defaultTimeoutMinutes` report the accepted inactivity range and the factory default.
  - `standby.screensaverSlot` reports whether `POST /screensaver/active` exists.
  - `theme.maxThemeSpecBytes` is the inline `themeSpec` frame byte limit.
  - `theme.supportsUsageSlotsV1` gates dynamic slot bindings and primitive lane ownership.
  - `theme.supportsProviderAssetsV1` gates `providerAssets` / `pa` sprite maps. Older firmware ignores `pa` and draws `assetPath` / `a`; that fallback is compatible only when `a` is a valid sprite. Hosts still require the capability (or `minFirmware` 1.0.42) before installing a pack that uses `pa`.
  - `theme.supportsColorStopsV1` gates `colorStops` / `cs`. Older firmware uses solid `c`. Stops are authored against remaining-style percent; when the frame `usageMode` is `used`, firmware matches `100 - percent` so warning colors stay correct.
  - `theme.supportsTextValignV1` gates `valign` / `va`. Older firmware treats `y` as the glyph top, so shrink+middle is not a compatible fallback. Hosts must not install a spec that emits `va` onto firmware without this capability.
  - `theme.maxStoredThemeSpecBytes` is the uploaded/stored ThemeSpec JSON byte limit for WiFi themes.
  - `theme.maxThemePrimitives` is the maximum primitive count accepted by the renderer.
  - `theme.supportedPrimitiveTypes` lists the ThemeSpec primitive types this firmware can render.
  - `theme.maxThemeGifAssets`, `maxThemeGifBytes`, `maxThemeGifWidth`, `maxThemeGifHeight`, and `maxThemeGifPixels` describe GIF asset and draw-box limits.
  - `auth.paired` tells hosts whether write APIs currently require a pairing token.
  - `auth.tokenHeader` names the HTTP header hosts should use for write auth.
  - `transport.maxFrameBytes` or top-level `maxFrameBytes` is the live frame payload limit. Hosts should use the stricter known value when both are present.

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
- Firmware ticks down `resetSecs` locally between host updates, bounded by `resetTrustSecs` (see Reset Freshness and Trust).
- Firmware owns `time`/`date` rendering. It runs its own SNTP client (outbound UDP/123 to `pool.ntp.org`) and never fetches public HTTPS manifests. Host-sent clock strings are a fallback; `clockSchedule` carries only the current offset and next two transitions needed for correctness without device-side timezone rules.
- Companion may resend the last known good frame normally during short CodexBar outages (current default max age: 10 minutes). After that, it keeps provider identity and numeric progress carriers but sets `usageUnavailable:true`.
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
