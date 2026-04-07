# Vibe TV Customer Setup

This page is for people who bought a Vibe TV and want it to work on a Mac with the smallest possible setup.

## What you need

- a Vibe TV
- a USB data cable
- a Mac with internet access
- the installer from the latest GitHub Release

## What the setup is

For customers, the setup should feel like one command.
Under the hood, that command is a small shell script called `install.sh`.
The script downloads the correct release assets, installs the companion, checks CodexBar, and starts the background service that sends frames to the display.

## Expected install flow

```bash
curl -fsSL https://github.com/DreamyTalesPAN/CodexBar-Display/releases/latest/download/install.sh | bash
```

What happens next:

1. the script detects your Mac architecture
2. it downloads the matching `codexbar-display` binary from GitHub Releases
3. it verifies the download
4. it installs CodexBar if needed
5. it runs `codexbar-display setup --yes --skip-flash`
6. it warms up CodexBar on fresh installs until provider data is available
7. it runs a health check so you can confirm the companion is ready

## What success looks like

- the terminal prints a setup success message
- the Vibe TV stops showing `Waiting for frames`
- usage appears automatically on the display

## If something goes wrong

- `Waiting for frames` usually means the Mac companion is not running yet
- if the device is not detected, unplug and reconnect the USB cable
- if CodexBar is missing, rerun the installer after confirming internet access

## Next step

If you want the technical details, read the [hardware contract](hardware-contract.md) and [operator runbook](operator-runbook.md).
