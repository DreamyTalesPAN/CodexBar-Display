# Troubleshooting

## Setup fails at `codexbar-install`

`vibeblock setup` auto-installs CodexBar with:

```bash
brew install --cask steipete/tap/codexbar
```

If that fails:
- verify Homebrew installation
- run the command manually to see full output
- install from https://codexbar.app/ and retry setup

Companion auto-discovery paths:
- `/Applications/CodexBar.app/Contents/Helpers/CodexBarCLI`
- `~/Applications/CodexBar.app/Contents/Helpers/CodexBarCLI`
- `~/Downloads/CodexBar.app/Contents/Helpers/CodexBarCLI`

You can also force a path:

```bash
export CODEXBAR_BIN="$HOME/Downloads/CodexBar.app/Contents/Helpers/CodexBarCLI"
```

## Setup fails at `flash-firmware`

Most common cause: serial device is busy (daemon/monitor still open).

```bash
launchctl bootout gui/$(id -u)/com.vibeblock.daemon 2>/dev/null || true
lsof /dev/cu.usbserial-10
```

Then rerun setup with explicit port:

```bash
cd companion
go run ./cmd/vibeblock setup --port /dev/cu.usbserial-10
```

## Setup fails at `launchagent-*`

Inspect launchd state + logs:

```bash
launchctl print gui/$(id -u)/com.vibeblock.daemon
tail -n 100 /tmp/vibeblock-daemon.err.log
```

## No serial device found

- Reconnect cable
- Try a known data cable
- Run `ls /dev/cu.usb*`

If you see repeated
`serial port not found: /dev/cu.usb...`
after reconnect, macOS may have renumbered the device (for example `...101` to `...1101`).
Current default daemon behavior is unpinned auto-detection and logs:
`runtime event=port-fallback ...`

If your LaunchAgent was pinned earlier, re-run setup without `--pin-port`:

```bash
cd companion
go run ./cmd/vibeblock setup --yes --skip-flash --port /dev/cu.usbserial-10
```

## Display stuck on `Waiting for frames...`

Check daemon health first:

```bash
launchctl print gui/$(id -u)/com.vibeblock.daemon | rg "state =|pid ="
tail -n 30 /tmp/vibeblock-daemon.out.log
tail -n 30 /tmp/vibeblock-daemon.err.log
```

You should see periodic `sent frame -> ...` lines in `out.log`.

If not, restart runtime:

```bash
cd companion
go run ./cmd/vibeblock setup --yes --skip-flash --port /dev/cu.usbserial-10
```

If firmware looks corrupted, restore known-good backup:

```bash
cd companion
go run ./cmd/vibeblock restore-known-good --port /dev/cu.usbserial-10
```

## Display shows error

Current runtime errors are standardized as `runtime/<kind>`:
- `runtime/serial-resolve`
- `runtime/serial-write`
- `runtime/codexbar-binary`
- `runtime/codexbar-command`
- `runtime/codexbar-parse`
- `runtime/no-providers`

Run `doctor` first to verify runtime checks:

```bash
cd companion
go run ./cmd/vibeblock doctor
```

Then run a one-shot daemon cycle for detailed context:

```bash
cd companion
go run ./cmd/vibeblock daemon --port /dev/cu.usbserial-10 --once
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
./vibeblock daemon --port /dev/cu.usbserial-10 --once
```

## Provider selection seems wrong

Check the daemon log and inspect `reason=` and `detail=`:

```bash
tail -n 50 /tmp/vibeblock-daemon.out.log
```

Selection reasons are deterministic (`local-activity`, `usage-delta`, `sticky-current`, `codexbar-order`).
If local activity is too noisy or too old, tune:

```bash
export VIBEBLOCK_ACTIVITY_CONFLICT_WINDOW=15s
export VIBEBLOCK_ACTIVITY_MAX_AGE=6h
```

For providers without built-in local artifacts (for example `openrouter`, `warp`, `zai`), you can add custom detector paths:

```bash
export VIBEBLOCK_ACTIVITY_FILE_KIMI=~/path/to/kimi-activity.log
export VIBEBLOCK_ACTIVITY_DIR_OLLAMA=~/path/to/ollama-activity-dir
```

`kimi` and `ollama` also have built-in Chromium cookie detectors. If those do not trigger on your machine, set explicit DB paths:

```bash
export VIBEBLOCK_CHROMIUM_COOKIE_DB_PATHS="$HOME/Library/Application Support/Google/Chrome/Default/Cookies"
```

## Upload fails with `Failed to connect to ESP32-S3`

Usually another process (e.g. running daemon or serial monitor) still holds the serial device.

```bash
launchctl bootout gui/$(id -u)/com.vibeblock.daemon 2>/dev/null || true
lsof /dev/cu.usbserial-10
```

After flashing, restart the daemon:

```bash
launchctl bootstrap gui/$(id -u) "$HOME/Library/LaunchAgents/com.vibeblock.daemon.plist" 2>/dev/null || true
launchctl kickstart -k gui/$(id -u)/com.vibeblock.daemon
```
