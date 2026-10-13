package codexbar

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// #527: on a busy Mac a freshly switched-on Claude showed "The usage service
// could not save or read its provider settings." although the settings were
// fine. Every failed inventory read was reported as that settings error.

func exactProbeWithInventory(t *testing.T, inventory func(ctx context.Context) ([]byte, error), usage func() ([]byte, error)) ProviderSetup {
	t.Helper()
	originalUsage := runUsageCommandFn
	originalVersion := runVersionCommandFn
	t.Cleanup(func() {
		runUsageCommandFn = originalUsage
		runVersionCommandFn = originalVersion
	})
	bin := filepath.Join(t.TempDir(), "CodexBarCLI")
	writeExecutable(t, bin)
	t.Setenv("CODEXBAR_BIN", bin)
	setExistingConfig(t)
	runVersionCommandFn = func(context.Context, time.Duration, string, ...string) ([]byte, error) {
		return []byte("CodexBar 0.63.0"), nil
	}
	runUsageCommandFn = func(ctx context.Context, _ time.Duration, _ string, args ...string) ([]byte, error) {
		if len(args) >= 2 && args[0] == "config" && args[1] == "providers" {
			return inventory(ctx)
		}
		return usage()
	}
	return ProbeProviderSetupForProvider(context.Background(), t.TempDir(), "claude")
}

func claudeInventory(context.Context) ([]byte, error) {
	return []byte(`[{"provider":"claude","displayName":"Claude","enabled":true}]`), nil
}

func onlyRow(t *testing.T, setup ProviderSetup) ProviderReadiness {
	t.Helper()
	if len(setup.Providers) != 1 || setup.Providers[0].ID != "claude" {
		t.Fatalf("expected one claude row: %+v", setup.Providers)
	}
	return setup.Providers[0]
}

func TestExactProbeInventoryCutShortIsTimeoutNotSettingsError(t *testing.T) {
	skipMacCLIContract(t)
	for name, runErr := range map[string]error{
		"timed out": context.DeadlineExceeded,
		"cancelled": context.Canceled,
	} {
		t.Run(name, func(t *testing.T) {
			got := onlyRow(t, exactProbeWithInventory(t,
				func(context.Context) ([]byte, error) { return nil, runErr },
				func() ([]byte, error) { t.Fatal("usage must not run without an inventory"); return nil, nil },
			))
			if got.Status != ProviderTimeout {
				t.Fatalf("an inventory read that was cut short must end as timeout, got %s", got.Status)
			}
			if !strings.HasPrefix(got.Cause, "inventory: ") {
				t.Fatalf("the cause must name its source: %q", got.Cause)
			}
		})
	}
}

func TestExactProbeInventoryThatCouldNotRunIsNotSettingsError(t *testing.T) {
	skipMacCLIContract(t)
	got := onlyRow(t, exactProbeWithInventory(t,
		func(context.Context) ([]byte, error) {
			return nil, errors.New("fork/exec CodexBarCLI: resource temporarily unavailable")
		},
		func() ([]byte, error) { return nil, nil },
	))
	if got.Status != ProviderEngineError {
		t.Fatalf("a CLI that could not start says nothing about the settings, got %s", got.Status)
	}
	if !strings.Contains(got.Cause, "resource temporarily unavailable") {
		t.Fatalf("the cause must keep the reason: %q", got.Cause)
	}
}

// Recorded from the bundled CodexBarCLI 0.63.0 with a truncated config file:
// `config providers --json` exits 1 with this on stdout and nothing on stderr.
const recordedInventoryConfigError = `[{"error":{"message":"Failed to decode CodexBar config: The data couldn’t be read because it isn’t in the correct format.","kind":"config","code":1},"source":"cli","provider":"cli"}]`

func TestExactProbeStillReportsCodexBarSettingsError(t *testing.T) {
	skipMacCLIContract(t)
	got := onlyRow(t, exactProbeWithInventory(t,
		func(context.Context) ([]byte, error) {
			return []byte(recordedInventoryConfigError), errors.New("exit status 1")
		},
		func() ([]byte, error) { return nil, nil },
	))
	if got.Status != ProviderConfigError {
		t.Fatalf("CodexBar's own settings error must still be reported, got %s", got.Status)
	}
	if got.Cause != "inventory: Failed to decode CodexBar config: The data couldn’t be read because it isn’t in the correct format." {
		t.Fatalf("unexpected cause: %q", got.Cause)
	}
}

