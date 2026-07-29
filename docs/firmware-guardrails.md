# Firmware Architecture Guardrails (WiFi runtime v2)

Goal: keep firmware transport/theme evolution modular and prevent monolith regressions.

## Module Boundaries
- `firmware_shared/codexbar_display_core.h`: protocol frame parsing, runtime state, countdown math.
- `firmware_shared/app_transport.h`: transport hello emission + serial consume bridge.
- `firmware_shared/device_clock.h`: device wall clock state math (SNTP epoch, learned UTC offset, resolved `time`/`date` text). Pure state, no board calls, natively tested.
- `firmware_esp8266/src/standby_settings.h`: standby configuration state — clamping, screensaver slot reference, and the persisted record encoding. Pure state, no board calls, natively tested. Deciding when the device is idle and what it renders does not belong here.
- `firmware_shared/app_runtime.h`: runtime context wrapper.
- `firmware_shared/app_renderer.h`: renderer lifecycle contract.
- `firmware_esp8266/src/renderer_esp8266_*`: board-specific theme rendering details.
- `firmware_esp32/src/renderer_esp32*`: alternate display target implementation.

Rules:
- transport logic must not import board-specific renderer internals.
- renderer modules must not parse raw JSON directly (only consume `core::Frame`).
- theme behavior changes should remain inside theme modules, not in transport loop.
- the firmware may open outbound SNTP (UDP/123) for its own clock. It must not
  fetch public HTTPS manifests. No other firmware-initiated outbound traffic.
- `{time}`/`{date}` must resolve through the device clock first and fall back to
  the Companion string only while that string is still current. A stale clock
  value must never be rendered as the current time.

## Protocol/Theme Rules
- Companion->device frame `v` is negotiated (prefer v2, fallback v1).
- ThemeSpec is declarative data only. Never execute scripts on device.
- ThemeSpec update notices prefer the existing label binding (permanent rotating text swap). Themes without a label binding get a bounded edge overlay bar in timed visible/hidden windows, placed where no animated primitive repaints and removed with a region repaint — never a full-screen redraw. Update copy points to the VibeTV Mac App only; no hosted URLs. Showing the notice must never trigger a firmware write.
- Reset-countdown trust is firmware-enforced, never delegated to a theme. Every
  rendering path must read the countdown through `core::CurrentRemainingSecs`,
  which yields `0` for a stale basis. Do not read `Frame::resetSecs` for display.
- The reset deadline is persisted only on a self-initiated restart, never per
  frame (flash wear), and a cold start drops the record because the device has
  no wall clock. See `protocol/PROTOCOL.md`, Firmware enforcement.
- `themeId/themeRev` cache keys are required to detect unchanged ThemeSpec payloads.
- Live theme removal is destructive. Firmware must ignore `themeSpec:null` unless the same frame also sets `confirmClearThemeSpec:true`.
- Companion code must not emit `themeSpec:null` unless the caller explicitly marks that clear as confirmed. Normal recovery paths should reactivate a stored ThemeSpec or repair assets instead of clearing the live theme.

## ESP8266 WiFi Upload Guardrails
- The protocol, compatibility pacing, retry rules, and release gate in
  `docs/firmware-ota-contract.md` are mandatory for firmware OTA changes.
- Asset upload crashes are usually RAM pressure first. Do not start by adding retries or longer timeouts.
- `/assets` uploads must remain rate-limited from the Companion. Fast multipart writes can reset the ESP8266 even for small files.
- If an upload returns `connection reset by peer`, EOF, or timeout, stop the upload attempt and check `/health`. Do not immediately resend the same asset.
- Firmware must mark firmware/filesystem/theme asset uploads so upload-related restarts do not count toward the WiFi setup reset counter.
- Firmware must release GIF decoder, sprite caches, and open filesystem handles before asset upload, OTA, and stored ThemeSpec activation.
- A firmware upload that may have written bytes must never fall back to another
  transport or retry in the same device boot.
- A stored ThemeSpec activation must not keep the previous Mini GIF decoder open unless the new ThemeSpec actually uses that GIF.

## ESP8266 Flash Budget and the OTA Ceiling

This has already cost us once: a firmware grew past the ceiling, and affected
devices could no longer be updated over WiFi at all. They built fine and ran
fine. Read this before changing firmware size or the flash layout.

**The rule.** During an OTA the running firmware writes the incoming image into
the same region it lives in, so both must fit there at once. `Updater.cpp:135`
rejects the update with `UPDATE_ERROR_SPACE` when they do not:

