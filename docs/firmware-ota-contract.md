# Firmware OTA Contract

This contract defines the supported customer update path for ESP8266 VibeTV
devices. It applies to the Control Center, the Companion CLI, and firmware OTA
handlers.

## Safety invariants

- The radio must run 802.11g (`docs/hardware-contract.md`, "WiFi PHY mode").
  Under 802.11n the AP can aggregate frames the ESP8266 silently drops, which
  stalls a WiFi firmware upload at the TCP level while `/hello` still answers. Devices on
  firmware `< 1.0.40` still run 11n, so their first update can hit this; a
  power cycle immediately before the update starts a fresh, unaggregated
  association. Run `codexbar-display net-probe --target http://<ip>` when an
  OTA stalls.
- Firmware `1.0.39` and newer can always establish a new current token through
  an explicit local-WiFi Connect before authenticated OTA.
- Firmware upload always requires the current pairing token. The firmware does
  not accept an unsigned upload merely because pairing itself is open.
- The unauthenticated `GET /update` page never embeds a pairing token or a
  browser upload form. It points to the authenticated `install-update` path.
- Pin the device URL and `deviceId` before downloading or uploading firmware.
- Treat device URL, `deviceId`, and pairing token as one identity tuple. When a
  target changes, update all three together; never reuse an unverified token
  from the previous target.
- On WiFi, validate the selected token with an authenticated `GET /hello`
  against the pinned device before opening the multipart upload. A `401`/`403`
  must repair pairing and repeat identity validation before any firmware body is
  sent. On Cable, validate the same `deviceId` in the serial hello before the
  authenticated transfer starts.
- Validate the selected manifest artifact and SHA-256 before opening the OTA
  connection.
- Pause the display stream for the complete upload. The Control Center uses its
  in-process display-stream pause; a direct CLI invocation pauses the configured
  display-stream launch service.
- Do not run discovery, health polling, frame writes, theme installs, or asset
  uploads while firmware bytes are being sent.
- A failed upload is never retried or moved to a different transport in the
  same device boot once firmware bytes may have been sent.
- A successful update is complete only after the same `deviceId` returns with
  the target firmware and healthy rendering.

## Recovery matrix

| Bootable state | WiFi OTA path |
| --- | --- |
| Home WiFi and current token | Authenticated `install-update`. |
| Firmware 1.0.39 on home WiFi but local token lost or rejected | Press Connect. The firmware replaces the token, then authenticated `install-update` can proceed. |
| Firmware 1.0.38 on home WiFi but local token lost or rejected | Complete the legacy three-power-cycle WiFi recovery, reconnect the device to home WiFi, press Connect within 30 minutes, then update to current firmware. |
| Saved home WiFi unavailable | Wait for the ordinary open `VibeTV-Setup` portal, save the new WiFi, then press Connect. |
| Fresh unpaired device | Complete WiFi setup, press Connect, then run authenticated `install-update`. |
| Paired device after a WiFi change | The existing token remains valid; discover the new IP and run authenticated `install-update`. |

The ESP8266 firmware does not verify a cryptographic firmware signature on the
device. Manifest SHA-256 validation therefore remains a sender-side release
check, while the current pairing token is the mandatory receiver-side upload
authorization. Open pairing never authorizes a firmware upload directly.

## Current transports

- **WiFi:** authenticated multipart `POST /update/firmware` is the current
  firmware receiver path.
- **Cable:** the newline-delimited serial bulk-transfer protocol in
  `protocol/PROTOCOL.md` is the current Cable path. It is stop-and-wait, uses a
  128-byte candidate chunk, validates a per-chunk MD5 prefix and a complete MD5,
  and commits firmware only after `transfer-finish` verifies the full payload.
- **Installed firmware 1.0.36 only:** the Mac keeps the legacy RAW sender below
  as a bridge to a receiver that predates the current multipart path. Current
  firmware no longer starts a duplicate RAW receiver on TCP port `8081`.

## Legacy 1.0.36 RAW compatibility sender

Firmware `1.0.36` has a fragile ESP8266 receive path. The supported bridge to
`1.0.37` remains the Mac's RAW HTTP sender to the old device receiver on TCP
port `8081`:

