# vibeblock MVP TODO (Do It Today)

## 1. Repo + Tooling
- [x] Initialize git repo in this folder
- [x] Create GitHub repo and push `main`
- [ ] Add base structure:
  - [x] `companion/`
  - [x] `firmware/`
  - [x] `protocol/`
  - [x] `docs/`

## 2. Hardware Bring-Up (First Milestone)
- [x] Confirm board is detected on macOS as `/dev/cu.usbmodem*`
- [x] Flash minimal firmware to draw text: `vibeblock 1`
- [x] Verify USB CDC serial receives one test line from Mac
- [ ] Keep this as "known-good" fallback firmware

## 3. Protocol Contract
- [x] Create `protocol/PROTOCOL.md`
- [ ] Lock V1 payload:
  - [x] `{"v":1,"provider":"claude","label":"Claude","session":73,"weekly":45,"resetSecs":8040}`
- [x] Define error payload for no-provider / codexbar-unavailable

## 4. Firmware (Display App)
- [x] Parse one JSON line from serial
- [x] Render usage screen (label, session bar, weekly bar, reset countdown)
- [x] Render error screen
- [x] Local countdown ticks every second without host updates
- [x] Auto-recover after USB reconnect

## 5. Companion (macOS Daemon)
- [x] Implement `codexbar usage --json` reader
- [x] Select most recently updated provider from CodexBar output
- [x] Serialize payload and send over serial
- [x] Poll every 60s
- [x] Reconnect automatically when device disconnects/reconnects

## 6. Setup + Autostart
- [ ] Build `vibeblock setup` command:
  - [x] Validate CodexBar installed
  - [ ] Flash firmware to connected board
  - [ ] Install/start `launchd` service
- [ ] Validate daemon starts after reboot/login

## 7. Packaging + Docs
- [x] Add `README.md` quickstart
- [x] Add `docs/setup-guide.md`
- [x] Add `docs/troubleshooting.md`
- [ ] Prepare Homebrew tap formula draft

## 8. End-to-End Acceptance
- [x] Plug in device
- [ ] Run setup once
- [x] See live CodexBar data on display within 60s
- [ ] Unplug/replug test passes
- [ ] Sleep/wake test passes

## Immediate Next Action (Now)
1. Start the live daemon loop:
   - `cd companion && ./vibeblock daemon --port /dev/cu.usbmodem101 --interval 60s`
2. Confirm the screen updates every minute with live CodexBar values.
3. Then unplug/replug once to validate reconnect behavior.
