package codexbar

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestParseProviderSettingsIncludesDisabledProviders(t *testing.T) {
	settings, err := parseProviderSettings([]byte(`[
		{"provider":"codex","displayName":"Codex","enabled":true,"defaultEnabled":true},
		{"provider":"copilot","displayName":"GitHub Copilot","enabled":false,"defaultEnabled":false},
		{"provider":"antigravity","displayName":"Antigravity","enabled":false,"defaultEnabled":false}
	]`))
	if err != nil {
		t.Fatalf("parse settings: %v", err)
	}
	if len(settings) != 3 {
		t.Fatalf("expected all providers, got %d", len(settings))
	}
	if settings[1].ID != "copilot" || settings[1].Enabled {
		t.Fatalf("expected disabled copilot, got %#v", settings[1])
	}
	if settings[2].ID != "antigravity" || settings[2].Enabled || settings[2].DefaultEnabled {
		t.Fatalf("expected dynamically discovered disabled antigravity, got %#v", settings[2])
	}
}

func TestParseProviderSettingsRejectsUnsafeProviderIDs(t *testing.T) {
	settings, err := parseProviderSettings([]byte(`[
		{"provider":"claude","enabled":true},
		{"provider":"claude/../../secret","enabled":true},
		{"provider":"codex;open /tmp/secret","enabled":true}
	]`))
	if err != nil {
		t.Fatalf("parse settings: %v", err)
	}
	if len(settings) != 1 || settings[0].ID != "claude" {
		t.Fatalf("expected only safe provider ID, got %#v", settings)
	}
}

func TestParseProviderHealthClassifiesSafeStatesAndService(t *testing.T) {
	health := parseProviderHealth([]byte(`[
		{"provider":"codex","status":{"indicator":"none"},"usage":{"primary":{"usedPercent":5}}},
		{"provider":"gemini","status":{"indicator":"none"},"usage":{}},
		{"provider":"claude","status":{"indicator":"major"},"error":{"message":"OAuth token expired: secret-value"}},
		{"provider":"copilot","status":{"indicator":"minor"},"error":{"message":"No available fetch strategy for copilot"}}
	]`))

	if health["codex"].health != ProviderHealthHealthy || health["codex"].service != ProviderServiceOperational {
		t.Fatalf("unexpected codex health: %#v", health["codex"])
	}
	if health["gemini"].health != ProviderHealthNoUsage || health["gemini"].service != ProviderServiceOperational {
		t.Fatalf("empty usage was reported healthy: %#v", health["gemini"])
	}
	if health["claude"].health != ProviderHealthAuthRequired || health["claude"].service != ProviderServiceOutage {
		t.Fatalf("unexpected claude health: %#v", health["claude"])
	}
	if health["copilot"].health != ProviderHealthSetupRequired || health["copilot"].service != ProviderServiceDegraded {
		t.Fatalf("unexpected copilot health: %#v", health["copilot"])
	}
}

func TestFetchProviderSettingsUsesStatusEvenAfterNonzeroExit(t *testing.T) {
	skipMacCLIContract(t)
	withProviderCommandTestBinary(t, "0.46.0")
	original := runProviderCommandFn
	t.Cleanup(func() { runProviderCommandFn = original })
	runProviderCommandFn = func(_ context.Context, _ time.Duration, _ string, args ...string) ([]byte, error) {
		if reflect.DeepEqual(args, []string{"config", "providers", "--json"}) {
			return []byte(`[{"provider":"claude","displayName":"Claude","enabled":true}]`), nil
		}
		return []byte(`[{"provider":"claude","status":{"indicator":"none"},"error":{"message":"authentication expired"}}]`), errors.New("exit 1")
	}

	settings, err := FetchProviderSettings(context.Background())
	if err != nil {
		t.Fatalf("fetch settings: %v", err)
	}
	if settings[0].Health != ProviderHealthAuthRequired {
		t.Fatalf("expected auth_required, got %#v", settings[0])
	}
}

func TestFetchProviderInventoryDoesNotRunHealthProbe(t *testing.T) {
	withProviderCommandTestBinary(t, "0.44.0")
	original := runProviderCommandFn
	t.Cleanup(func() { runProviderCommandFn = original })
	var calls [][]string
	runProviderCommandFn = func(_ context.Context, _ time.Duration, _ string, args ...string) ([]byte, error) {
		calls = append(calls, append([]string(nil), args...))
		return []byte(`[
			{"provider":"codex","displayName":"Codex","enabled":true},
			{"provider":"future-provider","displayName":"Future Provider","enabled":false}
		]`), nil
	}

	settings, err := FetchProviderInventory(context.Background())
	if err != nil {
		t.Fatalf("fetch inventory: %v", err)
	}
	if len(settings) != 2 || !settings[0].Enabled || settings[1].Enabled {
		t.Fatalf("unexpected inventory: %#v", settings)
	}
	want := [][]string{providerInventoryArgs()}
	if !reflect.DeepEqual(calls, want) {
		t.Fatalf("inventory added a slow health probe: got %v want %v", calls, want)
	}
}

