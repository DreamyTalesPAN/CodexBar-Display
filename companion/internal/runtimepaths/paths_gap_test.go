package runtimepaths

import (
	"path/filepath"
	"strings"
	"testing"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/testenv"
)

// Every case pins HOME to a temp directory so the derived paths stay inside
// the sandbox; nothing is created, the functions only compute paths.
func TestDisplayWriterLockPathResolution(t *testing.T) {
	t.Run("environment override is trimmed and wins over home", func(t *testing.T) {
		want := filepath.Join(t.TempDir(), "writer.lock")
		t.Setenv(DisplayWriterLockEnv, "  "+want+"  ")
		if got := DisplayWriterLock(t.TempDir()); got != want {
			t.Fatalf("expected override %q, got %q", want, got)
		}
	})

	t.Run("explicit home selects the per-user run directory", func(t *testing.T) {
		t.Setenv(DisplayWriterLockEnv, "")
		home := t.TempDir()
		testenv.Home(t, home)
		want := filepath.Join(Root(home), "run", "display-writer.lock")
		if got := DisplayWriterLock(home); got != want {
			t.Fatalf("expected %q, got %q", want, got)
		}
		if !strings.HasPrefix(want, home+string(filepath.Separator)) {
			t.Fatalf("lock path %q escapes the sandbox home %q", want, home)
		}
	})

	t.Run("blank home falls back to the current user home", func(t *testing.T) {
		t.Setenv(DisplayWriterLockEnv, "")
		home := t.TempDir()
		testenv.Home(t, home)
		if got, want := DisplayWriterLock("   "), DisplayWriterLock(home); got != want {
			t.Fatalf("blank home gave %q, want the current-home path %q", got, want)
		}
	})

	t.Run("no home and no override yields no path", func(t *testing.T) {
		t.Setenv(DisplayWriterLockEnv, "")
		testenv.Home(t, "")
		if got := DisplayWriterLock(""); got != "" {
			t.Fatalf("expected no path without a home directory, got %q", got)
		}
	})
}

func TestFirmwareUpdateLogPathResolution(t *testing.T) {
	t.Run("environment override is trimmed and wins over home", func(t *testing.T) {
		want := filepath.Join(t.TempDir(), "firmware.log")
		t.Setenv(FirmwareUpdateLogEnv, "\t"+want+"\n")
		if got := FirmwareUpdateLog(t.TempDir()); got != want {
			t.Fatalf("expected override %q, got %q", want, got)
		}
	})

	t.Run("explicit home selects the logs directory", func(t *testing.T) {
		t.Setenv(FirmwareUpdateLogEnv, "")
		home := t.TempDir()
		testenv.Home(t, home)
		want := filepath.Join(Root(home), "logs", "firmware-update.log")
		if got := FirmwareUpdateLog(home); got != want {
			t.Fatalf("expected %q, got %q", want, got)
		}
		if !strings.HasPrefix(want, home+string(filepath.Separator)) {
			t.Fatalf("log path %q escapes the sandbox home %q", want, home)
		}
	})

	t.Run("no home and no override yields no path", func(t *testing.T) {
		t.Setenv(FirmwareUpdateLogEnv, "")
		testenv.Home(t, "")
		if got := FirmwareUpdateLog(""); got != "" {
			t.Fatalf("expected no path without a home directory, got %q", got)
		}
	})
}
