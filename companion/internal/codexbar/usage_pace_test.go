package codexbar

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
)

func pace(delta int, state string, lasts ...bool) protocol.UsagePace {
	out := protocol.UsagePace{Delta: delta, State: state}
	if len(lasts) == 1 {
		out.Lasts = &lasts[0]
	}
	return out
}

func samePace(a, b protocol.UsagePace) bool {
	return a.Delta == b.Delta && a.State == b.State &&
		(a.Lasts == nil) == (b.Lasts == nil) && (a.Lasts == nil || *a.Lasts == *b.Lasts)
}

// The production path: CodexBar 0.75.0's serve recordings, keyed by its
// structural lanes, land on the dashboard windows they describe, in the device
// frame and in the usage meta the API reads.
func TestDashboardUsageCarriesCodexBarPace(t *testing.T) {
	dir := filepath.Join("testdata", "cli", "codexbar-macos-0.75.0")
	serve := func(name string) http.HandlerFunc {
		raw, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			t.Fatal(err)
		}
		return func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write(raw) }
	}
	mux := http.NewServeMux()
	mux.HandleFunc(dashboardSnapshotPath, serve("serve-snapshot.json"))
	mux.HandleFunc(dashboardUsagePath, serve("serve-usage.json"))
	server := httptest.NewServer(mux)
	defer server.Close()

	collectedAt := time.Date(2026, 10, 14, 7, 42, 20, 0, time.UTC)
	providers, err := FetchDashboardProviders(context.Background(), dashboardFetchTestInfo(server), collectedAt)
	if err != nil || len(providers) != 2 {
		t.Fatalf("providers=%d err=%v", len(providers), err)
	}
	want := map[string][]protocol.UsagePace{
		// "54% in deficit | Expected 16% used | Runs out in 11h 14m"
		"codex": {pace(54, protocol.PaceDeficit, false)},
		// Claude's recorded resets differ by one second between endpoints;
		// those paces cannot describe the dashboard windows. Fable has none.
		"claude": {{}, {}, {}},
	}
	for _, provider := range providers {
		windows := provider.Frame.UsageWindows
		if len(windows) != len(want[provider.Provider]) {
			t.Fatalf("%s windows: %+v", provider.Provider, windows)
		}
		for i, window := range windows {
			if !samePace(window.Pace, want[provider.Provider][i]) {
				t.Fatalf("%s window %s pace=%+v want %+v", provider.Provider, window.ID, window.Pace, want[provider.Provider][i])
			}
		}
		if (len(provider.Meta.Pace) > 0) != (provider.Provider == "codex") {
			t.Fatalf("%s: API pace must match the device's measurement: %+v", provider.Provider, provider.Meta.Pace)
		}
	}
}

func TestUsagePaceMirrorsEveryCodexBarStage(t *testing.T) {
	raw := []byte(`[{"provider":"cursor","usage":{
		"primary":{"usedPercent":1,"windowMinutes":43200,"resetsAt":"2099-01-01T00:00:00Z"},
		"secondary":{"usedPercent":2,"windowMinutes":43200,"resetsAt":"2099-01-01T00:00:00Z"},
		"tertiary":{"usedPercent":3,"windowMinutes":43200,"resetsAt":"2099-01-01T00:00:00Z"},
		"extra":[{"id":"daily","label":"Daily","usedPercent":4,"windowMinutes":1440,"resetsAt":"2099-01-01T00:00:00Z"}]
	},"pace":{
		"primary":{"stage":"onTrack","deltaPercent":-1,"expectedUsedPercent":2,"willLastToReset":false,"summary":"On pace"},
		"secondary":{"stage":"slightlyAhead","deltaPercent":5,"expectedUsedPercent":0,"willLastToReset":false,"etaSeconds":0,"summary":"5% in deficit | Runs out now"},
		"tertiary":{"stage":"sideways","deltaPercent":3,"willLastToReset":true,"summary":"?"}
	}}]`)
	parsed, err := parseAllProviders(raw)
	if err != nil {
		t.Fatal(err)
	}
	windows := parsed[0].Frame.UsageWindows
	for i, want := range []protocol.UsagePace{
		pace(-1, protocol.PaceOnPace), // no ETA and not lasting: no projection
		pace(5, protocol.PaceDeficit, false),
		{}, // a stage CodexBar does not define stays unknown
		{}, // CodexBar sent no pace for this window
	} {
		if !samePace(windows[i].Pace, want) {
			t.Fatalf("window %s pace=%+v want %+v", windows[i].ID, windows[i].Pace, want)
		}
	}
	for stage, state := range map[string]string{
		"farAhead": protocol.PaceDeficit, "ahead": protocol.PaceDeficit,
		"slightlyBehind": protocol.PaceReserve, "behind": protocol.PaceReserve, "farBehind": protocol.PaceReserve,
	} {
		got := ProviderPace{Window: "secondary", Stage: stage, HasDeltaPercent: true, WillLastToReset: true}.Device()
		if !samePace(got, pace(0, state, true)) {
			t.Fatalf("stage %s: %+v", stage, got)
		}
	}
}

// A stage without a delta is not a 0: the device never shows a number
// CodexBar did not send.
func TestUsagePaceWithoutDeltaStaysUnknown(t *testing.T) {
	if got := (ProviderPace{Window: "primary", Stage: "ahead"}).Device(); got != (protocol.UsagePace{}) {
		t.Fatalf("a stage without deltaPercent must stay unknown, got %+v", got)
	}
}

