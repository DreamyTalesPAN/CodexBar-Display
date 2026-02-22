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

## `exit status 1 (stdout parse error: invalid character [ after top-level value)`

This means CodexBar emitted more than one top-level JSON payload in one run (for example `[...] [...]`).
Current vibeblock companion tolerates this, but you need the latest binary.

Update + restart:

```bash
cd companion
go build -o vibeblock ./cmd/vibeblock
cp ./vibeblock "$HOME/Library/Application Support/vibeblock/bin/vibeblock"
launchctl kickstart -k gui/$(id -u)/com.vibeblock.daemon
```

## Display jumps between real values and `0/0`

This can happen when CodexBar auto-source flips Codex between `codex-cli` and `openai-web`.

Current companion behavior:
- If Codex arrives as `openai-web` with `0/0` and no reset timer, vibeblock performs a second Codex query with `--source cli`.
- The CLI frame is used when it contains better data.

If values still jump, run a direct one-shot check:

```bash
cd companion
./vibeblock daemon --port /dev/cu.usbmodem101 --once
```

## Upload fails with `Failed to connect to ESP32-S3`

Usually another process (e.g. running daemon or serial monitor) still holds the serial device.

```bash
launchctl bootout gui/$(id -u)/com.vibeblock.daemon 2>/dev/null || true
lsof /dev/cu.usbmodem101
```

After flashing, restart the daemon:

```bash
launchctl bootstrap gui/$(id -u) "$HOME/Library/LaunchAgents/com.vibeblock.daemon.plist" 2>/dev/null || true
launchctl kickstart -k gui/$(id -u)/com.vibeblock.daemon
```
