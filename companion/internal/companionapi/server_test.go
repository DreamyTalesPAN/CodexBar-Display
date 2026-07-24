package companionapi

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"testing"
	"testing/fstest"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/daemon"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/firmwareupdate"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimeconfig"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimepaths"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/setup"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/themeinstall"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/themepack"
)

func TestStatusWorksWithoutDevice(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/status", nil)

	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got statusResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !got.OK || got.Companion.Status != "ready" {
		t.Fatalf("unexpected status response: %+v", got)
	}
	if !got.Companion.Features.ThemeInstallEnabled {
		t.Fatalf("expected theme install enabled by default")
	}
	if got.Companion.Features.MacAppSelfUpdateEnabled {
		t.Fatalf("expected the new binary to disable the legacy Mac App updater")
	}
	if got.Companion.InstallationMode != "legacy" {
		t.Fatalf("expected default legacy installation mode, got %q", got.Companion.InstallationMode)
	}
	if got.Device.Connected {
		t.Fatalf("expected disconnected device without probing, got %+v", got.Device)
	}
}

func TestStatusSerializesFalseDeviceBooleans(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/v1/status", nil))

	body := rec.Body.String()
	for _, field := range []string{`"connected":false`, `"paired":false`, `"ready":false`, `"active":false`} {
		if !strings.Contains(body, field) {
			t.Fatalf("status omitted %s: %s", field, body)
		}
	}
}

func TestStatusIncludesLatestFirmwareUpdateJob(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	startedAt := time.Now().UTC().Add(-time.Minute)
	server.updateJobs["finished-update"] = &firmwareUpdateJob{
		ID:        "finished-update",
		Phase:     "complete",
		Message:   "Update complete.",
		Progress:  100,
		StartedAt: startedAt,
	}
	server.updateJobs["active-update"] = &firmwareUpdateJob{
		ID:        "active-update",
		Phase:     "installing",
		Stage:     "waiting_for_device",
		Message:   "Restarting VibeTV.",
		Progress:  85,
		StartedAt: startedAt.Add(30 * time.Second),
	}

	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(
		rec,
		httptest.NewRequest(http.MethodGet, "/v1/status", nil),
	)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got statusResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.FirmwareUpdate == nil || got.FirmwareUpdate.ID != "active-update" {
		t.Fatalf("expected latest firmware update in status, got %+v", got.FirmwareUpdate)
	}
	if got.FirmwareUpdate.Phase != "installing" || got.FirmwareUpdate.Progress != 85 {
		t.Fatalf("unexpected firmware update snapshot: %+v", got.FirmwareUpdate)
	}
}

func TestStatusIncludesLatestThemeInstallJob(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	startedAt := time.Now().UTC().Add(-time.Minute)
	server.installJobs["finished-theme"] = &themeInstallJob{
		ID:        "finished-theme",
		ThemeID:   "mini",
		ThemeName: "Mini",
		Phase:     "complete",
		Progress:  100,
		StartedAt: startedAt,
	}
	server.installJobs["active-theme"] = &themeInstallJob{
		ID:        "active-theme",
		ThemeID:   "clippy",
		ThemeName: "Clippy",
		Phase:     "installing",
		Message:   "Uploading theme files.",
		Progress:  40,
		StartedAt: startedAt.Add(30 * time.Second),
	}

	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(
		rec,
		httptest.NewRequest(http.MethodGet, "/v1/status", nil),
	)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got statusResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.ThemeInstall == nil || got.ThemeInstall.ID != "active-theme" {
		t.Fatalf("expected latest theme install in status, got %+v", got.ThemeInstall)
	}
	if got.ThemeInstall.ThemeID != "clippy" || got.ThemeInstall.ThemeName != "Clippy" {
		t.Fatalf("expected resumable theme identity, got %+v", got.ThemeInstall)
	}
	if got.ThemeInstall.Phase != "installing" || got.ThemeInstall.Progress != 40 {
		t.Fatalf("unexpected theme install snapshot: %+v", got.ThemeInstall)
	}
}

func TestRuntimeHealthDoesNotProbeDeviceOrRelease(t *testing.T) {
	device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatalf("runtime health must not contact VibeTV, got %s", r.URL.Path)
	}))
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{
		DeviceTarget: device.URL,
		DeviceToken:  "pair-token",
	})
	server.fetchMacAppRelease = func(context.Context) (githubRelease, error) {
		t.Fatal("runtime health must not check the Mac App release")
		return githubRelease{}, nil
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/runtime-health", nil)
	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got struct {
		OK        bool `json:"ok"`
		Companion struct {
			Version string `json:"version"`
		} `json:"companion"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !got.OK || strings.TrimSpace(got.Companion.Version) == "" {
		t.Fatalf("unexpected runtime health response: %+v", got)
	}
}

func TestStatusIgnoresStaleSavedTokenForReadOnlyReachability(t *testing.T) {
	sawStaleHello := false
	sawTokenlessHello := false
	sawTokenlessHealth := false
	device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hello":
			if r.Header.Get("X-VibeTV-Token") == "stale-token" {
				sawStaleHello = true
				http.Error(w, "stale token", http.StatusForbidden)
				return
			}
			if r.Header.Get("X-VibeTV-Token") == "" {
				sawTokenlessHello = true
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"board":"esp8266-smalltv-st7789","firmware":"1.0.37","deviceId":"saved-device","capabilities":{"theme":{"supportsThemeSpecV1":true},"auth":{"paired":true,"tokenHeader":"X-VibeTV-Token","pairingWindowOpen":true,"pairingWindowSeconds":1742},"transport":{"active":"wifi"}}}`))
		case "/health":
			if r.Header.Get("X-VibeTV-Token") != "" {
				http.Error(w, "stale token", http.StatusForbidden)
				return
			}
			sawTokenlessHealth = true
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true,"display":{"activeTheme":"mini","themeSpec":{"active":true,"path":"/themes/u/mini.json","renderOk":true}},"settings":{"display":{"brightnessPercent":70}}}`))
		default:
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
	}))
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{DeviceTarget: device.URL, DeviceToken: "stale-token", DeviceID: "saved-device"})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/status", nil)

	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got statusResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !got.Device.Connected || got.Device.Target != device.URL || got.Device.Firmware != "1.0.37" {
		t.Fatalf("expected tokenless read-only status to keep device reachable, got %+v", got.Device)
	}
	if !got.Device.Active || got.Device.Ready {
		t.Fatalf("reachable active device with rejected token must not be ready: %+v", got.Device)
	}
	if got.Device.Paired {
		t.Fatalf("stale saved token must not be reported as validated pairing")
	}
	if got.Device.Stream == nil || got.Device.Stream.ErrorCode != "pairing_token_rejected" {
		t.Fatalf("explicit token rejection must be preserved: %+v", got.Device.Stream)
	}
	if got.Device.ActiveTheme != "mini" {
		t.Fatalf("expected tokenless health probe to populate device health, got %+v", got.Device)
	}
	if got.Device.Capabilities == nil || got.Device.Capabilities.Auth == nil {
		t.Fatalf("expected device API to preserve auth capabilities, got %+v", got.Device.Capabilities)
	}
	if !got.Device.Capabilities.Auth.Paired || !got.Device.Capabilities.Auth.PairingWindowOpen || got.Device.Capabilities.Auth.PairingWindowSeconds != 1742 {
		t.Fatalf("unexpected pairing window capabilities: %+v", got.Device.Capabilities.Auth)
	}
	if got.Device.Capabilities.Auth.TokenHeader != "X-VibeTV-Token" {
		t.Fatalf("unexpected pairing token header descriptor: %+v", got.Device.Capabilities.Auth)
	}
	if !sawStaleHello || !sawTokenlessHello || !sawTokenlessHealth {
		t.Fatalf("expected stale hello, tokenless hello, and tokenless health probes; stale=%t tokenlessHello=%t tokenlessHealth=%t", sawStaleHello, sawTokenlessHello, sawTokenlessHealth)
	}
}

func TestStatusDoesNotAdoptDifferentDeviceAtConfiguredAddress(t *testing.T) {
	device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hello":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"board":"esp8266-smalltv-st7789","firmware":"1.0.44","deviceId":"replacement-device","networkMode":"station","capabilities":{"transport":{"active":"wifi"}}}`))
		case "/health":
			t.Fatal("status must not inspect the replacement device as the saved device")
		default:
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
	}))
	defer device.Close()

	initial := runtimeconfig.Config{
		DeviceTarget: device.URL,
		DeviceToken:  "saved-token",
		DeviceID:     "saved-device",
	}
	server := newTestServer(t, initial)
	var configWrites atomic.Int32
	server.saveConfig = func(_ string, _ runtimeconfig.Config) error {
		configWrites.Add(1)
		return nil
	}

	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/v1/status", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got statusResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.Device.DeviceID != initial.DeviceID || got.Device.Target != initial.DeviceTarget {
		t.Fatalf("saved device identity was replaced: %+v", got.Device)
	}
	if got.Device.Connected || got.Device.Ready || got.Device.ConnectionState != deviceConnectionRetrying {
		t.Fatalf("replacement at saved address must leave saved device reconnecting: %+v", got.Device)
	}
	if configWrites.Load() != 0 {
		t.Fatalf("read-only identity mismatch wrote config %d times", configWrites.Load())
	}
}

func TestApplyDeviceTokenAddsHeaderAndQueryFallback(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "http://192.0.2.10/hello?keep=1", nil)

	applyDeviceToken(req, "pair-token")

	if got := req.Header.Get("X-VibeTV-Token"); got != "pair-token" {
		t.Fatalf("expected pairing header, got %q", got)
	}
	if got := req.URL.Query().Get("token"); got != "pair-token" {
		t.Fatalf("expected pairing query fallback, got %q", got)
	}
	if got := req.URL.Query().Get("keep"); got != "1" {
		t.Fatalf("expected existing query to survive, got %q", got)
	}
}

func TestDeviceSearchReturnsAllDevicesWithoutMutatingConfig(t *testing.T) {
	device := func(id, mode, firmware string) *httptest.Server {
		return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path != "/hello" {
				t.Fatalf("unexpected path %s", r.URL.Path)
			}
			if got := r.Header.Get("X-VibeTV-Token"); got != "" {
				t.Fatalf("search must be tokenless, got %q", got)
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = fmt.Fprintf(w, `{"kind":"hello","protocolVersion":2,"board":"esp8266-smalltv-st7789","firmware":%q,"deviceId":%q,"networkMode":%q,"capabilities":{"transport":{"active":"wifi"}}}`, firmware, id, mode)
		}))
	}
	known := device("esp8266-123abc", "station", "1.0.36")
	defer known.Close()
	knownAlias := device("esp8266-123abc", "station", "1.0.36")
	defer knownAlias.Close()
	knownAlternative := device("esp8266-456abc", "station", "1.0.34")
	defer knownAlternative.Close()
	unknown := device("esp8266-789abc", "station", "1.0.35")
	defer unknown.Close()
	setupDevice := device("esp8266-456def", "setup", "1.0.36")
	defer setupDevice.Close()

	initial := runtimeconfig.Config{
		DeviceTarget: "http://192.0.2.1",
		DeviceToken:  "secret",
		DeviceID:     "esp8266-123abc",
		KnownDevices: []runtimeconfig.KnownDevice{{
			DeviceID:    "esp8266-456abc",
			Target:      "http://192.0.2.2",
			DeviceToken: "alternative-secret",
		}},
	}
	initial.Normalize()
	server := newTestServer(t, initial)
	server.subnetTargets = func() []string {
		return []string{unknown.URL, knownAlias.URL, known.URL, knownAlternative.URL, setupDevice.URL}
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/device/search", strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json")
	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	var got struct {
		OK      bool                `json:"ok"`
		Devices []deviceSearchEntry `json:"devices"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if !got.OK || len(got.Devices) != 3 {
		t.Fatalf("unexpected search response: %+v", got)
	}
	if !got.Devices[0].Known || !got.Devices[0].Active || got.Devices[0].DeviceID != "esp8266-123abc" || got.Devices[0].NetworkMode != "station" || got.Devices[0].Board != "esp8266-smalltv-st7789" || got.Devices[0].Firmware != "1.0.36" || got.Devices[0].Target == "" {
		t.Fatalf("known device must sort first: %+v", got.Devices)
	}
	if !got.Devices[1].Known || got.Devices[1].Active || got.Devices[1].DeviceID != "esp8266-456abc" || got.Devices[1].Firmware != "1.0.34" {
		t.Fatalf("known alternative must be marked without becoming active: %+v", got.Devices)
	}
	if got.Devices[2].Known || got.Devices[2].Active || got.Devices[2].DeviceID != "esp8266-789abc" || got.Devices[2].Firmware != "1.0.35" {
		t.Fatalf("unknown station device must remain selectable after known device: %+v", got.Devices)
	}
	cfg, err := server.config()
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(cfg, initial) {
		t.Fatalf("search mutated config: got=%+v want=%+v", cfg, initial)
	}
}

func TestDeviceSearchRetriesTransientKnownDeviceFailure(t *testing.T) {
	var helloCalls atomic.Int32
	device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if helloCalls.Add(1) == 1 {
			http.Error(w, "busy", http.StatusServiceUnavailable)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"board":"esp8266-smalltv-st7789","firmware":"1.0.36","deviceId":"esp8266-retry","networkMode":"station","capabilities":{"transport":{"active":"wifi"}}}`))
	}))
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{
		DeviceTarget: device.URL,
		DeviceID:     "esp8266-retry",
	})
	server.subnetTargets = func() []string { return nil }

	devices, err := server.searchDevices(context.Background(), runtimeconfig.Config{
		DeviceTarget: device.URL,
		DeviceID:     "esp8266-retry",
	}, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(devices) != 1 || !devices[0].Known || devices[0].DeviceID != "esp8266-retry" {
		t.Fatalf("expected transiently busy known VibeTV on retry, got %+v", devices)
	}
	if helloCalls.Load() != 2 {
		t.Fatalf("expected exactly one bounded retry, got %d hello calls", helloCalls.Load())
	}
}

func TestDeviceSearchExplicitTargetOnlyProbesThatAddress(t *testing.T) {
	var explicitHelloCalls atomic.Int32
	explicit := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		explicitHelloCalls.Add(1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"board":"esp8266-smalltv-st7789","firmware":"1.0.37","deviceId":"manual-device","networkMode":"station","capabilities":{"transport":{"active":"wifi"}}}`))
	}))
	defer explicit.Close()

	server := newTestServer(t, runtimeconfig.Config{
		DeviceTarget: "http://192.0.2.10",
		DeviceID:     "remembered-device",
	})
	server.defaultWiFiTarget = func() string {
		t.Fatal("manual target validation must not probe the default target")
		return ""
	}
	server.subnetTargets = func() []string {
		t.Fatal("manual target validation must not scan the subnet")
		return nil
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(
		http.MethodPost,
		"/v1/device/search",
		strings.NewReader(`{"target":`+strconv.Quote(explicit.URL)+`}`),
	)
	req.Header.Set("Content-Type", "application/json")
	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	var got struct {
		Devices []deviceSearchEntry `json:"devices"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if len(got.Devices) != 1 || got.Devices[0].Target != explicit.URL || got.Devices[0].DeviceID != "manual-device" {
		t.Fatalf("unexpected targeted search response: %+v", got.Devices)
	}
	if explicitHelloCalls.Load() != 1 {
		t.Fatalf("manual target must receive one bounded hello probe, got %d", explicitHelloCalls.Load())
	}
}

func TestDeviceSearchRejectsInvalidExplicitTargetWithoutSubnetScan(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	server.subnetTargets = func() []string {
		t.Fatal("invalid manual target must not scan the subnet")
		return nil
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(
		http.MethodPost,
		"/v1/device/search",
		strings.NewReader(`{"target":"http://192.0.2.10/hello"}`),
	)
	req.Header.Set("Content-Type", "application/json")
	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	var got errorResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Error.Code != "invalid_device_target" {
		t.Fatalf("unexpected invalid target response: %+v", got)
	}
}

func TestDeviceSearchReportsDeniedLocalNetworkAccess(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	server.defaultWiFiTarget = func() string { return "" }
	server.subnetTargets = func() []string { return []string{"http://192.168.1.20"} }
	server.client.Transport = roundTripFunc(func(*http.Request) (*http.Response, error) {
		return nil, syscall.EACCES
	})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/device/search", strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json")
	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	var got errorResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Error.Code != "local_network_access_denied" ||
		!strings.Contains(got.Error.NextAction, "Privacy & Security > Local Network") {
		t.Fatalf("unexpected local-network recovery: %+v", got)
	}
}

func TestLocalNetworkPermissionDenialRecognizesFastDarwinHostUnreachableFailures(t *testing.T) {
	wrapped := fmt.Errorf("connect: %w", syscall.EHOSTUNREACH)
	if !possibleLocalNetworkPermissionError(wrapped, "darwin", 10*time.Millisecond) {
		t.Fatal("Darwin EHOSTUNREACH must be treated as a possible local-network denial")
	}
	if possibleLocalNetworkPermissionError(wrapped, "linux", 10*time.Millisecond) {
		t.Fatal("EHOSTUNREACH must not be treated as a permission signal outside Darwin")
	}
	if !localNetworkPermissionDeniedByProbeErrors(
		localNetworkDenialMinimumSamples,
		localNetworkDenialMinimumSamples,
	) {
		t.Fatal("a complete burst of immediate Darwin failures must report denied access")
	}
	if localNetworkPermissionDeniedByProbeErrors(1, 1) {
		t.Fatal("one unreachable device is not proof of denied local-network access")
	}
	if possibleLocalNetworkPermissionError(
		wrapped,
		"darwin",
		localNetworkDenialProbeMaxElapsed+time.Millisecond,
	) {
		t.Fatal("slow unreachable hosts are not proof of denied local-network access")
	}
}

func TestDeviceSearchReportsFastDarwinHostUnreachableBurstAsDeniedAccess(t *testing.T) {
	oldGOOS := localNetworkPermissionGOOS
	localNetworkPermissionGOOS = "darwin"
	t.Cleanup(func() { localNetworkPermissionGOOS = oldGOOS })

	server := newTestServer(t, runtimeconfig.Config{})
	server.defaultWiFiTarget = func() string { return "" }
	targets := make([]string, 0, localNetworkDenialMinimumSamples)
	for host := 1; host <= localNetworkDenialMinimumSamples; host++ {
		targets = append(targets, fmt.Sprintf("http://192.168.50.%d", host))
	}
	server.subnetTargets = func() []string { return targets }
	server.client.Transport = roundTripFunc(func(*http.Request) (*http.Response, error) {
		return nil, syscall.EHOSTUNREACH
	})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/device/search", strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json")
	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	var got errorResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Error.Code != "local_network_access_denied" {
		t.Fatalf("unexpected local-network error: %+v", got)
	}
}

func TestDeviceSearchReturnsFirstFoundDeviceImmediatelyWithoutSavedIdentity(t *testing.T) {
	var helloCalls atomic.Int32
	device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		helloCalls.Add(1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"board":"esp8266-smalltv-st7789","firmware":"1.0.37","deviceId":"first-customer-device","networkMode":"station","capabilities":{"transport":{"active":"wifi"}}}`))
	}))
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{})
	server.subnetTargets = func() []string { return []string{device.URL} }

	devices, err := server.searchDevices(context.Background(), runtimeconfig.Config{}, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(devices) != 1 || devices[0].DeviceID != "first-customer-device" {
		t.Fatalf("expected first customer VibeTV, got %+v", devices)
	}
	if helloCalls.Load() != 1 {
		t.Fatalf("expected first successful scan to return immediately, got %d hello calls", helloCalls.Load())
	}
}

func TestDeviceSearchRetriesCleanCustomerScanUntilDeviceAppears(t *testing.T) {
	var helloCalls atomic.Int32
	device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if helloCalls.Add(1) == 1 {
			http.Error(w, "wifi still settling", http.StatusServiceUnavailable)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"board":"esp8266-smalltv-st7789","firmware":"1.0.37","deviceId":"late-customer-device","networkMode":"station","capabilities":{"transport":{"active":"wifi"}}}`))
	}))
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{})
	server.subnetTargets = func() []string { return []string{device.URL} }

	devices, err := server.searchDevices(context.Background(), runtimeconfig.Config{}, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(devices) != 1 || devices[0].DeviceID != "late-customer-device" {
		t.Fatalf("expected later customer scan to find VibeTV, got %+v", devices)
	}
	if helloCalls.Load() != 2 {
		t.Fatalf("expected a second complete scan, got %d hello calls", helloCalls.Load())
	}
}

func TestDeviceSearchProbesEveryRememberedVibeTV(t *testing.T) {
	device := func(id string) *httptest.Server {
		return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_, _ = fmt.Fprintf(w, `{"kind":"hello","protocolVersion":2,"board":"esp8266-smalltv-st7789","firmware":"1.0.37","deviceId":%q,"networkMode":"station","capabilities":{"transport":{"active":"wifi"}}}`, id)
		}))
	}
	first := device("active-device")
	defer first.Close()
	second := device("other-device")
	defer second.Close()

	cfg := runtimeconfig.Config{
		DeviceID:     "active-device",
		DeviceTarget: first.URL,
		KnownDevices: []runtimeconfig.KnownDevice{
			{DeviceID: "active-device", Target: first.URL},
			{DeviceID: "other-device", Target: second.URL},
		},
	}
	server := newTestServer(t, cfg)
	server.subnetTargets = func() []string { return nil }

	devices, err := server.searchDevices(context.Background(), cfg, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(devices) != 2 {
		t.Fatalf("expected every remembered VibeTV to be probed, got %+v", devices)
	}
}

func TestDeviceSearchActuallyWaitsThirtySecondsWhenNothingIsFound(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	server.subnetTargets = func() []string { return nil }
	server.defaultWiFiTarget = func() string { return "" }

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/device/search", strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json")
	started := time.Now()
	server.Handler().ServeHTTP(rec, req)
	elapsed := time.Since(started)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	var got struct {
		Devices []deviceSearchEntry `json:"devices"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if len(got.Devices) != 0 {
		t.Fatalf("expected no VibeTV, got %+v", got.Devices)
	}
	if elapsed < 29*time.Second || elapsed > 35*time.Second {
		t.Fatalf("empty customer search took %s; want approximately 30s", elapsed)
	}
}

func TestLocalSubnetTargetsUseConfiguredNetworkMask(t *testing.T) {
	_, network, err := net.ParseCIDR("192.168.10.42/23")
	if err != nil {
		t.Fatal(err)
	}
	network.IP = net.ParseIP("192.168.10.42")
	targets := localSubnetTargetsFromAddrs([]net.Addr{network})
	seen := make(map[string]bool, len(targets))
	for _, target := range targets {
		seen[target] = true
	}
	if !seen["http://192.168.11.20"] {
		t.Fatal("/23 scan did not include the adjacent /24")
	}
	for _, excluded := range []string{
		"http://192.168.10.0",
		"http://192.168.10.42",
		"http://192.168.11.255",
	} {
		if seen[excluded] {
			t.Fatalf("scan included excluded address %s", excluded)
		}
	}
}

func TestLocalSubnetTargetsCapPrivateSlash16AtScannableSlash23(t *testing.T) {
	_, network, err := net.ParseCIDR("10.42.200.42/16")
	if err != nil {
		t.Fatal(err)
	}
	network.IP = net.ParseIP("10.42.200.42")
	targets := localSubnetTargetsFromAddrs([]net.Addr{network})
	seen := make(map[string]bool, len(targets))
	for _, target := range targets {
		seen[target] = true
	}
	if !seen["http://10.42.201.20"] {
		t.Fatal("large-subnet scan did not include the adjacent /24")
	}
	for _, outsidePracticalScan := range []string{
		"http://10.42.1.20",
		"http://10.42.250.20",
	} {
		if seen[outsidePracticalScan] {
			t.Fatalf("large-subnet scan claimed an unscannable target %s", outsidePracticalScan)
		}
	}
	if len(targets) != 509 {
		t.Fatalf("large-subnet scan targets=%d want=509 scannable peers", len(targets))
	}
}

func TestDeviceSearchActuallyProbesFarEdgeOfSlash23(t *testing.T) {
	_, network, err := net.ParseCIDR("192.168.10.42/23")
	if err != nil {
		t.Fatal(err)
	}
	network.IP = net.ParseIP("192.168.10.42")
	targets := localSubnetTargetsFromAddrs([]net.Addr{network})
	const deviceHost = "192.168.11.254"
	var attempts atomic.Int32

	server := newTestServer(t, runtimeconfig.Config{})
	server.defaultWiFiTarget = func() string { return "" }
	server.subnetTargets = func() []string { return targets }
	server.client.Transport = roundTripFunc(func(req *http.Request) (*http.Response, error) {
		attempts.Add(1)
		if req.URL.Hostname() != deviceHost {
			return nil, errors.New("offline")
		}
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     make(http.Header),
			Body: io.NopCloser(strings.NewReader(
				`{"kind":"hello","protocolVersion":2,"board":"esp8266-smalltv-st7789","firmware":"1.0.37","deviceId":"far-edge-device","networkMode":"station","capabilities":{"transport":{"active":"wifi"}}}`,
			)),
			Request: req,
		}, nil
	})

	devices, err := server.searchDevices(context.Background(), runtimeconfig.Config{}, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(devices) != 1 || devices[0].DeviceID != "far-edge-device" {
		t.Fatalf("expected far-edge /23 VibeTV, got %+v", devices)
	}
	if got, want := int(attempts.Load()), len(targets); got != want {
		t.Fatalf("search attempted %d targets; want every one of %d", got, want)
	}
}

func TestDeviceSearchWaitsForSlowStartingWiFiDevice(t *testing.T) {
	device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/hello" {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		time.Sleep(800 * time.Millisecond)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"board":"esp8266-smalltv-st7789","firmware":"1.0.37","deviceId":"slow-starting-device","networkMode":"station","capabilities":{"transport":{"active":"wifi"}}}`))
	}))
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{})
	server.subnetTargets = func() []string { return []string{device.URL} }

	devices, err := server.searchDevices(context.Background(), runtimeconfig.Config{}, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(devices) != 1 || devices[0].DeviceID != "slow-starting-device" {
		t.Fatalf("expected slow-starting customer VibeTV, got %+v", devices)
	}
}

func TestDeviceSelectCommitsBeforeFirstFrame(t *testing.T) {
	const deviceID = "customer-device"
	device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hello":
			w.Header().Set("Content-Type", "application/json")
			_, _ = fmt.Fprintf(w, `{"kind":"hello","protocolVersion":2,"board":"esp8266-smalltv-st7789","firmware":"1.0.37","deviceId":%q,"networkMode":"station","capabilities":{"transport":{"active":"wifi"}}}`, deviceID)
		case "/api/pair":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true,"token":"customer-token"}`))
		case "/health":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true,"render":{"fullCount":1,"partialCount":0,"lastKind":"usage"}}`))
		default:
			t.Fatalf("unexpected device path %s", r.URL.Path)
		}
	}))
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{})
	streamStarted := make(chan string, 1)
	server.refreshStream = func(_ context.Context, target string) error {
		streamStarted <- target
		return nil
	}

	selected, err := server.selectDevice(context.Background(), device.URL, deviceID)
	if err != nil {
		t.Fatalf("select device: %v", err)
	}
	if !selected.Connected || !selected.Paired || selected.Ready || !selected.Active || selected.DeviceID != deviceID {
		t.Fatalf("unexpected selected device: %+v", selected)
	}
	select {
	case streamTarget := <-streamStarted:
		if streamTarget != device.URL {
			t.Fatalf("display stream target=%q want %q", streamTarget, device.URL)
		}
	case <-time.After(time.Second):
		t.Fatal("display stream was not started after the connection was committed")
	}
}

func TestPairingStreamErrorClearsPairedState(t *testing.T) {
	got := withDisplayStreamInfo(
		deviceInfo{Connected: true, Paired: true},
		displayStreamInfo{ErrorCode: "device_pairing_required"},
	)
	if got.Paired || got.Ready {
		t.Fatalf("pairing rejection must clear pairing readiness: %+v", got)
	}
}

func TestValidateRepairIdentityRejectsSetupAndBackgroundMismatch(t *testing.T) {
	cfg := runtimeconfig.Config{DeviceID: "esp8266-123abc"}
	if err := validateRepairIdentity(cfg, protocol.DeviceHello{DeviceID: "esp8266-123abc", NetworkMode: "setup"}, false, ""); err == nil {
		t.Fatal("expected setup device rejection")
	}
	if err := validateRepairIdentity(cfg, protocol.DeviceHello{DeviceID: "esp8266-456def", NetworkMode: "station"}, false, ""); err == nil {
		t.Fatal("expected background identity mismatch rejection")
	}
	if err := validateRepairIdentity(cfg, protocol.DeviceHello{DeviceID: "esp8266-456def", NetworkMode: "station"}, true, ""); err != nil {
		t.Fatalf("explicit user selection should permit replacing saved device: %v", err)
	}
	if err := validateRepairIdentity(cfg, protocol.DeviceHello{DeviceID: "esp8266-456def", NetworkMode: "station"}, true, "esp8266-123abc"); err == nil {
		t.Fatal("selected device identity must stay pinned through pairing")
	}
}

func TestDeviceIdentityMatchRequiresStableDeviceID(t *testing.T) {
	cfg := runtimeconfig.Config{DeviceTarget: "http://192.168.178.72"}
	hello := protocol.DeviceHello{DeviceID: "esp8266-123abc", NetworkMode: "station"}
	if deviceIdentityMatches(cfg, hello) {
		t.Fatal("a legacy target must not activate a device without stable identity")
	}
	cfg.DeviceID = "ESP8266-123ABC"
	if !deviceIdentityMatches(cfg, hello) {
		t.Fatal("stable device identity must remain known after its IP changes")
	}
}

func TestDeviceRepairRejectsIdentitySwapBetweenSearchAndPair(t *testing.T) {
	var pairCalls atomic.Int32
	device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hello":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"board":"esp8266-smalltv-st7789","firmware":"1.0.36","deviceId":"replacement-device","networkMode":"station","capabilities":{"transport":{"active":"wifi"}}}`))
		case "/api/pair":
			pairCalls.Add(1)
			_, _ = w.Write([]byte(`{"ok":true,"token":"must-not-be-issued"}`))
		default:
			t.Fatalf("unexpected device path %s", r.URL.Path)
		}
	}))
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(
		http.MethodPost,
		"/v1/device/repair",
		strings.NewReader(`{"target":"`+device.URL+`","expectedDeviceId":"selected-device"}`),
	)
	req.Header.Set("Content-Type", "application/json")
	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusConflict {
		t.Fatalf("identity swap status=%d body=%s", rec.Code, rec.Body.String())
	}
	var got errorResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode identity swap response: %v", err)
	}
	if got.OK || got.Error.Code != "device_identity_changed" ||
		got.Error.Message != "That address answered as a different VibeTV." ||
		got.Error.NextAction != "Check the IP on the VibeTV screen, then try again." {
		t.Fatalf("unexpected identity swap response: %+v", got)
	}
	if pairCalls.Load() != 0 {
		t.Fatalf("identity swap triggered %d pairing writes", pairCalls.Load())
	}
	cfg, err := server.config()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.DeviceTarget != "" || cfg.DeviceToken != "" || cfg.DeviceID != "" {
		t.Fatalf("identity swap mutated config: %+v", cfg)
	}
}

func TestDeviceSelectRejectsIdentitySwapBeforePairing(t *testing.T) {
	var pairCalls atomic.Int32
	device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hello":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"board":"esp8266-smalltv-st7789","firmware":"1.0.36","deviceId":"replacement-device","networkMode":"station","capabilities":{"transport":{"active":"wifi"}}}`))
		case "/api/pair":
			pairCalls.Add(1)
			_, _ = w.Write([]byte(`{"ok":true,"token":"must-not-be-issued"}`))
		default:
			t.Fatalf("unexpected device path %s", r.URL.Path)
		}
	}))
	defer device.Close()

	initial := runtimeconfig.Config{DeviceID: "device-a", DeviceTarget: "http://192.0.2.1", DeviceToken: "token-a"}
	initial.Normalize()
	server := newTestServer(t, initial)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(
		http.MethodPost,
		"/v1/device/select",
		strings.NewReader(`{"target":"`+device.URL+`","expectedDeviceId":"selected-device"}`),
	)
	req.Header.Set("Content-Type", "application/json")
	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusConflict {
		t.Fatalf("identity swap status=%d body=%s", rec.Code, rec.Body.String())
	}
	var got errorResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode identity swap response: %v", err)
	}
	if got.OK || got.Error.Code != "device_identity_changed" ||
		got.Error.Message != "That address answered as a different VibeTV." ||
		got.Error.NextAction != "Check the IP on the VibeTV screen, then try again." {
		t.Fatalf("unexpected identity swap response: %+v", got)
	}
	if pairCalls.Load() != 0 {
		t.Fatalf("identity swap triggered %d pairing writes", pairCalls.Load())
	}
	cfg, err := server.config()
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(cfg, initial) {
		t.Fatalf("identity swap mutated config: got=%+v want=%+v", cfg, initial)
	}
}

func TestDeviceSelectMapsLockedFirmware1038ToLegacyRecovery(t *testing.T) {
	const deviceID = "legacy-device"
	var pairCalls atomic.Int32
	device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hello":
			w.Header().Set("Content-Type", "application/json")
			_, _ = fmt.Fprintf(w, `{"kind":"hello","protocolVersion":2,"board":"esp8266-smalltv-st7789","firmware":"1.0.38","deviceId":%q,"networkMode":"station","capabilities":{"transport":{"active":"wifi"}}}`, deviceID)
		case "/api/pair":
			pairCalls.Add(1)
			http.Error(w, "pairing window closed", http.StatusForbidden)
		default:
			t.Fatalf("unexpected device path %s", r.URL.Path)
		}
	}))
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(
		http.MethodPost,
		"/v1/device/select",
		strings.NewReader(`{"target":"`+device.URL+`","expectedDeviceId":"`+deviceID+`"}`),
	)
	req.Header.Set("Content-Type", "application/json")
	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusConflict ||
		!strings.Contains(rec.Body.String(), `"legacy_pairing_recovery_required"`) {
		t.Fatalf("expected legacy recovery response, got %d body=%s", rec.Code, rec.Body.String())
	}
	if pairCalls.Load() != 1 {
		t.Fatalf("locked legacy device received %d pair attempts, want 1", pairCalls.Load())
	}
	cfg, err := server.config()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.DeviceID != "" || cfg.DeviceTarget != "" || cfg.DeviceToken != "" {
		t.Fatalf("failed legacy Connect mutated config: %+v", cfg)
	}
}

