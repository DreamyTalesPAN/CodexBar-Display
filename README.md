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
6. Open `http://vibetv.local` in your browser. If that does not load, use the fallback IP shown on the display. Then select `Copy Mac Setup Command`.
7. Open Terminal (on Mac: Cmd + Space, type Terminal, hit enter), paste the copied command, and press Enter.

```bash
curl -fsSL https://github.com/DreamyTalesPAN/CodexBar-Display/releases/latest/download/install.sh | bash
```

The installer defaults to WiFi, `http://vibetv.local`, and the Mini theme.

Or copy this prompt into any AI:

```text
I plugged in my Vibe TV and connected it to my home WiFi through the VibeTV-Setup hotspot. Please help me set up the Mac Companion end-to-end over WiFi.

Your job:
- Assume I want the standard setup flow on macOS.
- If you have terminal or tool access, do the setup yourself instead of asking me to copy commands.
- Use the official installer:
  curl -fsSL https://github.com/DreamyTalesPAN/CodexBar-Display/releases/latest/download/install.sh | bash
- After running it, verify that the setup worked.
- Only if you cannot run commands yourself, explain exactly what I should do in simple ELI5 language, one small step at a time.

Success means:
- setup completes without errors
- the Vibe TV no longer stays on the Open Setup screen
- usage appears automatically on the display

If something fails, troubleshoot in this order:
- confirm the Vibe TV IP address
- confirm the Mac is on the same WiFi
- rerun the installer
- check that the daemon target is http://vibetv.local

If you cannot act directly, do not dump a long checklist. Give me only the next action, wait for the result, and then continue.
```

The installer:

- checks that you are on macOS
- downloads the matching `codexbar-display` build for your Mac
- verifies the checksum
- installs CodexBar if it is missing
- sets up the background service
- warms up CodexBar on fresh installs
- runs a health check at the end

To stop the background service for good until you explicitly re-enable it:

```bash
codexbar-display service stop
```

To start it again:

```bash
codexbar-display service start
```

If the device shows `Open Setup`, the hardware is usually fine. It means Vibe TV is on WiFi and is waiting for the Mac Companion setup command.

To reset WiFi setup, open the Vibe TV setup page in a browser and use `Reset WiFi Setup`. If the device is not reachable, unplug power during early boot three times in a row; on the next boot, Vibe TV clears saved WiFi credentials and starts the `VibeTV-Setup` hotspot.

The full setup guide is in [docs/customer-setup.md](docs/customer-setup.md).

## What This Repo Contains

- ESP8266 firmware for the current Vibe TV target
- the macOS companion `codexbar-display`
- release artifacts such as companion binaries, firmware binaries, and checksums

## Technical References

These docs are for development, support, and operations:

- Hardware contract: [docs/hardware-contract.md](docs/hardware-contract.md)
- Operator runbook: [docs/operator-runbook.md](docs/operator-runbook.md)
- Firmware provisioning: [docs/firmware-provisioning.md](docs/firmware-provisioning.md)
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
