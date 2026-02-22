# Troubleshooting

## `command not found: codexbar`

The companion supports desktop-only installs by auto-discovering:
- `/Applications/CodexBar.app/Contents/Helpers/CodexBarCLI`
- `~/Applications/CodexBar.app/Contents/Helpers/CodexBarCLI`
- `~/Downloads/CodexBar.app/Contents/Helpers/CodexBarCLI`

You can also force a path:

```bash
export CODEXBAR_BIN="$HOME/Downloads/CodexBar.app/Contents/Helpers/CodexBarCLI"
```

## No serial device found

- Reconnect cable
- Try a known data cable
- Run `ls /dev/cu.usb*`

## Display shows error

Run:

```bash
cd companion
go run ./cmd/vibeblock daemon --port /dev/cu.usbmodem101 --once
```

That prints the exact error frame source in terminal.
