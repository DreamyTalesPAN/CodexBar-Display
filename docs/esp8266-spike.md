# ESP8266 Weather Display Spike

This document keeps the hardware/prototyping findings from the ESP8266 branch.
Operator procedures are centralized in:

- `docs/operator-runbook.md`

## Firmware Environments

`firmware_esp8266/platformio.ini` contains:
- `esp8266_probe`: protocol + serial probe only
- `esp8266_smalltv_st7789`: primary SmallTV mapping
- `esp8266_smalltv_st7789_alt`: fallback mapping for alternate revisions

In `setup`, select the target with:

```bash
cd companion
go run ./cmd/vibeblock setup --yes --firmware-env esp8266_smalltv_st7789 --port /dev/cu.usbserial-10
```

## Hardware Findings

- Prototype identifies as ESP8266 + CH340 USB serial bridge.
- Device family research indicates ST7789 panel/controller expectations.
- Confirmed SmallTV mapping from maintainer thread:
  - `SCLK=GPIO14`, `MOSI=GPIO13`, `DC=GPIO0`, `RST=GPIO2`, `CS=-1` (GND), `BL=GPIO5` active LOW
  - source: https://github.com/GeekMagicClock/smalltv/issues/4#issuecomment-1740228836
- Current vibeblock orientation on tested hardware uses `tft.setRotation(0)`.

## Known Constraint

Validated on one tested Smart Weather Clock variant only. Other board revisions may require:
- `esp8266_smalltv_st7789_alt`, or
- a new pin mapping environment.

## Upstream References

- Original supplier firmware repo (ESP8266): https://github.com/GeekMagicClock/smalltv
- Supplier PRO firmware repo (ESP32): https://github.com/GeekMagicClock/smalltv-pro
- Hardware info thread: https://github.com/GeekMagicClock/smalltv/issues/4
- Community ESPHome adaptation: https://github.com/ViToni/esphome-geekmagic-smalltv
