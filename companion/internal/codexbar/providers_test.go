package codexbar

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"
)

func TestParseProviderSettingsIncludesDisabledProviders(t *testing.T) {
	settings, err := parseProviderSettings([]byte(`[
		{"provider":"codex","displayName":"Codex","enabled":true,"defaultEnabled":true},
		{"provider":"copilot","displayName":"GitHub Copilot","enabled":false,"defaultEnabled":false}
	]`))
	if err != nil {
		t.Fatalf("parse settings: %v", err)
	}
	if len(settings) != 2 {
		t.Fatalf("expected all providers, got %d", len(settings))
	}
	if settings[1].ID != "copilot" || settings[1].Enabled {
		t.Fatalf("expected disabled copilot, got %#v", settings[1])
	}
}

func TestParseProviderHealthClassifiesSafeStatesAndService(t *testing.T) {
	health := parseProviderHealth([]byte(`[
		{"provider":"codex","status":{"indicator":"none"},"usage":{"primary":{"usedPercent":5}}},
		{"provider":"claude","status":{"indicator":"major"},"error":{"message":"OAuth token expired: secret-value"}},
		{"provider":"copilot","status":{"indicator":"minor"},"error":{"message":"No available fetch strategy for copilot"}}
	]`))

	if health["codex"].health != ProviderHealthHealthy || health["codex"].service != ProviderServiceOperational {
		t.Fatalf("unexpected codex health: %#v", health["codex"])
	}
	if health["claude"].health != ProviderHealthAuthRequired || health["claude"].service != ProviderServiceOutage {
		t.Fatalf("unexpected claude health: %#v", health["claude"])
	}
	if health["copilot"].health != ProviderHealthSetupRequired || health["copilot"].service != ProviderServiceDegraded {
		t.Fatalf("unexpected copilot health: %#v", health["copilot"])
	}
}

func TestFetchProviderSettingsUsesStatusEvenAfterNonzeroExit(t *testing.T) {
	withProviderCommandTestBinary(t, "0.44.0")
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

func TestFetchProviderSettingsRequiresFeatureVersion(t *testing.T) {
	withProviderCommandTestBinary(t, "0.28.0")
	_, err := FetchProviderSettings(context.Background())
	if err == nil || ProviderSettingsErrorKindOf(err) != ProviderSettingsErrorVersion {
		t.Fatalf("expected version error, got %v", err)
	}
}

func TestSetProviderEnabledUsesExactProcessArguments(t *testing.T) {
	withProviderCommandTestBinary(t, "0.44.0")
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
	want := []string{"config", "enable", "--provider", "claude", "--json"}
	if !reflect.DeepEqual(calls[len(calls)-1], want) {
		t.Fatalf("unexpected write args: got %v want %v", calls[len(calls)-1], want)
	}
}

func TestSetProviderEnabledRejectsUnknownProviderBeforeWrite(t *testing.T) {
	withProviderCommandTestBinary(t, "0.44.0")
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
