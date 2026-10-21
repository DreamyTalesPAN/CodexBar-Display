package companionapi

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimeconfig"
)

// fanOutProbe records every probed host, the token it carried, and the
// highest number of probes in flight at once.
type fanOutProbe struct {
	mu       sync.Mutex
	hosts    map[string]string
	inFlight atomic.Int32
	peak     atomic.Int32
}

func (p *fanOutProbe) record(req *http.Request) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.hosts == nil {
		p.hosts = map[string]string{}
	}
	p.hosts[req.URL.Host] = req.Header.Get("X-VibeTV-Token")
	n := p.inFlight.Add(1)
	for {
		peak := p.peak.Load()
		if n <= peak || p.peak.CompareAndSwap(peak, n) {
			return
		}
	}
}

func fanOutHello(host string) *http.Response {
	return &http.Response{StatusCode: http.StatusOK, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(
		fmt.Sprintf(`{"kind":"hello","protocolVersion":2,"deviceId":%q,"networkMode":"station"}`, host)))}
}

func fanOutTargets(n int) []string {
	targets := make([]string, 0, n)
	for i := 1; i <= n; i++ {
		targets = append(targets, fmt.Sprintf("http://h%d.test", i))
	}
	return targets
}

func newFanOutServer(t *testing.T, cfg runtimeconfig.Config, targets []string, answer func(host string) bool) (*Server, *fanOutProbe) {
	t.Helper()
	server := newTestServer(t, cfg)
	server.probeCacheTime = 0
	server.defaultWiFiTarget = func() string { return "" }
	server.subnetTargets = func() []string { return targets }
	probe := &fanOutProbe{}
	server.client.Transport = roundTripFunc(func(req *http.Request) (*http.Response, error) {
		probe.record(req)
		defer probe.inFlight.Add(-1)
		time.Sleep(5 * time.Millisecond)
		if answer(req.URL.Host) {
			return fanOutHello(req.URL.Host), nil
		}
		return nil, fmt.Errorf("no route to %s", req.URL.Host)
	})
	return server, probe
}

func TestSubnetFanOutCallersProbeEveryAddressWithinLimit(t *testing.T) {
	targets := fanOutTargets(subnetProbeLimit * 3)
	cfg := runtimeconfig.Config{DeviceID: "h7.test", DeviceToken: "tok", ConnectionMode: "wifi", CableAutoBindDisabled: true}
	answer := func(host string) bool { return host == "h7.test" }
	for name, run := range map[string]func(*Server) error{
		"discovery": func(s *Server) error {
			target, _, err := s.discoverSubnet(context.Background(), cfg)
			if err != nil || target != "http://h7.test" {
				return fmt.Errorf("target=%q err=%v", target, err)
			}
			return nil
		},
		"search": func(s *Server) error {
			devices, err := s.searchDevicesOnce(context.Background(), cfg, "")
			if err != nil || len(devices) != 1 || devices[0].DeviceID != "h7.test" {
				return fmt.Errorf("devices=%+v err=%v", devices, err)
			}
			return nil
		},
	} {
		t.Run(name, func(t *testing.T) {
			server, probe := newFanOutServer(t, cfg, targets, answer)
			if err := run(server); err != nil {
				t.Fatal(err)
			}
			if len(probe.hosts) != len(targets) {
				t.Fatalf("probed %d of %d addresses", len(probe.hosts), len(targets))
			}
			if peak := probe.peak.Load(); peak < 2 || peak > int32(subnetProbeLimit) {
				t.Fatalf("peak concurrency %d, want 2..%d", peak, subnetProbeLimit)
			}
			wantToken := map[string]string{"discovery": "tok", "search": ""}[name]
			for host, token := range probe.hosts {
				if token != wantToken {
					t.Fatalf("%s probed with token %q, want %q", host, token, wantToken)
				}
			}
		})
	}
}

func TestSubnetFanOutDiscoveryStopsOnSecondMatch(t *testing.T) {
	targets := fanOutTargets(subnetProbeLimit * 20)
	// Both answer with the expected id only when the id is empty, so any two
	// answering hosts are two matches.
	server, probe := newFanOutServer(t, runtimeconfig.Config{CableAutoBindDisabled: true}, targets,
		func(host string) bool { return host == "h1.test" || host == "h2.test" })
	_, _, err := server.discoverSubnet(context.Background(), runtimeconfig.Config{CableAutoBindDisabled: true})
	var multiple *multipleDevicesError
	if !errors.As(err, &multiple) || len(multiple.targets) != 2 || multiple.targets[0] != "http://h1.test" {
		t.Fatalf("want multipleDevicesError h1+h2, got %v", err)
	}
	probe.mu.Lock()
	probed := len(probe.hosts)
	probe.mu.Unlock()
	if probed >= len(targets) {
		t.Fatalf("second match did not stop the fan-out: probed %d of %d", probed, len(targets))
	}
}

func TestSubnetFanOutProbesTimeOutAfterSubnetProbeTime(t *testing.T) {
	old := subnetProbeTime
	subnetProbeTime = 50 * time.Millisecond
	t.Cleanup(func() { subnetProbeTime = old })
	cfg := runtimeconfig.Config{DeviceID: "x", CableAutoBindDisabled: true}
	for name, run := range map[string]func(*Server){
		"discovery": func(s *Server) { _, _, _ = s.discoverSubnet(context.Background(), cfg) },
		"search":    func(s *Server) { _, _ = s.searchDevicesOnce(context.Background(), cfg, "") },
	} {
		t.Run(name, func(t *testing.T) {
			server := newTestServer(t, cfg)
			server.probeCacheTime = 0
			server.defaultWiFiTarget = func() string { return "" }
			server.subnetTargets = func() []string { return []string{"http://hang.test"} }
			server.client.Transport = roundTripFunc(func(req *http.Request) (*http.Response, error) {
				<-req.Context().Done()
				return nil, req.Context().Err()
			})
			started := time.Now()
			run(server)
			if elapsed := time.Since(started); elapsed < 40*time.Millisecond || elapsed > 2*time.Second {
				t.Fatalf("hanging probe returned after %s, want about %s", elapsed, subnetProbeTime)
			}
		})
	}
}

func TestSubnetFanOutSearchStopsOnceTransitionDeviceAnswers(t *testing.T) {
	targets := fanOutTargets(subnetProbeLimit * 20)
	cfg := runtimeconfig.Config{DeviceID: "h1.test", CableAutoBindDisabled: true}
	server, probe := newFanOutServer(t, cfg, targets, func(host string) bool { return host == "h1.test" })
	devices, err := server.searchDevicesOnce(context.Background(), cfg, "")
	if err != nil || len(devices) != 1 || devices[0].DeviceID != "h1.test" {
		t.Fatalf("devices=%+v err=%v", devices, err)
	}
	probe.mu.Lock()
	probed := len(probe.hosts)
	probe.mu.Unlock()
	if probed >= len(targets) {
		t.Fatalf("first hit did not stop the fan-out: probed %d of %d", probed, len(targets))
	}
}