// Win-CodexBar 0.56.8 answers "usage --json --status" for Claude only, so a
// signed-in Codex would stay "checking" forever and block the provider step.
// The Windows probe must ask each switched-on provider one by one.
func TestFetchProviderSettingsProbesEachEnabledProviderOnWindows(t *testing.T) {
	withProviderCommandTestBinary(t, "0.56.8")
	originalMode := providerProbePerProvider
	t.Cleanup(func() { providerProbePerProvider = originalMode })
	providerProbePerProvider = true
	original := runProviderCommandFn
	t.Cleanup(func() { runProviderCommandFn = original })
	var calls [][]string
	runProviderCommandFn = func(_ context.Context, _ time.Duration, _ string, args ...string) ([]byte, error) {
		calls = append(calls, append([]string(nil), args...))
		switch {
		case reflect.DeepEqual(args, providerInventoryArgs()):
			return []byte(`[
				{"provider":"codex","displayName":"Codex","enabled":true},
				{"provider":"claude","displayName":"Claude","enabled":true},
				{"provider":"cursor","displayName":"Cursor","enabled":false}
			]`), nil
		case reflect.DeepEqual(args, []string{"usage", "--json", "--provider", "codex", "--status", "--web-timeout", "8"}):
			return []byte(`[{"provider":"codex","status":{"indicator":"none"},"usage":{"primary":{"usedPercent":8}}}]`), nil
		case reflect.DeepEqual(args, []string{"usage", "--json", "--provider", "claude", "--status", "--web-timeout", "8"}):
			return []byte(`[{"provider":"claude","error":{"message":"Provider not installed: Claude CLI not found"}}]`), errors.New("exit 1")
		}
		t.Fatalf("unexpected call %v", args)
		return nil, nil
	}

	settings, err := FetchProviderSettings(context.Background())
	if err != nil {
		t.Fatalf("fetch settings: %v", err)
	}
	byID := map[string]ProviderSetting{}
	for _, setting := range settings {
		byID[setting.ID] = setting
	}
	if byID["codex"].Health != ProviderHealthHealthy {
		t.Fatalf("codex must be healthy after its own probe, got %#v", byID["codex"])
	}
	if byID["claude"].Health != ProviderHealthSetupRequired {
		t.Fatalf("claude must report setup_required, got %#v", byID["claude"])
	}
	if byID["cursor"].Health != ProviderHealthChecking {
		t.Fatalf("a switched-off provider must not be probed, got %#v", byID["cursor"])
	}
	if len(calls) != 3 {
		t.Fatalf("expected inventory + one probe per enabled provider, got %v", calls)
	}
}

// One enabled provider answers, the other probe times out without JSON. The
// silent provider must become "unavailable", not stay "checking" forever.
func TestFetchProviderSettingsReportsSilentProbeAsUnavailableOnWindows(t *testing.T) {
	withProviderCommandTestBinary(t, "0.56.8")
	originalMode := providerProbePerProvider
	t.Cleanup(func() { providerProbePerProvider = originalMode })
	providerProbePerProvider = true
	original := runProviderCommandFn
	t.Cleanup(func() { runProviderCommandFn = original })
	runProviderCommandFn = func(_ context.Context, _ time.Duration, _ string, args ...string) ([]byte, error) {
		switch {
		case reflect.DeepEqual(args, providerInventoryArgs()):
			return []byte(`[
				{"provider":"codex","displayName":"Codex","enabled":true},
				{"provider":"claude","displayName":"Claude","enabled":true}
			]`), nil
		case reflect.DeepEqual(args, []string{"usage", "--json", "--provider", "codex", "--status", "--web-timeout", "8"}):
			return []byte(`[{"provider":"codex","status":{"indicator":"none"},"usage":{"primary":{"usedPercent":8}}}]`), nil
		default:
			return nil, errors.New("signal: killed")
		}
	}

	settings, err := FetchProviderSettings(context.Background())
	if err != nil {
		t.Fatalf("fetch settings: %v", err)
	}
	byID := map[string]ProviderSetting{}
	for _, setting := range settings {
		byID[setting.ID] = setting
	}
	if byID["codex"].Health != ProviderHealthHealthy {
		t.Fatalf("codex must stay healthy, got %#v", byID["codex"])
	}
	if byID["claude"].Health != ProviderHealthUnavailable || !strings.Contains(byID["claude"].Reported, "signal: killed") {
		t.Fatalf("a silent probe must be reported as unavailable, got %#v", byID["claude"])
	}
}

