package companionapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimeconfig"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/setup"
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
	if !got.Companion.Features.ThemeInstallEnabled {
		t.Fatalf("expected theme install enabled by default")
	}
	if got.Device.Connected {
		t.Fatalf("expected disconnected device without probing, got %+v", got.Device)
	}
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

func TestCORSAllowedAndForeignOrigins(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})

	allowed := httptest.NewRecorder()
	allowedReq := httptest.NewRequest(http.MethodGet, "/v1/status", nil)
	allowedReq.Header.Set("Origin", "https://app.vibetv.shop")
	server.Handler().ServeHTTP(allowed, allowedReq)
	if got := allowed.Header().Get("Access-Control-Allow-Origin"); got != "https://app.vibetv.shop" {
		t.Fatalf("expected allowed origin header, got %q", got)
	}

	previewOrigin := "https://codex-vibetv-control-center-120qndufj-paul-anduschus-projects.vercel.app"
	preview := httptest.NewRecorder()
	previewReq := httptest.NewRequest(http.MethodGet, "/v1/status", nil)
	previewReq.Header.Set("Origin", previewOrigin)
	server.Handler().ServeHTTP(preview, previewReq)
	if got := preview.Header().Get("Access-Control-Allow-Origin"); got != previewOrigin {
		t.Fatalf("expected preview origin header %q, got %q", previewOrigin, got)
	}

	foreign := httptest.NewRecorder()
	foreignReq := httptest.NewRequest(http.MethodGet, "/v1/status", nil)
	foreignReq.Header.Set("Origin", "https://evil.example")
	server.Handler().ServeHTTP(foreign, foreignReq)
	if got := foreign.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("expected no CORS header for foreign origin, got %q", got)
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
	if got.Device.Connected || got.Device.Target != "" {
		t.Fatalf("expected no connected device target, got %+v", got.Device)
	}
	if !hasDiagnosticCheck(got.Checks, "device_target", "attention") {
		t.Fatalf("expected missing target diagnostic, got %+v", got.Checks)
	}
}

func TestDiagnosticsReportsDeviceWithoutLeakingToken(t *testing.T) {
	device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("X-VibeTV-Token"); got != "pair-token" {
			t.Fatalf("expected pairing token header for device request, got %q", got)
		}
		switch r.URL.Path {
		case "/hello":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"board":"esp8266-smalltv-st7789","firmwareVersion":"1.0.31","capabilities":{"theme":{"supportsThemeSpecV1":true},"transport":{"active":"wifi"}}}`))
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
	detail := sanitizeErrorDetail(errors.New("GET http://user:secret@vibetv.local/setup?token=pair-token&key=api-key failed"))

	for _, sensitive := range []string{"user:secret", "pair-token", "api-key"} {
		if strings.Contains(detail, sensitive) {
			t.Fatalf("sanitized detail leaked %q: %s", sensitive, detail)
		}
	}
	for _, expected := range []string{"http://<redacted>@vibetv.local", "token=<redacted>", "key=<redacted>"} {
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
	stale := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "gone", http.StatusServiceUnavailable)
	}))
	defer stale.Close()

	device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/hello" {
			t.Fatalf("unexpected device path %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"board":"esp8266-smalltv-st7789","firmwareVersion":"1.0.31","capabilities":{"transport":{"active":"wifi"}}}`))
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
	if !got.OK || !got.Device.Connected || !got.Device.Paired || got.Device.Target != device.URL {
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

func TestSetupResetClearsStoredDeviceBinding(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{
		Theme:        "mini",
		DeviceTarget: "http://192.168.178.72",
		DeviceToken:  "pair-token",
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
		"ftp://vibetv.local",
		"http://ftp://vibetv.local",
		"http://vibetv.local:",
		"http://vibetv.local:abc",
		"http://vibetv.local:0",
		"http://vibetv.local:99999",
		"http://vibetv.local/setup",
		"http://vibetv.local?token=pair-token",
		"http://vibetv.local/#setup",
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

func TestDevicePairRejectsInvalidExplicitTarget(t *testing.T) {
	for _, target := range []string{
		"http://user:pass@vibetv.local",
		"http://vibetv.local:abc",
		"http://vibetv.local:0",
		"http://vibetv.local:99999",
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
	var setupCalls []setup.Options
	server.runSetup = func(_ context.Context, opts setup.Options) error {
		setupCalls = append(setupCalls, opts)
		return nil
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/device/pair", strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json")

	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	if len(setupCalls) != 2 {
		t.Fatalf("expected validate and apply setup calls, got %+v", setupCalls)
	}
	for index, call := range setupCalls {
		if call.Transport != "wifi" || call.Target != device.URL || !call.AssumeYes || !call.SkipFlash {
			t.Fatalf("setup call %d must start wifi stream without flashing, got %+v", index, call)
		}
	}
	if !setupCalls[0].ValidateOnly {
		t.Fatalf("first setup call should validate dependencies before applying, got %+v", setupCalls[0])
	}
	if setupCalls[1].ValidateOnly {
		t.Fatalf("second setup call should apply launch agent changes, got %+v", setupCalls[1])
	}
}

func TestDevicePairReturnsErrorWhenDisplayStreamCannotStart(t *testing.T) {
	device := newPairableDeviceServer(t)
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{DeviceTarget: device.URL})
	server.runSetup = func(context.Context, setup.Options) error {
		return errors.New("codexbar missing")
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/device/pair", strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json")

	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusBadGateway {
		t.Fatalf("expected status 502, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got errorResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.OK || got.Error.Code != "display_stream_start_failed" || got.Error.NextAction == "" {
		t.Fatalf("unexpected display stream error: %+v", got)
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
	server.installTheme = func(ctx context.Context, opts themeinstall.Options) (themeinstall.Result, error) {
		gotOpts = opts
		return themeinstall.Result{ThemeID: opts.ThemeID, Target: opts.Target}, nil
	}
	server.runSetup = func(_ context.Context, opts setup.Options) error {
		setupCalls = append(setupCalls, opts)
		return nil
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
	server.runSetup = func(context.Context, setup.Options) error {
		return nil
	}
	return server
}

func newHelloDeviceServer(t *testing.T) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/hello" {
			t.Fatalf("unexpected device path %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"board":"esp8266-smalltv-st7789","firmwareVersion":"1.0.31","capabilities":{"transport":{"active":"wifi"}}}`))
	}))
}

func newPairableDeviceServer(t *testing.T) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hello":
			if got := r.Header.Get("X-VibeTV-Token"); got != "pair-token" {
				t.Fatalf("expected pairing token for hello, got %q", got)
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"board":"esp8266-smalltv-st7789","firmwareVersion":"1.0.31","capabilities":{"transport":{"active":"wifi"}}}`))
		case "/api/pair":
			if r.Method != http.MethodPost {
				t.Fatalf("expected POST pair, got %s", r.Method)
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true,"token":"pair-token"}`))
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
			_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"board":"esp8266-smalltv-st7789","firmwareVersion":"1.0.31","features":["theme","theme-spec-v1"],"capabilities":{"theme":{"supportsThemeSpecV1":true},"transport":{"active":"wifi"}}}`))
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
			_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"board":"esp8266-smalltv-st7789","features":["theme","theme-spec-v1"],"capabilities":{"theme":{"supportsThemeSpecV1":true},"transport":{"active":"wifi"}}}`))
		case "/health":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true,"settings":{"display":{"brightnessPercent":40}}}`))
		default:
			t.Fatalf("unexpected device path %s", r.URL.Path)
		}
	}))
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
