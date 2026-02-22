# vibeblock MVP TODO (Do It Today)

## 1. Repo + Tooling
- [ ] Initialize git repo in this folder
- [ ] Create GitHub repo and push `main`
- [ ] Add base structure:
  - [ ] `companion/`
  - [ ] `firmware/`
  - [ ] `protocol/`
  - [ ] `docs/`

## 2. Hardware Bring-Up (First Milestone)
- [ ] Confirm board is detected on macOS as `/dev/cu.usbmodem*`
- [ ] Flash minimal firmware to draw text: `vibeblock 1`
- [ ] Verify USB CDC serial receives one test line from Mac
- [ ] Keep this as "known-good" fallback firmware

## 3. Protocol Contract
- [ ] Create `protocol/PROTOCOL.md`
- [ ] Lock V1 payload:
  - [ ] `{"v":1,"provider":"claude","label":"Claude","session":73,"weekly":45,"resetSecs":8040}`
- [ ] Define error payload for no-provider / codexbar-unavailable

## 4. Firmware (Display App)
- [ ] Parse one JSON line from serial
- [ ] Render usage screen (label, session bar, weekly bar, reset countdown)
- [ ] Render error screen
- [ ] Local countdown ticks every second without host updates
- [ ] Auto-recover after USB reconnect

## 5. Companion (macOS Daemon)
- [ ] Implement `codexbar usage --json` reader
- [ ] Select provider at index `0` from CodexBar output
- [ ] Serialize payload and send over serial
- [ ] Poll every 60s
- [ ] Reconnect automatically when device disconnects/reconnects

## 6. Setup + Autostart
- [ ] Build `vibeblock setup` command:
  - [ ] Validate CodexBar installed
  - [ ] Flash firmware to connected board
  - [ ] Install/start `launchd` service
- [ ] Validate daemon starts after reboot/login

## 7. Packaging + Docs
- [ ] Add `README.md` quickstart
- [ ] Add `docs/setup-guide.md`
- [ ] Add `docs/troubleshooting.md`
- [ ] Prepare Homebrew tap formula draft

## 8. End-to-End Acceptance
- [ ] Plug in device
- [ ] Run setup once
- [ ] See live CodexBar data on display within 60s
- [ ] Unplug/replug test passes
- [ ] Sleep/wake test passes

## Immediate Next Action (Now)
1. Plug in the LILYGO T-Display-S3 with a data USB-C cable.
2. Run: `ls /dev/cu.usb*`
3. Tell me which `/dev/cu.usbmodem...` entry appears, and I will scaffold/flash the first firmware target next.
