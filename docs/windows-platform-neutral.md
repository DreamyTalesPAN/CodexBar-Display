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

Win-CodexBar 0.56.8 still lacks two Mac CLI options. The Companion works
around both on Windows only (`runtime.GOOS == "windows"`); the Mac path is
unchanged. CI's contract test fails as soon as upstream adds either option,
so the workaround is revisited then.

- `config providers --json` is missing. Windows reads the text inventory
  (`codex: enabled default (Codex)`) through the same parser
  (`providerInventoryArgs`, `parseProviderSettingsText`).
- `serve --request-timeout 0` is rejected. Windows omits the flag. The flag was
  added for slow-refresh availability on the Mac; whether Windows needs it has
  no bench comparison yet.

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
