package setup

import (
	"context"
	"errors"
	"io"
	"testing"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/service"
)

type orderingManager struct {
	service.Manager
	stopped *bool
}

func (m orderingManager) Stop(context.Context, bool) error { *m.stopped = true; return nil }
func (m orderingManager) Uninstall(context.Context) error  { *m.stopped = true; return nil }
func (m orderingManager) Status(context.Context) (service.Status, error) {
	return service.Status{}, nil
}

type recoveryManager struct {
	service.Manager
	enabled           bool
	starts            int
	stopErr, startErr error
}

func (m *recoveryManager) Status(context.Context) (service.Status, error) {
	return service.Status{Enabled: m.enabled}, nil
}
func (m *recoveryManager) Stop(context.Context, bool) error { return m.stopErr }
func (m *recoveryManager) Start(ctx context.Context) error {
	m.starts++
	if ctx.Err() != nil {
		return ctx.Err()
	}
	return m.startErr
}

func TestWindowsSetupRestoresEnabledTaskOnFailure(t *testing.T) {
	for _, tc := range []struct {
		name               string
		enabled, cancelled bool
		stopErr, startErr  error
	}{
		{name: "disconnected", enabled: true},
		{name: "disabled"},
		{name: "cancelled", enabled: true, cancelled: true},
		{name: "partial-stop", enabled: true, stopErr: errors.New("stop failed")},
		{name: "restart-error", enabled: true, startErr: errors.New("restart failed")},
	} {
		t.Run(tc.name, func(t *testing.T) {
			manager := &recoveryManager{enabled: tc.enabled, stopErr: tc.stopErr, startErr: tc.startErr}
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			err := runWithDeps(ctx, Options{Transport: "usb", SkipFlash: true}, deps{
				goos: "windows", stdout: io.Discard,
				homeDir:        func() (string, error) { return t.TempDir(), nil },
				findCodexbar:   func() (string, error) { return "fixture", nil },
				lookPath:       func(name string) (string, error) { return name, nil },
				serviceForHome: func(string) service.Manager { return manager },
				listPorts: func() ([]string, error) {
					if tc.cancelled {
						cancel()
					}
					return nil, errors.New("disconnected")
				},
			})
			if err == nil {
				t.Fatal("expected setup failure")
			}
			want := 0
			if tc.enabled {
				want = 1
			}
			if manager.starts != want {
				t.Fatalf("starts=%d want=%d", manager.starts, want)
			}
			if tc.startErr != nil && !errors.Is(err, tc.startErr) {
				t.Fatalf("lost recovery failure: %v", err)
			}
			if tc.cancelled && errors.Is(err, context.Canceled) {
				t.Fatalf("recovery reused cancelled context: %v", err)
			}
		})
	}
}

func TestSetupStopsServiceBeforeHelloButValidationNeverStops(t *testing.T) {
	for _, goos := range []string{"windows", "darwin"} {
		for _, mode := range []string{"install", "validate", "dry-run"} {
			t.Run(goos+"/"+mode, func(t *testing.T) {
				stopped, readHello := false, false
				home := t.TempDir()
				_ = runWithDeps(context.Background(), Options{Transport: "usb", SkipFlash: true, ValidateOnly: mode == "validate", DryRun: mode == "dry-run"}, deps{
					goos: goos, stdout: io.Discard,
					homeDir:        func() (string, error) { return home, nil },
					findCodexbar:   func() (string, error) { return "fixture-codexbar", nil },
					lookPath:       func(name string) (string, error) { return name, nil },
					serviceForHome: func(string) service.Manager { return orderingManager{stopped: &stopped} },
					listPorts:      func() ([]string, error) { return []string{"COM12"}, nil },
					readDeviceHello: func(string) (protocol.DeviceHello, error) {
						readHello = true
						if stopped != (mode == "install") {
							t.Fatalf("hello before correct service state: stopped=%t mode=%s", stopped, mode)
						}
						return protocol.DeviceHello{}, errors.New("stop test after hello boundary")
					},
				})
				if !readHello {
					t.Fatal("did not reach hello")
				}
				if stopped != (mode == "install") {
					t.Fatalf("unexpected mutation: stopped=%t", stopped)
				}
			})
		}
	}
}