func TestDeviceSelectRotatesKnownTokenAndKeepsProfiles(t *testing.T) {
	const deviceID = "device-b"
	const savedToken = "token-b"
	var pairCalls atomic.Int32
	device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hello":
			if token := strings.TrimSpace(r.Header.Get("X-VibeTV-Token")); token != "" && token != savedToken {
				http.Error(w, "invalid token", http.StatusUnauthorized)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = fmt.Fprintf(w, `{"kind":"hello","protocolVersion":2,"board":"esp8266-smalltv-st7789","firmware":"1.0.36","deviceId":%q,"networkMode":"station","capabilities":{"transport":{"active":"wifi"}}}`, deviceID)
		case "/api/pair":
			pairCalls.Add(1)
			_, _ = w.Write([]byte(`{"ok":true,"token":"rotated-token"}`))
		case "/health":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true,"display":{"activeTheme":"mini"},"settings":{"display":{"brightnessPercent":40}}}`))
		default:
			t.Fatalf("unexpected device path %s", r.URL.Path)
		}
	}))
	defer device.Close()

	initial := runtimeconfig.Config{
		DeviceID:     "device-a",
		DeviceTarget: "http://192.0.2.1",
		DeviceToken:  "token-a",
		KnownDevices: []runtimeconfig.KnownDevice{{DeviceID: deviceID, Target: "http://192.0.2.2", DeviceToken: savedToken}},
	}
	initial.Normalize()
	server := newTestServer(t, initial)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(
		http.MethodPost,
		"/v1/device/select",
		strings.NewReader(`{"target":"`+device.URL+`","expectedDeviceId":"`+deviceID+`"}`),
	)
	req.Header.Set("Content-Type", "application/json")
	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected successful selection, got %d body=%s", rec.Code, rec.Body.String())
	}
	if pairCalls.Load() != 1 {
		t.Fatalf("explicit Connect must rotate the token once, got %d pair calls", pairCalls.Load())
	}
	if strings.Contains(rec.Body.String(), savedToken) {
		t.Fatalf("selection response leaked token: %s", rec.Body.String())
	}
	cfg, err := server.config()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.DeviceID != deviceID || cfg.DeviceTarget != device.URL || cfg.DeviceToken != "rotated-token" {
		t.Fatalf("unexpected active selection: %+v", cfg)
	}
	if len(cfg.KnownDevices) != 2 {
		t.Fatalf("expected both device profiles to remain known: %+v", cfg.KnownDevices)
	}
}

func TestDeviceSelectRenewsStaleKnownToken(t *testing.T) {
	const deviceID = "device-b"
	var pairCalls atomic.Int32
	device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := strings.TrimSpace(r.Header.Get("X-VibeTV-Token"))
		switch r.URL.Path {
		case "/hello":
			if token == "stale-token" {
				http.Error(w, "expired token", http.StatusForbidden)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = fmt.Fprintf(w, `{"kind":"hello","protocolVersion":2,"board":"esp8266-smalltv-st7789","firmware":"1.0.36","deviceId":%q,"networkMode":"station","capabilities":{"transport":{"active":"wifi"}}}`, deviceID)
		case "/api/pair":
			pairCalls.Add(1)
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true,"token":"renewed-token"}`))
		case "/health":
			if token != "renewed-token" {
				http.Error(w, "pairing required", http.StatusUnauthorized)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true,"display":{"activeTheme":"mini"},"settings":{"display":{"brightnessPercent":40}}}`))
		default:
			t.Fatalf("unexpected device path %s", r.URL.Path)
		}
	}))
	defer device.Close()

	initial := runtimeconfig.Config{
		DeviceID:     "device-a",
		DeviceTarget: "http://192.0.2.1",
		DeviceToken:  "token-a",
		KnownDevices: []runtimeconfig.KnownDevice{{DeviceID: deviceID, Target: "http://192.0.2.2", DeviceToken: "stale-token"}},
	}
	server := newTestServer(t, initial)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(
		http.MethodPost,
		"/v1/device/select",
		strings.NewReader(`{"target":"`+device.URL+`","expectedDeviceId":"`+deviceID+`"}`),
	)
	req.Header.Set("Content-Type", "application/json")
	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected stale token recovery, got %d body=%s", rec.Code, rec.Body.String())
	}
	if pairCalls.Load() != 1 {
		t.Fatalf("expected exactly one safe token renewal, got %d", pairCalls.Load())
	}
	cfg, err := server.config()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.DeviceID != deviceID || cfg.DeviceToken != "renewed-token" {
		t.Fatalf("expected renewed active profile, got %+v", cfg)
	}
	known, ok := cfg.KnownDevice(deviceID)
	if !ok || known.DeviceToken != "renewed-token" {
		t.Fatalf("expected renewed token in known profile, got %+v", cfg.KnownDevices)
	}
}

func TestDeviceSelectPairFailureKeepsKnownToken(t *testing.T) {
	const deviceID = "device-b"
	var pairCalls atomic.Int32
	device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hello":
			_, _ = fmt.Fprintf(w, `{"kind":"hello","protocolVersion":2,"board":"esp8266-smalltv-st7789","deviceId":%q,"networkMode":"station","capabilities":{"transport":{"active":"wifi"}}}`, deviceID)
		case "/api/pair":
			pairCalls.Add(1)
			http.Error(w, "pairing failed", http.StatusBadGateway)
		default:
			t.Fatalf("unexpected device path %s", r.URL.Path)
		}
	}))
	defer device.Close()

	initial := runtimeconfig.Config{
		DeviceID:     "device-a",
		DeviceTarget: "http://192.0.2.1",
		DeviceToken:  "token-a",
		KnownDevices: []runtimeconfig.KnownDevice{{DeviceID: deviceID, Target: device.URL, DeviceToken: "saved-token"}},
	}
	initial.Normalize()
	server := newTestServer(t, initial)
	if _, err := server.selectDevice(context.Background(), device.URL, deviceID); err == nil {
		t.Fatal("expected pairing failure")
	}
	cfg, err := server.config()
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(cfg, initial) || pairCalls.Load() != 3 {
		t.Fatalf("pair failure changed selection state: cfg=%+v pairCalls=%d", cfg, pairCalls.Load())
	}
}

func TestDeviceSelectKeepsNewConnectionWhenStreamStartFails(t *testing.T) {
	const deviceID = "device-b"
	device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hello":
			w.Header().Set("Content-Type", "application/json")
			_, _ = fmt.Fprintf(w, `{"kind":"hello","protocolVersion":2,"board":"esp8266-smalltv-st7789","firmware":"1.0.36","deviceId":%q,"networkMode":"station","capabilities":{"transport":{"active":"wifi"}}}`, deviceID)
		case "/api/pair":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true,"token":"token-b"}`))
		case "/health":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true,"display":{"activeTheme":"mini"},"settings":{"display":{"brightnessPercent":40}}}`))
		default:
			t.Fatalf("unexpected device path %s", r.URL.Path)
		}
	}))
	defer device.Close()

	initial := runtimeconfig.Config{DeviceID: "device-a", DeviceTarget: "http://192.0.2.1", DeviceToken: "token-a"}
	initial.Normalize()
	server := newTestServer(t, initial)
	streamAttempted := make(chan struct{}, 1)
	server.refreshStream = func(_ context.Context, target string) error {
		if target == device.URL {
			streamAttempted <- struct{}{}
			return errors.New("selected display stream failed")
		}
		return nil
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(
		http.MethodPost,
		"/v1/device/select",
		strings.NewReader(`{"target":"`+device.URL+`","expectedDeviceId":"`+deviceID+`"}`),
	)
	req.Header.Set("Content-Type", "application/json")
	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("successful pairing was rolled back by stream start: %d %s", rec.Code, rec.Body.String())
	}
	cfg, err := server.config()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.DeviceID != deviceID || cfg.DeviceTarget != device.URL || cfg.DeviceToken != "token-b" {
		t.Fatalf("successful connection was not persisted: got=%+v", cfg)
	}
	known, ok := cfg.KnownDevice(deviceID)
	if !ok || known.Target != device.URL || known.DeviceToken != "token-b" {
		t.Fatalf("successful selection lost the issued pairing token: %+v", cfg.KnownDevices)
	}
	select {
	case <-streamAttempted:
	case <-time.After(time.Second):
		t.Fatal("display stream restart was not attempted")
	}
}

func TestDeviceSelectMakesConnectionVisibleBeforeStreamIsReady(t *testing.T) {
	const deviceID = "device-b"
	device := newSelectableDeviceServer(t, deviceID)
	defer device.Close()

	initial := runtimeconfig.Config{DeviceID: "device-a", DeviceTarget: "http://192.0.2.1", DeviceToken: "token-a"}
	initial.Normalize()
	server := newTestServer(t, initial)
	streamStarted := make(chan struct{})
	releaseStream := make(chan struct{})
	server.refreshStream = func(_ context.Context, target string) error {
		if target == device.URL {
			close(streamStarted)
			<-releaseStream
		}
		return nil
	}

	done := make(chan error, 1)
	go func() {
		_, err := server.selectDevice(context.Background(), device.URL, deviceID)
		done <- err
	}()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("selection failed: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("selection waited for the display stream")
	}
	select {
	case <-streamStarted:
	case <-time.After(2 * time.Second):
		t.Fatal("candidate display stream did not start")
	}
	visible, err := server.config()
	if err != nil {
		t.Fatal(err)
	}
	if visible.DeviceID != deviceID || visible.DeviceTarget != device.URL {
		t.Fatalf("connected candidate was not externally visible: %+v", visible)
	}
	close(releaseStream)
	committed, err := server.config()
	if err != nil {
		t.Fatal(err)
	}
	if committed.DeviceID != deviceID || committed.DeviceTarget != device.URL {
		t.Fatalf("ready candidate was not committed: %+v", committed)
	}
}

func TestDeviceSelectDoesNotWaitForPreviousDisplayStream(t *testing.T) {
	deviceB := newSelectableDeviceServer(t, "device-b")
	defer deviceB.Close()
	deviceC := newSelectableDeviceServer(t, "device-c")
	defer deviceC.Close()

	initial := runtimeconfig.Config{DeviceID: "device-a", DeviceTarget: "http://192.0.2.1", DeviceToken: "token-a"}
	initial.Normalize()
	server := newTestServer(t, initial)
	firstStarted := make(chan struct{})
	releaseFirst := make(chan struct{})
	secondStarted := make(chan struct{})
	server.refreshStream = func(_ context.Context, target string) error {
		switch target {
		case deviceB.URL:
			close(firstStarted)
			<-releaseFirst
		case deviceC.URL:
			close(secondStarted)
		}
		return nil
	}

	firstDone := make(chan error, 1)
	go func() {
		_, err := server.selectDevice(context.Background(), deviceB.URL, "device-b")
		firstDone <- err
	}()
	select {
	case <-firstStarted:
	case <-time.After(2 * time.Second):
		t.Fatal("first selection did not start")
	}
	secondDone := make(chan error, 1)
	go func() {
		_, err := server.selectDevice(context.Background(), deviceC.URL, "device-c")
		secondDone <- err
	}()
	select {
	case <-secondStarted:
	case <-time.After(time.Second):
		t.Fatal("second selection waited for the previous display stream")
	}
	close(releaseFirst)
	if err := <-firstDone; err != nil {
		t.Fatalf("first selection failed: %v", err)
	}
	if err := <-secondDone; err != nil {
		t.Fatalf("second selection failed: %v", err)
	}
	committed, err := server.config()
	if err != nil {
		t.Fatal(err)
	}
	if committed.DeviceID != "device-c" || committed.DeviceTarget != deviceC.URL {
		t.Fatalf("unexpected final selection: %+v", committed)
	}
}

func newSelectableDeviceServer(t *testing.T, deviceID string) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hello":
			w.Header().Set("Content-Type", "application/json")
			_, _ = fmt.Fprintf(w, `{"kind":"hello","protocolVersion":2,"board":"esp8266-smalltv-st7789","firmware":"1.0.37","deviceId":%q,"networkMode":"station","capabilities":{"transport":{"active":"wifi"}}}`, deviceID)
		case "/api/pair":
			w.Header().Set("Content-Type", "application/json")
			_, _ = fmt.Fprintf(w, `{"ok":true,"token":%q}`, "token-"+deviceID)
		case "/health":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true,"display":{"activeTheme":"mini"},"settings":{"display":{"brightnessPercent":40}}}`))
		default:
			t.Fatalf("unexpected device path %s", r.URL.Path)
		}
	}))
}

func TestStatusReportsThemeInstallDisableFlag(t *testing.T) {
	t.Setenv(themeInstallDisableEnv, "1")
	server := newTestServer(t, runtimeconfig.Config{})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/status", nil)

	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got statusResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.Companion.Features.ThemeInstallEnabled {
		t.Fatalf("expected theme install disable flag to be honored")
	}
}

func TestDMGRuntimeDisablesLegacyMacAppSelfUpdate(t *testing.T) {
	t.Setenv(macAppUpdateDisableEnv, "1")
	server := newTestServer(t, runtimeconfig.Config{})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/status", nil)
	server.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got statusResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.Companion.Features.MacAppSelfUpdateEnabled {
		t.Fatalf("expected DMG runtime to disable legacy Mac App self-update")
	}
	if got.Companion.InstallationMode != "dmg" {
		t.Fatalf("expected DMG runtime installation mode, got %q", got.Companion.InstallationMode)
	}

	for _, endpoint := range []struct {
		method string
		path   string
	}{
		{method: http.MethodPost, path: "/v1/mac-app/update"},
		{method: http.MethodGet, path: "/v1/mac-app/update/status?jobId=legacy"},
	} {
		rec = httptest.NewRecorder()
		req = httptest.NewRequest(endpoint.method, endpoint.path, strings.NewReader(`{"version":"1.0.41"}`))
		server.Handler().ServeHTTP(rec, req)
		if rec.Code != http.StatusNotFound {
			t.Fatalf("expected %s to be unavailable, got %d body=%s", endpoint.path, rec.Code, rec.Body.String())
		}
	}
}

func TestLegacyRuntimeReportsLegacyInstallationMode(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/status", nil)
	server.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got statusResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.Companion.Features.MacAppSelfUpdateEnabled {
		t.Fatalf("expected the bridge binary to disable further legacy self-updates")
	}
	if got.Companion.InstallationMode != "legacy" {
		t.Fatalf("expected legacy runtime installation mode, got %q", got.Companion.InstallationMode)
	}

	for _, endpoint := range []struct {
		method string
		path   string
	}{
		{method: http.MethodPost, path: "/v1/mac-app/update"},
		{method: http.MethodGet, path: "/v1/mac-app/update/status?jobId=legacy"},
	} {
		rec = httptest.NewRecorder()
		req = httptest.NewRequest(endpoint.method, endpoint.path, strings.NewReader(`{"version":"1.0.41"}`))
		server.Handler().ServeHTTP(rec, req)
		if rec.Code != http.StatusNotFound {
			t.Fatalf("expected the bridge binary to disable %s, got %d body=%s", endpoint.path, rec.Code, rec.Body.String())
		}
	}
}

func TestStatusReportsCachedMacAppUpdateState(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	calls := 0
	server.fetchMacAppRelease = func(context.Context) (githubRelease, error) {
		calls++
		return githubRelease{TagName: "v1.0.99"}, nil
	}

	for i := 0; i < 2; i++ {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/v1/status", nil)
		server.Handler().ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
		}
		var got statusResponse
		if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
			t.Fatalf("decode response: %v", err)
		}
		if !got.Companion.Update.UpdateAvailable {
			t.Fatalf("expected Mac App update available, got %+v", got.Companion.Update)
		}
		if got.Companion.Update.LatestVersion != "1.0.99" || got.Companion.Update.InstalledVersion != "1.0.0" {
			t.Fatalf("unexpected Mac App update versions: %+v", got.Companion.Update)
		}
	}
	if calls != 1 {
		t.Fatalf("expected cached Mac App release check, got %d calls", calls)
	}
}

func TestStatusSeparatesMacAppAndRuntimeVersions(t *testing.T) {
	t.Setenv(macAppVersionEnv, "1.0.98")
	t.Setenv(macAppBuildEnv, "198")
	server := newTestServer(t, runtimeconfig.Config{})
	server.fetchMacAppRelease = func(context.Context) (githubRelease, error) {
		return githubRelease{TagName: "v1.0.99"}, nil
	}

	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/v1/status", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got statusResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.Companion.App.Version != "1.0.98" || got.Companion.App.Build != "198" {
		t.Fatalf("unexpected native app metadata: %+v", got.Companion.App)
	}
	if got.Companion.Runtime.Version != got.Companion.Version {
		t.Fatalf("legacy version alias must remain the runtime version: companion=%q runtime=%q", got.Companion.Version, got.Companion.Runtime.Version)
	}
	if got.Companion.Update.InstalledVersion != "1.0.98" || !got.Companion.Update.UpdateAvailable {
		t.Fatalf("Mac App update check must compare the app version: %+v", got.Companion.Update)
	}
}

func TestStatusReportsMacAppUpdateCheckFailure(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	server.fetchMacAppRelease = func(context.Context) (githubRelease, error) {
		return githubRelease{}, errors.New("release api unavailable")
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/status", nil)
	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got statusResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.Companion.Update.Status != "check_failed" || got.Companion.Update.UpdateAvailable {
		t.Fatalf("expected Mac App check failure without update, got %+v", got.Companion.Update)
	}
	if got.Companion.Update.Message != "Mac App check failed." {
		t.Fatalf("unexpected Mac App check failure message: %+v", got.Companion.Update)
	}
}

func TestUsageReturnsPersistedProviderSnapshots(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	collectedAt := time.Date(2026, 6, 26, 11, 59, 0, 0, time.UTC)
	server.loadUsage = func(time.Time) (daemon.PersistedUsage, bool) {
		return daemon.PersistedUsage{
			SavedAt:         collectedAt,
			CurrentProvider: "codex",
			Providers: []daemon.ProviderUsageSnapshot{
				{
					Provider: "codex",
					Source:   "openai-web",
					Frame: protocol.Frame{
						Provider:      "codex",
						Label:         "Codex",
						Session:       28,
						Weekly:        59,
						ResetSec:      5400,
						SessionTokens: 1234,
						WeekTokens:    5678,
						TotalTokens:   9000,
						Activity:      "coding",
						UsageMode:     "used",
					},
					Meta: codexbar.ProviderUsageMeta{
						Windows: []codexbar.UsageWindow{
							{ID: "primary", Label: "Session", UsedPercent: 28, ResetSec: 5400, WindowMinutes: 300},
							{ID: "secondary", Label: "Weekly", UsedPercent: 59, ResetSec: 86400, WindowMinutes: 10080},
							{ID: "codeReview", Label: "Code review", UsedPercent: 7, WindowMinutes: 10080},
						},
						Status:       &codexbar.ProviderStatus{Indicator: "none", Description: "Operational", UpdatedAt: collectedAt, URL: "https://status.openai.com/"},
						Credits:      &codexbar.ProviderCredits{Remaining: 112.4, UpdatedAt: collectedAt},
						ResetCredits: &codexbar.ProviderResetCredits{AvailableCount: 3, NextExpiresAt: time.Date(2026, 7, 12, 1, 42, 57, 0, time.UTC), UpdatedAt: collectedAt},
						Cost: &codexbar.ProviderCostUsage{
							CurrencyCode:      "USD",
							UpdatedAt:         collectedAt,
							TodayCostUSD:      72.42,
							Last30DaysCostUSD: 3694.16,
							Last30DaysTokens:  4300000000,
							LatestTokens:      77000000,
							TopModel:          "gpt-5.5",
							Daily: []codexbar.ProviderCostDay{
								{Day: "2026-06-27", TotalCostUSD: 12.3, TotalTokens: 1000},
								{Day: "2026-06-28", TotalCostUSD: 24.6, TotalTokens: 2000},
								{Day: "2026-06-29", TotalCostUSD: 72.42, TotalTokens: 77000000, Models: []codexbar.ProviderCostModel{{Name: "gpt-5.5", TotalTokens: 77000000, CostUSD: 72.42}}},
							},
						},
						Pace: []codexbar.ProviderPace{
							{Window: "primary", Stage: "ahead", DeltaPercent: 12, ExpectedUsedPercent: 16, ETASeconds: 9000, Summary: "12% in deficit | Expected 16% used | Projected empty in 2h 30m"},
						},
						OverTime: []codexbar.UsageOverTimePoint{
							{
								Day:              "2026-06-24",
								TotalCreditsUsed: 12,
								Services: []codexbar.UsageServiceUsage{
									{Service: "CLI", CreditsUsed: 8.5},
									{Service: "Code review", CreditsUsed: 3.5},
								},
							},
							{Day: "2026-06-25", TotalCreditsUsed: 10, Services: []codexbar.UsageServiceUsage{{Service: "CLI", CreditsUsed: 10}}},
						},
					},
					CollectedAt: collectedAt,
				},
			},
		}, true
	}
	server.fetchUsage = func(context.Context) ([]codexbar.ParsedFrame, error) {
		t.Fatal("fetchUsage should not run when snapshots are present")
		return nil, nil
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/usage", nil)
	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got usageResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !got.OK || got.Source != "codexbar-display" || got.CurrentProvider != "codex" || got.UsageMode != "used" {
		t.Fatalf("unexpected usage response metadata: %+v", got)
	}
	if len(got.Providers) != 1 {
		t.Fatalf("expected one provider, got %+v", got.Providers)
	}
	provider := got.Providers[0]
	if provider.ID != "codex" || provider.Label != "Codex" || provider.Source != "openai-web" {
		t.Fatalf("unexpected provider identity: %+v", provider)
	}
	if provider.Session != 28 || provider.Weekly != 59 || provider.ResetSec != 5400 {
		t.Fatalf("unexpected provider usage: %+v", provider)
	}
	if provider.SessionTokens != 1234 || provider.WeekTokens != 5678 || provider.TotalTokens != 9000 {
		t.Fatalf("unexpected token stats: %+v", provider)
	}
	if provider.CollectedAt != collectedAt.Format(time.RFC3339) {
		t.Fatalf("expected collectedAt %s, got %q", collectedAt.Format(time.RFC3339), provider.CollectedAt)
	}
	if len(provider.Windows) != 3 || provider.Windows[2].ID != "codereview" || provider.Windows[2].UsedPercent != 7 {
		t.Fatalf("expected usage windows metadata, got %+v", provider.Windows)
	}
	if provider.Status == nil || provider.Status.Description != "Operational" || provider.Status.URL == "" {
		t.Fatalf("expected status metadata, got %+v", provider.Status)
	}
	if provider.Credits == nil || provider.Credits.Remaining != 112.4 {
		t.Fatalf("expected credits metadata, got %+v", provider.Credits)
	}
	if provider.ResetCredits == nil || provider.ResetCredits.AvailableCount != 3 || provider.ResetCredits.NextExpiresAt != "2026-07-12T01:42:57Z" {
		t.Fatalf("expected reset credits metadata, got %+v", provider.ResetCredits)
	}
	if provider.Cost == nil || provider.Cost.TodayCostUSD != 72.42 || provider.Cost.Last30DaysCostUSD != 3694.16 || provider.Cost.TopModel != "gpt-5.5" {
		t.Fatalf("expected cost metadata, got %+v", provider.Cost)
	}
	if len(provider.Cost.Daily) != 3 || provider.Cost.Daily[2].Models[0].Name != "gpt-5.5" {
		t.Fatalf("expected cost history metadata, got %+v", provider.Cost.Daily)
	}
	if len(provider.Pace) != 1 || provider.Pace[0].Window != "primary" || provider.Pace[0].Summary == "" {
		t.Fatalf("expected pace metadata, got %+v", provider.Pace)
	}
	if len(provider.UsageOverTime) != 2 || provider.UsageOverTime[0].Day != "2026-06-24" || provider.UsageOverTime[0].TotalCreditsUsed != 12 {
		t.Fatalf("expected usage-over-time metadata, got %+v", provider.UsageOverTime)
	}
	if len(provider.UsageOverTime[0].Services) != 2 || provider.UsageOverTime[0].Services[0].Service != "CLI" {
		t.Fatalf("expected usage-over-time services, got %+v", provider.UsageOverTime[0].Services)
	}
}

func TestUsageHonorsCodexBarRemainingPreference(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	t.Setenv("CODEXBAR_DISPLAY_USAGE_MODE", "remaining")

	collectedAt := time.Date(2026, 6, 26, 11, 59, 0, 0, time.UTC)
	server.loadUsage = func(time.Time) (daemon.PersistedUsage, bool) {
		return daemon.PersistedUsage{
			SavedAt:         collectedAt,
			CurrentProvider: "codex",
			Providers: []daemon.ProviderUsageSnapshot{
				{
					Provider: "codex",
					Frame: protocol.Frame{
						Provider:  "codex",
						Label:     "Codex",
						Session:   28,
						Weekly:    59,
						ResetSec:  5400,
						UsageMode: "used",
					},
					Meta: codexbar.ProviderUsageMeta{
						Windows: []codexbar.UsageWindow{
							{ID: "primary", Label: "Session", UsedPercent: 28, ResetSec: 5400},
							{ID: "secondary", Label: "Weekly", UsedPercent: 59, ResetSec: 86400},
							{ID: "extra", Label: "Extra", UsedPercent: 7},
						},
					},
					CollectedAt: collectedAt,
				},
			},
		}, true
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/usage", nil)
	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got usageResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.UsageMode != "remaining" {
		t.Fatalf("expected remaining response mode, got %+v", got)
	}
	if len(got.Providers) != 1 {
		t.Fatalf("expected one provider, got %+v", got.Providers)
	}
	provider := got.Providers[0]
	if provider.UsageMode != "remaining" || provider.Session != 72 || provider.Weekly != 41 {
		t.Fatalf("expected remaining provider values, got %+v", provider)
	}
	if len(provider.Windows) != 3 ||
		provider.Windows[0].UsedPercent != 72 ||
		provider.Windows[1].UsedPercent != 41 ||
		provider.Windows[2].UsedPercent != 93 {
		t.Fatalf("expected remaining window values, got %+v", provider.Windows)
	}
}

func TestUsageRefreshBypassesPersistedSnapshotAndCachesFreshResult(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	now := time.Date(2026, 7, 20, 14, 0, 0, 0, time.UTC)
	server.loadUsage = func(time.Time) (daemon.PersistedUsage, bool) {
		return daemon.PersistedUsage{
			SavedAt: now,
			Providers: []daemon.ProviderUsageSnapshot{{
				Provider: "codex",
				Frame:    protocol.Frame{Provider: "codex", Label: "Codex", Weekly: 36, UsageMode: "used", SessionTokens: 1234, WeekTokens: 5678, TotalTokens: 9000},
				Meta: codexbar.ProviderUsageMeta{
					Windows: []codexbar.UsageWindow{{ID: "secondary", Label: "Weekly", UsedPercent: 36}},
					Cost:    &codexbar.ProviderCostUsage{Daily: []codexbar.ProviderCostDay{{Day: "2026-07-20", TotalTokens: 1234}}},
				},
				CollectedAt: now,
			}},
		}, true
	}
	fetches := 0
	server.fetchUsage = func(context.Context) ([]codexbar.ParsedFrame, error) {
		fetches++
		return []codexbar.ParsedFrame{{
			Provider: "codex",
			Frame:    protocol.Frame{Provider: "codex", Label: "Codex", Weekly: 36, UsageMode: "used"},
			Meta: codexbar.ProviderUsageMeta{Windows: []codexbar.UsageWindow{
				{ID: "secondary", Label: "Weekly", UsedPercent: 36},
				{ID: "codex-spark-weekly", Label: "Codex Spark Weekly", UsedPercent: 0, WindowMinutes: 10080},
			}},
		}}, nil
	}

	for _, path := range []string{"/v1/usage?refresh=1", "/v1/usage"} {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, path, nil)
		server.Handler().ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("expected status 200 for %s, got %d body=%s", path, rec.Code, rec.Body.String())
		}
		var got usageResponse
		if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
			t.Fatalf("decode response for %s: %v", path, err)
		}
		if len(got.Providers) != 1 || len(got.Providers[0].Windows) != 2 || got.Providers[0].Windows[1].Label != "Codex Spark Weekly" {
			t.Fatalf("expected fresh Codex Spark window for %s, got %+v", path, got.Providers)
		}
		if got.Providers[0].SessionTokens != 1234 || got.Providers[0].WeekTokens != 5678 || got.Providers[0].TotalTokens != 9000 {
			t.Fatalf("expected persisted token history for %s, got %+v", path, got.Providers[0])
		}
		if got.Providers[0].Cost == nil || len(got.Providers[0].Cost.Daily) != 1 {
			t.Fatalf("expected persisted cost history for %s, got %+v", path, got.Providers[0].Cost)
		}
	}
	if fetches != 1 {
		t.Fatalf("expected one direct fetch followed by cached usage, got %d", fetches)
	}
}

func TestUsageCachePicksUpTokenHistoryCollectedAfterFirstResponse(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	now := time.Date(2026, 7, 21, 12, 0, 0, 0, time.UTC)
	historyReady := false
	server.loadUsage = func(time.Time) (daemon.PersistedUsage, bool) {
		if !historyReady {
			return daemon.PersistedUsage{}, false
		}
		return daemon.PersistedUsage{
			SavedAt: now,
			Providers: []daemon.ProviderUsageSnapshot{{
				Provider: "codex",
				Frame: protocol.Frame{
					Provider:      "codex",
					Label:         "Codex",
					Weekly:        36,
					UsageMode:     "used",
					SessionTokens: 1234,
					WeekTokens:    5678,
					TotalTokens:   9000,
				},
				Meta: codexbar.ProviderUsageMeta{Cost: &codexbar.ProviderCostUsage{
					Daily: []codexbar.ProviderCostDay{{Day: "2026-07-21", TotalTokens: 1234}},
				}},
				CollectedAt: now,
			}},
		}, true
	}
	fetches := 0
	server.fetchUsage = func(context.Context) ([]codexbar.ParsedFrame, error) {
		fetches++
		return []codexbar.ParsedFrame{{
			Provider: "codex",
			Frame: protocol.Frame{
				Provider:  "codex",
				Label:     "Codex",
				Weekly:    36,
				UsageMode: "used",
			},
		}}, nil
	}

	first := httptest.NewRecorder()
	server.Handler().ServeHTTP(first, httptest.NewRequest(http.MethodGet, "/v1/usage?refresh=1", nil))
	if first.Code != http.StatusOK {
		t.Fatalf("expected first response 200, got %d body=%s", first.Code, first.Body.String())
	}
	var initial usageResponse
	if err := json.Unmarshal(first.Body.Bytes(), &initial); err != nil {
		t.Fatalf("decode first response: %v", err)
	}
	if len(initial.Providers) != 1 || initial.Providers[0].Cost != nil {
		t.Fatalf("expected initial response without history, got %+v", initial.Providers)
	}

	historyReady = true
	second := httptest.NewRecorder()
	server.Handler().ServeHTTP(second, httptest.NewRequest(http.MethodGet, "/v1/usage", nil))
	if second.Code != http.StatusOK {
		t.Fatalf("expected second response 200, got %d body=%s", second.Code, second.Body.String())
	}
	var enriched usageResponse
	if err := json.Unmarshal(second.Body.Bytes(), &enriched); err != nil {
		t.Fatalf("decode second response: %v", err)
	}
	if len(enriched.Providers) != 1 || enriched.Providers[0].Cost == nil || len(enriched.Providers[0].Cost.Daily) != 1 {
		t.Fatalf("expected cached response enriched with collected history, got %+v", enriched.Providers)
	}
	if enriched.Providers[0].SessionTokens != 1234 || enriched.Providers[0].WeekTokens != 5678 || enriched.Providers[0].TotalTokens != 9000 {
		t.Fatalf("expected cached response enriched with token totals, got %+v", enriched.Providers[0])
	}
	if fetches != 1 {
		t.Fatalf("expected cached second response without another direct fetch, got %d fetches", fetches)
	}
}

func TestDisplayFrameLatestReturnsPersistedLastGoodFrame(t *testing.T) {
	t.Setenv(displayStreamOutLogEnv, filepath.Join(t.TempDir(), "missing.log"))
	server := newTestServer(t, runtimeconfig.Config{})
	savedAt := time.Date(2026, 6, 30, 14, 10, 35, 893363000, time.UTC)
	path := server.lastGoodDisplayFramePath()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("create display state dir: %v", err)
	}
	raw := []byte(`{
		"savedAt":"` + savedAt.Format(time.RFC3339Nano) + `",
		"frame":{
			"v":1,
			"provider":"codex",
			"label":"Codex",
			"session":24,
			"weekly":13,
			"resetSecs":6634,
			"sessionTokens":124627584,
			"weekTokens":1063961137,
			"totalTokens":4557592436
		}
	}`)
	if err := os.WriteFile(path, raw, 0o644); err != nil {
		t.Fatalf("write display frame: %v", err)
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/display-frame/latest", nil)
	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got displayFrameResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !got.OK || got.Source != "last-good-frame" {
		t.Fatalf("unexpected display frame response metadata: %+v", got)
	}
	if got.SavedAt != savedAt.Format(time.RFC3339Nano) {
		t.Fatalf("expected savedAt %s, got %s", savedAt.Format(time.RFC3339Nano), got.SavedAt)
	}
	if got.Frame.Provider != "codex" || got.Frame.Label != "Codex" {
		t.Fatalf("unexpected frame identity: %+v", got.Frame)
	}
	if got.Frame.Session != 24 || got.Frame.Weekly != 13 || got.Frame.ResetSec != 6634 {
		t.Fatalf("unexpected frame values: %+v", got.Frame)
	}
	if got.Frame.UsageMode != "" {
		t.Fatalf("expected legacy frame usage mode to stay empty, got %q", got.Frame.UsageMode)
	}
}

