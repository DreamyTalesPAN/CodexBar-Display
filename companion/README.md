# vibeblock Companion

Operator procedures are centralized in `../docs/operator-runbook.md`.

Go daemon that:
- fetches real provider usage from CodexBar (`usage --json`)
- applies deterministic provider selection (`local activity -> usage delta -> sticky current -> CodexBar order`)
- sends protocol JSON lines to the USB display

v0 cutline:
- release-gated hardware target: ESP8266 SmallTV ST7789 variants
- GIF rendering and loop playback are included in v0 scope
- ESP32 (`lilygo_t_display_s3`) stays available as an experimental/non-blocking path

## Commands

```bash
cd companion

go run ./cmd/vibeblock doctor
go run ./cmd/vibeblock health
go run ./cmd/vibeblock version
go run ./cmd/vibeblock daemon --port /dev/cu.usbserial-10 --once
go run ./cmd/vibeblock daemon --port /dev/cu.usbserial-10 --interval 60s
go run ./cmd/vibeblock daemon --theme crt --interval 60s
go run ./cmd/vibeblock setup
go run ./cmd/vibeblock setup --yes
go run ./cmd/vibeblock setup --port /dev/cu.usbserial-10 --skip-flash
go run ./cmd/vibeblock setup --port /dev/cu.usbserial-10 --firmware-env esp8266_smalltv_st7789
go run ./cmd/vibeblock setup --yes --skip-flash --theme crt
go run ./cmd/vibeblock setup --validate-only --firmware-env esp8266_smalltv_st7789
# v0 GIF-player firmware profile
go run ./cmd/vibeblock setup --yes --port /dev/cu.usbserial-10 --firmware-env esp8266_smalltv_st7789_gif_player
go run ./cmd/vibeblock gif-upload --port /dev/cu.usbserial-10 --gif ~/Downloads/testgif3.gif
# experimental v0 path
go run ./cmd/vibeblock setup --dry-run --firmware-env lilygo_t_display_s3
# experimental v0 path
go run ./cmd/vibeblock setup --port /dev/cu.usbmodem101 --firmware-env lilygo_t_display_s3
go run ./cmd/vibeblock upgrade --firmware-env esp8266_smalltv_st7789
go run ./cmd/vibeblock rollback --port /dev/cu.usbserial-10
go run ./cmd/vibeblock restore-known-good
go run ./cmd/vibeblock restore-known-good --image tmp/backup_chunks_20260226_090152/weather_backup_full.bin --port /dev/cu.usbserial-10
../scripts/upgrade-with-preflight.sh --firmware-env esp8266_smalltv_st7789
../scripts/rollback-last-known-good.sh --port /dev/cu.usbserial-10
```

`setup` is a one-command installer and is safe to run repeatedly:
- verifies CodexBar CLI, auto-installs CodexBar via Homebrew (`brew install --cask steipete/tap/codexbar`) when missing
- resolves serial port (interactive selection when multiple devices are found)
- flashes firmware (`pio run -e <firmware-env> -t upload --upload-port <port>`)
- installs current `vibeblock` binary into `~/Library/Application Support/vibeblock/bin/vibeblock`
- installs recovery scripts into `~/Library/Application Support/vibeblock/scripts/`
- creates backup target dir `~/Library/Application Support/vibeblock/backups/`
- writes/updates `~/Library/LaunchAgents/com.vibeblock.daemon.plist` (default: daemon auto-detects serial port at runtime)
- restarts launch agent (`bootout -> bootstrap -> kickstart`) and verifies running/waiting state

Setup flags:
- `--port`: force serial port
- `--yes`: auto-select defaults without prompt
- `--skip-flash`: skip firmware flashing
- `--pin-port`: pin daemon to selected `--port` in LaunchAgent (default is unpinned auto-detect)
- `--firmware-env`: PlatformIO firmware environment (default `esp8266_smalltv_st7789`; `esp8266_smalltv_st7789_gif_player` for v0 GIF mode; `lilygo_t_display_s3` is experimental for v0)
- `--theme`: persist runtime theme override (`classic`, `crt`, `none`)
- `--validate-only`: run setup prerequisite checks only, no system changes
- `--dry-run`: show setup actions without applying changes

`gif-upload` pushes one GIF file to GIF-player firmware and starts looping playback:
- path supports `--gif ~/Downloads/testgif` and automatic `.gif` suffix resolution
- verifies GIF header/dimensions before upload
- reads device `maxBytes` from `HELLO`; compacts source only if needed
- starts playback by default (`--play=true`)

