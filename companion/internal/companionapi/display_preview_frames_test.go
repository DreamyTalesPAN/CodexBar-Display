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

func getUsage(t *testing.T, server *Server, target string) usageResponse {
	t.Helper()
	recorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, target, nil))
	var got usageResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &got); err != nil || recorder.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s err=%v", recorder.Code, recorder.Body.String(), err)
	}
	return got
}

func getPreviewFrames(t *testing.T, server *Server) previewFramesResponse {
	t.Helper()
	got := getUsage(t, server, "/v1/usage?previewFrames=1")
	if got.PreviewFrames == nil {
		t.Fatal("previewFrames missing")
	}
	return *got.PreviewFrames
}

// Usage and frames of one response are built from one loaded snapshot: a
// collector cycle between two requests cannot make them disagree.
func TestUsagePreviewFramesComeFromTheSameSnapshotAsUsage(t *testing.T) {
	isolatePreviewHome(t)
	server := newTestServer(t, runtimeconfig.Config{})
	now := time.Date(2026, 8, 13, 12, 0, 0, 0, time.UTC)
	server.now = func() time.Time { return now }
	loads := 0
	server.loadUsage = func(time.Time) (daemon.PersistedUsage, bool) {
		loads++
		return daemon.PersistedUsage{Providers: []daemon.ProviderUsageSnapshot{{
			Provider: "codex", CollectedAt: now,
			Frame: protocol.Frame{
				Provider: "codex", Label: "Codex", UsageMode: "used",
				UsageWindows: []protocol.UsageWindow{{ID: "weekly", Label: "Weekly", Percent: loads, ResetSec: 3600}},
			},
		}}}, true
	}

	got := getUsage(t, server, "/v1/usage?previewFrames=1")
	if loads != 1 {
		t.Fatalf("usage loaded %d times for one response", loads)
	}
	frame := got.PreviewFrames.Providers[0].Pinned
	if len(got.Providers) != 1 || got.Providers[0].Weekly != 1 ||
		len(frame.ProviderSlots) != 1 || frame.ProviderSlots[0].Percent != 1 {
		t.Fatalf("usage and frame disagree: usage=%+v frame=%+v", got.Providers, frame.ProviderSlots)
	}
	if plain := getUsage(t, server, "/v1/usage"); plain.PreviewFrames != nil {
		t.Fatalf("frames only on request: %+v", plain.PreviewFrames)
	}
}

func TestDisplayPreviewFramesAreTheDaemonsFrames(t *testing.T) {
	isolatePreviewHome(t)
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

func TestUsagePreviewFramesReuseCapturedUsageMode(t *testing.T) {
	for _, mode := range []string{"used", "remaining"} {
		t.Run(mode, func(t *testing.T) {
			isolatePreviewHome(t)
			server := newTestServer(t, runtimeconfig.Config{})
			now := time.Date(2026, 8, 13, 12, 0, 0, 0, time.UTC)
			server.now = func() time.Time { return now }
			reads := 0
			server.usageBarsShowUsed = func() bool {
				reads++
				return (mode == "used") == (reads == 1)
			}
			server.loadUsage = func(time.Time) (daemon.PersistedUsage, bool) {
				return daemon.PersistedUsage{Providers: []daemon.ProviderUsageSnapshot{{
					Provider: "codex", CollectedAt: now,
					Frame: protocol.Frame{Provider: "codex", Label: "Codex", UsageMode: "used",
						UsageWindows: []protocol.UsageWindow{{ID: "weekly", Label: "Weekly", Percent: 12, ResetSec: 3600}},
					},
				}}}, true
			}
			got := getUsage(t, server, "/v1/usage?previewFrames=1")
			want := 12
			if mode == "remaining" {
				want = 88
			}
			if got.UsageMode != mode || len(got.Providers) != 1 || got.Providers[0].Weekly != want {
				t.Fatalf("usage mode=%s providers=%+v", got.UsageMode, got.Providers)
			}
			preview := got.PreviewFrames.Providers[0]
			for _, frame := range []*protocol.Frame{preview.Automatic, &preview.Pinned} {
				if frame == nil || frame.UsageMode != mode || frame.UsageWindows[0].Percent != want || frame.ProviderSlots[0].Percent != want {
					t.Fatalf("preview differs from captured %s mode: %+v", mode, frame)
				}
			}
			if reads != 1 {
				t.Fatalf("usage mode read %d times for one response", reads)
			}
		})
	}
}

// Every provider switched on in CodexBar is listed in its order. One without a
// reading yet has the host's unavailable frame when pinned, and no Automatic
// frame while another provider is current, as the stream drops it there.
func TestDisplayPreviewFramesCoverEveryEnabledProvider(t *testing.T) {
	isolatePreviewHome(t)
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
	if got.Providers[0].Automatic != nil {
		t.Fatalf("the stream never rotates to a provider without a reading: %+v", got.Providers[0].Automatic)
	}
	gemini := got.Providers[0].Pinned
	if gemini.Label != "Gemini" || !gemini.UsageUnavailable || gemini.ResetSec != 0 {
		t.Fatalf("a provider without a reading must be the unavailable frame: %+v", gemini)
	}
	if rows := got.Providers[1].Automatic.ProviderSlots; len(rows) != 1 || rows[0].ID != "codex" {
		t.Fatalf("the unavailable provider has no row: %+v", rows)
	}
}

// PreviewFrames reads the runtime's persisted last-good frame from the home
// directory; a test must not see the developer's.
func isolatePreviewHome(t *testing.T) {
	t.Helper()
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
}