func TestDisplayFrameLatestPrefersLastSentDisplayFrame(t *testing.T) {
	logPath := filepath.Join(t.TempDir(), "daemon.out.log")
	t.Setenv(displayStreamOutLogEnv, logPath)
	if err := os.WriteFile(
		logPath,
		[]byte(`2026-07-03T14:36:54Z sent frame -> http://192.168.178.72 transport=wifi source=oauth fresh=true usageMode=remaining provider=codex label=Vibe TV session=73 weekly=58 reset=2733s activity="coding" time="16:36" date="03.07.2026" error="" reason=sticky-current detail="provider=codex"`),
		0o644,
	); err != nil {
		t.Fatalf("write display stream log: %v", err)
	}
	server := newTestServer(t, runtimeconfig.Config{})
	savedAt := time.Date(2026, 6, 30, 14, 10, 35, 893363000, time.UTC)
	path := server.lastGoodDisplayFramePath()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("create display state dir: %v", err)
	}
	if err := os.WriteFile(
		path,
		[]byte(`{"savedAt":"`+savedAt.Format(time.RFC3339Nano)+`","frame":{"v":1,"provider":"codex","label":"Codex","session":24,"weekly":13}}`),
		0o644,
	); err != nil {
		t.Fatalf("write persisted display frame: %v", err)
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/display-frame/latest", nil)
	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got displayFrameResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !got.OK || got.Source != "last-sent-frame" {
		t.Fatalf("unexpected display frame response metadata: %+v", got)
	}
	if got.SavedAt != "2026-07-03T14:36:54Z" {
		t.Fatalf("expected sent timestamp, got %q", got.SavedAt)
	}
	if got.Frame.Provider != "codex" || got.Frame.Label != "Vibe TV" {
		t.Fatalf("unexpected frame identity: %+v", got.Frame)
	}
	if got.Frame.Session != 73 || got.Frame.Weekly != 58 || got.Frame.ResetSec != 2733 {
		t.Fatalf("unexpected sent frame values: %+v", got.Frame)
	}
	if got.Frame.UsageMode != "remaining" || got.Frame.Activity != "coding" {
		t.Fatalf("unexpected sent frame state: %+v", got.Frame)
	}
}

func TestInspectDisplayStreamUsesConfiguredRuntimeLabelAndSharedLog(t *testing.T) {
	logPath := filepath.Join(t.TempDir(), "daemon.out.log")
	t.Setenv(displayStreamOutLogEnv, logPath)
	t.Setenv(displayStreamLabelEnv, "shop.vibetv.control-center.runtime")
	sentAt := time.Now().UTC().Add(-time.Second).Truncate(time.Second)
	startedAt := sentAt.Add(-time.Second)
	if err := os.WriteFile(
		logPath,
		[]byte(strings.Join([]string{
			startedAt.Format(time.RFC3339Nano) + ` runtime event=stream-start label="shop.vibetv.control-center.runtime"`,
			sentAt.Format(time.RFC3339Nano) + ` sent frame -> http://192.168.178.72 transport=wifi source=oauth fresh=true usageMode=remaining provider=codex label=VibeTV session=73 weekly=58 reset=2733s`,
		}, "\n")+"\n"),
		0o600,
	); err != nil {
		t.Fatalf("write display stream log: %v", err)
	}

	oldPrint := printDisplayStreamService
	t.Cleanup(func() { printDisplayStreamService = oldPrint })
	var gotService string
	printDisplayStreamService = func(_ context.Context, service string) ([]byte, error) {
		gotService = service
		return []byte("state = running\n"), nil
	}

	stream := inspectDisplayStream(context.Background(), "http://192.168.178.72")
	wantService := fmt.Sprintf("gui/%d/shop.vibetv.control-center.runtime", os.Getuid())
	if gotService != wantService {
		t.Fatalf("expected launchctl service %q, got %q", wantService, gotService)
	}
	if !stream.Running || !stream.Healthy {
		t.Fatalf("expected configured runtime stream to be running and healthy, got %+v", stream)
	}
	if stream.LastSentAt != sentAt.Format(time.RFC3339) || stream.LastTarget != "http://192.168.178.72" {
		t.Fatalf("unexpected configured runtime stream metadata: %+v", stream)
	}
}

func TestConfiguredRuntimeRejectsRecentLegacyFrameWithoutStartMarker(t *testing.T) {
	logPath := filepath.Join(t.TempDir(), "daemon.out.log")
	t.Setenv(displayStreamOutLogEnv, logPath)
	t.Setenv(displayStreamLabelEnv, "shop.vibetv.control-center.runtime")
	sentAt := time.Now().UTC().Add(-time.Second)
	if err := os.WriteFile(
		logPath,
		[]byte(sentAt.Format(time.RFC3339Nano)+` sent frame -> http://192.168.178.72 transport=wifi source=oauth fresh=true usageMode=remaining provider=codex label=Legacy session=11 weekly=22 reset=2733s`+"\n"),
		0o600,
	); err != nil {
		t.Fatalf("write legacy display stream log: %v", err)
	}

	oldPrint := printDisplayStreamService
	t.Cleanup(func() { printDisplayStreamService = oldPrint })
	printDisplayStreamService = func(context.Context, string) ([]byte, error) {
		return []byte("state = running\n"), nil
	}
	stream := inspectDisplayStream(context.Background(), "http://192.168.178.72")
	if !stream.Running || stream.Healthy || stream.LastSentAt != "" {
		t.Fatalf("configured runtime accepted pre-session legacy frame: %+v", stream)
	}
	if stream.Detail != "Display stream is starting." {
		t.Fatalf("unexpected missing-marker detail %q", stream.Detail)
	}

	server := newTestServer(t, runtimeconfig.Config{})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/display-frame/latest", nil)
	server.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected latest frame 404 without runtime marker, got %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestConfiguredRuntimeRejectsMarkerForDifferentServiceLabel(t *testing.T) {
	logPath := filepath.Join(t.TempDir(), "daemon.out.log")
	t.Setenv(displayStreamOutLogEnv, logPath)
	t.Setenv(displayStreamLabelEnv, "shop.vibetv.control-center.runtime")
	startedAt := time.Now().UTC().Add(-time.Second)
	frameAt := startedAt.Add(100 * time.Millisecond)
	if err := os.WriteFile(
		logPath,
		[]byte(strings.Join([]string{
			startedAt.Format(time.RFC3339Nano) + ` runtime event=stream-start label="com.codexbar-display.daemon"`,
			frameAt.Format(time.RFC3339Nano) + ` sent frame -> http://192.168.178.72 transport=wifi source=oauth fresh=true usageMode=remaining provider=codex label=Legacy session=11 weekly=22 reset=2733s`,
		}, "\n")+"\n"),
		0o600,
	); err != nil {
		t.Fatalf("write wrong-label display stream log: %v", err)
	}

	if when, _ := lastDisplayStreamFrame(logPath); !when.IsZero() {
		t.Fatalf("configured runtime accepted frame after another service marker: %s", when)
	}
}

func TestConfiguredRuntimeAcceptsOnlyFrameAfterMatchingStartMarker(t *testing.T) {
	logPath := filepath.Join(t.TempDir(), "daemon.out.log")
	t.Setenv(displayStreamOutLogEnv, logPath)
	t.Setenv(displayStreamLabelEnv, "shop.vibetv.control-center.runtime")
	startedAt := time.Now().UTC().Add(-time.Second)
	legacyAt := startedAt.Add(-100 * time.Millisecond)
	currentAt := startedAt.Add(100 * time.Millisecond)
	if err := os.WriteFile(
		logPath,
		[]byte(strings.Join([]string{
			legacyAt.Format(time.RFC3339Nano) + ` sent frame -> http://192.168.178.72 transport=wifi source=oauth fresh=true usageMode=remaining provider=codex label=Legacy session=11 weekly=22 reset=2733s`,
			startedAt.Format(time.RFC3339Nano) + ` runtime event=stream-start label="shop.vibetv.control-center.runtime"`,
			currentAt.Format(time.RFC3339Nano) + ` sent frame -> http://192.168.178.72 transport=wifi source=oauth fresh=true usageMode=remaining provider=codex label=Current session=73 weekly=58 reset=2733s`,
		}, "\n")+"\n"),
		0o600,
	); err != nil {
		t.Fatalf("write mixed display stream log: %v", err)
	}

	server := newTestServer(t, runtimeconfig.Config{})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/display-frame/latest", nil)
	server.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected latest frame 200 after matching marker, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got displayFrameResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode latest frame: %v", err)
	}
	if got.Frame.Label != "Current" || got.Frame.Session != 73 || got.SavedAt != currentAt.Format(time.RFC3339Nano) {
		t.Fatalf("configured runtime returned wrong session frame: %+v", got)
	}
}

func TestConfiguredRuntimeFindsStartMarkerAcrossRotation(t *testing.T) {
	logPath := filepath.Join(t.TempDir(), "daemon.out.log")
	t.Setenv(displayStreamOutLogEnv, logPath)
	t.Setenv(displayStreamLabelEnv, "shop.vibetv.control-center.runtime")
	startedAt := time.Now().UTC().Add(-time.Second)
	frameAt := startedAt.Add(100 * time.Millisecond)
	if err := os.WriteFile(
		runtimepaths.DisplayStreamOutLogArchive(logPath),
		[]byte(startedAt.Format(time.RFC3339Nano)+` runtime event=stream-start label="shop.vibetv.control-center.runtime"`+"\n"),
		0o600,
	); err != nil {
		t.Fatalf("write archived runtime marker: %v", err)
	}
	if err := os.WriteFile(
		logPath,
		[]byte(frameAt.Format(time.RFC3339Nano)+` sent frame -> http://192.168.178.72 transport=wifi source=oauth fresh=true usageMode=remaining provider=codex label=Current session=73 weekly=58 reset=2733s`+"\n"),
		0o600,
	); err != nil {
		t.Fatalf("write current runtime frame: %v", err)
	}

	when, target := lastDisplayStreamFrame(logPath)
	if !when.Equal(frameAt) || target != "http://192.168.178.72" {
		t.Fatalf("runtime marker/frame rotation correlation failed: when=%s target=%q", when, target)
	}
}

func TestConfiguredRuntimeRejectsPersistedFrameBeforeStartMarker(t *testing.T) {
	logPath := filepath.Join(t.TempDir(), "daemon.out.log")
	t.Setenv(displayStreamOutLogEnv, logPath)
	t.Setenv(displayStreamLabelEnv, "shop.vibetv.control-center.runtime")
	startedAt := time.Now().UTC().Add(-time.Second)
	if err := os.WriteFile(
		logPath,
		[]byte(startedAt.Format(time.RFC3339Nano)+` runtime event=stream-start label="shop.vibetv.control-center.runtime"`+"\n"),
		0o600,
	); err != nil {
		t.Fatalf("write runtime marker: %v", err)
	}

	server := newTestServer(t, runtimeconfig.Config{})
	path := server.lastGoodDisplayFramePath()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("create display state dir: %v", err)
	}
	if err := os.WriteFile(
		path,
		[]byte(`{"savedAt":"`+startedAt.Add(-time.Second).Format(time.RFC3339Nano)+`","frame":{"v":1,"provider":"codex","label":"Legacy","session":11,"weekly":22}}`),
		0o600,
	); err != nil {
		t.Fatalf("write persisted legacy frame: %v", err)
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/display-frame/latest", nil)
	server.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected persisted pre-session frame 404, got %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestDisplayStreamLaunchAgentLabelDefaultsToLegacyService(t *testing.T) {
	t.Setenv(displayStreamLabelEnv, "")
	if got := displayStreamLaunchAgentLabel(); got != displayStreamLegacyLabel {
		t.Fatalf("expected legacy LaunchAgent label %q, got %q", displayStreamLegacyLabel, got)
	}
}

func TestInspectDisplayStreamDetectsLaterErrorInSameSecond(t *testing.T) {
	logPath := filepath.Join(t.TempDir(), "daemon.out.log")
	t.Setenv(displayStreamOutLogEnv, logPath)
	t.Setenv(displayStreamLabelEnv, "shop.vibetv.control-center.runtime")
	second := time.Now().UTC().Truncate(time.Second)
	startedAt := second.Add(50 * time.Millisecond)
	frameAt := second.Add(100 * time.Millisecond)
	errorAt := second.Add(200 * time.Millisecond)
	if err := os.WriteFile(
		logPath,
		[]byte(strings.Join([]string{
			startedAt.Format(time.RFC3339Nano) + ` runtime event=stream-start label="shop.vibetv.control-center.runtime"`,
			frameAt.Format(time.RFC3339Nano) + ` sent frame -> http://192.168.178.72 transport=wifi source=oauth fresh=true usageMode=remaining provider=codex label=VibeTV session=73 weekly=58 reset=2733s`,
			errorAt.Format(time.RFC3339Nano) + ` cycle error: code=runtime_serial_write op=send-line retry=3s err=device-offline`,
		}, "\n")+"\n"),
		0o600,
	); err != nil {
		t.Fatalf("write display stream log: %v", err)
	}

	oldPrint := printDisplayStreamService
	t.Cleanup(func() { printDisplayStreamService = oldPrint })
	printDisplayStreamService = func(context.Context, string) ([]byte, error) {
		return []byte("state = running\n"), nil
	}

	stream := inspectDisplayStream(context.Background(), "http://192.168.178.72")
	if !stream.Running || stream.Healthy {
		t.Fatalf("expected later same-second error to make running stream unhealthy, got %+v", stream)
	}
	if stream.Detail != "Display stream could not send to VibeTV and is reconnecting." {
		t.Fatalf("unexpected same-second stream error detail %q", stream.Detail)
	}
}

func TestInspectDisplayStreamReportsPairingErrorBeforeFirstFrame(t *testing.T) {
	logPath := filepath.Join(t.TempDir(), "daemon.out.log")
	t.Setenv(displayStreamOutLogEnv, logPath)
	t.Setenv(displayStreamLabelEnv, "shop.vibetv.control-center.runtime")
	startedAt := time.Now().UTC().Add(-time.Second)
	errorAt := startedAt.Add(100 * time.Millisecond)
	if err := os.WriteFile(
		logPath,
		[]byte(strings.Join([]string{
			startedAt.Format(time.RFC3339Nano) + ` runtime event=stream-start label="shop.vibetv.control-center.runtime"`,
			errorAt.Format(time.RFC3339Nano) + ` cycle error: code=runtime_serial_write op=send-line retry=3s err=device status=401 body="pairing token required"`,
		}, "\n")+"\n"),
		0o600,
	); err != nil {
		t.Fatalf("write display stream log: %v", err)
	}

	oldPrint := printDisplayStreamService
	t.Cleanup(func() { printDisplayStreamService = oldPrint })
	printDisplayStreamService = func(context.Context, string) ([]byte, error) {
		return []byte("state = running\n"), nil
	}

	stream := inspectDisplayStream(context.Background(), "http://192.168.178.72")
	if !stream.Running || stream.Healthy {
		t.Fatalf("expected pairing rejection to keep stream unhealthy, got %+v", stream)
	}
	if stream.ErrorCode != "device_pairing_required" {
		t.Fatalf("pairing error code=%q want device_pairing_required", stream.ErrorCode)
	}
	if stream.Detail != "VibeTV connection needs attention." {
		t.Fatalf("unexpected pairing error detail %q", stream.Detail)
	}
}

func TestWaitForDisplayStreamAfterPairIgnoresTransientPairingError(t *testing.T) {
	var calls atomic.Int32
	inspect := func(context.Context, string, time.Time) displayStreamInfo {
		if calls.Add(1) == 1 {
			return displayStreamInfo{
				Running:   true,
				ErrorCode: "device_pairing_required",
				Detail:    "old request used the previous token",
			}
		}
		return displayStreamInfo{Running: true, Healthy: true}
	}

	got := waitForDisplayStreamAfterProbe(context.Background(), "http://192.0.2.10", time.Now(), false, inspect)
	if !got.Healthy || calls.Load() != 2 {
		t.Fatalf("post-pair wait must ignore one stale auth error, got=%+v calls=%d", got, calls.Load())
	}

	calls.Store(0)
	got = waitForDisplayStreamAfterProbe(context.Background(), "http://192.0.2.10", time.Now(), true, inspect)
	if got.Healthy || got.ErrorCode != "device_pairing_required" || calls.Load() != 1 {
		t.Fatalf("normal wait must surface pairing error immediately, got=%+v calls=%d", got, calls.Load())
	}

}

func TestInspectDisplayStreamAfterIgnoresEarlierFrameAndError(t *testing.T) {
	logPath := filepath.Join(t.TempDir(), "daemon.out.log")
	t.Setenv(displayStreamOutLogEnv, logPath)
	t.Setenv(displayStreamLabelEnv, "shop.vibetv.control-center.runtime")
	startedAt := time.Now().UTC().Add(-2 * time.Second)
	frameAt := startedAt.Add(100 * time.Millisecond)
	errorAt := startedAt.Add(200 * time.Millisecond)
	notBefore := startedAt.Add(time.Second)
	if err := os.WriteFile(
		logPath,
		[]byte(strings.Join([]string{
			startedAt.Format(time.RFC3339Nano) + ` runtime event=stream-start label="shop.vibetv.control-center.runtime"`,
			frameAt.Format(time.RFC3339Nano) + ` sent frame -> http://192.168.178.72 transport=wifi source=oauth fresh=true usageMode=remaining provider=codex label=VibeTV session=73 weekly=58 reset=2733s`,
			errorAt.Format(time.RFC3339Nano) + ` cycle error: code=runtime_serial_write op=send-line retry=3s err=device status=401 body="pairing token required"`,
		}, "\n")+"\n"),
		0o600,
	); err != nil {
		t.Fatalf("write display stream log: %v", err)
	}

	oldPrint := printDisplayStreamService
	t.Cleanup(func() { printDisplayStreamService = oldPrint })
	printDisplayStreamService = func(context.Context, string) ([]byte, error) {
		return []byte("state = running\n"), nil
	}

	stream := inspectDisplayStreamAfter(context.Background(), "http://192.168.178.72", notBefore)
	if !stream.Running || stream.Healthy || stream.LastSentAt != "" || stream.ErrorCode != "" {
		t.Fatalf("expected pre-wake frame and error to be ignored, got %+v", stream)
	}
	if stream.Detail != "Display stream has not sent usage yet." {
		t.Fatalf("unexpected fresh-wait detail %q", stream.Detail)
	}
}

func TestLastDisplayStreamFrameFallsBackToRotatedArchive(t *testing.T) {
	logPath := filepath.Join(t.TempDir(), "daemon.out.log")
	archivePath := runtimepaths.DisplayStreamOutLogArchive(logPath)
	if err := os.WriteFile(logPath, []byte("2026-07-12T10:11:13.1Z VibeTV companion API listening\n"), 0o600); err != nil {
		t.Fatalf("write current display stream log: %v", err)
	}
	if err := os.WriteFile(
		archivePath,
		[]byte(`2026-07-12T10:11:12.123456789Z sent frame -> http://192.168.178.72 transport=wifi source=oauth fresh=true usageMode=remaining provider=codex label=VibeTV session=73 weekly=58 reset=2733s`+"\n"),
		0o600,
	); err != nil {
		t.Fatalf("write display stream log archive: %v", err)
	}

	when, target := lastDisplayStreamFrame(logPath)
	if got := when.Format(time.RFC3339Nano); got != "2026-07-12T10:11:12.123456789Z" {
		t.Fatalf("unexpected archived frame timestamp %q", got)
	}
	if target != "http://192.168.178.72" {
		t.Fatalf("unexpected archived frame target %q", target)
	}
}

func TestReadDisplayStreamLogTailIsBounded(t *testing.T) {
	logPath := filepath.Join(t.TempDir(), "daemon.out.log")
	frame := `2026-07-12T10:11:12.123456789Z sent frame -> http://192.168.178.72 transport=wifi source=oauth fresh=true usageMode=remaining provider=codex label=VibeTV session=73 weekly=58 reset=2733s`
	prefix := "BEGIN-SHOULD-NOT-BE-READ " + strings.Repeat("x", int(runtimepaths.DisplayStreamLogTailBytes)) + "\n"
	if err := os.WriteFile(logPath, []byte(prefix+frame+"\n"), 0o600); err != nil {
		t.Fatalf("write oversized display stream log: %v", err)
	}

	tail, err := readDisplayStreamLogTail(logPath)
	if err != nil {
		t.Fatalf("read bounded display stream log tail: %v", err)
	}
	if int64(len(tail)) > runtimepaths.DisplayStreamLogTailBytes {
		t.Fatalf("expected tail <= %d bytes, got %d", runtimepaths.DisplayStreamLogTailBytes, len(tail))
	}
	if bytes.Contains(tail, []byte("BEGIN-SHOULD-NOT-BE-READ")) {
		t.Fatalf("bounded tail read included old log prefix")
	}
	if !bytes.Contains(tail, []byte("sent frame -> http://192.168.178.72")) {
		t.Fatalf("bounded tail lost newest frame: %q", tail)
	}
}

func TestLastDisplayStreamErrorParsesLatestCycleError(t *testing.T) {
	logPath := filepath.Join(t.TempDir(), "daemon.out.log")
	if err := os.WriteFile(
		logPath,
		[]byte(strings.Join([]string{
			`2026-07-03T14:36:54Z sent frame -> http://192.168.178.72 transport=wifi source=oauth fresh=true usageMode=remaining provider=codex label=Vibe TV session=73 weekly=58 reset=2733s activity="coding" time="16:36" date="03.07.2026" error="" reason=sticky-current detail="provider=codex"`,
			`2026-07-03T14:37:12Z cycle error: code=runtime_serial_write op=send-line retry=3s recovery="Check the device connection." err=device status=400 body="empty frame body"`,
		}, "\n")),
		0o644,
	); err != nil {
		t.Fatalf("write display stream log: %v", err)
	}

	when, detail, ok := lastDisplayStreamError(logPath)
	if !ok {
		t.Fatal("expected display stream error")
	}
	if got := when.Format(time.RFC3339); got != "2026-07-03T14:37:12Z" {
		t.Fatalf("unexpected error timestamp %q", got)
	}
	if detail != "Display stream could not send to VibeTV and is reconnecting." {
		t.Fatalf("unexpected error detail %q", detail)
	}
}

func TestDisplayFrameLatestReturnsNotFoundWithoutLastGoodFrame(t *testing.T) {
	t.Setenv(displayStreamOutLogEnv, filepath.Join(t.TempDir(), "missing.log"))
	server := newTestServer(t, runtimeconfig.Config{})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/display-frame/latest", nil)

	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected status 404, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got errorResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.OK || got.Error.Code != "display_frame_unavailable" {
		t.Fatalf("unexpected error response: %+v", got)
	}
}

func TestUsageFallsBackToCodexBarFetchWhenSnapshotsMissing(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	server.loadUsage = func(time.Time) (daemon.PersistedUsage, bool) {
		return daemon.PersistedUsage{}, false
	}
	server.fetchUsage = func(context.Context) ([]codexbar.ParsedFrame, error) {
		return []codexbar.ParsedFrame{
			{
				Provider: "claude",
				Source:   "web",
				Frame: protocol.Frame{
					Provider: "claude",
					Label:    "Claude",
					Session:  11,
					Weekly:   22,
					ResetSec: 3600,
				},
			},
		}, nil
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/usage", nil)
	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got usageResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.Source != "codexbar" || got.CurrentProvider != "claude" {
		t.Fatalf("unexpected fallback metadata: %+v", got)
	}
	if len(got.Providers) != 1 || got.Providers[0].ID != "claude" || got.Providers[0].UsageMode != "used" {
		t.Fatalf("unexpected fallback providers: %+v", got.Providers)
	}
}

func TestUsageRefreshesStaleProviderSnapshots(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	now := time.Date(2026, 6, 26, 13, 0, 0, 0, time.UTC)
	server.loadUsage = func(time.Time) (daemon.PersistedUsage, bool) {
		return daemon.PersistedUsage{
			SavedAt:         now.Add(-5 * time.Minute),
			CurrentProvider: "codex",
			Providers: []daemon.ProviderUsageSnapshot{
				{
					Provider:    "codex",
					Source:      "openai-web",
					CollectedAt: now.Add(-5 * time.Minute),
					Stale:       true,
					Frame: protocol.Frame{
						Provider: "codex",
						Label:    "Codex",
						Session:  4,
						Weekly:   18,
					},
				},
			},
		}, true
	}
	server.fetchUsage = func(context.Context) ([]codexbar.ParsedFrame, error) {
		return []codexbar.ParsedFrame{
			{
				Provider:    "codex",
				Source:      "openai-web",
				CollectedAt: now,
				Frame: protocol.Frame{
					Provider: "codex",
					Label:    "Codex",
					Session:  9,
					Weekly:   19,
				},
				Meta: codexbar.ProviderUsageMeta{
					OverTime: []codexbar.UsageOverTimePoint{
						{Day: "2026-06-26", TotalCreditsUsed: 12},
					},
				},
			},
		}, nil
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/usage", nil)
	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got usageResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.Source != "codexbar" {
		t.Fatalf("expected fresh codexbar source, got %+v", got)
	}
	if len(got.Providers) != 1 || got.Providers[0].Session != 9 || got.Providers[0].Stale {
		t.Fatalf("expected fresh provider usage, got %+v", got.Providers)
	}
	if len(got.Providers[0].UsageOverTime) != 1 {
		t.Fatalf("expected fresh usage-over-time, got %+v", got.Providers[0].UsageOverTime)
	}
}

func TestStartDisplayStreamUsesInjectedRefresh(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	var refreshedTarget string
	server.refreshStream = func(_ context.Context, target string) error {
		refreshedTarget = target
		return nil
	}
	server.runSetup = func(context.Context, setup.Options) error {
		t.Fatal("runSetup should not be called when refreshStream is injected")
		return nil
	}

	if err := server.startDisplayStream(context.Background(), "http://192.168.178.99"); err != nil {
		t.Fatalf("startDisplayStream returned error: %v", err)
	}
	if refreshedTarget != "http://192.168.178.99" {
		t.Fatalf("expected refresh target, got %q", refreshedTarget)
	}
}

func TestUsageReturnsStaleProviderSnapshotsWhenRefreshFails(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	now := time.Date(2026, 6, 26, 13, 0, 0, 0, time.UTC)
	server.loadUsage = func(time.Time) (daemon.PersistedUsage, bool) {
		return daemon.PersistedUsage{
			SavedAt:         now.Add(-5 * time.Minute),
			CurrentProvider: "codex",
			Providers: []daemon.ProviderUsageSnapshot{
				{
					Provider:    "codex",
					Source:      "openai-web",
					CollectedAt: now.Add(-5 * time.Minute),
					Stale:       true,
					Frame: protocol.Frame{
						Provider: "codex",
						Label:    "Codex",
						Session:  4,
						Weekly:   18,
					},
				},
			},
		}, true
	}
	server.fetchUsage = func(context.Context) ([]codexbar.ParsedFrame, error) {
		return nil, errors.New("codexbar temporarily unavailable")
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/usage", nil)
	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected stale snapshot status 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got usageResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.Source != "codexbar-display" || len(got.Providers) != 1 || !got.Providers[0].Stale {
		t.Fatalf("expected stale persisted usage, got %+v", got)
	}
}

func TestUsageUnavailableReturnsCustomerSafeError(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	server.loadUsage = func(time.Time) (daemon.PersistedUsage, bool) {
		return daemon.PersistedUsage{}, false
	}
	server.fetchUsage = func(context.Context) ([]codexbar.ParsedFrame, error) {
		return nil, errors.New("secret raw codexbar failure")
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/usage", nil)
	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected status 503, got %d body=%s", rec.Code, rec.Body.String())
	}
	body := rec.Body.String()
	if strings.Contains(body, "secret raw codexbar failure") {
		t.Fatalf("usage error leaked raw failure: %s", body)
	}
	var got errorResponse
	if err := json.Unmarshal([]byte(body), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.OK || got.Error.Code != "usage_unavailable" {
		t.Fatalf("unexpected error response: %+v", got)
	}
}

func TestCORSAllowedAndForeignOrigins(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})

	allowed := httptest.NewRecorder()
	allowedReq := httptest.NewRequest(http.MethodGet, "/v1/status", nil)
	allowedReq.Header.Set("Origin", "https://app.vibetv.shop")
	server.Handler().ServeHTTP(allowed, allowedReq)
	if got := allowed.Header().Get("Access-Control-Allow-Origin"); got != "https://app.vibetv.shop" {
		t.Fatalf("expected allowed origin header, got %q", got)
	}
	if got := allowed.Header().Get("Access-Control-Allow-Methods"); !strings.Contains(got, http.MethodPatch) {
		t.Fatalf("expected PATCH in allowed methods, got %q", got)
	}

	previewOrigin := "https://codex-vibetv-control-center-120qndufj-paul-anduschus-projects.vercel.app"
	preview := httptest.NewRecorder()
	previewReq := httptest.NewRequest(http.MethodGet, "/v1/status", nil)
	previewReq.Header.Set("Origin", previewOrigin)
	server.Handler().ServeHTTP(preview, previewReq)
	if got := preview.Header().Get("Access-Control-Allow-Origin"); got != previewOrigin {
		t.Fatalf("expected preview origin header %q, got %q", previewOrigin, got)
	}

	loopbackOrigin := "http://127.0.0.1:47832"
	loopback := httptest.NewRecorder()
	loopbackReq := httptest.NewRequest(http.MethodGet, "/v1/status", nil)
	loopbackReq.Header.Set("Origin", loopbackOrigin)
	server.Handler().ServeHTTP(loopback, loopbackReq)
	if loopback.Code != http.StatusOK {
		t.Fatalf("expected loopback origin status 200, got %d body=%s", loopback.Code, loopback.Body.String())
	}
	if got := loopback.Header().Get("Access-Control-Allow-Origin"); got != loopbackOrigin {
		t.Fatalf("expected loopback origin header %q, got %q", loopbackOrigin, got)
	}

	foreign := httptest.NewRecorder()
	foreignReq := httptest.NewRequest(http.MethodGet, "/v1/status", nil)
	foreignReq.Header.Set("Origin", "https://evil.example")
	server.Handler().ServeHTTP(foreign, foreignReq)
	if foreign.Code != http.StatusForbidden {
		t.Fatalf("expected foreign origin status 403, got %d body=%s", foreign.Code, foreign.Body.String())
	}
	if got := foreign.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("expected no CORS header for foreign origin, got %q", got)
	}
	var got errorResponse
	if err := json.Unmarshal(foreign.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode foreign origin error: %v", err)
	}
	if got.OK || got.Error.Code != "cors_origin_not_allowed" {
		t.Fatalf("unexpected foreign origin error: %+v", got)
	}
}

func TestCORSRejectsForeignPostBeforeHandlerSideEffects(t *testing.T) {
	initial := runtimeconfig.Config{
		DeviceID:     "device-1",
		DeviceTarget: "http://192.0.2.10",
		DeviceToken:  "pair-token",
		KnownDevices: []runtimeconfig.KnownDevice{{
			DeviceID:    "device-1",
			Target:      "http://192.0.2.10",
			DeviceToken: "pair-token",
		}},
	}
	server := newTestServer(t, initial)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/setup/reset", strings.NewReader("reset=1"))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Origin", "https://evil.example")
	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected foreign POST status 403, got %d body=%s", rec.Code, rec.Body.String())
	}
	current, err := server.config()
	if err != nil {
		t.Fatalf("load config after rejected foreign POST: %v", err)
	}
	if current.DeviceID != initial.DeviceID ||
		current.DeviceTarget != initial.DeviceTarget ||
		current.DeviceToken != initial.DeviceToken ||
		len(current.KnownDevices) != len(initial.KnownDevices) {
		t.Fatalf("foreign POST changed device configuration: before=%+v after=%+v", initial, current)
	}
}

func TestCORSAllowsLoopbackPostFromNativeControlCenter(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{
		DeviceID:     "device-1",
		DeviceTarget: "http://192.0.2.10",
		DeviceToken:  "pair-token",
	})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/setup/reset", nil)
	req.Header.Set("Origin", "http://127.0.0.1:47832")
	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected loopback POST status 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	current, err := server.config()
	if err != nil {
		t.Fatalf("load config after loopback POST: %v", err)
	}
	if current.DeviceID != "" || current.DeviceTarget != "" || current.DeviceToken != "" {
		t.Fatalf("expected allowed loopback POST to reset device configuration, got %+v", current)
	}
}

func TestCORSRejectsForeignVercelPreviewOrigins(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})

	for _, origin := range []string{
		"https://codex-vibetv-control-center-120qndufj-attacker.vercel.app",
		"https://other-vibetv-control-center-120qndufj-paul-anduschus-projects.vercel.app",
		"https://codex-vibetv-control-center-paul-anduschus-projects.vercel.app",
		"https://codex-vibetv-control-center-120qndufj-paul-anduschus-projects.vercel.app.evil.example",
		"http://codex-vibetv-control-center-120qndufj-paul-anduschus-projects.vercel.app",
		"https://codex-vibetv-control-center-120qndufj-paul-anduschus-projects.vercel.app:443",
	} {
		t.Run(origin, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodOptions, "/v1/status", nil)
			req.Header.Set("Origin", origin)
			req.Header.Set("Access-Control-Request-Method", http.MethodGet)
			req.Header.Set("Access-Control-Request-Private-Network", "true")
			server.Handler().ServeHTTP(rec, req)

			if rec.Code != http.StatusForbidden {
				t.Fatalf("expected preview origin %q to be forbidden, got %d body=%s", origin, rec.Code, rec.Body.String())
			}
			if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "" {
				t.Fatalf("expected no CORS origin header for %q, got %q", origin, got)
			}
		})
	}
}

