package daemon

import (
	"testing"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar"
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
	if len(pinned.ProviderSlots) != 1 || pinned.ProviderSlots[0].ID != "codex" || pinned.ProviderSlots[0].ResetSec != 3300 {
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
	// The collector cleared its values when they expired.
	stale.Frame.UsageUnavailable = true
	// An enabled provider with no reading yet: the collector's failed-read
	// snapshot, which carries no values at all.
	noReading := ProviderUsageSnapshot{Provider: "gemini", NoReading: true, Frame: protocol.Frame{Provider: "gemini", Label: "Gemini", UsageUnavailable: true}}
	live := previewSnapshot("codex", now, protocol.UsageWindow{ID: "session", Label: "Session", Percent: 10, ResetSec: 600})

	previews := PreviewFrames(PersistedUsage{Providers: []ProviderUsageSnapshot{stale, noReading, live}}, true, now)
	if len(previews) != 3 {
		t.Fatalf("every provider keeps its place in the rotation: %+v", previews)
	}
	for _, preview := range previews[:2] {
		if preview.Automatic != nil {
			t.Fatalf("%s is not in the stream's Automatic rotation while codex is current", preview.Provider)
		}
		for _, frame := range []protocol.Frame{preview.Pinned} {
			if !frame.UsageUnavailable || !frame.SessionUnavailable || !frame.WeeklyUnavailable || len(frame.UsageWindows) != 0 ||
				frame.Session != 0 || frame.ResetSec != 0 {
				t.Fatalf("%s must be the unavailable frame: %+v", preview.Provider, frame)
			}
		}
	}
	if previews[1].Pinned.Label != "Gemini" {
		t.Fatalf("the unavailable frame keeps the provider's name: %+v", previews[1].Pinned)
	}
	// Their countdowns stay out of the live provider's rows too.
	if rows := previews[2].Automatic.ProviderSlots; len(rows) != 1 || rows[0].ID != "codex" {
		t.Fatalf("rows: %+v", rows)
	}
}

// The stream with the same state: the preview must be the frame sendCycleResult
// would put on the wire for the provider the selector shows.
func streamFrameFor(t *testing.T, providers []codexbar.ParsedFrame, now time.Time, showUsed bool) protocol.Frame {
	t.Helper()
	state := &runtimeState{selector: codexbar.NewProviderSelector()}
	deps := rotationTestDeps(0, nil)
	deps.now = func() time.Time { return now }
	result := selectCycleFrameFromProviders(state, providers, now, deps, nil, "", "", "", "")
	result.frame.V = protocol.ProtocolVersionV2
	frame := applyUsageBarsPreference(result.frame.Normalize(), showUsed)
	return frame.ApplyResetTrust(result.resetBasisAt, now, result.usageFresh)
}

func parsedOf(snapshot ProviderUsageSnapshot) codexbar.ParsedFrame {
	return codexbar.ParsedFrame{Frame: snapshot.Frame, Provider: snapshot.Provider, CollectedAt: snapshot.CollectedAt, Stale: snapshot.Stale}
}

func TestPreviewFramesAutomaticSkipsWhatTheStreamSkips(t *testing.T) {
	now := time.Date(2026, 8, 13, 12, 0, 0, 0, time.UTC)
	live := previewSnapshot("codex", now, protocol.UsageWindow{ID: "session", Label: "Session", Percent: 10, ResetSec: 600})
	stale := previewSnapshot("claude", now.Add(-time.Hour), protocol.UsageWindow{ID: "session", Label: "Session", Percent: 50, ResetSec: 600})
	stale.Stale = true

	previews := PreviewFrames(PersistedUsage{Providers: []ProviderUsageSnapshot{stale, live}}, true, now)
	if previews[0].Automatic != nil || previews[1].Automatic == nil {
		t.Fatalf("only the current provider rotates: %+v", previews)
	}
	if previews[0].Pinned.UsageUnavailable {
		t.Fatalf("pinning keeps the retained reading: %+v", previews[0].Pinned)
	}
	want := streamFrameFor(t, []codexbar.ParsedFrame{parsedOf(stale), parsedOf(live)}, now, true)
	if got := previews[1].Automatic; got.Provider != want.Provider || got.ResetSec != want.ResetSec || len(got.ProviderSlots) != len(want.ProviderSlots) {
		t.Fatalf("stream sends %+v, preview %+v", want, got)
	}
}

func TestPreviewFramesRetainedReadingIsWhatTheStreamSends(t *testing.T) {
	now := time.Date(2026, 8, 13, 12, 0, 0, 0, time.UTC)
	stale := previewSnapshot("claude", now.Add(-time.Minute), protocol.UsageWindow{ID: "session", Label: "Session", Percent: 50, ResetSec: 600})
	stale.Stale = true

	want := streamFrameFor(t, []codexbar.ParsedFrame{parsedOf(stale)}, now, true)
	for name, got := range map[string]protocol.Frame{
		"automatic": *PreviewFrames(PersistedUsage{Providers: []ProviderUsageSnapshot{stale}}, true, now)[0].Automatic,
		"pinned":    PreviewFrames(PersistedUsage{Providers: []ProviderUsageSnapshot{stale}}, true, now)[0].Pinned,
	} {
		if got.UsageUnavailable || len(got.UsageWindows) != 1 || got.UsageWindows[0].Percent != 50 ||
			got.ResetTrust != want.ResetTrust || got.ResetSec != want.ResetSec {
			t.Fatalf("%s: stream sends %+v, preview %+v", name, want, got)
		}
	}
}
