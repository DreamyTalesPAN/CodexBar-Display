# codexbar-display Status

## Current Focus

- stable customer setup on Mac
- a one-command install flow without manual flashing
- automatic background service startup after setup

## Verified

- [x] Fresh customer install via `install.sh` works on macOS arm64.
- [x] CodexBar is installed automatically when needed.
- [x] The setup flow auto-detects the USB port.
- [x] The LaunchAgent starts automatically after setup.
- [x] The device receives frames automatically after setup.
- [x] `./scripts/smoke-daemon-sent-frame.sh` is green.
- [x] `go test ./...`, `go vet ./...`, `pio run -d firmware_esp8266 -e esp8266_smalltv_st7789`, and `./scripts/check-esp8266-soak-gate.sh` are green.
- [x] E2E setup has been validated on two macOS machines.

## Not Part of the Current Setup Milestone

- formal release-readiness checklist
- `RC -> soak -> final`
- additional SDK or theme-packaging work
