package codexbar

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/testenv"
)

func TestFindBinaryAcceptsWindowsCLIName(t *testing.T) {
	oldExec, oldApps, oldKnown := executablePathFn, systemAppBinaryPaths, knownBinaryPaths
	t.Cleanup(func() { executablePathFn = oldExec; systemAppBinaryPaths = oldApps; knownBinaryPaths = oldKnown })
	systemAppBinaryPaths = nil
	knownBinaryPaths = nil
	testenv.Home(t, t.TempDir())
	t.Setenv(appManagedCodexBarVersionEnvVar, "")
	t.Setenv("CODEXBAR_BIN", "")
	for _, where := range []string{"sibling", "PATH"} {
		t.Run(where, func(t *testing.T) {
			dir := t.TempDir()
			bin := filepath.Join(dir, "codexbar-cli.exe")
			if err := os.WriteFile(bin, []byte("fixture"), 0700); err != nil {
				t.Fatal(err)
			}
			if where == "sibling" {
				executablePathFn = func() (string, error) { return filepath.Join(dir, "codexbar-display"), nil }
				t.Setenv("PATH", t.TempDir())
			} else {
				executablePathFn = func() (string, error) { return filepath.Join(t.TempDir(), "codexbar-display"), nil }
				t.Setenv("PATH", dir)
			}
			got, err := FindBinary()
			if err != nil || got != bin {
				t.Fatalf("%s: got=%s err=%v", where, got, err)
			}
		})
	}
}

func TestResetAliasesPreserveKnownExpiredReset(t *testing.T) {
	for _, key := range []string{"resetsAt", "resetAt", "resets_at"} {
		reset, known := resetSecondsFromWindowMap(map[string]any{key: "2000-01-01T00:00:00Z"})
		if !known || reset != 0 {
			t.Fatalf("alias %s: reset=%d known=%v", key, reset, known)
		}
	}
	if _, known := resetSecondsFromWindowMap(map[string]any{}); known {
		t.Fatal("missing reset was invented")
	}
}
