# Firmware Provisioning

This runbook describes the repeatable OTA provisioning flow for Vibe TV devices with the GeekMagic factory firmware already installed.

> **Stop if `GET /hello` succeeds.** A device that returns VibeTV JSON from
> `http://<ip>/hello` is no longer a GeekMagic factory device. Do not send that
> device to this runbook's `/update` endpoint. Use `codexbar-display
> install-update` as documented in `docs/operator-runbook.md` instead.

The first OTA pass uses the GeekMagic updater at `http://<ip>/update` with multipart field `firmware`. After that, CodexBar Display firmware is expected to expose:

- `GET /health`
- `GET /hello`
- `GET /assets`
- `POST /assets` multipart field `asset` plus a `path` query/form value for individual theme assets
- `POST /frame` for smoke frames

Current VibeTV firmware has no WiFi update routes (#489), so the script skips
the filesystem upload by default and later firmware updates run over the USB
cable. `POST /update/firmware` and `POST /update/filesystem` exist only on
legacy firmware.

The tooling does not store WiFi passwords or other secrets.

## Choose the updater before writing

Run these read-only probes before selecting a flash command:

```bash
curl -sS -o /tmp/vibetv-hello.json -w 'hello=%{http_code}\n' \
  http://<device-ip>/hello
curl -sS -o /dev/null -w 'factory-update=%{http_code}\n' \
  http://<device-ip>/update
```

- `GET /hello -> 200` with VibeTV JSON: use `codexbar-display install-update`.
  Never use the GeekMagic `/update` path for this device.
- `GET /hello -> 404` and `GET /update -> 200`: the GeekMagic factory
  provisioning flow in this document is the correct path.
- Any other combination: stop and identify the running firmware before sending
  an upload. Do not try update endpoints until one works.

## Build an OTA Package

From the repo root:

```bash
./scripts/vibetv-provision.sh build
```

The package is written to `dist/vibetv-ota/<timestamp>-esp8266_smalltv_st7789/` and contains:

- `firmware.bin`
- `littlefs.bin`
- `SHA256SUMS`
- `manifest.json` with required theme asset paths, byte sizes, and SHA-256 hashes

Use a fixed output directory when the same artifact set should be reused across a provisioning run:

```bash
./scripts/vibetv-provision.sh build \
  --package-dir dist/vibetv-ota/release-2026-05-03
```

## Provision One Device

1. Power the Vibe TV.
2. Put it on the provisioning WiFi using the GeekMagic/factory setup flow.
3. Find the device IP.
4. Run a dry-run first:

```bash
./scripts/vibetv-provision.sh all \
  --target 192.168.178.123 \
  --expect-board esp8266-smalltv-st7789 \
  --dry-run
```

5. Run the real upload:

```bash
./scripts/vibetv-provision.sh all \
  --target 192.168.178.123 \
  --expect-board esp8266-smalltv-st7789 \
  --yes
```

What this does:

1. Builds `firmware.bin` and `littlefs.bin`.
2. Verifies `SHA256SUMS`.
3. Uploads `firmware.bin` to the GeekMagic factory endpoint with multipart field `firmware`.
4. Waits for the new firmware to answer `/health`, `/hello`, and `/assets`.
5. Uploads `littlefs.bin` to the VibeTV endpoint with multipart field `filesystem`.
6. Checks `/health`, `/hello`, and `/assets` again.
7. Compares the runtime theme asset metadata from `/assets` against the package `manifest.json`.
8. Sends one `mini` frame to `/frame` and requires `ok`.

`/health` reports generic filesystem status plus compact display debug state. `display.activeTheme` names the active built-in theme, `display.themeSpec` reports render health, and `display.gif` reports the active GIF path, file presence, decoder state, blocked state, and `lastError` when GIF open or decode fails. `/assets` is the generic inspection path for future theme-pack tooling. Each asset entry must include `path` and `sizeBytes`; `sha256` is optional. Required assets must be present, non-empty, byte-exact, and hash-exact compared with the package manifest when the device exposes hashes.

The filesystem upload timeout defaults to 300 seconds because slow ESP8266 LittleFS writes can outlive a normal short HTTP timeout. Firmware uploads default to 90 seconds.

Devices can close the HTTP connection while rebooting. The script classifies curl exit 52/56 as a reboot-related close by default, then continues to the post-upload `/health`, `/hello`, and `/assets` checks. Those checks still decide pass/fail. To fail immediately on that curl status instead, add:

```bash
--strict-upload-response
```

Every failed run prints `provision: FAIL stage=...` so the failing phase is visible: upload, reboot wait, health check, asset verification, or smoke frame. Successful runs end with `provision: PASS`.

## Reuse a Built Package

For additional devices, keep the package and change only the IP:

```bash
./scripts/vibetv-provision.sh flash \
  --target 192.168.178.124 \
  --package-dir dist/vibetv-ota/release-2026-05-03 \
  --expect-board esp8266-smalltv-st7789 \
  --yes
```

Repeat for each device that should receive the same firmware and filesystem artifacts.

The provisioning wrapper is intentionally strict: a device is not accepted if `/hello` reports the wrong board, the filesystem is not mounted, a required asset is missing, empty, has the wrong size, has the wrong SHA-256 when reported by the device, a smoke frame is rejected by `/frame`, or `/health` reports a mini GIF renderer error after the smoke frame.

## Endpoint Overrides

If firmware separates firmware and filesystem update paths, override them:

```bash
./scripts/vibetv-provision.sh flash \
  --target 192.168.178.123 \
  --package-dir dist/vibetv-ota/release-2026-05-03 \
  --filesystem-update /update/filesystem \
  --firmware-update /update/firmware \
  --yes
```

If only filesystem needs to be refreshed after the initial factory OTA:

```bash
./scripts/vibetv-provision.sh flash \
  --target 192.168.178.123 \
  --package-dir dist/vibetv-ota/release-2026-05-03 \
  --skip-manufacturer-ota \
  --yes
```

## Safety

- OTA uploads require either `--yes` or typing `FLASH` interactively.
- `--dry-run` prints uploads and smoke commands without changing the device.
- `SHA256SUMS` is checked before every `flash`.
- Use `--skip-health` only while firmware `/health` is still being integrated.

## Recovery Limitation

Devices must expose the GeekMagic factory update page before this script can update them over WiFi. A device that already runs current VibeTV firmware has no WiFi update route; update it over the USB cable with the Mac App or `codexbar-display install-update --target cable://vibetv`.

## WiFi Setup Recovery

- WiFi credentials and pairing are written only over the USB cable (issue #489).
  There is no HTTP WiFi reset, setup access point or local-WiFi pairing.
- If saved credentials fail, the device shows `Connect USB cable` and keeps
  retrying. Sending a replacement network over the cable does not clear
  pairing, themes, brightness, or other settings.
- Repeated early power interruptions do not clear WiFi credentials.
- A lost token is recovered by pairing over the cable, which returns the
  existing token. The token is required before using any OTA endpoint.
- Firmware `1.0.38` keeps its legacy three-power-cycle WiFi recovery and
  30-minute pairing window so that it can be connected and updated.
