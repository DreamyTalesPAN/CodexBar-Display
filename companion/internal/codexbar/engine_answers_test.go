package codexbar

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// withEngineAnswerReuse switches the Windows reuse on and starts and ends with
// nothing kept.
func withEngineAnswerReuse(t *testing.T) {
	t.Helper()
	original := reuseEngineAnswers
	forget := func() {
		engineVersion.store("", looseVersion{})
	}
	t.Cleanup(func() {
		reuseEngineAnswers = original
		forget()
	})
	reuseEngineAnswers = true
	forget()
}

// writeFileChangedAgo writes a file whose last change lies age in the past.
func writeFileChangedAgo(t *testing.T, path, content string, age time.Duration) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o700); err != nil {
		t.Fatal(err)
	}
	changed := time.Now().Add(-age)
	if err := os.Chtimes(path, changed, changed); err != nil {
		t.Fatal(err)
	}
}

// stubVersionCommand counts the "--version" processes and answers with
// *reported, or fails while *failing is set.
func stubVersionCommand(t *testing.T, reported *string, failing *bool) *int {
	t.Helper()
	original := runVersionCommandFn
	t.Cleanup(func() { runVersionCommandFn = original })
	runs := 0
	runVersionCommandFn = func(context.Context, time.Duration, string, ...string) ([]byte, error) {
		runs++
		if failing != nil && *failing {
			return nil, errors.New("exit status 1")
		}
		return []byte(*reported), nil
	}
	return &runs
}

// Windows started "codexbar-cli.exe --version" for every probe, settings read
// and collection, nine times in ninety seconds with the window open (#555).
// The version belongs to the CLI file, so one state of that file is asked once.
func TestInstalledVersionRunsTheCLIOncePerFileOnWindows(t *testing.T) {
	withEngineAnswerReuse(t)
	t.Setenv(appManagedCodexBarVersionEnvVar, "")
	bin := filepath.Join(t.TempDir(), "codexbar-cli.exe")
	writeFileChangedAgo(t, bin, "engine", time.Hour)
	reported := "codexbar-cli 0.60.3"
	runs := stubVersionCommand(t, &reported, nil)

	for range 3 {
		version, err := installedVersion(context.Background(), bin)
		if err != nil || version.String() != "0.60.3" {
			t.Fatalf("version=%v err=%v", version, err)
		}
	}
	if *runs != 1 {
		t.Fatalf("an unchanged CLI was asked for its version %d times, want 1", *runs)
	}

	// An update replaces the file; the kept answer does not belong to it.
	reported = "codexbar-cli 0.61.2"
	writeFileChangedAgo(t, bin, "a newer engine", time.Minute)
	version, err := installedVersion(context.Background(), bin)
	if err != nil || version.String() != "0.61.2" || *runs != 2 {
		t.Fatalf("a replaced CLI must be asked again: version=%v err=%v runs=%d", version, err, *runs)
	}
}

func TestInstalledVersionAsksAgainWheneverTheAnswerMayNotHold(t *testing.T) {
	t.Setenv(appManagedCodexBarVersionEnvVar, "")
	reported := "codexbar-cli 0.60.3"

	t.Run("a read that failed", func(t *testing.T) {
		withEngineAnswerReuse(t)
		bin := filepath.Join(t.TempDir(), "codexbar-cli.exe")
		writeFileChangedAgo(t, bin, "engine", time.Hour)
		failing := true
		runs := stubVersionCommand(t, &reported, &failing)
		if _, err := installedVersion(context.Background(), bin); err == nil {
			t.Fatal("a failed version read was reported as a version")
		}
		failing = false
		if version, err := installedVersion(context.Background(), bin); err != nil || version.String() != "0.60.3" || *runs != 2 {
			t.Fatalf("a failed read must not be kept: version=%v err=%v runs=%d", version, err, *runs)
		}
	})

	t.Run("a file that was just written", func(t *testing.T) {
		withEngineAnswerReuse(t)
		bin := filepath.Join(t.TempDir(), "codexbar-cli.exe")
		writeFileChangedAgo(t, bin, "engine", 0)
		runs := stubVersionCommand(t, &reported, nil)
		for range 2 {
			if _, err := installedVersion(context.Background(), bin); err != nil {
				t.Fatal(err)
			}
		}
		if *runs != 2 {
			t.Fatalf("a CLI file still being written was asked %d times, want 2", *runs)
		}
	})

	t.Run("the Mac", func(t *testing.T) {
		withEngineAnswerReuse(t)
		reuseEngineAnswers = false
		bin := filepath.Join(t.TempDir(), "codexbar")
		writeFileChangedAgo(t, bin, "engine", time.Hour)
		runs := stubVersionCommand(t, &reported, nil)
		for range 2 {
			if _, err := installedVersion(context.Background(), bin); err != nil {
				t.Fatal(err)
			}
		}
		if *runs != 2 {
			t.Fatalf("the Mac path changed: its CLI was asked %d times, want 2", *runs)
		}
	})
}
