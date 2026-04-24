# Vibe TV Setup on Mac

This guide is for customers: connect the device, run one command, and you are done.

## What You Need

- a Vibe TV
- a USB data cable
- a Mac with internet access

## Installation

1. Connect the Vibe TV to your Mac.
2. Choose one path.

### AI-native path

Copy this prompt into any AI:

```text
I just connected my Vibe TV to my Mac via USB. Please help me set it up end-to-end.

Your job:
- Assume I want the normal customer setup flow on macOS.
- If you have terminal or tool access, do the setup yourself instead of asking me to copy commands.
- Use the official installer:
  curl -fsSL https://github.com/DreamyTalesPAN/CodexBar-Display/releases/latest/download/install.sh | bash
- After running it, verify that the setup worked.
- Only if you cannot run commands yourself, explain exactly what I should do in simple ELI5 language, one small step at a time.

Success means:
- setup completes without errors
- the Vibe TV no longer stays on "Waiting for frames"
- usage appears automatically on the display

If something fails, troubleshoot in this order:
- check whether the USB cable is a data cable
- reconnect the device
- rerun the installer
- if I am using a USB hub, have me test directly on the Mac

If you cannot act directly, do not dump a long checklist. Give me only the next action, wait for the result, and then continue.
```

### Alternative: run the installer directly

Open Terminal and run this command:

```bash
curl -fsSL https://github.com/DreamyTalesPAN/CodexBar-Display/releases/latest/download/install.sh | bash
```

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
5. It runs `codexbar-display setup --yes --skip-flash`.
6. It starts the background service that sends frames to the display.
7. If `--flash-firmware` is passed, it downloads the matching firmware from the GitHub release, verifies it, and flashes the connected device.
8. It runs a health check at the end.

## What Success Looks Like

- Terminal prints a successful setup message.
- The device no longer stays on `Waiting for frames`.
- Usage appears automatically on the display.

## If Something Does Not Work

- `Waiting for frames` usually means the Mac has not sent any frames yet.
- If the device is not detected, unplug the USB cable and reconnect it.
- If CodexBar is missing or does not start, run the installer again.
- If you are using a USB hub, test directly on the Mac.

## Important

- The customer flow is for macOS.
- You do not need to flash firmware manually in the normal customer setup flow.
