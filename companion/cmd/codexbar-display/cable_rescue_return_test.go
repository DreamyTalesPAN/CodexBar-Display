package main

import (
	"context"
	"errors"
	"testing"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/usb"
)

// A rescue that moved from COM4 to COM5 fails again. When the VibeTV then goes
// back to its first socket as COM4, that port counts as new and is resumed.
func TestRunInstallUpdateCableRescueFindsAVibeTVThatReturnsToItsFirstPort(t *testing.T) {
	_, manifestURL, _ := prepareCableFirmwareUpdateTest(t)
	pinCableRescue(t)
	markerWithPorts(t, "COM4", []string{"COM1", "COM4"})
	listCablePortsFn = func() ([]string, error) { return []string{"COM1", "COM5"}, nil }
	findLegacyCableVibeTVFn = func() (usb.CableDevice, error) {
		return usb.CableDevice{}, errors.New("no VibeTV with pre-Cable firmware answered hello")
	}
	readCableFirmwareHelloFn = func(context.Context, string) (protocol.DeviceHello, error) {
		return protocol.DeviceHello{}, errors.New("no hello")
	}
	flashCableRescueFn = func(_ context.Context, _ string, _ []byte, opts usb.ROMFlashOptions) error {
		opts.OnWriteStarted()
		return errors.New("write flash block 342 of 473: ROM loader response timeout")
	}
	if _, err := captureStdout(t, func() error { return runInstallUpdate(rescueArgs(manifestURL)) }); err == nil {
		t.Fatal("the failed write on COM5 must fail the update")
	}

	// Back on its first socket.
	listCablePortsFn = func() ([]string, error) { return []string{"COM1", "COM4"}, nil }
	var flashedPort string
	flashCableRescueFn = func(_ context.Context, port string, _ []byte, opts usb.ROMFlashOptions) error {
		flashedPort = port
		opts.OnWriteStarted()
		return errors.New("stop after the first write")
	}
	if _, err := captureStdout(t, func() error { return runInstallUpdate(rescueArgs(manifestURL)) }); err == nil {
		t.Fatal("the test write stops on purpose")
	}
	if flashedPort != "COM4" {
		t.Fatalf("flashed %q after returning to COM4, want COM4", flashedPort)
	}
}
