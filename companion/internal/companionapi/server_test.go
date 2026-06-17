package companionapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimeconfig"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/themeinstall"
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
	if got.Device.Connected {
		t.Fatalf("expected disconnected device without probing, got %+v", got.Device)
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

	foreign := httptest.NewRecorder()
	foreignReq := httptest.NewRequest(http.MethodGet, "/v1/status", nil)
	foreignReq.Header.Set("Origin", "https://evil.example")
	server.Handler().ServeHTTP(foreign, foreignReq)
	if got := foreign.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("expected no CORS header for foreign origin, got %q", got)
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

func TestThemeInstallDelegatesToThemeInstallLogic(t *testing.T) {
	t.Setenv(themeInstallEnv, "1")

	device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/hello" {
			t.Fatalf("unexpected device path %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"board":"esp8266-smalltv-st7789","features":["theme","theme-spec-v1"],"capabilities":{"theme":{"supportsThemeSpecV1":true},"transport":{"active":"wifi"}}}`))
	}))
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{DeviceTarget: device.URL, DeviceToken: "pair-token"})
	var gotOpts themeinstall.Options
	server.installTheme = func(ctx context.Context, opts themeinstall.Options) (themeinstall.Result, error) {
		gotOpts = opts
		return themeinstall.Result{ThemeID: opts.ThemeID, Target: opts.Target}, nil
	}

	body := strings.NewReader(`{"themeId":"cozy-meadow","packUrl":"https://example.com/cozy.zip"}`)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/themes/install", body)
	req.Header.Set("Content-Type", "application/json")

	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	if gotOpts.ThemeID != "cozy-meadow" || gotOpts.PackURL != "https://example.com/cozy.zip" {
		t.Fatalf("install did not receive theme source: %+v", gotOpts)
	}
	if !strings.Contains(gotOpts.Target, "token=") {
		t.Fatalf("expected target to include pairing token for transport auth, got %q", gotOpts.Target)
	}
	if !gotOpts.SkipFirmwareUpdate {
		t.Fatalf("expected local API theme install to skip firmware update by default")
	}
}

func TestThemeInstallErrorIncludesSanitizedDetail(t *testing.T) {
	t.Setenv(themeInstallEnv, "1")

	device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/hello" {
			t.Fatalf("unexpected device path %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"board":"esp8266-smalltv-st7789","features":["theme","theme-spec-v1"],"capabilities":{"theme":{"supportsThemeSpecV1":true},"transport":{"active":"wifi"}}}`))
	}))
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{DeviceTarget: device.URL, DeviceToken: "pair-token"})
	server.installTheme = func(ctx context.Context, opts themeinstall.Options) (themeinstall.Result, error) {
		return themeinstall.Result{}, errors.New(`theme-pack/upload: post asset /themes/u/cm.cbi: Post "http://vibetv.local/assets?path=%2Fthemes%2Fu%2Fcm.cbi&token=pair-token": connection reset by peer`)
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

func TestThemeInstallDisabledByDefault(t *testing.T) {
	device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/hello" {
			t.Fatalf("unexpected device path %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"board":"esp8266-smalltv-st7789","features":["theme","theme-spec-v1"],"capabilities":{"theme":{"supportsThemeSpecV1":true},"transport":{"active":"wifi"}}}`))
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
	server, err := New(Options{Home: t.TempDir()})
	if err != nil {
		t.Fatalf("new server: %v", err)
	}
	current := cfg
	server.loadConfig = func(string) (runtimeconfig.Config, error) {
		return current, nil
	}
	server.saveConfig = func(_ string, next runtimeconfig.Config) error {
		current = next
		return nil
	}
	return server
}
