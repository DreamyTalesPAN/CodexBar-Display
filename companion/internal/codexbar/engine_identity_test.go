package codexbar

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimepaths"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/testenv"
)

func TestProbeProviderSetupSeparatesEngineVersionStates(t *testing.T) {
	skipMacCLIContract(t)
	originalUsage := runUsageCommandFn
	originalVersion := runVersionCommandFn
	t.Cleanup(func() { runUsageCommandFn = originalUsage; runVersionCommandFn = originalVersion })
	runUsageCommandFn = func(context.Context, time.Duration, string, ...string) ([]byte, error) {
		return []byte(`[{"provider":"codex","usage":{"primary":{"usedPercent":0}}}]`), nil
	}
	bin := filepath.Join(t.TempDir(), "CodexBarCLI")
	writeExecutable(t, bin)
	for _, tc := range []struct {
		name, output, status, version string
		err                           error
	}{
		{name: "old", output: "CodexBar 0.17.0", status: ProviderEngineIncompatible, version: "0.17"},
		{name: "compatible", output: "CodexBar 0.46.0", status: ProviderReady, version: "0.46"},
		{name: "malformed", output: "CodexBar unknown", status: ProviderEngineError},
		{name: "unreadable", err: errors.New("exit status 1"), status: ProviderEngineError},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("CODEXBAR_BIN", bin)
			setExistingConfig(t)
			runVersionCommandFn = func(context.Context, time.Duration, string, ...string) ([]byte, error) {
				return []byte(tc.output), tc.err
			}
			got := ProbeProviderSetup(context.Background(), t.TempDir())
			if got.Engine.Status != tc.status || got.Engine.Version != tc.version ||
				got.Engine.MinimumVersion != MinimumSupportedVersion() || got.Engine.Path != bin || got.Engine.Source != "override" {
				t.Fatalf("unexpected engine: %+v", got.Engine)
			}
			if tc.status == ProviderReady {
				return
			}
			if len(got.Providers) != 1 || got.Providers[0].ID != "codexbar" || got.Providers[0].Status != tc.status {
				t.Fatalf("unexpected provider rows: %+v", got.Providers)
			}
			row := got.Providers[0]
			if tc.status == ProviderEngineIncompatible {
				if row.Detail != "Usage engine 0.17 is too old. Version 0.23 or newer is required." ||
					row.NextAction != "Repair the usage engine, then check again." {
					t.Fatalf("unexpected incompatible copy: %+v", row)
				}
			}
			if strings.Contains(row.Label+row.Detail+row.NextAction, "CodexBar") {
				t.Fatalf("customer copy leaked the engine name: %+v", row)
			}
		})
	}
}

func TestProbeExactProviderReportsIncompatibleEngineOnItsRow(t *testing.T) {
	skipMacCLIContract(t)
	originalVersion := runVersionCommandFn
	t.Cleanup(func() { runVersionCommandFn = originalVersion })
	runVersionCommandFn = func(context.Context, time.Duration, string, ...string) ([]byte, error) {
		return []byte("CodexBar 0.17.0"), nil
	}
	bin := filepath.Join(t.TempDir(), "CodexBarCLI")
	writeExecutable(t, bin)
	t.Setenv("CODEXBAR_BIN", bin)
	setExistingConfig(t)
	got := ProbeProviderSetupForProvider(context.Background(), t.TempDir(), "Codex")
	if len(got.Providers) != 2 || got.Providers[1].ID != "codex" ||
		got.Providers[1].Status != ProviderEngineIncompatible ||
		got.Providers[1].Detail != "Usage engine 0.17 is too old. Version 0.23 or newer is required." {
		t.Fatalf("the requested provider must carry the incompatible state: %+v", got.Providers)
	}
}

func TestProbeProviderSetupReportsMissingEngine(t *testing.T) {
	originalExecutable, originalApps, originalKnown := executablePathFn, systemAppBinaryPaths, knownBinaryPaths
	t.Cleanup(func() {
		executablePathFn = originalExecutable
		systemAppBinaryPaths = originalApps
		knownBinaryPaths = originalKnown
	})
	executablePathFn = func() (string, error) { return filepath.Join(t.TempDir(), "codexbar-display"), nil }
	systemAppBinaryPaths, knownBinaryPaths = nil, nil
	t.Setenv("CODEXBAR_BIN", "")
	t.Setenv(appManagedCodexBarVersionEnvVar, "")
	t.Setenv("PATH", t.TempDir())
	testenv.Home(t, t.TempDir())
	got := ProbeProviderSetup(context.Background(), t.TempDir())
	if got.Engine.Status != ProviderNotConfigured || got.Engine.MinimumVersion != "" || got.Engine.Path != "" {
		t.Fatalf("missing engine must stay not_configured: %+v", got.Engine)
	}
}

func TestBinarySourceClassifiesTheSelectedExecutable(t *testing.T) {
	originalExecutable, originalApps := executablePathFn, systemAppBinaryPaths
	t.Cleanup(func() { executablePathFn = originalExecutable; systemAppBinaryPaths = originalApps })
	home := t.TempDir()
	testenv.Home(t, home)
	bundleDir := t.TempDir()
	executablePathFn = func() (string, error) { return filepath.Join(bundleDir, "codexbar-display"), nil }
	systemApp := filepath.Join(t.TempDir(), "CodexBar.app", "Contents", "Helpers", "CodexBarCLI")
	systemAppBinaryPaths = []string{systemApp}
	override := filepath.Join(t.TempDir(), "codexbar")
	t.Setenv("CODEXBAR_BIN", override)
	for bin, want := range map[string]string{
		override:                                "override",
		filepath.Join(bundleDir, "CodexBarCLI"): "bundled",
		runtimepaths.Path(home, "CodexBar", "0.46.0", "CodexBar.app", "Contents", "Helpers", "CodexBarCLI"): "app_managed",
		systemApp: "system",
		filepath.Join(home, "Applications", "CodexBar.app", "Contents", "Helpers", "CodexBarCLI"): "system",
		filepath.Join(t.TempDir(), "bin", "codexbar"):                                             "path",
	} {
		if got := BinarySource(bin); got != want {
			t.Errorf("BinarySource(%q) = %q, want %q", bin, got, want)
		}
	}
}

// An old /Applications copy must not hide the winner FindBinary really chose.
func TestBinarySourceNamesTheWinnerAmongSeveralInstallations(t *testing.T) {
	originalExecutable, originalApps := executablePathFn, systemAppBinaryPaths
	t.Cleanup(func() { executablePathFn = originalExecutable; systemAppBinaryPaths = originalApps })
	executablePathFn = func() (string, error) { return filepath.Join(t.TempDir(), "codexbar-display"), nil }
	t.Setenv("CODEXBAR_BIN", "")
	t.Setenv(appManagedCodexBarVersionEnvVar, "0.46.0")
	home := t.TempDir()
	testenv.Home(t, home)
	oldSystem := filepath.Join(t.TempDir(), "CodexBar.app", "Contents", "Helpers", "CodexBarCLI")
	managed := runtimepaths.Path(home, "CodexBar", "0.46.0", "CodexBar.app", "Contents", "Helpers", "CodexBarCLI")
	systemAppBinaryPaths = []string{oldSystem}
	writeExecutable(t, oldSystem)
	writeExecutable(t, managed)
	bin, err := FindBinary()
	if err != nil || bin != managed || BinarySource(bin) != "app_managed" {
		t.Fatalf("expected app-managed winner %q, got %q (%s) err=%v", managed, bin, BinarySource(bin), err)
	}
}
