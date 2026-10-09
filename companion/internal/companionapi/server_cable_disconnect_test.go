package companionapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/errcode"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimeconfig"
)

type cableResolveTestError errcode.Code

func (e cableResolveTestError) Error() string           { return string(e) }
func (e cableResolveTestError) ErrorCode() errcode.Code { return errcode.Code(e) }

func TestDeviceCableReplugOverridesOldAbsenceBeforeNextFrame(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{ConnectionMode: "cable", DeviceID: "cable-a", DeviceToken: "pair-token"})
	server.resolveCablePort = func(string, string) (string, error) { return "/dev/mock", nil }
	server.readCableHello = func(string) (protocol.DeviceHello, error) { return cableHelloForTest("cable-a"), nil }
	server.streamStatus = func(context.Context, string) displayStreamInfo {
		return displayStreamInfo{Running: true, Target: cableDeviceTarget, ErrorCode: "device_not_found"}
	}
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/v1/device", nil))
	var got deviceActionResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if rec.Code != http.StatusOK || !got.OK || !got.Device.Connected || got.Device.Ready || !got.Device.Paired || got.Device.DeviceID != "cable-a" {
		t.Fatalf("a matching live hello must reconnect without claiming a new frame: %d %s", rec.Code, rec.Body.String())
	}
}

func TestCableCurrentResolverErrorOverridesStaleAbsence(t *testing.T) {
	for _, tc := range []struct {
		code   errcode.Code
		absent bool
	}{
		{errcode.TransportNoUSBSerialPorts, true},
		{errcode.TransportSerialPortNotFound, true},
		{errcode.TransportNoSerialPorts, false},
		{errcode.TransportSerialOpen, false},
		{errcode.TransportNoMatchingDevice, false},
		{errcode.Unknown, false},
	} {
		t.Run(string(tc.code), func(t *testing.T) {
			cfg := runtimeconfig.Config{ConnectionMode: "cable", DeviceID: "cable-a", DeviceToken: "pair-token"}
			server := newTestServer(t, cfg)
			clock := time.Now()
			server.now = func() time.Time { return clock }
			server.withConfiguredConnectionState(cfg, deviceInfo{Target: cableDeviceTarget, DeviceID: cfg.DeviceID, Paired: true, Connected: true}, true, false, false)
			hello := cableHelloForTest(cfg.DeviceID)
			hello.Features = []string{protocol.FeatureCableHealthV1}
			helloAvailable := true
			server.currentCableHello = func() (protocol.DeviceHello, bool) { return hello, helloAvailable }
			server.resolveCablePort = func(string, string) (string, error) {
				helloAvailable = false // A failed production probe closes the sender and clears its hello.
				return "", cableResolveTestError(tc.code)
			}
			server.streamStatus = func(context.Context, string) displayStreamInfo {
				return displayStreamInfo{Running: true, Target: cableDeviceTarget, ErrorCode: "device_not_found"}
			}
			read := func() deviceInfo {
				t.Helper()
				rec := httptest.NewRecorder()
				server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/v1/status", nil))
				var got statusResponse
				if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
					t.Fatal(err)
				}
				return got.Device
			}
			clock = clock.Add(15 * time.Second)
			if got := read(); got.Connected == tc.absent || got.Ready || !got.Paired {
				t.Fatalf("current resolver result must own absence certainty: %+v", got)
			}
			clock = clock.Add(time.Second)
			if got := read(); got.Connected == tc.absent || got.Ready || !got.Paired {
				t.Fatalf("the next poll must retain uncertainty after the sender loses its hello: %+v", got)
			}
			clock = clock.Add(deviceConnectedGraceWindow)
			if got := read(); got.Connected {
				t.Fatal("uncertain resolution must not extend the bounded grace")
			}
		})
	}
}

func TestCurrentCableAbsenceOverridesLastAcknowledgedFrame(t *testing.T) {
	for _, code := range []errcode.Code{errcode.TransportNoUSBSerialPorts, errcode.TransportSerialPortNotFound} {
		t.Run(string(code), func(t *testing.T) {
			cfg := runtimeconfig.Config{ConnectionMode: "cable", DeviceID: "cable-a", DeviceToken: "pair-token"}
			server := newTestServer(t, cfg)
			server.resolveCablePort = func(string, string) (string, error) { return "", cableResolveTestError(code) }
			// The sender has already closed; only its last acknowledged frame remains.
			server.streamStatus = func(context.Context, string) displayStreamInfo {
				return displayStreamInfo{DeviceID: cfg.DeviceID, Running: true, Healthy: true, Target: cableDeviceTarget, LastTarget: cableDeviceTarget, LastSentAt: time.Now().Add(-5 * time.Second).UTC().Format(time.RFC3339)}
			}
			rec := httptest.NewRecorder()
			server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/v1/status", nil))
			var got statusResponse
			if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
				t.Fatal(err)
			}
			if got.Device.Connected || got.Device.Ready || !got.Device.Paired || got.Device.DeviceID != cfg.DeviceID || got.Device.Stream == nil || got.Device.Stream.ErrorCode != "device_not_found" {
				t.Fatalf("current missing-port proof must override a recent frame without losing pairing: %+v", got.Device)
			}
		})
	}
}

