# ESP8266 Weather Display Spike

This spike tests whether the supplier weather display can run custom firmware.
It does not change the current ESP32-S3 production path.

## What Is Included

- `firmware_esp8266` project with two PlatformIO environments:
  - `esp8266_probe`: protocol + serial probe only (safe first step)
  - `esp8266_ili9341_spi`: optional display render target with default ILI9341 SPI pins

## Build And Flash

```bash
cd firmware_esp8266

# safe first target (no display dependency)
pio run -e esp8266_probe
pio run -e esp8266_probe -t upload --upload-port /dev/cu.usbserial-10

# optional display target (adjust pins/driver as needed)
pio run -e esp8266_ili9341_spi
pio run -e esp8266_ili9341_spi -t upload --upload-port /dev/cu.usbserial-10
```

Or from repo root:

```bash
pio run -d firmware_esp8266 -e esp8266_probe -t upload --upload-port /dev/cu.usbserial-10
```

## Verify Protocol

```bash
cd companion
go run ./cmd/vibeblock daemon --port /dev/cu.usbserial-10 --once
```

Expected serial output from probe firmware:

- `vibeblock_ready_probe`
- `frame_received`
- `probe_usage ...` or `probe_error ...`

## Required Preflight

- Stop any process holding `/dev/cu.usbserial-10` before flashing.
- If vibeblock daemon is running, stop it first:

```bash
launchctl bootout gui/$(id -u)/com.vibeblock.daemon
lsof /dev/cu.usbserial-10 /dev/tty.usbserial-10
```

- Backup supplier firmware before first write:

```bash
./scripts/esp8266-backup.sh /dev/cu.usbserial-10
```

The backup script reads in 16KB chunks with retry + timeout and is more reliable on unstable CH340 serial links.

## Restore Supplier Firmware

```bash
./scripts/esp8266-restore.sh /dev/cu.usbserial-10 tmp/weather_backup_YYYYMMDD_HHMMSS.bin
```

You can also restore the validated backup captured during this spike:

```bash
./scripts/esp8266-restore.sh /dev/cu.usbserial-10 tmp/backup_chunks_20260226_090152/weather_backup_full.bin
```

Start daemon again after restore/flash:

```bash
launchctl bootstrap gui/$(id -u) "$HOME/Library/LaunchAgents/com.vibeblock.daemon.plist"
launchctl kickstart -k gui/$(id -u)/com.vibeblock.daemon
```

## Notes

- The connected prototype identifies as ESP8266 + CH340 USB serial bridge.
- Display controller/pinout may differ from defaults. Adjust `esp8266_ili9341_spi` build flags accordingly.
- Backup image string scan confirms supplier app is "Smart Weather Clock" firmware (OpenWeatherMap/web UI endpoints).
- No clear controller signature (`ILI9341`/`ST7789` strings) was found in the backup image, so PCB/pinout data from supplier is still required for display bring-up.
