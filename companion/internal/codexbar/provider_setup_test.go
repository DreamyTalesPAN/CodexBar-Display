package codexbar

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestEnsureConfigSeedsPrivateConfigWithCommonProviders(t *testing.T) {
	t.Setenv("CODEXBAR_CONFIG", "")
	home := t.TempDir()
	path, err := EnsureConfig(home)
	if err != nil {
		t.Fatalf("EnsureConfig: %v", err)
	}
	wantPath := filepath.Join(home, ".codexbar", "config.json")
	if path != wantPath {
		t.Fatalf("expected %q, got %q", wantPath, path)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read config: %v", err)
	}
	for _, provider := range []string{"codex", "claude", "cursor", "gemini", "copilot"} {
		if !strings.Contains(string(data), `"id": "`+provider+`"`) {
			t.Fatalf("seed missing %s: %s", provider, data)
		}
	}
	if mode := fileMode(t, filepath.Dir(path)); mode.Perm() != 0o700 {
		t.Fatalf("expected config dir 0700, got %o", mode.Perm())
	}
	if mode := fileMode(t, path); mode.Perm() != 0o600 {
		t.Fatalf("expected config file 0600, got %o", mode.Perm())
	}
}

func TestEnsureConfigPreservesExistingStandardConfig(t *testing.T) {
	t.Setenv("CODEXBAR_CONFIG", "")
	home := t.TempDir()
	standard := filepath.Join(home, ".config", "codexbar", "config.json")
	if err := os.MkdirAll(filepath.Dir(standard), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(standard, []byte(`{"existing":true}`), 0o600); err != nil {
		t.Fatal(err)
	}
	path, err := EnsureConfig(home)
	if err != nil || path != standard {
		t.Fatalf("expected existing standard config, path=%q err=%v", path, err)
	}
	if _, err := os.Stat(filepath.Join(home, ".codexbar", "config.json")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("unexpected fallback config: %v", err)
	}
}

func TestRunUsageCommandInjectsResolvedConfig(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("CODEXBAR_CONFIG", "")
	script := filepath.Join(t.TempDir(), "print-config")
	if err := os.WriteFile(script, []byte("#!/bin/sh\nprintf '%s' \"$CODEXBAR_CONFIG\"\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	out, err := runUsageCommand(context.Background(), time.Second, script)
	if err != nil {
		t.Fatalf("runUsageCommand: %v", err)
	}
	want := filepath.Join(home, ".codexbar", "config.json")
	if string(out) != want {
		t.Fatalf("expected CODEXBAR_CONFIG=%q, got %q", want, out)
	}
}

func TestFindBinaryPrefersBundledCLI(t *testing.T) {
	originalExecutable := executablePathFn
	defer func() { executablePathFn = originalExecutable }()
	t.Setenv("CODEXBAR_BIN", "")
	dir := t.TempDir()
	executablePathFn = func() (string, error) { return filepath.Join(dir, "codexbar-display"), nil }
	bundled := filepath.Join(dir, "CodexBarCLI")
	if err := os.WriteFile(bundled, []byte("#!/bin/sh\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	got, err := FindBinary()
	if err != nil || got != bundled {
		t.Fatalf("expected bundled CLI %q, got %q err=%v", bundled, got, err)
	}
}

func TestFindBinaryPrefersUserApplicationsAppOverPATH(t *testing.T) {
	originalExecutable := executablePathFn
	originalSystemApps := systemAppBinaryPaths
	defer func() {
		executablePathFn = originalExecutable
		systemAppBinaryPaths = originalSystemApps
	}()
	systemAppBinaryPaths = nil
	executablePathFn = func() (string, error) { return filepath.Join(t.TempDir(), "codexbar-display"), nil }
	t.Setenv("CODEXBAR_BIN", "")
	home := t.TempDir()
	t.Setenv("HOME", home)
	pathDir := t.TempDir()
	t.Setenv("PATH", pathDir)
	pathCLI := filepath.Join(pathDir, "codexbar")
	appCLI := filepath.Join(home, "Applications", "CodexBar.app", "Contents", "Helpers", "CodexBarCLI")
	if err := os.MkdirAll(filepath.Dir(appCLI), 0o700); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{pathCLI, appCLI} {
		if err := os.WriteFile(path, []byte("#!/bin/sh\n"), 0o700); err != nil {
			t.Fatal(err)
		}
	}
	got, err := FindBinary()
	if err != nil || got != appCLI {
		t.Fatalf("expected installed app CLI %q before PATH %q, got %q err=%v", appCLI, pathCLI, got, err)
	}
}

func TestProviderReadinessClassifiesStructuredFixtures(t *testing.T) {
	raw := []byte(`[
      {"provider":"codex","usage":{"primary":{"usedPercent":0}}},
      {"provider":"claude","error":{"message":"No Claude session key found in browser cookies."}},
      {"provider":"cursor","error":{"message":"Keychain access denied."}},
      {"provider":"gemini","usage":{}},
      {"provider":"copilot","error":{"message":"No available fetch strategy."}}
    ]`)
	got := providerReadinessFromOutput(raw, errors.New("exit status 1"), nil)
	statuses := make(map[string]string)
	for _, provider := range got {
		statuses[provider.ID] = provider.Status
		if strings.Contains(strings.ToLower(provider.Detail), "session key") {
			t.Fatalf("raw provider error leaked: %+v", provider)
		}
	}
	want := map[string]string{
		"codex": ProviderReady, "claude": ProviderAuthRequired,
		"cursor": ProviderPermissionRequired, "gemini": ProviderNoUsageAvailable,
		"copilot": ProviderNotConfigured,
	}
	for provider, status := range want {
		if statuses[provider] != status {
			t.Fatalf("%s: expected %s, got %s (%+v)", provider, status, statuses[provider], got)
		}
	}
}

func TestProviderReadinessClassifiesTimeoutWithoutSecrets(t *testing.T) {
	got := providerReadinessFromOutput(nil, context.DeadlineExceeded, context.DeadlineExceeded)
	if len(got) != 1 || got[0].Status != ProviderTimeout || strings.Contains(got[0].Detail, "deadline") {
		t.Fatalf("unexpected timeout readiness: %+v", got)
	}
}

func TestProbeProviderSetupReportsReadyProvider(t *testing.T) {
	originalUsage := runUsageCommandFn
	originalVersion := runVersionCommandFn
	defer func() {
		runUsageCommandFn = originalUsage
		runVersionCommandFn = originalVersion
	}()
	bin := filepath.Join(t.TempDir(), "CodexBarCLI")
	if err := os.WriteFile(bin, []byte("#!/bin/sh\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("CODEXBAR_BIN", bin)
	t.Setenv("CODEXBAR_CONFIG", "")
	runVersionCommandFn = func(context.Context, time.Duration, string, ...string) ([]byte, error) {
		return []byte("CodexBar 0.44.0"), nil
	}
	runUsageCommandFn = func(context.Context, time.Duration, string, ...string) ([]byte, error) {
		return []byte(`[{"provider":"codex","usage":{"primary":{"usedPercent":0}}}]`), nil
	}
	got := ProbeProviderSetup(context.Background(), t.TempDir())
	if got.Status != ProviderReady || got.Engine.Status != ProviderReady || got.Engine.Version != "0.44" {
		t.Fatalf("unexpected ready probe: %+v", got)
	}
	if len(got.Providers) != 1 || !got.Providers[0].Enabled || got.Providers[0].Status != ProviderReady {
		t.Fatalf("unexpected ready providers: %+v", got.Providers)
	}
}

func TestProbeProviderSetupReportsMissingEngineWithoutRawPathInDetail(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "private-secret", "CodexBarCLI")
	t.Setenv("CODEXBAR_BIN", missing)
	t.Setenv("CODEXBAR_CONFIG", "")
	got := ProbeProviderSetup(context.Background(), t.TempDir())
	if got.Status != "setup_required" || got.Engine.Status != ProviderNotConfigured {
		t.Fatalf("unexpected missing engine probe: %+v", got)
	}
	if len(got.Providers) != 1 || strings.Contains(got.Providers[0].Detail, "private-secret") {
		t.Fatalf("missing engine leaked path: %+v", got.Providers)
	}
}

func fileMode(t *testing.T, path string) os.FileMode {
	t.Helper()
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat %s: %v", path, err)
	}
	return info.Mode()
}
