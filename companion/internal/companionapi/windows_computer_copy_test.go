package companionapi

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimeconfig"
)

// Customer messages name the machine "this computer" in the Windows app and
// keep "this Mac" on a Mac (the approved Windows wording, 2026-09-23). Each row
// reaches one message through the code that writes it, under both hosts.
func TestWindowsCustomerCopyNamesThisComputerNotThisMac(t *testing.T) {
	cases := []struct {
		name         string
		read         func(t *testing.T) []string
		mac, windows []string
	}{
		{
			name: "factory reset needs the USB cable",
			read: func(t *testing.T) []string {
				server := newTestServer(t, runtimeconfig.Config{ConnectionMode: "wifi", DeviceID: "device-a"})
				rec := httptest.NewRecorder()
				server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/v1/device/factory-reset", nil))
				return apiErrorTexts(t, rec)
			},
			mac:     []string{"VibeTV can only be erased over the USB cable.", "Connect VibeTV to this Mac with the USB cable, switch to USB-C in Settings, then try again."},
			windows: []string{"VibeTV can only be erased over the USB cable.", "Connect VibeTV to this computer with the USB cable, switch to USB-C in Settings, then try again."},
		},
		{
			name: "WiFi search without a network",
			read: func(t *testing.T) []string {
				server := newTestServer(t, runtimeconfig.Config{DeviceID: "active-device", DeviceTarget: "http://192.168.178.73"})
				server.subnetTargets = func() []string { return nil }
				server.defaultWiFiTarget = func() string { return "" }
				server.localNetworkAvailable = func() bool { return false }
				rec := httptest.NewRecorder()
				server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/v1/device/search", strings.NewReader(`{}`)))
				return apiErrorTexts(t, rec)
			},
			mac:     []string{"This Mac isn't connected to a WiFi network.", "Turn on WiFi and connect this Mac to the WiFi your VibeTV uses, then search again."},
			windows: []string{"This computer isn't connected to a WiFi network.", "Turn on WiFi and connect this computer to the WiFi your VibeTV uses, then search again."},
		},
		{
			name: "WiFi pairing refused by current firmware",
			read: func(t *testing.T) []string {
				rec := httptest.NewRecorder()
				writePairingError(rec, &pairingAuthorizationError{statusCode: http.StatusNotFound, err: errors.New("404")}, "1.0.61")
				return apiErrorTexts(t, rec)
			},
			mac:     []string{"VibeTV pairs only over the USB cable.", "Connect VibeTV to this Mac with the USB cable, then press Connect."},
			windows: []string{"VibeTV pairs only over the USB cable.", "Connect VibeTV to this computer with the USB cable, then press Connect."},
		},
		{
			name: "diagnostics WiFi search found no VibeTV",
			read: func(t *testing.T) []string {
				check := discoveryDiagnosticCheck(diagnosticsDiscovery{Attempted: true, Complete: true})
				return []string{check.NextAction}
			},
			mac:     []string{"Keep VibeTV powered on and connected to the same WiFi as this Mac."},
			windows: []string{"Keep VibeTV powered on and connected to the same WiFi as this computer."},
		},
		{
			name: "firmware update needs the USB cable",
			read: func(t *testing.T) []string {
				payload := firmwareUpdateErrorPayload(errors.New("cable required"), "cable_required")
				return []string{payload.NextAction}
			},
			mac:     []string{"Connect VibeTV to this Mac with the USB cable, then update again."},
			windows: []string{"Connect VibeTV to this computer with the USB cable, then update again."},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			original := providerCopyGOOS
			t.Cleanup(func() { providerCopyGOOS = original })

			providerCopyGOOS = "darwin"
			if got := tc.read(t); !reflect.DeepEqual(got, tc.mac) {
				t.Fatalf("darwin text = %q, want %q", got, tc.mac)
			}
			providerCopyGOOS = "windows"
			if got := tc.read(t); !reflect.DeepEqual(got, tc.windows) {
				t.Fatalf("windows text = %q, want %q", got, tc.windows)
			}
		})
	}
}
