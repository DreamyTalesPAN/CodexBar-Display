# Firmware Update (MVP)

Manual update over USB with PlatformIO:

```bash
launchctl bootout gui/$(id -u)/com.vibeblock.daemon 2>/dev/null || true

# default target (ESP8266 SmallTV)
cd firmware_esp8266
pio run -e esp8266_smalltv_st7789 -t upload --upload-port /dev/cu.usbserial-10

# optional override target (ESP32-S3)
# cd firmware
# pio run -e lilygo_t_display_s3 -t upload --upload-port /dev/cu.usbmodem101

launchctl bootstrap gui/$(id -u) "$HOME/Library/LaunchAgents/com.vibeblock.daemon.plist" 2>/dev/null || true
launchctl kickstart -k gui/$(id -u)/com.vibeblock.daemon
```