// Windows physical test: a status probe on the vanished CH340 handle held the
// device lock through its hello window, and every later status call waited.
func TestStatusReportsUnpluggedCableWhileAProbeHoldsTheDeviceLock(t *testing.T) {
	cfg := runtimeconfig.Config{ConnectionMode: "cable", DeviceID: "cable-a", DeviceToken: "pair-token"}
	server := newTestServer(t, cfg)
	server.currentCableHello = func() (protocol.DeviceHello, bool) { return cableHelloForTest(cfg.DeviceID), true }
	server.cablePortVanished = func() error { return cableResolveTestError(errcode.TransportSerialPortNotFound) }
	server.resolveCablePort = func(string, string) (string, error) {
		t.Error("an unplugged port must not be probed")
		return "", errors.New("probed")
	}
	server.streamStatus = func(context.Context, string) displayStreamInfo {
		return displayStreamInfo{DeviceID: cfg.DeviceID, Running: true, Healthy: true, Target: cableDeviceTarget, LastTarget: cableDeviceTarget, LastSentAt: time.Now().Add(-time.Second).UTC().Format(time.RFC3339)}
	}
	server.firmwareUpdateStartMu.Lock() // the probe stuck on the old handle
	defer server.firmwareUpdateStartMu.Unlock()
	done := make(chan deviceInfo, 1)
	go func() {
		rec := httptest.NewRecorder()
		server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/v1/status", nil))
		var got statusResponse
		_ = json.Unmarshal(rec.Body.Bytes(), &got)
		done <- got.Device
	}()
	select {
	case got := <-done:
		if got.Connected || got.Ready || !got.Paired || got.Stream == nil || got.Stream.ErrorCode != "device_not_found" {
			t.Fatalf("unplugged Cable not reported: %+v", got)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("status waited behind the stuck probe")
	}
}

func cableStatusForTest(t *testing.T, server *Server) deviceInfo {
	t.Helper()
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/v1/status", nil))
	var got statusResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("status body: %v", err)
	}
	return got.Device
}

