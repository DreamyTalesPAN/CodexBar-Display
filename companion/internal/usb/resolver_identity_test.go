package usb

import (
	"errors"
	"testing"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/errcode"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
)

func cableHello(deviceID string) protocol.DeviceHello {
	return protocol.DeviceHello{
		Kind:     "hello",
		Board:    vibeTVBoardID,
		DeviceID: deviceID,
		Capabilities: protocol.CapabilityBlock{
			Transport: protocol.TransportCapabilities{Active: "usb", Mode: "cable"},
		},
	}
}

func TestResolveVibeTVCandidatesUsesDeviceIdentityNotPortName(t *testing.T) {
	ports := []string{"/dev/cu.usbmodem-preferred-name", "/dev/cu.usbserial-11230"}
	hellos := map[string]protocol.DeviceHello{
		ports[0]: {Kind: "hello", Board: "foreign-board", DeviceID: "foreign"},
		ports[1]: cableHello("14799300"),
	}
	got, err := resolveVibeTVCandidates(
		ports,
		"",
		"14799300",
		func(port string) (protocol.DeviceHello, error) { return hellos[port], nil },
	)
	if err != nil {
		t.Fatalf("resolve VibeTV: %v", err)
	}
	if got != ports[1] {
		t.Fatalf("resolved %q, expected identity match %q", got, ports[1])
	}
}

func TestResolveVibeTVCandidatesAcceptsLilygoCableIdentity(t *testing.T) {
	port := "/dev/cu.usbmodem-lilygo"
	hello := cableHello("A1B2C3D4E5F6")
	hello.Board = lilygoVibeTVBoardID
	got, err := resolveVibeTVCandidates(
		[]string{port},
		port,
		"A1B2C3D4E5F6",
		func(string) (protocol.DeviceHello, error) { return hello, nil },
	)
	if err != nil || got != port {
		t.Fatalf("resolve LilyGO Cable identity: got=%q err=%v", got, err)
	}
}

func TestResolveVibeTVCandidatesIgnoresForeignAndUnresponsivePorts(t *testing.T) {
	ports := []string{"/dev/cu.usbserial-foreign", "/dev/cu.usbserial-offline"}
	_, err := resolveVibeTVCandidates(
		ports,
		"",
		"14799300",
		func(port string) (protocol.DeviceHello, error) {
			if port == ports[0] {
				return protocol.DeviceHello{Kind: "hello", Board: "other", DeviceID: "other"}, nil
			}
			return protocol.DeviceHello{}, errors.New("no response")
		},
	)
	if errcode.Of(err) != errcode.TransportNoMatchingDevice {
		t.Fatalf("expected no matching device, got %v", err)
	}
}

func TestResolveVibeTVCandidatesStopsOnSeveralMatches(t *testing.T) {
	ports := []string{"/dev/cu.usbserial-a", "/dev/cu.usbserial-b"}
	_, err := resolveVibeTVCandidates(
		ports,
		"",
		"",
		func(port string) (protocol.DeviceHello, error) {
			return cableHello("device-" + port[len(port)-1:]), nil
		},
	)
	if errcode.Of(err) != errcode.TransportMultipleDevices {
		t.Fatalf("expected multiple device error, got %v", err)
	}
}

func TestResolveVibeTVCandidatesRejectsWiFiModeOnSerial(t *testing.T) {
	port := "/dev/cu.usbserial-wifi"
	hello := cableHello("14799300")
	hello.Capabilities.Transport.Active = "wifi"
	hello.Capabilities.Transport.Mode = "wifi"
	_, err := resolveVibeTVCandidates(
		[]string{port},
		port,
		"",
		func(string) (protocol.DeviceHello, error) { return hello, nil },
	)
	if errcode.Of(err) != errcode.TransportNoMatchingDevice {
		t.Fatalf("expected WiFi-mode serial device to be ignored, got %v", err)
	}
}

func TestCableSerialCandidatesDropsMacOSTTYAliasOnly(t *testing.T) {
	ports := []string{
		"/dev/cu.usbserial-11230",
		"/dev/tty.usbserial-11230",
		"/dev/cu.usbserial-other",
		"/dev/cu.Bluetooth-Incoming-Port",
	}
	got := cableSerialCandidates(ports, "darwin")
	want := []string{"/dev/cu.usbserial-11230", "/dev/cu.usbserial-other"}
	if len(got) != len(want) || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("unexpected macOS Cable candidates: got=%v want=%v", got, want)
	}

	linux := cableSerialCandidates([]string{"/dev/ttyUSB0"}, "linux")
	if len(linux) != 1 || linux[0] != "/dev/ttyUSB0" {
		t.Fatalf("Linux ttyUSB candidate must remain available: %v", linux)
	}
}