// Usage join on Windows: a switched-on provider whose probe returned no JSON
// appears as an unavailable provider in the joined answer instead of vanishing.
func TestRunUsageAllEnabledKeepsSilentProviderVisibleOnWindows(t *testing.T) {
	originalMode := providerProbePerProvider
	t.Cleanup(func() { providerProbePerProvider = originalMode })
	providerProbePerProvider = true
	original := runUsageCommandFn
	t.Cleanup(func() { runUsageCommandFn = original })
	runUsageCommandFn = func(_ context.Context, _ time.Duration, _ string, args ...string) ([]byte, error) {
		switch {
		case reflect.DeepEqual(args, providerInventoryArgs()):
			return []byte(`[{"provider":"codex","displayName":"Codex","enabled":true},{"provider":"claude","displayName":"Claude","enabled":true}]`), nil
		case len(args) >= 4 && args[3] == "codex":
			return []byte(`[{"provider":"codex","usage":{"primary":{"usedPercent":8}}}]`), nil
		default:
			return []byte("dashboard data not found"), errors.New("exit status 1")
		}
	}

	raw, err := runUsageAllEnabled(context.Background(), time.Second, "codexbar", "--web-timeout", "8")
	if err != nil {
		t.Fatalf("usage join: %v", err)
	}
	frames, err := parseAllProviders(raw)
	if err != nil {
		t.Fatalf("parse joined usage: %v", err)
	}
	if len(frames) != 2 || frames[0].Provider != "codex" || frames[1].Provider != "claude" {
		t.Fatalf("expected both enabled providers, got %#v", frames)
	}
	if frames[0].Frame.UsageUnavailable || !frames[1].Frame.UsageUnavailable {
		t.Fatalf("silent probe must be unavailable, healthy one not: %#v", frames)
	}
}

// The background health refresh hands runProviderHealthProbe a shared 25 s
// deadline. On Windows the probes run one after another with 18 s each, so
// the second provider must not inherit the almost spent parent deadline.
func TestRunProviderHealthProbeGivesEachWindowsProviderItsOwnBudget(t *testing.T) {
	originalMode := providerProbePerProvider
	t.Cleanup(func() { providerProbePerProvider = originalMode })
	providerProbePerProvider = true
	original := runProviderCommandFn
	t.Cleanup(func() { runProviderCommandFn = original })
	var deadlines []bool
	var timeouts []time.Duration
	runProviderCommandFn = func(ctx context.Context, timeout time.Duration, _ string, args ...string) ([]byte, error) {
		_, hasDeadline := ctx.Deadline()
		deadlines = append(deadlines, hasDeadline)
		timeouts = append(timeouts, timeout)
		return []byte(`[{"provider":"` + args[3] + `","status":{"indicator":"none"},"usage":{"primary":{"usedPercent":8}}}]`), nil
	}
	parent, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	settings := []ProviderSetting{
		{ID: "codex", Label: "Codex", Enabled: true},
		{ID: "claude", Label: "Claude", Enabled: true},
	}
	raw, err := runProviderHealthProbe(parent, 300*time.Second, "codexbar", settings)
	if err != nil {
		t.Fatalf("health probe: %v", err)
	}
	health := parseProviderHealth(raw)
	if health["codex"].health != ProviderHealthHealthy || health["claude"].health != ProviderHealthHealthy {
		t.Fatalf("both providers must be healthy, got %#v", health)
	}
	if len(deadlines) != 2 {
		t.Fatalf("expected one probe per enabled provider, got %d", len(deadlines))
	}
	for i, hasDeadline := range deadlines {
		if hasDeadline {
			t.Fatalf("probe %d ran under the shared refresh deadline", i)
		}
	}
	// Without the shared deadline the collector's 300 s timeout must not
	// become the per-probe budget; a hanging CLI is capped per provider.
	for i, timeout := range timeouts {
		if timeout != perProviderProbeTimeout {
			t.Fatalf("probe %d ran with %s instead of the per-provider cap %s", i, timeout, perProviderProbeTimeout)
		}
	}
}

