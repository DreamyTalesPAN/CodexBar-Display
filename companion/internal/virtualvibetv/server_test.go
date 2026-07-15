package virtualvibetv

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/transport"
)

func TestVirtualVibeTVImplementsCompanionFrameAndThemeContract(t *testing.T) {
	device := New(DefaultConfig())
	server := httptest.NewServer(device)
	defer server.Close()

	wifi := transport.NewWiFiTransportWithClient(server.Client())
	target := server.URL + "?token=virtual-pair-token"
	caps, err := wifi.DeviceCapabilities(target)
	if err != nil {
		t.Fatalf("device capabilities: %v", err)
	}
	if !caps.Known || caps.Board != "esp8266-smalltv-st7789" || caps.Firmware != "1.0.0" {
		t.Fatalf("unexpected capabilities: %+v", caps)
	}
	if err := wifi.SendLine(target, []byte(`{"v":1,"theme":"mini-classic","label":"virtual"}`)); err != nil {
		t.Fatalf("send frame: %v", err)
	}
	theme := []byte(`{"v":1,"id":"test-theme","rev":1,"fb":"mini"}`)
	if err := wifi.UploadAsset(target, "/themes/u/test-theme.json", "test-theme.json", theme); err != nil {
		t.Fatalf("upload theme: %v", err)
	}
	if err := wifi.ActivateStoredTheme(target, "/themes/u/test-theme.json"); err != nil {
		t.Fatalf("activate theme: %v", err)
	}
	health, err := wifi.DeviceHealthSnapshot(target)
	if err != nil {
		t.Fatalf("device health: %v", err)
	}
	if !health.OK || health.Display.ThemeSpec.Path != "/themes/u/test-theme.json" || !health.Display.ThemeSpec.RenderOk {
		t.Fatalf("unexpected health: %+v", health)
	}

	snapshot := device.Snapshot()
	if snapshot.FramesAccepted != 1 || snapshot.ActiveTheme != "test-theme" || len(snapshot.Assets) != 1 {
		t.Fatalf("unexpected simulator snapshot: %+v", snapshot)
	}
}

func TestVirtualVibeTVValidatesFirmwareAndRejectsSecondFlash(t *testing.T) {
	firmware := []byte("candidate firmware")
	sum := sha256.Sum256(firmware)
	cfg := DefaultConfig()
	cfg.ExpectedFirmwareSHA256 = hex.EncodeToString(sum[:])
	cfg.RebootUnavailableRequests = 0
	device := New(cfg)
	server := httptest.NewServer(device)
	defer server.Close()

	upload := func(body []byte) *http.Response {
		req, err := http.NewRequest(http.MethodPost, server.URL+"/update/firmware", bytes.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("X-VibeTV-Token", cfg.PairingToken)
		resp, err := server.Client().Do(req)
		if err != nil {
			t.Fatalf("firmware upload: %v", err)
		}
		return resp
	}

	bad := upload([]byte("wrong firmware"))
	_ = bad.Body.Close()
	if bad.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("bad firmware status=%d", bad.StatusCode)
	}
	good := upload(firmware)
	_ = good.Body.Close()
	if good.StatusCode != http.StatusOK {
		t.Fatalf("good firmware status=%d", good.StatusCode)
	}
	second := upload(firmware)
	_ = second.Body.Close()
	if second.StatusCode != http.StatusConflict {
		t.Fatalf("second firmware status=%d", second.StatusCode)
	}

	snapshot := device.Snapshot()
	if snapshot.Firmware != cfg.CandidateFirmware || snapshot.UpdateUploads != 1 || len(snapshot.Violations) != 1 {
		t.Fatalf("unexpected update snapshot: %+v", snapshot)
	}
}

