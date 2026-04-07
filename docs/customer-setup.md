# Vibe TV Setup on Mac

This guide is for customers: connect the device, run one command, and you are done.

## What You Need

- a Vibe TV
- a USB data cable
- a Mac with internet access

## Installation

1. Connect the Vibe TV to your Mac.
2. Open Terminal.
3. Run this command:

```bash
curl -fsSL https://github.com/DreamyTalesPAN/CodexBar-Display/releases/latest/download/install.sh | bash
```

## What the Installer Does

The installer handles everything automatically:

1. It detects your Mac architecture.
2. It downloads the matching `codexbar-display` version from the latest GitHub release.
3. It verifies the checksum.
4. It installs CodexBar if CodexBar is missing.
5. It runs `codexbar-display setup --yes --skip-flash`.
6. It starts the background service that sends frames to the display.
7. It runs a health check at the end.

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
