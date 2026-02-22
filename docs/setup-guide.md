# Setup Guide (MVP)

## 1. Hardware

1. Connect LILYGO T-Display-S3 via USB-C data cable.
2. Confirm serial path appears:

```bash
ls /dev/cu.usb*
```

## 2. Flash firmware

```bash
cd firmware
pio run -e lilygo_t_display_s3 -t upload --upload-port /dev/cu.usbmodem101
```

## 3. Run companion daemon

```bash
cd ../companion
go run ./cmd/vibeblock doctor
go run ./cmd/vibeblock daemon --port /dev/cu.usbmodem101 --interval 60s
```

The daemon reads live data from CodexBar and sends one JSON line every poll cycle.
