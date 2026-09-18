package codexbar

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestWindowsConfigFreshSelectionIsEmpty(t *testing.T) {
	t.Setenv("APPDATA", t.TempDir())
	path, err := ensureWindowsConfigDir()
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var settings map[string]json.RawMessage
	if err := json.Unmarshal(data, &settings); err != nil {
		t.Fatal(err)
	}
	if len(settings) != 1 || string(settings["enabled_providers"]) != "[]" {
		t.Fatalf("bootstrap must own only the empty selection, got %s", data)
	}
}

func TestWindowsConfigPreservesExistingBytes(t *testing.T) {
	for _, content := range []string{
		`{"enabled_providers":["codex","claude"],"future_setting":{"keep":true}}`,
		`{"enabled_providers":[]}`,
		`not valid JSON; never silently reset customer configuration`,
		"",
	} {
		t.Run(content, func(t *testing.T) {
			t.Setenv("APPDATA", t.TempDir())
			path, err := ensureWindowsConfigDir()
			if err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
				t.Fatal(err)
			}
			if _, err := ensureWindowsConfigDir(); err != nil {
				t.Fatal(err)
			}
			got, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			if string(got) != content {
				t.Fatalf("existing settings changed: %q", got)
			}
		})
	}
}

func TestWindowsConfigConcurrentInitialization(t *testing.T) {
	appData := t.TempDir()
	t.Setenv("APPDATA", appData)
	var wg sync.WaitGroup
	for i := 0; i < 32; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			path, err := ensureWindowsConfigDir()
			if err != nil {
				t.Error(err)
				return
			}
			data, err := os.ReadFile(path)
			if err != nil {
				t.Error(err)
				return
			}
			if string(data) != "{\"enabled_providers\":[]}\n" {
				t.Errorf("incomplete config: %q", data)
			}
		}()
	}
	wg.Wait()
	entries, err := os.ReadDir(filepath.Join(appData, "CodexBar"))
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].Name() != "settings.json" {
		t.Fatalf("leftover staging files: %v", entries)
	}
}

func TestWindowsConfigInvalidLocation(t *testing.T) {
	t.Setenv("APPDATA", "")
	if _, err := ensureWindowsConfigDir(); err == nil {
		t.Fatal("missing APPDATA accepted")
	}
	appData := t.TempDir()
	t.Setenv("APPDATA", appData)
	if err := os.WriteFile(filepath.Join(appData, "CodexBar"), []byte("existing file"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := ensureWindowsConfigDir(); err == nil {
		t.Fatal("non-directory config parent accepted")
	}
}

func TestWindowsConfigFailurePreventsCLIStart(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("Windows command initialization contract")
	}
	t.Setenv("APPDATA", "")
	// An explicit config path cannot bypass Windows' actual settings location.
	if _, err := commandEnvironment("ignored.json"); err == nil {
		t.Fatal("initialization failure ignored")
	}
	if _, err := runUsageCommand(context.Background(), time.Second, "must-not-start.exe"); err == nil || !strings.Contains(err.Error(), "APPDATA") {
		t.Fatalf("usage process did not fail at config initialization: %v", err)
	}
	s, err := NewDashboardServeSupervisor(DashboardServeConfig{Binary: "must-not-start.exe"})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.runOnce(context.Background()); err == nil || !strings.Contains(err.Error(), "APPDATA") {
		t.Fatalf("dashboard process did not fail at config initialization: %v", err)
	}
}
