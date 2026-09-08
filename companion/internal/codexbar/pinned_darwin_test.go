package codexbar

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/testenv"
)

func TestPublishPinnedAppAtomicReplacement(t *testing.T) {
	root := t.TempDir()
	staged := filepath.Join(root, "stage")
	target := filepath.Join(root, "target")
	for _, p := range []string{staged, target} {
		if err := os.Mkdir(p, 0700); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(staged, "new"), []byte("new"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(target, "old"), []byte("old"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := publishPinnedApp(staged, target); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(target, "new")); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(staged, "old")); err != nil {
		t.Fatal(err)
	}
}

func TestValidatePinnedCLIEnforcesTrustBeforeExecuting(t *testing.T) {
	app := filepath.Join(t.TempDir(), "CodexBar.app")
	writeExecutable(t, filepath.Join(app, "Contents", "Helpers", "CodexBarCLI"))
	oldRun, oldVersion := pinnedRun, runVersionCommandFn
	t.Cleanup(func() { pinnedRun = oldRun; runVersionCommandFn = oldVersion })
	for _, failure := range []string{"signature", "identity", "gatekeeper", "version", ""} {
		t.Run(failure, func(t *testing.T) {
			versionCalled := false
			pinnedRun = func(_ context.Context, name string, args ...string) ([]byte, error) {
				if name == "/usr/bin/codesign" && args[0] == "--verify" && failure == "signature" {
					return nil, errors.New("bad signature")
				}
				if name == "/usr/bin/codesign" && args[0] == "--display" {
					if failure == "identity" {
						return []byte("TeamIdentifier=OTHER"), nil
					}
					return []byte("Identifier=" + pinnedBundle + "\nTeamIdentifier=" + pinnedTeam + "\n"), nil
				}
				if name == "/usr/sbin/spctl" && failure == "gatekeeper" {
					return nil, errors.New("rejected")
				}
				return nil, nil
			}
			runVersionCommandFn = func(context.Context, time.Duration, string, ...string) ([]byte, error) {
				versionCalled = true
				if failure == "version" {
					return []byte("CodexBar 0.45.0"), nil
				}
				return []byte("CodexBar " + PinnedVersion), nil
			}
			_, err := ValidatePinnedCLI(context.Background(), app)
			if (err != nil) != (failure != "") {
				t.Fatalf("failure=%s err=%v", failure, err)
			}
			if (failure == "signature" || failure == "identity" || failure == "gatekeeper") && versionCalled {
				t.Fatal("untrusted CLI executed")
			}
		})
	}
}

func TestPreparePinnedCLIRejectsUnsafePathBeforeReadingArchive(t *testing.T) {
	home := t.TempDir()
	testenv.Home(t, home)
	if err := os.Symlink(t.TempDir(), filepath.Join(home, "Library")); err != nil {
		t.Fatal(err)
	}
	if _, err := PreparePinnedCLI(context.Background(), "missing.zip", false); err == nil {
		t.Fatal("accepted symlink")
	}
}

func TestPreparePinnedCLIRelease(t *testing.T) {
	archive := os.Getenv("CODEXBAR_CONTRACT_ARCHIVE")
	if archive == "" {
		t.Skip("release staging runs in its dedicated CI job")
	}
	home := t.TempDir()
	testenv.Home(t, home)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	for _, running := range []bool{false, false, true} {
		input := archive
		if running {
			input = "missing.zip" // a verified running payload needs no archive
		}
		bin, err := PreparePinnedCLI(ctx, input, running)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := os.Stat(bin); err != nil {
			t.Fatal(err)
		}
	}
	leftovers, err := filepath.Glob(filepath.Join(home, "Library", "Application Support", "codexbar-display", "CodexBar", ".extract-*"))
	if err != nil || len(leftovers) != 0 {
		t.Fatalf("staging was not cleaned: %v, %v", leftovers, err)
	}
}
