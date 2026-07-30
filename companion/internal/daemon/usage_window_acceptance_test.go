package daemon

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
)

type usageWindowAcceptanceFixture struct {
	Version       int                         `json:"version"`
	MaxFrameBytes int                         `json:"maxFrameBytes"`
	Cases         []usageWindowAcceptanceCase `json:"cases"`
	LastGoodCases []lastGoodAcceptanceCase    `json:"lastGoodCases"`
}

type usageWindowAcceptanceCase struct {
	Name                         string                `json:"name"`
	Now                          string                `json:"now"`
	ShowUsed                     bool                  `json:"showUsed"`
	DashboardProvider            json.RawMessage       `json:"dashboardProvider"`
	UsageProvider                json.RawMessage       `json:"usageProvider"`
	ExpectedControlCenterWindows []expectedUsageWindow `json:"expectedControlCenterWindows"`
	ExpectedDeviceFrame          protocol.Frame        `json:"expectedDeviceFrame"`
}

type lastGoodAcceptanceCase struct {
	Name          string         `json:"name"`
	Provider      string         `json:"provider"`
	Now           string         `json:"now"`
	PreviousFrame protocol.Frame `json:"previousFrame"`
	ErrorFrame    protocol.Frame `json:"errorFrame"`
	ExpectedFrame protocol.Frame `json:"expectedFrame"`
}

type expectedUsageWindow struct {
	ID            string `json:"id"`
	Label         string `json:"label"`
	UsedPercent   int    `json:"usedPercent"`
	ResetSec      int64  `json:"resetSecs"`
	WindowMinutes int    `json:"windowMinutes"`
}

func TestUsageWindowAcceptanceMatrixNormalizesToDeviceFrame(t *testing.T) {
	fixture := loadUsageWindowAcceptanceFixture(t)
	if fixture.Version != 1 {
		t.Fatalf("unexpected fixture version %d", fixture.Version)
	}

	for _, tc := range fixture.Cases {
		tc := tc
		t.Run(tc.Name, func(t *testing.T) {
			now := parseAcceptanceTime(t, tc.Now)
			server := newUsageWindowAcceptanceServer(t, tc.DashboardProvider, tc.UsageProvider)
			defer server.Close()

			providers, err := codexbar.FetchDashboardProviders(context.Background(), codexbar.DashboardServeInfo{
				Endpoint: server.URL,
				Token:    "fixture-token",
				Running:  true,
				Healthy:  true,
				PID:      275,
			}, now)
			if err != nil {
				t.Fatalf("fetch dashboard fixture: %v", err)
			}
			if len(providers) != 1 {
				t.Fatalf("expected one provider, got %+v", providers)
			}

			parsed := providers[0]
			assertAcceptanceWindows(t, parsed.Meta.Windows, tc.ExpectedControlCenterWindows)

			frame := applyUsageBarsPreference(parsed.Frame, tc.ShowUsed)
			line, marshaledFrame, err := marshalFrameWithinLimit(frame, fixture.MaxFrameBytes)
			if err != nil {
				t.Fatalf("marshal frame within %d bytes: %v", fixture.MaxFrameBytes, err)
			}
			if len(line) > fixture.MaxFrameBytes {
				t.Fatalf("device frame exceeds budget: bytes=%d max=%d frame=%s", len(line), fixture.MaxFrameBytes, line)
			}
			assertFrameMatch(t, marshaledFrame.Normalize(), expectedDeviceFrameForAcceptance(tc))
			if len(marshaledFrame.UsageSlots) > 0 {
				t.Fatalf("v2 device frame must not duplicate legacy usageSlots: %+v", marshaledFrame.UsageSlots)
			}
			if len(marshaledFrame.UsageWindows) != len(parsed.Meta.Windows) {
				t.Fatalf("device frame must transport ordered usageWindows: got=%d want=%d frame=%+v", len(marshaledFrame.UsageWindows), len(parsed.Meta.Windows), marshaledFrame.UsageWindows)
			}
		})
	}
}

func TestUsageWindowAcceptanceProviderErrorKeepsLastGood(t *testing.T) {
	fixture := loadUsageWindowAcceptanceFixture(t)
	for _, tc := range fixture.LastGoodCases {
		tc := tc
		t.Run(tc.Name, func(t *testing.T) {
			now := parseAcceptanceTime(t, tc.Now)
			collector := &providerCollector{
				now:            func() time.Time { return now },
				logf:           func(string, ...any) {},
				order:          []string{tc.Provider},
				interval:       time.Minute,
				snapshotMaxAge: time.Hour,
				providers: map[string]providerSnapshot{
					tc.Provider: {
						Provider:  tc.Provider,
						Frame:     tc.PreviousFrame,
						Collected: now.Add(-time.Minute),
					},
				},
				fetchProviders: func(context.Context) ([]codexbar.ParsedFrame, error) {
					return []codexbar.ParsedFrame{{
						Provider:    tc.Provider,
						Frame:       tc.ErrorFrame,
						CollectedAt: now,
					}}, nil
				},
			}

			collector.collectOnce(context.Background())
			got := collector.providers[tc.Provider].Frame.Normalize()
			assertFrameMatch(t, got, tc.ExpectedFrame.Normalize())
		})
	}
}

