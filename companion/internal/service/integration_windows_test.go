package service

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"
)

// The test executable doubles as a harmless long-running task action. It never
// starts the real daemon, opens devices, or uses a production task name.
func TestMain(m *testing.M) {
	if len(os.Args) == 3 && os.Args[1] == "daemon" && os.Args[2] == "--issue416-test-helper" {
		time.Sleep(5 * time.Minute)
		os.Exit(0)
	}
	os.Exit(m.Run())
}

// Build: go test -c -o service-integration.test.exe ./internal/service
// Run in Marcus's non-elevated interactive session (NOT the SYSTEM agent):
// $env:VIBETV_TEST_SCHEDULED_TASK='1'; .\service-integration.test.exe -test.run '^TestWindowsTaskIntegration$' -test.v
func TestWindowsTaskIntegration(t *testing.T) {
	if os.Getenv("VIBETV_TEST_SCHEDULED_TASK") != "1" {
		t.Skip("opt-in: VIBETV_TEST_SCHEDULED_TASK=1; requires non-elevated interactive user")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	run := func(ctx context.Context, name string, args ...string) (string, error) {
		out, err := exec.CommandContext(ctx, name, args...).CombinedOutput()
		return string(out), err
	}
	out, err := run(ctx, "powershell.exe", "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", `$ErrorActionPreference='Stop'; $id=[System.Security.Principal.WindowsIdentity]::GetCurrent(); $p=[System.Security.Principal.WindowsPrincipal]::new($id); @{User=$id.Name; SID=$id.User.Value; Elevated=$p.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator); Session=[System.Diagnostics.Process]::GetCurrentProcess().SessionId} | ConvertTo-Json -Compress`)
	if err != nil {
		t.Fatalf("token check: %v %s", err, out)
	}
	var token struct {
		User, SID string
		Elevated  bool
		Session   int
	}
	if err := json.Unmarshal([]byte(strings.TrimSpace(out)), &token); err != nil {
		t.Fatal(err)
	}
	if token.Elevated || token.Session == 0 || token.SID == "S-1-5-18" || token.User == "" {
		t.Fatalf("must run as non-elevated interactive user, not SYSTEM: %+v", token)
	}
	t.Logf("actual token: user=%s sid=%s elevated=%t session=%d", token.User, token.SID, token.Elevated, token.Session)
	home := t.TempDir()
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	label := fmt.Sprintf("vibetv-test-issue416-%d-%d", os.Getpid(), time.Now().UnixNano())
	if _, err := WriteTaskConfig(home, label, TaskConfig{Executable: exe, Arguments: []string{"daemon", "--issue416-test-helper"}}); err != nil {
		t.Fatal(err)
	}
	m := NewWindows(label, home, run)
	t.Cleanup(func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		if err := m.Uninstall(cleanupCtx); err != nil {
			t.Errorf("cleanup %s: %v", label, err)
		}
	})
	if err := m.Install(ctx); err != nil {
		t.Fatal(err)
	}
	t.Log("register: succeeded without elevation")
	config, err := m.(*scheduledTask).command(ctx, findTask+`function Resolve-Sid([string]$value) { if ($value -match '^S-1-') { return ([System.Security.Principal.SecurityIdentifier]::new($value)).Value }; return ([System.Security.Principal.NTAccount]::new($value)).Translate([System.Security.Principal.SecurityIdentifier]).Value }
$d=$task.Definition; @{LogonType=[int]$d.Principal.LogonType; RunLevel=[int]$d.Principal.RunLevel; User=(Resolve-Sid $d.Principal.UserId); TriggerType=[int]$d.Triggers.Item(1).Type; TriggerUser=(Resolve-Sid $d.Triggers.Item(1).UserId); RestartInterval=$d.Settings.RestartInterval; RestartCount=[int]$d.Settings.RestartCount; ExecutionTimeLimit=$d.Settings.ExecutionTimeLimit; Executable=$d.Actions.Item(1).Path; Arguments=$d.Actions.Item(1).Arguments} | ConvertTo-Json -Compress`)
	if err != nil {
		t.Fatal(err)
	}
	var definition struct {
		LogonType, RunLevel, TriggerType, RestartCount                                int
		User, TriggerUser, RestartInterval, ExecutionTimeLimit, Executable, Arguments string
	}
	if err := json.Unmarshal([]byte(strings.TrimSpace(config)), &definition); err != nil {
		t.Fatal(err)
	}
	if definition.LogonType != 3 || definition.RunLevel != 0 || definition.TriggerType != 9 || definition.RestartCount != 999 || definition.RestartInterval != "PT1M" || definition.ExecutionTimeLimit != "PT0S" || !strings.EqualFold(definition.Executable, exe) || definition.Arguments != windowsCommandLine([]string{"daemon", "--issue416-test-helper"}) {
		t.Fatalf("incorrect registered definition: %+v", definition)
	}
	for _, user := range []string{definition.User, definition.TriggerUser} {
		if !strings.EqualFold(user, token.SID) {
			t.Fatalf("task belongs to another user: %q", user)
		}
	}
	t.Logf("registered definition readback: %s", config)
	waitState := func(want string, enabled bool) {
		t.Helper()
		for i := 0; i < 30; i++ {
			status, err := m.Status(ctx)
			if err != nil {
				t.Fatal(err)
			}
			if status.State == want && status.Enabled == enabled {
				t.Logf("state=%s enabled=%t", status.State, status.Enabled)
				return
			}
			select {
			case <-ctx.Done():
				t.Fatal(ctx.Err())
			case <-time.After(200 * time.Millisecond):
			}
		}
		t.Fatalf("task did not reach %s", want)
	}
	if err := m.Start(ctx); err != nil {
		t.Fatal(err)
	}
	waitState("running", true)
	if err := m.Stop(ctx, false); err != nil {
		t.Fatal(err)
	}
	waitState("stopped", true)
	if err := m.Start(ctx); err != nil {
		t.Fatal(err)
	}
	waitState("running", true)
	if err := m.Stop(ctx, true); err != nil {
		t.Fatal(err)
	}
	waitState("disabled", false)
	if err := m.Start(ctx); err != nil {
		t.Fatal(err)
	}
	waitState("running", true)
	if err := m.Uninstall(ctx); err != nil {
		t.Fatal(err)
	}
	waitState("not-loaded", false)
	t.Log("register/start/status/stop/restart/uninstall and restart-on-failure configuration verified; failure timing is not exercised")
}
