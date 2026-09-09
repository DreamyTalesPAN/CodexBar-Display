package main

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimepaths"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/testenv"
)

func installedBinaryFixture(t *testing.T) (string, string) {
	t.Helper()
	home := t.TempDir()
	testenv.Home(t, home)
	name := "codexbar-display"
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	installed := runtimepaths.Path(home, "bin", name)
	if err := os.MkdirAll(filepath.Dir(installed), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(installed, []byte("installed fixture"), 0755); err != nil {
		t.Fatal(err)
	}
	return home, installed
}

func TestSnapshotUsesInstalledPlatformExecutable(t *testing.T) {
	home, installed := installedBinaryFixture(t)
	snapshot, _, err := snapshotInstalledCompanionBinary(home)
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Base(snapshot) != filepath.Base(installed) {
		t.Fatalf("snapshot %q does not use installed executable name %q", snapshot, installed)
	}
	data, err := os.ReadFile(snapshot)
	if err != nil || string(data) != "installed fixture" {
		t.Fatalf("snapshot data=%q err=%v", data, err)
	}
}

func TestRollbackRestoresInstalledPlatformExecutable(t *testing.T) {
	home, installed := installedBinaryFixture(t)
	snapshot := filepath.Join(home, "known-good")
	if err := os.WriteFile(snapshot, []byte("known-good fixture"), 0755); err != nil {
		t.Fatal(err)
	}
	previousLoad, previousRestart := loadReleaseStateFn, rollbackRestartLaunchAgentFn
	t.Cleanup(func() { loadReleaseStateFn = previousLoad; rollbackRestartLaunchAgentFn = previousRestart })
	loadReleaseStateFn = func(string) (releaseState, error) {
		return releaseState{LastKnownGood: lastKnownGoodState{CompanionBinary: snapshot}}, nil
	}
	restarts := 0
	rollbackRestartLaunchAgentFn = func(string) error { restarts++; return nil }
	if err := runRollback([]string{"--skip-firmware"}); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(installed)
	if err != nil || string(data) != "known-good fixture" || restarts != 1 {
		t.Fatalf("restored data=%q err=%v restarts=%d", data, err, restarts)
	}
	if runtime.GOOS == "windows" {
		if _, err := os.Stat(filepath.Join(filepath.Dir(installed), "codexbar-display")); !os.IsNotExist(err) {
			t.Fatalf("unexpected extensionless sidecar: %v", err)
		}
	}
}
