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

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimeconfig"
)

func TestFirmwareUpdateFirstThemeSetup(t *testing.T) {
	const missing = `{"ok":true,"display":{"activeTheme":"theme-missing","themeSpec":{"active":false,"path":"","hash":""}}}`
	const stored = `{"ok":true,"display":{"activeTheme":"clippy","themeSpec":{"active":true,"path":"/themes/u/clippy.json"}}}`
	const standby = `{"ok":true,"standby":{"active":true,"liveThemePath":"/themes/u/clippy.json"},"display":{"activeTheme":"screensaver","themeSpec":{"active":true,"path":"/themes/u/screensaver.json"}}}`
	const preview = `{"ok":true,"standby":{"active":false,"liveThemePath":"/themes/u/clippy.json"},"display":{"activeTheme":"screensaver","themeSpec":{"active":true,"path":"/themes/u/screensaver.json"}}}`
	for _, tc := range []struct {
		name, before, after string
		streamFailure       bool
		skip                string
		providerSetup       bool
		slowProbe           bool
	}{
		{name: "factory device", before: missing, after: missing, skip: "theme_setup_required"},
		{name: "unchanged stored theme without provider", before: stored, after: stored, providerSetup: true, skip: "provider_setup_required"},
		{name: "standby wakes to live theme", before: standby, after: stored, providerSetup: true, skip: "provider_setup_required"},
		{name: "standby stays active", before: standby, after: standby, providerSetup: true, skip: "provider_setup_required"},
		{name: "standby live theme is lost", before: standby, after: missing, providerSetup: true},
		{name: "screensaver preview returns to live", before: preview, after: stored, providerSetup: true, skip: "provider_setup_required"},
		{name: "screensaver preview stays active", before: preview, after: preview, providerSetup: true, skip: "provider_setup_required"},
		{name: "screensaver preview live theme is lost", before: preview, after: missing, providerSetup: true},
		{name: "factory device without provider", before: missing, after: missing, providerSetup: true, skip: "theme_setup_required"},
		{name: "broken stored theme without provider", before: stored, after: `{"ok":true,"display":{"activeTheme":"clippy","themeSpec":{"active":true,"path":"/themes/u/clippy.json","renderOk":false,"renderError":"broken asset"}}}`, providerSetup: true},
		{name: "unknown baseline without provider", before: "", after: missing, providerSetup: true},
		{name: "lost stored theme", before: stored, after: missing},
		{name: "lost stored theme without provider", before: stored, after: missing, providerSetup: true},
		{name: "deactivated stored theme without provider", before: stored, after: `{"ok":true,"display":{"activeTheme":"theme-missing","themeSpec":{"active":false,"path":"/themes/u/clippy.json"}}}`, providerSetup: true},
		{name: "drain in-flight probe before OTA", before: missing, after: missing, slowProbe: true},
		{name: "unknown baseline", before: `{"ok":true}`, after: missing},
		{name: "inactive stored theme", before: `{"ok":true,"display":{"activeTheme":"theme-missing","themeSpec":{"active":false,"path":"/themes/u/clippy.json"}}}`, after: missing},
		{name: "incomplete stored theme metadata", before: `{"ok":true,"display":{"activeTheme":"theme-missing","themeSpec":{"hash":"previous-theme"}}}`, after: missing},
		{name: "render error is not factory setup", before: `{"ok":true,"display":{"activeTheme":"theme-missing","themeSpec":{"renderError":"broken theme"}}}`, after: missing},
		{name: "failed baseline probe", before: "", after: missing},
		{name: "new theme needs verification", before: missing, after: stored},
		{name: "stream error is not setup", before: missing, after: missing, streamFailure: true},
	} {
		for _, mode := range []string{"wifi", "cable"} {
			if mode == "cable" && tc.slowProbe {
				continue
			}
			t.Run(mode+"/"+tc.name, func(t *testing.T) {
				var uploads atomic.Int32
				var server *Server
				slowStarted := make(chan struct{})
				releaseSlow := make(chan struct{})
				device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					if mode == "cable" {
						t.Errorf("Cable update must not use HTTP: %s", r.URL.Path)
					}
					switch r.URL.Path {
					case "/slow":
						close(slowStarted)
						<-releaseSlow
						_, _ = io.WriteString(w, `{}`)
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
				server = newTestServer(t, runtimeconfig.Config{ConnectionMode: mode, DeviceTarget: device.URL, DeviceID: "setup-device", DeviceToken: "pair-token"})
				target := device.URL
				if mode == "cable" {
					target = cableDeviceTarget
					server.resolveCablePort = func(string, string) (string, error) { return "/dev/mock-cable", nil }
					server.readCableHello = func(string) (protocol.DeviceHello, error) {
						return protocol.DeviceHello{DeviceID: "setup-device", Board: "esp8266-smalltv-st7789", Firmware: "1.0.42", Features: []string{protocol.FeatureCableTransferV1, protocol.FeatureCableHealthV1}, Capabilities: protocol.CapabilityBlock{Transport: protocol.TransportCapabilities{Active: "usb", Mode: "cable"}}}, nil
					}
					server.readCableHealth = func(string, string) (deviceHealth, error) {
						body := tc.before
						if uploads.Load() > 0 {
							body = tc.after
						}
						if body == "" {
							return deviceHealth{}, errors.New("unavailable")
						}
						var health deviceHealth
						err := json.Unmarshal([]byte(body), &health)
						return health, err
					}
				}
				server.pauseDisplayStream = func(paused bool) {
					if paused && uploads.Load() == 0 {
						if _, err := server.getHello(context.Background(), device.URL, "pair-token"); err == nil {
							t.Error("ordinary status probes must be excluded before the stream pauses")
						}
						if tc.slowProbe {
							// Model a request that passed doJSON's flag immediately before OTA.
							go func() {
								response, err := server.client.Get(device.URL + "/slow")
								if err == nil {
									_ = response.Body.Close()
								}
							}()
							<-slowStarted
							go func() {
								time.Sleep(3200 * time.Millisecond)
								if uploads.Load() != 0 {
									t.Error("OTA started before an in-flight request drained")
								}
								close(releaseSlow)
							}()
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
					if tc.skip != "" {
						t.Error("factory device must not wait for an unconfigured theme to render")
					}
					return deviceHealth{}, errors.New("no picture")
				}
				server.updateFirmware = func(_ context.Context, _ string, _ runtimeconfig.Config, _ firmwareUpdateRequest, out io.Writer) error {
					uploads.Add(1)
					if tc.slowProbe {
						probeCtx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
						defer cancel()
						request, _ := http.NewRequestWithContext(probeCtx, http.MethodGet, device.URL+"/hello", nil)
						response, err := server.client.Do(request)
						if err == nil {
							_ = response.Body.Close()
							t.Error("queued HTTP traffic must remain excluded throughout the child OTA")
						}
					}
					_, err := io.WriteString(out, `CODEX_FIRMWARE_UPDATE_EVENT {"stage":"verifying_health","phase":"installing","firmware":"1.0.42","target":"`+target+`","deviceId":"setup-device","artifactValidated":true,"uploadAccepted":true}`+"\n")
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
				for attempt := 0; attempt < 600; attempt++ {
					job, _ = server.firmwareUpdateJobSnapshot(started.Job.ID)
					if job.FinishedAt != nil {
						break
					}
					time.Sleep(10 * time.Millisecond)
				}
				if job.FinishedAt == nil || uploads.Load() != 1 {
					t.Fatalf("must finish with exactly one upload: %+v, uploads=%d", job, uploads.Load())
				}
				if tc.skip != "" {
					if job.Phase != "complete" || job.Result == nil || !job.Result.HelloVerified || !job.Result.HealthVerified || !job.Result.StreamVerified || job.Result.RenderVerified || job.Result.RenderSkipped != tc.skip {
						t.Fatalf("expected verified firmware with honest theme setup skip: %+v result=%+v", job, job.Result)
					}
				} else if job.Phase != "attention" || job.Result == nil || job.Result.RenderSkipped != "" {
					t.Fatalf("real failure must remain attention: %+v result=%+v", job, job.Result)
				}
			})
		}
	}
}
