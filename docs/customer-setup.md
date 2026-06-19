# VibeTV Setup on Mac

This guide is for the normal customer setup. It uses WiFi for VibeTV and the Control Center website for the Mac Companion.

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
6. Wait while VibeTV restarts. The display shows `vibetv.local` and, if needed, an IP address.

## Set Up the Mac Companion

1. On your Mac, open `https://app.vibetv.shop`.
2. Follow the one main button shown in the app.
3. If the app asks you to install Companion, download it, open the downloaded installer, finish the install, then return to the app.
4. If your browser asks for local network access, allow it.
5. When the app asks for a VibeTV address, use `vibetv.local` or the IP address shown on the VibeTV screen.
6. Select `Connect VibeTV`.

Normal setup does not require Terminal, USB flashing, or manual commands.

## What Success Looks Like

- The app shows VibeTV as connected.
- VibeTV no longer stays on the setup screen.
- Usage appears automatically on the display.

## Display Messages

| Display | Meaning | What to do |
| --- | --- | --- |
| `Starting` | VibeTV is booting. | Wait. |
| `Join WiFi` / `VibeTV-Setup` | VibeTV needs WiFi setup. | Join the `VibeTV-Setup` WiFi and open the address shown on the display. |
| `Connecting WiFi` | VibeTV is joining your home WiFi. | Wait. |
| `Open Setup` | WiFi works, but the Mac Companion is not connected yet. | Open `https://app.vibetv.shop` on your Mac. |
| `Check Mac App` | VibeTV is waiting for fresh Mac data. | Open `https://app.vibetv.shop` and check the Companion setup. |
| `Update Mac App` | The Mac Companion needs an update. | Open `https://app.vibetv.shop` and follow the update button. |
| `Update running` | VibeTV is being updated. | Do not unplug power. |
| `WiFi reset` | Saved WiFi settings are being cleared. | Wait for `VibeTV-Setup` to appear again. |

## If Something Does Not Work

- If `https://app.vibetv.shop` says Companion is not ready, install or repair Companion from the app.
- If the app cannot find VibeTV, check that your Mac and VibeTV are on the same WiFi.
- If `vibetv.local` does not work, use the IP address shown on the VibeTV screen.
- If the app does not show an install or update button when you need one, contact support.

## Reset WiFi Setup

If VibeTV is reachable in the browser, open its setup page and select `Reset WiFi Setup`.

If the device is not reachable, unplug power during early boot three times in a row. On the next boot, VibeTV clears saved WiFi credentials and starts `VibeTV-Setup`.

## Important

- The standard setup flow is for macOS.
- USB-C is only for power in normal setup.
- USB flashing is only for support and development.
