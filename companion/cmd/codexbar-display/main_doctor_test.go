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
	plist := `<plist><dict><array><string>daemon</string><string>--transport</string><string>wifi</string><string>--target</string><string>http://192.0.2.10?mode=x&amp;token=secret</string></array></dict></plist>`
	if got := parseLaunchAgentArgument(plist, "--transport"); got != "wifi" {
		t.Fatalf("expected WiFi transport, got %q", got)
	}
	if got := parseLaunchAgentArgument(plist, "--target"); got != "http://192.0.2.10?mode=x&token=secret" {
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
	if got := doctorWiFiProbeTarget("http://192.0.2.10", cfg, false); !strings.Contains(got, "token=saved-token") {
		t.Fatalf("expected matching target token, got %q", got)
	}
	if got := doctorWiFiProbeTarget("http://192.0.2.11", cfg, false); strings.Contains(got, "token=") {
		t.Fatalf("must not send token to another target, got %q", got)
	}
	legacyTarget := "http://192.0.2.12?token=legacy-token"
	if got := doctorWiFiProbeTarget(legacyTarget, runtimeconfig.Config{}, true); got != legacyTarget {
		t.Fatalf("expected legacy inline token to remain private probe credential, got %q", got)
	}
	if got := doctorWiFiProbeTarget(legacyTarget, runtimeconfig.Config{}, false); strings.Contains(got, "token=") {
		t.Fatalf("app-managed probe must not use inline-only token, got %q", got)
	}
	cfg = runtimeconfig.Config{DeviceToken: "saved-token"}
	if got := doctorWiFiProbeTarget(legacyTarget, cfg, true); !strings.Contains(got, "token=saved-token") || strings.Contains(got, "legacy-token") {
		t.Fatalf("expected saved token to authenticate legacy fallback target, got %q", got)
	}
	if got := targetWithQueryToken(legacyTarget, "other-token"); got != legacyTarget {
		t.Fatalf("shared target helper must preserve explicit token, got %q", got)
	}
	cfg = runtimeconfig.Config{KnownDevices: []runtimeconfig.KnownDevice{{Target: "http://192.0.2.13", DeviceToken: "historical-token"}}}
	if got := doctorWiFiProbeTarget("http://192.0.2.13", cfg, false); strings.Contains(got, "token=") {
		t.Fatalf("doctor must not use historical known-device token, got %q", got)
	}
}

func TestDoctorPublicWiFiTargetRedactsSavedToken(t *testing.T) {
	got := doctorPublicWiFiTarget("http://user:password@192.0.2.10?token=token-value&auth=auth-value&key=key-value&secret=secret-value")
	if got != "http://<redacted>@192.0.2.10?auth=<redacted>&key=<redacted>&secret=<redacted>" {
		t.Fatalf("expected redacted target, got %q", got)
	}
}

func TestDoctorLaunchAgentStateMustBeActive(t *testing.T) {
	for _, state := range []string{"running", "waiting", "spawn scheduled"} {
		if !doctorLaunchAgentStateHealthy("state = " + state) {
			t.Fatalf("expected %q to be healthy", state)
		}
	}
	if doctorLaunchAgentStateHealthy("state = exited") {
		t.Fatal("exited LaunchAgent must not be treated as active")
	}
}

