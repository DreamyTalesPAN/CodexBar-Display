# Vibe TV Setup on Mac

This guide covers the standard macOS setup flow: connect Vibe TV to WiFi, install the Mac Companion, and point it at the Vibe TV IP.

## What You Need

- a Vibe TV
- USB-C power for Vibe TV
- a Mac with internet access

## Connect Vibe TV to WiFi

Vibe TV ships with firmware installed. USB debugging and manual firmware flashing are not part of the standard setup flow.

1. Plug Vibe TV into power.
2. Wait for the `VibeTV-Setup` hotspot.
3. Join `VibeTV-Setup` from your Mac or phone.
4. If your device opens a setup browser automatically, use it. Otherwise open `http://vibetv.local`. If that does not load, open `http://192.168.4.1`.
5. Select your home WiFi, enter the password, and save.
6. Vibe TV restarts and connects to your WiFi. The display shows `Open Setup` and `vibetv.local`.

## Install the Mac Companion

Choose one path.

### AI-native path

Copy this prompt into any AI:

```text
I connected my Vibe TV to home WiFi through the VibeTV-Setup hotspot. Please help me set up the Mac Companion end-to-end over WiFi.

Your job:
- Assume I want the standard setup flow on macOS.
- If you have terminal or tool access, do the setup yourself instead of asking me to copy commands.
- Use the official installer:
  curl -fsSL https://github.com/DreamyTalesPAN/CodexBar-Display/releases/latest/download/install.sh | bash -s -- --transport wifi --target http://vibetv.local --theme mini
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
- check the daemon target with --transport wifi --target http://vibetv.local

If you cannot act directly, do not dump a long checklist. Give me only the next action, wait for the result, and then continue.
```

### Alternative: run the installer directly

Open `http://vibetv.local` in your browser and select `Copy Mac Setup Command`.
Then open Terminal and paste the copied command. It looks like this:

```bash
curl -fsSL https://github.com/DreamyTalesPAN/CodexBar-Display/releases/latest/download/install.sh | bash -s -- --transport wifi --target http://vibetv.local --theme mini
```

The Web UI also shows the fallback IP if `.local` does not resolve.

### Firmware update path

If support asks you to update the firmware, run:

```bash
curl -fsSL https://github.com/DreamyTalesPAN/CodexBar-Display/releases/latest/download/install.sh | bash -s -- --flash-firmware
```

Firmware flashing requires PlatformIO CLI (`pio`). If it is missing, the installer will stop with a recovery hint.

If you need to use a specific serial port, run:

```bash
curl -fsSL https://github.com/DreamyTalesPAN/CodexBar-Display/releases/latest/download/install.sh | bash -s -- --flash-firmware -- --port /dev/cu.usbserial-110
```

## What the Installer Does

The installer handles everything automatically:

1. It detects your Mac architecture.
2. It downloads the matching `codexbar-display` version from the latest GitHub release.
3. It verifies the checksum.
4. It installs CodexBar if CodexBar is missing.
5. It runs `codexbar-display setup --yes --skip-flash --transport wifi --target http://vibetv.local --theme mini`.
6. It starts the background service that sends frames to the Vibe TV IP.
7. If `--flash-firmware` is passed, it downloads the matching firmware from the GitHub release, verifies it, and flashes the connected device.
8. It runs a health check at the end.

## What Success Looks Like

- Terminal prints a successful setup message.
- The device no longer stays on the Open Setup screen.
- Usage appears automatically on the display.

## If Something Does Not Work

- `Open Setup` means Vibe TV is on WiFi and is waiting for the Mac Companion setup command.
- `Check Mac App` means Vibe TV had data before, but no fresh frame arrived for more than two minutes.
- `Update Mac App` means the Mac Companion can reach Vibe TV, but the usage app needs an update.
- If WiFi sending fails, verify `http://vibetv.local` opens from the Mac. The API check is `http://vibetv.local/hello`.
- If the IP changed, rerun the installer with the new `--target`.
- If CodexBar is missing or does not start, run the installer again.

## Reset WiFi Setup

If Vibe TV is reachable in the browser, open its setup page and select `Reset WiFi Setup`. The device clears saved WiFi credentials, restarts, and opens the `VibeTV-Setup` hotspot again.

If the device is not reachable, unplug power during early boot three times in a row. On the next boot, Vibe TV clears saved WiFi credentials and starts `VibeTV-Setup`.

## Important

- The standard setup flow is for macOS.
- You do not need to flash firmware manually in the standard setup flow.
- USB-C is used for power in the standard setup flow. USB serial remains available for development and support.
