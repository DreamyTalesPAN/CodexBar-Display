package codexbar

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestFetchDashboardProvidersUsesSnapshotAsAuthority(t *testing.T) {
	server := newDashboardFetchTestServer(t, `{
	  "schemaVersion": 1,
	  "generatedAt": "2026-07-28T08:29:45Z",
	  "staleAfterSeconds": 180,
	  "providers": [{
	    "id": "codex",
	    "name": "Codex",
	    "windows": [
	      {"kind": "weekly", "label": "Weekly", "usedPercent": 68, "resetAt": "2026-08-01T00:00:00Z"},
	      {"kind": "codex-spark-weekly", "label": "Codex Spark Weekly", "usedPercent": 0, "resetAt": "2026-08-01T00:00:00Z"}
	    ],
	    "error": null,
	    "updatedAt": null
	  }]
	}`)
	defer server.Close()

	now := time.Date(2026, 7, 28, 8, 30, 0, 0, time.UTC)
	providers, err := FetchDashboardProviders(context.Background(), dashboardFetchTestInfo(server), now)
	if err != nil {
		t.Fatalf("dashboard fetch failed: %v", err)
	}
	if len(providers) != 1 {
		t.Fatalf("expected one provider, got %+v", providers)
	}
	got := providers[0]
	if got.Frame.UsageUnavailable || got.Stale || len(got.Frame.UsageWindows) != 2 {
		t.Fatalf("first authoritative snapshot must be usable, got %+v", got)
	}
	if got.Frame.UsageWindows[0].Label != "Weekly" ||
		got.Frame.UsageWindows[1].Label != "Codex Spark Weekly" {
		t.Fatalf("expected CodexBar dashboard windows, got %+v", got.Frame.UsageWindows)
	}
	resetAt := time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC)
	wantSnapshotReset := int64(resetAt.Sub(got.CollectedAt).Seconds())
	if got.Frame.UsageWindows[0].ResetSec != wantSnapshotReset {
		t.Fatalf("countdown must be anchored to snapshot time: got=%d want=%d", got.Frame.UsageWindows[0].ResetSec, wantSnapshotReset)
	}
	trusted := got.Frame.ApplyResetTrust(got.CollectedAt, now, true)
	wantSendReset := int64(resetAt.Sub(now).Seconds())
	if trusted.UsageWindows[0].ResetSec != wantSendReset {
		t.Fatalf("countdown must age exactly once before send: got=%d want=%d", trusted.UsageWindows[0].ResetSec, wantSendReset)
	}
}