`restore-known-good` restores a supplier backup image to ESP8266 hardware:
- auto-detects serial port unless `--port` is provided
- auto-selects newest backup from configured search dirs unless `--image` is provided
- uses installed script path by default (`~/Library/Application Support/vibeblock/scripts/esp8266-restore.sh`)
- verifies backup manifest + SHA256 + device MAC by default
- supports `--backup-dir`, `--script-path`, `--manifest`, `--skip-verify`

`upgrade` performs firmware upgrade with preflight checks:
- resolves serial port and checks `port busy` via `lsof`
- runs companion/firmware version guard against the compatibility matrix
- executes flash + runtime install via setup flow (without manual re-setup steps)
- snapshots current installed companion binary for rollback

`rollback` restores last-known-good state:
- companion binary from upgrade snapshot
- firmware via `restore-known-good` (state-backed image/manifest or explicit flags)

`doctor` validates CodexBar binary, lists serial ports, runs runtime serial checks, and shows a live provider preview.
`health` prints launch agent status, detected port, last successful frame timestamp, and last error in one view.

## Runtime behavior

- Poll interval defaults to `60s`.
- Runtime retry backoff on errors is `1s -> 2s -> 4s -> ... -> 30s` (capped by poll interval).
- When CodexBar fails temporarily, the daemon reuses the last good frame for up to `10m` (configurable).
- Sleep/Wake gaps are auto-detected; retry state is reset for faster recovery after wake.
- By default, daemon resolves serial port via auto-detection each cycle, so USB renumbering is handled automatically.
- If daemon is explicitly pinned to a port, it auto-falls back to autodetection when the pinned path disappears.
- Local activity uses provider detectors:
  - `codex` detector: latest `~/.codex/sessions/**/*.jsonl` plus `~/.codex/history.jsonl`
  - `claude` detector: latest `~/.claude/history.jsonl` plus `~/.claude/projects/**/*.jsonl` and `~/.config/claude/projects/**/*.jsonl`
  - `vertexai` detector: Vertex-marked entries inside Claude project logs
  - `jetbrains` detector: latest `AIAssistantQuotaManager2.xml` from JetBrains IDE config dirs
  - `cursor` detector: `~/Library/Application Support/CodexBar/cursor-session.json`
  - `factory` detector: `~/Library/Application Support/CodexBar/factory-session.json`
  - `augment` detector: `~/Library/Application Support/CodexBar/augment-session.json`
  - `gemini` detector: `~/.gemini/oauth_creds.json` + `~/.gemini/settings.json`
  - `kimi` detector: Chromium cookie DB entries for `kimi-auth` on `kimi.com` (low confidence)
  - `ollama` detector: Chromium cookie DB entries for Ollama session cookies on `ollama.com` (low confidence)
- Providers without robust local artifacts (for example `openrouter`, `warp`, `copilot`, `zai`, `kimik2`, `opencode`) still work via usage-delta/sticky fallback.
- Optional custom detectors for any provider:
  - `VIBEBLOCK_ACTIVITY_FILE_<PROVIDER>=/path/to/file`
  - `VIBEBLOCK_ACTIVITY_DIR_<PROVIDER>=/path/to/dir`
  - Example: `VIBEBLOCK_ACTIVITY_FILE_KIMI=~/my-kimi-activity.log`
- Selection order is always:
  1. most recent local activity
  2. usage delta (`session`/`weekly` increase or reset jump)
  3. sticky current provider
  4. first provider in CodexBar result order
- Conflict rule for near-simultaneous local activity (default window `15s`):
  1. keep current provider if it is in the conflict set
  2. otherwise choose the conflict candidate with strongest usage delta
  3. otherwise choose CodexBar order
- Local activity older than `6h` is ignored by default.
- Low-confidence local activity (for example browser-cookie signals) is capped at `20m` max age.
- For Codex specifically, if `source=openai-web` reports `0/0` with no reset, the daemon repairs Codex data via `--provider codex --source cli`.
- Unified runtime error frames use stable codes like `runtime/codexbar-parse` and `runtime/serial-write`.
- Daemon logs include `reason=<selection strategy>` and `detail=<tie-break context>` for each sent frame.
- Error logs are standardized as `cycle error: code=<taxonomy-code> ... recovery=\"<action>\" ...`.
- Optional theme override: set `VIBEBLOCK_THEME=classic` or `VIBEBLOCK_THEME=crt` to request a display theme.
- Runtime theme precedence: `daemon --theme` CLI flag > `VIBEBLOCK_THEME` env > runtime config (`config.json`) > firmware compile default.
- Theme is only sent to devices that advertise `features:["theme"]` in device hello.

