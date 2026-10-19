//go:build darwin || linux || windows

package writerlock

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/errcode"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimepaths"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/testenv"
)

// Acquire takes its path from the environment override and must not write
// anything into the user's home, so the test never reaches the real VibeTV lock.
func TestAcquireUsesEnvironmentOverrideAndKeepsHomeClean(t *testing.T) {
	home := t.TempDir()
	testenv.Home(t, home)
	path := filepath.Join(t.TempDir(), "writer.lock")
	t.Setenv(runtimepaths.DisplayWriterLockEnv, path)

	lock, err := Acquire()
	if err != nil {
		t.Fatal(err)
	}
	defer lock.Release()
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("expected the override lock file to exist: %v", err)
	}
	entries, err := os.ReadDir(home)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Fatalf("acquiring the lock wrote %d entries into the home directory", len(entries))
	}
}

// Without a home directory there is no lock location at all, so Acquire must
// fail before it creates the override file.
func TestAcquireWithoutHomeFailsBeforeCreatingAnyLock(t *testing.T) {
	testenv.Home(t, "")
	path := filepath.Join(t.TempDir(), "writer.lock")
	t.Setenv(runtimepaths.DisplayWriterLockEnv, path)

	lock, err := Acquire()
	if err == nil {
		lock.Release()
		t.Fatal("expected an error without a home directory")
	}
	if !strings.Contains(err.Error(), "resolve home directory for display writer lock") {
		t.Fatalf("unexpected error: %v", err)
	}
	if _, statErr := os.Stat(path); !errors.Is(statErr, os.ErrNotExist) {
		t.Fatalf("lock file must not exist without a home directory: %v", statErr)
	}
}

// A second owner must get a coded error that names the contested lock file and
// carries the shared recovery text, because the customer sees both.
func TestLockedErrorNamesTheLockAndItsRecovery(t *testing.T) {
	path := filepath.Join(t.TempDir(), "writer.lock")
	first, err := AcquireAt(path)
	if err != nil {
		t.Fatal(err)
	}
	defer first.Release()

	_, err = AcquireAt(path)
	if got := errcode.Of(err); got != errcode.RuntimeWriterLocked {
		t.Fatalf("want %q, got %q (%v)", errcode.RuntimeWriterLocked, got, err)
	}
	if !strings.Contains(err.Error(), path) {
		t.Fatalf("message does not name the lock file %q: %q", path, err.Error())
	}
	if !strings.Contains(err.Error(), "already owns the display writer lock") {
		t.Fatalf("message does not explain the owner conflict: %q", err.Error())
	}
	recovery, ok := err.(interface{ RecoveryAction() string })
	if !ok {
		t.Fatalf("locked error %T has no recovery action", err)
	}
	want := errcode.DefaultRecovery(errcode.RuntimeWriterLocked)
	if got := recovery.RecoveryAction(); got == "" || got != want {
		t.Fatalf("recovery action %q, want %q", got, want)
	}
}