func TestVirtualVibeTVScenarioReportsUnhealthyRenderAndFramebuffer(t *testing.T) {
	cfg := DefaultConfig()
	cfg.HealthUnhealthy = true
	cfg.RenderVerificationFails = true
	device := New(cfg)
	server := httptest.NewServer(device)
	defer server.Close()

	resp, err := server.Client().Get(server.URL + "/health")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var health struct {
		OK      bool `json:"ok"`
		Display struct {
			ThemeSpec struct {
				RenderOK bool `json:"renderOk"`
			} `json:"themeSpec"`
		} `json:"display"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&health); err != nil {
		t.Fatal(err)
	}
	if health.OK || health.Display.ThemeSpec.RenderOK {
		t.Fatalf("scenario unexpectedly healthy: %+v", health)
	}
}

func TestVirtualVibeTVDifferentDeviceScenarioRequiresAuthentication(t *testing.T) {
	cfg := DefaultConfig()
	cfg.DeviceID = "expected-device"
	cfg.DeviceIDAfterUpdate = "different-device"
	cfg.RebootUnavailableRequests = 0
	device := New(cfg)
	server := httptest.NewServer(device)
	defer server.Close()

	unauthorized, err := http.Post(server.URL+"/update/firmware", "application/octet-stream", bytes.NewReader([]byte("firmware")))
	if err != nil {
		t.Fatal(err)
	}
	_ = unauthorized.Body.Close()
	if unauthorized.StatusCode != http.StatusUnauthorized || device.Snapshot().UpdateUploads != 0 {
		t.Fatalf("unauthorized update was not rejected: status=%d snapshot=%+v", unauthorized.StatusCode, device.Snapshot())
	}

	req, err := http.NewRequest(http.MethodPost, server.URL+"/update/firmware", bytes.NewReader([]byte("firmware")))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("X-VibeTV-Token", cfg.PairingToken)
	updated, err := server.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = updated.Body.Close()
	if updated.StatusCode != http.StatusOK {
		t.Fatalf("authenticated update status=%d", updated.StatusCode)
	}

	helloResponse, err := server.Client().Get(server.URL + "/hello")
	if err != nil {
		t.Fatal(err)
	}
	defer helloResponse.Body.Close()
	var hello struct {
		DeviceID string `json:"deviceId"`
		Firmware string `json:"firmware"`
	}
	if err := json.NewDecoder(helloResponse.Body).Decode(&hello); err != nil {
		t.Fatal(err)
	}
	if hello.DeviceID != cfg.DeviceIDAfterUpdate || hello.Firmware != cfg.CandidateFirmware {
		t.Fatalf("unexpected post-update identity: %+v", hello)
	}
}

func TestVirtualVibeTVNeverReturnsAndStreamFailureScenarios(t *testing.T) {
	cfg := DefaultConfig()
	cfg.NeverReturnsAfterUpdate = true
	cfg.StreamRestartFails = true
	cfg.RebootUnavailableRequests = 0
	device := New(cfg)
	server := httptest.NewServer(device)
	defer server.Close()

	healthResponse, err := server.Client().Get(server.URL + "/health")
	if err != nil {
		t.Fatal(err)
	}
	var health struct {
		Stream struct {
			Healthy bool `json:"healthy"`
		} `json:"stream"`
	}
	if err := json.NewDecoder(healthResponse.Body).Decode(&health); err != nil {
		_ = healthResponse.Body.Close()
		t.Fatal(err)
	}
	_ = healthResponse.Body.Close()
	if health.Stream.Healthy {
		t.Fatal("stream-restart-fails scenario reported a healthy stream")
	}

	req, err := http.NewRequest(http.MethodPost, server.URL+"/update/firmware", bytes.NewReader([]byte("firmware")))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("X-VibeTV-Token", cfg.PairingToken)
	updated, err := server.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = updated.Body.Close()
	if updated.StatusCode != http.StatusOK {
		t.Fatalf("update status=%d", updated.StatusCode)
	}
	for attempt := 0; attempt < 2; attempt++ {
		response, err := server.Client().Get(server.URL + "/hello")
		if err != nil {
			t.Fatal(err)
		}
		_ = response.Body.Close()
		if response.StatusCode != http.StatusServiceUnavailable {
			t.Fatalf("never-returns attempt %d status=%d", attempt+1, response.StatusCode)
		}
	}
}
