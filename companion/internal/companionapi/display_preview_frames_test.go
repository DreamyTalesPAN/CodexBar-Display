package companionapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/daemon"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimeconfig"
)

func getPreviewFrames(t *testing.T, server *Server) previewFramesResponse {
	t.Helper()
	recorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/v1/display/preview-frames", nil))
	var got previewFramesResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &got); err != nil || recorder.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s err=%v", recorder.Code, recorder.Body.String(), err)
	}
	return got
}

func TestDisplayPreviewFramesAreTheDaemonsFrames(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	now := time.Date(2026, 8, 13, 12, 0, 0, 0, time.UTC)
	server.now = func() time.Time { return now }
	usage := daemon.PersistedUsage{Providers: []daemon.ProviderUsageSnapshot{
		{
			Provider:    "codex",
			CollectedAt: now.Add(-time.Minute),
			Frame: protocol.Frame{
				Provider: "codex", Label: "Codex", UsageMode: "used",
				UsageWindows: []protocol.UsageWindow{{ID: "weekly", Label: "Weekly", Percent: 12, ResetSec: 3600}},
			},
		},
	}}
	server.loadUsage = func(time.Time) (daemon.PersistedUsage, bool) { return usage, true }

	got := getPreviewFrames(t, server)
	want := daemon.PreviewFrames(usage, true, now)
	if len(got.Providers) != 1 || got.Providers[0].ID != "codex" {
		t.Fatalf("providers: %+v", got.Providers)
	}
	gotJSON, _ := json.Marshal(got.Providers[0].Automatic)
	wantJSON, _ := json.Marshal(want[0].Automatic)
	if string(gotJSON) != string(wantJSON) {
		t.Fatalf("endpoint frame differs from the daemon's:\n got %s\nwant %s", gotJSON, wantJSON)
	}
	if rows := got.Providers[0].Pinned.ProviderSlots; len(rows) != 1 || rows[0].ResetSec != 3540 {
		t.Fatalf("re-anchored pinned row: %+v", rows)
	}
}

// Automatic rotates over every provider switched on in CodexBar, in its order,
// also one that has no reading yet; it shows the host's unavailable frame.
func TestDisplayPreviewFramesCoverEveryEnabledProvider(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	now := time.Date(2026, 8, 13, 12, 0, 0, 0, time.UTC)
	server.now = func() time.Time { return now }
	server.providerPreferences.loadInventory = func(context.Context) ([]codexbar.ProviderSetting, error) {
		return []codexbar.ProviderSetting{
			{ID: "gemini", Label: "Gemini", Enabled: true},
			{ID: "cursor", Label: "Cursor", Enabled: false},
			{ID: "codex", Label: "Codex", Enabled: true},
		}, nil
	}
	server.loadUsage = func(time.Time) (daemon.PersistedUsage, bool) {
		return daemon.PersistedUsage{Providers: []daemon.ProviderUsageSnapshot{
			{
				Provider: "codex", CollectedAt: now,
				Frame: protocol.Frame{
					Provider: "codex", Label: "Codex", UsageMode: "used",
					UsageWindows: []protocol.UsageWindow{{ID: "weekly", Label: "Weekly", Percent: 12, ResetSec: 3600}},
				},
			},
			{Provider: "cursor", CollectedAt: now, Frame: protocol.Frame{Provider: "cursor", Label: "Cursor", Session: 5}},
		}}, true
	}

	got := getPreviewFrames(t, server)
	if len(got.Providers) != 2 || got.Providers[0].ID != "gemini" || got.Providers[1].ID != "codex" {
		t.Fatalf("enabled providers in CodexBar's order: %+v", got.Providers)
	}
	gemini := got.Providers[0].Automatic
	if gemini.Label != "Gemini" || !gemini.UsageUnavailable || gemini.ResetSec != 0 {
		t.Fatalf("a provider without a reading must be the unavailable frame: %+v", gemini)
	}
	if rows := got.Providers[1].Automatic.ProviderSlots; len(rows) != 1 || rows[0].ID != "codex" {
		t.Fatalf("the unavailable provider has no row: %+v", rows)
	}
}

func TestDisplayPreviewFramesWithoutUsageIsEmptyAndGetOnly(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	server.loadUsage = func(time.Time) (daemon.PersistedUsage, bool) { return daemon.PersistedUsage{}, false }

	if got := getPreviewFrames(t, server); len(got.Providers) != 0 {
		t.Fatalf("providers: %+v", got.Providers)
	}

	recorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/v1/display/preview-frames", nil))
	if recorder.Code != http.StatusMethodNotAllowed {
		t.Fatalf("POST status=%d", recorder.Code)
	}
}
