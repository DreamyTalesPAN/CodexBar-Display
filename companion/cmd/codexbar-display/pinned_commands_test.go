package main

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimepaths"
)

// The engine check is run a second time before the app is told that it failed,
// and every failure leaves its reason in the folder "Open support log" opens.
func TestPinnedCheckRunsAgainBeforeItReportsFailure(t *testing.T) {
	home := t.TempDir()
	for _, name := range []string{"HOME", "USERPROFILE"} {
		t.Setenv(name, home)
	}
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(home, ".config"))
	t.Setenv("AppData", filepath.Join(home, "AppData"))
	logPath := runtimepaths.Path(home, "logs", "engine-check.log")
	oldPrepare, oldPause := preparePinnedCLI, pinnedRetryPause
	t.Cleanup(func() { preparePinnedCLI, pinnedRetryPause = oldPrepare, oldPause })
	pinnedRetryPause = 0

	calls := 0
	started := time.Now()
	var limits []time.Duration
	preparePinnedCLI = func(ctx context.Context, _ string, _ bool) (string, error) {
		calls++
		deadline, _ := ctx.Deadline()
		limits = append(limits, deadline.Sub(started))
		if calls == 1 {
			return "", errors.New("assess CodexBar: signal: killed")
		}
		return "/private/CodexBarCLI", nil
	}
	out, err := captureStdout(t, func() error {
		return runPinnedCodexBar([]string{"--archive", "CodexBar.zip"}, false)
	})
	if err != nil || calls != 2 || strings.TrimSpace(out) != "/private/CodexBarCLI" {
		t.Fatalf("a check that passes on its second run must succeed: calls=%d out=%q err=%v", calls, out, err)
	}
	// The app and the Control Center wait two minutes for this command.
	if limits[0] > pinnedFirstRunLimit+time.Second || limits[1] <= limits[0] || limits[1] > 2*time.Minute+time.Second {
		t.Fatalf("both runs must fit into the command's two minutes, got deadlines after %v", limits)
	}
	logged, _ := os.ReadFile(logPath)
	if strings.Count(string(logged), "\n") != 1 || !strings.Contains(string(logged), "engine check failed: assess CodexBar: signal: killed") {
		t.Fatalf("the first failure must be kept with its reason, got %q", logged)
	}

	calls = 0
	preparePinnedCLI = func(context.Context, string, bool) (string, error) {
		calls++
		return "", errors.New("bundled CodexBar archive checksum mismatch")
	}
	out, err = captureStdout(t, func() error {
		return runPinnedCodexBar([]string{"--archive", "CodexBar.zip"}, false)
	})
	if err == nil || calls != 2 || out != "" {
		t.Fatalf("a copy that fails the check must fail after two runs: calls=%d out=%q err=%v", calls, out, err)
	}
	logged, _ = os.ReadFile(logPath)
	if strings.Count(string(logged), "checksum mismatch") != 2 {
		t.Fatalf("both failed runs must be kept, got %q", logged)
	}
}
