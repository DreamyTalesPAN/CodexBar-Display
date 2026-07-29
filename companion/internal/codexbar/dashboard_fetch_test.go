package codexbar

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestFetchDashboardProvidersWithholdsColdFirstSnapshot(t *testing.T) {
	server := newDashboardFetchTestServer(t)
	defer server.Close()

	now := time.Date(2026, 7, 28, 8, 30, 0, 0, time.UTC)
	info := DashboardServeInfo{
		Endpoint: server.URL,
		Token:    "test-token",
		Running:  true,
		Healthy:  true,
		PID:      1234,
	}

	cold, err := FetchDashboardProviders(context.Background(), info, now, 1)
	if err != nil {
		t.Fatalf("cold dashboard fetch failed: %v", err)
	}
	if len(cold.Providers) != 1 || !cold.Providers[0].Frame.UsageUnavailable {
		t.Fatalf("expected cold provider to be unavailable, got %+v", cold.Providers)
	}
	if len(cold.Providers[0].Frame.UsageWindows) != 0 || len(cold.Providers[0].Meta.Windows) != 0 {
		t.Fatalf("cold values must be withheld from frame and metadata, got %+v", cold.Providers[0])
	}

	warm, err := FetchDashboardProviders(context.Background(), info, now, 2)
	if err != nil {
		t.Fatalf("warm dashboard fetch failed: %v", err)
	}
	if len(warm.Providers) != 1 {
		t.Fatalf("expected one warm provider, got %+v", warm.Providers)
	}
	frame := warm.Providers[0].Frame
	if frame.UsageUnavailable || len(frame.UsageWindows) != 2 {
		t.Fatalf("expected warm usage-window frame, got %+v", frame)
	}
	if frame.UsageWindows[0].Label != "Weekly" || frame.UsageWindows[1].Label != "Codex Spark Weekly" {
		t.Fatalf("expected Codex dashboard labels, got %+v", frame.UsageWindows)
	}
	if len(warm.Providers[0].Meta.Windows) != 2 {
		t.Fatalf("expected all valid windows in metadata, got %+v", warm.Providers[0].Meta.Windows)
	}
	if got, want := warm.Providers[0].CollectedAt, time.Date(2026, 7, 28, 8, 1, 0, 0, time.UTC); !got.Equal(want) {
		t.Fatalf("dashboard provider freshness must use provider updatedAt, got %s want %s", got, want)
	}
}

func TestFetchDashboardProvidersRequiresProviderUpdatedAt(t *testing.T) {
	server := newDashboardFetchTestServerWithSnapshot(t, `{
	  "schemaVersion": 1,
	  "providers": [{
	    "id": "codex",
	    "name": "Codex",
	    "windows": [{"kind": "weekly", "label": "Weekly", "usedPercent": 68, "resetAt": "2026-08-01T00:00:00Z"}],
	    "error": null,
	    "updatedAt": null
	  }]
	}`)
	defer server.Close()

	result, err := FetchDashboardProviders(context.Background(), DashboardServeInfo{
		Endpoint: server.URL,
		Token:    "test-token",
		Running:  true,
		Healthy:  true,
		PID:      1234,
	}, time.Date(2026, 7, 28, 8, 30, 0, 0, time.UTC), 2)
	if err != nil {
		t.Fatalf("dashboard fetch failed: %v", err)
	}
	if len(result.Providers) != 1 || !result.Providers[0].Frame.UsageUnavailable {
		t.Fatalf("expected null updatedAt to withhold values, got %+v", result.Providers)
	}
}

func newDashboardFetchTestServer(t *testing.T) *httptest.Server {
	t.Helper()
	return newDashboardFetchTestServerWithSnapshot(t, `{
	  "schemaVersion": 1,
	  "providers": [{
	    "id": "codex",
	    "name": "Codex",
	    "windows": [
	      {"kind": "weekly", "label": "Weekly", "usedPercent": 68, "resetAt": "2026-08-01T00:00:00Z"},
	      {"kind": "codex-spark-weekly", "label": "Codex Spark Weekly", "usedPercent": 0, "resetAt": "2026-08-01T00:00:00Z"}
	    ],
	    "error": null,
	    "updatedAt": "2026-07-28T08:01:00Z"
	  }]
	}`)
}

func newDashboardFetchTestServerWithSnapshot(t *testing.T, snapshot string) *httptest.Server {
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
		      "secondary": {"usedPercent": 68, "windowMinutes": 10080, "resetsAt": "2026-08-01T00:00:00Z"},
		      "extraRateWindows": [{
		        "id": "codex-spark-weekly",
		        "title": "Codex Spark Weekly",
		        "usageKnown": true,
		        "window": {"usedPercent": 0, "windowMinutes": 10080, "resetsAt": "2026-08-01T00:00:00Z"}
		      }]
		    }
		  }
		]`))
	})
	return httptest.NewServer(mux)
}
