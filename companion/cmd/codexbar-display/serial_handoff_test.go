package main

import (
	"errors"
	"testing"
)

// Doctor no longer opens the serial port itself: it asks the running Companion
// for the Cable identity that Companion already owns. The three tests that
// covered quiescing the service and releasing doctor's own probe/hello handles
// described that removed probe path, so they were dropped with it. The
// remaining handoff tests below still guard the commands that do open the port.
// Doctor's own behaviour is covered by main_doctor_test.go.

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
