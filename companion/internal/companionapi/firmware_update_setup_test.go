package companionapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimeconfig"
)

func TestFirmwareUpdateFirstThemeSetup(t *testing.T) {
	const missing = `{"ok":true,"display":{"activeTheme":"theme-missing","themeSpec":{"active":false,"path":"","hash":""}}}`
	const stored = `{"ok":true,"display":{"activeTheme":"clippy","themeSpec":{"active":true,"path":"/themes/u/clippy.json"}}}`
	for _, tc := range []struct {
		name, before, after string
		streamFailure, skip bool
		providerSetup       bool
	}{
		{name: "factory device", before: missing, after: missing, skip: true},
		{name: "lost stored theme", before: stored, after: missing},
		{name: "lost stored theme without provider", before: stored, after: missing, providerSetup: true},
		{name: "unknown baseline", before: `{"ok":true}`, after: missing},
		{name: "inactive stored theme", before: `{"ok":true,"display":{"activeTheme":"theme-missing","themeSpec":{"active":false,"path":"/themes/u/clippy.json"}}}`, after: missing},
		{name: "incomplete stored theme metadata", before: `{"ok":true,"display":{"activeTheme":"theme-missing","themeSpec":{"hash":"previous-theme"}}}`, after: missing},
		{name: "render error is not factory setup", before: `{"ok":true,"display":{"activeTheme":"theme-missing","themeSpec":{"renderError":"broken theme"}}}`, after: missing},
		{name: "failed baseline probe", before: "", after: missing},
		{name: "new theme needs verification", before: missing, after: stored},
		{name: "stream error is not setup", before: missing, after: missing, streamFailure: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var uploads atomic.Int32
			var server *Server
			device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch r.URL.Path {
				case "/hello":
					_, _ = io.WriteString(w, `{"kind":"hello","deviceId":"setup-device","protocolVersion":2,"board":"esp8266-smalltv-st7789","firmware":"1.0.42"}`)
				case "/health":
					body := tc.before
					if uploads.Load() > 0 {
						body = tc.after
					} else if !server.firmwareUpdateActive.Load() {
						t.Error("ordinary device traffic must stay blocked during the baseline probe")
					}
					if body == "" {
						http.Error(w, "unavailable", http.StatusServiceUnavailable)
						return
					}
					_, _ = io.WriteString(w, body)
				case "/theme/active":
					http.Error(w, "cannot repair", http.StatusServiceUnavailable)
				default:
					t.Errorf("unexpected device request %s", r.URL.Path)
				}
			}))
			defer device.Close()
			server = newTestServer(t, runtimeconfig.Config{DeviceTarget: device.URL, DeviceID: "setup-device", DeviceToken: "pair-token"})
			server.pauseDisplayStream = func(paused bool) {
				if paused && uploads.Load() == 0 {
					if _, err := server.getHello(context.Background(), device.URL, "pair-token"); err == nil {
						t.Error("ordinary status probes must be excluded before the stream pauses")
					}
				}
			}
			server.refreshStream = func(context.Context, string) error { return nil }
			server.waitStreamAfter = func(_ context.Context, target string, _ time.Time) displayStreamInfo {
				if tc.providerSetup {
					return displayStreamInfo{Running: true, Target: target, ErrorCode: "provider_setup_required"}
				}
				return displayStreamInfo{Healthy: !tc.streamFailure, Running: true, Target: target, LastTarget: target}
			}
			server.waitRender = func(context.Context, string, string, deviceHealth) (deviceHealth, error) {
				if tc.skip {
					t.Error("factory device must not wait for an unconfigured theme to render")
				}
				return deviceHealth{}, errors.New("no picture")
			}
			server.updateFirmware = func(_ context.Context, _ string, _ runtimeconfig.Config, _ firmwareUpdateRequest, out io.Writer) error {
				uploads.Add(1)
				_, err := io.WriteString(out, `CODEX_FIRMWARE_UPDATE_EVENT {"stage":"verifying_health","phase":"installing","firmware":"1.0.42","target":"`+device.URL+`","deviceId":"setup-device","artifactValidated":true,"uploadAccepted":true}`+"\n")
				return err
			}
			rec := httptest.NewRecorder()
			server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/v1/updates/install", strings.NewReader(`{}`)))
			if rec.Code != http.StatusAccepted {
				t.Fatalf("install: %d %s", rec.Code, rec.Body.String())
			}
			var started firmwareUpdateJobResponse
			if err := json.Unmarshal(rec.Body.Bytes(), &started); err != nil {
				t.Fatal(err)
			}
			var job firmwareUpdateJob
			for attempt := 0; attempt < 300; attempt++ {
				job, _ = server.firmwareUpdateJobSnapshot(started.Job.ID)
				if job.FinishedAt != nil {
					break
				}
				time.Sleep(10 * time.Millisecond)
			}
			if job.FinishedAt == nil || uploads.Load() != 1 {
				t.Fatalf("must finish with exactly one upload: %+v, uploads=%d", job, uploads.Load())
			}
			if tc.skip {
				if job.Phase != "complete" || job.Result == nil || !job.Result.HelloVerified || !job.Result.HealthVerified || !job.Result.StreamVerified || job.Result.RenderVerified || job.Result.RenderSkipped != "theme_setup_required" {
					t.Fatalf("expected verified firmware with honest theme setup skip: %+v result=%+v", job, job.Result)
				}
			} else if job.Phase != "attention" || job.Result == nil || job.Result.RenderSkipped != "" {
				t.Fatalf("real failure must remain attention: %+v result=%+v", job, job.Result)
			}
		})
	}
}
