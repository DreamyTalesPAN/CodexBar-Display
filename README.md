# Vibe TV firmware and companion

This repository contains the firmware and macOS companion layer that powers [Vibe TV](https://vibetv.shop/).
Vibe TV is the hardware. CodexBar provides the usage signal. CodexBar-Display renders it on the screen so usage, limits, and status stay off-screen and on-desk.

If you bought a Vibe TV, start here:

1. Plug the device into your Mac with a USB data cable.
2. Run the installer from the latest GitHub Release.
3. Wait for the companion to finish setup.
4. Usage should appear automatically.

Customer install path:

```bash
curl -fsSL https://github.com/DreamyTalesPAN/CodexBar-Display/releases/latest/download/install.sh | bash
```

What the installer does:

- checks that you are on macOS
- downloads the matching `codexbar-display` release for your Mac
- verifies the download
- installs or updates CodexBar if it is missing
- sets up the background companion
- warms up CodexBar on fresh installs so provider data is available
- runs a health check after setup

If the screen says `Waiting for frames`, the hardware is fine. It just means the host companion has not sent a frame yet.

## What this repo ships

- ESP8266 firmware for the release-gated Vibe TV target
- macOS companion that polls usage and sends frames over USB
- GitHub Release artifacts for firmware, companion binaries, and checksums

## For developers

Current release-gated hardware target:

- `esp8266_smalltv_st7789`

Experimental fallback:

- `lilygo_t_display_s3`

Local build and test:

```bash
cd companion
go test ./...

cd ..
./scripts/check-esp8266-soak-gate.sh
```

Firmware build:

```bash
cd firmware_esp8266
pio run -e esp8266_smalltv_st7789
```

## Docs

- Customer setup: [docs/customer-setup.md](docs/customer-setup.md)
- Hardware contract: [docs/hardware-contract.md](docs/hardware-contract.md)
- Operator runbook: [docs/operator-runbook.md](docs/operator-runbook.md)
- Protocol: [protocol/PROTOCOL.md](protocol/PROTOCOL.md)

## License

Released under the MIT License. See [LICENSE](LICENSE).
