package companionapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimeconfig"
)

// Pins the shared behaviour of the hello and health probe caches: a hit inside
// the TTL, a miss for another key, expiry after the TTL, no caching without a
// TTL or timeout, and clearing with the configured device state.
func TestDeviceProbeCachesHitMissExpiryAndBounds(t *testing.T) {
	var helloCalls, healthCalls atomic.Int32
	device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hello":
			helloCalls.Add(1)
			_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"board":"esp8266-smalltv-st7789"}`))
		case "/health":
			healthCalls.Add(1)
			_, _ = w.Write([]byte(`{"ok":true}`))
		}
	}))
	defer device.Close()

	probes := map[string]struct {
		calls *atomic.Int32
		probe func(*Server, string, string, time.Duration) error
	}{
		"hello": {&helloCalls, func(s *Server, target, token string, timeout time.Duration) error {
			_, err := s.getHelloProbe(context.Background(), target, token, timeout)
			return err
		}},
		"health": {&healthCalls, func(s *Server, target, token string, timeout time.Duration) error {
			_, err := s.getHealthProbe(context.Background(), target, token, timeout)
			return err
		}},
	}
	for name, p := range probes {
		t.Run(name, func(t *testing.T) {
			p.calls.Store(0)
			server := newTestServer(t, runtimeconfig.Config{})
			clock := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
			server.now = func() time.Time { return clock }
			server.probeCacheTime = time.Second
			expect := func(step string, want int32) {
				t.Helper()
				if got := p.calls.Load(); got != want {
					t.Fatalf("%s: device calls = %d, want %d", step, got, want)
				}
			}
			probe := func(token string, timeout time.Duration) {
				t.Helper()
				if err := p.probe(server, device.URL, token, timeout); err != nil {
					t.Fatal(err)
				}
			}

			probe("a", time.Second)
			expect("miss", 1)
			clock = clock.Add(999 * time.Millisecond)
			probe("a", time.Second)
			expect("hit", 1)
			probe("b", time.Second)
			expect("other key", 2)
			clock = clock.Add(time.Millisecond)
			probe("a", time.Second)
			expect("expiry", 3)

			probe("a", 0)
			expect("no timeout bypasses the cache", 4)
			server.clearConfiguredDeviceState()
			probe("a", time.Second)
			expect("cleared with the device state", 5)

			server.probeCacheTime = 0
			probe("a", time.Second)
			probe("a", time.Second)
			expect("no TTL bypasses the cache", 7)
		})
	}
}