func TestPrivateNetworkAccessPreflightForAllowedOrigin(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})

	allowed := httptest.NewRecorder()
	allowedReq := httptest.NewRequest(http.MethodOptions, "/v1/status", nil)
	allowedReq.Header.Set("Origin", "https://app.vibetv.shop")
	allowedReq.Header.Set("Access-Control-Request-Method", http.MethodGet)
	allowedReq.Header.Set("Access-Control-Request-Private-Network", "true")
	server.Handler().ServeHTTP(allowed, allowedReq)

	if allowed.Code != http.StatusNoContent {
		t.Fatalf("expected private network preflight 204, got %d body=%s", allowed.Code, allowed.Body.String())
	}
	if got := allowed.Header().Get("Access-Control-Allow-Origin"); got != "https://app.vibetv.shop" {
		t.Fatalf("expected allowed origin header, got %q", got)
	}
	if got := allowed.Header().Get("Access-Control-Allow-Private-Network"); got != "true" {
		t.Fatalf("expected private network allow header, got %q", got)
	}

	previewOrigin := "https://codex-vibetv-control-center-120qndufj-paul-anduschus-projects.vercel.app"
	preview := httptest.NewRecorder()
	previewReq := httptest.NewRequest(http.MethodOptions, "/v1/status", nil)
	previewReq.Header.Set("Origin", previewOrigin)
	previewReq.Header.Set("Access-Control-Request-Method", http.MethodGet)
	previewReq.Header.Set("Access-Control-Request-Private-Network", "true")
	server.Handler().ServeHTTP(preview, previewReq)

	if preview.Code != http.StatusNoContent {
		t.Fatalf("expected preview private network preflight 204, got %d body=%s", preview.Code, preview.Body.String())
	}
	if got := preview.Header().Get("Access-Control-Allow-Origin"); got != previewOrigin {
		t.Fatalf("expected preview origin header %q, got %q", previewOrigin, got)
	}
	if got := preview.Header().Get("Access-Control-Allow-Private-Network"); got != "true" {
		t.Fatalf("expected preview private network allow header, got %q", got)
	}

	foreign := httptest.NewRecorder()
	foreignReq := httptest.NewRequest(http.MethodOptions, "/v1/status", nil)
	foreignReq.Header.Set("Origin", "https://evil.example")
	foreignReq.Header.Set("Access-Control-Request-Method", http.MethodGet)
	foreignReq.Header.Set("Access-Control-Request-Private-Network", "true")
	server.Handler().ServeHTTP(foreign, foreignReq)

	if foreign.Code != http.StatusForbidden {
		t.Fatalf("expected foreign private network preflight 403, got %d body=%s", foreign.Code, foreign.Body.String())
	}
	if got := foreign.Header().Get("Access-Control-Allow-Private-Network"); got != "" {
		t.Fatalf("expected no private network allow header for foreign origin, got %q", got)
	}
}

func TestControlCenterStaticServesIndexAndAssets(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	server.controlCenterFS = fstest.MapFS{
		"index.html": {
			Data: []byte(`<!doctype html><div id="root">VibeTV Control Center</div>`),
		},
		"_next/static/app.js": {
			Data: []byte(`console.log("control-center")`),
		},
		"install/synthwave.html": {
			Data: []byte(`<!doctype html><div id="root">Install Synthwave</div>`),
		},
		"theme-packs/render/synthwave.json": {
			Data: []byte(`{"ok":true,"themeId":"synthwave"}`),
		},
	}

	for _, path := range []string{"/control-center", "/control-center/", "/control-center/usage"} {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, path, nil)
		server.Handler().ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("expected %s status 200, got %d body=%s", path, rec.Code, rec.Body.String())
		}
		if !strings.Contains(rec.Body.String(), "VibeTV Control Center") {
			t.Fatalf("expected %s to serve index, got %q", path, rec.Body.String())
		}
		if got := rec.Header().Get("Cache-Control"); got != "no-store" {
			t.Fatalf("expected %s HTML to disable caching, got Cache-Control %q", path, got)
		}
	}

	asset := httptest.NewRecorder()
	assetReq := httptest.NewRequest(http.MethodGet, "/_next/static/app.js", nil)
	server.Handler().ServeHTTP(asset, assetReq)
	if asset.Code != http.StatusOK || !strings.Contains(asset.Body.String(), "control-center") {
		t.Fatalf("expected embedded static asset, got %d body=%s", asset.Code, asset.Body.String())
	}
	if got := asset.Header().Get("Cache-Control"); got != "" {
		t.Fatalf("expected hashed static asset to retain default caching, got Cache-Control %q", got)
	}

	install := httptest.NewRecorder()
	installReq := httptest.NewRequest(http.MethodGet, "/control-center/install/synthwave", nil)
	server.Handler().ServeHTTP(install, installReq)
	if install.Code != http.StatusOK || !strings.Contains(install.Body.String(), "Install Synthwave") {
		t.Fatalf("expected exported install route, got %d body=%s", install.Code, install.Body.String())
	}
	if got := install.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("expected exported install HTML to disable caching, got Cache-Control %q", got)
	}

	theme := httptest.NewRecorder()
	themeReq := httptest.NewRequest(http.MethodGet, "/theme-packs/render/synthwave.json", nil)
	server.Handler().ServeHTTP(theme, themeReq)
	if theme.Code != http.StatusOK || !strings.Contains(theme.Body.String(), "synthwave") {
		t.Fatalf("expected embedded theme render pack, got %d body=%s", theme.Code, theme.Body.String())
	}
}

func TestCustomThemeRenderPackPersistsAcrossCompanionRestart(t *testing.T) {
	home := t.TempDir()
	server := newTestServer(t, runtimeconfig.Config{})
	server.home = home
	if err := server.persistThemeRenderPack(testThemePackZip(t)); err != nil {
		t.Fatalf("persist custom theme render pack: %v", err)
	}

	restarted := newTestServer(t, runtimeconfig.Config{})
	restarted.home = home
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/theme-packs/render/cozy-meadow.json", nil)
	restarted.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected persisted render pack status 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("expected persisted render pack to disable caching, got %q", got)
	}
	var got themeRenderPack
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode persisted render pack: %v", err)
	}
	if !got.OK || got.ThemeID != "cozy-meadow" || got.SpecPath != "/themes/u/cm.json" {
		t.Fatalf("unexpected persisted render pack: %+v", got)
	}
	if !strings.Contains(string(got.Spec), `"id":"cozy-meadow"`) {
		t.Fatalf("expected persisted custom spec, got %s", string(got.Spec))
	}
}

func TestCustomThemeRenderPackPersistsWhenDisplayRefreshFails(t *testing.T) {
	device := newThemeInstallReadyDeviceServer(t)
	defer device.Close()

	home := t.TempDir()
	server := newTestServer(t, runtimeconfig.Config{DeviceTarget: device.URL, DeviceToken: "pair-token"})
	server.home = home
	server.installTheme = func(context.Context, themeinstall.Options) (themeinstall.Result, error) {
		return themeinstall.Result{
			ThemeID:    "cozy-meadow",
			ActivePath: "/themes/u/cm.json",
		}, nil
	}
	server.refreshStream = func(context.Context, string) error {
		return errors.New("display stream unavailable")
	}

	_, err := server.runThemeInstall(
		context.Background(),
		runtimeconfig.Config{DeviceTarget: device.URL, DeviceToken: "pair-token"},
		themeInstallRequest{ThemeID: "cozy-meadow", PackBytes: testThemePackZip(t)},
		io.Discard,
	)
	if err == nil {
		t.Fatal("expected display stream refresh to fail after theme activation")
	}

	restarted := newTestServer(t, runtimeconfig.Config{})
	restarted.home = home
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/theme-packs/render/cozy-meadow.json", nil)
	restarted.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected preview cache after partial install failure, got %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestDMGControlCenterRetiresExternalBrowserUI(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	server.installationMode = "dmg"
	server.controlCenterFS = fstest.MapFS{
		"index.html": {
			Data: []byte(`<!doctype html><div id="root">VibeTV Control Center</div>`),
		},
	}

	for _, route := range []string{"/control-center", "/control-center/usage"} {
		external := httptest.NewRecorder()
		externalRequest := httptest.NewRequest(http.MethodGet, route, nil)
		externalRequest.Header.Set("User-Agent", "Mozilla/5.0")
		server.Handler().ServeHTTP(external, externalRequest)
		if external.Code != http.StatusGone {
			t.Fatalf("expected retired browser route %s status 410, got %d body=%s", route, external.Code, external.Body.String())
		}
		if !strings.Contains(external.Body.String(), "moved to the Mac App") {
			t.Fatalf("expected retired browser guidance for %s, got %q", route, external.Body.String())
		}
		if got := external.Header().Get("Cache-Control"); got != "no-store" {
			t.Fatalf("expected retired browser response to disable caching, got %q", got)
		}
	}

	native := httptest.NewRecorder()
	nativeRequest := httptest.NewRequest(http.MethodGet, "/control-center", nil)
	nativeRequest.Header.Set("User-Agent", nativeControlCenterUA+"99.0.16+163")
	server.Handler().ServeHTTP(native, nativeRequest)
	if native.Code != http.StatusOK || !strings.Contains(native.Body.String(), "VibeTV Control Center") {
		t.Fatalf("expected native Mac App to retain Control Center UI, got %d body=%s", native.Code, native.Body.String())
	}

	legacy := newTestServer(t, runtimeconfig.Config{})
	legacy.installationMode = "legacy"
	legacy.controlCenterFS = server.controlCenterFS
	legacyBrowser := httptest.NewRecorder()
	legacyRequest := httptest.NewRequest(http.MethodGet, "/control-center", nil)
	legacyRequest.Header.Set("User-Agent", "Mozilla/5.0")
	legacy.Handler().ServeHTTP(legacyBrowser, legacyRequest)
	if legacyBrowser.Code != http.StatusOK {
		t.Fatalf("expected pre-DMG legacy browser UI to remain available, got %d body=%s", legacyBrowser.Code, legacyBrowser.Body.String())
	}
}

func TestControlCenterStaticUnavailableWithoutIndex(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	server.controlCenterFS = fstest.MapFS{}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/control-center", nil)
	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected status 503, got %d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "Run setup again") {
		t.Fatalf("expected customer recovery copy, got %q", rec.Body.String())
	}
}

func TestFirmwareLatestUsesReleaseManifest(t *testing.T) {
	manifest := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/firmware-manifest.json" {
			t.Fatalf("unexpected manifest path %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"release":"v1.0.99","artifacts":[{"board":"esp8266_smalltv_st7789","firmwareVersion":"1.0.33","message":"Firmware update available."},{"board":"esp8266_smalltv_st7789","firmwareVersion":"1.0.31"}]}`))
	}))
	defer manifest.Close()
	t.Setenv(firmwareManifestEnvVar, manifest.URL+"/firmware-manifest.json")
	server := newTestServer(t, runtimeconfig.Config{})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/updates/latest?board=esp8266_smalltv_st7789&firmware=1.0.32", nil)
	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got firmwareLatestResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !got.UpdateAvailable || got.LatestFirmware != "1.0.33" || got.Status != "update_available" {
		t.Fatalf("unexpected firmware latest response: %+v", got)
	}

	none := httptest.NewRecorder()
	noneReq := httptest.NewRequest(http.MethodGet, "/v1/updates/latest?board=unknown&firmware=1.0.32", nil)
	server.Handler().ServeHTTP(none, noneReq)
	if none.Code != http.StatusOK {
		t.Fatalf("expected unknown board status 200, got %d body=%s", none.Code, none.Body.String())
	}
	var missing firmwareLatestResponse
	if err := json.Unmarshal(none.Body.Bytes(), &missing); err != nil {
		t.Fatalf("decode unknown board response: %v", err)
	}
	if missing.Status != "no_board_release" || missing.UpdateAvailable {
		t.Fatalf("unexpected unknown board response: %+v", missing)
	}
}

func TestFirmwareUpdateCommandUsesCheckedManifest(t *testing.T) {
	target := "http://192.168.178.72"
	manifestURL := "http://127.0.0.1:47833/firmware-manifest.json"

	got := firmwareUpdateCommandArgs(target, "  "+manifestURL+"  ", true)
	want := []string{
		"install-update",
		"--target",
		target,
		"--confirm-live-update",
		"--skip-launchagent-pause",
		"--manifest-url",
		manifestURL,
		"--force",
	}
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Fatalf("unexpected firmware update args:\n got: %q\nwant: %q", got, want)
	}

	withoutManifest := firmwareUpdateCommandArgs(target, "", false)
	if strings.Contains(strings.Join(withoutManifest, "\n"), "--manifest-url") {
		t.Fatalf("unexpected manifest flag without override: %q", withoutManifest)
	}
}

func TestDeviceNotFoundErrorFormat(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/device", nil)

	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected status 404, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got errorResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.OK || got.Error.Code != "device_not_found" || got.Error.Message == "" || got.Error.NextAction == "" {
		t.Fatalf("unexpected error response: %+v", got)
	}
}

func TestDeviceGetDoesNotScanSubnetWhenSavedTargetIsStale(t *testing.T) {
	stale := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "gone", http.StatusServiceUnavailable)
	}))
	defer stale.Close()

	device := newHelloDeviceServer(t)
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{DeviceTarget: stale.URL, DeviceToken: "pair-token"})
	subnetCalled := false
	server.subnetTargets = func() []string {
		subnetCalled = true
		return []string{device.URL}
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/device", nil)
	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected status 404, got %d body=%s", rec.Code, rec.Body.String())
	}
	if subnetCalled {
		t.Fatal("read-only device status must not trigger subnet discovery")
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/v1/status", nil)
	server.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	var status statusResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &status); err != nil {
		t.Fatalf("decode status: %v", err)
	}
	if status.Device.Target != stale.URL {
		t.Fatalf("expected stale target to remain unchanged until explicit discovery, got %+v", status.Device)
	}
}

func TestStatusKeepsConfiguredDeviceReconnectingDuringTransientProbeFailure(t *testing.T) {
	var available atomic.Bool
	var boot atomic.Int32
	available.Store(true)
	boot.Store(1)
	device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !available.Load() {
			http.Error(w, "temporarily unavailable", http.StatusServiceUnavailable)
			return
		}
		switch r.URL.Path {
		case "/hello":
			_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"board":"esp8266-smalltv-st7789","firmware":"1.0.44","deviceId":"vibetv-canary","networkMode":"station","capabilities":{"transport":{"active":"wifi"}}}`))
		case "/health":
			_, _ = fmt.Fprintf(w, `{"ok":true,"system":{"bootId":"boot-%d","uptimeMs":1200,"resetCount":%d,"resetReason":"Software/System restart"},"render":{"fullCount":3,"partialCount":1,"lastKind":"usage"}}`, boot.Load(), boot.Load()+3)
		default:
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
	}))
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{
		DeviceTarget: device.URL,
		DeviceToken:  "pair-token",
		DeviceID:     "vibetv-canary",
	})
	subnetCalls := atomic.Int32{}
	server.subnetTargets = func() []string {
		subnetCalls.Add(1)
		return nil
	}

	readStatus := func() statusResponse {
		rec := httptest.NewRecorder()
		server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/v1/status", nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
		}
		var got statusResponse
		if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
			t.Fatalf("decode status: %v", err)
		}
		return got
	}

	ready := readStatus()
	if !ready.Device.Ready || ready.Device.ConnectionState != deviceConnectionReady {
		t.Fatalf("expected initial ready device, got %+v", ready.Device)
	}
	available.Store(false)
	reconnecting := readStatus()
	if reconnecting.Device.ConnectionState != deviceConnectionRetrying || reconnecting.Device.Ready {
		t.Fatalf("transient timeout restarted setup instead of reconnecting: %+v", reconnecting.Device)
	}
	if !reconnecting.Device.Active || !reconnecting.Device.Paired || reconnecting.Device.DeviceID != "vibetv-canary" {
		t.Fatalf("saved active identity was not preserved: %+v", reconnecting.Device)
	}
	if reconnecting.Device.LastSeenAt == "" {
		t.Fatalf("expected last-seen timestamp, got %+v", reconnecting.Device)
	}
	if subnetCalls.Load() != 0 {
		t.Fatalf("grace-period status poll started %d subnet scans", subnetCalls.Load())
	}
	boot.Store(2)
	available.Store(true)
	recovered := readStatus()
	if !recovered.Device.Ready || recovered.Device.ConnectionState != deviceConnectionReady || recovered.Device.Health == nil || recovered.Device.Health.BootID != "boot-2" {
		t.Fatalf("device reboot did not recover automatically inside grace period: %+v", recovered.Device)
	}
	if subnetCalls.Load() != 0 {
		t.Fatalf("short reboot recovery unexpectedly scanned the subnet %d times", subnetCalls.Load())
	}
}

func TestStatusIsReadOnlyAndKeepsOfflineActiveDevice(t *testing.T) {
	var postCalls atomic.Int32
	device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			postCalls.Add(1)
		}
		http.Error(w, "offline", http.StatusServiceUnavailable)
	}))
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{
		DeviceTarget: device.URL,
		DeviceToken:  "pair-token",
		DeviceID:     "vibetv-canary",
	})
	server.subnetTargets = func() []string {
		t.Fatal("status must not scan the subnet")
		return nil
	}
	var configWrites atomic.Int32
	server.saveConfig = func(string, runtimeconfig.Config) error {
		configWrites.Add(1)
		return nil
	}

	for range 5 {
		rec := httptest.NewRecorder()
		server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/v1/status", nil))
		var got statusResponse
		if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
			t.Fatalf("decode status: %v body=%s", err, rec.Body.String())
		}
		if !got.Device.Active || got.Device.Ready || got.Device.ConnectionState != deviceConnectionRetrying {
			t.Fatalf("offline active device must remain active and reconnecting: %+v", got.Device)
		}
	}
	if postCalls.Load() != 0 || configWrites.Load() != 0 {
		t.Fatalf("status caused side effects: posts=%d configWrites=%d", postCalls.Load(), configWrites.Load())
	}
}

func TestDeviceProbesAreSingleFlightAndCached(t *testing.T) {
	var helloCalls atomic.Int32
	var healthCalls atomic.Int32
	device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hello":
			helloCalls.Add(1)
			time.Sleep(20 * time.Millisecond)
			_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"board":"esp8266-smalltv-st7789"}`))
		case "/health":
			healthCalls.Add(1)
			time.Sleep(20 * time.Millisecond)
			_, _ = w.Write([]byte(`{"ok":true}`))
		}
	}))
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{})
	server.probeCacheTime = time.Second
	var wg sync.WaitGroup
	for range 10 {
		wg.Add(2)
		go func() {
			defer wg.Done()
			if _, err := server.getHelloProbe(context.Background(), device.URL, "pair-token", time.Second); err != nil {
				t.Errorf("hello probe: %v", err)
			}
		}()
		go func() {
			defer wg.Done()
			if _, err := server.getHealthProbe(context.Background(), device.URL, "pair-token", time.Second); err != nil {
				t.Errorf("health probe: %v", err)
			}
		}()
	}
	wg.Wait()
	if helloCalls.Load() != 1 || healthCalls.Load() != 1 {
		t.Fatalf("probes were not coalesced: hello=%d health=%d", helloCalls.Load(), healthCalls.Load())
	}
}

func TestDeviceProbeFlightsOutliveTheFirstRequestCancellation(t *testing.T) {
	t.Run("hello", func(t *testing.T) {
		var calls atomic.Int32
		started := make(chan struct{})
		release := make(chan struct{})
		device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			calls.Add(1)
			close(started)
			<-release
			_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"board":"esp8266-smalltv-st7789"}`))
		}))
		defer device.Close()

		server := newTestServer(t, runtimeconfig.Config{})
		server.probeCacheTime = time.Second
		firstContext, cancelFirst := context.WithCancel(context.Background())
		firstResult := make(chan error, 1)
		go func() {
			_, err := server.getHelloProbe(firstContext, device.URL, "pair-token", time.Second)
			firstResult <- err
		}()
		<-started
		cancelFirst()
		if err := <-firstResult; !errors.Is(err, context.Canceled) {
			t.Fatalf("first request should observe its own cancellation, got %v", err)
		}

		secondResult := make(chan error, 1)
		go func() {
			_, err := server.getHelloProbe(context.Background(), device.URL, "pair-token", time.Second)
			secondResult <- err
		}()
		close(release)
		if err := <-secondResult; err != nil {
			t.Fatalf("shared hello probe was poisoned by the first cancellation: %v", err)
		}
		if calls.Load() != 1 {
			t.Fatalf("expected one detached hello probe, got %d", calls.Load())
		}
	})

	t.Run("health", func(t *testing.T) {
		var calls atomic.Int32
		started := make(chan struct{})
		release := make(chan struct{})
		device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			calls.Add(1)
			close(started)
			<-release
			_, _ = w.Write([]byte(`{"ok":true}`))
		}))
		defer device.Close()

		server := newTestServer(t, runtimeconfig.Config{})
		server.probeCacheTime = time.Second
		firstContext, cancelFirst := context.WithCancel(context.Background())
		firstResult := make(chan error, 1)
		go func() {
			_, err := server.getHealthProbe(firstContext, device.URL, "pair-token", time.Second)
			firstResult <- err
		}()
		<-started
		cancelFirst()
		if err := <-firstResult; !errors.Is(err, context.Canceled) {
			t.Fatalf("first request should observe its own cancellation, got %v", err)
		}

		secondResult := make(chan error, 1)
		go func() {
			_, err := server.getHealthProbe(context.Background(), device.URL, "pair-token", time.Second)
			secondResult <- err
		}()
		close(release)
		if err := <-secondResult; err != nil {
			t.Fatalf("shared health probe was poisoned by the first cancellation: %v", err)
		}
		if calls.Load() != 1 {
			t.Fatalf("expected one detached health probe, got %d", calls.Load())
		}
	})
}

func TestDeviceReachableButDisplayStreamNotReadyStaysConnected(t *testing.T) {
	device := newHelloDeviceServer(t)
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{DeviceTarget: device.URL, DeviceToken: "pair-token"})
	server.streamStatus = func(context.Context, string) displayStreamInfo {
		return displayStreamInfo{
			Healthy: false,
			Running: false,
			Target:  device.URL,
			Detail:  "Display stream is not loaded.",
		}
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/device", nil)
	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got struct {
		Device deviceInfo `json:"device"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !got.Device.Connected {
		t.Fatalf("expected reachable device to stay connected while display stream is not ready, got %+v", got.Device)
	}
	if got.Device.Ready {
		t.Fatalf("expected reachable device with an unhealthy display stream to stay not ready, got %+v", got.Device)
	}
	if got.Device.Stream == nil || got.Device.Stream.Healthy {
		t.Fatalf("expected unhealthy stream detail, got %+v", got.Device.Stream)
	}
}

func TestDeviceReachableButRenderFailedStaysConnected(t *testing.T) {
	device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hello":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"board":"esp8266-smalltv-st7789","firmware":"1.0.31","features":["theme","theme-spec-v1"],"capabilities":{"theme":{"supportsThemeSpecV1":true},"transport":{"active":"wifi"}}}`))
		case "/health":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true,"display":{"activeTheme":"mini-classic","themeSpec":{"active":true,"renderOk":false,"renderError":"low_heap_full_render","renderFailures":3}},"settings":{"display":{"brightnessPercent":40}}}`))
		default:
			t.Fatalf("unexpected device path %s", r.URL.Path)
		}
	}))
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{DeviceTarget: device.URL, DeviceToken: "pair-token"})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/device", nil)
	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got struct {
		Device deviceInfo `json:"device"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !got.Device.Connected {
		t.Fatalf("expected render failure to keep reachable device connected, got %+v", got.Device)
	}
	if got.Device.Ready {
		t.Fatalf("expected render failure to keep device not ready, got %+v", got.Device)
	}
	if got.Device.Stream == nil || !got.Device.Stream.Healthy {
		t.Fatalf("expected healthy stream detail, got %+v", got.Device.Stream)
	}
	if got.Device.Display == nil || got.Device.Display.ThemeSpec == nil ||
		got.Device.Display.ThemeSpec.RenderOK == nil ||
		*got.Device.Display.ThemeSpec.RenderOK ||
		got.Device.Display.ThemeSpec.RenderError != "low_heap_full_render" {
		t.Fatalf("expected render failure health, got %+v", got.Device.Display)
	}
}

func TestDeviceReadyRequiresHealthyUsageRender(t *testing.T) {
	tests := []struct {
		name          string
		healthOK      bool
		streamHealthy bool
		renderKind    string
		wantReady     bool
	}{
		{name: "usage frame", healthOK: true, streamHealthy: true, renderKind: "usage", wantReady: true},
		{name: "theme usage frame", healthOK: true, streamHealthy: true, renderKind: "theme_spec_usage", wantReady: true},
		{name: "missing render kind", healthOK: true, streamHealthy: true, renderKind: "", wantReady: false},
		{name: "wifi setup screen", healthOK: true, streamHealthy: true, renderKind: "connected_setup", wantReady: false},
		{name: "stale frame screen", healthOK: true, streamHealthy: true, renderKind: "status", wantReady: false},
		{name: "unhealthy stream", healthOK: true, streamHealthy: false, renderKind: "usage", wantReady: false},
		{name: "unhealthy device", healthOK: false, streamHealthy: true, renderKind: "usage", wantReady: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			health := deviceHealth{OK: tt.healthOK}
			fullCount := uint64(1)
			partialCount := uint64(0)
			health.Render.FullCount = &fullCount
			health.Render.PartialCount = &partialCount
			health.Render.LastKind = tt.renderKind
			device := deviceInfo{
				Connected: true,
				Paired:    true,
				Stream: &displayStreamInfo{
					Healthy: tt.streamHealthy,
				},
			}

			got := withDeviceHealth(device, health)
			if got.Ready != tt.wantReady {
				t.Fatalf("ready=%v want %v for health=%+v stream=%+v", got.Ready, tt.wantReady, health, device.Stream)
			}
		})
	}

	healthWithoutCounters := deviceHealth{OK: true}
	healthWithoutCounters.Render.LastKind = "usage"
	device := deviceInfo{
		Connected: true,
		Paired:    true,
		Stream:    &displayStreamInfo{Healthy: true},
	}
	if got := withDeviceHealth(device, healthWithoutCounters); got.Ready {
		t.Fatalf("device without render counters must not become ready: %+v", got)
	}
}

func TestWaitForDisplayRenderRequiresCounterAdvance(t *testing.T) {
	var calls atomic.Int32
	device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/health" {
			t.Fatalf("unexpected device path %s", r.URL.Path)
		}
		fullCount := 5
		if calls.Add(1) > 1 {
			fullCount = 6
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprintf(
			w,
			`{"ok":true,"render":{"fullCount":%d,"partialCount":2,"lastKind":"usage"}}`,
			fullCount,
		)
	}))
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{})
	server.client = device.Client()
	baselineFull := uint64(5)
	baselinePartial := uint64(2)
	baseline := deviceHealth{OK: true}
	baseline.Render.FullCount = &baselineFull
	baseline.Render.PartialCount = &baselinePartial
	baseline.Render.LastKind = "usage"

	health, err := server.waitForDisplayRender(context.Background(), device.URL, "pair-token", baseline)
	if err != nil {
		t.Fatalf("wait for fresh render: %v", err)
	}
	if calls.Load() != 2 {
		t.Fatalf("health probes=%d want 2 so stale counters are rejected", calls.Load())
	}
	if health.Render.FullCount == nil || *health.Render.FullCount != 6 {
		t.Fatalf("expected advanced full render counter, got %+v", health.Render)
	}
}

func TestDisplayRenderAdvancedRequiresMonotonicCounters(t *testing.T) {
	health := func(full, partial uint64, includeCounters bool) deviceHealth {
		got := deviceHealth{OK: true}
		got.Render.LastKind = "usage"
		if includeCounters {
			got.Render.FullCount = &full
			got.Render.PartialCount = &partial
		}
		return got
	}
	tests := []struct {
		name     string
		baseline deviceHealth
		current  deviceHealth
		want     bool
	}{
		{name: "full render advanced", baseline: health(5, 2, true), current: health(6, 2, true), want: true},
		{name: "partial render advanced", baseline: health(5, 2, true), current: health(5, 3, true), want: true},
		{name: "unchanged", baseline: health(5, 2, true), current: health(5, 2, true)},
		{name: "missing baseline counters", baseline: health(0, 0, false), current: health(1, 0, true)},
		{name: "missing current counters", baseline: health(1, 0, true), current: health(0, 0, false)},
		{name: "counter regression", baseline: health(5, 2, true), current: health(4, 3, true)},
		{name: "device reboot", baseline: health(5, 2, true), current: health(0, 0, true)},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := displayRenderAdvanced(tt.baseline, tt.current); got != tt.want {
				t.Fatalf("displayRenderAdvanced=%v want %v", got, tt.want)
			}
		})
	}
}

func TestRenderHealthyRequiresCountersAndUsageKind(t *testing.T) {
	health := deviceHealth{OK: true}
	health.Render.LastKind = "usage"
	if renderHealthyFromHealth(health) {
		t.Fatal("missing counters must not be healthy")
	}
	fullCount := uint64(1)
	partialCount := uint64(0)
	health.Render.FullCount = &fullCount
	health.Render.PartialCount = &partialCount
	if !renderHealthyFromHealth(health) {
		t.Fatal("legacy usage render without ThemeSpec health should be healthy")
	}
	renderOK := true
	health.Display.ThemeSpec.RenderOK = &renderOK
	if renderHealthyFromHealth(health) {
		t.Fatal("explicitly inactive ThemeSpec is the Theme missing screen, not a healthy usage render")
	}
	health.Display.ThemeSpec.Active = true
	if !renderHealthyFromHealth(health) {
		t.Fatal("active successful ThemeSpec usage render should be healthy")
	}
	health.Render.LastKind = ""
	if renderHealthyFromHealth(health) {
		t.Fatal("empty render kind must not be healthy")
	}
	health.Render.LastKind = "connected_setup"
	if renderHealthyFromHealth(health) {
		t.Fatal("WiFi setup screen must not be healthy")
	}
	for _, localRenderKind := range []string{"reset", "update_notice"} {
		health.Render.LastKind = localRenderKind
		if renderHealthyFromHealth(health) {
			t.Fatalf("local %s render must not prove that the Mac sent a frame", localRenderKind)
		}
	}
}

func TestCorrelatedOverlayProvesFirmware135FirstUsageRender(t *testing.T) {
	target := "http://192.168.178.72"
	boolPtr := func(value bool) *bool { return &value }
	health := func(full, partial uint64, kind string) deviceHealth {
		got := deviceHealth{OK: true}
		got.Render.FullCount = &full
		got.Render.PartialCount = &partial
		got.Render.LastKind = kind
		return got
	}
	baseline := health(3, 0, "connected_setup")
	current := health(4, 2, "reset")
	current.Display.ThemeSpec.Active = true
	current.Display.ThemeSpec.RenderOK = boolPtr(true)
	stream := displayStreamInfo{
		Running:    true,
		Healthy:    true,
		LastTarget: target,
	}

	if !correlatedOverlayProvesUsage(baseline, current, stream, target) {
		t.Fatal("fresh exact-target frame plus full render and reset tail should prove the first usage render")
	}
	current.Render.LastKind = "update_notice"
	if !correlatedOverlayProvesUsage(baseline, current, stream, target) {
		t.Fatal("firmware update notice may mask an otherwise proven first usage render")
	}
	if !correlatedOverlayProvesUsage(health(3, 0, "usage"), current, stream, target) {
		t.Fatal("fresh exact-target frame plus a full redraw should also prove reload from a live baseline")
	}
	resetCountdown := health(3, 1, "reset")
	resetCountdown.Display.ThemeSpec.Active = true
	resetCountdown.Display.ThemeSpec.RenderOK = boolPtr(true)
	if !correlatedOverlayProvesUsage(baseline, resetCountdown, stream, target) {
		t.Fatal("fresh exact-target frame plus an advanced reset countdown render should prove the active usage surface")
	}
	updateNoticeOnly := resetCountdown
	updateNoticeOnly.Render.LastKind = "update_notice"
	if !correlatedOverlayProvesUsage(baseline, updateNoticeOnly, stream, target) {
		t.Fatal("a fresh exact-target frame plus an advanced update notice must prove the active usage surface")
	}

	tests := []struct {
		name     string
		baseline deviceHealth
		current  deviceHealth
		stream   displayStreamInfo
		target   string
	}{
		{
			name:     "reset without advanced render",
			baseline: baseline,
			current: func() deviceHealth {
				got := current
				full := uint64(3)
				partial := uint64(0)
				got.Render.FullCount = &full
				got.Render.PartialCount = &partial
				return got
			}(),
			stream: stream,
			target: target,
		},
		{
			name:     "partial counter regression",
			baseline: health(3, 3, "connected_setup"),
			current:  current,
			stream:   stream,
			target:   target,
		},
		{
			name:     "wrong frame target",
			baseline: baseline,
			current:  current,
			stream: func() displayStreamInfo {
				got := stream
				got.LastTarget = "http://192.168.178.73"
				return got
			}(),
			target: target,
		},
		{
			name:     "expected launch agent not running",
			baseline: baseline,
			current:  current,
			stream: func() displayStreamInfo {
				got := stream
				got.Running = false
				return got
			}(),
			target: target,
		},
		{
			name:     "theme render failed",
			baseline: baseline,
			current: func() deviceHealth {
				got := current
				got.Display.ThemeSpec.RenderOK = boolPtr(false)
				return got
			}(),
			stream: stream,
			target: target,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if correlatedOverlayProvesUsage(tt.baseline, tt.current, tt.stream, tt.target) {
				t.Fatal("ambiguous overlay state must not prove a fresh usage render")
			}
		})
	}
}

