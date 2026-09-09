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
  (same check; on Windows the CLI is a plain file next to the Companion, there
  is nothing to stage, answers with `vibetv:codexbar-repair-result`),
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
  console CLI downloaded by `scripts/fetch-win-codexbar.ps1`; licence in
  `windows/THIRD_PARTY`). The Companion finds the CLI next to its own exe;
  `CODEXBAR_BIN` is not set.

## Companion changes

- `daemon --app-version --app-build --native-shell --runtime-label`: set the
  environment a Scheduled Task cannot carry.
- `service install [daemon args...]` writes the task configuration for the
  current label and registers/starts the task; `service uninstall` removes
  both. `service stop|status` follow `CODEXBAR_DISPLAY_STREAM_LAUNCH_AGENT_LABEL`
  like the rest of the runtime instead of the legacy label only.
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

Local cross-build from macOS: `brew install nsis llvm`, `cargo install
cargo-xwin tauri-cli`, `rustup target add x86_64-pc-windows-msvc`, place both
sidecars in `windows/src-tauri/binaries/` as
`codexbar-display-x86_64-pc-windows-msvc.exe` and
`codexbar-cli-x86_64-pc-windows-msvc.exe` (the Companion needs
`controlcenter_static` filled from `apps/control-center` `npm run build:local`
first, as for the Mac App), then in `windows/src-tauri`:
`PATH=/opt/homebrew/opt/llvm/bin:$PATH TAURI_SIGNING_PRIVATE_KEY=... cargo tauri
build --target x86_64-pc-windows-msvc --runner cargo-xwin --bundles nsis`.

## Open

- Authenticode: `bundle.windows.signCommand` is unset until the certificate
  from #217 exists; installers are unsigned and SmartScreen warns.
- Release signing: the updater public key in `tauri.conf.json` belongs to a
  private key kept outside the repository; add it as the
  `TAURI_SIGNING_PRIVATE_KEY` GitHub secret before the first Windows release.
  The release workflow does not yet build or publish the Windows installer and
  `latest-windows.json`.
- Win-CodexBar keeps `claude_allow_reading_claude_code_credentials` off by
  default, so Claude never appears until the customer enables it in
  Win-CodexBar's `settings.json`. How customers get there is not decided.
- Pinned-CLI validation (`validate-codexbar`) is a stub outside macOS; the
  Windows CLI is trusted by the installer SHA-256 pin only.
- Not proven in the VM: ARM64 hosts, Cable transport, a real N→N+1 update
  (needs a published release), Authenticode.
