package codexbar

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"reflect"
	"testing"
	"time"
)

func TestUsagePreferenceDefaultsCommand(t *testing.T) {
	originalRunner, originalOS := runUsagePreferenceCommandFn, usagePreferenceGOOS
	t.Cleanup(func() { runUsagePreferenceCommandFn, usagePreferenceGOOS = originalRunner, originalOS })
	usagePreferenceGOOS = "darwin"
	t.Setenv(usageModeEnvVar, "")
	var commands [][]string
	stored := "0"
	runUsagePreferenceCommandFn = func(ctx context.Context, bin string, args ...string) ([]byte, error) {
		deadline, ok := ctx.Deadline()
		if !ok || time.Until(deadline) > 1500*time.Millisecond {
			t.Fatal("defaults command needs a bounded timeout")
		}
		commands = append(commands, append([]string{bin}, args...))
		if args[0] == "write" {
			stored = args[4]
		}
		return []byte(stored), nil
	}
	if UsageBarsShowUsed() {
		t.Fatal("must read Remaining from CodexBar")
	}
	for _, value := range []bool{true, false} {
		if err := SetUsageBarsShowUsed(context.Background(), value); err != nil {
			t.Fatal(err)
		}
		if UsageBarsShowUsed() != value {
			t.Fatal("next read must use CodexBar's changed value")
		}
	}
	want := [][]string{
		{"defaults", "read", "com.steipete.codexbar", "usageBarsShowUsed"},
		{"defaults", "write", "com.steipete.codexbar", "usageBarsShowUsed", "-bool", "true"},
		{"defaults", "read", "com.steipete.codexbar", "usageBarsShowUsed"},
		{"defaults", "write", "com.steipete.codexbar", "usageBarsShowUsed", "-bool", "false"},
		{"defaults", "read", "com.steipete.codexbar", "usageBarsShowUsed"},
	}
	if !reflect.DeepEqual(commands, want) {
		t.Fatalf("commands = %#v", commands)
	}
}

func TestUsagePreferenceRejectsOverrideAndUnsupportedPlatform(t *testing.T) {
	originalRunner, originalOS := runUsagePreferenceCommandFn, usagePreferenceGOOS
	t.Cleanup(func() { runUsagePreferenceCommandFn, usagePreferenceGOOS = originalRunner, originalOS })
	runUsagePreferenceCommandFn = func(context.Context, string, ...string) ([]byte, error) {
		t.Fatal("must not run defaults")
		return nil, nil
	}
	usagePreferenceGOOS = "darwin"
	for _, mode := range []string{"used", "remaining", "remain", "invalid"} {
		t.Setenv(usageModeEnvVar, mode)
		if mode != "invalid" && UsageBarsShowUsed() != (mode == "used") {
			t.Fatal("read must respect the environment override without calling defaults")
		}
		if !UsageBarsShowUsedOverridden() {
			t.Fatal("environment override must disable writes")
		}
		if err := SetUsageBarsShowUsed(context.Background(), true); err == nil {
			t.Fatal("override must reject write")
		}
	}
	t.Setenv(usageModeEnvVar, "")
	for _, platform := range []string{"windows", "linux"} {
		usagePreferenceGOOS = platform
		if err := SetUsageBarsShowUsed(context.Background(), false); err == nil {
			t.Fatal("unsupported platform must reject write")
		}
	}
}

func TestUsagePreferenceReportsWriteFailure(t *testing.T) {
	originalRunner, originalOS := runUsagePreferenceCommandFn, usagePreferenceGOOS
	t.Cleanup(func() { runUsagePreferenceCommandFn, usagePreferenceGOOS = originalRunner, originalOS })
	usagePreferenceGOOS = "darwin"
	t.Setenv(usageModeEnvVar, "")
	failure := errors.New("defaults failed")
	runUsagePreferenceCommandFn = func(context.Context, string, ...string) ([]byte, error) { return nil, failure }
	if err := SetUsageBarsShowUsed(context.Background(), false); !errors.Is(err, failure) {
		t.Fatalf("error = %v", err)
	}
	forgetServeUsage()
	if _, err := ReadUsageBarsShowUsed(); err == nil {
		t.Fatal("a failed read without a serve value must stay unknown")
	}
}

