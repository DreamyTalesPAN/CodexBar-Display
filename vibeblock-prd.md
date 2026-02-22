# PRD: vibeblock 1

**Status:** Draft v0.5
**Date:** February 2026

---

## Summary

vibeblock 1 is a small USB display you put on your desk. It shows the AI usage of one provider in real time — session limit, weekly limit, time until reset. No app, no account, no subscription. Plug it in, run one command, done.

---

## Foundation: CodexBar

vibeblock builds on [CodexBar](https://github.com/steipete/CodexBar) by Peter Steinberger.

CodexBar is a macOS menu bar app that monitors token and credit limits for 20+ AI coding providers in real time — Claude, Cursor, Copilot, Gemini, OpenRouter, and many more. It reads data directly from the local machine (browser cookies, CLI tools, OAuth tokens) with no cloud service of its own. Everything stays on device.

CodexBar is actively maintained by Pete Steinberger and the community. vibeblock is neither a fork nor a competing product — it is a physical interface for data CodexBar already has.

**The integration point:** vibeblock calls `codexbar usage --json` and processes the output. That is the full extent of the coupling. New providers, bug fixes, and improvements in CodexBar automatically flow through to vibeblock.

---

## Problem

Developers who work heavily with AI tools (Claude, Cursor, Copilot, Gemini, ...) regularly hit quotas. Today: switch tab, open CodexBar, check. This happens dozens of times a day and breaks focus.

A physical display solves this without any interaction. It's just there.

---

## Target User

**Primary:** Developers who already use CodexBar and hit AI limits daily.

**Profile:**
- macOS, Apple Silicon or Intel
- Actively uses 1–3 AI coding tools
- Has a USB hub or a free USB-C port
- Occasionally buys developer gadgets (Stream Deck, Orb, etc.)

**Explicitly out of scope for V1:** Windows users, Linux users, non-CodexBar users.

---

## Customer Journey

**Unboxing**
Small box: device + USB-C cable. No power adapter, no pairing instructions, no manual — just a card with two lines on it.

**Plug in**
USB-C into the laptop. Display lights up immediately:

```
┌────────────────────────┐
│                        │
│      vibeblock 1       │
│                        │
│   brew install         │
│   vibeblock            │
│                        │
│        [QR code]       │
│                        │
└────────────────────────┘
```

**Install the software**
```bash
brew install vibeblock
vibeblock setup
```

`vibeblock setup` does exactly three things:
1. Checks whether CodexBar is installed — if not, opens the CodexBar installation page
2. Flashes the firmware onto the connected device
3. Registers the daemon as a launchd service and starts it

No provider selection, no custom configuration. CodexBar is the single source of truth.
Which providers the display shows is configured in CodexBar — not in vibeblock.

**Running**
Within seconds the display shows:

```
┌────────────────────────┐
│ Claude                 │
│                        │
│ Session  ████░░░  73%  │
│ Weekly   ██░░░░░  45%  │
│                        │
│ Reset in   2h 14m      │
└────────────────────────┘
```

**Daily use**
Open the laptop, display is there. Data updates automatically. Nothing to do.

---

## Hardware: MVP

**Board:** LILYGO T-Display-S3 (Black Housing Edition)

| Component  | Spec                                          |
|------------|-----------------------------------------------|
| MCU        | ESP32-S3R8, Dual-core LX7, 240 MHz           |
| Display    | 1.9" LCD, 170×320px, ST7789V                 |
| Flash      | 16 MB                                         |
| RAM        | 512 KB + 8 MB PSRAM                           |
| USB        | USB-C (native USB CDC, no FTDI chip)         |
| WiFi       | 802.11 b/g/n (2.4 GHz)                       |
| Bluetooth  | BLE 5.0                                       |
| Battery    | 1.25mm JST, 3.7V LiPo (optional)             |
| Dimensions | 62 × 26 mm                                   |
| Enclosure  | Black housing included                        |

**Why this board for V1:**
- Native USB-C, no external chip required
- ESP32-S3 has USB CDC out of the box (serial over USB, no driver needed on macOS)
- Enclosure already included — no 3D printing for the prototype
- WiFi/BLE on board for future features without a hardware revision
- Arduino + MicroPython support, large community

**What we do NOT use from this hardware in V1:**
- WiFi (USB is sufficient; WiFi is V2)
- BLE
- Battery connector

---

## V1 Scope

### In scope

| Area             | Description                                                                   |
|------------------|-------------------------------------------------------------------------------|
| Hardware         | LILYGO T-Display-S3, Black Housing, USB-C cable                              |
| Firmware         | Displays the first active provider from CodexBar (index 0)                   |
| Companion        | macOS daemon, reads `codexbar usage --json`, sends over USB serial to device |
| Install          | `brew install vibeblock` + `vibeblock setup`                                 |
| Setup            | Checks CodexBar installation, flashes firmware, starts daemon — done         |
| Autostart        | launchd service, starts with macOS                                            |
| Provider support | Automatically all providers CodexBar knows, no code required on our side     |
| Firmware update  | Manual via UF2 / OTA over serial (TBD)                                       |

### Out of scope

- Windows, Linux
- Multiple providers rotating on one display
- Managing multiple devices simultaneously
- WiFi-based data transfer
- Cloud, account, subscription
- Mobile app
- Own provider config or setup UI (that is CodexBar's job)
- Own data fetching without CodexBar

---

## Technical Architecture

```
CodexBar (third-party project, runs as menu bar app)
    │
    │  $ codexbar usage --json
    │  → array of all active providers with usage data
    ▼
vibeblock daemon (our project, runs as launchd service)
    │  - polls every 60s
    │  - locates codexbar binary (/opt/homebrew/bin, /usr/local/bin, ...)
    │  - serializes to device protocol
    │  USB-C → USB CDC serial
    ▼
ESP32-S3 firmware (our project)
    │  - receives JSON lines
    │  - renders on ST7789V display (170×320px)
    │  - counts down reset timer locally
    ▼
1.9" LCD
```

**Protocol:** JSON lines over USB serial (USB CDC, no driver needed on macOS)

```json
{"v":1,"provider":"claude","label":"Claude","session":73,"weekly":45,"resetSecs":8040}
```

**Companion language:** TBD — Node.js (npx-compatible) or Go (single binary, brew-friendly)

---

## Repository Structure

```
vibeblock/
├── companion/           # host daemon
│   ├── src/
│   │   ├── daemon.js        # poll loop, USB send
│   │   ├── codexbar.js      # locate binary, run --json, parse output
│   │   ├── serial.js        # USB CDC connection + hotplug
│   │   └── setup.js         # interactive setup, launchd registration
│   ├── install/
│   │   └── launchd.plist
│   └── test/
│       └── fixtures/        # real codexbar --json output per version
│           ├── v0.17-all-providers.json
│           └── v0.16-claude-only.json
│
├── firmware/            # ESP32-S3 firmware
│   ├── src/
│   │   ├── main.c
│   │   ├── display.c        # ST7789V driver, rendering
│   │   ├── protocol.c       # JSON lines parser
│   │   ├── usb_cdc.c        # USB serial
│   │   └── screens.c        # welcome screen, usage screen, error screen
│   ├── include/
│   │   └── protocol.h
│   └── CMakeLists.txt
│
├── protocol/            # contract between companion and firmware
│   ├── PROTOCOL.md
│   └── schema.json
│
├── hardware/            # for a future custom PCB revision
│   └── bom.md
│
└── docs/
    ├── setup-guide.md
    ├── troubleshooting.md
    └── firmware-update.md
```

**Licenses:**
- Software: MIT
- Hardware design (if custom PCB): CERN-OHL-P

---

## Design Principle: vibeblock is dumb

vibeblock is intentionally as dumb as possible. It has no configuration of its own, no UI of its own, no opinions of its own.

| Question | Answer |
|---|---|
| Which providers exist? | CodexBar knows. |
| How do I authenticate? | CodexBar handles that. |
| Which provider is displayed? | The first one in `codexbar usage --json` (index 0). |
| What if a new provider is added? | Do nothing — CodexBar updates, vibeblock shows it automatically. |
| What if the auth scheme changes? | Do nothing — CodexBar fixes it, vibeblock benefits. |

If a user wants to see a different provider as primary, they change the order in CodexBar. vibeblock follows blindly.

vibeblock has one responsibility: cleanly rendering data from `codexbar usage --json` on a 1.9" display.

---

## Open Questions

| # | Question | Decide by |
|---|---|---|
| 1 | Companion language: Node.js or Go? | repo setup |
| 2 | Firmware framework: ESP-IDF (C) or Arduino (C++)? | firmware start |
| 3 | Firmware update V1: manual UF2 or OTA over serial? | firmware start |
| 4 | "First provider" logic: what if all providers return errors? | daemon implementation |
| 5 | Distribution: own webshop, Kickstarter, or both? | — |
| 6 | Price point? | — |
| 7 | Homebrew tap: own tap or Homebrew Core? | companion done |

---

## Missing / Feedback