func TestWaitForVerifiedDisplayRenderMarksCorrelatedOverlayProof(t *testing.T) {
	target := "http://192.168.178.72"
	baselineFull := uint64(3)
	baselinePartial := uint64(0)
	baseline := deviceHealth{OK: true}
	baseline.Render.FullCount = &baselineFull
	baseline.Render.PartialCount = &baselinePartial
	baseline.Render.LastKind = "connected_setup"

	currentFull := uint64(4)
	currentPartial := uint64(2)
	renderOK := true
	current := deviceHealth{OK: true}
	current.Render.FullCount = &currentFull
	current.Render.PartialCount = &currentPartial
	current.Render.LastKind = "reset"
	current.Display.ThemeSpec.Active = true
	current.Display.ThemeSpec.RenderOK = &renderOK
	stream := displayStreamInfo{Running: true, Healthy: true, LastTarget: target}

	server := newTestServer(t, runtimeconfig.Config{})
	server.waitRender = func(context.Context, string, string, deviceHealth) (deviceHealth, error) {
		return current, errors.New("lastKind=reset")
	}
	health, err := server.waitForVerifiedDisplayRender(context.Background(), target, "pair-token", baseline, stream)
	if err != nil {
		t.Fatalf("correlated overlay proof returned error: %v", err)
	}
	if !health.correlatedFrameProof {
		t.Fatal("correlated overlay proof marker was not set")
	}
	device := deviceInfo{Target: target, Connected: true, Paired: true, Stream: &stream}
	if got := server.withVerifiedDeviceHealth(device, health, target, "pair-token", true); !got.Ready {
		t.Fatalf("correlated first-frame proof should make the device ready: %+v", got)
	}
}

func TestDeviceHealthTimeoutStaysConnected(t *testing.T) {
	oldProbeTime := deviceHealthProbeTime
	deviceHealthProbeTime = 20 * time.Millisecond
	t.Cleanup(func() {
		deviceHealthProbeTime = oldProbeTime
	})

	device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hello":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"board":"esp8266-smalltv-st7789","firmware":"1.0.35","capabilities":{"transport":{"active":"wifi"}}}`))
		case "/health":
			<-r.Context().Done()
		default:
			t.Fatalf("unexpected device path %s", r.URL.Path)
		}
	}))
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{DeviceTarget: device.URL, DeviceToken: "pair-token"})
	startedAt := time.Now()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/device", nil)
	server.Handler().ServeHTTP(rec, req)

	if elapsed := time.Since(startedAt); elapsed > time.Second {
		t.Fatalf("expected health timeout to return quickly, took %s", elapsed)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got struct {
		Device deviceInfo `json:"device"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !got.Device.Connected || got.Device.Firmware != "1.0.35" {
		t.Fatalf("expected hello details to stay available, got %+v", got.Device)
	}
	if got.Device.Health == nil || got.Device.Health.OK || got.Device.Health.Error == "" {
		t.Fatalf("expected degraded health metadata, got %+v", got.Device.Health)
	}
}

func TestDeviceHealthReportsResetReason(t *testing.T) {
	device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hello":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"board":"esp8266-smalltv-st7789","firmware":"1.0.35","capabilities":{"transport":{"active":"wifi"}}}`))
		case "/health":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true,"system":{"bootId":"00abc123-7-deadbeef","uptimeMs":2500,"resetCount":7,"resetReason":"Exception"},"settings":{"display":{"brightnessPercent":40}}}`))
		default:
			t.Fatalf("unexpected device path %s", r.URL.Path)
		}
	}))
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{DeviceTarget: device.URL, DeviceToken: "pair-token"})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/device", nil)
	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got struct {
		Device deviceInfo `json:"device"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.Device.Health == nil || !got.Device.Health.OK || got.Device.Health.ResetReason != "Exception" {
		t.Fatalf("expected reset reason in health metadata, got %+v", got.Device.Health)
	}
	if got.Device.Health.BootID != "00abc123-7-deadbeef" || got.Device.Health.UptimeMs != 2500 || got.Device.Health.ResetCount != 7 || got.Device.Health.LastResetAt == "" {
		t.Fatalf("expected boot identity, uptime, counter, and reset timestamp, got %+v", got.Device.Health)
	}
}

func TestDeviceReloadDisplayWaitsForRenderHealth(t *testing.T) {
	var healthCalls int
	device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hello":
			if got := r.Header.Get("X-VibeTV-Token"); got != "pair-token" {
				t.Fatalf("expected pairing token for hello, got %q", got)
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"board":"esp8266-smalltv-st7789","firmware":"1.0.31","features":["theme","theme-spec-v1"],"capabilities":{"theme":{"supportsThemeSpecV1":true},"transport":{"active":"wifi"}}}`))
		case "/health":
			if got := r.Header.Get("X-VibeTV-Token"); got != "pair-token" {
				t.Fatalf("expected pairing token for health, got %q", got)
			}
			healthCalls++
			w.Header().Set("Content-Type", "application/json")
			if healthCalls == 1 {
				_, _ = w.Write([]byte(`{"ok":true,"display":{"activeTheme":"clippy","themeSpec":{"active":true,"renderOk":false,"renderError":"low_heap_full_render","renderFailures":1}},"render":{"fullCount":1,"partialCount":0,"lastKind":"connected_setup"},"settings":{"display":{"brightnessPercent":40}}}`))
				return
			}
			_, _ = w.Write([]byte(`{"ok":true,"display":{"activeTheme":"clippy","themeSpec":{"active":true,"renderOk":true,"renderFailures":1}},"render":{"fullCount":2,"partialCount":0,"lastKind":"usage"},"settings":{"display":{"brightnessPercent":40}}}`))
		default:
			t.Fatalf("unexpected device path %s", r.URL.Path)
		}
	}))
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{DeviceTarget: device.URL, DeviceToken: "pair-token"})
	server.waitRender = nil
	var setupCalls []setup.Options
	server.runSetup = func(_ context.Context, opts setup.Options) error {
		setupCalls = append(setupCalls, opts)
		return nil
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/device/reload-display", nil)
	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got deviceActionResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !got.OK || !got.Device.Connected || !got.Device.Paired {
		t.Fatalf("expected reload response to become connected after render recovery, got %+v", got)
	}
	if got.Device.Display == nil || got.Device.Display.ThemeSpec == nil ||
		got.Device.Display.ThemeSpec.RenderOK == nil ||
		!*got.Device.Display.ThemeSpec.RenderOK {
		t.Fatalf("expected healthy render state in response, got %+v", got.Device.Display)
	}
	if healthCalls < 2 {
		t.Fatalf("expected reload to wait for render health, got %d health call(s)", healthCalls)
	}
	if len(setupCalls) != 2 {
		t.Fatalf("expected validate and apply display stream calls, got %+v", setupCalls)
	}
	if !setupCalls[0].ValidateOnly || setupCalls[1].ValidateOnly {
		t.Fatalf("expected validate then apply setup calls, got %+v", setupCalls)
	}
}

func TestDiagnosticsWorksWithoutDeviceTarget(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/diagnostics", nil)

	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got diagnosticsResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !got.OK || got.Companion.Status != "ready" || got.GeneratedAt == "" {
		t.Fatalf("unexpected diagnostics response: %+v", got)
	}
	if got.SchemaVersion != 2 || got.ReportType != "control_center" {
		t.Fatalf("expected versioned control center report, got %+v", got)
	}
	if got.Environment.OS == "" || got.Environment.Arch == "" || got.Environment.GoVersion == "" {
		t.Fatalf("expected runtime environment, got %+v", got.Environment)
	}
	if got.Device.Connected || got.Device.Target != "" {
		t.Fatalf("expected no connected device target, got %+v", got.Device)
	}
	if !hasDiagnosticCheck(got.Checks, "device_target", "attention") {
		t.Fatalf("expected missing target diagnostic, got %+v", got.Checks)
	}
}

func TestDiagnosticsFindsVibeTVOnWiFiWithoutSelectingIt(t *testing.T) {
	device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/hello" {
			t.Fatalf("unexpected device path %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"deviceId":"wifi-vibetv","board":"esp8266-smalltv-st7789","firmware":"1.0.31","networkMode":"station"}`))
	}))
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{})
	server.subnetTargets = func() []string { return []string{device.URL} }
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/diagnostics", nil)

	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got diagnosticsResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !got.NetworkDiscovery.Attempted || !got.NetworkDiscovery.Complete || !got.NetworkDiscovery.Found || len(got.NetworkDiscovery.Devices) != 1 {
		t.Fatalf("expected one VibeTV in read-only WiFi search, got %+v", got.NetworkDiscovery)
	}
	if got.NetworkDiscovery.Devices[0].DeviceID != "wifi-vibetv" {
		t.Fatalf("unexpected discovered VibeTV: %+v", got.NetworkDiscovery.Devices[0])
	}
	if !hasDiagnosticCheck(got.Checks, "network_discovery", "pass") {
		t.Fatalf("expected discovery pass check, got %+v", got.Checks)
	}
	saved, err := server.config()
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	if saved.DeviceTarget != "" || saved.DeviceID != "" || len(saved.KnownDevices) != 0 {
		t.Fatalf("diagnostics must not select or remember a VibeTV, got %+v", saved)
	}
}

func TestDiagnosticsMarksTimedOutWiFiSearchIncomplete(t *testing.T) {
	device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		<-r.Context().Done()
	}))
	defer device.Close()

	previousTimeout := diagnosticsDiscoveryTime
	diagnosticsDiscoveryTime = 20 * time.Millisecond
	t.Cleanup(func() { diagnosticsDiscoveryTime = previousTimeout })

	server := newTestServer(t, runtimeconfig.Config{})
	server.subnetTargets = func() []string { return []string{device.URL} }
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/diagnostics", nil)

	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got diagnosticsResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !got.NetworkDiscovery.Attempted || got.NetworkDiscovery.Complete || got.NetworkDiscovery.Found {
		t.Fatalf("expected an incomplete WiFi search, got %+v", got.NetworkDiscovery)
	}
	if got.NetworkDiscovery.ErrorCode != "device_search_incomplete" {
		t.Fatalf("expected incomplete search error, got %+v", got.NetworkDiscovery)
	}
	if !hasDiagnosticCheck(got.Checks, "network_discovery", "attention") {
		t.Fatalf("expected discovery attention check, got %+v", got.Checks)
	}
}

func TestDiagnosticsReportsDeviceWithoutLeakingToken(t *testing.T) {
	device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("X-VibeTV-Token"); got != "" && got != "pair-token" {
			t.Fatalf("expected pairing token header for device request, got %q", got)
		}
		switch r.URL.Path {
		case "/hello":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"board":"esp8266-smalltv-st7789","firmware":"1.0.31","capabilities":{"theme":{"supportsThemeSpecV1":true},"transport":{"active":"wifi"}}}`))
		case "/health":
			if got := r.Header.Get("X-VibeTV-Token"); got != "pair-token" {
				t.Fatalf("expected pairing token header for health request, got %q", got)
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true,"display":{"activeTheme":"synthwave"},"settings":{"display":{"brightnessPercent":40}}}`))
		default:
			t.Fatalf("unexpected device path %s", r.URL.Path)
		}
	}))
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{DeviceTarget: device.URL, DeviceToken: "pair-token"})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/diagnostics", nil)

	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	body := rec.Body.String()
	if strings.Contains(body, "pair-token") {
		t.Fatalf("diagnostics leaked pairing token: %s", body)
	}
	var got diagnosticsResponse
	if err := json.Unmarshal([]byte(body), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !got.Device.Connected || !got.Device.Paired || got.Device.ActiveTheme != "synthwave" {
		t.Fatalf("unexpected device diagnostics: %+v", got.Device)
	}
	if !got.Configuration.HasPairingToken || got.Configuration.DeviceTarget != device.URL {
		t.Fatalf("expected redacted configuration summary, got %+v", got.Configuration)
	}
	if !hasDiagnosticCheck(got.Checks, "device_hello", "pass") {
		t.Fatalf("expected hello pass check, got %+v", got.Checks)
	}
	if !hasDiagnosticCheck(got.Checks, "device_health", "pass") {
		t.Fatalf("expected health pass check, got %+v", got.Checks)
	}
}

func TestDiagnosticsRedactsPublicTargetCredentials(t *testing.T) {
	device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/setup/hello":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"board":"esp8266-smalltv-st7789","capabilities":{"transport":{"active":"wifi"}}}`))
		case "/setup/health":
			http.Error(w, "health unavailable", http.StatusServiceUnavailable)
		default:
			t.Fatalf("unexpected device path %s", r.URL.Path)
		}
	}))
	defer device.Close()

	target := strings.Replace(device.URL, "http://", "http://user:secret@", 1) + "/setup?token=pair-token"
	expectedPublicTarget := device.URL + "/setup"
	server := newTestServer(t, runtimeconfig.Config{DeviceTarget: target, DeviceToken: "pair-token"})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/diagnostics", nil)

	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	body := rec.Body.String()
	for _, sensitive := range []string{"user:secret", "pair-token", "token="} {
		if strings.Contains(body, sensitive) {
			t.Fatalf("diagnostics leaked %q in body: %s", sensitive, body)
		}
	}
	var got diagnosticsResponse
	if err := json.Unmarshal([]byte(body), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.Device.Target != expectedPublicTarget {
		t.Fatalf("expected public target without credentials or query, got %q", got.Device.Target)
	}
	if !hasDiagnosticCheck(got.Checks, "device_target", "pass") {
		t.Fatalf("expected device target pass check, got %+v", got.Checks)
	}
	if got := diagnosticCheckDetail(got.Checks, "device_target"); got != expectedPublicTarget {
		t.Fatalf("expected redacted target detail %q, got %q", expectedPublicTarget, got)
	}
}

func TestSanitizeErrorDetailRedactsURLCredentials(t *testing.T) {
	detail := sanitizeErrorDetail(errors.New("GET http://user:secret@192.0.2.10/setup?token=pair-token&key=api-key failed"))

	for _, sensitive := range []string{"user:secret", "pair-token", "api-key"} {
		if strings.Contains(detail, sensitive) {
			t.Fatalf("sanitized detail leaked %q: %s", sensitive, detail)
		}
	}
	for _, expected := range []string{"http://<redacted>@192.0.2.10", "token=<redacted>", "key=<redacted>"} {
		if !strings.Contains(detail, expected) {
			t.Fatalf("sanitized detail missing %q: %s", expected, detail)
		}
	}
}

func TestSplitInstallLogStripsPrivateURLDetails(t *testing.T) {
	logs := splitInstallLog("Theme source: https://user:secret@example.com/theme.zip?token=abc&expires=soon#frag\nDone\n")
	want := []string{
		"Theme source: https://example.com/theme.zip",
		"Done",
	}
	if len(logs) != len(want) {
		t.Fatalf("expected %d log lines, got %d: %#v", len(want), len(logs), logs)
	}
	for i := range want {
		if logs[i] != want[i] {
			t.Fatalf("log line %d = %q, want %q", i, logs[i], want[i])
		}
	}
}

func TestDeviceDiscoverFallsBackToSubnetCandidateAndPersistsTarget(t *testing.T) {
	oldSubnetProbeTime := subnetProbeTime
	subnetProbeTime = 2 * time.Second
	t.Cleanup(func() { subnetProbeTime = oldSubnetProbeTime })

	stale := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "gone", http.StatusServiceUnavailable)
	}))
	defer stale.Close()

	device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hello":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"board":"esp8266-smalltv-st7789","firmware":"1.0.31","capabilities":{"theme":{"supportsThemeSpecV1":true},"transport":{"active":"wifi"}}}`))
		case "/health":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true,"display":{"activeTheme":"claude-creature","themeSpec":{"active":true,"path":"/themes/u/claude--1-12ab01.json","renderOk":true}},"settings":{"display":{"brightnessPercent":40}}}`))
		default:
			t.Fatalf("unexpected device path %s", r.URL.Path)
		}
	}))
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{DeviceTarget: stale.URL, DeviceToken: "pair-token"})
	server.subnetTargets = func() []string {
		return []string{device.URL}
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/device/discover", strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json")

	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got struct {
		OK     bool       `json:"ok"`
		Device deviceInfo `json:"device"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !got.OK || !got.Device.Connected || got.Device.Target != device.URL {
		t.Fatalf("unexpected discovery response: %+v", got)
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/v1/status", nil)
	server.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	var status statusResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &status); err != nil {
		t.Fatalf("decode status: %v", err)
	}
	if status.Device.Target != device.URL {
		t.Fatalf("expected persisted device target %q, got %+v", device.URL, status.Device)
	}
	if status.Device.Firmware != "1.0.31" || status.Device.ActiveTheme != "claude-creature" {
		t.Fatalf("expected status to include live device details, got %+v", status.Device)
	}
	if status.Device.Display == nil || status.Device.Display.ThemeSpec == nil ||
		!status.Device.Display.ThemeSpec.Active {
		t.Fatalf("expected status to include theme render health, got %+v", status.Device.Display)
	}
}

func TestDeviceDiscoverReturnsConflictForMultipleSubnetCandidates(t *testing.T) {
	stale := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "gone", http.StatusServiceUnavailable)
	}))
	defer stale.Close()

	first := newHelloDeviceServer(t)
	defer first.Close()
	second := newHelloDeviceServer(t)
	defer second.Close()

	server := newTestServer(t, runtimeconfig.Config{DeviceTarget: stale.URL})
	server.subnetTargets = func() []string {
		return []string{first.URL, second.URL}
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/device/discover", strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json")

	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusConflict {
		t.Fatalf("expected status 409, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got errorResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.OK || got.Error.Code != "multiple_devices_found" {
		t.Fatalf("unexpected multiple-devices response: %+v", got)
	}
	if got.Error.NextAction == "" {
		t.Fatalf("expected next action for manual target entry")
	}
}

func TestDeviceDiscoverIgnoresStaleSavedToken(t *testing.T) {
	device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hello":
			if got := strings.TrimSpace(r.Header.Get("X-VibeTV-Token")); got != "" {
				http.Error(w, "stale token", http.StatusForbidden)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"board":"esp8266-smalltv-st7789","firmware":"1.0.35","capabilities":{"transport":{"active":"wifi"}}}`))
		default:
			t.Fatalf("unexpected device path %s", r.URL.Path)
		}
	}))
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{DeviceTarget: device.URL, DeviceToken: "stale-token"})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/device/discover", strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json")

	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got struct {
		OK     bool       `json:"ok"`
		Device deviceInfo `json:"device"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !got.OK || got.Device.Target != device.URL || !got.Device.Connected {
		t.Fatalf("unexpected discovery response: %+v", got)
	}
}

func TestDeviceRepairFallsBackToSubnetAndRefreshesDisplayStream(t *testing.T) {
	stale := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "gone", http.StatusServiceUnavailable)
	}))
	defer stale.Close()

	device := newRepairableDeviceServer(t)
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{DeviceTarget: stale.URL, DeviceToken: "existing-token"})
	server.subnetTargets = func() []string {
		return []string{device.URL}
	}
	var setupCalls []setup.Options
	server.runSetup = func(_ context.Context, opts setup.Options) error {
		setupCalls = append(setupCalls, opts)
		return nil
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/device/repair", strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json")

	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got deviceActionResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !got.OK || !got.Device.Connected || !got.Device.Paired || !got.Device.Ready || got.Device.Target != device.URL {
		t.Fatalf("unexpected repair response: %+v", got)
	}
	if len(setupCalls) != 2 {
		t.Fatalf("expected validate and apply display stream calls, got %+v", setupCalls)
	}
	for index, call := range setupCalls {
		if call.Transport != "wifi" || call.Target != device.URL || !call.AssumeYes || !call.SkipFlash {
			t.Fatalf("setup call %d must refresh wifi stream without flashing, got %+v", index, call)
		}
	}
	if !setupCalls[0].ValidateOnly || setupCalls[1].ValidateOnly {
		t.Fatalf("expected validate then apply setup calls, got %+v", setupCalls)
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/v1/status", nil)
	server.Handler().ServeHTTP(rec, req)
	var status statusResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &status); err != nil {
		t.Fatalf("decode status: %v", err)
	}
	if status.Device.Target != device.URL || !status.Device.Paired {
		t.Fatalf("expected persisted repaired target and token, got %+v", status.Device)
	}
}

func TestDeviceRepairFindsActiveDeviceAtNewIPWithoutPairing(t *testing.T) {
	const deviceID = "vibetv-moved"
	const token = "saved-token"
	stale := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "old address", http.StatusServiceUnavailable)
	}))
	defer stale.Close()
	var pairCalls atomic.Int32
	device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hello":
			if r.Header.Get("X-VibeTV-Token") != token {
				http.Error(w, "pairing required", http.StatusUnauthorized)
				return
			}
			_, _ = fmt.Fprintf(w, `{"kind":"hello","protocolVersion":2,"board":"esp8266-smalltv-st7789","deviceId":%q,"networkMode":"station","capabilities":{"transport":{"active":"wifi"}}}`, deviceID)
		case "/health":
			_, _ = w.Write([]byte(`{"ok":true,"render":{"fullCount":2,"partialCount":0,"lastKind":"usage"}}`))
		case "/api/pair":
			pairCalls.Add(1)
		default:
			t.Fatalf("unexpected device path %s", r.URL.Path)
		}
	}))
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{
		DeviceTarget: stale.URL,
		DeviceToken:  token,
		DeviceID:     deviceID,
	})
	server.subnetTargets = func() []string { return []string{device.URL} }
	got, err := server.repairDevice(context.Background(), "", deviceID, false)
	if err != nil {
		t.Fatal(err)
	}
	if !got.Active || !got.Ready || got.Target != device.URL || pairCalls.Load() != 0 {
		t.Fatalf("unexpected reconnect: device=%+v pairCalls=%d", got, pairCalls.Load())
	}
	cfg, err := server.config()
	if err != nil || cfg.DeviceID != deviceID || cfg.DeviceTarget != device.URL || cfg.DeviceToken != token {
		t.Fatalf("reconnect did not preserve active profile: cfg=%+v err=%v", cfg, err)
	}
}

func TestDeviceRepairRetriesTransientDiscoveryMiss(t *testing.T) {
	stale := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "gone", http.StatusServiceUnavailable)
	}))
	defer stale.Close()

	device := newRepairableDeviceServer(t)
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{DeviceTarget: stale.URL})
	server.client.Transport = roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if strings.EqualFold(strings.TrimSuffix(req.URL.Hostname(), "."), "192.0.2.10") {
			return nil, errors.New("mdns lookup failed")
		}
		return http.DefaultTransport.RoundTrip(req)
	})
	var subnetCalls int
	server.subnetTargets = func() []string {
		subnetCalls++
		if subnetCalls == 1 {
			return nil
		}
		return []string{device.URL}
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/device/repair", strings.NewReader(`{"forcePair":true}`))
	req.Header.Set("Content-Type", "application/json")

	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200 after retry, got %d body=%s", rec.Code, rec.Body.String())
	}
	if subnetCalls < 2 {
		t.Fatalf("expected discovery retry, got %d subnet calls", subnetCalls)
	}
	var got deviceActionResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !got.OK || !got.Device.Connected || !got.Device.Paired || got.Device.Target != device.URL {
		t.Fatalf("unexpected repair response after retry: %+v", got)
	}
}

func TestDeviceRepairRetriesExplicitTargetTransientMiss(t *testing.T) {
	var helloCalls int
	device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hello":
			helloCalls++
			if helloCalls < 3 {
				http.Error(w, "warming up", http.StatusServiceUnavailable)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"board":"esp8266-smalltv-st7789","firmware":"1.0.31","capabilities":{"transport":{"active":"wifi"}}}`))
		case "/api/pair":
			if r.Method != http.MethodPost {
				t.Fatalf("expected POST pair, got %s", r.Method)
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true,"token":"new-token"}`))
		case "/health":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true,"display":{"activeTheme":"mini-classic","themeSpec":{"active":true,"renderOk":true}},"settings":{"display":{"brightnessPercent":40}}}`))
		default:
			t.Fatalf("unexpected device path %s", r.URL.Path)
		}
	}))
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/device/repair", strings.NewReader(`{"target":"`+device.URL+`","forcePair":true}`))
	req.Header.Set("Content-Type", "application/json")

	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200 after explicit retry, got %d body=%s", rec.Code, rec.Body.String())
	}
	if helloCalls < 3 {
		t.Fatalf("expected explicit target retry, got %d hello calls", helloCalls)
	}
	var got deviceActionResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !got.OK || !got.Device.Connected || !got.Device.Paired || got.Device.Target != device.URL {
		t.Fatalf("unexpected repair response after explicit retry: %+v", got)
	}
}

func TestDeviceRepairRecoversLastLogTargetWhenConfigIsEmpty(t *testing.T) {
	device := newRepairableDeviceServer(t)
	defer device.Close()

	logPath := filepath.Join(t.TempDir(), "daemon.out.log")
	t.Setenv(displayStreamOutLogEnv, logPath)
	if err := os.WriteFile(logPath, []byte("2026-07-09T07:44:45Z sent frame -> "+device.URL+" transport=wifi source=oauth\n"), 0o644); err != nil {
		t.Fatalf("write display stream log: %v", err)
	}

	server := newTestServer(t, runtimeconfig.Config{})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/device/repair", strings.NewReader(`{"forcePair":true}`))
	req.Header.Set("Content-Type", "application/json")

	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200 after recovering log target, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got deviceActionResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !got.OK || !got.Device.Connected || !got.Device.Paired || got.Device.Target != device.URL {
		t.Fatalf("unexpected repair response after log target recovery: %+v", got)
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/v1/status", nil)
	server.Handler().ServeHTTP(rec, req)
	var status statusResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &status); err != nil {
		t.Fatalf("decode status: %v", err)
	}
	if status.Device.Target != device.URL || !status.Device.Paired {
		t.Fatalf("expected recovered target to be persisted, got %+v", status.Device)
	}
}

func TestDeviceRepairMigratesStoredLegacyMDNSTargetToSubnetIP(t *testing.T) {
	device := newRepairableDeviceServer(t)
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{DeviceTarget: "http://vibetv.local"})
	server.client.Transport = roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if strings.EqualFold(strings.TrimSuffix(req.URL.Hostname(), "."), "vibetv.local") {
			return nil, errors.New("mdns lookup failed")
		}
		return http.DefaultTransport.RoundTrip(req)
	})
	server.subnetTargets = func() []string {
		return []string{device.URL}
	}
	var setupCalls []setup.Options
	server.runSetup = func(_ context.Context, opts setup.Options) error {
		setupCalls = append(setupCalls, opts)
		return nil
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/device/repair", strings.NewReader(`{"forcePair":true}`))
	req.Header.Set("Content-Type", "application/json")

	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got deviceActionResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !got.OK || got.Device.Target != device.URL || !got.Device.Paired {
		t.Fatalf("expected subnet repair target %q, got %+v", device.URL, got)
	}
	if len(setupCalls) == 0 || setupCalls[len(setupCalls)-1].Target != device.URL {
		t.Fatalf("expected display stream refreshed with discovered target, got %+v", setupCalls)
	}
}

func TestDeviceRepairForcePairRotatesToken(t *testing.T) {
	device := newRepairableDeviceServer(t)
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{DeviceTarget: device.URL, DeviceToken: "old-token"})
	var setupCalls []setup.Options
	server.runSetup = func(_ context.Context, opts setup.Options) error {
		setupCalls = append(setupCalls, opts)
		return nil
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/device/repair", strings.NewReader(`{"forcePair":true}`))
	req.Header.Set("Content-Type", "application/json")

	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got deviceActionResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !got.Device.Paired {
		t.Fatalf("expected paired device, got %+v", got.Device)
	}
	if len(setupCalls) != 2 {
		t.Fatalf("expected display stream refresh, got %+v", setupCalls)
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/v1/diagnostics", nil)
	server.Handler().ServeHTTP(rec, req)
	if strings.Contains(rec.Body.String(), "new-token") || strings.Contains(rec.Body.String(), "old-token") {
		t.Fatalf("diagnostics leaked token after repair: %s", rec.Body.String())
	}
}

func TestDeviceRepairForcePairIgnoresStaleTokenDuringDiscovery(t *testing.T) {
	var sawTokenlessHello bool
	var sawNewTokenHello bool
	device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hello":
			switch got := r.Header.Get("X-VibeTV-Token"); got {
			case "":
				sawTokenlessHello = true
			case "new-token":
				sawNewTokenHello = true
			default:
				http.Error(w, "stale token", http.StatusUnauthorized)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"board":"esp8266-smalltv-st7789","firmware":"1.0.31","features":["theme","theme-spec-v1"],"capabilities":{"theme":{"supportsThemeSpecV1":true},"transport":{"active":"wifi"}}}`))
		case "/api/pair":
			if r.Method != http.MethodPost {
				t.Fatalf("expected POST pair, got %s", r.Method)
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true,"token":"new-token"}`))
		case "/health":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true,"display":{"activeTheme":"mini-classic","themeSpec":{"active":true,"renderOk":true}},"settings":{"display":{"brightnessPercent":40}}}`))
		default:
			t.Fatalf("unexpected device path %s", r.URL.Path)
		}
	}))
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{DeviceTarget: "http://192.0.2.10", DeviceToken: "old-token"})
	server.runSetup = func(_ context.Context, opts setup.Options) error {
		if opts.Target != device.URL {
			t.Fatalf("expected display stream target %q, got %q", device.URL, opts.Target)
		}
		return nil
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/device/repair", strings.NewReader(`{"target":"`+device.URL+`","forcePair":true}`))
	req.Header.Set("Content-Type", "application/json")

	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	if !sawTokenlessHello {
		t.Fatal("expected force repair discovery to probe without stale token")
	}
	if !sawNewTokenHello {
		t.Fatal("expected repair response refresh to use the new token")
	}
}

func TestDeviceRepairReportsStaleTokenWithoutForcePair(t *testing.T) {
	var sawStaleToken bool
	var sawTokenlessHello bool
	var pairCalls atomic.Int32
	device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hello":
			switch got := r.Header.Get("X-VibeTV-Token"); got {
			case "old-token":
				sawStaleToken = true
				http.Error(w, "stale token", http.StatusUnauthorized)
				return
			case "":
				sawTokenlessHello = true
			default:
				t.Fatalf("unexpected token %q", got)
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"board":"esp8266-smalltv-st7789","firmware":"1.0.31","capabilities":{"transport":{"active":"wifi"}}}`))
		case "/api/pair":
			pairCalls.Add(1)
		case "/health":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true,"display":{"activeTheme":"mini-classic","themeSpec":{"active":true,"renderOk":true}},"settings":{"display":{"brightnessPercent":40}}}`))
		default:
			t.Fatalf("unexpected device path %s", r.URL.Path)
		}
	}))
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{DeviceTarget: device.URL, DeviceToken: "old-token"})
	server.runSetup = func(_ context.Context, opts setup.Options) error {
		if opts.Target != device.URL {
			t.Fatalf("expected display stream target %q, got %q", device.URL, opts.Target)
		}
		return nil
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/device/repair", strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json")

	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), `"connect_failed"`) {
		t.Fatalf("expected customer-safe connection error, got %d body=%s", rec.Code, rec.Body.String())
	}
	if !sawStaleToken || !sawTokenlessHello || pairCalls.Load() != 0 {
		t.Fatalf("repair must diagnose without pairing: stale=%t tokenless=%t pairCalls=%d", sawStaleToken, sawTokenlessHello, pairCalls.Load())
	}
	cfg, err := server.config()
	if err != nil || cfg.DeviceToken != "old-token" {
		t.Fatalf("rejected token was mutated: cfg=%+v err=%v", cfg, err)
	}
}

func TestDeviceRepairReportsTokenRejectedByFrameStream(t *testing.T) {
	var pairCalls atomic.Int32
	var sawOldToken atomic.Bool
	var sawNewToken atomic.Bool
	device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hello":
			switch r.Header.Get("X-VibeTV-Token") {
			case "old-token":
				sawOldToken.Store(true)
			case "new-token":
				sawNewToken.Store(true)
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"board":"esp8266-smalltv-st7789","firmware":"1.0.35","capabilities":{"transport":{"active":"wifi"}}}`))
		case "/api/pair":
			pairCalls.Add(1)
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true,"token":"new-token"}`))
		case "/health":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true,"render":{"fullCount":1,"partialCount":0,"lastKind":"connected_setup"}}`))
		default:
			t.Fatalf("unexpected device path %s", r.URL.Path)
		}
	}))
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{DeviceTarget: device.URL, DeviceToken: "old-token"})
	var setupCalls atomic.Int32
	server.runSetup = func(_ context.Context, opts setup.Options) error {
		if opts.Target != device.URL {
			t.Fatalf("display stream target=%q want %q", opts.Target, device.URL)
		}
		setupCalls.Add(1)
		return nil
	}
	var streamChecks atomic.Int32
	server.waitStream = func(context.Context, string) displayStreamInfo {
		if streamChecks.Add(1) == 1 {
			return displayStreamInfo{
				Running:   true,
				Target:    device.URL,
				Detail:    "VibeTV connection needs attention.",
				ErrorCode: "device_pairing_required",
			}
		}
		return displayStreamInfo{
			Running:    true,
			Healthy:    true,
			Target:     device.URL,
			LastTarget: device.URL,
			LastSentAt: time.Now().UTC().Format(time.RFC3339),
		}
	}
	server.waitRender = func(context.Context, string, string, deviceHealth) (deviceHealth, error) {
		health := deviceHealth{OK: true}
		fullCount := uint64(2)
		partialCount := uint64(0)
		health.Render.FullCount = &fullCount
		health.Render.PartialCount = &partialCount
		health.Render.LastKind = "usage"
		return health, nil
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/device/repair", strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json")
	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), `"connect_failed"`) {
		t.Fatalf("expected customer-safe connection error, got %d body=%s", rec.Code, rec.Body.String())
	}
	if pairCalls.Load() != 0 || streamChecks.Load() != 1 || setupCalls.Load() != 2 {
		t.Fatalf("pair=%d streamChecks=%d setupCalls=%d want 0,1,2", pairCalls.Load(), streamChecks.Load(), setupCalls.Load())
	}
	if !sawOldToken.Load() || sawNewToken.Load() {
		t.Fatalf("repair unexpectedly rotated token; old=%v new=%v", sawOldToken.Load(), sawNewToken.Load())
	}
}

func TestDeviceRepairDoesNotRotateTokenForTransientFrameFailure(t *testing.T) {
	var pairCalls atomic.Int32
	device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hello":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"board":"esp8266-smalltv-st7789","firmware":"1.0.35","capabilities":{"transport":{"active":"wifi"}}}`))
		case "/api/pair":
			pairCalls.Add(1)
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true,"token":"rotated-token"}`))
		case "/health":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true,"render":{"fullCount":1,"partialCount":0,"lastKind":"connected_setup"}}`))
		default:
			t.Fatalf("unexpected device path %s", r.URL.Path)
		}
	}))
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{DeviceTarget: device.URL, DeviceToken: "valid-token"})
	server.waitStream = func(context.Context, string) displayStreamInfo {
		return displayStreamInfo{
			Running:   true,
			Target:    device.URL,
			Detail:    "Display stream could not send to VibeTV and is reconnecting.",
			ErrorCode: "display_send_failed",
		}
	}
	server.waitRender = func(context.Context, string, string, deviceHealth) (deviceHealth, error) {
		return deviceHealth{}, errors.New("display render did not advance")
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/device/repair", strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json")
	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusBadGateway {
		t.Fatalf("expected status 502, got %d body=%s", rec.Code, rec.Body.String())
	}
	if pairCalls.Load() != 0 {
		t.Fatalf("transient frame failure rotated pairing token %d times", pairCalls.Load())
	}
}