// A probe stuck on the unplugged handle also holds the sender lock that the
// cached hello read needs.
func TestStatusReportsUnpluggedCableWithoutWaitingOnTheSender(t *testing.T) {
	cfg := runtimeconfig.Config{ConnectionMode: "cable", DeviceID: "cable-a", DeviceToken: "pair-token"}
	server := newTestServer(t, cfg)
	stuck := make(chan struct{})
	defer close(stuck)
	server.currentCableHello = func() (protocol.DeviceHello, bool) {
		<-stuck
		return cableHelloForTest(cfg.DeviceID), true
	}
	server.cablePortVanished = func() error { return cableResolveTestError(errcode.TransportSerialPortNotFound) }
	server.streamStatus = func(context.Context, string) displayStreamInfo {
		return displayStreamInfo{DeviceID: cfg.DeviceID, Running: true, Healthy: true, Target: cableDeviceTarget, LastTarget: cableDeviceTarget, LastSentAt: time.Now().UTC().Format(time.RFC3339)}
	}
	done := make(chan deviceInfo, 1)
	go func() { done <- cableStatusForTest(t, server) }()
	select {
	case got := <-done:
		if got.Connected || got.Stream == nil || got.Stream.ErrorCode != "device_not_found" {
			t.Fatalf("unplugged Cable not reported: %+v", got)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("status waited behind the sender lock")
	}
}

// Maintenance skips the probe, but a vanished port still proves the unplug.
func TestStatusReportsUnpluggedCableDuringThemeInstall(t *testing.T) {
	cfg := runtimeconfig.Config{ConnectionMode: "cable", DeviceID: "cable-a", DeviceToken: "pair-token"}
	server := newTestServer(t, cfg)
	server.themeInstallActive = true
	server.cablePortVanished = func() error { return cableResolveTestError(errcode.TransportSerialPortNotFound) }
	server.resolveCablePort = func(string, string) (string, error) {
		t.Error("an unplugged port must not be probed")
		return "", errors.New("probed")
	}
	server.streamStatus = func(context.Context, string) displayStreamInfo {
		return displayStreamInfo{DeviceID: cfg.DeviceID, Running: true, Healthy: true, Target: cableDeviceTarget, LastTarget: cableDeviceTarget, LastSentAt: time.Now().UTC().Format(time.RFC3339)}
	}
	if got := cableStatusForTest(t, server); got.Connected || got.Stream == nil || got.Stream.ErrorCode != "device_not_found" {
		t.Fatalf("unplug during theme install not reported: %+v", got)
	}
}

// The control resolver accepts a WiFi-mode device so it can be switched back.
// That answer must not count as a live Cable connection.
func TestStatusDoesNotCountAWiFiModeHelloAsCableConnected(t *testing.T) {
	cfg := runtimeconfig.Config{ConnectionMode: "cable", DeviceID: "cable-a", DeviceToken: "pair-token"}
	server := newTestServer(t, cfg)
	hello := cableHelloForTest(cfg.DeviceID)
	hello.Capabilities.Transport.Mode = "wifi"
	server.currentCableHello = func() (protocol.DeviceHello, bool) { return hello, true }
	server.resolveCablePort = func(string, string) (string, error) { return "/dev/mock", nil }
	server.streamStatus = func(context.Context, string) displayStreamInfo {
		return displayStreamInfo{DeviceID: cfg.DeviceID, Running: true, Target: cableDeviceTarget, ErrorCode: "device_not_found"}
	}
	if got := cableStatusForTest(t, server); got.Connected || got.LastSeenAt != "" {
		t.Fatalf("WiFi-mode hello counted as Cable connection: %+v", got)
	}
}

// The user's 15-second unplug must override the cached identity and last frame.
func TestStatusDisconnectsCableWhenPortDisappearsAndReconnects(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{
		ConnectionMode: "cable",
		DeviceID:       "cable-a",
		DeviceToken:    "pair-token",
	})
	clock := time.Now()
	lastSent := clock
	available := true
	server.now = func() time.Time { return clock }
	hello := cableHelloForTest("cable-a")
	hello.Features = []string{protocol.FeatureCableHealthV1}
	server.currentCableHello = func() (protocol.DeviceHello, bool) { return hello, true }
	server.resolveCablePort = func(string, string) (string, error) {
		if !available {
			return "", cableResolveTestError(errcode.TransportNoUSBSerialPorts)
		}
		return "/dev/mock", nil
	}
	server.readCableHealth = func(string, string) (deviceHealth, error) {
		renderOK := true
		fullCount := uint64(2)
		partialCount := uint64(0)
		health := deviceHealth{OK: true}
		health.Display.ActiveTheme = "claude-creature"
		health.Display.ThemeSpec.Active = true
		health.Display.ThemeSpec.Path = "/themes/u/claude.json"
		health.Display.ThemeSpec.RenderOK = &renderOK
		health.Render.FullCount = &fullCount
		health.Render.PartialCount = &partialCount
		health.Render.LastKind = "theme_spec_frame"
		return health, nil
	}
	server.streamStatus = func(context.Context, string) displayStreamInfo {
		stream := displayStreamInfo{
			DeviceID:   "cable-a",
			Running:    true,
			Healthy:    available,
			Target:     cableDeviceTarget,
			LastTarget: cableDeviceTarget,
			LastSentAt: lastSent.UTC().Format(time.RFC3339),
		}
		if !available {
			stream.ErrorCode = "device_not_found"
		}
		return stream
	}
	readStatus := func() deviceInfo {
		t.Helper()
		rec := httptest.NewRecorder()
		server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/v1/status", nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
		}
		var response statusResponse
		if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
			t.Fatal(err)
		}
		return response.Device
	}
	if device := readStatus(); !device.Connected || !device.Ready {
		t.Fatalf("live cable must start connected and ready: %+v", device)
	}
	available = false
	clock = clock.Add(15 * time.Second)
	if device := readStatus(); device.Connected || device.Ready {
		t.Fatalf("unplugged cable must not keep the last image connected: %+v", device)
	} else if !device.Active || !device.Paired || device.DeviceID != "cable-a" {
		t.Fatalf("disconnect must preserve the saved pairing: %+v", device)
	}
	available = true
	clock = clock.Add(time.Second)
	lastSent = clock
	if device := readStatus(); !device.Connected || !device.Ready {
		t.Fatalf("replug must reconnect on the next status: %+v", device)
	}
}

