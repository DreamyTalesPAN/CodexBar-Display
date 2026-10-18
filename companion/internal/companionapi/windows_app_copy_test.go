package companionapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimeconfig"
)

// Issue #558: customer messages name the app "App" (or "app" inside a sentence)
// in the Windows app and keep "Mac App" on a Mac. Each row reaches one message
// through the code that writes it, under both hosts. The Mac texts are the
// approved sentences; the Windows texts follow the same rule.
func TestWindowsCustomerCopyNamesTheAppNotTheMacApp(t *testing.T) {
	cases := []struct {
		name         string
		read         func(t *testing.T) []string
		mac, windows []string
	}{
		{
			name: "setup log restart entry",
			read: func(t *testing.T) []string {
				path := filepath.Join(t.TempDir(), "setup-log.json")
				start := time.Date(2026, 10, 18, 9, 0, 0, 0, time.UTC)
				first := &setupEventLog{path: path}
				first.record(start, setupEvent{Stage: "device_search", Status: "succeeded", Message: "Found 1 VibeTV."})
				second := &setupEventLog{path: path}
				second.record(start.Add(time.Minute), setupEvent{Stage: "provider_check", Status: "succeeded", Message: "Codex is ready."})
				for _, event := range second.snapshot(start.Add(time.Minute)).Events {
					if event.Stage == "service_restart" {
						return []string{event.Message}
					}
				}
				t.Fatal("setup log has no restart entry")
				return nil
			},
			mac:     []string{"The Mac App's background service started again."},
			windows: []string{"The app's background service started again."},
		},
		{
			name: "provider settings need a newer app",
			read: func(t *testing.T) []string {
				rec := httptest.NewRecorder()
				writePreferencesReadError(rec, &codexbar.ProviderSettingsError{Kind: codexbar.ProviderSettingsErrorVersion, Err: errors.New("too old")})
				return apiErrorTexts(t, rec)
			},
			mac:     []string{"Provider settings need a newer Mac App.", "Update the Mac App, then try again."},
			windows: []string{"Provider settings need a newer app.", "Update the app, then try again."},
		},
		{
			name: "settings unavailable",
			read: func(t *testing.T) []string {
				rec := httptest.NewRecorder()
				writePreferencesReadError(rec, errors.New("read failed"))
				return apiErrorTexts(t, rec)
			},
			mac:     []string{"Settings are not available right now.", "Make sure the Mac App is open, then try again."},
			windows: []string{"Settings are not available right now.", "Make sure the app is open, then try again."},
		},
		{
			name: "firmware update during the update hold",
			read: func(t *testing.T) []string {
				server := newTestServer(t, runtimeconfig.Config{DeviceTarget: "http://192.168.178.72", DeviceToken: "pair-token", DeviceID: "device-a"})
				claimUpdateHoldForCopyTest(t, server)
				rec := httptest.NewRecorder()
				server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/v1/updates/install", bytes.NewReader([]byte(`{}`))))
				return apiErrorTexts(t, rec)
			},
			mac:     []string{"Mac App is restarting.", "Wait a moment, then start the update again."},
			windows: []string{"App is restarting.", "Wait a moment, then start the update again."},
		},
		{
			name: "theme install during the update hold",
			read: func(t *testing.T) []string {
				server := newTestServer(t, runtimeconfig.Config{DeviceTarget: "http://192.168.178.72", DeviceToken: "pair-token", DeviceID: "device-a"})
				claimUpdateHoldForCopyTest(t, server)
				rec := httptest.NewRecorder()
				req := httptest.NewRequest(http.MethodPost, "/v1/themes/install?async=true", bytes.NewReader(testThemePackZip(t)))
				req.Header.Set("Content-Type", "application/zip")
				server.Handler().ServeHTTP(rec, req)
				return apiErrorTexts(t, rec)
			},
			mac:     []string{"Mac App is restarting.", "Wait a moment, then try again."},
			windows: []string{"App is restarting.", "Wait a moment, then try again."},
		},
		{
			name: "theme install disabled",
			read: func(t *testing.T) []string {
				t.Setenv(themeInstallDisableEnv, "1")
				server := newTestServer(t, runtimeconfig.Config{})
				rec := httptest.NewRecorder()
				req := httptest.NewRequest(http.MethodPost, "/v1/themes/install?async=true", bytes.NewReader(testThemePackZip(t)))
				req.Header.Set("Content-Type", "application/zip")
				server.Handler().ServeHTTP(rec, req)
				return apiErrorTexts(t, rec)
			},
			mac:     []string{"Theme install is disabled for this Companion build.", "Unset VIBETV_DISABLE_WIFI_THEME_INSTALL, then restart the Mac App."},
			windows: []string{"Theme install is disabled for this Companion build.", "Unset VIBETV_DISABLE_WIFI_THEME_INSTALL, then restart the app."},
		},
		{
			name: "display frame unavailable",
			read: func(t *testing.T) []string {
				t.Setenv(displayStreamOutLogEnv, filepath.Join(t.TempDir(), "missing.log"))
				server := newTestServer(t, runtimeconfig.Config{})
				rec := httptest.NewRecorder()
				server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/v1/display-frame/latest", nil))
				return apiErrorTexts(t, rec)
			},
			mac:     []string{"Display frame is not available.", "Keep the Mac App running until VibeTV receives a usage frame."},
			windows: []string{"Display frame is not available.", "Keep the app running until VibeTV receives a usage frame."},
		},
		{
			name: "reload display without an AI provider",
			read: func(t *testing.T) []string {
				device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					w.Header().Set("Content-Type", "application/json")
					switch r.URL.Path {
					case "/hello":
						_, _ = w.Write([]byte(`{"kind":"hello","deviceId":"device-no-provider","protocolVersion":2,"board":"esp8266-smalltv-st7789","firmware":"1.0.40"}`))
					case "/health":
						_, _ = w.Write([]byte(`{"ok":true,"render":{"fullCount":7,"partialCount":3,"lastKind":"error"}}`))
					default:
						http.NotFound(w, r)
					}
				}))
				defer device.Close()
				server := newTestServer(t, runtimeconfig.Config{DeviceTarget: device.URL, DeviceID: "device-no-provider", DeviceToken: "pair-token"})
				server.refreshStream = func(context.Context, string) error { return nil }
				server.waitStreamAfter = func(_ context.Context, target string, _ time.Time) displayStreamInfo {
					return displayStreamInfo{Running: true, Target: target, ErrorCode: "provider_setup_required", Detail: "VibeTV is connected, but no AI provider is ready yet."}
				}
				server.waitRender = func(context.Context, string, string, deviceHealth) (deviceHealth, error) {
					t.Error("render proof must not be demanded while no provider can produce usage")
					return deviceHealth{}, nil
				}
				rec := httptest.NewRecorder()
				server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/v1/device/reload-display", nil))
				return apiErrorTexts(t, rec)
			},
			mac:     []string{"VibeTV is connected, but AI usage is not ready yet.", "Finish AI setup in the Mac App, then press Reload image again."},
			windows: []string{"VibeTV is connected, but AI usage is not ready yet.", "Finish AI setup in the app, then press Reload image again."},
		},
		{
			name: "diagnostics display stream without an AI provider",
			read: func(t *testing.T) []string {
				checks := appendDisplayStreamDiagnostic(nil, &displayStreamInfo{Running: true, ErrorCode: "provider_setup_required", Detail: "VibeTV is connected, but no AI provider is ready yet."})
				return []string{checks[len(checks)-1].NextAction}
			},
			mac:     []string{"Finish AI setup in the Mac App, then click Check again."},
			windows: []string{"Finish AI setup in the app, then click Check again."},
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

// apiErrorTexts returns the message and next action of a recorded API error.
func apiErrorTexts(t *testing.T, rec *httptest.ResponseRecorder) []string {
	t.Helper()
	var got errorResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode error response: %v body=%s", err, rec.Body.String())
	}
	return []string{got.Error.Message, got.Error.NextAction}
}

// claimUpdateHoldForCopyTest takes the runtime update hold, as the Control Center
// does before a firmware or theme job, so the next install is refused.
func claimUpdateHoldForCopyTest(t *testing.T, server *Server) {
	t.Helper()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/runtime-health/update-hold", http.NoBody)
	req.Header.Set("Content-Type", "application/json")
	server.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("an idle runtime must grant the hold, got %d body=%s", rec.Code, rec.Body.String())
	}
}
