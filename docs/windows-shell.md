# Windows shell (#417)

`windows/` is the Windows counterpart of `macos/VibeTVControlCenter`: a Tauri 2
shell that does what `main.swift` does for the Mac and nothing more. No
provider logic, no device logic, no state of its own; the shell asks the
Companion for everything it needs.

## What the shell does

- Tray icon with Open / Reload / Check for Updates / Quit. One WebView2 window
  on `http://127.0.0.1:47832/control-center` with the User-Agent
  `VibeTVControlCenter/<version>+<build>`, so the Companion's installation-mode
  gate applies unchanged. Closing the window hides it; the tray keeps the app
  alive.
- On start: `codexbar-display service install ...` registers the Companion as
  the per-user Scheduled Task `shop.vibetv.control-center.runtime-<SID>` from
  `%AppData%\codexbar-display\service\shop.vibetv.control-center.runtime.json`.
  The daemon arguments mirror the Mac runtime agent (`--transport wifi
  --interval 30s --api-addr 127.0.0.1:47832 --api-fallback --last-good-max-age
  168h`) plus the flags that replace the LaunchAgent environment:
  `--native-shell` (`VIBETV_DISABLE_MAC_APP_SELF_UPDATE=1`), `--app-version`,
  `--app-build`, `--runtime-label`. The shell then polls `/v1/runtime-health`
  (8 s before re-registering, 35 s after) until the runtime reports this exact
  Companion version, app version+build and listener owner, and only then loads
  the Control Center. The daemon is skipped when a healthy runtime of this
  build already answers.
- `vibetv://` links from the UI are intercepted in the webview:
  `restart-control-center`, `repair-runtime` (re-registers and re-checks the
  task, answers with `vibetv:runtime-repair-result`), `repair-codexbar`
  (the CLI is a plain file the Companion daemon runs itself, so the usage
  engine is that daemon: the shell first claims
  `POST /v1/runtime-health/update-hold` like the Mac App -- a 409 means a
  firmware update or theme install owns the runtime and the repair reports
  failure instead of killing that job -- then `service start` replaces the
  running task instance and the same check follows; answers with
  `vibetv:codexbar-repair-result`),
  `check-for-updates`. `open-codexbar` has no Windows equivalent (no
  CodexBar window) and is logged only.
- Updates: the Updates tab shows the native "Update" button once the
  Companion reports `installedInApplications` (on Windows: the Companion
  runs next to `VibeTVControlCenter.exe`). The button sends
  `vibetv://check-for-updates`; `tauri-plugin-updater` fetches
  `latest-windows.json` from the latest GitHub release, verifies the minisign
  signature, runs the NSIS installer in passive mode and relaunches the shell.
- Autostart of the shell: `tauri-plugin-autostart` writes
  `HKCU\Software\Microsoft\Windows\CurrentVersion\Run\VibeTV Control Center`.
- Installer: NSIS, x64, per-user. `nsis/hooks.nsh` stops the task before
  files are replaced and removes task, task configuration and the Run value on
  uninstall. The Companion's Windows sidecars are `codexbar-display.exe` (Go,
  built in CI) and `codexbar-cli.exe` (the unmodified pinned Win-CodexBar
  console CLI downloaded by `scripts/fetch-win-codexbar.ps1`, currently the
  VibeTV fork release `v0.60.3-vibetv.3` with the Windows Claude probe fixes;
  licence in `windows/THIRD_PARTY`). The Companion finds the CLI next to its own exe;
  `CODEXBAR_BIN` is not set.

## Companion changes

- `daemon --app-version --app-build --native-shell --runtime-label`: set the
  environment a Scheduled Task cannot carry.
- `service install [daemon args...]` writes the task configuration for the
  current label and registers/starts the task; `service uninstall` removes
  both. `service stop|status` follow `CODEXBAR_DISPLAY_STREAM_LAUNCH_AGENT_LABEL`
  like the rest of the runtime instead of the legacy label only.
  `service install` under the shell label also retires a task left behind by
  an earlier `codexbar-display setup` (`com.codexbar-display.daemon`): both
  daemons would share the writer lock and API port, and the shell's health
  check rejects the legacy owner. `doctor` and `health` inspect the task whose
  configuration is installed (shell label first, then legacy) when no label
  is handed over.
- Updater outcomes (up to date, failed) are shown in a native message box;
  the exe has no console and the customer would otherwise see no answer to
  the Update click.
- `installedInApplications` on Windows means "the shell exe sits next to the
  Companion"; `app.path` is that directory.

## Building

CI (`windows-shell` job): Go sidecar with `GOOS=windows` and `-H=windowsgui`
(the interactive Scheduled Task would otherwise open a console window for the
daemon at every logon; the shell and the installer hooks read its output through
pipes, which still works), CLI extraction,
`cargo tauri build --bundles nsis`, artifact `vibetv-control-center-windows`.
Without the `TAURI_SIGNING_PRIVATE_KEY` secret CI signs the updater
manifest with a throwaway key: the installer works, but no released shell
would accept it as an update.

