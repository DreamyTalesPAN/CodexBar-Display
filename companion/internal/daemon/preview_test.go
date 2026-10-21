package daemon

import (
	"testing"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
)

func previewSnapshot(provider string, collectedAt time.Time, windows ...protocol.UsageWindow) ProviderUsageSnapshot {
	return ProviderUsageSnapshot{
		Provider:    provider,
		CollectedAt: collectedAt,
		Frame: protocol.Frame{
			Provider:     provider,
			Label:        provider,
			Session:      10,
			Weekly:       20,
			UsageMode:    "used",
			UsageWindows: windows,
		},
	}
}

func TestPreviewFramesMatchTheStreamsRowsAndResetTrust(t *testing.T) {
	now := time.Date(2026, 8, 13, 12, 0, 0, 0, time.UTC)
	usage := PersistedUsage{Providers: []ProviderUsageSnapshot{
		// Read 5 minutes ago: by now its countdown has burned 300 seconds.
		previewSnapshot("codex", now.Add(-5*time.Minute),
			protocol.UsageWindow{ID: "session", Label: "Session", Percent: 40, ResetSec: 7200},
			protocol.UsageWindow{ID: "weekly", Label: "Weekly", Percent: 12, ResetSec: 3600}),
		previewSnapshot("claude", now,
			protocol.UsageWindow{ID: "weekly", Label: "Weekly", Percent: 4, ResetSec: 9000}),
	}}

	previews := PreviewFrames(usage, true, now)
	if len(previews) != 2 || previews[0].Provider != "codex" || previews[1].Provider != "claude" {
		t.Fatalf("expected codex and claude in collector order: %+v", previews)
	}

	auto := previews[0].Automatic
	if auto == nil {
		t.Fatal("codex has current usage and must have an Automatic frame")
	}
	// Rows are expressed as of the shown frame's own reading time (-5 min), the
	// frame is then re-anchored to now: codex 3600-300, claude 9000+300-300.
	if len(auto.ProviderSlots) != 2 || auto.ProviderSlots[0].ID != "codex" || auto.ProviderSlots[0].ResetSec != 3300 ||
		auto.ProviderSlots[1].ID != "claude" || auto.ProviderSlots[1].ResetSec != 9000 {
		t.Fatalf("Automatic rows: %+v", auto.ProviderSlots)
	}
	if auto.ResetSec != 6900 || auto.ResetTrust != protocol.ResetTrustLive || auto.ResetSource != "codex" {
		t.Fatalf("reset trust: reset=%d trust=%q source=%q", auto.ResetSec, auto.ResetTrust, auto.ResetSource)
	}

	// Manual builds the rows from the pinned provider alone.
	pinned := previews[0].Pinned
	if pinned == nil || len(pinned.ProviderSlots) != 1 || pinned.ProviderSlots[0].ID != "codex" || pinned.ProviderSlots[0].ResetSec != 3300 {
		t.Fatalf("Pinned rows: %+v", pinned)
	}
	// Building one frame must not change the other's windows.
	if auto.UsageWindows[0].ResetSec != 6900 || pinned.UsageWindows[0].ResetSec != 6900 {
		t.Fatalf("windows re-anchored twice or not at all: %+v / %+v", auto.UsageWindows, pinned.UsageWindows)
	}
}

func TestPreviewFramesFlipRowsInRemainingMode(t *testing.T) {
	now := time.Date(2026, 8, 13, 12, 0, 0, 0, time.UTC)
	usage := PersistedUsage{Providers: []ProviderUsageSnapshot{
		previewSnapshot("codex", now, protocol.UsageWindow{ID: "weekly", Label: "Weekly", Percent: 30, ResetSec: 3600}),
	}}

	frame := PreviewFrames(usage, false, now)[0].Automatic
	if frame.UsageMode != "remaining" || frame.UsageWindows[0].Percent != 70 || frame.ProviderSlots[0].Percent != 70 {
		t.Fatalf("remaining mode: %+v", frame)
	}
}

func TestPreviewFramesKeepUnavailableProvidersUnavailable(t *testing.T) {
	now := time.Date(2026, 8, 13, 12, 0, 0, 0, time.UTC)
	stale := previewSnapshot("stale", now, protocol.UsageWindow{ID: "session", Label: "Session", Percent: 10, ResetSec: 600})
	stale.Stale = true
	unavailable := previewSnapshot("unavailable", now, protocol.UsageWindow{ID: "session", Label: "Session", Percent: 10, ResetSec: 600})
	unavailable.Frame.UsageUnavailable = true
	live := previewSnapshot("codex", now, protocol.UsageWindow{ID: "session", Label: "Session", Percent: 10, ResetSec: 600})

	previews := PreviewFrames(PersistedUsage{Providers: []ProviderUsageSnapshot{stale, unavailable, live}}, true, now)
	for _, preview := range previews[:2] {
		if preview.Automatic != nil || preview.Pinned != nil {
			t.Fatalf("%s must have no frame: %+v", preview.Provider, preview)
		}
	}
	// Their countdowns stay out of the live provider's rows too.
	if rows := previews[2].Automatic.ProviderSlots; len(rows) != 1 || rows[0].ID != "codex" {
		t.Fatalf("rows: %+v", rows)
	}
}
