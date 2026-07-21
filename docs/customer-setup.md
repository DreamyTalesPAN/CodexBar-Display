# VibeTV Setup On Mac

This is the normal customer setup for the Control Center launch flow.

You use:

- VibeTV hardware
- USB-C power
- your home WiFi
- a Mac
- [app.vibetv.shop](https://app.vibetv.shop)

You do not need USB flashing, PlatformIO, firmware source builds, or a signed
macOS package for normal setup.

<p align="center">
  <img src="assets/vibetv-hardware-detail.png" alt="VibeTV hardware on a desk" width="520">
</p>

## What You Are Setting Up

VibeTV has two setup parts:

1. **Put VibeTV on WiFi.** The device needs to be on the same local network as
   your Mac.
2. **Install the Mac App.** The Mac App reads CodexBar usage locally and sends
   display updates to VibeTV.

The Control Center website guides both parts.

## 1. Connect VibeTV To WiFi

1. Plug VibeTV into power.
2. Wait until the display shows `VibeTV-Setup`.
3. Open WiFi settings on your phone or Mac.
4. Join the `VibeTV-Setup` WiFi network.
5. If the setup page opens automatically, use it.
6. If it does not open, go to `http://192.168.4.1`.
7. Choose a 2.4 GHz home WiFi and save. Use `Search again` if the network list
   is stale, or enter the WiFi name manually for a hidden network.
8. Wait until VibeTV restarts and shows that WiFi is connected.

When this is done, VibeTV should point you to:

```text
app.vibetv.shop
```

## 2. Open Control Center

On your Mac, open:

```text
https://app.vibetv.shop
```

Control Center checks whether the Mac App is running on this computer.

If the Mac App is missing, Control Center shows two setup paths:

- **Agentic setup:** copy the prompt into Codex, Claude Code, or another local
  coding agent with Terminal access.
- **Manual setup:** copy the Terminal command and run it yourself.

Both paths install or update the same Mac App.

## 3. Install The Mac App

The normal Terminal command looks like this:

```bash
curl -fsSL https://app.vibetv.shop/install-control-center-companion.sh | bash
```

The command:

- downloads the current Mac App release,
- verifies the checksum,
- installs `codexbar-display` for your user account,
- starts the local Mac App service,
- verifies `http://127.0.0.1:47832/v1/status`.

After the command finishes, return to Control Center. The page should move
forward automatically once the Mac App is available.

## 4. Allow Browser Access

Your browser may ask whether `app.vibetv.shop` can access devices on your local
network. Allow it.

That permission lets the website talk to the Mac App on:

```text
127.0.0.1:47832
```

It does not give the website your WiFi password or provider credentials.

## 5. Connect VibeTV

Control Center will try to find VibeTV on the same WiFi.

If it finds exactly one device, it connects automatically.

If it cannot find the device, enter the address shown on VibeTV, for example:

```text
192.168.178.123
```

Then select `Connect VibeTV`.

## What Success Looks Like

- Control Center says VibeTV is connected.
- VibeTV stops waiting on the setup screen.
- Usage appears on the display.
- Overview, Usage, Theme Library, Settings, Updates, and Support are available
  in Control Center.

## What The Mac App Does

The Mac App is the `codexbar-display` binary from this repository.

It exists because:

- CodexBar reads AI provider usage on your Mac.
- The Mac App reads that usage from CodexBar.
- Control Center talks to the Mac App locally.
- The Mac App sends screen updates to VibeTV over local WiFi.

Useful support commands:

```bash
# Check whether the Mac App is running.
curl -fsS http://127.0.0.1:47832/v1/status

# Install or update the Mac App.
curl -fsSL https://app.vibetv.shop/install-control-center-companion.sh | bash

# Restart the Mac App.
curl -fsSL https://app.vibetv.shop/install-control-center-companion.sh | bash -s -- --restart

# Stop the Mac App.
curl -fsSL https://app.vibetv.shop/install-control-center-companion.sh | bash -s -- --uninstall
```

## Display Messages

| Display | Meaning | What to do |
| --- | --- | --- |
| `Starting` | VibeTV is booting. | Wait. |
| `SETUP WIFI` / `VibeTV-Setup` | VibeTV needs WiFi setup. | Join `VibeTV-Setup` and open the setup page. |
| `Connecting WiFi` | VibeTV is joining your home WiFi. | Wait. |
| `WiFi connected!` / `app.vibetv.shop` | VibeTV is on WiFi. | Open Control Center on your Mac. |
| `Open App` / `app.vibetv.shop` | VibeTV is waiting for fresh Mac data. | Open Control Center and connect VibeTV. |
| `Install Mac App` | The Mac App is missing. | Use the setup step in Control Center. |
| `Update Mac App` | The Mac App needs an update. | Use the update step in Control Center. |
| `Update available` | A device update is available. | Open Control Center and follow the update step. |
| `Update running` | VibeTV is updating. | Do not unplug power. |
| `WiFi reset` | Saved WiFi settings are being cleared. | Wait for `VibeTV-Setup` to appear again. |

## If Something Does Not Work

- If Control Center says the Mac App is not running, run Agentic setup or Manual
  setup again.
- If Control Center cannot find VibeTV, make sure your Mac and VibeTV are on
  the same WiFi.
- If `.local` does not work, use the IP address shown on VibeTV.
- If VibeTV is still on `VibeTV-Setup`, finish WiFi setup first.
- If the app shows one clear action, use that action before trying support
  commands.

## Reset WiFi

If VibeTV is reachable in the browser, open the local device page and use
`Reset WiFi Setup`.

If the device is not reachable, unplug power during early boot three times in a
row. On the next boot, VibeTV clears saved WiFi credentials and starts
`VibeTV-Setup`.

## Important

- Normal setup is macOS-first.
- USB-C is only for power in normal setup.
- USB flashing is only for support and development.
- Firmware updates, theme installs, WiFi resets, and asset uploads are hardware
  write actions. They should happen only through the intended Control Center
  flow or during an approved support test.