```cpp
//make sure that the size of both sketches is less than the total space
if(updateStartAddress < currentSketchSize) {
  _setError(UPDATE_ERROR_SPACE);
```

In plain terms, with both sizes rounded up to a 4096-byte sector:

```
currentSketchSize + newSketchSize  <=  _FS_start - 0x40200000
```

`_FS_start` comes from the linker script, so **the board's `board_build.ldscript`
sets the OTA ceiling**, not the firmware.

**Why it bit us.** Until `fcdf470` (2026-05-19) the board used
`eagle.flash.4m3m.ld`: a 3 MB filesystem puts `_FS_start` at the 1 MB mark, so
both sketches had to share 1048576 bytes and neither could exceed roughly
524288. That is the wall the failing devices hit. The board now uses
`eagle.flash.4m2m.ld`, which moves `_FS_start` to 2 MB.

**Where we stand today** (`eagle.flash.4m2m.ld`, values from `_FS_start` in the
built ELF):

| | bytes |
|---|---|
| OTA region (`_FS_start` offset) | 2097152 |
| Executable sketch cap, PlatformIO's 100 percent | 1044464 |
| Firmware after #283 | 479088 |
| Headroom to the executable cap | 565376 |

At the current size the OTA rule is not the binding constraint — the executable
cap is. But the margin at the very top is thin: two sector-rounded 1044464-byte
sketches need 2088960 of the 2097152 available, leaving 8192 bytes. The two
limits nearly coincide, so there is no comfortable zone above the cap.

**Rules.**
- Never raise the CI flash gate to make a build fit. Reclaim flash instead (#309).
- Changing `board_build.ldscript` changes the OTA ceiling and moves the
  filesystem, which relocates customer themes on devices already in the field.
  Growing the filesystem back to 3 MB would restore the ~524288-byte wall.
- The ceiling is a property of the *running* firmware plus the *incoming* one.
  A device stuck on an oversized build cannot be rescued over WiFi; it needs USB.

**Verified on hardware** (2026-07-29, ESP8266EX over USB, MAC `d8:bf:c0:58:91:dc`).
`_FS_start` is a compile-time symbol, so the check was to read the flash and find
where the live filesystem actually begins:

- `esptool.py flash_id` reports a 4 MB chip, as the layout assumes.
- `read_flash 0x200000` holds the running filesystem — `theme-active`, `auth`,
  `themes`, and a stored `/themes/u/mini-cl-*.json`, at 20 percent erased.
- `read_flash 0x100000` holds unrelated leftovers from the board's original
  vendor firmware (`photo_config.json`, `theme_config.txt`, `*.gif`), at 95
  percent erased. It is dead data, not a VibeTV filesystem.

So the device confirms `_FS_start` at the 2 MB mark and an OTA region of
2097152 bytes. All reads were non-destructive; the device was hard-reset back
into normal operation afterwards.

To re-run this check: `esptool.py --port <port> --after hard_reset read_flash
0x200000 0x20000 out.bin`, then look for `theme-active` in the dump.

**Reading the runtime numbers.** `ESP.getFreeSketchSpace()` and the derived
`maxSize` are captured at OTA start (`firmware_esp8266/src/main.cpp:2458`) but
only ever printed to Serial — no HTTP endpoint reports them. Over WiFi they are
unreadable, with or without performing an update. Exposing them in `GET /health`
is tracked in #309.

## Split Thresholds (mandatory refactor trigger)
- Any single `.cpp`/`.h` file > 800 LOC and touching > 3 responsibilities:
  - split within same milestone.
- Any function > 120 LOC with > 2 conditional feature branches:
  - extract helper module(s) before adding new feature logic.
- Any feature requiring changes across `core + transport + renderer`:
  - add/update tests and contract docs in same PR.

## PR Checklist (required for firmware-impacting changes)
- [ ] Updated protocol docs if hello/frame shape changed.
- [ ] Confirmed no direct JSON parsing outside `firmware_shared/codexbar_display_core.h`.
- [ ] Confirmed renderer changes do not alter transport/handshake behavior.
- [ ] Confirmed live ThemeSpec clearing still requires explicit confirmation on both host and firmware paths.
- [ ] For WiFi upload changes, tested `synthwave -> clippy -> synthwave` on ESP8266 and checked `/health` after each activation.
- [ ] Confirmed upload-related restarts do not trigger the WiFi setup reset counter.
- [ ] Added/updated tests or smoke notes for changed behavior.
