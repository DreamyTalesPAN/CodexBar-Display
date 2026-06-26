# Vibe TV for Mac

This repository ships the firmware, macOS companion, and release artifacts for [Vibe TV](https://vibetv.shop/).
Vibe TV is the hardware. CodexBar provides the usage signal. `codexbar-display` sends that signal to the screen over WiFi so usage stays off-screen and on-desk. USB-C is only required for power in the standard setup flow.

## Setup

Vibe TV ships ready for WiFi setup.

1. Plug Vibe TV into power.
2. Join the `VibeTV-Setup` WiFi hotspot from your Mac or phone.
3. If your device opens a setup browser automatically, use it. Otherwise open `http://vibetv.local`. If that does not load, open `http://192.168.4.1`.
4. Choose your home WiFi, enter the password, and save.
5. After Vibe TV restarts, the display shows `vibetv.local` plus a fallback IP address.
6. Open `https://app.vibetv.shop` on your Mac.
7. Follow the setup steps in the app. If it asks for the Mac App, copy the shown prompt into Codex/Claude Code or copy the Terminal command into Terminal.
8. If the app asks for a Vibe TV address, use `vibetv.local` or the IP address shown on the Vibe TV screen.
9. Select `Connect VibeTV`.

Normal customer setup does not require USB flashing or a signed macOS package. The first rollout uses a copied Terminal command because there is no notarized Apple installer yet.

If the device shows `Open Setup`, the hardware is usually fine. It means Vibe TV is on WiFi and is waiting for the Mac App.

To reset WiFi setup, open the Vibe TV setup page in a browser and use `Reset WiFi Setup`. If the device is not reachable, unplug power during early boot three times in a row; on the next boot, Vibe TV clears saved WiFi credentials and starts the `VibeTV-Setup` hotspot.

The full setup guide is in [docs/customer-setup.md](docs/customer-setup.md).

## What This Repo Contains

- ESP8266 firmware for the current Vibe TV target
- the macOS companion `codexbar-display`
- release artifacts such as companion binaries, firmware binaries, and checksums

## How Data Moves

`codexbar-display` is the Mac App binary. It depends on CodexBar because CodexBar knows the local AI usage numbers.

The normal path is:

1. CodexBar reads local provider usage.
2. `codexbar-display` reads CodexBar usage.
3. The local Mac App service lets `app.vibetv.shop` talk to the Mac.
4. `codexbar-display` sends display frames to Vibe TV over WiFi.
5. Vibe TV renders the active theme on the screen.

Important customer/support commands:

```bash
# install or update the Mac App from the current release
curl -fsSL https://app.vibetv.shop/install-control-center-companion.sh | bash -s -- --terminal-session

# check whether the local Mac App service is running
curl -fsS http://127.0.0.1:47832/v1/status

# stop the local Mac App service
curl -fsSL https://app.vibetv.shop/install-control-center-companion.sh | bash -s -- --uninstall
```

## Technical References

These docs are for development, support, and operations:

- Hardware contract: [docs/hardware-contract.md](docs/hardware-contract.md)
- Operator runbook: [docs/operator-runbook.md](docs/operator-runbook.md)
- Firmware provisioning: [docs/firmware-provisioning.md](docs/firmware-provisioning.md)
- Protocol: [protocol/PROTOCOL.md](protocol/PROTOCOL.md)

## Local Development

### Live Device Safety

The attached Vibe TV is not a routine test target. Local development must use unit tests, mocks, and read-only device checks first.

Allowed read-only checks:

```bash
curl http://vibetv.local/hello
curl http://vibetv.local/health
curl http://vibetv.local/assets
```

Do not run firmware updates, theme-pack installs, asset uploads, frame posts, or WiFi resets against `vibetv.local` or a device IP unless a human has explicitly approved that exact hardware test. After one failed hardware write test, stop and debug with code/tests before touching the device again.

```bash
cd companion
go test ./...
go vet ./...

cd ..
./scripts/check-esp8266-soak-gate.sh
pio run -d firmware_esp8266 -e esp8266_smalltv_st7789
```

Release firmware is not flashed from a local PlatformIO build. Use WiFi OTA for normal devices:

```bash
codexbar-display install-update --target http://vibetv.local --confirm-live-update
```

Direct `pio` uploads are blocked unless `CODEXBAR_DISPLAY_ALLOW_SOURCE_UPLOAD=1` is set for an intentional source firmware test.

## License

Released under the MIT License. See [LICENSE](LICENSE).
