# Control Center Hardware Test Evidence

This file records user-approved hardware write tests for the hosted Control Center path.
It is evidence for the manual `--hardware-tested` gate only. It does not replace signed
Mac App package validation, Clean-Mac validation, merge review, or release checks.

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

- Started the local Mac App service from `companion` with `VIBETV_ENABLE_WIFI_THEME_INSTALL=1`.
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
