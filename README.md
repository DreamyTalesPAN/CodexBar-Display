# Vibe TV for Mac

This repository ships the firmware, macOS companion, and release artifacts for [Vibe TV](https://vibetv.shop/).
Vibe TV is the hardware. CodexBar provides the usage signal. `codexbar-display` sends that signal to the screen over USB so usage stays off-screen and on-desk.

## Customer Setup

1. Connect your Vibe TV to your Mac with a USB data cable.
2. Choose one path:

Copy this prompt into any AI:

```text
I just connected my Vibe TV to my Mac via USB. Please help me set it up end-to-end.

Your job:
- Assume I want the normal customer setup flow on macOS.
- Have me run the official installer:
  curl -fsSL https://github.com/DreamyTalesPAN/CodexBar-Display/releases/latest/download/install.sh | bash
- Wait for the installer to finish.
- Then help me verify that the setup worked.

Success means:
- setup completes without errors
- the Vibe TV no longer stays on "Waiting for frames"
- usage appears automatically on the display

If something fails, troubleshoot in this order:
- check whether the USB cable is a data cable
- reconnect the device
- rerun the installer
- if I am using a USB hub, have me test directly on the Mac

Keep the instructions short and practical, and only give me the next action.
```

Alternative: run this installer directly:

```bash
curl -fsSL https://github.com/DreamyTalesPAN/CodexBar-Display/releases/latest/download/install.sh | bash
```

3. Wait for setup to finish.
4. The display should start automatically.

The installer:

- checks that you are on macOS
- downloads the matching `codexbar-display` build for your Mac
- verifies the checksum
- installs CodexBar if it is missing
- sets up the background service
- warms up CodexBar on fresh installs
- runs a health check at the end

If the device shows `Waiting for frames`, the hardware is usually fine. It just means your Mac has not sent any frames yet.

The full customer guide is in [docs/customer-setup.md](docs/customer-setup.md).

## What This Repo Contains

- ESP8266 firmware for the current Vibe TV target
- the macOS companion `codexbar-display`
- release artifacts such as companion binaries, firmware binaries, and checksums

## Technical References

These docs are for development, support, and operations:

- Hardware contract: [docs/hardware-contract.md](docs/hardware-contract.md)
- Operator runbook: [docs/operator-runbook.md](docs/operator-runbook.md)
- Protocol: [protocol/PROTOCOL.md](protocol/PROTOCOL.md)

## Local Development

```bash
cd companion
go test ./...
go vet ./...

cd ..
./scripts/check-esp8266-soak-gate.sh
pio run -d firmware_esp8266 -e esp8266_smalltv_st7789
```

## License

Released under the MIT License. See [LICENSE](LICENSE).