- request: `POST /update/firmware.raw`
- body: exact firmware binary with an explicit `Content-Length`
- macOS socket send buffer: `2048` bytes
- TCP: `TCP_NODELAY`
- header: wait until fully acknowledged, then pause `250 ms`
- body writes: at most `64` bytes per write
- pacing: `10 ms` after every body write
- acknowledgment gate: wait for all pending bytes after every `1024` body bytes
- acknowledgment timeout: `30 s`
- total connection deadline: `5 min`

These historical values are a legacy-device compatibility requirement, not a
preference for current firmware. Do not increase them without repeating the
`1.0.36 -> 1.0.37` hardware gate.

The sender's `10 ms` body-write pacing applies when the legacy RAW bridge is
used. The sender briefly had an unpaced fast path for released firmware
`>= 1.0.37`; it was removed after historical hardware measurement (2026-08-07,
esp8266-smalltv-st7789, firmware 1.0.39):

| RAW upload mode | Concurrent device traffic | Installed |
| --- | --- | --- |
| unpaced | none | 0/3 |
| paced (10 ms) | none | 2/2 |
| paced (10 ms) | Mac App runtime polling port 80 | 0/1 |

Rule for the legacy bridge: `10 ms` pacing, no fast path. Pacing is necessary
but only sufficient when no other client is talking to the device, which is why
every writer must be quiesced before the upload starts.

RAW is not a current-firmware fallback. The updater selects it only for the
known installed `1.0.36` compatibility case; otherwise WiFi uses multipart and
Cable uses the serial bulk transfer.

## Failure and retry state machine

1. An authentication rejection during the mandatory preflight repairs pairing
   and repeats authenticated identity validation before opening the selected
   upload path.
2. A broken pipe, reset, EOF, or other interrupted legacy RAW upload first waits for
   the target version to return. This covers a successful flash whose response
   was lost.
3. If the same device returns on the old version, stop. Ask the customer to
   disconnect power for 10 seconds and retry only after the picture returns.
4. Never automatically resend or switch transports in the same boot after an
   interrupted upload.

The firmware validates OTA authentication immediately after reading the request
headers and closes the connection before `Update.begin()` when the token is
wrong. A sender that reads the HTTP response only after writing the complete
body can therefore surface the early `401` merely as `EPIPE`/`broken pipe`.
This is why authenticated identity validation is a required preflight rather
than an upload-error recovery optimization.

## Current firmware receiver requirements

- Release renderer, filesystem, UDP, and unrelated TCP resources before
  `Update.begin()` while preserving the active multipart HTTP request or Cable
  transfer state.
- Reject an empty or oversized multipart body or Cable `transfer-start` byte
  count before entering update mode.
- For WiFi, begin with the board's bounded maximum update size and let the
  multipart upload's actual firmware bytes determine the final image length.
  For Cable, use the declared transfer byte count and do not call `Update.end()`
  until the complete MD5 matches at `transfer-finish`.
- Read only bytes currently available from the socket, in buffers no larger
  than `512` bytes. Do not block waiting to fill a larger buffer.
- Reset the ESP8266 `Update` object on every failed begin, write, timeout,
  disconnect, abort, or final validation. A Cable transfer inactivity timeout
  is 15 seconds and must discard the inactive update.
- After a failure that entered update mode, return the error and perform a
  controlled restart. Do not accept another OTA attempt in that boot.
- Firmware `1.0.39` has no physical pairing recovery counter. Its legacy EEPROM
  bytes remain reserved to preserve the existing storage layout.

## Release gate

For the `1.0.36 -> 1.0.37` migration, three consecutive runs must pass on the
available production-representative device:

1. Restore the exact public `1.0.36` firmware area over USB without erasing
   customer data.
2. Confirm device identity, WiFi, and baseline assets.
3. Start the update through the Control Center customer path with its normal
   display stream active.
4. Confirm the same device returns on the exact candidate `1.0.37` artifact.
5. Confirm health, rendering, WiFi credentials, and theme assets remain intact.

Any unexplained failure resets the consecutive-run count.

## #302 hardware gate

The Cable bulk-transfer implementation is not release-proven yet. The current
development ESP8266 build uses 46,832 bytes RAM, 476,023 bytes flash, and a
480,176-byte `firmware.bin` (below the 482,000-byte image limit); it has not
been flashed. #302 remains open until direct-Mac and dock measurements cover
maximum theme, screensaver, and firmware transfers, unplug/timeout recovery,
and timing for the final production chunk size.