func TestDeviceRepairReactivatesCurrentThemeAfterUnknownRenderKindWithHealthyStreamProof(t *testing.T) {
	var activationCalls atomic.Int32
	var displayStreamPaused atomic.Bool
	device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hello":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"board":"esp8266-smalltv-st7789","firmware":"1.0.36","capabilities":{"transport":{"active":"wifi"}}}`))
		case "/health":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true,"display":{"activeTheme":"claude-creature","themeSpec":{"active":true,"path":"/themes/u/claude.json","renderOk":true}},"render":{"fullCount":10,"partialCount":2,"lastKind":"update_status"}}`))
		case "/theme/active":
			if !displayStreamPaused.Load() {
				t.Fatal("theme reactivation raced the display stream")
			}
			if r.Method != http.MethodPost {
				t.Fatalf("expected POST theme activation, got %s", r.Method)
			}
			if got := r.Header.Get("X-VibeTV-Token"); got != "pair-token" {
				t.Fatalf("expected preserved pairing token, got %q", got)
			}
			var body struct {
				Path string `json:"path"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Fatalf("decode theme activation: %v", err)
			}
			if body.Path != "/themes/u/claude.json" {
				t.Fatalf("unexpected active theme path %q", body.Path)
			}
			activationCalls.Add(1)
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true}`))
		default:
			t.Fatalf("unexpected device path %s", r.URL.Path)
		}
	}))
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{DeviceTarget: device.URL, DeviceToken: "pair-token"})
	server.pauseDisplayStream = displayStreamPaused.Store
	server.refreshStream = func(context.Context, string) error {
		if displayStreamPaused.Load() {
			t.Fatal("display stream restart was requested before maintenance resumed")
		}
		return nil
	}
	server.waitStream = func(context.Context, string) displayStreamInfo {
		return displayStreamInfo{
			Running:    true,
			Healthy:    true,
			Target:     device.URL,
			LastTarget: device.URL,
			LastSentAt: time.Now().UTC().Format(time.RFC3339),
		}
	}
	var renderCalls atomic.Int32
	server.waitRender = func(context.Context, string, string, deviceHealth) (deviceHealth, error) {
		renderCalls.Add(1)
		fullCount := uint64(11)
		partialCount := uint64(2)
		health := deviceHealth{OK: true}
		health.Display.ThemeSpec.Active = true
		health.Display.ThemeSpec.Path = "/themes/u/claude.json"
		renderOK := true
		health.Display.ThemeSpec.RenderOK = &renderOK
		health.Render.FullCount = &fullCount
		health.Render.PartialCount = &partialCount
		health.Render.LastKind = "reset"
		return health, errors.New("lastKind=reset")
	}

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/device/repair", strings.NewReader(`{}`))
	request.Header.Set("Content-Type", "application/json")
	server.Handler().ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected automatic full-screen recovery, got %d body=%s", recorder.Code, recorder.Body.String())
	}
	var got deviceActionResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode repair response: %v", err)
	}
	if !got.OK || !got.Device.Ready {
		t.Fatalf("expected ready device after full redraw, got %+v", got)
	}
	if activationCalls.Load() != 1 || renderCalls.Load() != 1 {
		t.Fatalf("activation=%d renderChecks=%d want 1,1", activationCalls.Load(), renderCalls.Load())
	}
	if displayStreamPaused.Load() {
		t.Fatal("repair left the display stream paused")
	}
}

func TestDeviceRepairKeepsNormalThemeRenderAndRefreshesStreamOnce(t *testing.T) {
	var activationCalls atomic.Int32
	device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hello":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"deviceId":"device-a","board":"esp8266-smalltv-st7789","firmware":"1.0.36","capabilities":{"transport":{"active":"wifi"}}}`))
		case "/health":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true,"display":{"activeTheme":"clippy","themeSpec":{"active":true,"path":"/themes/u/clippy.json","renderOk":true}},"render":{"fullCount":10,"partialCount":2,"lastKind":"reset"}}`))
		case "/theme/active":
			activationCalls.Add(1)
			t.Fatal("normal reset/theme-spec rendering must not reactivate the current theme")
		default:
			t.Fatalf("unexpected device path %s", r.URL.Path)
		}
	}))
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{
		DeviceTarget: device.URL,
		DeviceToken:  "pair-token",
		DeviceID:     "device-a",
	})
	var refreshCalls atomic.Int32
	var wakeCalls atomic.Int32
	server.wakeDisplayStream = func() {
		wakeCalls.Add(1)
	}
	server.refreshStream = func(context.Context, string) error {
		refreshCalls.Add(1)
		server.wakeDisplayStream()
		return nil
	}
	var pauseEvents []bool
	server.pauseDisplayStream = func(paused bool) {
		pauseEvents = append(pauseEvents, paused)
	}
	server.waitRender = func(context.Context, string, string, deviceHealth) (deviceHealth, error) {
		fullCount := uint64(10)
		partialCount := uint64(3)
		renderOK := true
		health := deviceHealth{OK: true}
		health.Display.ThemeSpec.Active = true
		health.Display.ThemeSpec.Path = "/themes/u/clippy.json"
		health.Display.ThemeSpec.RenderOK = &renderOK
		health.Render.FullCount = &fullCount
		health.Render.PartialCount = &partialCount
		health.Render.LastKind = "theme_spec_frame"
		return health, nil
	}

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/device/repair", strings.NewReader(`{}`))
	request.Header.Set("Content-Type", "application/json")
	server.Handler().ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected repair success, got %d body=%s", recorder.Code, recorder.Body.String())
	}
	if activationCalls.Load() != 0 {
		t.Fatalf("theme activation calls=%d want 0", activationCalls.Load())
	}
	if refreshCalls.Load() != 1 {
		t.Fatalf("display stream refresh calls=%d want 1", refreshCalls.Load())
	}
	if wakeCalls.Load() != 1 {
		t.Fatalf("display stream wake calls=%d want 1", wakeCalls.Load())
	}
	if !reflect.DeepEqual(pauseEvents, []bool{true, false}) {
		t.Fatalf("pause events=%v want [true false]", pauseEvents)
	}
}

func TestDeviceRepairWakesStreamOnceAfterEarlyFailure(t *testing.T) {
	device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/hello" {
			t.Fatalf("unexpected device path %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"deviceId":"device-a","board":"esp8266-smalltv-st7789","firmware":"1.0.36","capabilities":{"transport":{"active":"wifi"}}}`))
	}))
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{
		DeviceTarget: device.URL,
		DeviceToken:  "pair-token",
		DeviceID:     "device-a",
	})
	var refreshCalls atomic.Int32
	server.refreshStream = func(context.Context, string) error {
		refreshCalls.Add(1)
		return nil
	}
	var wakeCalls atomic.Int32
	server.wakeDisplayStream = func() {
		wakeCalls.Add(1)
	}
	var pauseEvents []bool
	server.pauseDisplayStream = func(paused bool) {
		pauseEvents = append(pauseEvents, paused)
	}

	_, err := server.repairDevice(context.Background(), device.URL, "device-b", false)
	if err == nil {
		t.Fatal("expected identity mismatch repair failure")
	}
	if refreshCalls.Load() != 0 {
		t.Fatalf("early failure requested display refresh %d times", refreshCalls.Load())
	}
	if wakeCalls.Load() != 1 {
		t.Fatalf("early failure wake calls=%d want 1", wakeCalls.Load())
	}
	if !reflect.DeepEqual(pauseEvents, []bool{true, false}) {
		t.Fatalf("pause events=%v want [true false]", pauseEvents)
	}
}

func TestActiveThemeNormalRenderKindsDoNotRequireReactivation(t *testing.T) {
	renderOK := true
	for _, kind := range []string{"usage", "theme_spec_usage", "theme_spec_frame", "reset", "update_notice"} {
		t.Run(kind, func(t *testing.T) {
			health := deviceHealth{}
			health.Display.ThemeSpec.Active = true
			health.Display.ThemeSpec.Path = "/themes/u/clippy.json"
			health.Display.ThemeSpec.RenderOK = &renderOK
			health.Render.LastKind = kind
			if activeThemeNeedsFullRepairRender(health) {
				t.Fatalf("normal render kind %q requested theme reactivation", kind)
			}
		})
	}
}

func TestDeviceRepairAcceptsCounterProofAfterLostFrameResponseAndStatusStaysReady(t *testing.T) {
	var healthCalls atomic.Int32
	device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hello":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"board":"esp8266-smalltv-st7789","firmware":"1.0.35","capabilities":{"transport":{"active":"wifi"}}}`))
		case "/health":
			call := healthCalls.Add(1)
			fullCount := 10
			kind := "connected_setup"
			if call > 1 {
				fullCount = 11
				kind = "usage"
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = fmt.Fprintf(w, `{"ok":true,"render":{"fullCount":%d,"partialCount":0,"lastKind":%q}}`, fullCount, kind)
		default:
			t.Fatalf("unexpected device path %s", r.URL.Path)
		}
	}))
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{DeviceTarget: device.URL, DeviceToken: "pair-token"})
	lostResponse := displayStreamInfo{
		Running:   true,
		Target:    device.URL,
		Detail:    "send frame: EOF after VibeTV accepted the body",
		ErrorCode: "display_send_failed",
	}
	server.waitStream = func(context.Context, string) displayStreamInfo { return lostResponse }
	server.streamStatus = func(context.Context, string) displayStreamInfo { return lostResponse }
	server.waitRender = func(_ context.Context, _ string, _ string, baseline deviceHealth) (deviceHealth, error) {
		if baseline.Render.FullCount == nil || *baseline.Render.FullCount != 10 {
			t.Fatalf("unexpected render baseline: %+v", baseline.Render)
		}
		fullCount := uint64(11)
		partialCount := uint64(0)
		health := deviceHealth{OK: true}
		health.Render.FullCount = &fullCount
		health.Render.PartialCount = &partialCount
		health.Render.LastKind = "usage"
		return health, nil
	}

	repair := httptest.NewRecorder()
	repairRequest := httptest.NewRequest(http.MethodPost, "/v1/device/repair", strings.NewReader(`{}`))
	repairRequest.Header.Set("Content-Type", "application/json")
	server.Handler().ServeHTTP(repair, repairRequest)
	if repair.Code != http.StatusOK {
		t.Fatalf("expected counter proof to recover lost frame response, got %d body=%s", repair.Code, repair.Body.String())
	}
	var repaired deviceActionResponse
	if err := json.Unmarshal(repair.Body.Bytes(), &repaired); err != nil {
		t.Fatalf("decode repair response: %v", err)
	}
	if !repaired.Device.Ready || repaired.Device.Stream == nil || !repaired.Device.Stream.Healthy {
		t.Fatalf("expected device-confirmed render to be ready, got %+v", repaired.Device)
	}

	statusRecorder := httptest.NewRecorder()
	statusRequest := httptest.NewRequest(http.MethodGet, "/v1/status", nil)
	server.Handler().ServeHTTP(statusRecorder, statusRequest)
	if statusRecorder.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", statusRecorder.Code, statusRecorder.Body.String())
	}
	var status statusResponse
	if err := json.Unmarshal(statusRecorder.Body.Bytes(), &status); err != nil {
		t.Fatalf("decode status response: %v", err)
	}
	if !status.Device.Ready || status.Device.Stream == nil || !status.Device.Stream.Healthy {
		t.Fatalf("short-lived proof must keep status ready after an EOF response, got %+v", status.Device)
	}
}

func TestDisplayVerificationRejectsTokenTargetMismatchAndCounterRegression(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	target := "http://192.168.178.72"
	device := deviceInfo{
		Target:    target,
		Connected: true,
		Paired:    true,
		Stream: &displayStreamInfo{
			Running:   true,
			Target:    target,
			ErrorCode: "display_send_failed",
		},
	}
	health := func(full, partial uint64) deviceHealth {
		got := deviceHealth{OK: true}
		got.Render.FullCount = &full
		got.Render.PartialCount = &partial
		got.Render.LastKind = "usage"
		return got
	}

	if got := server.withVerifiedDeviceHealth(device, health(10, 2), target, "token-a", true); !got.Ready {
		t.Fatalf("explicit proof should be ready, got %+v", got)
	}
	if got := server.withVerifiedDeviceHealth(device, health(10, 2), target, "token-b", false); got.Ready {
		t.Fatalf("different token reused proof: %+v", got)
	}
	if got := server.withVerifiedDeviceHealth(device, health(10, 2), "http://192.168.178.73", "token-a", false); got.Ready {
		t.Fatalf("different target reused proof: %+v", got)
	}
	if got := server.withVerifiedDeviceHealth(device, health(9, 2), target, "token-a", false); got.Ready {
		t.Fatalf("counter regression reused proof: %+v", got)
	}
	if got := server.withVerifiedDeviceHealth(device, health(11, 2), target, "token-a", false); got.Ready {
		t.Fatalf("counter increase after regression recreated proof without explicit verification: %+v", got)
	}
}

func TestDisplayVerificationSeparatesHealthyStreamFromLostResponseProof(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	target := "http://192.168.178.72"
	stream := displayStreamInfo{
		Running:    true,
		Healthy:    true,
		Target:     target,
		LastTarget: target,
	}
	device := deviceInfo{
		Target:    target,
		Connected: true,
		Paired:    true,
		Stream:    &stream,
	}
	health := func(full, partial uint64, kind string) deviceHealth {
		got := deviceHealth{OK: true}
		got.Render.FullCount = &full
		got.Render.PartialCount = &partial
		got.Render.LastKind = kind
		return got
	}

	if got := server.withVerifiedDeviceHealth(device, health(4, 1, "usage"), target, "token-a", true); !got.Ready {
		t.Fatalf("direct usage proof should be ready: %+v", got)
	}
	server.verificationMu.Lock()
	initial := server.displayVerifications[target]
	server.verificationMu.Unlock()

	if got := server.withVerifiedDeviceHealth(device, health(4, 2, "reset"), target, "token-a", false); !got.Ready {
		t.Fatalf("healthy exact-target stream should keep a reset tail ready: %+v", got)
	}
	server.verificationMu.Lock()
	afterReset := server.displayVerifications[target]
	server.verificationMu.Unlock()
	if !afterReset.VerifiedAt.Equal(initial.VerifiedAt) || afterReset.PartialCount != initial.PartialCount {
		t.Fatalf("reset tail renewed proof: before=%+v after=%+v", initial, afterReset)
	}

	serverWithoutProof := newTestServer(t, runtimeconfig.Config{})
	if got := serverWithoutProof.withVerifiedDeviceHealth(device, health(4, 2, "reset"), target, "token-a", false); !got.Ready {
		t.Fatalf("fresh exact-target stream should survive API restart with an empty proof cache: %+v", got)
	}
	serverWithoutProof.verificationMu.Lock()
	proofCount := len(serverWithoutProof.displayVerifications)
	serverWithoutProof.verificationMu.Unlock()
	if proofCount != 0 {
		t.Fatalf("passive reset status minted %d action proofs", proofCount)
	}

	unhealthyStream := stream
	unhealthyStream.Healthy = false
	device.Stream = &unhealthyStream
	if got := server.withVerifiedDeviceHealth(device, health(4, 2, "reset"), target, "token-a", false); got.Ready {
		t.Fatalf("reset tail reused proof without an exact healthy stream: %+v", got)
	}
	if got := server.withVerifiedDeviceHealth(device, health(4, 2, "usage"), target, "token-a", false); got.Ready {
		t.Fatalf("running stream without a frame or send-failure proof reused cache: %+v", got)
	}

	device.Stream = &stream
	server.verificationMu.Lock()
	expired := server.displayVerifications[target]
	expired.VerifiedAt = time.Now().UTC().Add(-displayVerificationAge - time.Second)
	server.displayVerifications[target] = expired
	server.verificationMu.Unlock()
	if got := server.withVerifiedDeviceHealth(device, health(4, 3, "update_notice"), target, "token-a", false); !got.Ready {
		t.Fatalf("healthy exact-target stream should remain ready independently of expired cache: %+v", got)
	}
	server.verificationMu.Lock()
	afterExpiredOverlay := server.displayVerifications[target]
	server.verificationMu.Unlock()
	if !afterExpiredOverlay.VerifiedAt.Equal(expired.VerifiedAt) {
		t.Fatalf("overlay tail renewed expired proof: before=%+v after=%+v", expired, afterExpiredOverlay)
	}

	if got := server.withVerifiedDeviceHealth(device, health(5, 3, "theme_spec_usage"), target, "token-a", false); !got.Ready {
		t.Fatalf("healthy direct stream should remain ready: %+v", got)
	}
	server.verificationMu.Lock()
	afterLocalFullRedraw := server.displayVerifications[target]
	server.verificationMu.Unlock()
	if !afterLocalFullRedraw.VerifiedAt.Equal(expired.VerifiedAt) {
		t.Fatalf("passive full redraw renewed proof: before=%+v after=%+v", expired, afterLocalFullRedraw)
	}

	wrongTargetStream := stream
	wrongTargetStream.LastTarget = "http://192.168.178.73"
	device.Stream = &wrongTargetStream
	if got := server.withVerifiedDeviceHealth(device, health(5, 3, "theme_spec_usage"), target, "token-a", false); got.Ready {
		t.Fatalf("wrong-target stream reused proof: %+v", got)
	}

	pairingErrorStream := stream
	pairingErrorStream.Healthy = false
	pairingErrorStream.ErrorCode = "device_pairing_required"
	device.Stream = &pairingErrorStream
	if got := server.withVerifiedDeviceHealth(device, health(5, 3, "theme_spec_usage"), target, "token-a", false); got.Ready {
		t.Fatalf("pairing error reused proof: %+v", got)
	}

	notRunningStream := stream
	notRunningStream.Running = false
	device.Stream = &notRunningStream
	if got := server.withVerifiedDeviceHealth(device, health(5, 3, "theme_spec_usage"), target, "token-a", false); got.Ready {
		t.Fatalf("healthy flag bypassed missing persistent LaunchAgent: %+v", got)
	}
}

func TestConcurrentDeviceRepairsShareOnePairingTransaction(t *testing.T) {
	var pairCalls atomic.Int32
	pairStarted := make(chan struct{})
	releasePair := make(chan struct{})
	var pairStartedOnce sync.Once
	device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hello":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"board":"esp8266-smalltv-st7789","firmware":"1.0.35","capabilities":{"transport":{"active":"wifi"}}}`))
		case "/api/pair":
			pairCalls.Add(1)
			pairStartedOnce.Do(func() { close(pairStarted) })
			<-releasePair
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true,"token":"new-token"}`))
		case "/health":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true,"render":{"fullCount":1,"partialCount":0,"lastKind":"connected_setup"}}`))
		default:
			t.Fatalf("unexpected device path %s", r.URL.Path)
		}
	}))
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{DeviceTarget: device.URL, DeviceToken: "old-token"})
	server.waitStream = func(context.Context, string) displayStreamInfo {
		if pairCalls.Load() == 0 {
			return displayStreamInfo{
				Running:   true,
				Target:    device.URL,
				Detail:    "VibeTV connection needs attention.",
				ErrorCode: "device_pairing_required",
			}
		}
		return displayStreamInfo{
			Running:    true,
			Healthy:    true,
			Target:     device.URL,
			LastTarget: device.URL,
			LastSentAt: time.Now().UTC().Format(time.RFC3339),
		}
	}
	server.waitRender = func(context.Context, string, string, deviceHealth) (deviceHealth, error) {
		health := deviceHealth{OK: true}
		fullCount := uint64(2)
		partialCount := uint64(0)
		health.Render.FullCount = &fullCount
		health.Render.PartialCount = &partialCount
		health.Render.LastKind = "usage"
		return health, nil
	}

	firstResult := make(chan error, 1)
	go func() {
		_, err := server.repairDevice(context.Background(), "", "", true)
		firstResult <- err
	}()
	<-pairStarted
	secondCtx, cancelSecond := context.WithCancel(context.Background())
	secondResult := make(chan error, 1)
	go func() {
		_, err := server.repairDevice(secondCtx, "", "", true)
		secondResult <- err
	}()
	cancelSecond()
	select {
	case err := <-secondResult:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("shared repair waiter error=%v want context cancellation", err)
		}
	case <-time.After(time.Second):
		t.Fatal("concurrent repair started a second transaction instead of joining the active flight")
	}
	close(releasePair)
	if err := <-firstResult; err != nil {
		t.Fatalf("first repair failed: %v", err)
	}
	if pairCalls.Load() != 1 {
		t.Fatalf("concurrent repairs rotated pairing token %d times, want 1", pairCalls.Load())
	}
}

func TestRepairFlightKeyUsesCanonicalDeviceIdentity(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{
		DeviceTarget: "http://192.168.178.72",
		DeviceID:     " Device-A ",
	})

	fromActiveConfig := server.repairFlightKey("http://192.168.178.72", "", false)
	fromExplicitIdentity := server.repairFlightKey("http://192.168.178.99/", " device-a ", false)
	if fromActiveConfig != fromExplicitIdentity {
		t.Fatalf("same device produced different flight keys: active=%q explicit=%q", fromActiveConfig, fromExplicitIdentity)
	}
	if got := server.repairFlightKey("http://192.168.178.72", "device-b", false); got == fromActiveConfig {
		t.Fatalf("different device reused flight key %q", got)
	}
	if got := server.repairFlightKey("http://192.168.178.72", "device-a", true); got == fromActiveConfig {
		t.Fatalf("force-pair repair reused normal repair flight key %q", got)
	}
}

func TestSetupResetClearsStoredDeviceBinding(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{
		Theme:        "mini",
		DeviceTarget: "http://192.168.178.72",
		DeviceToken:  "pair-token",
		DeviceID:     "device-a",
		KnownDevices: []runtimeconfig.KnownDevice{{DeviceID: "device-b", Target: "http://192.168.178.73", DeviceToken: "pair-token-b"}},
	})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/setup/reset", nil)

	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got statusResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.Device.Target != "" || got.Device.Paired || got.Device.Connected {
		t.Fatalf("expected reset device state, got %+v", got.Device)
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/v1/status", nil)
	server.Handler().ServeHTTP(rec, req)
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode status: %v", err)
	}
	if got.Device.Target != "" || got.Device.Paired {
		t.Fatalf("expected persisted device reset, got %+v", got.Device)
	}
	cfg, err := server.config()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.DeviceTarget != "" || cfg.DeviceToken != "" || cfg.DeviceID != "" || len(cfg.KnownDevices) != 0 {
		t.Fatalf("expected reset to remove every stored device profile, got %+v", cfg)
	}
}

func TestSetupResetRejectsActiveFirmwareUpdate(t *testing.T) {
	initial := runtimeconfig.Config{
		DeviceTarget: "http://192.168.178.72",
		DeviceToken:  "pair-token",
		DeviceID:     "device-a",
	}
	server := newTestServer(t, initial)
	server.updateJobs["active-update"] = &firmwareUpdateJob{
		ID:    "active-update",
		Phase: "installing",
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/setup/reset", nil)
	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusConflict {
		t.Fatalf("expected status 409, got %d body=%s", rec.Code, rec.Body.String())
	}
	var response struct {
		Error apiError `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if response.Error.Code != "firmware_update_in_progress" {
		t.Fatalf("error code=%q want firmware_update_in_progress", response.Error.Code)
	}
	cfg, err := server.config()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.DeviceTarget != initial.DeviceTarget || cfg.DeviceToken != initial.DeviceToken || cfg.DeviceID != initial.DeviceID {
		t.Fatalf("active update reset mutated config: %+v", cfg)
	}
}

func TestDeviceDiscoverDoesNotFallbackWhenExplicitTargetFails(t *testing.T) {
	stale := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "gone", http.StatusServiceUnavailable)
	}))
	defer stale.Close()

	device := newHelloDeviceServer(t)
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{})
	server.subnetTargets = func() []string {
		return []string{device.URL}
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(
		http.MethodPost,
		"/v1/device/discover",
		strings.NewReader(`{"target":`+strconv.Quote(stale.URL)+`}`),
	)
	req.Header.Set("Content-Type", "application/json")

	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected explicit target failure status 404, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got errorResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.OK || got.Error.Code != "device_not_found" {
		t.Fatalf("unexpected explicit target response: %+v", got)
	}
}

func TestDeviceDiscoverRejectsInvalidExplicitTarget(t *testing.T) {
	for _, target := range []string{
		"ftp://192.0.2.10",
		"http://ftp://192.0.2.10",
		"http://192.0.2.10:",
		"http://192.0.2.10:abc",
		"http://192.0.2.10:0",
		"http://192.0.2.10:99999",
		"http://192.0.2.10/setup",
		"http://192.0.2.10?token=pair-token",
		"http://192.0.2.10/#setup",
	} {
		t.Run(target, func(t *testing.T) {
			server := newTestServer(t, runtimeconfig.Config{})
			server.subnetTargets = func() []string {
				t.Fatal("subnet discovery should not run for invalid explicit target")
				return nil
			}

			rec := httptest.NewRecorder()
			req := httptest.NewRequest(
				http.MethodPost,
				"/v1/device/discover",
				strings.NewReader(`{"target":`+strconv.Quote(target)+`}`),
			)
			req.Header.Set("Content-Type", "application/json")

			server.Handler().ServeHTTP(rec, req)

			if rec.Code != http.StatusBadRequest {
				t.Fatalf("expected status 400, got %d body=%s", rec.Code, rec.Body.String())
			}
			var got errorResponse
			if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
				t.Fatalf("decode response: %v", err)
			}
			if got.OK || got.Error.Code != "invalid_device_target" {
				t.Fatalf("unexpected invalid target response: %+v", got)
			}
		})
	}
}

func TestConcurrentConfigUpdatesPreserveTargetAndPairingToken(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	start := make(chan struct{})
	errorsByUpdate := make(chan error, 2)
	go func() {
		<-start
		_, err := server.updateConfig(func(cfg *runtimeconfig.Config) {
			cfg.DeviceTarget = "http://192.168.178.72"
		})
		errorsByUpdate <- err
	}()
	go func() {
		<-start
		_, err := server.updateConfig(func(cfg *runtimeconfig.Config) {
			cfg.DeviceToken = "pair-token"
		})
		errorsByUpdate <- err
	}()
	close(start)
	for range 2 {
		if err := <-errorsByUpdate; err != nil {
			t.Fatalf("update config: %v", err)
		}
	}
	cfg, err := server.config()
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	if cfg.DeviceTarget != "http://192.168.178.72" || cfg.DeviceToken != "pair-token" {
		t.Fatalf("concurrent config fields were lost: %+v", cfg)
	}
}

func TestDevicePairRejectsInvalidExplicitTarget(t *testing.T) {
	for _, target := range []string{
		"http://user:pass@192.0.2.10",
		"http://192.0.2.10:abc",
		"http://192.0.2.10:0",
		"http://192.0.2.10:99999",
	} {
		t.Run(target, func(t *testing.T) {
			server := newTestServer(t, runtimeconfig.Config{})
			server.subnetTargets = func() []string {
				t.Fatal("subnet discovery should not run for invalid explicit target")
				return nil
			}

			rec := httptest.NewRecorder()
			req := httptest.NewRequest(
				http.MethodPost,
				"/v1/device/pair",
				strings.NewReader(`{"target":`+strconv.Quote(target)+`}`),
			)
			req.Header.Set("Content-Type", "application/json")

			server.Handler().ServeHTTP(rec, req)

			if rec.Code != http.StatusBadRequest {
				t.Fatalf("expected status 400, got %d body=%s", rec.Code, rec.Body.String())
			}
			var got errorResponse
			if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
				t.Fatalf("decode response: %v", err)
			}
			if got.OK || got.Error.Code != "invalid_device_target" {
				t.Fatalf("unexpected invalid target response: %+v", got)
			}
		})
	}
}

func TestPairRetriesLostResponsesWithBoundedEmptyRequests(t *testing.T) {
	tests := []struct {
		name      string
		succeedAt int32
		wantToken string
		wantError bool
	}{
		{name: "third response succeeds", succeedAt: 3, wantToken: "third-token"},
		{name: "all responses fail", succeedAt: 0, wantError: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var attempts atomic.Int32
			device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				attempt := attempts.Add(1)
				if r.Method != http.MethodPost {
					t.Errorf("pair method=%s want POST", r.Method)
				}
				if got := r.URL.Query().Get("api"); got != "1" {
					t.Errorf("pair api query=%q want 1", got)
				}
				body, err := io.ReadAll(r.Body)
				if err != nil {
					t.Errorf("read pair body: %v", err)
				}
				if len(body) != 0 {
					t.Errorf("pair request body=%q want empty", body)
				}
				w.Header().Set("Content-Type", "application/json")
				if tt.succeedAt > 0 && attempt == tt.succeedAt {
					_, _ = w.Write([]byte(`{"ok":true,"token":"third-token"}`))
					return
				}
				_, _ = w.Write([]byte(`{"ok":`))
			}))
			defer device.Close()

			server := newTestServer(t, runtimeconfig.Config{})
			server.pairAttempts = 3
			server.pairRetryGap = 0
			token, err := server.pair(context.Background(), device.URL, "")
			if tt.wantError {
				if err == nil || !strings.Contains(err.Error(), "pairing failed after 3 attempts") {
					t.Fatalf("expected bounded pairing error, got token=%q err=%v", token, err)
				}
			} else {
				if err != nil || token != tt.wantToken {
					t.Fatalf("pair token=%q err=%v want token=%q", token, err, tt.wantToken)
				}
			}
			if got := attempts.Load(); got != 3 {
				t.Fatalf("pair attempts=%d want 3", got)
			}
		})
	}
}

func TestPairAttemptTimeoutBoundsHungResponses(t *testing.T) {
	var attempts atomic.Int32
	device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempts.Add(1)
		<-r.Context().Done()
	}))
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{})
	server.pairAttempts = 3
	server.pairAttemptTimeout = 25 * time.Millisecond
	server.pairRetryGap = 0
	startedAt := time.Now()
	token, err := server.pair(context.Background(), device.URL, "")
	if err == nil || token != "" {
		t.Fatalf("expected hung pairing to fail, got token=%q err=%v", token, err)
	}
	if attempts.Load() != 3 {
		t.Fatalf("pair attempts=%d want 3", attempts.Load())
	}
	if elapsed := time.Since(startedAt); elapsed > time.Second {
		t.Fatalf("bounded pairing took %s", elapsed)
	}
}

func TestPairSendsCurrentTokenAndDoesNotRetryAuthorizationFailure(t *testing.T) {
	var attempts atomic.Int32
	var gotToken string
	device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempts.Add(1)
		gotToken = r.Header.Get("X-VibeTV-Token")
		http.Error(w, "current pairing token required", http.StatusUnauthorized)
	}))
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{})
	server.pairAttempts = 3
	server.pairRetryGap = 0
	_, err := server.pair(context.Background(), device.URL, "current-token")
	if err == nil {
		t.Fatal("expected pairing authorization failure")
	}
	if attempts.Load() != 1 {
		t.Fatalf("pair attempts=%d want 1", attempts.Load())
	}
	if gotToken != "current-token" {
		t.Fatalf("pair auth header=%q want current-token", gotToken)
	}
	var authorizationErr *pairingAuthorizationError
	if !errors.As(err, &authorizationErr) || authorizationErr.statusCode != http.StatusUnauthorized {
		t.Fatalf("expected typed pairing authorization error, got %T %v", err, err)
	}
}

func TestPairTypesEveryAuthorizationStatusWithoutRetry(t *testing.T) {
	for _, statusCode := range []int{
		http.StatusUnauthorized,
		http.StatusForbidden,
		http.StatusTooManyRequests,
	} {
		t.Run(http.StatusText(statusCode), func(t *testing.T) {
			var attempts atomic.Int32
			device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				attempts.Add(1)
				http.Error(w, "pairing denied", statusCode)
			}))
			defer device.Close()

			server := newTestServer(t, runtimeconfig.Config{})
			server.pairAttempts = 3
			server.pairRetryGap = 0
			_, err := server.pair(context.Background(), device.URL, "saved-token")
			if err == nil {
				t.Fatal("expected pairing authorization failure")
			}
			if attempts.Load() != 1 {
				t.Fatalf("pair attempts=%d want=1", attempts.Load())
			}
			var authorizationErr *pairingAuthorizationError
			if !errors.As(err, &authorizationErr) || authorizationErr.statusCode != statusCode {
				t.Fatalf("expected typed status %d, got %T %v", statusCode, err, err)
			}
		})
	}
}

func TestWriteRepairErrorMapsPairingAuthorizationStatus(t *testing.T) {
	tests := []struct {
		name           string
		deviceStatus   int
		firmware       string
		responseStatus int
		code           string
		nextAction     string
	}{
		{
			name:           "saved token rejected",
			deviceStatus:   http.StatusUnauthorized,
			responseStatus: http.StatusConflict,
			code:           "connect_failed",
			nextAction:     "Press Connect again",
		},
		{
			name:           "legacy firmware recovery required",
			deviceStatus:   http.StatusForbidden,
			firmware:       "1.0.38",
			responseStatus: http.StatusConflict,
			code:           "legacy_pairing_recovery_required",
			nextAction:     "recovery steps",
		},
		{
			name:           "rate limited",
			deviceStatus:   http.StatusTooManyRequests,
			responseStatus: http.StatusTooManyRequests,
			code:           "connect_temporarily_unavailable",
			nextAction:     "press Connect again",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			deviceErr := &deviceHTTPError{statusCode: test.deviceStatus, body: "pairing denied"}
			err := &repairStageError{
				stage:    "pair",
				firmware: test.firmware,
				err: &pairingAuthorizationError{
					statusCode: test.deviceStatus,
					err:        deviceErr,
				},
			}
			rec := httptest.NewRecorder()

			writeRepairError(rec, err)

			if rec.Code != test.responseStatus {
				t.Fatalf("status=%d want=%d body=%s", rec.Code, test.responseStatus, rec.Body.String())
			}
			var got errorResponse
			if decodeErr := json.Unmarshal(rec.Body.Bytes(), &got); decodeErr != nil {
				t.Fatalf("decode response: %v", decodeErr)
			}
			if got.Error.Code != test.code {
				t.Fatalf("code=%q want=%q body=%s", got.Error.Code, test.code, rec.Body.String())
			}
			if !strings.Contains(got.Error.NextAction, test.nextAction) {
				t.Fatalf("nextAction=%q missing %q", got.Error.NextAction, test.nextAction)
			}
			if strings.Contains(strings.ToLower(got.Error.Message+" "+got.Error.NextAction), "expired") {
				t.Fatalf("pairing response must not claim expiry: %+v", got.Error)
			}
		})
	}
}

func TestDefaultRepairDeadlineFitsExtendedUIRequestBudget(t *testing.T) {
	const uiRequestBudget = 120 * time.Second
	renderBudget := displayRenderWaitTime
	if deviceTimeout > renderBudget {
		renderBudget = deviceTimeout
	}
	worstCase := time.Duration(repairDiscoveryAttempts)*discoveryProbeTime +
		time.Duration(repairDiscoveryAttempts-1)*repairDiscoveryRetryGap +
		time.Duration(defaultPairAttempts)*defaultPairAttemptTimeout +
		time.Duration(defaultPairAttempts-1)*defaultPairRetryGap +
		2*deviceHealthProbeTime +
		2*displayStreamWaitTime +
		renderBudget
	if worstCase >= uiRequestBudget {
		t.Fatalf("backend repair deadline %s must stay below extended UI request budget %s", worstCase, uiRequestBudget)
	}
}

func TestDevicePairReturnsConflictForMultipleDiscoveryCandidates(t *testing.T) {
	stale := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "gone", http.StatusServiceUnavailable)
	}))
	defer stale.Close()

	first := newHelloDeviceServer(t)
	defer first.Close()
	second := newHelloDeviceServer(t)
	defer second.Close()

	server := newTestServer(t, runtimeconfig.Config{DeviceTarget: stale.URL})
	server.subnetTargets = func() []string {
		return []string{first.URL, second.URL}
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/device/pair", strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json")

	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusConflict {
		t.Fatalf("expected status 409, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got errorResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.OK || got.Error.Code != "multiple_devices_found" {
		t.Fatalf("unexpected multiple-devices response: %+v", got)
	}
}

func TestDevicePairStartsDisplayStreamWithoutFirmwareFlash(t *testing.T) {
	device := newPairableDeviceServer(t)
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{DeviceTarget: device.URL})
	setupCalls := make(chan setup.Options, 2)
	server.runSetup = func(_ context.Context, opts setup.Options) error {
		setupCalls <- opts
		return nil
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/device/pair", strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json")

	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got deviceActionResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !got.OK || !got.Device.Paired || !got.Device.Active || got.Device.Ready {
		t.Fatalf("expected immediate pairing success before the first display render, got %+v", got)
	}
	var calls []setup.Options
	for len(calls) < 2 {
		select {
		case call := <-setupCalls:
			calls = append(calls, call)
		case <-time.After(time.Second):
			t.Fatalf("expected validate and apply setup calls, got %+v", calls)
		}
	}
	for index, call := range calls {
		if call.Transport != "wifi" || call.Target != device.URL || !call.AssumeYes || !call.SkipFlash {
			t.Fatalf("setup call %d must start wifi stream without flashing, got %+v", index, call)
		}
	}
	if !calls[0].ValidateOnly {
		t.Fatalf("first setup call should validate dependencies before applying, got %+v", calls[0])
	}
	if calls[1].ValidateOnly {
		t.Fatalf("second setup call should apply launch agent changes, got %+v", calls[1])
	}
}

func TestDevicePairReportsSuccessBeforeFirstDisplayFrame(t *testing.T) {
	device := newPairableDeviceServer(t)
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{DeviceTarget: device.URL})
	server.waitStream = func(context.Context, string) displayStreamInfo {
		return displayStreamInfo{
			Running: true,
			Healthy: false,
			Target:  device.URL,
			Detail:  "Display stream has not sent usage yet.",
		}
	}
	server.waitRender = func(context.Context, string, string, deviceHealth) (deviceHealth, error) {
		return deviceHealth{}, errors.New("render counters did not advance")
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/device/pair", strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json")

	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got deviceActionResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !got.OK || !got.Device.Connected || !got.Device.Paired || !got.Device.Active || got.Device.Ready {
		t.Fatalf("unexpected missing-first-frame response: %+v", got)
	}
}

func TestDevicePairKeepsConnectionWhenDisplayStreamCannotStart(t *testing.T) {
	device := newPairableDeviceServer(t)
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{DeviceTarget: device.URL})
	streamAttempted := make(chan struct{}, 1)
	server.runSetup = func(context.Context, setup.Options) error {
		streamAttempted <- struct{}{}
		return errors.New("codexbar missing")
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/device/pair", strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json")

	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got deviceActionResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !got.OK || !got.Device.Paired || !got.Device.Active {
		t.Fatalf("display stream start rolled back successful pairing: %+v", got)
	}
	select {
	case <-streamAttempted:
	case <-time.After(time.Second):
		t.Fatal("display stream start was not attempted")
	}
	cfg, err := server.config()
	if err != nil {
		t.Fatal(err)
	}
	known, ok := cfg.KnownDevice("pairable-device")
	if !ok || known.Target != device.URL || known.DeviceToken != "pair-token" {
		t.Fatalf("display stream failure lost the issued pairing token: %+v", cfg.KnownDevices)
	}
	if cfg.DeviceID != "pairable-device" || cfg.DeviceTarget != device.URL || cfg.DeviceToken != "pair-token" {
		t.Fatalf("display stream failure rolled back successful pairing: %+v", cfg)
	}
}

func TestThemeInstallDelegatesToThemeInstallLogic(t *testing.T) {
	device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hello":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"board":"esp8266-smalltv-st7789","features":["theme","theme-spec-v1"],"capabilities":{"theme":{"supportsThemeSpecV1":true},"transport":{"active":"wifi"}}}`))
		case "/health":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true,"settings":{"display":{"brightnessPercent":40}}}`))
		default:
			t.Fatalf("unexpected device path %s", r.URL.Path)
		}
	}))
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{DeviceTarget: device.URL, DeviceToken: "pair-token"})
	var gotOpts themeinstall.Options
	var setupCalls []setup.Options
	var displayStreamPaused atomic.Bool
	server.pauseDisplayStream = displayStreamPaused.Store
	server.installTheme = func(ctx context.Context, opts themeinstall.Options) (themeinstall.Result, error) {
		if !displayStreamPaused.Load() {
			t.Fatal("theme install raced the display stream")
		}
		gotOpts = opts
		return themeinstall.Result{ThemeID: opts.ThemeID, Target: opts.Target}, nil
	}
	server.runSetup = func(_ context.Context, opts setup.Options) error {
		if displayStreamPaused.Load() {
			t.Fatal("display stream refresh started before theme maintenance resumed")
		}
		setupCalls = append(setupCalls, opts)
		return nil
	}

	body := strings.NewReader(`{"themeId":"cozy-meadow","packUrl":"https://example.com/cozy.zip","packSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","packSizeBytes":1234}`)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/themes/install", body)
	req.Header.Set("Content-Type", "application/json")

	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	if gotOpts.ThemeID != "cozy-meadow" || gotOpts.PackURL != "https://example.com/cozy.zip" || gotOpts.PackSHA256 != strings.Repeat("a", 64) || gotOpts.PackSizeBytes != 1234 {
		t.Fatalf("install did not receive theme source: %+v", gotOpts)
	}
	if gotOpts.PackBytes != nil {
		t.Fatalf("JSON install unexpectedly received in-memory pack bytes: %d", len(gotOpts.PackBytes))
	}
	if !strings.Contains(gotOpts.Target, "token=") {
		t.Fatalf("expected target to include pairing token for transport auth, got %q", gotOpts.Target)
	}
	if !gotOpts.SkipFirmwareUpdate {
		t.Fatalf("expected local API theme install to skip firmware update by default")
	}
	if len(setupCalls) != 2 {
		t.Fatalf("expected validate and apply display stream refresh calls, got %+v", setupCalls)
	}
	for index, call := range setupCalls {
		if call.Transport != "wifi" || call.Target != device.URL || !call.AssumeYes || !call.SkipFlash {
			t.Fatalf("setup call %d must refresh wifi stream without flashing, got %+v", index, call)
		}
	}
	if !setupCalls[0].ValidateOnly {
		t.Fatalf("first setup refresh call should validate dependencies, got %+v", setupCalls[0])
	}
	if setupCalls[1].ValidateOnly {
		t.Fatalf("second setup refresh call should apply launch agent changes, got %+v", setupCalls[1])
	}
	if displayStreamPaused.Load() {
		t.Fatal("theme install left the display stream paused")
	}
}

func TestThemeInstallCapturesRenderBaselineBeforeActivation(t *testing.T) {
	var healthCalls atomic.Int32
	device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/health" {
			t.Fatalf("unexpected device path %s", r.URL.Path)
		}
		healthCalls.Add(1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true,"render":{"fullCount":7,"partialCount":3,"lastKind":"usage"}}`))
	}))
	defer device.Close()

	cfg := runtimeconfig.Config{DeviceTarget: device.URL, DeviceToken: "pair-token"}
	server := newTestServer(t, cfg)
	server.installTheme = func(context.Context, themeinstall.Options) (themeinstall.Result, error) {
		if healthCalls.Load() != 1 {
			t.Fatalf("render baseline must be captured before theme activation, health calls=%d", healthCalls.Load())
		}
		return themeinstall.Result{ThemeID: "mini"}, nil
	}
	server.waitRender = func(_ context.Context, _ string, _ string, baseline deviceHealth) (deviceHealth, error) {
		if baseline.Render.FullCount == nil || *baseline.Render.FullCount != 7 ||
			baseline.Render.PartialCount == nil || *baseline.Render.PartialCount != 3 {
			t.Fatalf("unexpected pre-activation baseline: %+v", baseline.Render)
		}
		fullCount := uint64(8)
		partialCount := uint64(3)
		health := deviceHealth{OK: true}
		health.Render.FullCount = &fullCount
		health.Render.PartialCount = &partialCount
		health.Render.LastKind = "usage"
		return health, nil
	}

	if _, err := server.runThemeInstall(context.Background(), cfg, themeInstallRequest{ThemeID: "mini"}, io.Discard); err != nil {
		t.Fatalf("run theme install: %v", err)
	}
}

