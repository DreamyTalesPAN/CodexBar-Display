package main

import (
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimeconfig"
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

func TestParseLaunchAgentArgument(t *testing.T) {
	plist := `<plist><dict><array><string>daemon</string><string>--transport</string><string>wifi</string><string>--target</string><string>http://192.0.2.10</string></array></dict></plist>`
	if got := parseLaunchAgentArgument(plist, "--transport"); got != "wifi" {
		t.Fatalf("expected WiFi transport, got %q", got)
	}
	if got := parseLaunchAgentArgument(plist, "--target"); got != "http://192.0.2.10" {
		t.Fatalf("expected WiFi target, got %q", got)
	}
}

func TestDoctorWiFiTargetFallsBackToLegacyPlist(t *testing.T) {
	if got := doctorWiFiTarget("", "http://192.0.2.10"); got != "http://192.0.2.10" {
		t.Fatalf("expected legacy plist target, got %q", got)
	}
	if got := doctorWiFiTarget("http://192.0.2.20", "http://192.0.2.10"); got != "http://192.0.2.20" {
		t.Fatalf("expected runtime config target to win, got %q", got)
	}
}

func TestDoctorWiFiProbeTargetUsesTokenOnlyForMatchingDevice(t *testing.T) {
	cfg := runtimeconfig.Config{
		DeviceTarget: "http://192.0.2.10",
		DeviceToken:  "saved-token",
	}
	if got := doctorWiFiProbeTarget("http://192.0.2.10", cfg); !strings.Contains(got, "token=saved-token") {
		t.Fatalf("expected matching target token, got %q", got)
	}
	if got := doctorWiFiProbeTarget("http://192.0.2.11", cfg); strings.Contains(got, "token=") {
		t.Fatalf("must not send token to another target, got %q", got)
	}
}

func TestDoctorPublicWiFiTargetRedactsSavedToken(t *testing.T) {
	got := doctorPublicWiFiTarget("http://192.0.2.10?token=secret-token")
	if got != "http://192.0.2.10" {
		t.Fatalf("expected redacted target, got %q", got)
	}
}

func TestReadDoctorLegacyLaunchAgentPlistFallsBackToSystemPath(t *testing.T) {
	home := "/Users/test"
	systemPath := filepath.Join("/Library", "LaunchAgents", "com.codexbar-display.daemon.plist")
	data, err := readDoctorLegacyLaunchAgentPlist(home, func(path string) ([]byte, error) {
		if path == systemPath {
			return []byte("system plist"), nil
		}
		return nil, os.ErrNotExist
	})
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "system plist" {
		t.Fatalf("unexpected plist %q", data)
	}
}

func TestDoctorWiFiRejectsStaleSavedToken(t *testing.T) {
	device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-VibeTV-Token") != "stale-token" {
			t.Fatalf("expected saved token in auth header")
		}
		http.Error(w, "unauthorized", http.StatusUnauthorized)
	}))
	defer device.Close()

	restoreDoctorTestDeps(t)
	doctorCheckCompanionHealthFn = func() error { return nil }
	err := runDoctorWiFiRuntimeChecks(doctorRuntimeConfig{
		configured:  true,
		transport:   "wifi",
		target:      device.URL,
		probeTarget: targetWithQueryToken(device.URL, "stale-token"),
	})
	if err == nil || !strings.Contains(err.Error(), "status=401") {
		t.Fatalf("expected rejected saved token, got %v", err)
	}
}

func TestDoctorCompanionHealthFallsBackFromStalePublishedEndpoint(t *testing.T) {
	deadListener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	deadOrigin := "http://" + deadListener.Addr().String()
	_ = deadListener.Close()

	healthy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/runtime-health" {
			t.Fatalf("unexpected path %q", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer healthy.Close()

	if err := checkDoctorCompanionHealthOrigins([]string{deadOrigin, healthy.URL}); err != nil {
		t.Fatalf("expected default endpoint fallback to pass: %v", err)
	}
}

func TestDoctorCompanionHealthRejectsNonWriter(t *testing.T) {
	nonWriter := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true,"displayWriter":false}`))
	}))
	defer nonWriter.Close()

	err := checkDoctorCompanionHealthOrigins([]string{nonWriter.URL})
	if err == nil || !strings.Contains(err.Error(), "no display writer") {
		t.Fatalf("expected non-writer runtime to fail, got %v", err)
	}
}

func TestDoctorCompanionHealthAcceptsLegacyWriterResponse(t *testing.T) {
	legacy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer legacy.Close()

	if err := checkDoctorCompanionHealthOrigins([]string{legacy.URL}); err != nil {
		t.Fatalf("expected legacy runtime response to pass: %v", err)
	}
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
			restoreDoctorTestDeps(t)
			serialCalled := false
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
	doctorListPortsFn = func() ([]string, error) {
		t.Fatal("unconfigured doctor must not list serial ports")
		return nil, nil
	}

	err := runDoctorTransportChecks(doctorRuntimeConfig{})
	if err == nil || !strings.Contains(err.Error(), "setup required") {
		t.Fatalf("expected setup-required error, got %v", err)
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
