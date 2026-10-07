package virtualvibetv

import (
	"bytes"
	"crypto/md5"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
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
				assertUnavailable(t, baseURL)
			},
		},
		{
			name: "unavailable",
			cfg:  Scenarios["unavailable"],
			want: func(t *testing.T, _ *Server, baseURL string) { assertUnavailable(t, baseURL) },
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

func assertUnavailable(t *testing.T, baseURL string) {
	t.Helper()
	resp, err := http.Get(baseURL + "/hello")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("status = %s", resp.Status)
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

// The virtual device must refuse exactly what the ESP8266 refuses (#354), so
// its advertised limits are read back from the firmware sources.
func TestCapabilitiesMatchFirmware(t *testing.T) {
	firmware := func(path, pattern string) int {
		t.Helper()
		source, err := os.ReadFile(filepath.Join("..", "..", "..", path))
		if err != nil {
			t.Fatalf("read %s: %v", path, err)
		}
		match := regexp.MustCompile(pattern).FindSubmatch(source)
		if match == nil {
			t.Fatalf("%s: no match for %q", path, pattern)
		}
		value := 1
		for _, factor := range match[1:] {
			n, err := strconv.Atoi(string(factor))
			if err != nil {
				t.Fatal(err)
			}
			value *= n
		}
		return value
	}
	const mainCpp = "firmware_esp8266/src/main.cpp"
	const renderer = "firmware_shared/theme_spec_renderer_core.h"

	hello := virtualHello(t)
	theme := hello.Capabilities.Theme
	for _, check := range []struct {
		name string
		got  int
		want int
	}{
		{"maxFrameBytes", hello.MaxFrameBytes, firmware(mainCpp, `constexpr int kMaxFrameBytes = (\d+);`)},
		{"maxThemeSpecBytes", theme.MaxThemeSpecBytes, firmware(mainCpp, `maxThemeSpecBytes\\":(\d+),\\"maxThemePrimitives\\":";`)},
		{"maxStoredThemeSpecBytes", theme.MaxStoredThemeSpecBytes, firmware(mainCpp, `kMaxStoredThemeSpecBytes = (\d+);`)},
		{"maxThemeActivationBodyBytes", maxThemeActivationBodyBytes, firmware(mainCpp, `body\.length\(\) > (\d+)\) \{\s+addCorsHeaders\(\);\s+webServer\.send\(400, "text/plain; charset=utf-8", "invalid theme activation body"\);`)},
		{"maxThemePrimitives", theme.MaxThemePrimitives, firmware(renderer, `kMaxCompiledThemeSpecPrimitives = (\d+);`)},
		{"maxUsageWindows", theme.MaxUsageWindows, firmware("firmware_shared/usage_window_contract.h", `kMaxWindows = (\d+);`)},
		{"maxThemeGifAssets", theme.MaxThemeGifAssets, firmware(renderer, `kMaxThemeSpecGifAssets = (\d+);`)},
		{"maxThemeGifBytes", theme.MaxThemeGifBytes, firmware(renderer, `kMaxThemeSpecGifAssetBytes = (\d+) \* (\d+);`)},
		{"maxThemeGifWidth", theme.MaxThemeGifWidth, firmware(renderer, `kMaxThemeSpecGifWidth = (\d+);`)},
		{"maxThemeGifHeight", theme.MaxThemeGifHeight, firmware(renderer, `kMaxThemeSpecGifHeight = (\d+);`)},
		{"maxThemeGifLzwBits", theme.MaxThemeGifLzwBits, firmware("firmware_esp8266/src/gif_asset_validator.h", `kMaxThemeGifLzwBits = (\d+);`)},
	} {
		if check.got != check.want {
			t.Errorf("%s: virtual=%d firmware=%d", check.name, check.got, check.want)
		}
	}
}

func TestFrameLimitBoundary(t *testing.T) {
	cfg := DefaultConfig()
	cfg.RebootUnavailableRequests = 0
	running, err := Start(cfg)
	if err != nil {
		t.Fatalf("start virtual VibeTV: %v", err)
	}
	t.Cleanup(func() { _ = running.Close() })
	frame := func(size int) int {
		prefix, suffix := `{"v":2,"provider":"`, `"}`
		body := prefix + strings.Repeat("a", size-len(prefix)-len(suffix)) + suffix
		req, err := http.NewRequest(http.MethodPost, running.HTTPURL+"/frame", strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("X-VibeTV-Token", cfg.PairingToken)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		_ = resp.Body.Close()
		return resp.StatusCode
	}
	if got := frame(MaxFrameBytes); got != http.StatusOK {
		t.Fatalf("frame of exactly %d bytes: status %d", MaxFrameBytes, got)
	}
	if got := frame(MaxFrameBytes + 1); got != http.StatusBadRequest {
		t.Fatalf("frame of %d bytes: status %d, want 400", MaxFrameBytes+1, got)
	}
}

// Like the ESP8266, activation refuses a stored spec above 4,096 bytes or 32
// primitives and a request body above 160 bytes (#354).
func TestThemeActivationLimitBoundaries(t *testing.T) {
	cfg := DefaultConfig()
	cfg.RebootUnavailableRequests = 0
	running, err := Start(cfg)
	if err != nil {
		t.Fatalf("start virtual VibeTV: %v", err)
	}
	t.Cleanup(func() { _ = running.Close() })
	const path = "/themes/u/limit.json"
	padded := func(prefix string, size int) string {
		return prefix + strings.Repeat("a", size-len(prefix)-len(`"}`)) + `"}`
	}
	for _, tt := range []struct {
		name                             string
		primitives, specBytes, bodyBytes int
		wantStatus                       int
		wantBody                         string
	}{
		{"largest stored spec", 1, maxStoredThemeSpecBytes, 64, http.StatusOK, ""},
		{"stored spec one byte over", 1, maxStoredThemeSpecBytes + 1, 64, http.StatusBadRequest, "theme file too large"},
		{"most primitives", maxThemePrimitives, 1024, 64, http.StatusOK, ""},
		{"one primitive over", maxThemePrimitives + 1, 1024, 64, http.StatusBadRequest, "theme spec has no renderable content"},
		{"largest activation body", 1, 1024, maxThemeActivationBodyBytes, http.StatusOK, ""},
		{"activation body one byte over", 1, 1024, maxThemeActivationBodyBytes + 1, http.StatusBadRequest, "invalid theme activation body"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			primitives := strings.TrimSuffix(strings.Repeat(`{"t":"r"},`, tt.primitives), ",")
			spec := padded(`{"id":"limit","rev":1,"p":[`+primitives+`],"pad":"`, tt.specBytes)
			running.mu.Lock()
			running.assets[path] = []byte(spec)
			running.mu.Unlock()
			body := padded(`{"path":"`+path+`","pad":"`, tt.bodyBytes)
			req, err := http.NewRequest(http.MethodPost, running.HTTPURL+"/theme/active", strings.NewReader(body))
			if err != nil {
				t.Fatal(err)
			}
			req.Header.Set("X-VibeTV-Token", cfg.PairingToken)
			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			defer resp.Body.Close()
			answer, _ := io.ReadAll(resp.Body)
			if resp.StatusCode != tt.wantStatus || !strings.Contains(string(answer), tt.wantBody) {
				t.Fatalf("spec=%d bytes, %d primitives, body=%d bytes: status %d %q, want %d %q",
					len(spec), tt.primitives, len(body), resp.StatusCode, answer, tt.wantStatus, tt.wantBody)
			}
		})
	}
}

func virtualHello(t *testing.T) protocol.DeviceHello {
	t.Helper()
	cfg := DefaultConfig()
	cfg.RebootUnavailableRequests = 0
	running, err := Start(cfg)
	if err != nil {
		t.Fatalf("start virtual VibeTV: %v", err)
	}
	t.Cleanup(func() { _ = running.Close() })
	resp, err := http.Get(running.HTTPURL + "/hello")
	if err != nil {
		t.Fatalf("get hello: %v", err)
	}
	defer resp.Body.Close()
	var hello protocol.DeviceHello
	if err := json.NewDecoder(resp.Body).Decode(&hello); err != nil {
		t.Fatalf("decode hello: %v", err)
	}
	return hello
}

// Like the firmware, an upload that names an MD5 is stored only when its bytes
// match it (#60); an upload without one is stored as before.
func TestAssetUploadRefusesBytesThatDoNotMatchTheirHash(t *testing.T) {
	cfg := DefaultConfig()
	cfg.RebootUnavailableRequests = 0
	running, err := Start(cfg)
	if err != nil {
		t.Fatalf("start virtual VibeTV: %v", err)
	}
	t.Cleanup(func() { _ = running.Close() })
	data := []byte("CBI1\n")
	digest := md5.Sum(data)
	upload := func(path, hash string) int {
		var body bytes.Buffer
		form := multipart.NewWriter(&body)
		part, _ := form.CreateFormFile("asset", "a.cbi")
		_, _ = part.Write(data)
		_ = form.Close()
		url := running.HTTPURL + "/assets?path=" + path
		if hash != "" {
			url += "&hash=" + hash
		}
		req, _ := http.NewRequest(http.MethodPost, url, &body)
		req.Header.Set("Content-Type", form.FormDataContentType())
		req.Header.Set("X-VibeTV-Token", cfg.PairingToken)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		_ = resp.Body.Close()
		return resp.StatusCode
	}
	wrong := md5.Sum([]byte("CBI2\n"))
	if got := upload("/themes/u/bad.cbi", hex.EncodeToString(wrong[:])); got != http.StatusBadRequest {
		t.Fatalf("same-size upload with a different hash: status %d, want 400", got)
	}
	if got := upload("/themes/u/good.cbi", hex.EncodeToString(digest[:])); got != http.StatusOK {
		t.Fatalf("upload with its own hash: status %d", got)
	}
	if got := upload("/themes/u/old.cbi", ""); got != http.StatusOK {
		t.Fatalf("upload without a hash: status %d", got)
	}
	running.mu.Lock()
	_, bad := running.assets["/themes/u/bad.cbi"]
	_, good := running.assets["/themes/u/good.cbi"]
	_, old := running.assets["/themes/u/old.cbi"]
	running.mu.Unlock()
	if bad || !good || !old {
		t.Fatalf("stored bad=%v good=%v old=%v, want only good and old", bad, good, old)
	}
}
