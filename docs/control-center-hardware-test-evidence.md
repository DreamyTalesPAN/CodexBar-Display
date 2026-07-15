# Control Center Hardware Test Evidence

This file records user-approved hardware write tests for the hosted Control Center path.
It is evidence for the manual `--hardware-tested` gate only. It does not replace
Clean-Mac validation, merge review, or release checks.

## 2026-06-22 - WiFi Theme Install Gate

Approval:

- The user explicitly approved the hardware write test in the Codex thread on 2026-06-22 with `go`.

Device:

- Address: `http://192.168.178.72`
- Board: `esp8266-smalltv-st7789`
- Transport: WiFi
- Firmware before test: `1.0.31`
- Starting active theme: `mini-classic`

Test action:

- Started the local Mac App service from `companion` with normal theme install enabled.
- Connected through `POST /v1/device/discover` without an explicit target.
- Installed theme `synthwave` through `POST /v1/themes/install`.
- Payload included `skipFirmwareUpdate: true`.
- No firmware flash was performed.
- No automatic retry was performed.

Install result:

```json
{
  "ok": true,
  "result": {
    "themeId": "synthwave",
    "packId": "synthwave",
    "name": "Synthwave",
    "target": "http://192.168.178.72",
    "activePath": "/themes/u/synthwa-1-0432f1.json",
    "themeRev": 1,
    "capabilitiesKnown": true
  }
}
```

Immediate health result:

```json
{
  "ok": true,
  "firmware": "1.0.31",
  "display": {
    "activeTheme": "synthwave",
    "themeSpec": {
      "active": true,
      "path": "/themes/u/synthwa-1-0432f1.json",
      "hash": "0432f12d",
      "renderOk": true,
      "renderFailures": 0
    },
    "gif": {
      "activePath": "",
      "filePresent": false,
      "decoderOpen": false,
      "lastError": null
    }
  }
}
```

10-second follow-up health result:

- Active theme remained `synthwave`.
- Firmware remained `1.0.31`.
- `renderOk` remained `true`.
- `renderFailures` remained `0`.
- Free heap was stable at about `28 KB`.

Cleanup:

- The temporary local Mac App service was stopped.
- Port `127.0.0.1:47832` was no longer listening after cleanup.

Conclusion:

- The user-approved Control Center WiFi theme install write path passed on real VibeTV hardware.
- The test only covers the approved `mini-classic -> synthwave` write flow.
- Repeated theme switching remains a separate theme stress test and needs fresh user approval before any further device writes.

## 2026-07-15 - WiFi Recovery, Pairing Repair, and GIF Memory Gate

Approval:

- The user explicitly approved the OTA on device `9517433` and granted the
  hardware writes used by the customer-path theme, pairing, and soak tests.
- The OTA was attempted exactly once. The deliberately invalid-token test was
  also attempted exactly once.

Device and local customer build:

- Device ID: `9517433`
- Address: `http://192.168.178.163`
- Board: `esp8266-smalltv-st7789`
- Transport: WiFi, `networkMode: station`
- Firmware: local preview `1.0.36-rc.1`
- Firmware SHA-256:
  `928c0dae8d3985cd7035f62778dd7bbea19e31bccf341a1069bec65bffd738f0`
- Installed Mac App: local preview `1.0.44-rc.12`, final local build `15`

Firmware OTA result:

- The raw authenticated OTA endpoint returned HTTP `200` with body `ok`.
- The same device ID returned after the software restart with WiFi preserved.
- `/hello` reported `maxThemeGifLzwBits: 11`.
- The OTA artifact was `480688` bytes; the release size gate remained below
  `482000` bytes.

Customer-path theme test:

- The installed app in `/Applications` showed the connected device and firmware.
- Theme Library was opened through the visible native app UI.
- `Mini Classic` was installed through its visible `Install` button. No direct
  theme-install request was used by the test harness.
- Mini reached a healthy render with:
  - `activeTheme: mini-classic`
  - `decoderAllocated: true`
  - `decoderOpen: true`
  - `lastError: null`
  - free heap `13008` bytes
  - largest free block `12016` bytes
- `Claude Creature` was then installed through the same visible customer UI.
- The GIF decoder was released immediately after the GIF-free theme became
  active:
  - `activeTheme: claude-creature`
  - `decoderAllocated: false`
  - `decoderOpen: false`
  - `lastError: null`
  - free heap `27328` bytes
  - largest free block `23496` bytes

Automatic pairing-repair result:

- Only the locally stored token was replaced with a deliberately invalid value.
- The installed app was opened normally; no token was shown or entered in UI.
- The app kept the matching device ID, rotated pairing once, saved the accepted
  token, and ended with `paired: true`, `ready: true`, a healthy stream, and a
  confirmed fresh Claude frame.
- The invalid-token test was not repeated.

Five-minute Claude soak:

- Window: `2026-07-15T07:52:07Z` through `2026-07-15T07:57:01Z`.
- Twenty read-only samples were taken at 15-second intervals while the normal
  30-second customer stream remained active.
- All 20 samples kept device ID `9517433`, `networkMode: station`,
  `activeTheme: claude-creature`, `streamHealthy: true`, and `ready: true`.
- All 20 samples reported `decoderAllocated: false`, `decoderOpen: false`, and
  no GIF error.
- Minimum observed free heap was `26608` bytes.
- Minimum observed largest free block was `24168` bytes.
- No restart or WiFi loss occurred during the soak.

Test-harness note:

- A manually forced `launchctl bootout` used to pause the writer before OTA left
  the local Service Management registration inconsistent. That non-customer
  condition was discarded.
- The unchanged app was reinstalled through its normal incremented-build update
  path. A subsequent clean app quit/reopen kept the same Service Management PID
  as the sole listener for a full minute before the final soak.

Conclusion:

- The approved customer-path hardware gate passed for OTA recovery, automatic
  pairing repair, Mini GIF playback, immediate GIF-decoder release on Claude,
  and the five-minute Claude stability soak.
- This is preview evidence only. It does not authorize merge, tag, release, or
  publication of firmware or Mac App assets.