Release (`build-windows` job in `vibetv-release-candidate.yml`): the same
steps, but built from the exact reviewed `main` SHA and stamped with the
release version instead of the CI candidate version. It signs the updater
manifest with the real `TAURI_SIGNING_PRIVATE_KEY` secret, whose public half
is pinned in `tauri.conf.json`, and fails when that secret is missing rather
than falling back to a throwaway key. It publishes
`VibeTV-Control-Center-Setup.exe` and `latest-windows.json` as
part of the immutable candidate publish set, so the publish gate and the
byte-identical public asset verification cover them like the Mac assets. CI
never sees the release key, because it also builds unreviewed pull requests.

Local cross-build from macOS: `brew install nsis llvm`, `cargo install
cargo-xwin tauri-cli`, `rustup target add x86_64-pc-windows-msvc`, place both
sidecars in `windows/src-tauri/binaries/` as
`codexbar-display-x86_64-pc-windows-msvc.exe` and
`codexbar-cli-x86_64-pc-windows-msvc.exe` (the Companion needs
`controlcenter_static` filled from `apps/control-center` `npm run build:local`
first, as for the Mac App), then in `windows/src-tauri`:
`PATH=/opt/homebrew/opt/llvm/bin:$PATH TAURI_SIGNING_PRIVATE_KEY=... cargo tauri
build --target x86_64-pc-windows-msvc --runner cargo-xwin --bundles nsis`.

Do not stop at `npm run build:local`: that updates `out-local`, not the Go
embed directory. Copy the complete fresh export into `controlcenter_static`
before rebuilding the sidecar, as the Windows CI job does. A stale embed tree
caused `PREVIEW UNAVAILABLE` in the 2026-09-09 VM rehearsal although the exact
Tiny Office revision existed in the export. Verify the installed app serves
`/theme-packs/render/tiny-office/to-6-6eed22ed.json?specHash=4f824ce2` and renders it.

Win-CodexBar 0.56.8's local cost command is `cost --json --days 30 --provider all`;
it rejects the Mac `--refresh` option and defaults to Claude if the provider is
omitted. Its `spendContract.daily` format is adapted centrally. Unestablished
coverage, null daily token counts, or an unsupported provider remain unavailable,
not zero. A completed scan without history shows a retryable notice while
leaving quota windows visible. Known zero history remains a valid zero result.

The same CLI marks an absent Codex session as `is_informational: true`, with
`used_percent: 0`, `window_minutes: 300`, and `No active 5h session`. The shared
parser excludes explicitly informational windows from quotas (both snake_case
and camelCase contracts). Real zero-percent windows remain valid; a real weekly
window stays available without a synthetic Session row.
The running collector uses the dashboard snapshot joined with `/usage` metadata;
that normalizer must also retain and filter the informational flags. Fixing only
the direct CLI parser does not correct the installed app's dashboard-fed usage.

Clean-settings VM verification on 2026-09-09 confirms that CLI 0.56.8 itself
enables Codex and Claude by default, without checking their setup. Running
`config disable claude` persists across a new CLI process. Marcus approved an
opt-in Windows first-run selection on 2026-09-09: before starting the CLI,
VibeTV atomically creates a missing `settings.json` with only
`{"enabled_providers":[]}`. The pinned CLI supplies all omitted setting defaults.
Existing files remain byte-for-byte unchanged, including an explicitly empty
selection. Initialization errors stop CLI startup instead of falling back to
the upstream enabled defaults. No health-based provider selection is added;
macOS bootstrap behavior is unchanged.

Win-CodexBar keeps `claude_allow_reading_claude_code_credentials` off by
default. Switching Claude on in the Control Center is the customer's consent,
so the Companion sets that flag in Win-CodexBar's `settings.json` at that
moment (`SetProviderEnabled` → `grantClaudeCredentials`); no manual edit is
needed.

## Open

- Authenticode: the release workflow signs the installer through Azure Artifact
  Signing (certificate profile `vibetv-public-trust`, account
  `vibetv-signing`). `signCommand` is injected by the release job rather than
  committed to `tauri.conf.json`, so local and CI builds still work without the
  Azure CLI; those builds stay unsigned. Two constraints are easy to trip over:
  Tauri spawns `signCommand` without a shell and splits it on spaces, so the
  program must be a space-free absolute path (the `sign` dotnet global tool
  qualifies, a `pwsh` wrapper does not), and every binary it signs must be
  writable, which the extracted CodexBar CLI is not until the job clears its
  read-only flag. The job verifies the resulting signature with
  `Get-AuthenticodeSignature` and fails the release if it is missing or issued
  to an unexpected subject.
- Pinned-CLI validation (`validate-codexbar`) is a stub outside macOS; the
  Windows CLI is trusted by the installer SHA-256 pin only.
- Not proven in the VM: ARM64 hosts, Cable transport, a real N→N+1 update
  (needs a published release).
