package service

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimepaths"
)

// TaskConfig is the installed command, shared by setup, service and diagnostics.
type TaskConfig struct {
	Executable string
	Arguments  []string
}

func TaskConfigPath(home, label string) string {
	return runtimepaths.Path(home, "service", label+".json")
}

func WriteTaskConfig(home, label string, config TaskConfig) (string, error) {
	path := TaskConfigPath(home, label)
	data, err := json.Marshal(config)
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return "", err
	}
	f, err := os.CreateTemp(filepath.Dir(path), ".task-*")
	if err != nil {
		return "", err
	}
	defer os.Remove(f.Name())
	if _, err := f.Write(data); err != nil {
		f.Close()
		return "", err
	}
	if err := f.Close(); err != nil {
		return "", err
	}
	if err := os.Rename(f.Name(), path); err != nil {
		return "", err
	}
	return path, nil
}

func ReadTaskConfig(home, label string) (TaskConfig, error) {
	data, err := os.ReadFile(TaskConfigPath(home, label))
	if err != nil {
		return TaskConfig{}, err
	}
	var config TaskConfig
	err = json.Unmarshal(data, &config)
	return config, err
}

type scheduledTask struct {
	label, home string
	run         Runner
}

// NewWindows uses a command boundary so lifecycle tests need neither Windows
// nor access to the real scheduler. The SID suffix isolates users' task names.
func NewWindows(label, home string, run Runner) Manager {
	if home == "" {
		home, _ = os.UserHomeDir()
	}
	return &scheduledTask{label: label, home: home, run: run}
}

func psLiteral(value string) string { return "'" + strings.ReplaceAll(value, "'", "''") + "'" }

func (s *scheduledTask) command(ctx context.Context, body string) (string, error) {
	script := `$ErrorActionPreference='Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$scheduler = New-Object -ComObject 'Schedule.Service'
$scheduler.Connect()
$folder = $scheduler.GetFolder('\')
$name = ` + psLiteral(s.label+"-") + ` + $sid
` + body
	out, err := s.run(ctx, "powershell.exe", "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script)
	if err != nil {
		return out, fmt.Errorf("scheduled task: %w (%s)", err, strings.TrimSpace(out))
	}
	return out, nil
}

func (s *scheduledTask) Install(ctx context.Context) error {
	config, err := ReadTaskConfig(s.home, s.label)
	if err != nil {
		return fmt.Errorf("read installed task configuration (rerun setup): %w", err)
	}
	if !strings.HasSuffix(strings.ToLower(config.Executable), ".exe") || len(config.Arguments) == 0 || config.Arguments[0] != "daemon" {
		return fmt.Errorf("scheduled task requires an installed .exe and daemon arguments")
	}
	if info, err := os.Stat(config.Executable); err != nil || !info.Mode().IsRegular() {
		return fmt.Errorf("installed companion executable unavailable: %s", config.Executable)
	}
	payload, _ := json.Marshal(struct{ Executable, Arguments, Directory string }{config.Executable, windowsCommandLine(config.Arguments), filepath.Dir(config.Executable)})
	_, err = s.command(ctx, `$config = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('`+base64.StdEncoding.EncodeToString(payload)+`')) | ConvertFrom-Json
$task = $scheduler.NewTask(0)
$task.RegistrationInfo.Description = 'VibeTV per-user companion'
$task.Principal.UserId = $sid
$task.Principal.LogonType = 3
$task.Principal.RunLevel = 0
$trigger = $task.Triggers.Create(9)
$trigger.UserId = $sid
$task.Settings.Enabled = $true
$task.Settings.StartWhenAvailable = $true
$task.Settings.DisallowStartIfOnBatteries = $false
$task.Settings.StopIfGoingOnBatteries = $false
$task.Settings.ExecutionTimeLimit = 'PT0S'
$task.Settings.MultipleInstances = 2
$task.Settings.RestartInterval = 'PT1M'
$task.Settings.RestartCount = 999
$action = $task.Actions.Create(0)
$action.Path = $config.Executable
$action.Arguments = $config.Arguments
$action.WorkingDirectory = $config.Directory
$null = $folder.RegisterTaskDefinition($name, $task, 6, $sid, $null, 3)
`)
	return err
}

const findTask = `$task = $null
foreach ($candidate in $folder.GetTasks(1)) { if ($candidate.Name -eq $name) { $task = $candidate; break } }
`

// Stop is asynchronous in Task Scheduler. Wait for all action processes before
// allowing setup/upgrade to replace the installed executable.
const stopTask = `$task.Stop(0)
$deadline = [DateTime]::UtcNow.AddSeconds(20)
while ($task.GetInstances(0).Count -gt 0) {
  if ([DateTime]::UtcNow -ge $deadline) { throw 'Task did not stop within 20 seconds' }
  Start-Sleep -Milliseconds 100
}
`

func (s *scheduledTask) Start(ctx context.Context) error {
	_, err := s.command(ctx, findTask+`if ($null -eq $task) { throw 'Task not installed; rerun setup' }
$task.Enabled = $true
if ($task.State -ne 4) { $null = $task.Run($null) }
`)
	return err
}

func (s *scheduledTask) Stop(ctx context.Context, disable bool) error {
	body := findTask + "if ($null -ne $task) {\n"
	if disable {
		body += "$task.Enabled = $false\n"
	}
	body += stopTask + "}\n"
	_, err := s.command(ctx, body)
	return err
}

func (s *scheduledTask) Uninstall(ctx context.Context) error {
	_, err := s.command(ctx, findTask+"if ($null -ne $task) {\n$task.Enabled = $false\n"+stopTask+"$folder.DeleteTask($name, 0)\n}")
	return err
}

func (s *scheduledTask) Status(ctx context.Context) (Status, error) {
	out, err := s.command(ctx, findTask+`if ($null -eq $task) { @{Enabled=$false; State=-1} | ConvertTo-Json -Compress }
else { @{Enabled=[bool]$task.Enabled; State=[int]$task.State} | ConvertTo-Json -Compress }
`)
	status := Status{State: "unknown", Raw: out}
	if err != nil {
		return status, err
	}
	var result struct {
		Enabled bool
		State   *int
	}
	if err := json.Unmarshal([]byte(strings.TrimSpace(strings.TrimPrefix(out, "\ufeff"))), &result); err != nil {
		return status, fmt.Errorf("decode scheduled task status: %w", err)
	}
	if result.State == nil {
		return status, fmt.Errorf("scheduled task status missing state")
	}
	status.Enabled = result.Enabled
	switch *result.State {
	case -1:
		status.State = "not-loaded"
	case 1:
		status.State = "disabled"
	case 2:
		status.State = "queued"
	case 3:
		status.State = "stopped"
	case 4:
		status.State = "running"
	}
	return status, nil
}

// Quote according to CommandLineToArgvW, not shell syntax: the task executes
// the .exe directly, including paths/arguments with spaces, quotes or slashes.
func windowsCommandLine(args []string) string {
	quoted := make([]string, len(args))
	for i, arg := range args {
		var b strings.Builder
		b.WriteByte('"')
		slashes := 0
		for _, c := range arg {
			if c == '\\' {
				slashes++
				continue
			}
			if c == '"' {
				b.WriteString(strings.Repeat("\\", slashes*2+1))
			} else {
				b.WriteString(strings.Repeat("\\", slashes))
			}
			slashes = 0
			b.WriteRune(c)
		}
		b.WriteString(strings.Repeat("\\", slashes*2))
		b.WriteByte('"')
		quoted[i] = b.String()
	}
	return strings.Join(quoted, " ")
}