func TestReadDoctorLegacyLaunchAgentPlistFallsBackToSystemPath(t *testing.T) {
	home := "/Users/test"
	systemPath := filepath.Join("/Library", "LaunchAgents", "com.codexbar-display.daemon.plist")
	data, err := readDoctorLegacyLaunchAgentPlist(home, "", func(path string) ([]byte, error) {
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

func TestReadDoctorLegacyLaunchAgentPlistUsesLoadedServicePath(t *testing.T) {
	home := "/Users/test"
	loadedPath := filepath.Join("/Library", "LaunchAgents", "com.codexbar-display.daemon.plist")
	userPath := filepath.Join(home, "Library", "LaunchAgents", "com.codexbar-display.daemon.plist")
	data, err := readDoctorLegacyLaunchAgentPlist(home, "path = "+loadedPath, func(path string) ([]byte, error) {
		switch path {
		case loadedPath:
			return []byte("loaded system plist"), nil
		case userPath:
			return []byte("stale user plist"), nil
		default:
			return nil, os.ErrNotExist
		}
	})
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "loaded system plist" {
		t.Fatalf("expected loaded service plist, got %q", data)
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
	doctorCheckCompanionHealthFn = func(string) error { return nil }
	err := runDoctorWiFiRuntimeChecks(doctorRuntimeConfig{
		configured:  true,
		transport:   "wifi",
		target:      device.URL,
		probeTarget: targetWithQueryToken(device.URL, "stale-token"),
		authReady:   true,
	})
	if err == nil || !strings.Contains(err.Error(), "status=401") {
		t.Fatalf("expected rejected saved token, got %v", err)
	}
}

func TestDoctorWiFiProbeIgnoresAmbientToken(t *testing.T) {
	t.Setenv("CODEXBAR_DISPLAY_DEVICE_TOKEN", "ambient-token")
	device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("X-VibeTV-Token"); got != "" {
			t.Fatalf("expected no ambient token, got %q", got)
		}
		_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":1,"board":"esp8266-smalltv-st7789","firmware":"1.0.40"}`))
	}))
	defer device.Close()

	if _, err := doctorReadWiFiCapabilitiesFn(device.URL); err != nil {
		t.Fatal(err)
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

	if err := checkDoctorCompanionHealthOrigins([]string{deadOrigin, healthy.URL}, ""); err != nil {
		t.Fatalf("expected default endpoint fallback to pass: %v", err)
	}
}

func TestDoctorCompanionHealthRejectsNonWriter(t *testing.T) {
	nonWriter := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true,"displayWriter":false}`))
	}))
	defer nonWriter.Close()

	err := checkDoctorCompanionHealthOrigins([]string{nonWriter.URL}, "")
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

	if err := checkDoctorCompanionHealthOrigins([]string{legacy.URL}, "com.codexbar-display.daemon"); err != nil {
		t.Fatalf("expected legacy runtime response to pass: %v", err)
	}
}

func TestDoctorCompanionHealthRejectsDifferentRuntimeOwner(t *testing.T) {
	legacy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true,"displayWriter":true,"companion":{"runtime":{"listenerOwner":"com.codexbar-display.daemon"}}}`))
	}))
	defer legacy.Close()

	err := checkDoctorCompanionHealthOrigins([]string{legacy.URL}, "shop.vibetv.control-center.runtime")
	if err == nil || !strings.Contains(err.Error(), "belongs to") {
		t.Fatalf("expected mismatched runtime owner to fail, got %v", err)
	}
}

func TestDoctorCompanionHealthRequiresAppRuntimeOwner(t *testing.T) {
	legacyResponse := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true,"displayWriter":true}`))
	}))
	defer legacyResponse.Close()

	err := checkDoctorCompanionHealthOrigins([]string{legacyResponse.URL}, "shop.vibetv.control-center.runtime")
	if err == nil || !strings.Contains(err.Error(), "listener owner") {
		t.Fatalf("expected missing app runtime owner to fail, got %v", err)
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
			doctorCheckCompanionHealthFn = func(string) error { return nil }
			doctorReadWiFiCapabilitiesFn = func(string) (protocol.DeviceCapabilities, error) {
				return protocol.DeviceCapabilities{
					Known:                     true,
					Board:                     "esp8266-smalltv-st7789",
					NegotiatedProtocolVersion: protocol.ProtocolVersionV1,
					SupportsTheme:             true,
				}, nil
			}

			err := runDoctorTransportChecks(doctorRuntimeConfig{
				configured: true,
				transport:  "wifi",
				target:     "http://192.0.2.10",
				authReady:  true,
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

func TestDoctorAppWiFiRejectsMissingActiveCredential(t *testing.T) {
	restoreDoctorTestDeps(t)
	doctorCheckCompanionHealthFn = func(string) error {
		t.Fatal("missing credential must fail before health probe")
		return nil
	}

	err := runDoctorWiFiRuntimeChecks(doctorRuntimeConfig{
		configured: true,
		label:      "shop.vibetv.control-center.runtime",
		transport:  "wifi",
		target:     "http://192.0.2.10",
	})
	if err == nil || !strings.Contains(err.Error(), "credential unavailable") {
		t.Fatalf("expected missing active credential to fail, got %v", err)
	}
}

func TestDoctorWiFiRejectsUnknownCapabilities(t *testing.T) {
	restoreDoctorTestDeps(t)
	doctorCheckCompanionHealthFn = func(string) error { return nil }
	doctorReadWiFiCapabilitiesFn = func(string) (protocol.DeviceCapabilities, error) {
		return protocol.UnknownDeviceCapabilities(), nil
	}

	err := runDoctorWiFiRuntimeChecks(doctorRuntimeConfig{
		configured: true,
		transport:  "wifi",
		target:     "http://192.0.2.10",
		authReady:  true,
	})
	if err == nil || !strings.Contains(err.Error(), "capabilities unknown") {
		t.Fatalf("expected unknown WiFi capabilities to fail, got %v", err)
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
