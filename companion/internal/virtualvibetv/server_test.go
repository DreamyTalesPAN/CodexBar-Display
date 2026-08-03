package virtualvibetv

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"testing"
)

func TestStartServesCompanionAndRawOTAOnSeparateListeners(t *testing.T) {
	firmware := []byte("candidate firmware")
	sum := sha256.Sum256(firmware)
	cfg := DefaultConfig()
	cfg.HTTPListenAddr = "127.0.0.1:0"
	cfg.RawOTAListenAddr = "127.0.0.1:0"
	cfg.ExpectedFirmwareSHA256 = hex.EncodeToString(sum[:])
	cfg.RebootUnavailableRequests = 0

	running, err := Start(cfg)
	if err != nil {
		t.Fatalf("start virtual VibeTV: %v", err)
	}
	t.Cleanup(func() { _ = running.Close() })
	if running.HTTPURL == running.RawOTAURL {
		t.Fatalf("HTTP and raw OTA must use separate listeners: %q", running.HTTPURL)
	}

	resp, err := http.Get(running.HTTPURL + "/hello")
	if err != nil {
		t.Fatalf("get hello: %v", err)
	}
	defer resp.Body.Close()
	var hello struct {
		DeviceID string `json:"deviceId"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&hello); err != nil {
		t.Fatalf("decode hello: %v", err)
	}
	if hello.DeviceID != cfg.DeviceID {
		t.Fatalf("deviceId = %q, want %q", hello.DeviceID, cfg.DeviceID)
	}

	req, err := http.NewRequest(http.MethodPost, running.RawOTAURL+"/update/firmware.raw", bytes.NewReader(firmware))
	if err != nil {
		t.Fatalf("create raw OTA request: %v", err)
	}
	req.Header.Set("X-VibeTV-Token", cfg.PairingToken)
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("raw OTA request: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("raw OTA status = %s", resp.Status)
	}
	if got := running.Snapshot(); got.UpdateUploads != 1 || got.Firmware != cfg.CandidateFirmware {
		t.Fatalf("unexpected post-OTA state: %+v", got)
	}
}

func TestScenariosExposeRequiredFailureStates(t *testing.T) {
	tests := []struct {
		name string
		cfg  func(*Config)
		want func(t *testing.T, server *Server, baseURL string)
	}{
		{
			name: "wrong device after update",
			cfg:  func(cfg *Config) { cfg.DeviceIDAfterUpdate = "wrong-device" },
			want: func(t *testing.T, server *Server, _ string) {
				server.mu.Lock()
				server.updateUploads = 1
				server.mu.Unlock()
				if got := server.Snapshot().DeviceID; got != "wrong-device" {
					t.Fatalf("deviceId = %q", got)
				}
			},
		},
		{
			name: "never returns",
			cfg:  func(cfg *Config) { cfg.NeverReturnsAfterUpdate = true },
			want: func(t *testing.T, server *Server, baseURL string) {
				server.mu.Lock()
				server.updateUploads = 1
				server.mu.Unlock()
				resp, err := http.Get(baseURL + "/hello")
				if err != nil {
					t.Fatal(err)
				}
				defer resp.Body.Close()
				if resp.StatusCode != http.StatusServiceUnavailable {
					t.Fatalf("status = %s", resp.Status)
				}
			},
		},
		{
			name: "unhealthy",
			cfg:  func(cfg *Config) { cfg.HealthUnhealthy = true },
			want: func(t *testing.T, _ *Server, baseURL string) { assertHealth(t, baseURL, false, true, true) },
		},
		{
			name: "render failure",
			cfg:  func(cfg *Config) { cfg.RenderVerificationFails = true },
			want: func(t *testing.T, _ *Server, baseURL string) { assertHealth(t, baseURL, true, false, true) },
		},
		{
			name: "stream restart failure",
			cfg:  func(cfg *Config) { cfg.StreamRestartFails = true },
			want: func(t *testing.T, _ *Server, baseURL string) { assertHealth(t, baseURL, true, true, false) },
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg := DefaultConfig()
			cfg.HTTPListenAddr = "127.0.0.1:0"
			cfg.RawOTAListenAddr = "127.0.0.1:0"
			tt.cfg(&cfg)
			running, err := Start(cfg)
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = running.Close() })
			tt.want(t, running.Server, running.HTTPURL)
		})
	}
}

func assertHealth(t *testing.T, baseURL string, wantOK, wantRenderOK, wantStreamHealthy bool) {
	t.Helper()
	resp, err := http.Get(baseURL + "/health")
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
		Stream struct {
			Healthy bool `json:"healthy"`
		} `json:"stream"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&health); err != nil {
		t.Fatal(err)
	}
	if health.OK != wantOK || health.Display.ThemeSpec.RenderOK != wantRenderOK || health.Stream.Healthy != wantStreamHealthy {
		t.Fatalf("unexpected health: %+v", health)
	}
}
