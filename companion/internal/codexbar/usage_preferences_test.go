package codexbar

import (
	"context"
	"errors"
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
	if !UsageBarsShowUsed() {
		t.Fatal("preserve the existing default when reading fails")
	}
}
