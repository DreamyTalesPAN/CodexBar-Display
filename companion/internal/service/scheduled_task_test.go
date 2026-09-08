package service

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestWindowsTaskLifecycleHermetic(t *testing.T) {
	home := t.TempDir()
	exe := filepath.Join(home, "companion with spaces.exe")
	if err := os.WriteFile(exe, []byte("fixture"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := WriteTaskConfig(home, "test-only", TaskConfig{Executable: exe, Arguments: []string{"daemon", "--transport", "wifi", "--target", "http://192.0.2.1"}}); err != nil {
		t.Fatal(err)
	}
	var scripts []string
	m := NewWindows("test-only", home, func(_ context.Context, name string, args ...string) (string, error) {
		if name != "powershell.exe" || args[2] != "-NonInteractive" {
			t.Fatalf("unexpected command: %s %v", name, args)
		}
		scripts = append(scripts, args[len(args)-1])
		return `{"Enabled":true,"State":4}`, nil
	})
	ctx := context.Background()
	for _, action := range []func(context.Context) error{m.Install, m.Start, func(ctx context.Context) error { return m.Stop(ctx, true) }, m.Start, m.Uninstall} {
		if err := action(ctx); err != nil {
			t.Fatal(err)
		}
	}
	status, err := m.Status(ctx)
	if err != nil || status.State != "running" || !status.Enabled {
		t.Fatalf("%+v %v", status, err)
	}
	for _, required := range []string{"GetCurrent().User.Value", "$task.Principal.LogonType = 3", "$task.Principal.RunLevel = 0", "$task.Triggers.Create(9)", "$trigger.UserId = $sid", "$task.Settings.RestartInterval = 'PT1M'", "$task.Settings.RestartCount = 999", "$task.Settings.ExecutionTimeLimit = 'PT0S'", "$task.Settings.MultipleInstances = 2", "RegisterTaskDefinition($name, $task, 6, $sid, $null, 3)"} {
		if !strings.Contains(scripts[0], required) {
			t.Errorf("missing %s", required)
		}
	}
	if !strings.Contains(scripts[2], "$task.Enabled = $false") || !strings.Contains(scripts[2], "$task.Stop(0)") {
		t.Fatal("stop did not disable and stop")
	}
	if !strings.Contains(scripts[3], "$task.Enabled = $true") || !strings.Contains(scripts[4], "$folder.DeleteTask($name, 0)") {
		t.Fatal("restart/uninstall missing")
	}
}

func TestWindowsStatusStatesAndErrors(t *testing.T) {
	for _, tc := range []struct {
		output, state string
		enabled       bool
	}{
		{`{"Enabled":false,"State":-1}`, "not-loaded", false},
		{`{"Enabled":false,"State":1}`, "disabled", false},
		{`{"Enabled":true,"State":2}`, "queued", true},
		{`{"Enabled":true,"State":3}`, "stopped", true},
		{`{"Enabled":true,"State":4}`, "running", true},
	} {
		m := NewWindows("test-only", t.TempDir(), func(context.Context, string, ...string) (string, error) { return tc.output, nil })
		status, err := m.Status(context.Background())
		if err != nil || status.State != tc.state || status.Enabled != tc.enabled {
			t.Fatalf("%+v %v", status, err)
		}
		if Healthy(status.State) != (tc.state == "running") {
			t.Fatalf("false health: %+v", status)
		}
	}
	for _, output := range []string{"", "access denied", `{}`, `{"State":"Running"}`} {
		m := NewWindows("test-only", t.TempDir(), func(context.Context, string, ...string) (string, error) { return output, nil })
		if _, err := m.Status(context.Background()); err == nil {
			t.Fatalf("accepted %q", output)
		}
	}
	denied := errors.New("access denied")
	m := NewWindows("test-only", t.TempDir(), func(context.Context, string, ...string) (string, error) { return "", denied })
	if _, err := m.Status(context.Background()); !errors.Is(err, denied) {
		t.Fatalf("swallowed scheduler failure: %v", err)
	}
}

func TestWindowsCommandLine(t *testing.T) {
	got := windowsCommandLine([]string{"daemon", "", `C:\a b\`, `a"b`, `a\"b`})
	want := `"daemon" "" "C:\a b\\" "a\"b" "a\\\"b"`
	if got != want {
		t.Fatalf("got %s want %s", got, want)
	}
}

func TestDiagnosticOutputUsesSharedState(t *testing.T) {
	status := Status{State: "running", PID: "42", Raw: `{"State":4}`}
	if got := status.DiagnosticOutput(); got != "state = running\npid = 42" {
		t.Fatal(got)
	}
	status.Raw = "path = /tmp/test.plist\nstate = stopped"
	if got := status.DiagnosticOutput(); got != "path = /tmp/test.plist\nstate = running\npid = 42" {
		t.Fatal(got)
	}
}