func TestThemeInstallAcceptsZipAndReadsAsyncFromQuery(t *testing.T) {
	device := newThemeInstallReadyDeviceServer(t)
	defer device.Close()

	zipBytes := testThemePackZip(t)
	server := newTestServer(t, runtimeconfig.Config{DeviceTarget: device.URL, DeviceToken: "pair-token"})
	gotOpts := make(chan themeinstall.Options, 1)
	server.installTheme = func(_ context.Context, opts themeinstall.Options) (themeinstall.Result, error) {
		gotOpts <- opts
		return themeinstall.Result{
			ThemeID:       "cozy-meadow",
			PackID:        "cozy-meadow",
			Name:          "Cozy Meadow",
			ActivePath:    "/themes/u/cm.json",
			ThemeRevision: 1,
		}, nil
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/themes/install?async=true&themeId=cozy-meadow&themeName=Cozy%20Meadow", bytes.NewReader(zipBytes))
	req.Header.Set("Content-Type", "application/zip")
	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("expected status 202, got %d body=%s", rec.Code, rec.Body.String())
	}
	var started themeInstallJobResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &started); err != nil {
		t.Fatalf("decode start response: %v", err)
	}
	if started.Job.ID == "" {
		t.Fatalf("expected async install job, got %+v", started.Job)
	}
	if started.Job.ThemeID != "cozy-meadow" || started.Job.ThemeName != "Cozy Meadow" {
		t.Fatalf("expected resumable theme identity, got %+v", started.Job)
	}

	select {
	case opts := <-gotOpts:
		if opts.ThemeID != "cozy-meadow" || opts.PackURL != "" || opts.CatalogURL != "" {
			t.Fatalf("unexpected in-memory theme source: %+v", opts)
		}
		if !bytes.Equal(opts.PackBytes, zipBytes) {
			t.Fatalf("install received different ZIP bytes: got=%d want=%d", len(opts.PackBytes), len(zipBytes))
		}
		if !opts.SkipFirmwareUpdate {
			t.Fatal("expected in-memory theme install to skip firmware update by default")
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for async in-memory install")
	}

	for attempt := 0; attempt < 50; attempt++ {
		status := httptest.NewRecorder()
		statusReq := httptest.NewRequest(http.MethodGet, "/v1/themes/install/status?jobId="+started.Job.ID, nil)
		server.Handler().ServeHTTP(status, statusReq)
		if status.Code != http.StatusOK {
			t.Fatalf("expected status 200, got %d body=%s", status.Code, status.Body.String())
		}
		var got themeInstallJobResponse
		if err := json.Unmarshal(status.Body.Bytes(), &got); err != nil {
			t.Fatalf("decode status response: %v", err)
		}
		if got.Job.Phase == "complete" {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("in-memory theme install job did not complete")
}

func TestDecodeThemeInstallZipSetsAndClearsReadDeadline(t *testing.T) {
	zipBytes := testThemePackZip(t)
	rec := &readDeadlineRecorder{ResponseRecorder: httptest.NewRecorder()}
	req := httptest.NewRequest(http.MethodPost, "/v1/themes/install?async=true", bytes.NewReader(zipBytes))
	req.Header.Set("Content-Type", "application/zip")

	got, ok := decodeThemeInstallRequest(rec, req)
	if !ok {
		t.Fatalf("expected ZIP request to decode, got status=%d body=%s", rec.Code, rec.Body.String())
	}
	if !got.Async || !bytes.Equal(got.PackBytes, zipBytes) {
		t.Fatalf("unexpected decoded ZIP request: async=%v bytes=%d", got.Async, len(got.PackBytes))
	}
	if len(rec.readDeadlines) != 2 {
		t.Fatalf("expected set and reset read deadlines, got %+v", rec.readDeadlines)
	}
	if rec.readDeadlines[0].IsZero() {
		t.Fatal("expected non-zero ZIP upload read deadline")
	}
	if !rec.readDeadlines[1].IsZero() {
		t.Fatalf("expected ZIP upload read deadline reset, got %s", rec.readDeadlines[1])
	}
}

func TestDecodeThemeInstallJSONDoesNotSetReadDeadline(t *testing.T) {
	rec := &readDeadlineRecorder{ResponseRecorder: httptest.NewRecorder()}
	req := httptest.NewRequest(http.MethodPost, "/v1/themes/install", strings.NewReader(`{"themeId":"cozy-meadow","packUrl":"https://example.com/cozy.zip","async":true}`))
	req.Header.Set("Content-Type", "application/json")

	got, ok := decodeThemeInstallRequest(rec, req)
	if !ok || !got.Async || got.ThemeID != "cozy-meadow" {
		t.Fatalf("unexpected decoded JSON request: ok=%v got=%+v body=%s", ok, got, rec.Body.String())
	}
	if len(rec.readDeadlines) != 0 {
		t.Fatalf("JSON install should not set a ZIP read deadline, got %+v", rec.readDeadlines)
	}
}

func TestThemeInstallZipTimeoutReleasesInstallGuard(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	rec := &readDeadlineRecorder{ResponseRecorder: httptest.NewRecorder()}
	req := httptest.NewRequest(http.MethodPost, "/v1/themes/install?async=true", timeoutReader{})
	req.Header.Set("Content-Type", "application/zip")
	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusRequestTimeout {
		t.Fatalf("expected status 408, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got errorResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode timeout response: %v", err)
	}
	if got.OK || got.Error.Code != "theme_pack_upload_timeout" {
		t.Fatalf("unexpected timeout response: %+v", got)
	}
	if rec.Header().Get("Connection") != "close" {
		t.Fatalf("timed-out upload should close the connection, got headers=%v", rec.Header())
	}
	if len(rec.readDeadlines) != 2 || rec.readDeadlines[0].IsZero() || !rec.readDeadlines[1].IsZero() {
		t.Fatalf("expected timeout path to set and reset read deadline, got %+v", rec.readDeadlines)
	}

	retry := httptest.NewRecorder()
	retryReq := httptest.NewRequest(http.MethodPost, "/v1/themes/install", bytes.NewReader([]byte("not a zip")))
	retryReq.Header.Set("Content-Type", "application/zip")
	server.Handler().ServeHTTP(retry, retryReq)
	if retry.Code != http.StatusBadRequest {
		t.Fatalf("expected released guard to process retry as invalid ZIP, got %d body=%s", retry.Code, retry.Body.String())
	}
	if err := json.Unmarshal(retry.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode retry response: %v", err)
	}
	if got.Error.Code != "invalid_theme_pack" {
		t.Fatalf("expected invalid ZIP after released guard, got %+v", got)
	}
}

func TestThemeInstallZipRejectsInvalidBodiesBeforeDeviceGate(t *testing.T) {
	var deviceCalls atomic.Int32
	device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		deviceCalls.Add(1)
		http.Error(w, "unexpected device request", http.StatusInternalServerError)
	}))
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{DeviceTarget: device.URL, DeviceToken: "pair-token"})
	server.installTheme = func(context.Context, themeinstall.Options) (themeinstall.Result, error) {
		t.Fatal("install should not be called for an invalid ZIP")
		return themeinstall.Result{}, nil
	}

	tests := []struct {
		name       string
		body       []byte
		length     int64
		wantStatus int
		wantCode   string
	}{
		{name: "empty", body: nil, wantStatus: http.StatusBadRequest, wantCode: "empty_theme_pack"},
		{name: "malformed", body: []byte("not a zip"), wantStatus: http.StatusBadRequest, wantCode: "invalid_theme_pack"},
		{name: "oversized", body: []byte("small"), length: int64(themepack.MaxZipBytes) + 1, wantStatus: http.StatusRequestEntityTooLarge, wantCode: "theme_pack_too_large"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			beforeDeviceCalls := deviceCalls.Load()
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/v1/themes/install", bytes.NewReader(test.body))
			req.Header.Set("Content-Type", "application/zip")
			if test.length > 0 {
				req.ContentLength = test.length
			}
			server.Handler().ServeHTTP(rec, req)
			if rec.Code != test.wantStatus {
				t.Fatalf("expected status %d, got %d body=%s", test.wantStatus, rec.Code, rec.Body.String())
			}
			var got errorResponse
			if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
				t.Fatalf("decode response: %v", err)
			}
			if got.OK || got.Error.Code != test.wantCode {
				t.Fatalf("unexpected error response: %+v", got)
			}
			if gotCalls := deviceCalls.Load(); gotCalls != beforeDeviceCalls {
				t.Fatalf("invalid ZIP touched device gates: calls=%d", gotCalls-beforeDeviceCalls)
			}
		})
	}
}

func TestThemeInstallZipHonorsDisabledGate(t *testing.T) {
	t.Setenv(themeInstallDisableEnv, "1")
	var deviceCalls atomic.Int32
	device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		deviceCalls.Add(1)
		http.Error(w, "unexpected device request", http.StatusInternalServerError)
	}))
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{DeviceTarget: device.URL, DeviceToken: "pair-token"})
	server.installTheme = func(context.Context, themeinstall.Options) (themeinstall.Result, error) {
		t.Fatal("install should not be called while theme install is disabled")
		return themeinstall.Result{}, nil
	}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/themes/install?async=true", bytes.NewReader(testThemePackZip(t)))
	req.Header.Set("Content-Type", "application/zip")
	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected status 403, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got errorResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.OK || got.Error.Code != "theme_install_disabled" {
		t.Fatalf("unexpected disabled response: %+v", got)
	}
	if gotCalls := deviceCalls.Load(); gotCalls != 0 {
		t.Fatalf("disabled ZIP install touched device gates: calls=%d", gotCalls)
	}
}

