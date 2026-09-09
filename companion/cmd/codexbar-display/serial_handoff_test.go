package main

import (
	"errors"
	"testing"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
)

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
