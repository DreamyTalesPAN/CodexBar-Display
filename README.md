# vibeblock

Physical CodexBar status display for desk use.

This project reads local usage data from `codexbar usage --json` and renders one provider on a USB-connected LILYGO T-Display-S3.

## Project Docs
- Product requirements: `vibeblock-prd.md`
- Execution checklist: `TODO.md`

## MVP Scope
- macOS only
- One connected display
- Provider at index `0` from CodexBar output
- USB serial transport (no WiFi/BLE in V1)

## Start Here
1. Read `TODO.md`
2. Connect board and verify serial device path (`/dev/cu.usbmodem*`)
3. Build firmware bring-up target
4. Build companion daemon

## Quickstart (Current)

```bash
# flash firmware
cd firmware
pio run -e lilygo_t_display_s3 -t upload --upload-port /dev/cu.usbmodem101

# run daemon with real CodexBar data
cd ../companion
go run ./cmd/vibeblock doctor
go run ./cmd/vibeblock daemon --port /dev/cu.usbmodem101 --interval 60s
```

Companion supports both:
- `codexbar` CLI in `PATH`
- Desktop app helper (`CodexBarCLI`) inside `CodexBar.app`
