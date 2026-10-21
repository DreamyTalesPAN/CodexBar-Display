package codexbar

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"testing"
	"time"
)

// withEngineAnswerReuse switches the reuse on and starts and ends with nothing
// kept.
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

}

// settledEngine switches the reuse on and points FindBinary at a CLI file, and
// both APPDATA (Windows) and CODEXBAR_CONFIG (the Mac) at a settings file, that
// were all last changed an hour ago. It returns the settings path.
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
	t.Setenv("CODEXBAR_CONFIG", settings)
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

// The inventory was kept one minute and then read again on every poll with the
// window open: "config providers" once a minute on Windows (#555). The answer
// now stays for the life of the engine process while settings.json is unchanged
// on Windows. The Mac reads it again after a minute (the next test).
func TestProviderInventoryIsKeptForTheLifeOfTheEngine(t *testing.T) {
	settledEngine(t)
	originalMode := providerProbePerProvider
	t.Cleanup(func() { providerProbePerProvider = originalMode })
	providerProbePerProvider = true
	runs := stubEngineCommands(t, func() ([]byte, error) { return inventoryWithClaude(true), nil })
	if _, err := FetchProviderInventory(context.Background()); err != nil {
		t.Fatal(err)
	}
	engineInventory.mu.Lock()
	engineInventory.at = engineInventory.at.Add(-time.Hour)
	engineInventory.mu.Unlock()
	inventory, err := FetchProviderInventory(context.Background())
	if err != nil || len(inventory) != 1 || !inventory[0].Enabled || *runs != 1 {
		t.Fatalf("an hour-old answer for unchanged settings must be kept: inventory=%+v err=%v runs=%d", inventory, err, *runs)
	}
}

// The Mac's inventory is not verified to come from the CodexBar config alone,
// so an answer older than inventoryMaxAge is read again there; Windows keeps it.
func TestProviderInventoryAgeDependsOnThePlatform(t *testing.T) {
	for _, tc := range []struct {
		name        string
		perProvider bool
		wantRuns    int
	}{
		{name: "the Mac reads an answer older than a minute again", perProvider: false, wantRuns: 2},
		{name: "Windows keeps the answer", perProvider: true, wantRuns: 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			settledEngine(t)
			originalMode := providerProbePerProvider
			t.Cleanup(func() { providerProbePerProvider = originalMode })
			providerProbePerProvider = tc.perProvider
			runs := stubEngineCommands(t, func() ([]byte, error) { return inventoryWithClaude(true), nil })
			if _, err := FetchProviderInventory(context.Background()); err != nil {
				t.Fatal(err)
			}
			engineInventory.mu.Lock()
			engineInventory.at = engineInventory.at.Add(-2 * time.Minute)
			engineInventory.mu.Unlock()
			if _, err := FetchProviderInventory(context.Background()); err != nil || *runs != tc.wantRuns {
				t.Fatalf("err=%v runs=%d, want %d runs", err, *runs, tc.wantRuns)
			}
		})
	}
}

// An inventory that may not hold for the settings it was read from is asked
// again at once, however long the engine has run.
func TestProviderInventoryAsksAgainWheneverTheAnswerMayNotHold(t *testing.T) {
	for _, tc := range []struct {
		name    string
		prepare func(t *testing.T, settings string)
		first   func() ([]byte, error)
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
			inventory, err := FetchProviderInventory(context.Background())
			if err != nil || len(inventory) != 1 || !inventory[0].Enabled || *runs != 2 {
				t.Fatalf("the CLI must be asked again: inventory=%+v err=%v runs=%d", inventory, err, *runs)
			}
		})
	}
}

// On the Mac the inventory is read from the CodexBar config the CLI is pointed
// at, the same file commandEnvironment passes as CODEXBAR_CONFIG; a config path
// carried by the caller's context wins, as it does for the CLI (#555).
func TestInventorySettingsPathIsTheConfigTheMacCLIReads(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows reads its own settings.json under APPDATA")
	}
	config := filepath.Join(t.TempDir(), "codexbar.json")
	t.Setenv("CODEXBAR_CONFIG", config)
	if got := inventorySettingsPath(context.Background()); got != config {
		t.Fatalf("inventory settings path = %q, want the CODEXBAR_CONFIG file %q", got, config)
	}
	passed := filepath.Join(t.TempDir(), "passed.json")
	ctx := context.WithValue(context.Background(), configPathContextKey{}, passed)
	if got := inventorySettingsPath(ctx); got != passed {
		t.Fatalf("inventory settings path = %q, want the config passed to the CLI %q", got, passed)
	}
}

// The Control Center asks with fresh=1 when a provider list opens. That drops
// the kept inventory once, so a plugin installed or removed while the engine
// ran shows; the answer is kept again after that read.
func TestForgetProviderInventoryMakesTheNextReadAskTheCLI(t *testing.T) {
	settledEngine(t)
	runs := stubEngineCommands(t, func() ([]byte, error) { return inventoryWithClaude(true), nil })
	if _, err := FetchProviderInventory(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, err := FetchProviderInventory(context.Background()); err != nil || *runs != 1 {
		t.Fatalf("a plain read must keep the answer: err=%v runs=%d", err, *runs)
	}
	ForgetProviderInventory()
	if _, err := FetchProviderInventory(context.Background()); err != nil || *runs != 2 {
		t.Fatalf("after ForgetProviderInventory the CLI must be asked again: err=%v runs=%d", err, *runs)
	}
	if _, err := FetchProviderInventory(context.Background()); err != nil || *runs != 2 {
		t.Fatalf("the read after the forget is kept again: err=%v runs=%d", err, *runs)
	}
}

// A read that began before a plugin change and ends after the fresh=1 forget
// must not bring its old answer back (Codex review on #700).
func TestInventoryReadStartedBeforeAForgetIsNotKept(t *testing.T) {
	settledEngine(t)
	started, release := make(chan struct{}), make(chan struct{})
	pluginInstalled := false
	runs := stubEngineCommands(t, func() ([]byte, error) {
		if pluginInstalled {
			return inventoryWithClaude(false), nil
		}
		close(started)
		<-release
		return inventoryWithClaude(true), nil
	})
	done := make(chan error, 1)
	go func() {
		_, err := FetchProviderInventory(context.Background())
		done <- err
	}()
	<-started
	pluginInstalled = true
	ForgetProviderInventory()
	close(release)
	if err := <-done; err != nil {
		t.Fatal(err)
	}

	inventory, err := FetchProviderInventory(context.Background())
	if err != nil || len(inventory) != 1 || inventory[0].Enabled || *runs != 2 {
		t.Fatalf("the read after the forget must ask the CLI: inventory=%+v err=%v runs=%d", inventory, err, *runs)
	}
}