// A fresh Mac has no defaults key. CodexBar's own effective value is in
// the already collected serve snapshot; a missing key must not invent Used.
func TestUsagePreferenceMissingKeyUsesServeSnapshot(t *testing.T) {
	originalRunner, originalOS := runUsagePreferenceCommandFn, usagePreferenceGOOS
	t.Cleanup(func() {
		runUsagePreferenceCommandFn, usagePreferenceGOOS = originalRunner, originalOS
		forgetServeUsage()
	})
	usagePreferenceGOOS = "darwin"
	t.Setenv(usageModeEnvVar, "")
	runUsagePreferenceCommandFn = func(context.Context, string, ...string) ([]byte, error) {
		return nil, errors.New("domain/default pair does not exist")
	}
	raw, err := os.ReadFile("testdata/cli/codexbar-macos-0.80.0/serve-snapshot.json")
	if err != nil {
		t.Fatal(err)
	}
	// Keep the real recorded payload, advancing only its collection time.
	var snapshot map[string]any
	if err := json.Unmarshal(raw, &snapshot); err != nil {
		t.Fatal(err)
	}
	snapshot["generatedAt"] = time.Now().UTC().Format(time.RFC3339)
	raw, _ = json.Marshal(snapshot)
	server := newDashboardFetchTestServer(t, string(raw))
	defer server.Close()
	if _, err := FetchDashboardProviders(context.Background(), dashboardFetchTestInfo(server), time.Now()); err != nil {
		t.Fatal(err)
	}
	if UsageBarsShowUsed() {
		t.Fatal("missing defaults key must use CodexBar's effective Remaining value")
	}
}

func TestUsagePreferenceServeValueMustBeCurrentAndCannotConfirmWrite(t *testing.T) {
	originalRunner, originalOS := runUsagePreferenceCommandFn, usagePreferenceGOOS
	t.Cleanup(func() {
		runUsagePreferenceCommandFn, usagePreferenceGOOS = originalRunner, originalOS
		forgetServeUsage()
	})
	usagePreferenceGOOS = "darwin"
	t.Setenv(usageModeEnvVar, "")
	runUsagePreferenceCommandFn = func(_ context.Context, _ string, args ...string) ([]byte, error) {
		if args[0] == "write" {
			return nil, nil
		}
		return nil, errors.New("read unavailable")
	}
	for _, test := range []struct {
		name  string
		host  string
		at    time.Time
		known bool
	}{
		{"remaining", `{"usageBarsShowUsed":false}`, time.Now(), true},
		{"missing", `{}`, time.Now(), false},
		{"expired", `{"usageBarsShowUsed":false}`, time.Now().Add(-time.Hour), false},
	} {
		t.Run(test.name, func(t *testing.T) {
			raw, _ := json.Marshal(map[string]any{"schemaVersion": 1, "generatedAt": test.at, "host": json.RawMessage(test.host)})
			server := newDashboardFetchTestServer(t, string(raw))
			defer server.Close()
			if _, err := FetchDashboardProviders(context.Background(), dashboardFetchTestInfo(server), time.Now()); err != nil {
				t.Fatal(err)
			}
			value, err := ReadUsageBarsShowUsed()
			if (err == nil) != test.known || value {
				t.Fatalf("value = %v, err = %v", value, err)
			}
			if test.known {
				if err := SetUsageBarsShowUsed(context.Background(), false); err != nil {
					t.Fatal(err)
				}
				if _, err := ReadUsageBarsShowUsed(); err == nil {
					t.Fatal("pre-write serve snapshot must not confirm the write")
				}
			}
		})
	}
}
