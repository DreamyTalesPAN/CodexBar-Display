# Supplier Hardware Checklist (ESP8266/ESP32 Display)

Send this to the supplier before ordering a batch. Without these answers, firmware support remains guesswork.

## Mandatory BOM + Board Identity

- Exact MCU model: `ESP8266EX`, `ESP32-S3`, etc.
- Exact module part: `ESP-12F`, `ESP32-S3-WROOM-1`, etc.
- Flash size/type: `4MB/8MB`, QIO/DIO.
- USB bridge chip: `CH340`, `CP2102`, native USB.
- Board revision / PCB mark / product SKU.

## Display Hardware Contract

- LCD controller IC: `ILI9341`, `ST7789`, `ST7796`, etc.
- Display interface: SPI / 8-bit parallel / RGB.
- Resolution + color format (for example `320x480 RGB565`).
- Rotation default (0/1/2/3) and mechanical orientation.
- Backlight control pin + active level.
- Touch controller IC (if present): `XPT2046`, `CST816`, etc.

## Pin Mapping (required)

For SPI displays:
- `MOSI`, `MISO`, `SCLK`, `CS`, `DC`, `RST`, `BL`

For parallel displays:
- `D0..D7`, `WR`, `RD`, `CS`, `DC`, `RST`, `BL`

Also ask for:
- GPIO strapping pins (boot-critical pins).
- Any pin shared with buttons, LEDs, buzzer, sensors.

## Flash + Factory Process

- Confirm firmware can be flashed via USB without opening the case.
- Confirm auto-reset/auto-boot circuit is present (`EN`/`IO0` control).
- Ask for factory image backup file (`.bin`) for recovery.
- Ask for test command they use to verify display at factory.

## Ask Supplier To Provide

- Clear photo of PCB front/back (all IC markings readable).
- Schematic excerpt or pin table for MCU <-> display.
- Existing PlatformIO/Arduino sample (if any).
- Confirmation they can deliver the exact same board revision per order.

