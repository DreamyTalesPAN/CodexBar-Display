# ESP8266 Weather Display Spike

This spike tests whether the supplier weather display can run custom firmware.
It does not change the current ESP32-S3 production path.

## What Is Included

- `firmware_esp8266` project with multiple PlatformIO environments:
  - `esp8266_probe`: protocol + serial probe only (safe first step)
  - `esp8266_smalltv_st7789`: SmallTV mapping from GeekMagic maintainer comments
  - `esp8266_smalltv_st7789_alt`: fallback mapping seen on some community posts/board revisions

## Build And Flash

```bash
cd firmware_esp8266

# safe first target (no display dependency)
pio run -e esp8266_probe
pio run -e esp8266_probe -t upload --upload-port /dev/cu.usbserial-10

# recommended display target for SmallTV / Smart Weather Clock
pio run -e esp8266_smalltv_st7789
pio run -e esp8266_smalltv_st7789 -t upload --upload-port /dev/cu.usbserial-10

# fallback target if screen stays black
pio run -e esp8266_smalltv_st7789_alt -t upload --upload-port /dev/cu.usbserial-10
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

Companion command wrapper (auto-selects newest known backup in `tmp/` when `--image` is omitted):

```bash
cd companion
go run ./cmd/vibeblock restore-known-good --port /dev/cu.usbserial-10
```

Start daemon again after restore/flash:

```bash
launchctl bootstrap gui/$(id -u) "$HOME/Library/LaunchAgents/com.vibeblock.daemon.plist"
launchctl kickstart -k gui/$(id -u)/com.vibeblock.daemon
```

## Notes

- The connected prototype identifies as ESP8266 + CH340 USB serial bridge.
- Web + issue research indicates this device family is usually ST7789, not ILI9341.
- Confirmed SmallTV (ESP8266) mapping from vendor-maintainer thread:
  - `SCLK=GPIO14`, `MOSI=GPIO13`, `DC=GPIO0`, `RST=GPIO2`, `CS=-1` (tied to GND), `BL=GPIO5` active LOW
  - source: https://github.com/GeekMagicClock/smalltv/issues/4#issuecomment-1740228836
- Current vibeblock firmware orientation on this hardware uses `tft.setRotation(0)` (90° left from prior portrait render).
- Backup image strings contain "Smart Weather Clock" and RandomNerdTutorials references, matching the SmallTV community reverse-engineering track.
- Backup image string scan confirms supplier app is "Smart Weather Clock" firmware (OpenWeatherMap/web UI endpoints).

## Ops Checklist (Current Branch Hardware)

- Runtime install/update (no reflash):
  - `cd companion && go run ./cmd/vibeblock setup --yes --skip-flash --port /dev/cu.usbserial-10`
- Runtime health:
  - `launchctl print gui/$(id -u)/com.vibeblock.daemon | rg "state =|pid ="`
  - `tail -n 20 /tmp/vibeblock-daemon.out.log`
- Known limitation:
  - hardware profile is validated only for this tested SmallTV-compatible unit; other revisions may require `esp8266_smalltv_st7789_alt` or new pin mapping.

## Upstream References

- Original supplier firmware repo (ESP8266): https://github.com/GeekMagicClock/smalltv
- Supplier PRO firmware repo (ESP32): https://github.com/GeekMagicClock/smalltv-pro
- Hardware info thread (pins/controller): https://github.com/GeekMagicClock/smalltv/issues/4
- Community ESPHome adaptation: https://github.com/ViToni/esphome-geekmagic-smalltv
