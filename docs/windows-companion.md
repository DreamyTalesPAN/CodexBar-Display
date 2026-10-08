# Windows Companion (#416)

The Go Companion has a Windows runtime path. This is not a Windows product
release: the native shell, installer, updater and firmware flashing are outside
this change. The Win-CodexBar provider-inventory and serve-command blockers in
`windows-platform-neutral.md` remain release blockers. Simulation uses an
explicit mock provider; it does not demonstrate authenticated provider usage.

## Per-user storage and credentials

The runtime root is `%AppData%\codexbar-display` (`os.UserConfigDir`), including
configuration, `logs\daemon.out.log`, and `run\display-writer.lock`. Run setup and
the Companion as the same ordinary Windows user. Do not run production setup
through SYSTEM or an elevated administrator account: that selects a different
profile and task owner.

Tokens remain in the user's profile, not in the Scheduled Task command line.
Unix private-file modes such as `0600` are not Windows access controls: Windows
uses the inherited profile NTFS DACL. The standard private user profile grants
access to its owner, SYSTEM and administrators, not other ordinary users.
Do not relocate the runtime root to Public, a shared directory or a filesystem
without equivalent ACL protection. Custom/redirected profiles must preserve
that DACL; check with `icacls "%AppData%\codexbar-display"` when provisioning.
This does not protect tokens from software running as the same user or from an
administrator. No assertion of POSIX mode bits is used as Windows security proof.

## Runtime behavior

- A per-user Scheduled Task starts the daemon on user logon, without a Windows
  Service or administrator requirement, and restarts it on failure.
  The adapter calls Task Scheduler's COM API through Windows PowerShell so status
  is numeric/JSON, not localized `schtasks /Query` text. The task name includes
  its owner's SID; it uses an interactive token and least-privilege run level.
- `service start`, `service stop`, `service status` and doctor/health use the
  shared service adapter; macOS continues to use launchd/SMAppService.
- An exclusive `LockFileEx` byte-range lock prevents two writers. The OS releases
  it when its owning process exits; lock files are not deleted to unlock them.
- URLs use `rundll32.exe url.dll,FileProtocolHandler` without a command shell.
- USB enumeration uses the pure-Go serial port list and verifies VibeTV hello
  identity, rather than ranking device-path substrings. COM ports are not files
  to be checked with `os.Stat`.

## Acceptance boundary

Hermetic tests and Virtual VibeTV cold/warm simulation cover runtime behavior.
Real WiFi and Cable acceptance, actual logon/reboot, the rendered customer UI,
and the Mac cold/warm bench rehearsals remain separate manual checks. Do not run
the destructive Mac rehearsal scripts or write to connected hardware as part of
these simulations. Passing simulated checks does not grant merge or release
approval.
