package codexbar

import (
	"context"
	"net/http"
	"net/http/httptest"
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
	mux.HandleFunc(dashboardUsagePath, func(w http.ResponseWriter, _ *http.Request) {
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
