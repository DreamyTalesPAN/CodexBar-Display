package main

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimepaths"
)

// A failed engine check leaves its reason in the folder "Open support log"
// opens; a check that passes leaves nothing.
func TestPinnedCheckKeepsWhyItFailed(t *testing.T) {
	home := t.TempDir()
	for _, name := range []string{"HOME", "USERPROFILE"} {
		t.Setenv(name, home)
	}
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(home, ".config"))
	t.Setenv("AppData", filepath.Join(home, "AppData"))
	logPath := runtimepaths.Path(home, "logs", "engine-check.log")
	oldPrepare := preparePinnedCLI
	t.Cleanup(func() { preparePinnedCLI = oldPrepare })

	preparePinnedCLI = func(context.Context, string, bool) (string, error) {
		return "/private/CodexBarCLI", nil
	}
	out, err := captureStdout(t, func() error {
		return runPinnedCodexBar([]string{"--archive", "CodexBar.zip"}, false)
	})
	if err != nil || strings.TrimSpace(out) != "/private/CodexBarCLI" {
		t.Fatalf("a check that passes must print the engine: out=%q err=%v", out, err)
	}
	if _, statErr := os.Stat(logPath); !os.IsNotExist(statErr) {
		t.Fatalf("a check that passes must not write a failure log: %v", statErr)
	}

	preparePinnedCLI = func(context.Context, string, bool) (string, error) {
		return "", errors.New("extract CodexBar: exit status 1 (ditto: No space left on device)")
	}
	out, err = captureStdout(t, func() error {
		return runPinnedCodexBar([]string{"--archive", "CodexBar.zip"}, false)
	})
	if err == nil || out != "" {
		t.Fatalf("a check that fails must fail: out=%q err=%v", out, err)
	}
	logged, _ := os.ReadFile(logPath)
	if strings.Count(string(logged), "\n") != 1 || !strings.Contains(string(logged), "engine check failed: extract CodexBar: exit status 1 (ditto: No space left on device)") {
		t.Fatalf("the failure must be kept with its reason, got %q", logged)
	}
}
