package codexbar

import (
	"context"
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

// The production path: CodexBar 0.63.0's serve recordings, keyed by its
// structural lanes, land on the dashboard windows they describe.
func TestDashboardUsageCarriesCodexBarPace(t *testing.T) {
	dir := filepath.Join("testdata", "cli", "codexbar-macos-0.63.0")
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

	collectedAt := time.Date(2026, 9, 21, 8, 30, 16, 0, time.UTC)
	providers, err := FetchDashboardProviders(context.Background(), dashboardFetchTestInfo(server), collectedAt)
	if err != nil || len(providers) != 2 {
		t.Fatalf("providers=%d err=%v", len(providers), err)
	}
	want := map[string][]protocol.UsagePace{
		// "14% in deficit | Expected 29% used | Runs out in 2d 15h"
		"codex": {pace(14, protocol.PaceDeficit, false)},
		// "25% in reserve | ... | Lasts until reset", "11% in reserve | ..."; the
		// extra Fable window has no pace in CodexBar.
		"claude": {pace(-25, protocol.PaceReserve, true), pace(-11, protocol.PaceReserve, true), {}},
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
		if len(provider.Meta.Pace) == 0 {
			t.Fatalf("%s: /v1/usage lost the pace the frame carries", provider.Provider)
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
		got, _ := UsageWindowPace([]ProviderPace{{Window: "secondary", Stage: stage, WillLastToReset: true}}, "weekly")
		if !samePace(got, pace(0, state, true)) {
			t.Fatalf("stage %s: %+v", stage, got)
		}
	}
}
