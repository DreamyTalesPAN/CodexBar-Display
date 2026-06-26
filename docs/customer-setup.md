# VibeTV Setup on Mac

This guide is for the normal customer setup. It uses WiFi for VibeTV and the Control Center website for the Mac App.

## What You Need

- VibeTV
- USB-C power for VibeTV
- a Mac with internet access
- your home WiFi name and password

## Set Up WiFi

1. Plug VibeTV into power.
2. Wait for the `VibeTV-Setup` WiFi hotspot.
3. Join `VibeTV-Setup` from your Mac or phone.
4. If a setup page opens automatically, use it. Otherwise open `http://vibetv.local`. If that does not load, open `http://192.168.4.1`.
5. Choose your home WiFi, enter the password, and save.
6. Wait while VibeTV restarts. When WiFi is ready, the display shows `WiFi connected!` and `app.vibetv.shop`.

## Set Up the Mac App

1. On your Mac, open `https://app.vibetv.shop`.
2. Follow the setup steps shown in the app.
3. If the app asks for the Mac App, use the Agentic setup prompt or the Terminal command shown there.
4. Paste the prompt into Codex/Claude Code, or paste the command into Terminal and press Enter.
5. Return to `https://app.vibetv.shop`.
6. If your browser asks for local network access, allow it.
7. Select the main button in the app to find and connect VibeTV.

Normal setup does not require USB flashing or a signed macOS installer. It does use a copied Terminal command for the Mac App during the first rollout.

## What the Mac App Does

The Mac App is the `codexbar-display` binary from this repository. It is installed under your user account and started from the Terminal command.

Why it exists:

- CodexBar reads the usage numbers on your Mac.
- `codexbar-display` reads those numbers from CodexBar.
- `app.vibetv.shop` talks to `codexbar-display` on this Mac.
- `codexbar-display` sends the screen data to VibeTV over your WiFi.

Useful support commands:

```bash
# check whether the Mac App is running
curl -fsS http://127.0.0.1:47832/v1/status

# install or update the Mac App
curl -fsSL https://app.vibetv.shop/install-control-center-companion.sh | bash -s -- --terminal-session

# stop the Mac App
curl -fsSL https://app.vibetv.shop/install-control-center-companion.sh | bash -s -- --uninstall
```

## What Success Looks Like

- The app shows VibeTV as connected.
- VibeTV no longer stays on the setup screen.
- Usage appears automatically on the display.

## Display Messages

| Display | Meaning | What to do |
| --- | --- | --- |
| `Starting` | VibeTV is booting. | Wait. |
| `SETUP WIFI` / `VibeTV-Setup` | VibeTV needs WiFi setup. | Join the `VibeTV-Setup` WiFi and open the address shown on the display. |
| `Connecting WiFi` | VibeTV is joining your home WiFi. | Wait. |
| `WiFi connected!` / `app.vibetv.shop` | WiFi works. | Open `https://app.vibetv.shop` on your Mac and follow the main button. |
| `Open App` / `app.vibetv.shop` | VibeTV is waiting for fresh Mac data. | Open `https://app.vibetv.shop` on your Mac and follow the main button. |
| `Install Mac App` | The Mac App is missing. | Open `https://app.vibetv.shop` and run the shown Mac App setup step. |
| `Update Mac App` | The Mac App needs an update. | Open `https://app.vibetv.shop` and copy the shown update command. |
| `Update available` | VibeTV has an update ready. | Open `https://app.vibetv.shop` and follow the main button. |
| `Update running` | VibeTV is being updated. | Do not unplug power. |
| `WiFi reset` | Saved WiFi settings are being cleared. | Wait for `VibeTV-Setup` to appear again. |

## If Something Does Not Work

- If `https://app.vibetv.shop` says the Mac App is not ready, run the Mac App setup step from the app.
- If the app cannot find VibeTV, check that your Mac and VibeTV are on the same WiFi.
- If the app cannot find VibeTV, make sure your Mac and VibeTV are on the same WiFi, then restart VibeTV and try again.
- If the app does not show an install or update button when you need one, contact support.

## Reset WiFi Setup

If VibeTV is reachable in the browser, open its setup page and select `Reset WiFi Setup`.

If the device is not reachable, unplug power during early boot three times in a row. On the next boot, VibeTV clears saved WiFi credentials and starts `VibeTV-Setup`.

## Important

- The standard setup flow is for macOS.
- USB-C is only for power in normal setup.
- USB flashing is only for support and development.
- There is no signed Apple package in the first rollout.
