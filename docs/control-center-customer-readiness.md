# Control Center Customer Readiness

This document defines the current customer flow and the checks required before
shipping it. Historical test runs belong in GitHub Actions and pull requests,
not in this file.

## Current Customer Flow

```text
app.vibetv.shop
  -> verified VibeTV-Control-Center.dmg
  -> installed Mac App on 127.0.0.1:47832
  -> VibeTV on the customer's WiFi
```

1. The customer downloads the verified DMG from `app.vibetv.shop`.
2. The installed Mac App opens the bundled local Control Center.
3. A fresh installation searches for VibeTV first and shows WiFi setup only
   when no device is found.
4. A known VibeTV is found by its saved identity and reconnects automatically.
5. If a known VibeTV is offline at app launch, the app shows the reconnect
   screen. After Control Center has opened, temporary disconnects never replace
   the current screen or active tab.
6. A different VibeTV is never selected automatically. The customer must reset
   setup deliberately before changing devices.
7. Theme and firmware writes happen only after their existing preflight checks
   pass and the customer starts the action.

The hosted website is only the download entrypoint. Device discovery, pairing,
settings, themes, updates, and support run locally in the Mac App.

## Automated Gate

Run the local non-release checks while developing:

```bash
scripts/check-control-center-customer-ready-gate.sh \
  --automated-only \
  --skip-release
```

Validate a specific release only after its assets exist:

```bash
scripts/check-control-center-customer-ready-gate.sh --release v<version>
```

The gate is read-only. It does not merge, tag, release, install software,
start services, discover devices, or write to VibeTV hardware.

## Manual Release Evidence

The release owner must verify both manual gates for the exact candidate:

- the signed and notarized DMG installs in `/Applications`, opens normally,
  owns `127.0.0.1:47832`, and serves the expected source version;
- any required hardware-write flow was explicitly approved and passed on the
  intended VibeTV.

Supply those confirmations to the gate only for the run in which they were
actually verified. GitHub Actions and the pull request are the evidence trail;
do not copy individual run logs into this repository.

## Read-Only Support Checks

Check the local Mac App:

```bash
curl -fsS http://127.0.0.1:47832/v1/status
```

Create a redacted support report:

```bash
curl -fsS http://127.0.0.1:47832/v1/diagnostics
```

Search for VibeTV devices without changing them:

```bash
curl -fsS -X POST http://127.0.0.1:47832/v1/device/discover \
  -H 'Content-Type: application/json' \
  -d '{}'
```

If discovery reports multiple devices, never guess. The customer must select
the intended VibeTV deliberately.

Inspect the background service:

```bash
launchctl print gui/$(id -u)/shop.vibetv.control-center.runtime
```

## Write And Release Boundaries

Read-only status, diagnostics, device, discovery, and settings requests are
safe for investigation. Theme installation, firmware updates, asset uploads,
frame writes, WiFi resets, merges to `main`, tags, and releases require the
separate approval defined by the repository guardrails.

Theme installation remains locked until the Mac App reports a connected and
paired VibeTV, compatible hardware and firmware, a valid theme pack, and enabled
theme installation. Firmware updates use their separate OTA contract in
[`firmware-ota-contract.md`](firmware-ota-contract.md).