func TestFetchDashboardProvidersFiltersWindowsInformationalSession(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-token" {
			http.Error(w, "missing bearer token", http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case dashboardSnapshotPath:
			_, _ = w.Write([]byte(`{"schemaVersion":1,"providers":[{"id":"codex","windows":[
				{"kind":"session","label":"Session","usedPercent":0},
				{"kind":"weekly","label":"Weekly","usedPercent":26}
			]}]}`))
		case dashboardUsagePath:
			_, _ = w.Write([]byte(`[{"provider":"codex","usage":{
				"primary":{"is_informational":true,"used_percent":0,"window_minutes":300},
				"secondary":{"is_informational":false,"used_percent":26,"window_minutes":10080}
			}}]`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	providers, err := FetchDashboardProviders(context.Background(), dashboardFetchTestInfo(server), time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if len(providers) != 1 {
		t.Fatalf("expected one provider, got %+v", providers)
	}
	got := providers[0]
	if got.Frame.UsageUnavailable || got.Stale || len(got.Frame.UsageWindows) != 1 || len(got.Meta.Windows) != 1 {
		t.Fatalf("expected only real Weekly quota: %+v", got)
	}
	if window := got.Frame.UsageWindows[0]; window.ID != "weekly" || window.Label != "Weekly" || window.Percent != 26 {
		t.Fatalf("weekly quota lost: %+v", window)
	}
}

func TestFetchDashboardProvidersKeepsLaterWindowResetTrusted(t *testing.T) {
	server := newDashboardFetchTestServer(t, `{
	  "schemaVersion": 1,
	  "generatedAt": "2026-07-28T08:29:45Z",
	  "staleAfterSeconds": 180,
	  "providers": [{
	    "id": "codex",
	    "name": "Codex",
	    "windows": [
	      {"kind": "weekly", "label": "Weekly", "usedPercent": 68},
	      {"kind": "codex-spark-weekly", "label": "Codex Spark Weekly", "usedPercent": 0, "resetAt": "2026-07-28T08:40:00Z"}
	    ],
	    "error": null
	  }]
	}`)
	defer server.Close()

	now := time.Date(2026, 7, 28, 8, 30, 0, 0, time.UTC)
	providers, err := FetchDashboardProviders(context.Background(), dashboardFetchTestInfo(server), now)
	if err != nil {
		t.Fatalf("dashboard fetch failed: %v", err)
	}
	trusted := providers[0].Frame.ApplyResetTrust(providers[0].CollectedAt, now, true)
	if trusted.ResetTrust != "live" || trusted.ResetSec != 600 ||
		len(trusted.UsageWindows) != 2 || trusted.UsageWindows[1].ResetSec != 600 {
		t.Fatalf("later reset must remain trusted when the first window has none: %+v", trusted)
	}
}

func TestFetchDashboardProvidersIgnoresCodexBarStaleDeadline(t *testing.T) {
	server := newDashboardFetchTestServer(t, `{
	  "schemaVersion": 1,
	  "generatedAt": "2026-07-28T08:29:45Z",
	  "staleAfterSeconds": 180,
	  "providers": [{
	    "id": "claude",
	    "name": "Claude",
	    "windows": [{"kind": "weekly", "label": "Weekly", "usedPercent": 27}],
	    "error": null
	  }]
	}`)
	defer server.Close()

	providers, err := FetchDashboardProviders(
		context.Background(),
		dashboardFetchTestInfo(server),
		time.Date(2026, 7, 28, 8, 32, 46, 0, time.UTC),
	)
	if err != nil {
		t.Fatalf("dashboard fetch failed: %v", err)
	}
	if providers[0].Stale || providers[0].Frame.UsageUnavailable {
		t.Fatalf("dashboard snapshot must stay usable past CodexBar's deadline, got %+v", providers[0])
	}
}

func TestFetchDashboardProvidersKeepsProviderErrorUnavailable(t *testing.T) {
	server := newDashboardFetchTestServer(t, `{
	  "schemaVersion": 1,
	  "generatedAt": "2026-07-28T08:29:45Z",
	  "staleAfterSeconds": 180,
	  "providers": [{
	    "id": "codex",
	    "name": "Codex",
	    "windows": [{"kind": "weekly", "label": "Weekly", "usedPercent": 68}],
	    "error": {"message":"provider unavailable"}
	  }]
	}`)
	defer server.Close()

	providers, err := FetchDashboardProviders(
		context.Background(),
		dashboardFetchTestInfo(server),
		time.Date(2026, 7, 28, 8, 30, 0, 0, time.UTC),
	)
	if err != nil {
		t.Fatalf("dashboard fetch failed: %v", err)
	}
	if len(providers) != 1 || !providers[0].Frame.UsageUnavailable || !providers[0].Stale {
		t.Fatalf("provider error must remain unavailable, got %+v", providers)
	}
}

func TestFetchDashboardProvidersDoesNotProbeDisabledProviders(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case dashboardSnapshotPath:
			_, _ = w.Write([]byte(`{"schemaVersion":1,"providers":[]}`))
		case dashboardUsagePath:
			// CodexBar 0.46.0 treats an explicit provider=all as every
			// supported provider, even when the customer disabled them all.
			if r.URL.RawQuery != "" {
				http.Error(w, "disabled providers were requested", http.StatusBadRequest)
				return
			}
			_, _ = w.Write([]byte(`[]`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	providers, err := FetchDashboardProviders(context.Background(), dashboardFetchTestInfo(server), time.Now())
	if err != nil || len(providers) != 0 {
		t.Fatalf("an empty enabled set must settle without probing disabled providers: providers=%+v err=%v", providers, err)
	}
}

// Win-CodexBar answers "provider=all" by fetching every provider it knows.
// On the test laptop that was 71 providers every 30 seconds with only Claude
// switched on, including a start of the Antigravity CLI each time (#554).
func TestFetchDashboardProvidersAsksTheWindowsEngineOnlyForListedProviders(t *testing.T) {
	previous := providerProbePerProvider
	providerProbePerProvider = true
	t.Cleanup(func() { providerProbePerProvider = previous })

	var asked []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case dashboardSnapshotPath:
			_, _ = w.Write([]byte(`{"schemaVersion":1,"providers":[
			  {"id":"claude","name":"Claude","windows":[{"id":"session","kind":"session","usedPercent":12}]},
			  {"id":"codex","name":"Codex","windows":[{"id":"session","kind":"session","usedPercent":34}]}
			]}`))
		case dashboardUsagePath:
			asked = append(asked, r.URL.RawQuery)
			_, _ = fmt.Fprintf(w, `[{"provider":%q,"usage":{}}]`, r.URL.Query().Get("provider"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	providers, err := FetchDashboardProviders(context.Background(), dashboardFetchTestInfo(server), time.Now())
	if err != nil || len(providers) != 2 {
		t.Fatalf("both listed providers must come back: providers=%+v err=%v", providers, err)
	}
	if got := strings.Join(asked, " "); got != "provider=claude provider=codex" {
		t.Fatalf("usage must be asked for the listed providers only, got %q", got)
	}
}

// On Windows each listed provider is a request of its own. When one of them
// fails, the others must still reach the display; only the failed provider
// shows as unavailable (#500 review).
func TestFetchDashboardProvidersKeepsOtherProvidersWhenOneWindowsRequestFails(t *testing.T) {
	previous := providerProbePerProvider
	providerProbePerProvider = true
	t.Cleanup(func() { providerProbePerProvider = previous })

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case dashboardSnapshotPath:
			_, _ = w.Write([]byte(`{"schemaVersion":1,"providers":[
			  {"id":"claude","name":"Claude","windows":[{"kind":"weekly","label":"Weekly","usedPercent":12,"resetAt":"2026-08-01T00:00:00Z"}]},
			  {"id":"codex","name":"Codex","windows":[{"kind":"weekly","label":"Weekly","usedPercent":68,"resetAt":"2026-08-01T00:00:00Z"}]}
			]}`))
		case dashboardUsagePath:
			if r.URL.Query().Get("provider") == "claude" {
				http.Error(w, "probe failed", http.StatusInternalServerError)
				return
			}
			_, _ = w.Write([]byte(`[{"provider":"codex","usage":{"secondary":{"usedPercent":68,"windowMinutes":10080}}}]`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	now := time.Date(2026, 7, 28, 8, 30, 0, 0, time.UTC)
	providers, err := FetchDashboardProviders(context.Background(), dashboardFetchTestInfo(server), now)
	if err != nil || len(providers) != 2 {
		t.Fatalf("one failed request must not drop the other provider: providers=%+v err=%v", providers, err)
	}
	byKey := map[string]ParsedFrame{}
	for _, p := range providers {
		byKey[providerKey(p)] = p
	}
	if claude := byKey["claude"]; !claude.Frame.UsageUnavailable || !claude.Stale {
		t.Fatalf("the failed provider must show as unavailable: %+v", claude)
	}
	if codex := byKey["codex"]; codex.Frame.UsageUnavailable || codex.Stale || len(codex.Frame.UsageWindows) != 1 || codex.Frame.UsageWindows[0].Percent != 68 {
		t.Fatalf("the answering provider must keep its reading: %+v", codex.Frame)
	}
}

// Only when every request fails is the collection itself failed, so the
// caller can fall back like before.
func TestFetchDashboardProvidersFailsWhenEveryWindowsRequestFails(t *testing.T) {
	previous := providerProbePerProvider
	providerProbePerProvider = true
	t.Cleanup(func() { providerProbePerProvider = previous })

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == dashboardSnapshotPath {
			_, _ = w.Write([]byte(`{"schemaVersion":1,"providers":[{"id":"claude","name":"Claude","windows":[]}]}`))
			return
		}
		http.Error(w, "probe failed", http.StatusInternalServerError)
	}))
	defer server.Close()

	if _, err := FetchDashboardProviders(context.Background(), dashboardFetchTestInfo(server), time.Now()); err == nil {
		t.Fatal("a collection where every usage request fails must return an error")
	}
}

func newDashboardFetchTestServer(t *testing.T, snapshot string) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc(dashboardSnapshotPath, func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer test-token" {
			http.Error(w, "missing bearer token", http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(snapshot))
	})
	mux.HandleFunc(dashboardUsagePath, func(w http.ResponseWriter, r *http.Request) {
		// Windows asks once per listed provider; this stub answers each with
		// the whole list.
		wrongQuery := r.URL.RawQuery != ""
		if providerProbePerProvider {
			wrongQuery = r.URL.Query().Get("provider") == "" || r.URL.Query().Get("provider") == "all"
		}
		if r.Header.Get("Authorization") != "Bearer test-token" || wrongQuery {
			http.Error(w, "usage requires bearer and platform provider selection", http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`[
		  {
		    "provider": "codex",
		    "usage": {
		      "secondary": {"usedPercent": 68, "windowMinutes": 10080},
		      "extraRateWindows": [{
		        "id": "codex-spark-weekly",
		        "usageKnown": true,
		        "window": {"usedPercent": 0, "windowMinutes": 10080}
		      }]
		    }
		  },
		  {
		    "provider": "claude",
		    "usage": {"secondary": {"usedPercent": 27, "windowMinutes": 10080}}
		  }
		]`))
	})
	return httptest.NewServer(mux)
}

func dashboardFetchTestInfo(server *httptest.Server) DashboardServeInfo {
	return DashboardServeInfo{
		Endpoint: server.URL,
		Token:    "test-token",
		Running:  true,
		Healthy:  true,
		PID:      1234,
	}
}
