package usb

import (
	"errors"
	"strings"
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

func TestResolveVibeTVCandidatesReportsAResponsiveForeignDevice(t *testing.T) {
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
	if errcode.Of(err) != errcode.TransportForeignDevice {
		t.Fatalf("expected foreign serial device, got %v", err)
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

func TestDiscoverVibeTVsReturnsEveryIdentity(t *testing.T) {
	ports := []string{"/dev/cu.usbserial-b", "/dev/cu.usbserial-a", "/dev/tty.usbserial-a"}
	readHello := func(port string) (protocol.DeviceHello, error) {
		id := "vibetv-b"
		if strings.HasSuffix(port, "-a") {
			id = "vibetv-a"
		}
		return cableHello(id), nil
	}

	got, err := discoverVibeTVs(ports, readHello, "darwin")
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0].Hello.DeviceID != "vibetv-a" || got[1].Hello.DeviceID != "vibetv-b" {
		t.Fatalf("unexpected Cable devices: %+v", got)
	}
}

func TestDiscoverVibeTVsKeepsForeignDeviceOutOfList(t *testing.T) {
	got, err := discoverVibeTVs(
		[]string{"/dev/cu.usbserial-foreign"},
		func(string) (protocol.DeviceHello, error) {
			return protocol.DeviceHello{Kind: "hello", Board: "foreign-board", DeviceID: "foreign"}, nil
		},
		"darwin",
	)
	if len(got) != 0 || errcode.Of(err) != errcode.TransportForeignDevice {
		t.Fatalf("foreign serial device leaked into list: devices=%+v err=%v", got, err)
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

func TestResolveVibeTVControlCandidatesAcceptsWiFiModeOverUSB(t *testing.T) {
	port := "/dev/cu.usbserial-wifi"
	hello := cableHello("14799300")
	hello.Capabilities.Transport.Mode = "wifi"
	got, err := resolveVibeTVCandidatesForControl(
		[]string{port},
		port,
		"14799300",
		func(string) (protocol.DeviceHello, error) { return hello, nil },
		true,
	)
	if err != nil || got != port {
		t.Fatalf("resolve WiFi-mode VibeTV control port: got=%q err=%v", got, err)
	}
}

func TestResolveVibeTVControlCandidatesAcceptsLegacyWiFiOnlyForReselection(t *testing.T) {
	port := "/dev/cu.usbserial-legacy-wifi"
	hello := cableHello("14799300")
	hello.Capabilities.Transport.Mode = "legacy-wifi-only"
	hello.Capabilities.Transport.Supported = []string{"wifi"}

	got, err := resolveVibeTVCandidatesForControl(
		[]string{port},
		port,
		"14799300",
		func(string) (protocol.DeviceHello, error) { return hello, nil },
		true,
	)
	if err != nil || got != port {
		t.Fatalf("resolve legacy WiFi-only VibeTV for control: got=%q err=%v", got, err)
	}
	if _, err := resolveVibeTVCandidates(
		[]string{port},
		port,
		"14799300",
		func(string) (protocol.DeviceHello, error) { return hello, nil },
	); errcode.Of(err) != errcode.TransportNoMatchingDevice {
		t.Fatalf("runtime Cable resolver accepted unsupported legacy WiFi-only mode: %v", err)
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

func TestDiscoverVibeTVsOnWindowsProbesCOMPorts(t *testing.T) {
	devices, err := discoverVibeTVs([]string{"COM3", "com17", ""}, func(port string) (protocol.DeviceHello, error) {
		hello := cableHello(port)
		hello.Capabilities.Transport.Mode = "wifi"
		return hello, nil
	}, "windows")
	if err != nil || len(devices) != 2 {
		t.Fatalf("Windows COM devices must be discovered: devices=%v err=%v", devices, err)
	}
}

func TestFindLegacyCableVibeTVAcceptsOnlyOnePreIdentityESP8266(t *testing.T) {
	legacy := cableHello("")
	legacy.Capabilities.Transport.Mode = ""
	legacy.Firmware = "1.0.39"
	legacyLilygo := legacy
	legacyLilygo.Board = lilygoVibeTVBoardID
	hellos := map[string]protocol.DeviceHello{
		"/dev/cu.usbserial-current": cableHello("14799300"),
		"/dev/cu.usbserial-legacy":  legacy,
		"/dev/cu.usbserial-lilygo":  legacyLilygo,
		"/dev/cu.usbserial-foreign": {Kind: "hello", Board: "foreign-board"},
	}
	read := func(port string) (protocol.DeviceHello, error) {
		hello, ok := hellos[port]
		if !ok {
			return protocol.DeviceHello{}, errors.New("silent")
		}
		return hello, nil
	}

	got, err := findLegacyCableVibeTV([]string{
		"/dev/cu.usbserial-current", "/dev/cu.usbserial-silent", "/dev/cu.usbserial-legacy",
		"/dev/cu.usbserial-lilygo", "/dev/cu.usbserial-foreign",
	}, read)
	if err != nil || got.Port != "/dev/cu.usbserial-legacy" || got.Hello.Firmware != "1.0.39" {
		t.Fatalf("findLegacyCableVibeTV = %+v, %v", got, err)
	}

	if _, err := findLegacyCableVibeTV([]string{"/dev/cu.usbserial-current", "/dev/cu.usbserial-lilygo"}, read); errcode.Of(err) != errcode.TransportNoMatchingDevice {
		t.Fatalf("without a legacy ESP8266: %v", err)
	}
	hellos["/dev/cu.usbserial-legacy2"] = legacy
	if _, err := findLegacyCableVibeTV([]string{"/dev/cu.usbserial-legacy", "/dev/cu.usbserial-legacy2"}, read); errcode.Of(err) != errcode.TransportMultipleDevices {
		t.Fatalf("with two legacy devices: %v", err)
	}
}

func TestDiscoverVibeTVsReportsTheLegacyVibeTVItFound(t *testing.T) {
	legacy := cableHello("")
	legacy.Capabilities.Transport.Mode = ""
	legacy.Firmware = "1.0.39"
	got, err := discoverVibeTVs(
		[]string{"/dev/cu.usbserial-legacy"},
		func(string) (protocol.DeviceHello, error) { return legacy, nil },
		"darwin",
	)
	var found *LegacyCableFirmwareError
	if len(got) != 0 || errcode.Of(err) != errcode.TransportCableFirmwareTooOld || !errors.As(err, &found) {
		t.Fatalf("legacy VibeTV not reported: devices=%+v err=%v", got, err)
	}
	if found.Board != legacy.Board || found.Firmware != "1.0.39" {
		t.Fatalf("legacy VibeTV = %+v, want board %s firmware 1.0.39", found, legacy.Board)
	}
}

// Issue #529: a port another program holds was never asked. Only when that is
// every port does the resolver say so; one silent port that was opened keeps
// the usual "no VibeTV answered".
func TestResolveVibeTVControlCandidatesReportsPortsThatCouldNotBeOpened(t *testing.T) {
	busy := wrapTransportError(errcode.TransportSerialOpen, "open-port", "/dev/cu.usbserial-busy", "", errors.New("resource busy"))
	silent := wrapTransportError(errcode.ProtocolDeviceHelloUnavailable, "read-hello", "/dev/cu.usbserial-silent", "", ErrDeviceHelloUnavailable)
	readHello := func(path string) (protocol.DeviceHello, error) {
		if strings.Contains(path, "busy") {
			return protocol.DeviceHello{}, busy
		}
		return protocol.DeviceHello{}, silent
	}
	for _, tc := range []struct {
		name  string
		ports []string
		want  errcode.Code
	}{
		{"only busy ports", []string{"/dev/cu.usbserial-busy", "/dev/cu.usbserial-busy2"}, errcode.TransportSerialOpen},
		{"a silent port was asked", []string{"/dev/cu.usbserial-busy", "/dev/cu.usbserial-silent"}, errcode.TransportNoMatchingDevice},
		{"only silent ports", []string{"/dev/cu.usbserial-silent"}, errcode.TransportNoMatchingDevice},
	} {
		if _, err := resolveVibeTVCandidatesForControl(tc.ports, "", "14799300", readHello, true); errcode.Of(err) != tc.want {
			t.Fatalf("%s: got %v, want code %s", tc.name, err, tc.want)
		}
	}
}