func TestExactProbeCancelledUsageCallIsTimeout(t *testing.T) {
	skipMacCLIContract(t)
	got := onlyRow(t, exactProbeWithInventory(t, claudeInventory,
		func() ([]byte, error) { return nil, context.Canceled },
	))
	if got.Status != ProviderTimeout {
		t.Fatalf("a cancelled usage call got no answer and must end as timeout, got %s", got.Status)
	}
}

// CodexBar 0.63.0 types provider failures as "kind":"provider" and its own
// settings failures as "kind":"config". The words in a provider's sentence
// must not turn it into a settings error of the usage service.
func TestProviderTypedErrorIsNotSettingsError(t *testing.T) {
	skipMacCLIContract(t)
	for message, want := range map[string]string{
		"No claude-swap executable path is configured.":              ProviderEngineError,
		"The file “usage.json” couldn’t be saved in the folder “x”.": ProviderEngineError,
		"No Claude session key found in browser cookies.":            ProviderAuthRequired,
	} {
		got := onlyRow(t, exactProbeWithInventory(t, claudeInventory, func() ([]byte, error) {
			return []byte(`[{"provider":"claude","source":"auto","error":{"code":1,"kind":"provider","message":"` + message + `"}}]`), errors.New("exit status 1")
		}))
		if got.Status != want {
			t.Fatalf("%q: got %s want %s", message, got.Status, want)
		}
		if got.Reported != message {
			t.Fatalf("the provider's sentence must stay reported: %q", got.Reported)
		}
	}
	// An untyped failure keeps the text rule, with its source named.
	got := onlyRow(t, exactProbeWithInventory(t, claudeInventory, func() ([]byte, error) {
		return []byte(`[{"provider":"claude","error":"The legacy config format is no longer supported"}]`), nil
	}))
	if got.Status != ProviderConfigError || got.Cause != "provider message: The legacy config format is no longer supported" {
		t.Fatalf("untyped config failure: %+v", got)
	}
}

// The first config is rendered by CodexBar under a time limit. Running out of
// it is a timeout of the usage engine, not unreadable settings.
func TestProbeConfigBootstrapTimeoutIsNotSettingsError(t *testing.T) {
	skipMacCLIContract(t)
	originalBootstrap := runConfigBootstrapCommandFn
	t.Cleanup(func() { runConfigBootstrapCommandFn = originalBootstrap })
	bin := filepath.Join(t.TempDir(), "CodexBarCLI")
	writeExecutable(t, bin)
	t.Setenv("CODEXBAR_BIN", bin)
	t.Setenv("CODEXBAR_CONFIG", filepath.Join(t.TempDir(), "config.json"))
	runConfigBootstrapCommandFn = func(context.Context, string, string, ...string) ([]byte, error) {
		return nil, context.DeadlineExceeded
	}
	got := ProbeProviderSetupForProvider(context.Background(), t.TempDir(), "claude")
	if got.Engine.Status != ProviderTimeout || len(got.Providers) != 1 || got.Providers[0].Status != ProviderTimeout {
		t.Fatalf("a config bootstrap that ran out of time must end as timeout: %+v", got)
	}
	if !strings.HasPrefix(got.Providers[0].Cause, "config bootstrap: ") {
		t.Fatalf("the cause must name its source: %q", got.Providers[0].Cause)
	}

	// A bootstrap CodexBar refused is still a settings error.
	runConfigBootstrapCommandFn = func(context.Context, string, string, ...string) ([]byte, error) {
		return nil, errors.New("exit status 1")
	}
	got = ProbeProviderSetupForProvider(context.Background(), t.TempDir(), "claude")
	if got.Engine.Status != ProviderConfigError || got.Providers[0].Status != ProviderConfigError {
		t.Fatalf("a refused config bootstrap must stay a settings error: %+v", got)
	}
}
