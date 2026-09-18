package setup

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"testing"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/service"
)

type registrationFailureManager struct {
	service.Manager
	state                            string
	enabled                          bool
	installs, stops, removals        int
	installErr, startErr, cleanupErr error
}

func (m *registrationFailureManager) Status(context.Context) (service.Status, error) {
	return service.Status{State: m.state, Enabled: m.enabled}, nil
}
func (m *registrationFailureManager) Install(context.Context) error {
	m.installs++
	m.enabled = true
	m.state = "stopped"
	return m.installErr
}
func (m *registrationFailureManager) Start(context.Context) error { return m.startErr }
func (m *registrationFailureManager) Stop(ctx context.Context, disable bool) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	m.stops++
	m.enabled = !disable
	if m.installs > 0 {
		return m.cleanupErr
	}
	return nil
}
func (m *registrationFailureManager) Uninstall(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	m.removals++
	m.state = "not-loaded"
	m.enabled = false
	return m.cleanupErr
}

func TestWindowsFailedRegistrationRestoresDisabledOrAbsentTask(t *testing.T) {
	for _, state := range []string{"disabled", "not-loaded"} {
		for _, phase := range []string{"install", "start", "verify", "cleanup"} {
			t.Run(state+"/"+phase, func(t *testing.T) {
				home := t.TempDir()
				source := filepath.Join(home, "source.exe")
				if err := os.WriteFile(source, []byte("fixture"), 0600); err != nil {
					t.Fatal(err)
				}
				manager := &registrationFailureManager{state: state}
				failure := errors.New("registration failure")
				if phase == "install" {
					manager.installErr = failure
				} else if phase != "verify" {
					manager.startErr = failure
				}
				if phase == "cleanup" {
					manager.cleanupErr = errors.New("cleanup failure")
				}
				err := runWithDeps(context.Background(), Options{Transport: "usb", Port: "COM12", SkipFlash: true}, deps{
					goos: "windows", stdout: io.Discard, homeDir: func() (string, error) { return home, nil },
					executablePath: func() (string, error) { return source, nil }, findCodexbar: func() (string, error) { return "fixture", nil },
					lookPath: func(name string) (string, error) { return name, nil }, resolvePort: func(port string) (string, error) { return port, nil },
					probePort: func(string) error { return nil }, readDeviceHello: func(string) (protocol.DeviceHello, error) { return protocol.DeviceHello{}, errors.New("no hello") },
					serviceForHome: func(string) service.Manager { return manager },
				})
				if err == nil || manager.installs != 1 || manager.enabled {
					t.Fatalf("manager=%+v err=%v", manager, err)
				}
				if state == "not-loaded" && manager.removals != 1 {
					t.Fatalf("new task retained: %+v", manager)
				}
				if state == "disabled" && (manager.stops != 2 || manager.removals != 0) {
					t.Fatalf("disabled task not preserved: %+v", manager)
				}
				if manager.cleanupErr != nil && !errors.Is(err, manager.cleanupErr) {
					t.Fatalf("lost cleanup error: %v", err)
				}
			})
		}
	}
}

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

type nestedUpgradeManager struct {
	recoveryManager
	flashed        bool
	stopAfterFlash error
}

func (m *nestedUpgradeManager) Stop(ctx context.Context, disable bool) error {
	if m.flashed {
		return m.stopAfterFlash
	}
	return m.recoveryManager.Stop(ctx, disable)
}

func TestWindowsSetupStopsNestedUpgradeBeforeBinaryInstall(t *testing.T) {
	want := errors.New("stop sentinel before binary replacement")
	manager := &nestedUpgradeManager{recoveryManager: recoveryManager{enabled: true}, stopAfterFlash: want}
	err := runWithDeps(context.Background(), Options{Transport: "usb", Port: "COM12"}, deps{
		goos: "windows", stdout: io.Discard,
		homeDir:         func() (string, error) { return t.TempDir(), nil },
		findCodexbar:    func() (string, error) { return "fixture", nil },
		lookPath:        func(name string) (string, error) { return name, nil },
		executablePath:  func() (string, error) { return "missing-companion.exe", nil },
		resolvePort:     func(port string) (string, error) { return port, nil },
		readDeviceHello: func(string) (protocol.DeviceHello, error) { return protocol.DeviceHello{}, errors.New("no hello") },
		serviceForHome:  func(string) service.Manager { return manager },
		runCommand: func(_ context.Context, _ string, _ string, args ...string) (string, error) {
			if len(args) > 0 && args[0] == "upgrade" {
				manager.flashed = true
				return "", nil
			}
			return "", errors.New("unexpected command")
		},
	})
	if !manager.flashed || !errors.Is(err, want) || manager.starts != 1 {
		t.Fatalf("flashed=%t restarted=%d err=%v", manager.flashed, manager.starts, err)
	}
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
