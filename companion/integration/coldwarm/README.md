# Cold/warm Virtual VibeTV simulation

Runs the real Companion daemon against the existing protocol-faithful Go Virtual
VibeTV and a compiled Go CodexBar fixture. No Bash/Python dependencies on Windows,
hardware access, downloads, service registration or app installation.

From `companion`, in PowerShell:

```powershell
$env:VIBETV_COLDWARM_E2E = '1'
go test ./integration/coldwarm -run '^TestColdWarm$' -v -count=1 -timeout=10m
```

On macOS/Linux, run `scripts/test-companion-coldwarm-e2e.sh` from the repository
root. CI runs the same test on Windows, macOS and Linux. Ordinary `go test ./...`
compiles but skips this opt-in process test.

Scenarios: device off at runtime start (no false connected/ready status), device
on, daemon restart with persisted configuration, device off/on. Recovery must
produce a new accepted virtual-device frame without protocol violations. Device
disconnection must clear both connected and ready within 150 seconds; connection
and readiness recovery retain the existing 30/60-second bounds.

All targets are ephemeral loopback addresses; Companion/provider configuration
and home directories are isolated in a temp path containing spaces. All platforms
use the actual foreground worker-lifecycle callback, with a unique service label;
there is no fake-running service shim or installed task. Readiness still requires
the existing runtime-session log/freshness evidence and new accepted frames.
This does not validate installed service startup, actual provider authentication,
or physical-screen rendering.

The mock dashboard watches a parent-owned lease so terminating the daemon on
Windows cannot leave a permanent orphan fixture; Windows cleanup additionally
uses the built-in `taskkill.exe` to reap the test-owned process tree. Failures include the last API
response and captured runtime logs. No production files are modified.