func TestCableMatchingResolutionSurvivesFailedHealthRead(t *testing.T) {
	for _, resolved := range []bool{true, false} {
		t.Run(fmt.Sprint(resolved), func(t *testing.T) {
			server := newTestServer(t, runtimeconfig.Config{ConnectionMode: "cable", DeviceID: "cable-a", DeviceToken: "pair-token"})
			hello := cableHelloForTest("cable-a")
			hello.Features = []string{protocol.FeatureCableHealthV1}
			server.currentCableHello = func() (protocol.DeviceHello, bool) { return hello, true }
			server.resolveCablePort = func(string, string) (string, error) {
				if !resolved {
					return "", errors.New("device absent")
				}
				return "/dev/mock", nil
			}
			server.readCableHealth = func(string, string) (deviceHealth, error) {
				return deviceHealth{}, errors.New("temporary health timeout")
			}
			server.streamStatus = func(context.Context, string) displayStreamInfo {
				return displayStreamInfo{Running: true, Target: cableDeviceTarget, ErrorCode: "device_not_found"}
			}
			rec := httptest.NewRecorder()
			server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/v1/status", nil))
			var got statusResponse
			if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
				t.Fatal(err)
			}
			if got.Device.Connected != resolved || got.Device.Ready || !got.Device.Paired {
				t.Fatalf("matching resolution proves connection, health failure cannot prove readiness: %+v", got.Device)
			}
		})
	}
}

func TestCableThemeInstallPreservesFreshConnectionDespiteStaleAbsence(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{ConnectionMode: "cable", DeviceID: "cable-a", DeviceToken: "pair-token"})
	hello := cableHelloForTest("cable-a")
	hello.Features = nil
	server.currentCableHello = func() (protocol.DeviceHello, bool) { return hello, true }
	server.resolveCablePort = func(string, string) (string, error) { return "/dev/mock", nil }
	server.readCableHello = func(string) (protocol.DeviceHello, error) { return hello, nil }
	server.streamStatus = func(context.Context, string) displayStreamInfo {
		return displayStreamInfo{Running: true, Target: cableDeviceTarget, ErrorCode: "device_not_found"}
	}
	read := func() deviceInfo {
		t.Helper()
		rec := httptest.NewRecorder()
		server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/v1/status", nil))
		var got statusResponse
		if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
			t.Fatal(err)
		}
		return got.Device
	}
	if !read().Connected {
		t.Fatal("fresh hello must establish connection")
	}
	server.themeInstallActive = true
	server.resolveCablePort = func(string, string) (string, error) { t.Fatal("theme install must suppress probes"); return "", nil }
	if got := read(); !got.Connected || got.Ready {
		t.Fatalf("suppressed probe cannot invalidate fresh connection or prove readiness: %+v", got)
	}
}

func TestCableResolveErrorsOnlyDisconnectWhenPortIsAbsent(t *testing.T) {
	for _, tc := range []struct {
		cause  string
		absent bool
	}{
		{"transport/no-usb-serial-ports", true},
		{"transport/no-serial-ports", false},
		{"transport/serial-port-not-found", true},
		{"transport/serial-open", false},
		{"transport/no-matching-vibetv", false},
		{"", false},
	} {
		t.Run(tc.cause, func(t *testing.T) {
			clock := time.Now().UTC()
			logPath := filepath.Join(t.TempDir(), "daemon.out.log")
			line := fmt.Sprintf("%s cycle error: code=runtime/serial-resolve op=resolve-target retry=2s cause=%s err=resolver failed\n", clock.Format(time.RFC3339Nano), tc.cause)
			if err := os.WriteFile(logPath, []byte(line), 0o600); err != nil {
				t.Fatal(err)
			}
			_, _, code, ok := lastDisplayStreamErrorRecordAfter(logPath, time.Time{})
			if !ok || (code == "device_not_found") != tc.absent {
				t.Fatalf("cause=%q must distinguish absence from an uncertain probe: code=%q ok=%t", tc.cause, code, ok)
			}
			cfg := runtimeconfig.Config{ConnectionMode: "cable", DeviceID: "cable-a", DeviceToken: "pair-token"}
			server := newTestServer(t, cfg)
			server.now = func() time.Time { return clock }
			device := deviceInfo{Target: cableDeviceTarget, DeviceID: cfg.DeviceID, Connected: true, Paired: true}
			server.withConfiguredConnectionState(cfg, device, true, false, false)
			clock = clock.Add(15 * time.Second)
			device.Connected = false
			device.Stream = &displayStreamInfo{Target: cableDeviceTarget, ErrorCode: code}
			if got := server.withConfiguredConnectionState(cfg, device, false, false, false); got.Connected == tc.absent {
				t.Fatalf("cause=%q returned connected=%t after 15 seconds", tc.cause, got.Connected)
			}
			clock = clock.Add(deviceConnectedGraceWindow)
			if got := server.withConfiguredConnectionState(cfg, device, false, false, false); got.Connected {
				t.Fatalf("cause=%q remained connected past the grace window", tc.cause)
			}
		})
	}
}
