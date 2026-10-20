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
legacy firmware. A legacy WiFi VibeTV (early hardware without USB data, see
`docs/hardware-contract.md`) keeps only `POST /update/firmware`.

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

## Factory Leftovers In Flash (#310)

The WiFi flow above writes only the sketch and our filesystem. The flash
between them still holds the GeekMagic firmware's own filesystem, including its
demo pictures. Decision in
[#310](https://github.com/DreamyTalesPAN/CodexBar-Display/issues/310)
(2026-10-20):

- **New devices:** the whole flash is erased over the USB cable before our
  firmware is written. The supplier already flashes our firmware over USB, so
  the erase is part of the supplier's flashing step (`esptool.py erase_flash`,
  then write). A device provisioned only with the WiFi flow above keeps the
  leftovers and is not shipped until it was erased over USB.
- **Every batch:** read 2–3 unused devices with the check below before the
  batch is accepted.
- **Devices already sold:** stay as they are. The leftovers are never mounted
  as long as our filesystem starts at `0x200000`, so CI keeps the flash layout
  fixed: `scripts/check-esp8266-flash-layout.sh` fails if any ESP8266 build in
  `firmware_esp8266/platformio.ini` uses another linker script than
  `eagle.flash.4m2m.ld` (a bigger filesystem would start at `0x100000` and
  mount the factory files).

Check a device over the USB cable. This only reads. Quit the VibeTV app and
its background service first so that the port is free:

```bash
./scripts/vibetv-flash-leftovers.sh --port /dev/cu.usbserial-10
```

It reads the region between the end of the sketch region and `_FS_start`
(`0x100000`-`0x200000` with `eagle.flash.4m2m.ld`; the offsets come from the
linker script named in `platformio.ini`) at 115200 baud in 256 KB chunks, which
takes about two minutes, and prints the share of erased bytes and a verdict:

- `CLEAN`, exit 0: every byte is erased.
- `LEFTOVERS`, exit 1: a LittleFS superblock or a factory file name is there.
- `NOT ERASED`, exit 3: other data, for example a firmware image that an
  earlier update staged just below `_FS_start`.

Two more exit codes mean that there is no verdict: 2 is a usage or setup error
(bad arguments, missing tool, bad package), 4 is a serial error (port busy,
esptool failed, or the read came back short). Only exit 1 says that factory
leftovers were found.

Batch sample: take devices that were never connected to the app. Each must
read `CLEAN` (exit 0), because after a full erase the supplier writes only
`firmware.bin` below this region. `LEFTOVERS` (exit 1) rejects the batch until
the supplier has erased and reflashed it. `NOT ERASED` (exit 3) puts the batch
on hold: the region holds data the check does not recognize, so ask the
supplier what they wrote there before accepting it. Exit 2 or 4 is no verdict:
free the port and read again.

`NOT ERASED` is normal on a device that has already received a firmware
update over the cable, because the update first stores the new image just
below `_FS_start`. Such a device is no batch sample; for it, only `LEFTOVERS`
means factory data.

The check calls esptool through PlatformIO (`pio`), so PlatformIO has to be
installed on the computer that reads the device.

Full USB erase on our own bench, for a device that may lose everything it
stores:

```bash
./scripts/vibetv-provision.sh build --package-dir dist/vibetv-ota/release
./scripts/vibetv-flash-leftovers.sh --usb-erase \
  --port /dev/cu.usbserial-10 --package-dir dist/vibetv-ota/release --yes
```

This erases the whole flash, writes `firmware.bin` and `littlefs.bin` over the
cable, runs the check and fails unless the verdict is `CLEAN`. `SHA256SUMS`
must list and match both images before anything is erased. The device loses
its saved WiFi, pairing, themes and settings and has to be set up again over
the cable. Without `--yes` the command prints what it would erase and stops.

## Recovery Limitation

Devices must expose the GeekMagic factory update page before this script can update them over WiFi. A device that already runs current VibeTV firmware has no WiFi update route; update it over the USB cable with the Mac App or `codexbar-display install-update --target cable://vibetv`.

## WiFi Setup Recovery

- WiFi credentials and pairing are written only over the USB cable (issue #489).
  There is no HTTP WiFi reset, setup access point or local-WiFi pairing.
  Legacy WiFi VibeTVs (early hardware without USB data) keep them until their
  first request over the USB cable.
- If saved credentials fail, the device shows `Connect USB cable` and keeps
  retrying. Sending a replacement network over the cable does not clear
  pairing, themes, brightness, or other settings.
- Repeated early power interruptions do not clear WiFi credentials.
- A lost token is recovered by pairing over the cable, which returns the
  existing token. The token is required before using any OTA endpoint.
- Firmware `1.0.38` keeps its legacy three-power-cycle WiFi recovery and
  30-minute pairing window so that it can be connected and updated.
