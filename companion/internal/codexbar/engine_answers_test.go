package codexbar

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
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
		engineInventory.store("", nil)
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

// settledEngine switches the reuse on and points FindBinary at a CLI file and
// APPDATA at a settings.json that were both last changed an hour ago. It
// returns the settings path.
func settledEngine(t *testing.T) string {
	t.Helper()
	withEngineAnswerReuse(t)
	t.Setenv(appManagedCodexBarVersionEnvVar, "")
	bin := filepath.Join(t.TempDir(), "codexbar-cli.exe")
	writeFileChangedAgo(t, bin, "engine", time.Hour)
	t.Setenv("CODEXBAR_BIN", bin)
	appData := t.TempDir()
	t.Setenv("APPDATA", appData)
	settings := filepath.Join(appData, "CodexBar", "settings.json")
	writeFileChangedAgo(t, settings, `{"enabled_providers":["claude"]}`, time.Hour)
	reported := "codexbar-cli 0.60.3"
	stubVersionCommand(t, &reported, nil)
	return settings
}

// stubEngineCommands answers every CLI call of the inventory readers and
// counts the "config providers" processes among them.
func stubEngineCommands(t *testing.T, inventory func() ([]byte, error)) *int {
	t.Helper()
	originalProvider, originalUsage := runProviderCommandFn, runUsageCommandFn
	t.Cleanup(func() { runProviderCommandFn, runUsageCommandFn = originalProvider, originalUsage })
	runs := 0
	run := func(_ context.Context, _ time.Duration, _ string, args ...string) ([]byte, error) {
		if !slices.Equal(args, providerInventoryArgs()) {
			return []byte(`[{"provider":"claude","usage":{"primary":{"usedPercent":8}}}]`), nil
		}
		runs++
		return inventory()
	}
	runProviderCommandFn, runUsageCommandFn = run, run
	return &runs
}

func inventoryWithClaude(on bool) []byte {
	return []byte(fmt.Sprintf(`[{"provider":"claude","displayName":"Claude","enabled":%t}]`, on))
}

// Windows started "codexbar-cli.exe config providers" for the collector, the
// usage and settings reads, the health check and the setup check, nine times
// in ninety seconds with the window open (#555). Win-CodexBar builds the
// inventory from its settings.json, so one state of that file is read once.
func TestProviderInventoryRunsTheCLIOncePerSettingsFileOnWindows(t *testing.T) {
	settings := settledEngine(t)
	originalMode := providerProbePerProvider
	t.Cleanup(func() { providerProbePerProvider = originalMode })
	providerProbePerProvider = true
	claudeOn := true
	runs := stubEngineCommands(t, func() ([]byte, error) { return inventoryWithClaude(claudeOn), nil })

	for range 2 {
		inventory, err := FetchProviderInventory(context.Background())
		if err != nil || len(inventory) != 1 || !inventory[0].Enabled {
			t.Fatalf("inventory=%+v err=%v", inventory, err)
		}
	}
	if _, err := FetchProviderSettings(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, err := runUsageAllEnabled(context.Background(), time.Second, os.Getenv("CODEXBAR_BIN"), "--web-timeout", "8"); err != nil {
		t.Fatal(err)
	}
	if *runs != 1 {
		t.Fatalf("unchanged settings were read by %d CLI processes, want 1", *runs)
	}

	// Anyone may write settings.json, the customer's own Win-CodexBar
	// included. The file is the authority, so a changed one is read again.
	claudeOn = false
	writeFileChangedAgo(t, settings, `{"enabled_providers":[]}`, time.Minute)
	inventory, err := FetchProviderInventory(context.Background())
	if err != nil || len(inventory) != 1 || inventory[0].Enabled || *runs != 2 {
		t.Fatalf("changed settings must be read again: inventory=%+v err=%v runs=%d", inventory, err, *runs)
	}
}

// The Companion's own switch is never answered from before the switch, also
// when settings.json kept its size and modification time.
func TestSetProviderEnabledForgetsTheInventoryAtOnce(t *testing.T) {
	settledEngine(t)
	claudeOn := true
	runs := stubEngineCommands(t, func() ([]byte, error) { return inventoryWithClaude(claudeOn), nil })
	if inventory, err := FetchProviderInventory(context.Background()); err != nil || !inventory[0].Enabled {
		t.Fatalf("inventory=%+v err=%v", inventory, err)
	}

	claudeOn = false
	if err := SetProviderEnabled(context.Background(), "claude", false); err != nil {
		t.Fatal(err)
	}
	inventory, err := FetchProviderInventory(context.Background())
	if err != nil || inventory[0].Enabled || *runs != 2 {
		t.Fatalf("the switch must be read back from the CLI: inventory=%+v err=%v runs=%d", inventory, err, *runs)
	}
}

// A stale inventory is worse than one more process.
func TestProviderInventoryAsksAgainWheneverTheAnswerMayNotHold(t *testing.T) {
	for _, tc := range []struct {
		name    string
		prepare func(t *testing.T, settings string)
		first   func() ([]byte, error)
		aged    time.Duration
	}{
		{name: "an answer that is no inventory", first: func() ([]byte, error) { return []byte("Error: Failed to decode"), nil }},
		{name: "a read that failed", first: func() ([]byte, error) { return inventoryWithClaude(false), errors.New("exit status 1") }},
		{name: "settings that were just written", prepare: func(t *testing.T, settings string) {
			writeFileChangedAgo(t, settings, `{"enabled_providers":["claude"]}`, 0)
		}},
		{name: "no settings file", prepare: func(t *testing.T, settings string) {
			if err := os.Remove(settings); err != nil {
				t.Fatal(err)
			}
		}},
		// Win-CodexBar answers with its default switches and no error when it
		// cannot read its settings. Such an answer must not stay for good.
		{name: "an answer kept for five minutes", aged: inventoryMaxAge},
		{name: "the Mac", prepare: func(*testing.T, string) { reuseEngineAnswers = false }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			settings := settledEngine(t)
			if tc.prepare != nil {
				tc.prepare(t, settings)
			}
			answer := tc.first
			runs := stubEngineCommands(t, func() ([]byte, error) {
				if answer != nil {
					defer func() { answer = nil }()
					return answer()
				}
				return inventoryWithClaude(true), nil
			})
			_, _ = FetchProviderInventory(context.Background())
			engineInventory.mu.Lock()
			engineInventory.at = engineInventory.at.Add(-tc.aged)
			engineInventory.mu.Unlock()
			inventory, err := FetchProviderInventory(context.Background())
			if err != nil || len(inventory) != 1 || !inventory[0].Enabled || *runs != 2 {
				t.Fatalf("the CLI must be asked again: inventory=%+v err=%v runs=%d", inventory, err, *runs)
			}
		})
	}
}
