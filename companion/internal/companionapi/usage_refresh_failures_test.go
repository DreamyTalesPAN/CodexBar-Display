package companionapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/daemon"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimeconfig"
)

func TestUsageManualRefreshStopsWaitingForFailedProvider(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	now := time.Date(2026, 10, 23, 10, 0, 0, 0, time.UTC)
	server.now = func() time.Time { return now }
	server.wakeDisplayStream = func() {}
	usage := daemon.PersistedUsage{
		SavedAt: now.Add(-time.Minute),
		Providers: []daemon.ProviderUsageSnapshot{
			{Provider: "claude", Frame: protocol.Frame{Provider: "claude", Weekly: 24}, CollectedAt: now.Add(-time.Minute)},
			{Provider: "codex", Frame: protocol.Frame{Provider: "codex", Weekly: 42}, CollectedAt: now.Add(-24 * time.Hour), Stale: true},
		},
	}
	server.loadUsage = func(time.Time) (daemon.PersistedUsage, bool) { return usage, true }
	read := func(path string) usageResponse {
		t.Helper()
		rec := httptest.NewRecorder()
		server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("status %d: %s", rec.Code, rec.Body.String())
		}
		var got usageResponse
		if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
			t.Fatal(err)
		}
		return got
	}
	if got := read("/v1/usage?refresh=1"); got.Refresh.State != "refreshing" {
		t.Fatalf("must wait for the working provider's new reading: %+v", got.Refresh)
	}
	usage.Providers[0].Stale = true
	if got := read("/v1/usage"); got.Refresh.State != "refreshing" {
		t.Fatalf("no successful reading must not complete refresh: %+v", got.Refresh)
	}
	now = now.Add(5 * time.Second)
	usage.SavedAt = now
	usage.Providers[0].CollectedAt = now
	usage.Providers[0].Stale = false
	usage.Providers[0].Frame.Weekly = 25
	got := read("/v1/usage")
	if got.Refresh.State != "fresh" {
		t.Fatalf("failed provider must not keep a completed refresh waiting: %+v", got.Refresh)
	}
	if len(got.Providers) != 2 || got.Providers[0].Weekly != 25 || !got.Providers[1].Stale || !got.Providers[1].UsageUnavailable {
		t.Fatalf("keep the successful reading and the failed provider unavailable: %+v", got.Providers)
	}
	now = now.Add(time.Second)
	got = read("/v1/usage?refresh=1")
	if got.Refresh.State != "refreshing" || got.Refresh.RequestedAt != now.Format(time.RFC3339) {
		t.Fatalf("the next click must start a new refresh: %+v", got.Refresh)
	}
}