// Win-CodexBar 0.56.8 rejects "config disable --provider claude"; the provider
// is a positional argument there.
func TestSetProviderEnabledUsesPositionalProviderOnWindows(t *testing.T) {
	withProviderCommandTestBinary(t, "0.56.8")
	originalMode := providerProbePerProvider
	t.Cleanup(func() { providerProbePerProvider = originalMode })
	providerProbePerProvider = true
	original := runProviderCommandFn
	t.Cleanup(func() { runProviderCommandFn = original })
	var calls [][]string
	runProviderCommandFn = func(_ context.Context, _ time.Duration, _ string, args ...string) ([]byte, error) {
		calls = append(calls, append([]string(nil), args...))
		if args[0] == "config" && args[1] == "providers" {
			return []byte(`[{"provider":"claude","displayName":"Claude","enabled":true}]`), nil
		}
		return []byte(""), nil
	}

	if err := SetProviderEnabled(context.Background(), "claude", false); err != nil {
		t.Fatalf("disable provider: %v", err)
	}
	want := []string{"config", "disable", "claude"}
	if !reflect.DeepEqual(calls[len(calls)-1], want) {
		t.Fatalf("unexpected write args: got %v want %v", calls[len(calls)-1], want)
	}
}

func TestFetchProviderSettingsRequiresFeatureVersion(t *testing.T) {
	withProviderCommandTestBinary(t, "0.26.9")
	_, err := FetchProviderSettings(context.Background())
	if err == nil || ProviderSettingsErrorKindOf(err) != ProviderSettingsErrorVersion {
		t.Fatalf("expected version error, got %v", err)
	}
}

func TestSetProviderEnabledUsesExactProcessArguments(t *testing.T) {
	withProviderCommandTestBinary(t, "0.46.0")
	originalMode := providerProbePerProvider
	t.Cleanup(func() { providerProbePerProvider = originalMode })
	providerProbePerProvider = false
	original := runProviderCommandFn
	t.Cleanup(func() { runProviderCommandFn = original })
	var calls [][]string
	runProviderCommandFn = func(_ context.Context, _ time.Duration, _ string, args ...string) ([]byte, error) {
		calls = append(calls, append([]string(nil), args...))
		switch args[0] {
		case "config":
			if len(args) > 1 && args[1] == "providers" {
				return []byte(`[{"provider":"claude","displayName":"Claude","enabled":false}]`), nil
			}
			return []byte(`{"ok":true}`), nil
		case "usage":
			return []byte(`[]`), nil
		default:
			return nil, errors.New("unexpected command")
		}
	}

	if err := SetProviderEnabled(context.Background(), "claude", true); err != nil {
		t.Fatalf("enable provider: %v", err)
	}
	want := []string{"config", "enable", "--provider", "claude"}
	if !reflect.DeepEqual(calls[len(calls)-1], want) {
		t.Fatalf("unexpected write args: got %v want %v", calls[len(calls)-1], want)
	}
	for _, call := range calls {
		if call[0] == "usage" {
			t.Fatalf("provider writes must not wait for usage refresh: %v", calls)
		}
	}
}

func TestSetProviderEnabledRejectsUnknownProviderBeforeWrite(t *testing.T) {
	withProviderCommandTestBinary(t, "0.46.0")
	original := runProviderCommandFn
	t.Cleanup(func() { runProviderCommandFn = original })
	writes := 0
	runProviderCommandFn = func(_ context.Context, _ time.Duration, _ string, args ...string) ([]byte, error) {
		if len(args) > 1 && args[0] == "config" && args[1] == "providers" {
			return []byte(`[{"provider":"claude","enabled":true}]`), nil
		}
		if args[0] == "usage" {
			return []byte(`[]`), nil
		}
		writes++
		return nil, nil
	}

	if err := SetProviderEnabled(context.Background(), "claude;rm", false); err == nil {
		t.Fatal("expected unknown provider error")
	}
	if writes != 0 {
		t.Fatalf("expected no write, got %d", writes)
	}
}

func withProviderCommandTestBinary(t *testing.T, version string) {
	t.Helper()
	bin := filepath.Join(t.TempDir(), "codexbar")
	if err := os.WriteFile(bin, []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatalf("write test binary: %v", err)
	}
	t.Setenv("CODEXBAR_BIN", bin)
	original := runVersionCommandFn
	t.Cleanup(func() { runVersionCommandFn = original })
	runVersionCommandFn = func(context.Context, time.Duration, string, ...string) ([]byte, error) {
		return []byte(version), nil
	}
}
