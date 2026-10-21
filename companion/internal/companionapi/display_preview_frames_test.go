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

	recorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/v1/display/preview-frames", nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	var got previewFramesResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	want := daemon.PreviewFrames(usage, true, now)
	if len(got.Providers) != 1 || got.Providers[0].ID != "codex" || got.Providers[0].Automatic == nil || got.Providers[0].Pinned == nil {
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

func TestDisplayPreviewFramesWithoutUsageIsEmptyAndGetOnly(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	server.loadUsage = func(time.Time) (daemon.PersistedUsage, bool) { return daemon.PersistedUsage{}, false }

	recorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/v1/display/preview-frames", nil))
	var got previewFramesResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &got); err != nil || recorder.Code != http.StatusOK || len(got.Providers) != 0 {
		t.Fatalf("empty usage: status=%d body=%s err=%v", recorder.Code, recorder.Body.String(), err)
	}

	recorder = httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/v1/display/preview-frames", nil))
	if recorder.Code != http.StatusMethodNotAllowed {
		t.Fatalf("POST status=%d", recorder.Code)
	}
}
