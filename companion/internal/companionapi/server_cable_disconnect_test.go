package companionapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimeconfig"
)

// The user's 15-second unplug must override the cached identity and last frame.
func TestStatusDisconnectsCableWhenPortDisappearsAndReconnects(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{
		ConnectionMode: "cable",
		DeviceID:       "cable-a",
		DeviceToken:    "pair-token",
	})
	clock := time.Now()
	lastSent := clock
	available := true
	server.now = func() time.Time { return clock }
	hello := cableHelloForTest("cable-a")
	hello.Features = []string{protocol.FeatureCableHealthV1}
	server.currentCableHello = func() (protocol.DeviceHello, bool) { return hello, true }
	server.resolveCablePort = func(string, string) (string, error) {
		if !available {
			return "", errors.New("no USB serial candidates found")
		}
		return "/dev/mock", nil
	}
	server.readCableHealth = func(string, string) (deviceHealth, error) {
		renderOK := true
		fullCount := uint64(2)
		partialCount := uint64(0)
		health := deviceHealth{OK: true}
		health.Display.ActiveTheme = "claude-creature"
		health.Display.ThemeSpec.Active = true
		health.Display.ThemeSpec.Path = "/themes/u/claude.json"
		health.Display.ThemeSpec.RenderOK = &renderOK
		health.Render.FullCount = &fullCount
		health.Render.PartialCount = &partialCount
		health.Render.LastKind = "theme_spec_frame"
		return health, nil
	}
	server.streamStatus = func(context.Context, string) displayStreamInfo {
		stream := displayStreamInfo{
			DeviceID:   "cable-a",
			Running:    true,
			Healthy:    available,
			Target:     cableDeviceTarget,
			LastTarget: cableDeviceTarget,
			LastSentAt: lastSent.UTC().Format(time.RFC3339),
		}
		if !available {
			stream.ErrorCode = "device_not_found"
		}
		return stream
	}
	readStatus := func() deviceInfo {
		t.Helper()
		rec := httptest.NewRecorder()
		server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/v1/status", nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
		}
		var response statusResponse
		if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
			t.Fatal(err)
		}
		return response.Device
	}
	if device := readStatus(); !device.Connected || !device.Ready {
		t.Fatalf("live cable must start connected and ready: %+v", device)
	}
	available = false
	clock = clock.Add(15 * time.Second)
	if device := readStatus(); device.Connected || device.Ready {
		t.Fatalf("unplugged cable must not keep the last image connected: %+v", device)
	} else if !device.Active || !device.Paired || device.DeviceID != "cable-a" {
		t.Fatalf("disconnect must preserve the saved pairing: %+v", device)
	}
	available = true
	clock = clock.Add(time.Second)
	lastSent = clock
	if device := readStatus(); !device.Connected || !device.Ready {
		t.Fatalf("replug must reconnect on the next status: %+v", device)
	}
}
