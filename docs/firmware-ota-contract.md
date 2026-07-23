# Firmware OTA Contract

This contract defines the supported customer update path for ESP8266 VibeTV
devices. It applies to the Control Center, the Companion CLI, and firmware OTA
handlers.

## Safety invariants

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
- Validate the selected token with an authenticated `GET /hello` against the
  pinned device before opening the RAW OTA connection. A `401`/`403` must repair
  pairing and repeat identity validation before any firmware body is sent.
- Validate the selected manifest artifact and SHA-256 before opening the OTA
  connection.
- Pause the display stream for the complete upload. The Control Center uses its
  in-process display-stream pause; a direct CLI invocation pauses the configured
  display-stream launch service.
- Do not run discovery, health polling, frame writes, theme installs, or asset
  uploads while firmware bytes are being sent.
- A failed upload is never followed by a different transport or a second upload
  in the same device boot once firmware bytes may have been sent.
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

## Firmware 1.0.36 compatibility transport

Firmware `1.0.36` has a fragile ESP8266 receive path. The supported bridge to
`1.0.37` is the RAW HTTP endpoint on TCP port `8081`:

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

These values are a compatibility requirement, not a performance preference.
Do not increase them without repeating the `1.0.36 -> 1.0.37` hardware gate.

Multipart is allowed only when the RAW endpoint is provably unavailable before
an upload starts, for example `connection refused`, `no route to host`, or an
HTTP `404`. A timeout is not proof that no firmware bytes reached the device.

## Failure and retry state machine

1. A connection refusal before RAW is available may fall back to multipart.
2. An authentication rejection during the mandatory preflight repairs pairing
   and repeats authenticated identity validation before opening RAW OTA.
3. A broken pipe, reset, EOF, or other interrupted RAW upload first waits for
   the target version to return. This covers a successful flash whose response
   was lost.
4. If the same device returns on the old version, stop. Ask the customer to
   disconnect power for 10 seconds and retry only after the picture returns.
5. Never switch to multipart or automatically resend in the same boot after an
   interrupted RAW upload.

The firmware validates OTA authentication immediately after reading the request
headers and closes the connection before `Update.begin()` when the token is
wrong. A sender that reads the HTTP response only after writing the complete
body can therefore surface the early `401` merely as `EPIPE`/`broken pipe`.
This is why authenticated `/hello` is a required preflight rather than an
upload-error recovery optimization.

## Firmware receiver requirements from 1.0.37 onward

- Release renderer, filesystem, UDP, and unrelated TCP resources before
  `Update.begin()` while preserving the active OTA socket.
- Reject an empty or oversized RAW body before entering update mode.
- Use the exact RAW `Content-Length` as the update size.
- Read only bytes currently available from the socket, in buffers no larger
  than `512` bytes. Do not block waiting to fill a larger buffer.
- Reset the ESP8266 `Update` object on every failed begin, write, timeout,
  disconnect, abort, or final validation.
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
