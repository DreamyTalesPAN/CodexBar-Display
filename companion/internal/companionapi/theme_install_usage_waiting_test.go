package companionapi

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimeconfig"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/themeinstall"
)

// 19.10.2026, fresh install: the collector warmed up for ~6 minutes, the stream
// sent no frame meanwhile, and the theme step waited out its five minutes and
// reported a failed install for a theme that was already on the device.
func TestThemeInstallWhileUsageWarmsUpCompletesWithoutRenderProof(t *testing.T) {
	device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true,"render":{"fullCount":7,"partialCount":3,"lastKind":"error"}}`))
	}))
	defer device.Close()

	cfg := runtimeconfig.Config{DeviceTarget: device.URL, DeviceToken: "pair-token"}
	for _, tc := range []struct {
		name    string
		stream  func(target string) displayStreamInfo
		wantErr bool
	}{
		{"warming stream of this device", func(target string) displayStreamInfo {
			return displayStreamInfo{Running: true, Target: target, UsageWaiting: true}
		}, false},
		{"warming stream of another device", func(string) displayStreamInfo {
			return displayStreamInfo{Running: true, Target: "http://192.0.2.99", UsageWaiting: true}
		}, true},
		{"stopped stream", func(target string) displayStreamInfo {
			return displayStreamInfo{Target: target, UsageWaiting: true}
		}, true},
		{"broken stream", func(target string) displayStreamInfo {
			return displayStreamInfo{Running: true, Target: target, ErrorCode: "display_send_failed"}
		}, true},
		{"stream with no usage notice", func(target string) displayStreamInfo {
			return displayStreamInfo{Running: true, Target: target, Detail: "Display stream has not sent usage yet."}
		}, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := newTestServer(t, cfg)
			server.installTheme = func(context.Context, themeinstall.Options) (themeinstall.Result, error) {
				return themeinstall.Result{ThemeID: "mini"}, nil
			}
			server.refreshStream = func(context.Context, string) error { return nil }
			server.waitStreamAfter = func(_ context.Context, target string, _ time.Time) displayStreamInfo {
				return tc.stream(target)
			}
			server.waitRender = func(context.Context, string, string, deviceHealth) (deviceHealth, error) {
				if !tc.wantErr {
					t.Fatal("render proof must not be demanded while usage is warming up")
				}
				return deviceHealth{}, fmt.Errorf("display render not ready")
			}
			var out bytes.Buffer
			_, err := server.runThemeInstall(context.Background(), cfg, themeInstallRequest{ThemeID: "mini"}, &out)
			if tc.wantErr {
				if err == nil {
					t.Fatal("install must still fail")
				}
				return
			}
			if err != nil {
				t.Fatalf("install must succeed while usage warms up: %v", err)
			}
			if !strings.Contains(out.String(), "Display stream: waiting for usage") {
				t.Fatalf("install must say why no picture arrived:\n%s", out.String())
			}
		})
	}
}

// The stream reports the runtime's warm-up notice, and the theme install wait
// settles on it at once instead of running out its window. Other waits do not.
func TestDisplayStreamReportsUsageWarmingAndThemeWaitSettles(t *testing.T) {
	logPath := filepath.Join(t.TempDir(), "daemon.out.log")
	t.Setenv(displayStreamOutLogEnv, logPath)
	t.Setenv(displayStreamLabelEnv, "test.warming")
	server, err := New(Options{Home: t.TempDir(), DisplayStreamRunning: func() bool { return true }})
	if err != nil {
		t.Fatal(err)
	}
	target := "http://192.0.2.10"
	now := time.Now().UTC()
	start := now.Add(-10*time.Second).Format(time.RFC3339Nano) + ` runtime event=stream-start label="test.warming"` + "\n"
	waiting := func(at time.Time) string {
		return at.Format(time.RFC3339) + " runtime event=usage-waiting port=" + target + " reason=collector-warming\n"
	}
	for _, tc := range []struct {
		name string
		log  string
		want bool
	}{
		{"fresh notice", start + waiting(now.Add(-2*time.Second)), true},
		{"notice before this stream start", waiting(now.Add(-time.Minute)) + start, false},
		{"stale notice", start + waiting(now.Add(-displayStreamReadyAge-time.Minute)), false},
		{"no notice", start, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if err := os.WriteFile(logPath, []byte(tc.log), 0o600); err != nil {
				t.Fatal(err)
			}
			if got := server.streamStatus(context.Background(), target); got.UsageWaiting != tc.want || got.Healthy {
				t.Fatalf("stream=%+v want UsageWaiting=%v", got, tc.want)
			}
		})
	}

	if err := os.WriteFile(logPath, []byte(start+waiting(now)), 0o600); err != nil {
		t.Fatal(err)
	}
	startedAt := time.Now()
	stream := server.waitForDisplayStreamMode(context.Background(), target, time.Time{}, false, time.Minute, true)
	if !usageWaitingStreamForTarget(&stream, target) || time.Since(startedAt) > 5*time.Second {
		t.Fatalf("theme wait must settle on warming at once: %+v after %s", stream, time.Since(startedAt))
	}
	ctx, cancel := context.WithTimeout(context.Background(), 1200*time.Millisecond)
	defer cancel()
	startedAt = time.Now()
	server.waitForDisplayStreamMode(ctx, target, time.Time{}, false, time.Minute, false)
	if time.Since(startedAt) < time.Second {
		t.Fatal("other waits must keep waiting for a frame while usage warms up")
	}
}
