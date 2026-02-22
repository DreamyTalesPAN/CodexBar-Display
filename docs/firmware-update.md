# Firmware Update (MVP)

Manual update over USB with PlatformIO:

```bash
launchctl bootout gui/$(id -u)/com.vibeblock.daemon 2>/dev/null || true
cd firmware
pio run -e lilygo_t_display_s3 -t upload --upload-port /dev/cu.usbmodem101
launchctl bootstrap gui/$(id -u) "$HOME/Library/LaunchAgents/com.vibeblock.daemon.plist" 2>/dev/null || true
launchctl kickstart -k gui/$(id -u)/com.vibeblock.daemon
```
