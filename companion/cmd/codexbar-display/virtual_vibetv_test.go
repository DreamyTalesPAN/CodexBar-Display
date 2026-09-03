package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	transportlayer "github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/transport"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/virtualvibetv"
)

func TestRunInstallUpdateUsesMultipartOTAAndDoesNotFlashAlreadyCurrentDevice(t *testing.T) {
	pinNoOtherRuntimeWriter(t)
	previousClient, previousPoll := releaseHTTPClient, firmwareHTTPVerifyPollInterval
	t.Cleanup(func() {
		releaseHTTPClient, firmwareHTTPVerifyPollInterval = previousClient, previousPoll
	})
	t.Setenv("HOME", t.TempDir())
	firmwareHTTPVerifyPollInterval = time.Millisecond

	image := []byte("virtual multipart OTA candidate")
	cfg := virtualvibetv.DefaultConfig()
	cfg.HTTPListenAddr, cfg.RawOTAListenAddr = "127.0.0.1:0", "127.0.0.1:0"
	cfg.RebootUnavailableRequests = 0
	sum := sha256.Sum256(image)
	cfg.ExpectedFirmwareSHA256 = hex.EncodeToString(sum[:])
	device, err := virtualvibetv.Start(cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = device.Close() })

	manifestURL := virtualFirmwareManifestServer(t, image)
	releaseHTTPClient = &http.Client{Timeout: time.Second}
	args := []string{"--target", device.HTTPURL, "--manifest-url", manifestURL, "--skip-launchagent-pause"}
	if _, err := captureStdout(t, func() error { return runInstallUpdate(args) }); err != nil {
		t.Fatalf("install through multipart OTA: %v", err)
	}
	output, err := captureStdout(t, func() error { return runInstallUpdate(args) })
	if err != nil {
		t.Fatalf("already-current update: %v", err)
	}
	if !strings.Contains(output, "Firmware: already current (1.0.1)") {
		t.Fatalf("missing already-current output: %s", output)
	}
	state := device.Snapshot()
	if state.UpdateUploads != 1 || len(state.Violations) != 0 {
		t.Fatalf("OTA was repeated: %+v", state)
	}
	if !hasEvent(state.Events, "/update/firmware") {
		t.Fatalf("multipart OTA endpoint was not exercised: %+v", state.Events)
	}
}

func TestRunInstallUpdateAcceptsDroppedMultipartOTAResponseWithoutSecondFlash(t *testing.T) {
	pinNoOtherRuntimeWriter(t)
	previousClient, previousPoll, previousTimeout := releaseHTTPClient, firmwareHTTPVerifyPollInterval, firmwareInterruptedVerifyTimeout
	t.Cleanup(func() {
		releaseHTTPClient, firmwareHTTPVerifyPollInterval, firmwareInterruptedVerifyTimeout = previousClient, previousPoll, previousTimeout
	})
	t.Setenv("HOME", t.TempDir())
	firmwareHTTPVerifyPollInterval, firmwareInterruptedVerifyTimeout = time.Millisecond, 100*time.Millisecond

	image := []byte("accepted multipart OTA then disconnected")
	cfg := virtualvibetv.DefaultConfig()
	cfg.HTTPListenAddr, cfg.RawOTAListenAddr = "127.0.0.1:0", "127.0.0.1:0"
	cfg.DropUpdateResponseAfterAccept, cfg.RebootUnavailableRequests = true, 0
	sum := sha256.Sum256(image)
	cfg.ExpectedFirmwareSHA256 = hex.EncodeToString(sum[:])
	device, err := virtualvibetv.Start(cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = device.Close() })
	releaseHTTPClient = &http.Client{Timeout: time.Second}

	if _, err := captureStdout(t, func() error {
		return runInstallUpdate([]string{"--target", device.HTTPURL, "--manifest-url", virtualFirmwareManifestServer(t, image), "--skip-launchagent-pause"})
	}); err != nil {
		t.Fatalf("accepted OTA response loss: %v", err)
	}
	if state := device.Snapshot(); state.UpdateUploads != 1 || len(state.Violations) != 0 {
		t.Fatalf("ambiguous OTA was flashed twice: %+v", state)
	}
}

func TestFirmwareRediscoveryRejectsDifferentVirtualDevice(t *testing.T) {
	previousClient, previousPoll, previousAfter, previousInterval, previousDiscover := releaseHTTPClient, firmwareHTTPVerifyPollInterval, firmwareUpdateRediscoveryAfter, firmwareUpdateRediscoveryInterval, discoverWiFiDeviceFn
	t.Cleanup(func() {
		releaseHTTPClient, firmwareHTTPVerifyPollInterval, firmwareUpdateRediscoveryAfter, firmwareUpdateRediscoveryInterval, discoverWiFiDeviceFn = previousClient, previousPoll, previousAfter, previousInterval, previousDiscover
	})
	firmwareHTTPVerifyPollInterval, firmwareUpdateRediscoveryAfter, firmwareUpdateRediscoveryInterval = time.Millisecond, time.Millisecond, time.Millisecond
	old := httptest.NewServer(http.NotFoundHandler())
	t.Cleanup(old.Close)
	cfg := virtualvibetv.DefaultConfig()
	cfg.HTTPListenAddr, cfg.RawOTAListenAddr = "127.0.0.1:0", "127.0.0.1:0"
	cfg.DeviceID, cfg.Firmware = "wrong-device", cfg.CandidateFirmware
	wrong, err := virtualvibetv.Start(cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = wrong.Close() })
	releaseHTTPClient = &http.Client{Timeout: time.Second}
	discoverWiFiDeviceFn = func(context.Context, transportlayer.WiFiDiscoveryOptions) (transportlayer.WiFiDiscoveryResult, error) {
		return transportlayer.WiFiDiscoveryResult{Target: wrong.HTTPURL, Hello: protocol.DeviceHello{DeviceID: cfg.DeviceID, Firmware: cfg.Firmware}}, nil
	}
	_, err = waitForHTTPFirmwareVersionWithDiscovery(context.Background(), t.TempDir(), old.URL, cfg.Firmware, "expected-device", 20*time.Millisecond)
	if err == nil || !strings.Contains(err.Error(), "does not match original deviceId") {
		t.Fatalf("wrong device was accepted: %v", err)
	}
}

func virtualFirmwareManifestServer(t *testing.T, image []byte) string {
	t.Helper()
	sum := sha256.Sum256(image)
	serverURL := ""
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/manifest.json":
			_, _ = fmt.Fprintf(w, `{"schemaVersion":1,"release":"v1.0.1","artifacts":[{"firmwareEnv":"esp8266_smalltv_st7789","board":"esp8266-smalltv-st7789","firmwareVersion":"1.0.1","asset":"firmware.bin","firmwareUrl":%q,"sha256":%q}]}`, serverURL+"/firmware.bin", hex.EncodeToString(sum[:]))
		case "/firmware.bin":
			_, _ = w.Write(image)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(server.Close)
	serverURL = server.URL
	return server.URL + "/manifest.json"
}

func hasEvent(events []virtualvibetv.Event, path string) bool {
	for _, event := range events {
		if event.Path == path {
			return true
		}
	}
	return false
}
