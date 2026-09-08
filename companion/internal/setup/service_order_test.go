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
