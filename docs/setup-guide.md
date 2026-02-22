# Setup Guide (MVP)

Note: `vibeblock setup` is not yet a full one-command installer. Use the manual flow below.

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

## 4. Install as launchd service

```bash
cd ../companion
go build -o vibeblock ./cmd/vibeblock
mkdir -p "$HOME/Library/Application Support/vibeblock/bin"
cp ./vibeblock "$HOME/Library/Application Support/vibeblock/bin/vibeblock"

mkdir -p "$HOME/Library/LaunchAgents"
cp ./install/com.vibeblock.daemon.plist "$HOME/Library/LaunchAgents/com.vibeblock.daemon.plist"

launchctl bootstrap gui/$(id -u) "$HOME/Library/LaunchAgents/com.vibeblock.daemon.plist"
launchctl kickstart -k gui/$(id -u)/com.vibeblock.daemon
```

Verify:

```bash
launchctl print gui/$(id -u)/com.vibeblock.daemon | rg "state =|pid ="
tail -f /tmp/vibeblock-daemon.out.log
```