## Error Taxonomy

User-facing errors now use stable codes with recovery actions:

- `transport/*`: serial discovery/open/write/probe failures (`transport/serial-open`, `transport/no-usb-serial-ports`)
- `protocol/*`: handshake/frame format/capability failures (`protocol/device-hello-unavailable`)
- `runtime/*`: daemon cycle failures and runtime error frames (`runtime/serial-write`, `runtime/codexbar-parse`)
- `setup/*`: setup/install/flash/launch-agent failures (`setup/flash-firmware`, `setup/launchagent-verify`)
- `upgrade/*`: update preflight and flash guard failures (`upgrade/port-busy`, `upgrade/version-guard`)
- `rollback/*`: known-good restore failures (`rollback/missing-known-good`, `rollback/firmware-restore`)

CLI commands print `error code=<...>` for coded errors. Runbook recovery mapping:
- `../docs/operator-runbook.md`

## Performance Budgets

Companion + firmware performance budgets and measurement workflow:
- `../docs/performance-budgets.md`

Versioning/release/rollback references:
- `../docs/versioning-compatibility.md`
- `../docs/release-process.md`
- `../docs/known-good-firmware.md`

Environment variables:

- `CODEXBAR_BIN`: force CodexBar executable path
- `VIBEBLOCK_THEME`: optional theme override (`classic` or `crt`)
- `VIBEBLOCK_CODEXBAR_TIMEOUT_SECS`: timeout per CodexBar command (default `90`)
- `VIBEBLOCK_LAST_GOOD_MAX_AGE`: max age for stale fallback frame (Go duration format, default `10m`)
- `VIBEBLOCK_ACTIVITY_MAX_AGE`: max age for local activity signals before they are ignored (default `6h`)
- `VIBEBLOCK_ACTIVITY_CONFLICT_WINDOW`: window for near-simultaneous activity conflict handling (default `15s`)
- `VIBEBLOCK_CODEX_ACTIVITY_DIR`: override Codex activity directory (default `~/.codex/sessions`)
- `VIBEBLOCK_CODEX_ACTIVITY_FILE`: override Codex fallback activity file (default `~/.codex/history.jsonl`)
- `VIBEBLOCK_CLAUDE_ACTIVITY_DIR`: override primary Claude activity directory
- `VIBEBLOCK_CLAUDE_ACTIVITY_DIRS`: override Claude activity directories (comma-separated)
- `VIBEBLOCK_CLAUDE_ACTIVITY_FILE`: override Claude activity file (default `~/.claude/history.jsonl`)
- `VIBEBLOCK_VERTEX_ACTIVITY_DIR`: override primary Vertex activity directory
- `VIBEBLOCK_VERTEX_ACTIVITY_DIRS`: override Vertex activity directories (comma-separated)
- `VIBEBLOCK_JETBRAINS_ACTIVITY_DIRS`: override JetBrains config roots (comma-separated)
- `VIBEBLOCK_CURSOR_ACTIVITY_FILE`: override Cursor session activity file
- `VIBEBLOCK_FACTORY_ACTIVITY_FILE`: override Factory session activity file
- `VIBEBLOCK_AUGMENT_ACTIVITY_FILE`: override Augment session activity file
- `VIBEBLOCK_GEMINI_OAUTH_FILE`: override Gemini OAuth credentials file
- `VIBEBLOCK_GEMINI_SETTINGS_FILE`: override Gemini settings file
- `VIBEBLOCK_SQLITE3_BIN`: override sqlite3 binary used for Chromium cookie activity checks (default `sqlite3`)
- `VIBEBLOCK_CHROMIUM_COOKIE_DB_PATHS`: explicit comma-separated cookie DB file paths for Kimi/Ollama cookie detectors
- `VIBEBLOCK_ACTIVITY_FILE_<PROVIDER>`: add custom file-based detector for provider key
- `VIBEBLOCK_ACTIVITY_DIR_<PROVIDER>`: add custom directory-based detector for provider key

## CodexBar Binary Discovery

Priority order:
1. `CODEXBAR_BIN` env var
2. `codexbar` in `PATH`
3. Desktop bundle helpers:
   - `/Applications/CodexBar.app/Contents/Helpers/CodexBarCLI`
   - `~/Applications/CodexBar.app/Contents/Helpers/CodexBarCLI`
   - `~/Downloads/CodexBar.app/Contents/Helpers/CodexBarCLI`
