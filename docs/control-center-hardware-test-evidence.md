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

### Final rc.2 artifact and IP-only discovery verification

The earlier `1.0.36-rc.1` evidence above records the customer-path GIF and
pairing tests performed on that preview. After removing the remaining mDNS
runtime dependency, the final release candidate was rebuilt and installed once
on the same approved canary. The following results supersede the artifact
identity and final stability state above without replacing the earlier theme
transition evidence:

- Device ID: `9517433`
- Address: `http://192.168.178.163`
- Firmware: `1.0.36-rc.2`
- Firmware SHA-256:
  `b98964b4ae373c4f46d99e7d979fe6306fa870bc238e9268174ec671446f1012`
- Firmware size: `459568` bytes; gzip size: `326363` bytes
- Build usage: RAM `52.3%`; flash `43.6%`
- Installed Mac App version observed through `/v1/status`: `1.0.44-rc.16`
- The authenticated corrective OTA returned HTTP `200`; the same device ID
  returned in `station` mode and reported `1.0.36-rc.2`.
- Automatic device search found the known device at its IPv4 address while
  `vibetv.local` did not resolve on the Mac.
- A five-minute read-only soak completed `30/30` identity, firmware, and
  station-mode checks without a restart or WiFi loss.
- Final `/health` state with GIF-free Clippy active reported
  `decoderAllocated:false`, `decoderOpen:false`, `renderOk:true`, free heap
  `28928` bytes, largest free block `27528` bytes, and `5%` fragmentation.
- The installed Mac App reported `connected:true`, `paired:true`, `ready:true`,
  and a healthy running display stream to the same IPv4 target.

No merge, production deployment, tag, or release was performed by this final
verification.

## 2026-07-16 - Firmware 1.0.36 to 1.0.37 migration gate

Approval:

- The user authorized the remaining hardware writes and selected three
  consecutive migration runs as the release gate.

Device and artifacts:

- Device ID: `14799300`
- Address: `http://192.168.178.72`
- Board: `esp8266-smalltv-st7789`
- Source firmware: public `1.0.36` from release `v1.0.46`
- Source compressed SHA-256:
  `88164516ddb33c0b411392b2ab1ce99c5698e7176bdc640d01b3887cfd77f199`
- Source raw firmware SHA-256:
  `d78580503a871bd58f947570e3eeee178487b62566b36eebb84833a2d3dc6b93`
- Source raw size: `459920` bytes
- Target firmware: final PR #182 candidate `1.0.37`
- Target SHA-256:
  `7b2b297829d5b2551ead94cdea6450f0fac053b1d05ab57288a4393c2b6302a5`
- Target size: `462688` bytes
- Target build usage: RAM `52.7%`; flash `43.9%`

Test method:

- Each run restored only flash address `0x0` with the exact public `1.0.36`
  firmware. No erase-all, filesystem, WiFi, theme, or asset write was used.
- Before each OTA, `/hello` confirmed firmware `1.0.36`, device ID `14799300`,
  and station mode.
- The combined Control Center runtime/API process sent a normal display frame
  before each update.
- Each update was started through `POST /v1/updates/install`, not by calling the
  device OTA endpoint directly.
- The Control Center paused its display writer for the OTA. No display frame was
  sent during any upload window; a fresh frame was sent after each update.
- The Companion used the paced RAW compatibility transport and did not retry or
  fall back to multipart.

Results:

| Run | Control Center job | Result | Target boot ID |
| --- | --- | --- | --- |
| 1 | `firmware-update-1784219770952740000-1` | `1.0.37`, identity and health verified | `e1d1c4-36-5aeea5bb` |
| 2 | `firmware-update-1784220182473777000-1` | `1.0.37`, identity and health verified | `e1d1c4-38-889c42d3` |
| 3 | `firmware-update-1784220373588746000-2` | `1.0.37`, identity and health verified | `e1d1c4-40-e47c3e48` |

All three runs additionally verified:

- reset reason `Software/System restart` after OTA;
- filesystem mounted;
- ThemeSpec `renderOk: true`;
- `/themes/mini/mini.gif` still present with `20870` bytes;
- `/themes/u/mini-cl-1-410a37.json` still present with `642` bytes;
- WiFi credentials preserved and the device returned at the same address.

Harness note:

- A stale previous-agent LaunchAgent, `shop.vibetv.preview-fixture`, was found
  serving an old `1.0.36` preview manifest on port `47833`. The final gate used
  an isolated server on port `47834`, so the stale fixture did not affect any of
  the three artifacts or uploads. The stale service was booted out after the
  gate and port `47833` was confirmed closed.
- The local final candidate binary was run directly instead of from the signed
  app bundle. macOS did not allow that unsigned `/tmp` binary to use local
  networking when registered through `launchd`, so the combined runtime/API
  process was run directly for the gate.
- Consequently the API job's separate `launchctl` inspection reported
  `firmware_current_stream_attention`, even though the same process demonstrably
  paused the writer, resumed it, sent a fresh frame, and the device reported a
  healthy render after every update. This is a test-harness registration warning,
  not an OTA, device-health, or render failure.

Conclusion:

- The final candidate passed the selected `3/3` consecutive customer-path
  firmware migration gate from public `1.0.36` to `1.0.37`.
- No USB data connection was used for the upgrade itself; USB was used only to
  recreate the source firmware between runs.
- No merge, tag, release, Main push, or production deployment was performed.
