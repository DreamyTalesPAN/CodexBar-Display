// Package service owns the per-user background-service lifecycle.
package service

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/childproc"
	"path/filepath"
	"runtime"
	"strings"
)

var ErrUnsupported = errors.New("background service is not supported on this platform")

type Status struct {
	Enabled bool
	State   string
	PID     string
	Raw     string
}

// DiagnosticOutput bridges legacy text consumers to the shared state. Preserve
// launchd's path metadata for doctor without interpreting native Windows JSON.
func (s Status) DiagnosticOutput() string {
	var lines []string
	for _, line := range strings.Split(s.Raw, "\n") {
		if strings.HasPrefix(strings.TrimSpace(line), "path = ") {
			lines = append(lines, line)
		}
	}
	lines = append(lines, "state = "+s.State)
	if s.PID != "" {
		lines = append(lines, fmt.Sprintf("pid = %s", s.PID))
	}
	return strings.Join(lines, "\n")
}

type Manager interface {
	Install(context.Context) error
	Start(context.Context) error
	Stop(context.Context, bool) error
	Status(context.Context) (Status, error)
	Uninstall(context.Context) error
}

type Runner func(context.Context, string, ...string) (string, error)

// New returns the host adapter. Non-Windows hosts retain the existing
// command-runner behavior (Linux simulations supply a launchctl stub).
func New(label, home string, managed bool) Manager {
	run := func(ctx context.Context, name string, args ...string) (string, error) {
		out, err := childproc.Hide(exec.CommandContext(ctx, name, args...)).CombinedOutput()
		return string(out), err
	}
	if runtime.GOOS == "windows" {
		return NewWindows(label, home, run)
	}
	return NewDarwin(label, home, os.Getuid(), managed, run)
}

func PlistPath(home, label string) string {
	return filepath.Join(home, "Library", "LaunchAgents", label+".plist")
}

type unsupported struct{}

func (unsupported) Install(context.Context) error          { return ErrUnsupported }
func (unsupported) Start(context.Context) error            { return ErrUnsupported }
func (unsupported) Stop(context.Context, bool) error       { return ErrUnsupported }
func (unsupported) Status(context.Context) (Status, error) { return Status{}, ErrUnsupported }
func (unsupported) Uninstall(context.Context) error        { return ErrUnsupported }
