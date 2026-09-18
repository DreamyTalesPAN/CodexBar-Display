package main

import (
	"context"
	"errors"
	"testing"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/service"
)

type doctorUSBTask struct {
	service.Manager
	stopped, restarted bool
	stopErr, startErr  error
}

func (m *doctorUSBTask) Stop(_ context.Context, disable bool) error {
	if disable {
		return errors.New("doctor must not disable logon")
	}
	m.stopped = true
	return m.stopErr
}
func (m *doctorUSBTask) Start(context.Context) error { m.restarted = true; return m.startErr }

func TestDoctorQuiescesUSBTaskAndRestartsAfterProbeFailure(t *testing.T) {
	for _, stopFailure := range []bool{false, true} {
		t.Run(map[bool]string{false: "probe-error", true: "stop-error"}[stopFailure], func(t *testing.T) {
			resolve, closeSender := doctorResolvePortFn, closeDefaultSenderFn
			t.Cleanup(func() { doctorResolvePortFn, closeDefaultSenderFn = resolve, closeSender })
			owner := &doctorUSBTask{startErr: errors.New("restart failed")}
			if stopFailure {
				owner.stopErr = errors.New("stop failed")
			}
			closed := false
			closeDefaultSenderFn = func() { closed = true }
			doctorResolvePortFn = func(string) (string, error) {
				if !owner.stopped || stopFailure {
					t.Fatal("probe while task still owns USB")
				}
				return "", errors.New("probe failed")
			}
			err := runDoctorUSBRuntimeChecks(doctorRuntimeConfig{usbOwner: owner}, nil)
			if !owner.restarted || !closed || !errors.Is(err, owner.startErr) {
				t.Fatalf("restarted=%t closed=%t err=%v", owner.restarted, closed, err)
			}
		})
	}
}

func TestUpgradeStopsWorkerBeforeDiscoveryAndReleasesBeforeBusyCheck(t *testing.T) {
	resolve, busy, stop, restart, closeSender := resolveSerialPortFn, ensureSerialPortNotBusyFn, upgradeStopLaunchAgentFn, upgradeRestartLaunchAgentFn, closeDefaultSenderFn
	t.Cleanup(func() {
		resolveSerialPortFn, ensureSerialPortNotBusyFn, upgradeStopLaunchAgentFn, upgradeRestartLaunchAgentFn, closeDefaultSenderFn = resolve, busy, stop, restart, closeSender
	})
	stopped, held, restarted := false, false, false
	upgradeStopLaunchAgentFn = func() { stopped = true }
	resolveSerialPortFn = func(string) (string, error) {
		if !stopped {
			t.Fatal("discovery ran while daemon still owns the port")
		}
		held = true
		return "COM17", nil
	}
	closeDefaultSenderFn = func() { held = false }
	want := errors.New("stop before any download or hardware write")
	ensureSerialPortNotBusyFn = func(string) error {
		if held {
			t.Fatal("busy check sees discovery's own handle")
		}
		return want
	}
	upgradeRestartLaunchAgentFn = func(string) error {
		if held {
			t.Fatal("restart before releasing discovery handle")
		}
		restarted = true
		return nil
	}
	if err := runUpgrade(nil); !errors.Is(err, want) {
		t.Fatalf("expected preflight sentinel: %v", err)
	}
	if !restarted {
		t.Fatal("worker was not restored after failed preflight")
	}
}

func TestDoctorReleasesDiscoveryBeforeProbeAndHelloOnReturn(t *testing.T) {
	resolve, probe, hello, closeSender := doctorResolvePortFn, doctorProbePortFn, doctorReadDeviceHelloFn, closeDefaultSenderFn
	t.Cleanup(func() {
		doctorResolvePortFn, doctorProbePortFn, doctorReadDeviceHelloFn, closeDefaultSenderFn = resolve, probe, hello, closeSender
	})
	held := false
	doctorResolvePortFn = func(string) (string, error) { held = true; return "COM17", nil }
	closeDefaultSenderFn = func() { held = false }
	doctorProbePortFn = func(string) error {
		if held {
			t.Fatal("probe opens the discovery-owned port a second time")
		}
		return nil
	}
	doctorReadDeviceHelloFn = func(string) (protocol.DeviceHello, error) {
		held = true
		return protocol.DeviceHello{}, errors.New("no hello")
	}
	if err := runDoctorUSBRuntimeChecks(doctorRuntimeConfig{port: "COM17"}, []string{"COM17"}); err != nil {
		t.Fatal(err)
	}
	if held {
		t.Fatal("doctor left its hello handle open")
	}
}

func TestDoctorTrustsValidatedResolverWithOtherSerialDevices(t *testing.T) {
	for _, pinned := range []string{"", "com17", "/dev/vibetv-link"} {
		t.Run(pinned, func(t *testing.T) {
			resolve, probe, hello, closeSender := doctorResolvePortFn, doctorProbePortFn, doctorReadDeviceHelloFn, closeDefaultSenderFn
			t.Cleanup(func() {
				doctorResolvePortFn, doctorProbePortFn, doctorReadDeviceHelloFn, closeDefaultSenderFn = resolve, probe, hello, closeSender
			})
			doctorResolvePortFn = func(string) (string, error) { return "COM17", nil }
			doctorProbePortFn = func(string) error { return nil }
			doctorReadDeviceHelloFn = func(string) (protocol.DeviceHello, error) {
				return protocol.DeviceHello{}, errors.New("no capabilities")
			}
			closeDefaultSenderFn = func() {}
			if err := runDoctorUSBRuntimeChecks(doctorRuntimeConfig{port: pinned}, []string{"COM17", "COM99"}); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestRestoreReleasesDiscoveryBeforeReturning(t *testing.T) {
	for _, failed := range []bool{false, true} {
		t.Run(map[bool]string{false: "script-error", true: "discovery-error"}[failed], func(t *testing.T) {
			resolve, closeSender := resolveSerialPortFn, closeDefaultSenderFn
			t.Cleanup(func() { resolveSerialPortFn, closeDefaultSenderFn = resolve, closeSender })
			held := false
			resolveSerialPortFn = func(string) (string, error) {
				held = true
				if failed {
					return "", errors.New("discovery failed")
				}
				return "COM17", nil
			}
			closeDefaultSenderFn = func() { held = false }
			if err := runRestoreKnownGood([]string{"--script-path", t.TempDir() + "/missing-restore-script"}); err == nil {
				t.Fatal("expected preflight error before any hardware write")
			}
			if held {
				t.Fatal("restore retained discovery handle across handoff/return")
			}
		})
	}
}
