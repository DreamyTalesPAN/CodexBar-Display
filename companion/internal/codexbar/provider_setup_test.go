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

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/writerlock"
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
	if !firstRunProviderSetupPending(path) {
		t.Fatal("new config must remain pending until the collector's first usage answer")
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
	if _, statErr := os.Stat(firstRunMarkerPath(path)); !errors.Is(statErr, os.ErrNotExist) {
		t.Fatalf("invalid config marker was published: %v", statErr)
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

func TestEnsureConfigDiscardsFirstRunMarkerWhenAnotherConfigWins(t *testing.T) {
	t.Setenv("CODEXBAR_CONFIG", "")
	bin := filepath.Join(t.TempDir(), "CodexBarCLI")
	if err := os.WriteFile(bin, []byte("#!/bin/sh\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("CODEXBAR_BIN", bin)
	originalBootstrap := runConfigBootstrapCommandFn
	defer func() { runConfigBootstrapCommandFn = originalBootstrap }()

	home := t.TempDir()
	path := filepath.Join(home, ".codexbar", "config.json")
	runConfigBootstrapCommandFn = func(
		_ context.Context,
		_ string,
		_ string,
		args ...string,
	) ([]byte, error) {
		if reflect.DeepEqual(args, []string{"config", "dump", "--format", "json"}) {
			return []byte(`{"version":1,"providers":[{"id":"codex","enabled":true}]}`), nil
		}
		if reflect.DeepEqual(args, []string{"config", "validate", "--format", "json"}) {
			if err := os.WriteFile(path, []byte(`{"existing":true}`), 0o600); err != nil {
				t.Fatalf("publish competing config: %v", err)
			}
			return []byte(`{}`), nil
		}
		t.Fatalf("unexpected bootstrap command: %v", args)
		return nil, nil
	}

	gotPath, err := EnsureConfig(home)
	if err != nil {
		t.Fatalf("EnsureConfig: %v", err)
	}
	if gotPath != path {
		t.Fatalf("expected competing config path %q, got %q", path, gotPath)
	}
	data, err := os.ReadFile(path)
	if err != nil || string(data) != `{"existing":true}` {
		t.Fatalf("competing config changed: data=%q err=%v", data, err)
	}
	if firstRunProviderSetupPending(path) {
		t.Fatal("losing config publication retained the first-run marker")
	}
}

func TestEnsureConfigPreservesFirstRunMarkerWhenParallelBootstrapWins(t *testing.T) {
	t.Setenv("CODEXBAR_CONFIG", "")
	bin := filepath.Join(t.TempDir(), "CodexBarCLI")
	if err := os.WriteFile(bin, []byte("#!/bin/sh\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("CODEXBAR_BIN", bin)
	originalBootstrap := runConfigBootstrapCommandFn
	defer func() { runConfigBootstrapCommandFn = originalBootstrap }()
	runConfigBootstrapCommandFn = func(context.Context, string, string, ...string) ([]byte, error) {
		return nil, errors.New("parallel bootstrap loser must reuse the winning config")
	}

	home := t.TempDir()
	path := filepath.Join(home, ".codexbar", "config.json")
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	winnerLock, err := writerlock.AcquireAt(path + ".vibetv-bootstrap.lock")
	if err != nil {
		t.Fatal(err)
	}
	defer winnerLock.Release()

	done := make(chan error, 1)
	go func() {
		_, err := EnsureConfig(home)
		done <- err
	}()
	select {
	case err := <-done:
		t.Fatalf("parallel bootstrap loser did not wait for the winner: %v", err)
	case <-time.After(50 * time.Millisecond):
	}

	if err := os.WriteFile(path, []byte(`{"version":1,"providers":[{"id":"codex","enabled":true}]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(firstRunMarkerPath(path), []byte("pending\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	winnerLock.Release()

	if err := <-done; err != nil {
		t.Fatalf("EnsureConfig: %v", err)
	}
	if !firstRunProviderSetupPending(path) {
		t.Fatal("losing parallel bootstrap consumed the winner's first-run marker")
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
	out, err := runUsageCommand(context.Background(), 5*time.Second, script)
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
	t.Setenv(appManagedCodexBarVersionEnvVar, "")
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
	t.Setenv(appManagedCodexBarVersionEnvVar, "")
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

func TestFindBinaryUsesOnlyAppManagedPinnedPayload(t *testing.T) {
	originalExecutable := executablePathFn
	originalSystemApps := systemAppBinaryPaths
	defer func() {
		executablePathFn = originalExecutable
		systemAppBinaryPaths = originalSystemApps
	}()
	executablePathFn = func() (string, error) { return filepath.Join(t.TempDir(), "codexbar-display"), nil }
	t.Setenv(appManagedCodexBarVersionEnvVar, "0.46.0")
	home := t.TempDir()
	t.Setenv("HOME", home)

	privateCLI := filepath.Join(home, "Library", "Application Support", "codexbar-display", "CodexBar", "0.46.0", "CodexBar.app", "Contents", "Helpers", "CodexBarCLI")
	foreignCLI := filepath.Join(t.TempDir(), "false-codexbar")
	systemCLI := filepath.Join(t.TempDir(), "CodexBar.app", "Contents", "Helpers", "CodexBarCLI")
	pathDir := t.TempDir()
	pathCLI := filepath.Join(pathDir, "codexbar")
	systemAppBinaryPaths = []string{systemCLI}
	t.Setenv("PATH", pathDir)
	t.Setenv("CODEXBAR_BIN", foreignCLI)
	for _, path := range []string{privateCLI, foreignCLI, systemCLI, pathCLI} {
		if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte("#!/bin/sh\n"), 0o700); err != nil {
			t.Fatal(err)
		}
	}

	got, err := FindBinary()
	if err != nil || got != privateCLI {
		t.Fatalf("expected app-managed CLI %q, got %q err=%v", privateCLI, got, err)
	}

	if err := os.Remove(privateCLI); err != nil {
		t.Fatal(err)
	}
	got, err = FindBinary()
	if err == nil || got != "" {
		t.Fatalf("expected app-managed mode to fail closed, got %q err=%v", got, err)
	}
}

func TestFindBinaryRejectsSymlinkedAppManagedPinnedPayload(t *testing.T) {
	for _, tc := range []struct {
		name  string
		setup func(t *testing.T, home string)
	}{
		{
			name: "target app",
			setup: func(t *testing.T, home string) {
				targetApp := filepath.Join(home, "Library", "Application Support", "codexbar-display", "CodexBar", "0.46.0", "CodexBar.app")
				realApp := filepath.Join(t.TempDir(), "CodexBar.app")
				writeExecutable(t, filepath.Join(realApp, "Contents", "Helpers", "CodexBarCLI"))
				if err := os.MkdirAll(filepath.Dir(targetApp), 0o700); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink(realApp, targetApp); err != nil {
					t.Fatal(err)
				}
			},
		},
		{
			name: "parent segment",
			setup: func(t *testing.T, home string) {
				targetParent := filepath.Join(home, "Library", "Application Support", "codexbar-display", "CodexBar")
				realParent := filepath.Join(t.TempDir(), "CodexBar")
				writeExecutable(t, filepath.Join(realParent, "0.46.0", "CodexBar.app", "Contents", "Helpers", "CodexBarCLI"))
				if err := os.MkdirAll(filepath.Dir(targetParent), 0o700); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink(realParent, targetParent); err != nil {
					t.Fatal(err)
				}
			},
		},
		{
			name: "ancestor segment",
			setup: func(t *testing.T, home string) {
				realLibrary := filepath.Join(t.TempDir(), "Library")
				writeExecutable(t, filepath.Join(realLibrary, "Application Support", "codexbar-display", "CodexBar", "0.46.0", "CodexBar.app", "Contents", "Helpers", "CodexBarCLI"))
				if err := os.MkdirAll(home, 0o700); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink(realLibrary, filepath.Join(home, "Library")); err != nil {
					t.Fatal(err)
				}
			},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			originalExecutable := executablePathFn
			originalSystemApps := systemAppBinaryPaths
			defer func() {
				executablePathFn = originalExecutable
				systemAppBinaryPaths = originalSystemApps
			}()
			executablePathFn = func() (string, error) { return filepath.Join(t.TempDir(), "codexbar-display"), nil }
			systemAppBinaryPaths = nil
			t.Setenv(appManagedCodexBarVersionEnvVar, "0.46.0")
			home := t.TempDir()
			t.Setenv("HOME", home)
			foreignCLI := filepath.Join(t.TempDir(), "false-codexbar")
			writeExecutable(t, foreignCLI)
			t.Setenv("CODEXBAR_BIN", foreignCLI)
			tc.setup(t, home)

			got, err := FindBinary()
			if err == nil || got != "" {
				t.Fatalf("expected symlinked app-managed path to fail closed, got %q err=%v", got, err)
			}
			if !strings.Contains(err.Error(), "symlink") {
				t.Fatalf("expected symlink error, got %v", err)
			}
		})
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

func TestProviderReadinessCopyHidesInternalUsageServiceName(t *testing.T) {
	for _, status := range []string{
		ProviderAuthRequired,
		ProviderPermissionRequired,
		ProviderNoUsageAvailable,
		ProviderTimeout,
		ProviderConfigError,
		ProviderEngineError,
		ProviderNotConfigured,
	} {
		got := providerResult("codexbar", status)
		customerCopy := strings.Join([]string{got.Label, got.Detail, got.NextAction}, " ")
		if strings.Contains(customerCopy, "CodexBar") {
			t.Fatalf("%s leaked the internal service name: %+v", status, got)
		}
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
		return []byte("CodexBar 0.46.0"), nil
	}
	runUsageCommandFn = func(context.Context, time.Duration, string, ...string) ([]byte, error) {
		return []byte(`[{"provider":"codex","usage":{"primary":{"usedPercent":0}}}]`), nil
	}
	got := ProbeProviderSetup(context.Background(), t.TempDir())
	if got.Status != ProviderReady || got.Engine.Status != ProviderReady || got.Engine.Version != "0.46" {
		t.Fatalf("unexpected ready probe: %+v", got)
	}
	if len(got.Providers) != 1 || got.Providers[0].Status != ProviderReady {
		t.Fatalf("unexpected ready providers: %+v", got.Providers)
	}
	// `usage --json` carries no enablement field, so the aggregate path must not
	// answer that question. Only CodexBar's own inventory can.
	if got.Providers[0].Enabled != nil {
		t.Fatalf("aggregate usage must leave enablement unknown: %+v", got.Providers[0])
	}
}

func TestProbeProviderSetupWaitsForFirstRunInventory(t *testing.T) {
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
	configPath := filepath.Join(t.TempDir(), "config.json")
	if err := os.WriteFile(configPath, []byte(`{"version":1,"providers":[]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(firstRunMarkerPath(configPath), []byte("pending\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("CODEXBAR_CONFIG", configPath)
	runVersionCommandFn = func(context.Context, time.Duration, string, ...string) ([]byte, error) {
		return []byte("CodexBar 0.46.0"), nil
	}
	runUsageCommandFn = func(context.Context, time.Duration, string, ...string) ([]byte, error) {
		t.Fatal("the normal readiness probe must not overtake first-run inventory")
		return nil, nil
	}

	got := ProbeProviderSetup(context.Background(), t.TempDir())
	if got.Status != "checking" || got.Engine.Status != ProviderReady || !ProviderSetupFirstRunPending(got) {
		t.Fatalf("first-run inventory must remain the visible checking state: %+v", got)
	}

	if err := writeFirstRunProviderSetupState(configPath, firstRunProviderSetupFailedState); err != nil {
		t.Fatal(err)
	}
	got = ProbeProviderSetup(context.Background(), t.TempDir())
	if got.Status != "setup_required" || len(got.Providers) != 1 || got.Providers[0].Status != ProviderEngineError {
		t.Fatalf("a failed first-run inventory must enter recovery: %+v", got)
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

func writeExecutable(t *testing.T, path string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("#!/bin/sh\n"), 0o700); err != nil {
		t.Fatal(err)
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

// Verified against bundled CodexBar 0.46.0: `usage --json` lists only the
// providers that are switched on and carries no enabled field, so switching
// every provider off yields an empty list. That used to become the
// not-configured stand-in, and the customer was told to download the CodexBar
// they already have. CodexBar's own inventory is the authority on the switches.
func TestProbeProviderSetupReportsEveryProviderSwitchedOff(t *testing.T) {
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
		return []byte("CodexBar 0.46.0"), nil
	}
	inventoryCalls := 0
	runUsageCommandFn = func(_ context.Context, _ time.Duration, _ string, args ...string) ([]byte, error) {
		if len(args) > 1 && args[0] == "config" && args[1] == "providers" {
			inventoryCalls++
			return []byte(`[{"provider":"codex","displayName":"Codex","enabled":false},
				{"provider":"claude","displayName":"Claude","enabled":false}]`), nil
		}
		return []byte(`[]`), nil
	}

	got := ProbeProviderSetup(context.Background(), t.TempDir())
	if inventoryCalls != 1 {
		t.Fatalf("the inventory must be asked exactly once, got %d", inventoryCalls)
	}
	if len(got.Providers) != 2 {
		t.Fatalf("every switched-off provider must be reported: %+v", got.Providers)
	}
	for _, provider := range got.Providers {
		if provider.ID == "codexbar" {
			t.Fatalf("the stand-in must be replaced by the real inventory: %+v", got.Providers)
		}
		if provider.Enabled == nil || *provider.Enabled {
			t.Fatalf("a switched-off provider must say so: %+v", provider)
		}
	}
}

// One provider switched on but silent is a reporting failure, not a switch that
// is off: the stand-in stays as that unanswered state. The switched-off
// provider next to it must still be disclosed -- one silent switch must not
// hide every switched-off tool (issue #405).
func TestProbeProviderSetupDisclosesSwitchedOffBesideSilentEnabledProvider(t *testing.T) {
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
		return []byte("CodexBar 0.46.0"), nil
	}
	runUsageCommandFn = func(_ context.Context, _ time.Duration, _ string, args ...string) ([]byte, error) {
		if len(args) > 1 && args[0] == "config" && args[1] == "providers" {
			return []byte(`[{"provider":"codex","displayName":"Codex","enabled":true},
				{"provider":"claude","displayName":"Claude","enabled":false}]`), nil
		}
		return []byte(`[]`), nil
	}

	got := ProbeProviderSetup(context.Background(), t.TempDir())
	if len(got.Providers) != 2 {
		t.Fatalf("stand-in plus the switched-off provider expected: %+v", got.Providers)
	}
	if got.Providers[0].ID != "codexbar" {
		t.Fatalf("a switched-on provider must keep the stand-in first: %+v", got.Providers)
	}
	claude := got.Providers[1]
	if claude.ID != "claude" || claude.Enabled == nil || *claude.Enabled {
		t.Fatalf("the switched-off provider must be disclosed with its switch state: %+v", claude)
	}
}

// A failing enabled provider must not hide the switched-off tools beside it:
// the customer whose Claude is merely off must see exactly that, not the
// generic connect message (issue #405). The reported provider keeps its own
// status and gains its real switch state from the inventory.
func TestProbeProviderSetupDisclosesSwitchedOffBesideFailingProvider(t *testing.T) {
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
		return []byte("CodexBar 0.46.0"), nil
	}
	runUsageCommandFn = func(_ context.Context, _ time.Duration, _ string, args ...string) ([]byte, error) {
		if len(args) > 1 && args[0] == "config" && args[1] == "providers" {
			return []byte(`[{"provider":"codex","displayName":"Codex","enabled":true},
				{"provider":"claude","displayName":"Claude","enabled":false},
				{"provider":"gemini","displayName":"Gemini","enabled":false}]`), nil
		}
		return []byte(`[{"provider":"codex","error":"Not logged in. Sign in to Codex."}]`), nil
	}

	got := ProbeProviderSetup(context.Background(), t.TempDir())
	if len(got.Providers) != 3 {
		t.Fatalf("failing provider plus both switched-off providers expected: %+v", got.Providers)
	}
	codex := got.Providers[0]
	if codex.ID != "codex" || codex.Status != ProviderAuthRequired {
		t.Fatalf("the reported provider keeps its own status first: %+v", codex)
	}
	if codex.Enabled == nil || !*codex.Enabled {
		t.Fatalf("the reported provider carries its real switch state: %+v", codex)
	}
	for _, provider := range got.Providers[1:] {
		if provider.Enabled == nil || *provider.Enabled {
			t.Fatalf("switched-off providers must say so: %+v", provider)
		}
		if provider.Status != ProviderNotConfigured {
			t.Fatalf("switched-off providers report not_configured: %+v", provider)
		}
	}
}

// A ready provider means there is nothing to disclose and no inventory call to
// pay for.
func TestProbeProviderSetupSkipsInventoryWhenAProviderIsReady(t *testing.T) {
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
		return []byte("CodexBar 0.46.0"), nil
	}
	inventoryCalls := 0
	runUsageCommandFn = func(_ context.Context, _ time.Duration, _ string, args ...string) ([]byte, error) {
		if len(args) > 1 && args[0] == "config" && args[1] == "providers" {
			inventoryCalls++
			return []byte(`[]`), nil
		}
		return []byte(`[{"provider":"codex","usage":{"primary":{"usedPercent":12}}}]`), nil
	}

	got := ProbeProviderSetup(context.Background(), t.TempDir())
	if got.Status != ProviderReady {
		t.Fatalf("a delivering provider must make setup ready: %+v", got)
	}
	if inventoryCalls != 0 {
		t.Fatalf("a ready answer must not pay for an inventory call, got %d", inventoryCalls)
	}
}
