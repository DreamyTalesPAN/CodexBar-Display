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

func TestDoctorUsesRunningCompanionWithoutStoppingTask(t *testing.T) {
	read := doctorReadCableCapabilitiesFn
	t.Cleanup(func() { doctorReadCableCapabilitiesFn = read })
	owner := &doctorUSBTask{}
	want := errors.New("Companion unavailable")
	doctorReadCableCapabilitiesFn = func(string) (protocol.DeviceCapabilities, error) { return protocol.DeviceCapabilities{}, want }
	err := runDoctorUSBRuntimeChecks(doctorRuntimeConfig{usbOwner: owner})
	if err == nil || owner.stopped || owner.restarted {
		t.Fatalf("doctor mutated task: %+v err=%v", owner, err)
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
