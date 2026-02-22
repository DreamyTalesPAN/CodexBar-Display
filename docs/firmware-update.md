# Firmware Update (MVP)

Manual update over USB with PlatformIO:

```bash
cd firmware
pio run -e lilygo_t_display_s3 -t upload --upload-port /dev/cu.usbmodem101
```
