// Package service owns the per-user background-service lifecycle. Windows is
// intentionally unsupported here; its implementation belongs to issue #416.
package service

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
)

var ErrUnsupported = errors.New("background service is not supported on this platform")

type Status struct {
	Enabled bool
	State   string
	PID     string
	Raw     string
}

type Manager interface {
	Install(context.Context) error
	Start(context.Context) error
	Stop(context.Context, bool) error
	Status(context.Context) (Status, error)
	Uninstall(context.Context) error
}

type Runner func(context.Context, string, ...string) (string, error)

// New returns today's launchd adapter. Non-Windows hosts retain the existing
// command-runner behavior (Linux simulations supply a launchctl stub).
func New(label, home string, managed bool) Manager {
	if runtime.GOOS == "windows" {
		return unsupported{}
	}
	return NewDarwin(label, home, os.Getuid(), managed, func(ctx context.Context, name string, args ...string) (string, error) {
		out, err := exec.CommandContext(ctx, name, args...).CombinedOutput()
		return string(out), err
	})
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
