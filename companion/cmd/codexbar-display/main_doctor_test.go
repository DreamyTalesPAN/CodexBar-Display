package main

import (
	"errors"
	"strings"
	"testing"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
)

func TestParsePinnedPortFromLaunchAgentPlist(t *testing.T) {
	t.Run("unpinned", func(t *testing.T) {
		plist := `<plist><dict><key>ProgramArguments</key><array><string>codexbar-display</string></array></dict></plist>`
		if got := parsePinnedPortFromLaunchAgentPlist(plist); got != "" {
			t.Fatalf("expected no pinned port, got %q", got)
		}
	})

	t.Run("pinned", func(t *testing.T) {
		plist := `<plist><dict><array><string>daemon</string><string>--port</string><string>/dev/cu.usbserial-10</string></array></dict></plist>`
		if got := parsePinnedPortFromLaunchAgentPlist(plist); got != "/dev/cu.usbserial-10" {
			t.Fatalf("expected pinned port, got %q", got)
		}
	})

	t.Run("malformed", func(t *testing.T) {
		plist := `<plist><dict><array><string>daemon</string><string>--port</string></array></dict></plist>`
		if got := parsePinnedPortFromLaunchAgentPlist(plist); got != "" {
			t.Fatalf("expected no pinned port for malformed plist, got %q", got)
		}
	})
}

func TestContainsPort(t *testing.T) {
	ports := []string{"/dev/cu.usbmodem101", "/dev/cu.usbserial-10"}
	if !containsPort(ports, "/dev/cu.usbserial-10") {
		t.Fatalf("expected exact port match")
	}
	if containsPort(ports, "/dev/cu.usbserial-11") {
		t.Fatalf("did not expect unknown port to match")
	}
}

func TestDoctorWiFiSkipsSerialChecks(t *testing.T) {
	for _, ports := range [][]string{
		{},
		{"/dev/cu.usbserial-1"},
		{"/dev/cu.Bluetooth-Incoming-Port", "/dev/cu.usbserial-1", "/dev/cu.usbserial-2"},
	} {
		t.Run(strings.Join(ports, ","), func(t *testing.T) {
			serialCalled := false
			restoreDoctorTestDeps(t)
			doctorListPortsFn = func() ([]string, error) {
				serialCalled = true
				return ports, nil
			}
			doctorCheckCompanionHealthFn = func() error { return nil }
			doctorReadWiFiCapabilitiesFn = func(string) (protocol.DeviceCapabilities, error) {
				return protocol.UnknownDeviceCapabilities(), nil
			}

			err := runDoctorTransportChecks(doctorRuntimeConfig{
				configured: true,
				transport:  "wifi",
				target:     "http://192.0.2.10",
			})
			if err != nil {
				t.Fatalf("WiFi doctor failed: %v", err)
			}
			if serialCalled {
				t.Fatal("WiFi doctor must not list serial ports")
			}
		})
	}
}

func TestDoctorUSBStillRejectsAmbiguousUnpinnedPorts(t *testing.T) {
	restoreDoctorTestDeps(t)
	doctorListPortsFn = func() ([]string, error) {
		return []string{"/dev/cu.usbserial-1", "/dev/cu.usbserial-2"}, nil
	}
	doctorResolvePortFn = func(string) (string, error) { return "/dev/cu.usbserial-1", nil }
	doctorProbePortFn = func(string) error { return nil }
	doctorReadDeviceHelloFn = func(string) (protocol.DeviceHello, error) {
		return protocol.DeviceHello{}, errors.New("must not reach device hello")
	}

	err := runDoctorTransportChecks(doctorRuntimeConfig{configured: true, transport: "usb"})
	if err == nil || !strings.Contains(err.Error(), "2 serial ports detected") {
		t.Fatalf("expected USB ambiguity error, got %v", err)
	}
}

func TestDoctorWithoutRuntimeRequestsSetupWithoutListingPorts(t *testing.T) {
	restoreDoctorTestDeps(t)
	serialCalled := false
	doctorListPortsFn = func() ([]string, error) {
		serialCalled = true
		return nil, nil
	}

	err := runDoctorTransportChecks(doctorRuntimeConfig{})
	if err == nil || !strings.Contains(err.Error(), "setup required") {
		t.Fatalf("expected setup-required error, got %v", err)
	}
	if serialCalled {
		t.Fatal("unconfigured doctor must not treat serial inventory as fatal")
	}
}

func restoreDoctorTestDeps(t *testing.T) {
	t.Helper()
	listPorts := doctorListPortsFn
	resolvePort := doctorResolvePortFn
	probePort := doctorProbePortFn
	readHello := doctorReadDeviceHelloFn
	readWiFiCapabilities := doctorReadWiFiCapabilitiesFn
	checkCompanionHealth := doctorCheckCompanionHealthFn
	t.Cleanup(func() {
		doctorListPortsFn = listPorts
		doctorResolvePortFn = resolvePort
		doctorProbePortFn = probePort
		doctorReadDeviceHelloFn = readHello
		doctorReadWiFiCapabilitiesFn = readWiFiCapabilities
		doctorCheckCompanionHealthFn = checkCompanionHealth
	})
}

func TestFallbackThemeSpecCapabilities(t *testing.T) {
	caps := fallbackThemeSpecCapabilities()
	if !caps.Known {
		t.Fatalf("expected fallback capabilities to be known")
	}
	if !caps.SupportsThemeSpecV1 {
		t.Fatalf("expected fallback profile to support ThemeSpec v1")
	}
	if caps.NegotiatedProtocolVersion != 2 {
		t.Fatalf("expected protocol v2 fallback, got %d", caps.NegotiatedProtocolVersion)
	}
	if caps.MaxThemeSpecBytes <= 0 || caps.MaxThemePrimitives <= 0 {
		t.Fatalf("expected positive fallback limits, got bytes=%d primitives=%d", caps.MaxThemeSpecBytes, caps.MaxThemePrimitives)
	}
}