func TestDeviceUsageWindowLimitBoundsOnlySendFrame(t *testing.T) {
	frame := protocol.Frame{
		V:        protocol.ProtocolVersionV2,
		Provider: "generic",
		Label:    "Generic",
		UsageWindows: []protocol.UsageWindow{
			{ID: "a", Label: "A", Percent: 10, ResetSec: 1},
			{ID: "b", Label: "B", Percent: 20, ResetSec: 2},
			{ID: "c", Label: "C", Percent: 30, ResetSec: 3},
			{ID: "d", Label: "D", Percent: 40, ResetSec: 4},
			{ID: "e", Label: "E", Percent: 50, ResetSec: 5},
			{ID: "f", Label: "F", Percent: 60, ResetSec: 6},
			{ID: "g", Label: "G", Percent: 70, ResetSec: 7},
			{ID: "h", Label: "H", Percent: 80, ResetSec: 8},
			{ID: "i", Label: "I", Percent: 90, ResetSec: 9},
			{ID: "j", Label: "J", Percent: 100, ResetSec: 10},
		},
	}

	bounded := applyDeviceUsageWindowLimit(frame, protocol.DeviceCapabilities{
		MaxUsageWindows: 8,
	})
	if len(frame.UsageWindows) != 10 {
		t.Fatalf("source frame must stay complete, got %+v", frame.UsageWindows)
	}
	if len(bounded.UsageWindows) != 8 ||
		bounded.UsageWindows[0].ID != "a" ||
		bounded.UsageWindows[7].ID != "h" {
		t.Fatalf("device frame must keep first N windows in order, got %+v", bounded.UsageWindows)
	}
	if bounded.Session != 10 || bounded.Weekly != 20 || bounded.ResetSec != 1 {
		t.Fatalf("legacy projection must follow bounded windows, got session=%d weekly=%d reset=%d", bounded.Session, bounded.Weekly, bounded.ResetSec)
	}
}

func newUsageWindowAcceptanceServer(t *testing.T, provider json.RawMessage, usage json.RawMessage) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("/dashboard/v1/snapshot", func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer fixture-token" {
			http.Error(w, "missing bearer token", http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"schemaVersion":1,"providers":[`))
		_, _ = w.Write(provider)
		_, _ = w.Write([]byte(`]}`))
	})
	mux.HandleFunc("/usage", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`[ `))
		_, _ = w.Write(usage)
		_, _ = w.Write([]byte(` ]`))
	})
	return httptest.NewServer(mux)
}

func loadUsageWindowAcceptanceFixture(t *testing.T) usageWindowAcceptanceFixture {
	t.Helper()
	path := filepath.Join(repoRoot(t), "protocol", "fixtures", "v1", "usage_window_acceptance.json")
	raw := mustReadFile(t, path)
	var fixture usageWindowAcceptanceFixture
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatalf("parse acceptance fixture: %v", err)
	}
	return fixture
}

func mustReadFile(t *testing.T, path string) []byte {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	return raw
}

func parseAcceptanceTime(t *testing.T, raw string) time.Time {
	t.Helper()
	ts, err := time.Parse(time.RFC3339, raw)
	if err != nil {
		t.Fatalf("parse time %q: %v", raw, err)
	}
	return ts
}

func assertAcceptanceWindows(t *testing.T, got []codexbar.UsageWindow, want []expectedUsageWindow) {
	t.Helper()
	normalized := make([]expectedUsageWindow, 0, len(got))
	for _, window := range got {
		normalized = append(normalized, expectedUsageWindow{
			ID:            window.ID,
			Label:         window.Label,
			UsedPercent:   window.UsedPercent,
			ResetSec:      window.ResetSec,
			WindowMinutes: window.WindowMinutes,
		})
	}
	if !reflect.DeepEqual(normalized, want) {
		t.Fatalf("control center windows mismatch:\ngot:  %+v\nwant: %+v", normalized, want)
	}
}

func expectedDeviceFrameForAcceptance(tc usageWindowAcceptanceCase) protocol.Frame {
	frame := tc.ExpectedDeviceFrame
	frame.V = protocol.ProtocolVersionV2
	frame.UsageSlots = nil
	frame.UsageWindows = make([]protocol.UsageWindow, 0, len(tc.ExpectedControlCenterWindows))
	for _, window := range tc.ExpectedControlCenterWindows {
		percent := window.UsedPercent
		if !tc.ShowUsed {
			percent = 100 - percent
		}
		frame.UsageWindows = append(frame.UsageWindows, protocol.UsageWindow{
			ID:       window.ID,
			Label:    window.Label,
			Percent:  percent,
			ResetSec: window.ResetSec,
		})
	}
	return frame.Normalize()
}