func TestThemeInstallRejectsConcurrentZipBeforeReadingBody(t *testing.T) {
	device := newThemeInstallReadyDeviceServer(t)
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{DeviceTarget: device.URL, DeviceToken: "pair-token"})
	installStarted := make(chan struct{})
	releaseInstall := make(chan struct{})
	var installCalls atomic.Int32
	server.installTheme = func(_ context.Context, opts themeinstall.Options) (themeinstall.Result, error) {
		if installCalls.Add(1) == 1 {
			close(installStarted)
		}
		<-releaseInstall
		return themeinstall.Result{ThemeID: "cozy-meadow", PackID: "cozy-meadow"}, nil
	}

	first := httptest.NewRecorder()
	firstReq := httptest.NewRequest(http.MethodPost, "/v1/themes/install?async=true", bytes.NewReader(testThemePackZip(t)))
	firstReq.Header.Set("Content-Type", "application/zip")
	server.Handler().ServeHTTP(first, firstReq)
	if first.Code != http.StatusAccepted {
		close(releaseInstall)
		t.Fatalf("expected first status 202, got %d body=%s", first.Code, first.Body.String())
	}
	select {
	case <-installStarted:
	case <-time.After(time.Second):
		close(releaseInstall)
		t.Fatal("timed out waiting for first install to start")
	}

	body := &readCountingReader{}
	second := httptest.NewRecorder()
	secondReq := httptest.NewRequest(http.MethodPost, "/v1/themes/install?async=true", body)
	secondReq.Header.Set("Content-Type", "application/zip")
	server.Handler().ServeHTTP(second, secondReq)
	if second.Code != http.StatusConflict {
		close(releaseInstall)
		t.Fatalf("expected concurrent status 409, got %d body=%s", second.Code, second.Body.String())
	}
	var got errorResponse
	if err := json.Unmarshal(second.Body.Bytes(), &got); err != nil {
		close(releaseInstall)
		t.Fatalf("decode response: %v", err)
	}
	if got.Error.Code != "theme_install_in_progress" {
		close(releaseInstall)
		t.Fatalf("unexpected concurrent response: %+v", got)
	}
	if reads := body.reads.Load(); reads != 0 {
		close(releaseInstall)
		t.Fatalf("concurrent ZIP body was read before rejection: reads=%d", reads)
	}
	if calls := installCalls.Load(); calls != 1 {
		close(releaseInstall)
		t.Fatalf("expected one active install, got %d", calls)
	}
	close(releaseInstall)
	for attempt := 0; attempt < 50; attempt++ {
		if job, ok := server.latestThemeInstallJob(); ok && job.Phase != "installing" {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("active install did not finish after release")
}

func TestThemeInstallAsyncReportsCustomerProgress(t *testing.T) {
	device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hello":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"board":"esp8266-smalltv-st7789","features":["theme","theme-spec-v1"],"capabilities":{"theme":{"supportsThemeSpecV1":true},"transport":{"active":"wifi"}}}`))
		case "/health":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true,"settings":{"display":{"brightnessPercent":40}}}`))
		default:
			t.Fatalf("unexpected device path %s", r.URL.Path)
		}
	}))
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{DeviceTarget: device.URL, DeviceToken: "pair-token"})
	server.installTheme = func(_ context.Context, opts themeinstall.Options) (themeinstall.Result, error) {
		_, _ = io.WriteString(opts.Out, "Preparing theme: Clippy\n")
		_, _ = io.WriteString(opts.Out, "Uploading theme files...\n")
		_, _ = io.WriteString(opts.Out, "Uploaded asset: /themes/u/clippy.cbi bytes=123\n")
		_, _ = io.WriteString(opts.Out, "Activating theme...\n")
		_, _ = io.WriteString(opts.Out, "Theme activation interrupted, retrying...\n")
		_, _ = io.WriteString(opts.Out, "Theme activation retry 2/3.\n")
		_, _ = io.WriteString(opts.Out, "Theme activation did not settle, retrying...\n")
		return themeinstall.Result{
			ThemeID:       opts.ThemeID,
			PackID:        "clippy",
			Name:          "Clippy",
			ActivePath:    "/themes/u/clippy.json",
			ThemeRevision: 1,
		}, nil
	}

	body := strings.NewReader(`{"themeId":"clippy","packUrl":"https://example.com/clippy.zip","async":true}`)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/themes/install", body)
	req.Header.Set("Content-Type", "application/json")

	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("expected status 202, got %d body=%s", rec.Code, rec.Body.String())
	}
	var started themeInstallJobResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &started); err != nil {
		t.Fatalf("decode start response: %v", err)
	}
	if started.Job.ID == "" || started.Job.Phase != "installing" {
		t.Fatalf("unexpected started job: %+v", started.Job)
	}

	var got themeInstallJobResponse
	for attempt := 0; attempt < 50; attempt++ {
		rec = httptest.NewRecorder()
		req = httptest.NewRequest(http.MethodGet, "/v1/themes/install/status?jobId="+started.Job.ID, nil)
		server.Handler().ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
			t.Fatalf("decode status response: %v", err)
		}
		if got.Job.Phase == "complete" {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if got.Job.Phase != "complete" {
		t.Fatalf("expected completed job, got %+v", got.Job)
	}
	if got.Job.Result == nil || got.Job.Result.ThemeID != "clippy" {
		t.Fatalf("expected result in completed job, got %+v", got.Job)
	}
	joinedLogs := strings.Join(got.Job.Logs, "\n")
	for _, want := range []string{
		"Preparing theme files.",
		"Uploading theme files.",
		"Uploaded theme file 1.",
		"Theme activation interrupted. Retrying.",
		"Retrying theme activation.",
		"Waiting for VibeTV to apply theme.",
		"Theme is active on VibeTV.",
	} {
		if !strings.Contains(joinedLogs, want) {
			t.Fatalf("expected customer progress log %q in %q", want, joinedLogs)
		}
	}
	if strings.Contains(joinedLogs, "/themes/u") || strings.Contains(joinedLogs, "https://example.com") {
		t.Fatalf("async progress leaked technical install detail: %q", joinedLogs)
	}
}

func TestFirmwareUpdateAsyncReportsCustomerProgress(t *testing.T) {
	device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hello":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"kind":"hello","deviceId":"device-174","protocolVersion":2,"board":"esp8266-smalltv-st7789","firmware":"1.0.32","capabilities":{"transport":{"active":"wifi"}}}`))
		case "/health":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true}`))
		default:
			t.Fatalf("unexpected device path %s", r.URL.Path)
		}
	}))
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{DeviceTarget: device.URL, DeviceToken: "pair-token", DeviceID: "device-174"})
	server.refreshStream = func(context.Context, string) error { return nil }
	server.waitStreamAfter = func(_ context.Context, target string, _ time.Time) displayStreamInfo {
		return displayStreamInfo{Healthy: true, Running: true, Target: target, LastTarget: target}
	}
	server.waitRender = func(_ context.Context, _ string, _ string, _ deviceHealth) (deviceHealth, error) {
		return deviceHealth{OK: true}, nil
	}
	server.updateFirmware = func(_ context.Context, _ string, cfg runtimeconfig.Config, req firmwareUpdateRequest, out io.Writer) error {
		if cfg.DeviceTarget != device.URL || strings.TrimSpace(cfg.DeviceToken) != "pair-token" {
			t.Fatalf("unexpected update config: %+v", cfg)
		}
		if req.Force {
			t.Fatalf("force should default to false")
		}
		for _, line := range []string{
			`CODEX_FIRMWARE_UPDATE_EVENT {"stage":"validating_artifact","phase":"installing","target":"` + device.URL + `","deviceId":"device-174","helloVerified":true}`,
			"Checking device...",
			"Device: esp8266-smalltv-st7789 firmware 1.0.31",
			"Checking firmware...",
			"Updating firmware: 1.0.31 -> 1.0.32",
			"Firmware downloaded: /tmp/private/path sha256=secret",
			"Pausing Mac App during firmware update...",
			"Uploading firmware...",
			"Restarting VibeTV...",
			`CODEX_FIRMWARE_UPDATE_EVENT {"stage":"verifying_health","phase":"installing","firmware":"1.0.32","target":"` + device.URL + `","deviceId":"device-174","artifactValidated":true,"uploadAccepted":true,"helloVerified":true}`,
			"Done: firmware 1.0.32 installed",
		} {
			_, _ = io.WriteString(out, line+"\n")
		}
		return nil
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/updates/install", strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json")
	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("expected status 202, got %d body=%s", rec.Code, rec.Body.String())
	}
	var started firmwareUpdateJobResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &started); err != nil {
		t.Fatalf("decode start response: %v", err)
	}
	if started.Job.ID == "" || started.Job.Phase != "installing" {
		t.Fatalf("unexpected started job: %+v", started.Job)
	}

	var got firmwareUpdateJobResponse
	for attempt := 0; attempt < 50; attempt++ {
		rec = httptest.NewRecorder()
		req = httptest.NewRequest(http.MethodGet, "/v1/updates/install/status?jobId="+started.Job.ID, nil)
		server.Handler().ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
			t.Fatalf("decode status response: %v", err)
		}
		if got.Job.Phase == "complete" {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if got.Job.Phase != "complete" || got.Job.Progress != 100 {
		t.Fatalf("expected completed update job, got %+v", got.Job)
	}
	if got.Job.Result == nil || got.Job.Result.Firmware != "1.0.32" {
		t.Fatalf("expected firmware result, got %+v", got.Job.Result)
	}
	joinedLogs := strings.Join(got.Job.Logs, "\n")
	for _, want := range []string{"Update downloaded.", "Updating VibeTV.", "Restarting VibeTV.", "Checking VibeTV health.", "Restarting display stream.", "Checking the picture.", "Update complete."} {
		if !strings.Contains(joinedLogs, want) {
			t.Fatalf("expected customer update log %q in %q", want, joinedLogs)
		}
	}
	for _, hidden := range []string{"/tmp/private", "sha256", "secret"} {
		if strings.Contains(joinedLogs, hidden) {
			t.Fatalf("update progress leaked technical detail %q in %q", hidden, joinedLogs)
		}
	}
}

func TestFirmwareUpdatePausesDisplayTrafficUntilJobFinishes(t *testing.T) {
	var deviceCalls atomic.Int32
	device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		deviceCalls.Add(1)
		switch r.URL.Path {
		case "/hello":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"kind":"hello","deviceId":"device-pause","protocolVersion":2,"board":"esp8266-smalltv-st7789","firmware":"1.0.36","capabilities":{"transport":{"active":"wifi"}}}`))
		case "/health":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true}`))
		default:
			t.Fatalf("unexpected device path %s", r.URL.Path)
		}
	}))
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{DeviceTarget: device.URL, DeviceToken: "pair-token", DeviceID: "device-pause"})
	server.refreshStream = func(context.Context, string) error { return nil }
	server.waitStreamAfter = func(_ context.Context, target string, _ time.Time) displayStreamInfo {
		return displayStreamInfo{Healthy: true, Running: true, Target: target, LastTarget: target}
	}
	server.waitRender = func(_ context.Context, _ string, _ string, _ deviceHealth) (deviceHealth, error) {
		return deviceHealth{OK: true}, nil
	}
	pauseEvents := make(chan bool, 2)
	server.pauseDisplayStream = func(paused bool) { pauseEvents <- paused }
	startedUpdate := make(chan struct{})
	finishUpdate := make(chan struct{})
	server.updateFirmware = func(_ context.Context, _ string, _ runtimeconfig.Config, _ firmwareUpdateRequest, out io.Writer) error {
		close(startedUpdate)
		<-finishUpdate
		_, _ = io.WriteString(out, `CODEX_FIRMWARE_UPDATE_EVENT {"stage":"verifying_health","phase":"installing","outcome":"already_current","firmware":"1.0.36","target":"`+device.URL+`","deviceId":"device-pause","artifactValidated":true,"helloVerified":true}`+"\n")
		return nil
	}

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/updates/install", strings.NewReader(`{}`))
	request.Header.Set("Content-Type", "application/json")
	server.Handler().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusAccepted {
		t.Fatalf("expected update start, got %d body=%s", recorder.Code, recorder.Body.String())
	}
	var started firmwareUpdateJobResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &started); err != nil {
		t.Fatalf("decode update start: %v", err)
	}

	select {
	case <-startedUpdate:
	case <-time.After(time.Second):
		t.Fatal("firmware update did not start")
	}
	select {
	case paused := <-pauseEvents:
		if !paused {
			t.Fatal("display stream resumed before firmware update started")
		}
	default:
		t.Fatal("firmware update did not pause display stream")
	}

	beforeStatus := deviceCalls.Load()
	statusRecorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(statusRecorder, httptest.NewRequest(http.MethodGet, "/v1/status", nil))
	if statusRecorder.Code != http.StatusOK {
		t.Fatalf("expected local status during update, got %d body=%s", statusRecorder.Code, statusRecorder.Body.String())
	}
	if got := deviceCalls.Load(); got != beforeStatus {
		t.Fatalf("status polled VibeTV during firmware upload: before=%d after=%d", beforeStatus, got)
	}

	close(finishUpdate)
	for attempt := 0; attempt < 50; attempt++ {
		job, ok := server.firmwareUpdateJobSnapshot(started.Job.ID)
		if ok && job.Phase == "complete" {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	select {
	case paused := <-pauseEvents:
		if paused {
			t.Fatal("display stream stayed paused after firmware update")
		}
	case <-time.After(time.Second):
		t.Fatal("firmware update did not resume display stream")
	}
}

func TestFirmwareUpdateVerifiedFirmwareOverridesTemporaryCommandError(t *testing.T) {
	device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hello":
			_, _ = w.Write([]byte(`{"kind":"hello","deviceId":"device-recovered","protocolVersion":2,"board":"esp8266-smalltv-st7789","firmware":"1.0.40"}`))
		case "/health":
			_, _ = w.Write([]byte(`{"ok":true}`))
		default:
			t.Fatalf("unexpected device path %s", r.URL.Path)
		}
	}))
	defer device.Close()
	server := newTestServer(t, runtimeconfig.Config{DeviceTarget: device.URL, DeviceID: "device-recovered", DeviceToken: "pair-token"})
	server.refreshStream = func(context.Context, string) error { return nil }
	server.waitStreamAfter = func(_ context.Context, target string, _ time.Time) displayStreamInfo {
		return displayStreamInfo{Healthy: true, Running: true, Target: target, LastTarget: target}
	}
	server.waitRender = func(_ context.Context, _ string, _ string, _ deviceHealth) (deviceHealth, error) {
		return deviceHealth{OK: true}, nil
	}
	server.updateFirmware = func(_ context.Context, _ string, _ runtimeconfig.Config, _ firmwareUpdateRequest, out io.Writer) error {
		_, _ = io.WriteString(out, `CODEX_FIRMWARE_UPDATE_EVENT {"stage":"rebooting","phase":"installing","firmware":"1.0.40","target":"`+device.URL+`","deviceId":"device-recovered","artifactValidated":true,"uploadAccepted":true,"helloVerified":true}`+"\n")
		return errors.New("temporary timeout after accepted upload")
	}

	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/v1/updates/install", strings.NewReader(`{}`)))
	var started firmwareUpdateJobResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &started); err != nil {
		t.Fatal(err)
	}
	var job firmwareUpdateJob
	for attempt := 0; attempt < 100; attempt++ {
		job, _ = server.firmwareUpdateJobSnapshot(started.Job.ID)
		if job.Phase != "installing" {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if job.Phase != "complete" || job.Outcome != "updated" || job.Result == nil || !job.Result.RenderVerified {
		t.Fatalf("verified running state must override the temporary command error: %+v", job)
	}
}

func TestFirmwareUpdateCurrentFirmwareWithStreamFailureNeedsAttention(t *testing.T) {
	device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hello":
			_, _ = w.Write([]byte(`{"kind":"hello","deviceId":"device-attention","protocolVersion":2,"board":"esp8266-smalltv-st7789","firmware":"1.0.40"}`))
		case "/health":
			_, _ = w.Write([]byte(`{"ok":true}`))
		default:
			t.Fatalf("unexpected device path %s", r.URL.Path)
		}
	}))
	defer device.Close()
	server := newTestServer(t, runtimeconfig.Config{DeviceTarget: device.URL, DeviceID: "device-attention", DeviceToken: "pair-token"})
	server.refreshStream = func(context.Context, string) error { return errors.New("stream unavailable") }
	server.updateFirmware = func(_ context.Context, _ string, _ runtimeconfig.Config, _ firmwareUpdateRequest, out io.Writer) error {
		_, _ = io.WriteString(out, `CODEX_FIRMWARE_UPDATE_EVENT {"stage":"verifying_health","phase":"installing","firmware":"1.0.40","target":"`+device.URL+`","deviceId":"device-attention","artifactValidated":true,"uploadAccepted":true,"helloVerified":true}`+"\n")
		return nil
	}

	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/v1/updates/install", strings.NewReader(`{}`)))
	var started firmwareUpdateJobResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &started); err != nil {
		t.Fatal(err)
	}
	var job firmwareUpdateJob
	for attempt := 0; attempt < 100; attempt++ {
		job, _ = server.firmwareUpdateJobSnapshot(started.Job.ID)
		if job.Phase != "installing" {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if job.Phase != "attention" || job.Outcome != "firmware_current_stream_attention" || job.Result == nil || !job.Result.HealthVerified || job.Result.StreamVerified {
		t.Fatalf("current firmware with a broken stream must need attention without another flash: %+v", job)
	}
}

func TestFirmwareUpdateAsyncReportsCustomerError(t *testing.T) {
	device := newThemeInstallReadyDeviceServer(t)
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{DeviceTarget: device.URL, DeviceToken: "pair-token"})
	server.updateFirmware = func(_ context.Context, _ string, _ runtimeconfig.Config, _ firmwareUpdateRequest, out io.Writer) error {
		_, _ = io.WriteString(out, "Checking device...\nUploading firmware...\n")
		return errors.New(`POST /update/firmware.raw returned 401 body="pair-token rejected"`)
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/updates/install", strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json")
	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("expected status 202, got %d body=%s", rec.Code, rec.Body.String())
	}
	var started firmwareUpdateJobResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &started); err != nil {
		t.Fatalf("decode start response: %v", err)
	}

	var got firmwareUpdateJobResponse
	for attempt := 0; attempt < 50; attempt++ {
		rec = httptest.NewRecorder()
		req = httptest.NewRequest(http.MethodGet, "/v1/updates/install/status?jobId="+started.Job.ID, nil)
		server.Handler().ServeHTTP(rec, req)
		if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
			t.Fatalf("decode status response: %v", err)
		}
		if got.Job.Phase == "error" {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if got.Job.Phase != "error" || got.Job.Error == nil {
		t.Fatalf("expected failed update job, got %+v", got.Job)
	}
	if got.Job.Error.Code != "firmware_update_failed" {
		t.Fatalf("unexpected update error: %+v", got.Job.Error)
	}
	joinedLogs := strings.Join(got.Job.Logs, "\n")
	if strings.Contains(joinedLogs, "pair-token") || strings.Contains(got.Job.Error.Message, "pair-token") {
		t.Fatalf("update error leaked token: job=%+v logs=%q", got.Job, joinedLogs)
	}
}

func TestFirmwareUpdateAsyncRequiresPowerCycleAfterUnsafeUpload(t *testing.T) {
	device := newThemeInstallReadyDeviceServer(t)
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{DeviceTarget: device.URL, DeviceToken: "pair-token"})
	server.updateFirmware = func(_ context.Context, _ string, _ runtimeconfig.Config, _ firmwareUpdateRequest, out io.Writer) error {
		event, err := json.Marshal(firmwareUpdateEvent{Stage: "uploading", RetryPolicy: "power_cycle"})
		if err != nil {
			t.Fatal(err)
		}
		_, _ = fmt.Fprintf(out, "%s%s\n", firmwareupdate.EventPrefix, event)
		return errors.New("exit status 1")
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/updates/install", strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json")
	server.Handler().ServeHTTP(rec, req)
	var started firmwareUpdateJobResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &started); err != nil {
		t.Fatal(err)
	}

	var job firmwareUpdateJob
	for attempt := 0; attempt < 50; attempt++ {
		job, _ = server.firmwareUpdateJobSnapshot(started.Job.ID)
		if job.Phase == "error" {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if job.Error == nil || job.Error.Code != "firmware_update_restart_required" {
		t.Fatalf("unsafe upload must require a power cycle: %+v", job)
	}
	if job.RetryPolicy != "power_cycle" || !strings.Contains(job.Error.NextAction, "Disconnect VibeTV from power") {
		t.Fatalf("missing typed power-cycle recovery: %+v", job)
	}
}

func TestMacAppUpdateAsyncReportsCustomerProgress(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	server.allowMacAppSelfUpdate = true
	server.updateMacApp = func(_ context.Context, home string, addr string, req macAppUpdateRequest, out io.Writer) error {
		if strings.TrimSpace(home) == "" {
			t.Fatalf("expected update to receive home directory")
		}
		if addr != DefaultAddr {
			t.Fatalf("unexpected update addr: %q", addr)
		}
		if req.Version != "1.0.36" {
			t.Fatalf("unexpected update request: %+v", req)
		}
		for _, line := range []string{
			"vibetv: repo=DreamyTalesPAN/CodexBar-Display",
			"vibetv: release=v1.0.36",
			"vibetv: arch=arm64",
			"vibetv: Mac setup binary installed at /private/tmp/codexbar-display",
			"vibetv: background service installed at /Users/customer/Library/LaunchAgents/com.codexbar-display.daemon.plist",
			"vibetv: Mac App answered with version 1.0.36; restarting once",
			"vibetv: Mac App update verified",
		} {
			_, _ = io.WriteString(out, line+"\n")
		}
		return nil
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/mac-app/update", strings.NewReader(`{"version":"1.0.36"}`))
	req.Header.Set("Content-Type", "application/json")
	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("expected status 202, got %d body=%s", rec.Code, rec.Body.String())
	}
	var started macAppUpdateJobResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &started); err != nil {
		t.Fatalf("decode start response: %v", err)
	}
	if started.Job.ID == "" || started.Job.Phase != "installing" {
		t.Fatalf("unexpected started job: %+v", started.Job)
	}

	var got macAppUpdateJobResponse
	for attempt := 0; attempt < 50; attempt++ {
		rec = httptest.NewRecorder()
		req = httptest.NewRequest(http.MethodGet, "/v1/mac-app/update/status?jobId="+started.Job.ID, nil)
		server.Handler().ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
			t.Fatalf("decode status response: %v", err)
		}
		if got.Job.Phase == "complete" {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if got.Job.Phase != "complete" || got.Job.Progress != 100 {
		t.Fatalf("expected completed Mac App update job, got %+v", got.Job)
	}
	if got.Job.Result == nil || got.Job.Result.Version != "1.0.36" {
		t.Fatalf("expected Mac App version result, got %+v", got.Job.Result)
	}
	joinedLogs := strings.Join(got.Job.Logs, "\n")
	for _, want := range []string{"Downloading Mac App update.", "Preparing this Mac.", "Installing Mac App.", "Restarting Mac App.", "Checking Mac App.", "Mac App updated."} {
		if !strings.Contains(joinedLogs, want) {
			t.Fatalf("expected customer Mac App update log %q in %q", want, joinedLogs)
		}
	}
	for _, hidden := range []string{"/private", "LaunchAgents", "DreamyTalesPAN/CodexBar-Display"} {
		if strings.Contains(joinedLogs, hidden) {
			t.Fatalf("Mac App update progress leaked technical detail %q in %q", hidden, joinedLogs)
		}
	}
}

func TestMacAppUpdateAsyncReportsCustomerError(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	server.allowMacAppSelfUpdate = true
	server.updateMacApp = func(_ context.Context, _ string, _ string, _ macAppUpdateRequest, out io.Writer) error {
		_, _ = io.WriteString(out, "vibetv: release=v1.0.36\nvibetv: arch=arm64\n")
		return errors.New("curl https://token@example.com/private failed")
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/mac-app/update", strings.NewReader(`{"version":"1.0.36"}`))
	req.Header.Set("Content-Type", "application/json")
	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("expected status 202, got %d body=%s", rec.Code, rec.Body.String())
	}
	var started macAppUpdateJobResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &started); err != nil {
		t.Fatalf("decode start response: %v", err)
	}

	var got macAppUpdateJobResponse
	for attempt := 0; attempt < 50; attempt++ {
		rec = httptest.NewRecorder()
		req = httptest.NewRequest(http.MethodGet, "/v1/mac-app/update/status?jobId="+started.Job.ID, nil)
		server.Handler().ServeHTTP(rec, req)
		if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
			t.Fatalf("decode status response: %v", err)
		}
		if got.Job.Phase == "error" {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if got.Job.Phase != "error" || got.Job.Error == nil {
		t.Fatalf("expected failed Mac App update job, got %+v", got.Job)
	}
	if got.Job.Error.Code != "mac_app_update_failed" {
		t.Fatalf("unexpected Mac App update error: %+v", got.Job.Error)
	}
	joinedLogs := strings.Join(got.Job.Logs, "\n")
	for _, hidden := range []string{"token@example.com", "/private"} {
		if strings.Contains(joinedLogs, hidden) {
			t.Fatalf("failed Mac App update leaked technical detail in logs: %q", joinedLogs)
		}
	}
}

func TestThemeInstallErrorIncludesSanitizedDetail(t *testing.T) {
	device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hello":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"board":"esp8266-smalltv-st7789","features":["theme","theme-spec-v1"],"capabilities":{"theme":{"supportsThemeSpecV1":true},"transport":{"active":"wifi"}}}`))
		case "/health":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true,"settings":{"display":{"brightnessPercent":40}}}`))
		default:
			t.Fatalf("unexpected device path %s", r.URL.Path)
		}
	}))
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{DeviceTarget: device.URL, DeviceToken: "pair-token"})
	server.installTheme = func(ctx context.Context, opts themeinstall.Options) (themeinstall.Result, error) {
		return themeinstall.Result{}, errors.New(`theme-pack/upload: post asset /themes/u/cm.cbi: Post "http://192.0.2.10/assets?path=%2Fthemes%2Fu%2Fcm.cbi&token=pair-token": connection reset by peer`)
	}

	body := strings.NewReader(`{"themeId":"cozy-meadow","packUrl":"https://example.com/cozy.zip"}`)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/themes/install", body)
	req.Header.Set("Content-Type", "application/json")

	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusBadGateway {
		t.Fatalf("expected status 502, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got errorResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !strings.Contains(got.Error.Message, "theme-pack/upload") {
		t.Fatalf("expected install detail in response, got %+v", got.Error)
	}
	if strings.Contains(got.Error.Message, "pair-token") {
		t.Fatalf("install error leaked pairing token: %q", got.Error.Message)
	}
}

func TestThemeInstallRequiresPairingBeforeWrite(t *testing.T) {
	device := newThemeInstallReadyDeviceServer(t)
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{DeviceTarget: device.URL})
	server.installTheme = func(context.Context, themeinstall.Options) (themeinstall.Result, error) {
		t.Fatal("install should not be called without pairing")
		return themeinstall.Result{}, nil
	}

	body := strings.NewReader(`{"themeId":"cozy-meadow","packUrl":"https://example.com/cozy.zip"}`)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/themes/install", body)
	req.Header.Set("Content-Type", "application/json")

	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected status 403, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got errorResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.OK || got.Error.Code != "pairing_required" {
		t.Fatalf("unexpected pairing response: %+v", got)
	}
}

func TestThemeInstallRejectsInvalidPackURLBeforeGate(t *testing.T) {
	device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatalf("device should not be contacted for invalid pack URL, got %s", r.URL.Path)
	}))
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{DeviceTarget: device.URL, DeviceToken: "pair-token"})
	server.installTheme = func(context.Context, themeinstall.Options) (themeinstall.Result, error) {
		t.Fatal("install should not be called for invalid pack URL")
		return themeinstall.Result{}, nil
	}

	body := strings.NewReader(`{"themeId":"cozy-meadow","packUrl":"/local/theme.zip"}`)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/themes/install", body)
	req.Header.Set("Content-Type", "application/json")

	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected status 400, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got errorResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.OK || got.Error.Code != "invalid_theme_pack_url" {
		t.Fatalf("unexpected invalid pack URL response: %+v", got)
	}
}

func TestResolveEmbeddedThemePackReadsOnlyOwnBundledZip(t *testing.T) {
	data := testThemePackZip(t)
	server := newTestServer(t, runtimeconfig.Config{})
	server.controlCenterFS = fstest.MapFS{
		"theme-packs/cozy.zip": &fstest.MapFile{Data: data},
	}
	req := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:47832/v1/themes/install", nil)
	resolved, err := server.resolveEmbeddedThemePack(req, themeInstallRequest{
		PackURL: "http://127.0.0.1:47832/theme-packs/cozy.zip",
	})
	if err != nil {
		t.Fatalf("resolve embedded pack: %v", err)
	}
	if resolved.PackURL != "" || !bytes.Equal(resolved.PackBytes, data) {
		t.Fatalf("embedded pack was not converted to trusted bytes: %+v", resolved)
	}

	foreign, err := server.resolveEmbeddedThemePack(req, themeInstallRequest{
		PackURL: "http://127.0.0.1:9000/private.zip",
	})
	if err != nil {
		t.Fatalf("foreign URL should be left for remote policy: %v", err)
	}
	if foreign.PackURL == "" || foreign.PackBytes != nil {
		t.Fatalf("foreign loopback URL was treated as an embedded asset: %+v", foreign)
	}
}

func TestThemeInstallRejectsInsecureRemotePackURL(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	body := strings.NewReader(`{"themeId":"cozy-meadow","packUrl":"http://169.254.169.254/latest/meta-data"}`)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/themes/install", body)
	req.Header.Set("Content-Type", "application/json")

	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "invalid_theme_pack_url") {
		t.Fatalf("expected insecure pack URL rejection, got %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestThemeInstallRequiresThemeSpecSupportBeforeWrite(t *testing.T) {
	device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hello":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"board":"esp8266-smalltv-st7789","capabilities":{"transport":{"active":"wifi"}}}`))
		case "/health":
			t.Fatal("health should not be called when theme capability is missing")
		default:
			t.Fatalf("unexpected device path %s", r.URL.Path)
		}
	}))
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{DeviceTarget: device.URL, DeviceToken: "pair-token"})
	server.installTheme = func(context.Context, themeinstall.Options) (themeinstall.Result, error) {
		t.Fatal("install should not be called without ThemeSpec support")
		return themeinstall.Result{}, nil
	}

	body := strings.NewReader(`{"themeId":"cozy-meadow","packUrl":"https://example.com/cozy.zip"}`)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/themes/install", body)
	req.Header.Set("Content-Type", "application/json")

	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected status 400, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got errorResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.OK || got.Error.Code != "theme_install_unsupported" {
		t.Fatalf("unexpected unsupported response: %+v", got)
	}
}

func TestThemeInstallRequiresHealthBeforeWrite(t *testing.T) {
	device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hello":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"board":"esp8266-smalltv-st7789","features":["theme","theme-spec-v1"],"capabilities":{"theme":{"supportsThemeSpecV1":true},"transport":{"active":"wifi"}}}`))
		case "/health":
			http.Error(w, "health unavailable", http.StatusServiceUnavailable)
		default:
			t.Fatalf("unexpected device path %s", r.URL.Path)
		}
	}))
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{DeviceTarget: device.URL, DeviceToken: "pair-token"})
	server.installTheme = func(context.Context, themeinstall.Options) (themeinstall.Result, error) {
		t.Fatal("install should not be called when health check fails")
		return themeinstall.Result{}, nil
	}

	body := strings.NewReader(`{"themeId":"cozy-meadow","packUrl":"https://example.com/cozy.zip"}`)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/themes/install", body)
	req.Header.Set("Content-Type", "application/json")

	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusBadGateway {
		t.Fatalf("expected status 502, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got errorResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.OK || got.Error.Code != "device_health_failed" {
		t.Fatalf("unexpected health response: %+v", got)
	}
}

func TestThemeInstallCanBeDisabledByLocalEnv(t *testing.T) {
	t.Setenv(themeInstallDisableEnv, "1")

	device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatalf("device should not be contacted while theme install is disabled, got %s", r.URL.Path)
	}))
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{DeviceTarget: device.URL, DeviceToken: "pair-token"})
	body := strings.NewReader(`{"themeId":"cozy-meadow","packUrl":"https://example.com/cozy.zip"}`)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/themes/install", body)
	req.Header.Set("Content-Type", "application/json")

	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected status 403, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got errorResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.OK || got.Error.Code != "theme_install_disabled" {
		t.Fatalf("unexpected disabled response: %+v", got)
	}
}

func TestSettingsGetReportsActiveTheme(t *testing.T) {
	device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hello":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"board":"esp8266-smalltv-st7789","capabilities":{"display":{"brightness":{"supported":true}},"transport":{"active":"wifi"}}}`))
		case "/health":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true,"display":{"activeTheme":"synthwave"},"settings":{"display":{"brightnessPercent":40}}}`))
		default:
			t.Fatalf("unexpected device path %s", r.URL.Path)
		}
	}))
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{DeviceTarget: device.URL, DeviceToken: "pair-token"})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/settings", nil)

	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got settingsResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.Device.ActiveTheme != "synthwave" {
		t.Fatalf("expected active theme synthwave, got %+v", got.Device)
	}
}

func TestSettingsValidatesAndForwardsBrightness(t *testing.T) {
	settingsCalls := 0
	device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hello":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"board":"esp8266-smalltv-st7789","capabilities":{"display":{"brightness":{"supported":true,"minPercent":10,"maxPercent":80}},"transport":{"active":"wifi"}}}`))
		case "/api/settings":
			settingsCalls++
			if got := r.Header.Get("X-VibeTV-Token"); got != "pair-token" {
				t.Fatalf("expected pairing token header, got %q", got)
			}
			if err := r.ParseForm(); err != nil {
				t.Fatalf("parse form: %v", err)
			}
			if got := r.Form.Get("b"); got != "40" {
				t.Fatalf("expected brightness b=40, got %q", got)
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true,"settings":{"display":{"brightnessPercent":40}}}`))
		case "/health":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true,"display":{"activeTheme":"mini-classic","themeSpec":{"active":true,"renderOk":true}},"settings":{"display":{"brightnessPercent":40}}}`))
		default:
			t.Fatalf("unexpected device path %s", r.URL.Path)
		}
	}))
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{DeviceTarget: device.URL, DeviceToken: "pair-token"})

	invalid := httptest.NewRecorder()
	invalidReq := httptest.NewRequest(http.MethodPost, "/v1/settings", strings.NewReader(`{"brightnessPercent":90}`))
	invalidReq.Header.Set("Content-Type", "application/json")
	server.Handler().ServeHTTP(invalid, invalidReq)
	if invalid.Code != http.StatusBadRequest {
		t.Fatalf("expected invalid brightness status 400, got %d body=%s", invalid.Code, invalid.Body.String())
	}
	if settingsCalls != 0 {
		t.Fatalf("invalid brightness should not be forwarded")
	}

	valid := httptest.NewRecorder()
	validReq := httptest.NewRequest(http.MethodPost, "/v1/settings", strings.NewReader(`{"brightnessPercent":40}`))
	validReq.Header.Set("Content-Type", "application/json")
	server.Handler().ServeHTTP(valid, validReq)
	if valid.Code != http.StatusOK {
		t.Fatalf("expected valid brightness status 200, got %d body=%s", valid.Code, valid.Body.String())
	}
	body, _ := io.ReadAll(valid.Body)
	if !strings.Contains(string(body), `"brightnessPercent":40`) {
		t.Fatalf("expected forwarded settings in response, got %s", string(body))
	}
	if settingsCalls != 1 {
		t.Fatalf("expected one forwarded settings call, got %d", settingsCalls)
	}
}

func newTestServer(t *testing.T, cfg runtimeconfig.Config) *Server {
	t.Helper()
	t.Setenv("CODEXBAR_DISPLAY_USAGE_MODE", "used")
	server, err := New(Options{Home: t.TempDir()})
	if err != nil {
		t.Fatalf("new server: %v", err)
	}
	server.probeCacheTime = 0
	current := cfg
	server.loadConfig = func(string) (runtimeconfig.Config, error) {
		return current, nil
	}
	server.saveConfig = func(_ string, next runtimeconfig.Config) error {
		current = next
		return nil
	}
	server.runSetup = func(context.Context, setup.Options) error {
		return nil
	}
	server.defaultWiFiTarget = func() string { return "http://127.0.0.1:1" }
	server.updateFirmware = func(context.Context, string, runtimeconfig.Config, firmwareUpdateRequest, io.Writer) error {
		return nil
	}
	server.updateMacApp = func(context.Context, string, string, macAppUpdateRequest, io.Writer) error {
		return nil
	}
	server.fetchMacAppRelease = func(context.Context) (githubRelease, error) {
		return githubRelease{TagName: "v1.0.0"}, nil
	}
	server.probeProviderSetup = func(context.Context, string) codexbar.ProviderSetup {
		return codexbar.ProviderSetup{
			Status: "ready",
			Engine: codexbar.EngineReadiness{Status: codexbar.ProviderReady},
			Providers: []codexbar.ProviderReadiness{{
				ID: "codex", Label: "Codex", Enabled: true, Status: codexbar.ProviderReady,
			}},
		}
	}
	server.providerPreferences.loadInventory = nil
	server.openCodexBar = func(context.Context) error { return nil }
	server.subnetTargets = func() []string {
		return nil
	}
	healthyStream := func(_ context.Context, target string) displayStreamInfo {
		return displayStreamInfo{
			Healthy:    true,
			Running:    true,
			LastSentAt: time.Now().UTC().Format(time.RFC3339),
			Target:     publicTarget(target),
			LastTarget: publicTarget(target),
			Detail:     "Display stream is sending usage frames.",
		}
	}
	server.streamStatus = healthyStream
	server.waitStream = healthyStream
	server.waitStreamAfter = func(ctx context.Context, target string, _ time.Time) displayStreamInfo {
		return server.waitStream(ctx, target)
	}
	server.waitStreamAfterPair = func(ctx context.Context, target string, _ time.Time) displayStreamInfo {
		return server.waitStream(ctx, target)
	}
	server.waitRender = func(_ context.Context, _ string, _ string, baseline deviceHealth) (deviceHealth, error) {
		fullCount := uint64(1)
		partialCount := uint64(0)
		if baseline.Render.FullCount != nil {
			fullCount = *baseline.Render.FullCount + 1
		}
		if baseline.Render.PartialCount != nil {
			partialCount = *baseline.Render.PartialCount
		}
		health := deviceHealth{OK: true}
		health.Render.FullCount = &fullCount
		health.Render.PartialCount = &partialCount
		health.Render.LastKind = "usage"
		return health, nil
	}
	return server
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (fn roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return fn(req)
}

type readCountingReader struct {
	reads atomic.Int32
}

func (r *readCountingReader) Read([]byte) (int, error) {
	r.reads.Add(1)
	return 0, io.EOF
}

type readDeadlineRecorder struct {
	*httptest.ResponseRecorder
	readDeadlines []time.Time
}

func (r *readDeadlineRecorder) SetReadDeadline(deadline time.Time) error {
	r.readDeadlines = append(r.readDeadlines, deadline)
	return nil
}

type timeoutReader struct{}

func (timeoutReader) Read([]byte) (int, error) {
	return 0, timeoutReadError{}
}

type timeoutReadError struct{}

func (timeoutReadError) Error() string   { return "read timeout" }
func (timeoutReadError) Timeout() bool   { return true }
func (timeoutReadError) Temporary() bool { return true }

func newHelloDeviceServer(t *testing.T) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hello":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"board":"esp8266-smalltv-st7789","firmware":"1.0.31","capabilities":{"transport":{"active":"wifi"}}}`))
		case "/health":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true,"display":{"activeTheme":"mini-classic","themeSpec":{"active":true,"renderOk":true}},"settings":{"display":{"brightnessPercent":40}}}`))
		default:
			t.Fatalf("unexpected device path %s", r.URL.Path)
		}
	}))
}

func newPairableDeviceServer(t *testing.T) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hello":
			if got := r.Header.Get("X-VibeTV-Token"); got != "" && got != "pair-token" {
				t.Fatalf("expected pairing token for hello, got %q", got)
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"board":"esp8266-smalltv-st7789","firmware":"1.0.31","deviceId":"pairable-device","capabilities":{"transport":{"active":"wifi"}}}`))
		case "/api/pair":
			if r.Method != http.MethodPost {
				t.Fatalf("expected POST pair, got %s", r.Method)
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true,"token":"pair-token"}`))
		case "/health":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true,"display":{"activeTheme":"mini-classic","themeSpec":{"active":true,"renderOk":true}},"settings":{"display":{"brightnessPercent":40}}}`))
		default:
			t.Fatalf("unexpected device path %s", r.URL.Path)
		}
	}))
}

func newRepairableDeviceServer(t *testing.T) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hello":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"board":"esp8266-smalltv-st7789","firmware":"1.0.31","features":["theme","theme-spec-v1"],"capabilities":{"theme":{"supportsThemeSpecV1":true},"transport":{"active":"wifi"}}}`))
		case "/api/pair":
			if r.Method != http.MethodPost {
				t.Fatalf("expected POST pair, got %s", r.Method)
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true,"token":"new-token"}`))
		case "/health":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true,"display":{"activeTheme":"clippy"},"settings":{"display":{"brightnessPercent":40}}}`))
		default:
			t.Fatalf("unexpected device path %s", r.URL.Path)
		}
	}))
}

func newThemeInstallReadyDeviceServer(t *testing.T) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hello":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"board":"esp8266-smalltv-st7789","firmware":"1.0.31","features":["theme","theme-spec-v1"],"capabilities":{"theme":{"supportsThemeSpecV1":true},"transport":{"active":"wifi"}}}`))
		case "/health":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true,"settings":{"display":{"brightnessPercent":40}}}`))
		default:
			t.Fatalf("unexpected device path %s", r.URL.Path)
		}
	}))
}

func testThemePackZip(t *testing.T) []byte {
	t.Helper()
	files := []struct {
		name string
		data string
	}{
		{
			name: "manifest.json",
			data: `{"kind":"vibetv-theme-pack","schemaVersion":1,"id":"cozy-meadow","name":"Cozy Meadow","themeSpec":{"path":"/themes/u/cm.json","file":"theme.json"}}`,
		},
		{
			name: "theme.json",
			data: `{"v":1,"id":"cozy-meadow","rev":1,"fb":"mini","p":[{"t":"tx","x":0,"y":0,"v":"OK","s":1}]}`,
		},
	}
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	for _, file := range files {
		entry, err := writer.Create(file.name)
		if err != nil {
			t.Fatalf("create ZIP entry %s: %v", file.name, err)
		}
		if _, err := io.WriteString(entry, file.data); err != nil {
			t.Fatalf("write ZIP entry %s: %v", file.name, err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close theme ZIP: %v", err)
	}
	return append([]byte(nil), buffer.Bytes()...)
}

func hasDiagnosticCheck(checks []diagnosticCheck, name, status string) bool {
	for _, check := range checks {
		if check.Name == name && check.Status == status {
			return true
		}
	}
	return false
}

func diagnosticCheckDetail(checks []diagnosticCheck, name string) string {
	for _, check := range checks {
		if check.Name == name {
			return check.Detail
		}
	}
	return ""
}

func TestStatusOffersFinalMacAppReleaseToInstalledPrerelease(t *testing.T) {
	t.Setenv(macAppVersionEnv, "1.0.44-rc.16")
	t.Setenv(macAppBuildEnv, "4416")
	server := newTestServer(t, runtimeconfig.Config{})
	server.fetchMacAppRelease = func(context.Context) (githubRelease, error) {
		return githubRelease{TagName: "v1.0.44"}, nil
	}

	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/v1/status", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got statusResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !got.Companion.Update.UpdateAvailable {
		t.Fatalf("expected RC install to be offered the final release, got %+v", got.Companion.Update)
	}
	if got.Companion.Update.LatestVersion != "1.0.44" || got.Companion.Update.InstalledVersion != "1.0.44-rc.16" {
		t.Fatalf("unexpected Mac App update versions: %+v", got.Companion.Update)
	}
}

func TestStatusKeepsExactFinalMacAppReleaseCurrent(t *testing.T) {
	t.Setenv(macAppVersionEnv, "1.0.44")
	t.Setenv(macAppBuildEnv, "4400")
	server := newTestServer(t, runtimeconfig.Config{})
	server.fetchMacAppRelease = func(context.Context) (githubRelease, error) {
		return githubRelease{TagName: "v1.0.44"}, nil
	}

	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/v1/status", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got statusResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.Companion.Update.UpdateAvailable {
		t.Fatalf("expected exact final release to stay current, got %+v", got.Companion.Update)
	}
}

func TestCompareMacAppReleaseVersionsSemVerPrecedence(t *testing.T) {
	cases := []struct {
		left  string
		right string
		want  int
	}{
		{"1.0.44", "1.0.44-rc.16", 1},
		{"1.0.44-rc.16", "1.0.44", -1},
		{"1.0.44-beta.1", "1.0.44-rc.1", -1},
		{"1.0.44-rc.2", "1.0.44-rc.10", -1},
		{"v1.0.45", "1.0.44", 1},
		{"1.0.44", "1.0.44", 0},
		{"not-a-version", "1.0.44", 0},
		{"1.0.44", "", 0},
	}
	for _, tc := range cases {
		if got := compareMacAppReleaseVersions(tc.left, tc.right); got != tc.want {
			t.Fatalf("compareMacAppReleaseVersions(%q, %q) = %d, want %d", tc.left, tc.right, got, tc.want)
		}
	}
}

func TestFirmwareLatestOffersFinalReleaseToPrerelease(t *testing.T) {
	manifest := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"release":"v1.0.36","artifacts":[{"board":"esp8266_smalltv_st7789","firmwareVersion":"1.0.36"},{"board":"esp8266_smalltv_st7789","firmwareVersion":"broken"}]}`))
	}))
	defer manifest.Close()
	t.Setenv(firmwareManifestEnvVar, manifest.URL+"/firmware-manifest.json")
	server := newTestServer(t, runtimeconfig.Config{})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/updates/latest?board=esp8266_smalltv_st7789&firmware=1.0.36-rc.2", nil)
	server.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got firmwareLatestResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !got.UpdateAvailable || got.LatestFirmware != "1.0.36" || got.Status != "update_available" {
		t.Fatalf("expected RC firmware to be offered the final release, got %+v", got)
	}

	current := httptest.NewRecorder()
	currentReq := httptest.NewRequest(http.MethodGet, "/v1/updates/latest?board=esp8266_smalltv_st7789&firmware=1.0.36", nil)
	server.Handler().ServeHTTP(current, currentReq)
	var currentGot firmwareLatestResponse
	if err := json.Unmarshal(current.Body.Bytes(), &currentGot); err != nil {
		t.Fatalf("decode current response: %v", err)
	}
	if currentGot.UpdateAvailable || currentGot.Status != "current" {
		t.Fatalf("expected exact final firmware to stay current, got %+v", currentGot)
	}
}

func TestFirmwareLatestRejectsMalformedInstalledVersion(t *testing.T) {
	manifest := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("manifest must not be fetched for a malformed installed version")
	}))
	defer manifest.Close()
	t.Setenv(firmwareManifestEnvVar, manifest.URL+"/firmware-manifest.json")
	server := newTestServer(t, runtimeconfig.Config{})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/updates/latest?board=esp8266_smalltv_st7789&firmware=banana", nil)
	server.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got firmwareLatestResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.UpdateAvailable || got.Status != "check_failed" {
		t.Fatalf("expected malformed installed version to fail visibly, got %+v", got)
	}
	if !strings.Contains(got.Message, "banana") {
		t.Fatalf("expected message to name the malformed version, got %q", got.Message)
	}
}
