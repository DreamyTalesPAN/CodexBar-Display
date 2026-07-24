package codexbar

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestEnsureConfigUsesCodexBarOwnedDefaultConfig(t *testing.T) {
	t.Setenv("CODEXBAR_CONFIG", "")
	bin := filepath.Join(t.TempDir(), "CodexBarCLI")
	if err := os.WriteFile(bin, []byte("#!/bin/sh\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("CODEXBAR_BIN", bin)
	originalBootstrap := runConfigBootstrapCommandFn
	defer func() { runConfigBootstrapCommandFn = originalBootstrap }()
	codexBarDefault := []byte(`{
		"version": 42,
		"providers": [{"id":"future-provider","enabled":true}]
	}`)
	var calls [][]string
	runConfigBootstrapCommandFn = func(
		_ context.Context,
		gotBin string,
		configPath string,
		args ...string,
	) ([]byte, error) {
		if gotBin != bin {
			t.Fatalf("unexpected binary: %q", gotBin)
		}
		calls = append(calls, append([]string{configPath}, args...))
		switch {
		case reflect.DeepEqual(args, []string{"config", "dump", "--format", "json"}):
			if _, err := os.Stat(configPath); !errors.Is(err, os.ErrNotExist) {
				t.Fatalf("default dump must use a missing config path: %v", err)
			}
			return codexBarDefault, nil
		case reflect.DeepEqual(args, []string{"config", "validate", "--format", "json"}):
			data, err := os.ReadFile(configPath)
			if err != nil {
				t.Fatalf("read staged config: %v", err)
			}
			if !reflect.DeepEqual(data, codexBarDefault) {
				t.Fatalf("CodexBar output changed: got %q want %q", data, codexBarDefault)
			}
			return []byte(`[]`), nil
		default:
			t.Fatalf("unexpected bootstrap args: %v", args)
			return nil, nil
		}
	}
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
	var config map[string]any
	if err := json.Unmarshal(data, &config); err != nil {
		t.Fatalf("parse seeded config: %v", err)
	}
	if config["version"] != float64(42) {
		t.Fatalf("unexpected seeded config: %#v", config)
	}
	providers, ok := config["providers"].([]any)
	if !ok || len(providers) != 1 {
		t.Fatalf("CodexBar provider inventory was not preserved: %#v", config)
	}
	if len(calls) != 2 {
		t.Fatalf("expected dump and validation, got %v", calls)
	}
	if mode := fileMode(t, filepath.Dir(path)); mode.Perm() != 0o700 {
		t.Fatalf("expected config dir 0700, got %o", mode.Perm())
	}
	if mode := fileMode(t, path); mode.Perm() != 0o600 {
		t.Fatalf("expected config file 0600, got %o", mode.Perm())
	}
}

func TestEnsureConfigRejectsInvalidCodexBarDefaultWithoutPublishing(t *testing.T) {
	t.Setenv("CODEXBAR_CONFIG", "")
	bin := filepath.Join(t.TempDir(), "CodexBarCLI")
	if err := os.WriteFile(bin, []byte("#!/bin/sh\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("CODEXBAR_BIN", bin)
	originalBootstrap := runConfigBootstrapCommandFn
	defer func() { runConfigBootstrapCommandFn = originalBootstrap }()
	runConfigBootstrapCommandFn = func(
		context.Context,
		string,
		string,
		...string,
	) ([]byte, error) {
		return []byte("not-json"), nil
	}

	home := t.TempDir()
	path, err := EnsureConfig(home)
	if err == nil {
		t.Fatal("invalid CodexBar output must fail")
	}
	if _, statErr := os.Stat(path); !errors.Is(statErr, os.ErrNotExist) {
		t.Fatalf("invalid config was published: %v", statErr)
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
	originalBootstrap := runConfigBootstrapCommandFn
	defer func() { runConfigBootstrapCommandFn = originalBootstrap }()
	runConfigBootstrapCommandFn = func(
		context.Context,
		string,
		string,
		...string,
	) ([]byte, error) {
		t.Fatal("existing config must not invoke CodexBar bootstrap")
		return nil, nil
	}
	path, err := EnsureConfig(home)
	if err != nil || path != standard {
		t.Fatalf("expected existing standard config, path=%q err=%v", path, err)
	}
	if _, err := os.Stat(filepath.Join(home, ".codexbar", "config.json")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("unexpected fallback config: %v", err)
	}
	data, err := os.ReadFile(standard)
	if err != nil || string(data) != `{"existing":true}` {
		t.Fatalf("existing config changed: data=%q err=%v", data, err)
	}
}

func TestRunUsageCommandInjectsResolvedConfig(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("CODEXBAR_CONFIG", "")
	script := filepath.Join(t.TempDir(), "print-config")
	if err := os.WriteFile(script, []byte(`#!/bin/sh
if [ "${1:-} ${2:-}" = "config dump" ]; then
  printf '{"version":1,"providers":[{"id":"future-provider","enabled":true}]}'
elif [ "${1:-} ${2:-}" = "config validate" ]; then
  printf '[]'
else
  printf '%s' "$CODEXBAR_CONFIG"
fi
`), 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("CODEXBAR_BIN", script)
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
	setExistingConfig(t)
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

func TestProbeProviderSetupForProviderUsesExactAutoUsage(t *testing.T) {
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
	setExistingConfig(t)
	runVersionCommandFn = func(context.Context, time.Duration, string, ...string) ([]byte, error) {
		return []byte("CodexBar 0.44.0"), nil
	}
	var usageArgs []string
	runUsageCommandFn = func(_ context.Context, _ time.Duration, _ string, args ...string) ([]byte, error) {
		if len(args) >= 2 && args[0] == "config" && args[1] == "providers" {
			return []byte(`[
				{"provider":"codex","displayName":"Codex","enabled":true},
				{"provider":"antigravity","displayName":"Antigravity","enabled":true}
			]`), nil
		}
		usageArgs = append([]string(nil), args...)
		return []byte(`[
			{"provider":"codex","source":"oauth","usage":{"primary":{"usedPercent":7},"secondary":{"usedPercent":13}}},
			{"provider":"antigravity","source":"cli","usage":{"primary":{"usedPercent":17},"secondary":{"usedPercent":23},"updatedAt":"2026-07-24T08:00:00Z"}}
		]`), nil
	}

	got := ProbeProviderSetupForProvider(context.Background(), t.TempDir(), "antigravity")
	if got.Status != ProviderReady || len(got.Providers) != 1 || got.Providers[0].ID != "antigravity" {
		t.Fatalf("unexpected exact readiness: %+v", got)
	}
	if got.Providers[0].Source != "cli" || got.Providers[0].CollectedAt != "2026-07-24T08:00:00Z" {
		t.Fatalf("missing safe source/freshness diagnostics: %+v", got.Providers[0])
	}
	if got.ExactUsage == nil || got.ExactUsage.Provider != "antigravity" ||
		got.ExactUsage.Frame.Session != 17 || got.ExactUsage.Frame.Weekly != 23 ||
		got.ExactUsage.CollectedAt.Format(time.RFC3339) != "2026-07-24T08:00:00Z" {
		t.Fatalf("exact usage was not retained for immediate companion refresh: %+v", got.ExactUsage)
	}
	want := []string{"usage", "--json", "--provider", "antigravity", "--source", "auto", "--web-timeout", "8"}
	if !reflect.DeepEqual(usageArgs, want) {
		t.Fatalf("unexpected exact usage args: got %v want %v", usageArgs, want)
	}
}

func TestProbeProviderSetupForProviderDoesNotCacheUndatedExactUsage(t *testing.T) {
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
	setExistingConfig(t)
	runVersionCommandFn = func(context.Context, time.Duration, string, ...string) ([]byte, error) {
		return []byte("CodexBar 0.44.0"), nil
	}
	runUsageCommandFn = func(_ context.Context, _ time.Duration, _ string, args ...string) ([]byte, error) {
		if len(args) >= 2 && args[0] == "config" && args[1] == "providers" {
			return []byte(`[{"provider":"future-provider","displayName":"Future Provider","enabled":true}]`), nil
		}
		return []byte(`[{"provider":"future-provider","source":"oauth","usage":{"secondary":{"usedPercent":23}}}]`), nil
	}

	got := ProbeProviderSetupForProvider(context.Background(), t.TempDir(), "future-provider")
	if got.Status != ProviderReady || got.ExactUsage != nil {
		t.Fatalf("undated provider usage must be ready but not immediately cached: %+v", got)
	}
}

func TestProbeProviderSetupForProviderDoesNotAcceptAnotherReadyProvider(t *testing.T) {
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
	setExistingConfig(t)
	runVersionCommandFn = func(context.Context, time.Duration, string, ...string) ([]byte, error) {
		return []byte("CodexBar 0.44.0"), nil
	}
	runUsageCommandFn = func(_ context.Context, _ time.Duration, _ string, args ...string) ([]byte, error) {
		if len(args) >= 2 && args[0] == "config" && args[1] == "providers" {
			return []byte(`[
				{"provider":"codex","displayName":"Codex","enabled":true},
				{"provider":"antigravity","displayName":"Antigravity","enabled":true}
			]`), nil
		}
		return []byte(`[
			{"provider":"codex","source":"oauth","usage":{"primary":{"usedPercent":7},"secondary":{"usedPercent":13}}}
		]`), nil
	}

	got := ProbeProviderSetupForProvider(context.Background(), t.TempDir(), "antigravity")
	if got.Status == ProviderReady || len(got.Providers) != 1 || got.Providers[0].ID != "antigravity" {
		t.Fatalf("another provider incorrectly satisfied exact readiness: %+v", got)
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

func setExistingConfig(t *testing.T) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "config.json")
	if err := os.WriteFile(path, []byte(`{"version":1,"providers":[]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("CODEXBAR_CONFIG", path)
}

func fileMode(t *testing.T, path string) os.FileMode {
	t.Helper()
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat %s: %v", path, err)
	}
	return info.Mode()
}
