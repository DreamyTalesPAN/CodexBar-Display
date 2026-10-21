package main

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/firmwareupdate"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/usb"
)

// markerWithPorts leaves the marker of a half-written VibeTV on port, with the
// ports that were listed when its write started.
func markerWithPorts(t *testing.T, port string, ports []string) {
	t.Helper()
	marker := writeRescueMarkerFixture(t, port, time.Hour)
	marker.Ports = ports
	home, err := os.UserHomeDir()
	if err != nil {
		t.Fatal(err)
	}
	if err := firmwareupdate.SaveRescueMarker(home, marker); err != nil {
		t.Fatal(err)
	}
}

// A VibeTV left half-written on COM4 and plugged into another socket comes back
// as COM5. That one new port is silent, so the rescue resumes there and verifies.
func TestRunInstallUpdateCableRescueResumesAVibeTVReplugged(t *testing.T) {
	_, manifestURL, firmwareVersion := prepareCableFirmwareUpdateTest(t)
	pinCableRescue(t)
	markerWithPorts(t, "COM4", []string{"COM1", "COM4"})
	listCablePortsFn = func() ([]string, error) { return []string{"COM1", "COM5"}, nil }
	findLegacyCableVibeTVFn = func() (usb.CableDevice, error) {
		return usb.CableDevice{}, errors.New("no VibeTV with pre-Cable firmware answered hello")
	}
	var flashedPort string
	readCableFirmwareHelloFn = func(port string) (protocol.DeviceHello, error) {
		if port != "COM5" {
			t.Fatalf("hello read on %q, want only the moved port", port)
		}
		if flashedPort == "" {
			return protocol.DeviceHello{}, errors.New("boot loop: no hello")
		}
		return protocol.DeviceHello{DeviceID: "device-cable", Board: rescueTestBoard, Firmware: *firmwareVersion}, nil
	}
	flashCableRescueFn = func(_ context.Context, port string, _ []byte, opts usb.ROMFlashOptions) error {
		flashedPort = port
		opts.OnWriteStarted()
		*firmwareVersion = "1.0.1"
		return nil
	}

	output, err := captureStdout(t, func() error { return runInstallUpdate(rescueArgs(manifestURL)) })
	if err != nil {
		t.Fatalf("rescue of the replugged VibeTV failed: %v\n%s", err, output)
	}
	if flashedPort != "COM5" {
		t.Fatalf("flashed %q, want the moved port COM5\n%s", flashedPort, output)
	}
	if !strings.Contains(output, "moved from COM4 to COM5") || !strings.Contains(output, "Done: firmware 1.0.1 installed") {
		t.Fatalf("moved resume was not logged or not verified:\n%s", output)
	}
	if rescueMarkerPresent(t) {
		t.Fatal("the marker must be cleared after the verified update")
	}
}

// Two new silent ports could hold the VibeTV or another board: nothing is written.
func TestRunInstallUpdateCableRescueWritesNothingWhenTwoNewPortsAreSilent(t *testing.T) {
	_, manifestURL, _ := prepareCableFirmwareUpdateTest(t)
	pinCableRescue(t)
	markerWithPorts(t, "COM4", []string{"COM1", "COM4"})
	listCablePortsFn = func() ([]string, error) { return []string{"COM1", "COM5", "COM6"}, nil }
	findLegacyCableVibeTVFn = func() (usb.CableDevice, error) {
		return usb.CableDevice{}, errors.New("no VibeTV with pre-Cable firmware answered hello")
	}
	readCableFirmwareHelloFn = func(string) (protocol.DeviceHello, error) {
		return protocol.DeviceHello{}, errors.New("no hello")
	}
	flashCableRescueFn = func(context.Context, string, []byte, usb.ROMFlashOptions) error {
		t.Fatal("an ambiguous replug must not be written")
		return nil
	}

	if _, err := captureStdout(t, func() error { return runInstallUpdate(rescueArgs(manifestURL)) }); err == nil {
		t.Fatal("an ambiguous replug must be refused")
	}
	if !rescueMarkerPresent(t) {
		t.Fatal("the marker must stay for the half-written VibeTV")
	}
}

// A new port that answers with a VibeTV is a working device, not the one that
// was left half-written, so it is not resumed.
func TestRunInstallUpdateCableRescueSkipsANewPortThatAnswers(t *testing.T) {
	_, manifestURL, _ := prepareCableFirmwareUpdateTest(t)
	pinCableRescue(t)
	markerWithPorts(t, "COM4", []string{"COM1", "COM4"})
	listCablePortsFn = func() ([]string, error) { return []string{"COM1", "COM5"}, nil }
	findLegacyCableVibeTVFn = func() (usb.CableDevice, error) {
		return usb.CableDevice{}, errors.New("no VibeTV with pre-Cable firmware answered hello")
	}
	readCableFirmwareHelloFn = func(string) (protocol.DeviceHello, error) {
		return protocol.DeviceHello{DeviceID: "working", Board: rescueTestBoard, Firmware: "1.0.0"}, nil
	}
	flashCableRescueFn = func(context.Context, string, []byte, usb.ROMFlashOptions) error {
		t.Fatal("a working VibeTV on a new port must not be written")
		return nil
	}

	if _, err := captureStdout(t, func() error { return runInstallUpdate(rescueArgs(manifestURL)) }); err == nil {
		t.Fatal("no half-written VibeTV must be refused")
	}
	if !rescueMarkerPresent(t) {
		t.Fatal("the marker must stay")
	}
}

// The first rescue write records the ports it saw, so a later replug can be told apart.
func TestRunInstallUpdateCableRescueRecordsThePortsBeforeTheFirstWrite(t *testing.T) {
	_, manifestURL, _ := prepareCableFirmwareUpdateTest(t)
	pinCableRescue(t)
	findLegacyCableVibeTVFn = legacyRescueDevice
	listCablePortsFn = func() ([]string, error) { return []string{"COM1", "/dev/mock-legacy"}, nil }
	flashCableRescueFn = func(_ context.Context, _ string, _ []byte, opts usb.ROMFlashOptions) error {
		opts.OnWriteStarted()
		return errors.New("write flash block 342 of 473: ROM loader response timeout")
	}

	if _, err := captureStdout(t, func() error { return runInstallUpdate(rescueArgs(manifestURL)) }); err == nil {
		t.Fatal("the failed write must fail the update")
	}
	home, err := os.UserHomeDir()
	if err != nil {
		t.Fatal(err)
	}
	marker, ok := firmwareupdate.LoadRescueMarker(home, time.Now())
	if !ok || strings.Join(marker.Ports, ",") != "COM1,/dev/mock-legacy" {
		t.Fatalf("marker ports = %v, ok=%v", marker.Ports, ok)
	}
}
