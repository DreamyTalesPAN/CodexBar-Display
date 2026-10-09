# Companion platform boundary (#415)

This package prepares shared code, not a working Windows product. The Mac UI,
provider semantics, CLI polling timeout, and native registration ownership stay
unchanged. `runtimepaths.Root` derives the runtime directory from
`os.UserConfigDir`; on macOS it is still `~/Library/Application Support/codexbar-display`.
The explicit-home argument is retained for existing setup/test isolation.

`internal/service` owns all Companion launchctl invocations. Bundled runtimes
remain registered by SMAppService: Stop suspends their writer and Start resumes
it (kickstart on resume failure). Legacy agents keep their bootout/enable/
bootstrap-retry/kickstart sequence. Windows uses a per-user Scheduled Task
through the same Manager interface (see `windows-companion.md`). Linux's existing simulated
launchctl behavior is retained, not expanded into Linux service support.

Swift calls `prepare-codexbar --archive …` and `validate-codexbar --app …`.
The Companion checks the archive hash, private path, signing identity,
Gatekeeper, and CLI `--version`, normalizes the two signing xattrs, publishes
atomically, then validates again. Swift only reports whether the exact private
GUI app is already running, preserving its existing reuse exception.

## Known dependency gaps (also recorded in issue #415)

The bundled Windows engine is the Win-CodexBar release pinned in
`scripts/fetch-win-codexbar.ps1` (`$releaseTag`; that file is the one place
that names the version). Compared with the Mac CLI it lacks the options and
behaviour listed below. The Companion works around each on Windows only; the
Mac path is unchanged. Each entry names the code that carries the detour, so
it can be removed when the engine closes the gap.

- `serve --request-timeout 0` is rejected. Windows omits the flag
  (`dashboard_serve.go`). The flag was added for slow-refresh availability on
  the Mac; whether Windows needs it has no bench comparison yet.
- `config providers --json` is missing. Windows reads the text inventory
  (`codex: enabled default (Codex)`) through the same parser
  (`providerInventoryArgs`, `parseProviderSettingsText` in `providers.go`).
- There is no usage call for the switched-on providers. A plain `usage --json`
  answers for Claude only and `--provider all` walks every provider the CLI
  knows, switched on or not. Windows reads the inventory and asks each
  switched-on provider on its own (`providerProbePerProvider`:
  `runUsageAllEnabled` and `runProviderHealthProbe` in `providers.go`); the
  dashboard's `/usage` is asked per provider for the same reason
  (`dashboardUsageByProvider` in `dashboard_fetch.go`, #554).
- The usage answer carries the provider status as `status.level`, which the
  adapter does not read. A probe per provider therefore adds nothing to the
  serve reading, and Windows answers the provider rows from that reading
  instead of probing each provider, as long as the reading is current and
  holds every switched-on provider (`runProviderHealthProbe` in
  `providers.go`, #555).
- `CODEXBAR_CONFIG` is ignored and `config validate` has no `--format json`.
  The CLI reads only `%APPDATA%\CodexBar\settings.json`, so Windows uses that
  location (`EnsureConfig`, `windowsSettingsPath`, `commandEnvironment` in
  `provider_setup.go`).
- `config enable` / `config disable` take the provider as a positional
  argument and reject `--provider` (`providerToggleArgs` in `providers.go`,
  #437).
- There is no command for the consent to read Claude Code's credentials; it is
  a flag in `settings.json`. Windows sets it when Claude is switched on
  (`claude_credentials.go`).
- `cost` rejects `--refresh` (it scans on every call) and defaults to Claude.
  Windows asks `cost --json --days 30 --provider all` (`tokenStatsArgs` in
  `token_stats.go`).

Not a Windows gap, but the same kind of dependency on both platforms: CodexBar
reports provider failures as a message without a typed reason, so
`classifyProviderError` in `provider_setup.go` reads the wording. The one typed
signal is the fork's `[<provider>:browser-sign-in-required <url>]` marker
(`browserSignInMarker`).

CI's contract test (`released_cli_test.go`, run with
`CODEXBAR_CONTRACT_KNOWN_GAPS=1` against the pinned Windows CLI) asserts the
first two gaps only: it fails as soon as the pinned release accepts
`config providers --json` or `serve --request-timeout`, so those two detours
are revisited then. The other entries have no such assertion.

CI downloads the pinned Windows console CLI from the SHA-256-verified upstream
release zip (this release is unsigned; no upstream source build, patch,
installer execution, or tray launch). Both released binaries run
contract checks alongside #357's recordings. Known gaps are explicit assertions:
when an upstream release closes them, CI requires revisiting the blockers.
Green contract tests do not waive those blockers or prove authenticated usage.

Windows uses `LockFileEx` for the exclusive writer lock and recognizes Winsock
address-in-use errors; the shared lifecycle tests run on Windows too. POSIX
mode-bit assertions remain enforced on Unix only. The virtual
device command is built and serves raw OTA on Windows, but its POSIX graceful
signal shutdown subtest is skipped. Shell CLI test programs are replaced with a
Go helper process. Multipart test fixtures select their transport explicitly;
Windows socket-error-based raw-OTA fallback remains unimplemented. Theme assets
are checked out byte-for-byte (no CRLF conversion), preserving signed digests.

## Marcus's cold/warm handoff — do not run automatically

After the PR's exact head has a signed merge-gate candidate, Marcus runs:

```sh
scripts/vibetv-rehearse-cold-start.sh --pr <PR-number>
scripts/vibetv-rehearse-warm-start.sh --pr <PR-number>
```

These scripts replace customer-Mac state and can write firmware. Marcus chooses
the bench device, confirms backups and the candidate source SHA, and operates
the real UI. Record the actual screen, setup and provider availability, initial
stream, relaunch, update/recovery behavior, and cold/warm result against that SHA.
Do not use a Companion-only override to claim this changed Swift shell was tested.
No rehearsal, real-device write, VM modification, merge, tag, or release is part
of the automated implementation task.