// Serve caches these endpoints independently: pace must describe the exact
// measurement retained from the dashboard, including its reset when present.
func TestDashboardPaceRequiresMatchingMeasurement(t *testing.T) {
	for _, tc := range []struct {
		name, used, dashboardReset, usageReset string
		wantPace                               bool
	}{
		{"different usage", "70", "2099-01-01T00:00:00Z", "2099-01-01T00:00:00Z", false},
		{"same measurement", "20", "2099-01-01T00:00:00Z", "2099-01-01T00:00:00Z", true},
		{"different reset", "20", "2099-01-01T00:00:00Z", "2099-01-02T00:00:00Z", false},
		{"fractional mismatch", "20.1", "2099-01-01T00:00:00Z", "2099-01-01T00:00:00Z", false},
		{"missing usage", "null", "2099-01-01T00:00:00Z", "2099-01-01T00:00:00Z", false},
		{"missing usage reset", "20", "2099-01-01T00:00:00Z", "", true},
		{"missing dashboard reset", "20", "", "2099-01-01T00:00:00Z", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			reset := func(key, value string) string {
				if value == "" {
					return ""
				}
				return fmt.Sprintf(",%q:%q", key, value)
			}
			mux := http.NewServeMux()
			mux.HandleFunc(dashboardSnapshotPath, func(w http.ResponseWriter, _ *http.Request) {
				fmt.Fprintf(w, `{"schemaVersion":1,"providers":[{"id":"claude","windows":[{"kind":"session","label":"Session","usedPercent":20%s}]}]}`, reset("resetAt", tc.dashboardReset))
			})
			mux.HandleFunc(dashboardUsagePath, func(w http.ResponseWriter, _ *http.Request) {
				fmt.Fprintf(w, `[{"provider":"claude","usage":{"primary":{"usedPercent":%s%s}},"pace":{"primary":{"stage":"ahead","deltaPercent":20,"expectedUsedPercent":50}}}]`, tc.used, reset("resetsAt", tc.usageReset))
			})
			server := httptest.NewServer(mux)
			defer server.Close()
			providers, err := FetchDashboardProviders(context.Background(), dashboardFetchTestInfo(server), time.Now())
			if err != nil || len(providers) != 1 {
				t.Fatalf("providers=%+v err=%v", providers, err)
			}
			got := providers[0]
			if len(got.Frame.UsageWindows) != 1 || got.Frame.UsageWindows[0].Percent != 20 {
				t.Fatalf("dashboard must remain the usage source: %+v", got.Frame)
			}
			if hasPace := got.Frame.UsageWindows[0].Pace.State != ""; hasPace != tc.wantPace {
				t.Errorf("device pace=%+v, want present=%v", got.Frame.UsageWindows[0].Pace, tc.wantPace)
			}
			if (len(got.Meta.Pace) != 0) != tc.wantPace {
				t.Errorf("API pace=%+v, want present=%v", got.Meta.Pace, tc.wantPace)
			}
		})
	}
}

// CodexBar 0.75.0 CLIRenderer.pacePayload rounds both percentages before
// encoding them; integral JSON numbers are valid regardless of decimal syntax.
func TestParsePacePercentagesStrictNumbers(t *testing.T) {
	for _, field := range []string{"deltaPercent", "expectedUsedPercent"} {
		for _, tc := range []struct {
			raw     string
			want    int
			present bool
		}{
			{"100.1", 0, false}, {"40.5", 0, false}, {`"0oops"`, 0, false},
			{`"40"`, 0, false}, {"40", 40, true}, {"40.0", 40, true},
			{"", 0, false}, {"null", 0, false}, {"true", 0, false},
			{"0", 0, true}, {"100", 100, true}, {"101", 0, false},
			{"-101", 0, false}, {"1e100", 0, false},
		} {
			t.Run(field+"/"+tc.raw, func(t *testing.T) {
				raw := `{"pace":{"primary":{"stage":"ahead"`
				if tc.raw != "" {
					raw += fmt.Sprintf(",%q:%s", field, tc.raw)
				}
				raw += `}}}`
				var payload map[string]any
				if err := json.Unmarshal([]byte(raw), &payload); err != nil {
					t.Fatal(err)
				}
				got := parseProviderPace(payload)[0]
				value, present := got.DeltaPercent, got.HasDeltaPercent
				if field == "expectedUsedPercent" {
					value, present = got.ExpectedUsedPercent, got.HasExpectedUsedPercent
				}
				if value != tc.want || present != tc.present {
					t.Fatalf("value=%d present=%v; want %d/%v", value, present, tc.want, tc.present)
				}
			})
		}
	}
	for _, value := range []float64{-100, -1, math.NaN(), math.Inf(1), math.Inf(-1)} {
		got := parseProviderPace(map[string]any{"pace": map[string]any{"primary": map[string]any{
			"stage": "behind", "deltaPercent": value, "expectedUsedPercent": value,
		}}})[0]
		validDelta := value == -100 || value == -1
		if got.HasDeltaPercent != validDelta || got.HasExpectedUsedPercent {
			t.Fatalf("value=%v pace=%+v", value, got)
		}
	}
}
