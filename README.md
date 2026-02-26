# vibeblock

Physical CodexBar status display for desk use.

This project reads local usage data from `codexbar usage --json` and renders one provider on a USB-connected display.

## Project Docs
- Operator runbook (single source of truth): `docs/operator-runbook.md`
- Product requirements: `vibeblock-prd.md`
- Execution checklist: `TODO.md`
- Provider selection rules: `docs/provider-selection.md`
- Provider activity detectors: `docs/provider-activity-sources.md`
- Milestone 1 test matrix: `docs/m1-test-matrix.md`
- Supplier hardware checklist: `docs/supplier-hardware-checklist.md`
- ESP8266 hardware spike notes: `docs/esp8266-spike.md`

## External References (Smart Weather Clock)
- Original supplier firmware (ESP8266 SmallTV): https://github.com/GeekMagicClock/smalltv
- Supplier PRO firmware repo (ESP32): https://github.com/GeekMagicClock/smalltv-pro
- Hardware pinout discussion used for this spike: https://github.com/GeekMagicClock/smalltv/issues/4
- Community ESPHome adaptation: https://github.com/ViToni/esphome-geekmagic-smalltv

## Quickstart

```bash
cd companion

# full setup (flash + install + launch agent)
go run ./cmd/vibeblock setup --yes

# runtime-only update on already flashed devices
go run ./cmd/vibeblock setup --yes --skip-flash --port /dev/cu.usbserial-10

# one-shot health snapshot
go run ./cmd/vibeblock health
```

Operator procedures (setup, recovery, smoke test, troubleshooting) are maintained in:

`docs/operator-runbook.md`
