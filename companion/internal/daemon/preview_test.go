package daemon

import (
	"context"
	"encoding/json"
	"reflect"
	"testing"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimeconfig"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/testenv"
)

func previewSnapshot(provider string, collectedAt time.Time, windows ...protocol.UsageWindow) ProviderUsageSnapshot {
	return ProviderUsageSnapshot{
		Provider:    provider,
		CollectedAt: collectedAt,
		Frame: protocol.Frame{
			V:            protocol.ProtocolVersionV2,
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
	isolatePreviewHome(t)
	now := time.Date(2026, 8, 13, 12, 0, 0, 0, time.UTC)
	usage := PersistedUsage{Providers: []ProviderUsageSnapshot{
		// Read 5 minutes ago: by now its countdown has burned 300 seconds.
		previewSnapshot("codex", now.Add(-5*time.Minute),
			protocol.UsageWindow{ID: "session", Label: "Session", Percent: 40, ResetSec: 7200},
			protocol.UsageWindow{ID: "weekly", Label: "Weekly", Percent: 12, ResetSec: 3600}),
		previewSnapshot("claude", now,
			protocol.UsageWindow{ID: "weekly", Label: "Weekly", Percent: 4, ResetSec: 9000}),
	}}

	previews := PreviewFrames(usage, true, false, previewTestCaps(2048), now, nil)
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
	isolatePreviewHome(t)
	now := time.Date(2026, 8, 13, 12, 0, 0, 0, time.UTC)
	usage := PersistedUsage{Providers: []ProviderUsageSnapshot{
		previewSnapshot("codex", now, protocol.UsageWindow{ID: "weekly", Label: "Weekly", Percent: 30, ResetSec: 3600}),
	}}

	frame := PreviewFrames(usage, false, false, previewTestCaps(2048), now, nil)[0].Automatic
	if frame.UsageMode != "remaining" || frame.UsageWindows[0].Percent != 70 || frame.ProviderSlots[0].Percent != 70 {
		t.Fatalf("remaining mode: %+v", frame)
	}
}

func TestPreviewFramesKeepUnavailableProvidersUnavailable(t *testing.T) {
	isolatePreviewHome(t)
	now := time.Date(2026, 8, 13, 12, 0, 0, 0, time.UTC)
	stale := previewSnapshot("stale", now, protocol.UsageWindow{ID: "session", Label: "Session", Percent: 10, ResetSec: 600})
	stale.Stale = true
	// The collector cleared its values when they expired.
	stale.Frame.UsageUnavailable = true
	// An enabled provider with no reading yet: the collector's failed-read
	// snapshot, which carries no values at all.
	noReading := ProviderUsageSnapshot{Provider: "gemini", NoReading: true, Frame: protocol.Frame{Provider: "gemini", Label: "Gemini", UsageUnavailable: true}}
	live := previewSnapshot("codex", now, protocol.UsageWindow{ID: "session", Label: "Session", Percent: 10, ResetSec: 600})

	previews := PreviewFrames(PersistedUsage{Providers: []ProviderUsageSnapshot{stale, noReading, live}}, true, false, previewTestCaps(2048), now, nil)
	if len(previews) != 3 {
		t.Fatalf("every provider keeps its place in the rotation: %+v", previews)
	}
	for _, preview := range previews[:2] {
		if preview.Automatic != nil {
			t.Fatalf("%s is not in the stream's Automatic rotation while codex is current", preview.Provider)
		}
		frame := preview.Pinned
		if frame.Error != runtimeErrorFrameCode(runtimeErrorNoProviders) || len(frame.UsageWindows) != 0 || frame.Session != 0 || frame.ResetSec != 0 {
			t.Fatalf("%s must be the stream's unavailable error frame: %+v", preview.Provider, frame)
		}
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
	isolatePreviewHome(t)
	now := time.Date(2026, 8, 13, 12, 0, 0, 0, time.UTC)
	live := previewSnapshot("codex", now, protocol.UsageWindow{ID: "session", Label: "Session", Percent: 10, ResetSec: 600})
	stale := previewSnapshot("claude", now.Add(-time.Hour), protocol.UsageWindow{ID: "session", Label: "Session", Percent: 50, ResetSec: 600})
	stale.Stale = true

	previews := PreviewFrames(PersistedUsage{Providers: []ProviderUsageSnapshot{stale, live}}, true, false, previewTestCaps(2048), now, nil)
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
	isolatePreviewHome(t)
	now := time.Date(2026, 8, 13, 12, 0, 0, 0, time.UTC)
	stale := previewSnapshot("claude", now.Add(-time.Minute), protocol.UsageWindow{ID: "session", Label: "Session", Percent: 50, ResetSec: 600})
	stale.Stale = true

	want := streamFrameFor(t, []codexbar.ParsedFrame{parsedOf(stale)}, now, true)
	for name, got := range map[string]protocol.Frame{
		"automatic": *PreviewFrames(PersistedUsage{Providers: []ProviderUsageSnapshot{stale}}, true, false, previewTestCaps(2048), now, nil)[0].Automatic,
		"pinned":    PreviewFrames(PersistedUsage{Providers: []ProviderUsageSnapshot{stale}}, true, false, previewTestCaps(2048), now, nil)[0].Pinned,
	} {
		if got.UsageUnavailable || len(got.UsageWindows) != 1 || got.UsageWindows[0].Percent != 50 ||
			got.ResetTrust != want.ResetTrust || got.ResetSec != want.ResetSec {
			t.Fatalf("%s: stream sends %+v, preview %+v", name, want, got)
		}
	}
}

func TestPreviewFramesAllStaleRestateTheStreamsLastGood(t *testing.T) {
	isolatePreviewHome(t)
	now := time.Date(2026, 8, 13, 12, 0, 0, 0, time.UTC)
	claude := previewSnapshot("claude", now.Add(-2*time.Minute), protocol.UsageWindow{ID: "session", Label: "Session", Percent: 50, ResetSec: 600})
	claude.Stale = true
	codex := previewSnapshot("codex", now.Add(-3*time.Minute), protocol.UsageWindow{ID: "session", Label: "Session", Percent: 30, ResetSec: 900})
	codex.Stale = true
	good := codex.Frame
	good.V = protocol.ProtocolVersionV2
	savedAt := now.Add(-3 * time.Minute)
	if err := persistLastGood(good, savedAt); err != nil {
		t.Fatal(err)
	}

	// The stream with this runtime state: both providers stale, so it restates
	// state.lastGood through sendCycleResult's steps.
	state := &runtimeState{selector: codexbar.NewProviderSelector(), lastGood: good.Normalize(), lastGoodAt: savedAt, hasLastGood: true}
	deps := rotationTestDeps(0, nil)
	deps.now = func() time.Time { return now }
	result := selectCycleFrameFromProviders(state, []codexbar.ParsedFrame{parsedOf(claude), parsedOf(codex)}, now, deps, nil, "", "", "", "")
	if result.usageFresh {
		t.Fatalf("all-stale cycle must not be fresh: %+v", result)
	}
	want := applyUsageBarsPreference(state.lastGood, true).ApplyResetTrust(state.lastGoodAt, now, false)

	previews := PreviewFrames(PersistedUsage{Providers: []ProviderUsageSnapshot{claude, codex}}, true, false, previewTestCaps(2048), now, nil)
	if previews[0].Automatic != nil || previews[1].Automatic == nil {
		t.Fatalf("exactly the last-good provider shows in Automatic: %+v", previews)
	}
	got := *previews[1].Automatic
	if got.Provider != "codex" || got.ResetSec != want.ResetSec || got.ResetTrust != want.ResetTrust || len(got.UsageWindows) != 1 || got.UsageWindows[0].Percent != 30 {
		t.Fatalf("stream restates %+v, preview %+v", want, got)
	}
}

// PreviewFrames reads the runtime's persisted last-good frame from the home
// directory; a test must not see the developer's.
func isolatePreviewHome(t *testing.T) {
	t.Helper()
	testenv.Home(t, t.TempDir())
}

// The preview is the stream's own selection: for each state, every provider's
// Automatic frame is exactly what the stream sends with the timer on it.
func TestPreviewFramesAutomaticIsTheStreamsFrameForEveryState(t *testing.T) {
	now := time.Date(2026, 8, 13, 12, 0, 0, 0, time.UTC)
	window := protocol.UsageWindow{ID: "session", Label: "Session", Percent: 10, ResetSec: 600}
	live := func(id string) ProviderUsageSnapshot { return previewSnapshot(id, now, window) }
	stale := func(id string) ProviderUsageSnapshot {
		s := previewSnapshot(id, now.Add(-time.Minute), window)
		s.Stale = true
		return s
	}
	unavailable := func(id string) ProviderUsageSnapshot {
		return ProviderUsageSnapshot{Provider: id, NoReading: true, Frame: protocol.Frame{Provider: id, Label: id, UsageUnavailable: true}}
	}
	cases := []struct {
		name     string
		snaps    []ProviderUsageSnapshot
		lastGood string
	}{
		{"all current", []ProviderUsageSnapshot{live("codex"), live("claude")}, ""},
		{"one stale", []ProviderUsageSnapshot{stale("claude"), live("codex")}, ""},
		{"all stale, no last good", []ProviderUsageSnapshot{stale("claude"), stale("codex")}, ""},
		{"all stale, last good", []ProviderUsageSnapshot{stale("claude"), stale("codex")}, "codex"},
		{"all unavailable, no last good", []ProviderUsageSnapshot{unavailable("claude"), unavailable("codex")}, ""},
		{"all unavailable, last good", []ProviderUsageSnapshot{unavailable("claude"), unavailable("codex")}, "codex"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			isolatePreviewHome(t)
			if tc.lastGood != "" {
				good := live(tc.lastGood).Frame
				good.V = protocol.ProtocolVersionV2
				if err := persistLastGood(good, now.Add(-time.Minute)); err != nil {
					t.Fatal(err)
				}
			}
			var providers []codexbar.ParsedFrame
			for _, s := range tc.snaps {
				p := parsedOf(s)
				p.Frame.V = protocol.ProtocolVersionV2
				providers = append(providers, p)
			}
			for i, preview := range PreviewFrames(PersistedUsage{Providers: tc.snaps}, true, false, previewTestCaps(2048), now, nil) {
				state := &runtimeState{selector: codexbar.NewProviderSelector(), rotationProvider: tc.snaps[i].Provider, rotationAt: now}
				deps := rotationTestDeps(3600, &runtimeconfig.ProviderDisplayConfig{Mode: "automatic"})
				deps.now = func() time.Time { return now }
				deps.usageBarsShowUsed = func() bool { return true }
				bootstrapStateFromPersistedLastGood(state, now, deps)
				result := selectCycleFrameFromProviders(state, providers, now, deps, nil, "select-provider", "", "", "")
				_, want, result := restateLastGoodWhenNotFresh(state, deps, result)
				if want.Error == "" && want.Provider != tc.snaps[i].Provider {
					if preview.Automatic != nil {
						t.Fatalf("%s: stream shows %q there, preview %+v", tc.snaps[i].Provider, want.Provider, preview.Automatic)
					}
					continue
				}
				want, _ = prepareDeviceFrame(want, result, previewTestCaps(2048), now, "", 10*time.Second)
				_, want, err := marshalFrameWithinLimit(want, 2048)
				if err != nil {
					t.Fatal(err)
				}
				if preview.Automatic == nil || !reflect.DeepEqual(*preview.Automatic, want) {
					t.Fatalf("%s: stream sends %+v, preview %+v", tc.snaps[i].Provider, want, preview.Automatic)
				}
			}
		})
	}
}

func TestPreviewFramesAllUnavailableWithoutLastGoodIsTheStreamsErrorFrame(t *testing.T) {
	isolatePreviewHome(t)
	now := time.Date(2026, 8, 13, 12, 0, 0, 0, time.UTC)
	none := ProviderUsageSnapshot{Provider: "codex", NoReading: true, Frame: protocol.Frame{Provider: "codex", Label: "Codex", UsageUnavailable: true}}
	got := PreviewFrames(PersistedUsage{Providers: []ProviderUsageSnapshot{none}}, true, false, previewTestCaps(2048), now, nil)[0].Automatic
	if got == nil || got.Error != protocol.ErrorFrame(runtimeErrorFrameCode(runtimeErrorNoProviders)).Error {
		t.Fatalf("expected the no-providers error frame: %+v", got)
	}
}

func TestPreviewFramesSystemBusyKeepsExpiredLastGood(t *testing.T) {
	isolatePreviewHome(t)
	now := time.Date(2026, 10, 21, 12, 0, 0, 0, time.UTC)
	savedAt := now.Add(-lastGoodMaxAge() - providerSnapshotMaxAge() - time.Hour)
	good := previewSnapshot("codex", savedAt).Frame
	if err := persistLastGood(good, savedAt); err != nil {
		t.Fatal(err)
	}
	unavailable := ProviderUsageSnapshot{Provider: "codex", NoReading: true, Frame: protocol.Frame{Provider: "codex", UsageUnavailable: true}}
	usage := PersistedUsage{Providers: []ProviderUsageSnapshot{unavailable}}
	preview := PreviewFrames(usage, true, true, previewTestCaps(2048), now, nil)[0]
	for mode, busy := range map[string]*protocol.Frame{"automatic": preview.Automatic, "pinned": &preview.Pinned} {
		if busy == nil || busy.Error != "" || busy.UsageUnavailable || busy.Session != good.Session || busy.Label != SystemBusyLabel {
			t.Fatalf("%s busy preview must retain expired last-good values with busy label: %+v", mode, busy)
		}
	}

	normal := PreviewFrames(usage, true, false, previewTestCaps(2048), now, nil)[0].Automatic
	if normal == nil || (normal.Error == "" && !normal.UsageUnavailable) || normal.Label == SystemBusyLabel {
		t.Fatalf("without busy verdict expired usage must remain unavailable: %+v", normal)
	}
}

func TestPreviewFramesMatchSentTokenVisibilityAtWireBoundary(t *testing.T) {
	isolatePreviewHome(t)
	now := time.Date(2026, 10, 21, 12, 0, 0, 0, time.UTC)
	snapshot := previewSnapshot("codex", now, protocol.UsageWindow{ID: "session", Label: "Session", Percent: 12, ResetSec: 3600})
	snapshot.Frame.SessionTokens, snapshot.Frame.WeekTokens, snapshot.Frame.TotalTokens = 123456789012, 234567890123, 345678901234
	snapshot.Frame.TokenTotalsKnown = true
	providers := []codexbar.ParsedFrame{parsedOf(snapshot)}
	providers[0].Frame.V = protocol.ProtocolVersionV2
	deps := rotationTestDeps(3600, &runtimeconfig.ProviderDisplayConfig{Mode: "automatic"})
	deps.now = func() time.Time { return now }
	deps.usageBarsShowUsed = func() bool { return true }
	deps.transportName = "usb"
	var sent protocol.Frame
	deps.sendLine = func(_ string, line []byte) error { return json.Unmarshal(line, &sent) }
	deps.fetchUpdateState = func(context.Context, protocol.DeviceCapabilities) (protocol.UpdateState, error) {
		return protocol.UpdateState{Status: "current", LatestVersion: "1.0.56"}, nil
	}
	for _, budget := range []int{512, 566, 583, 2048} {
		caps := previewTestCaps(budget)
		caps.SupportsProviderSlotsV1 = false
		caps.Board, caps.Firmware = "esp8266-smalltv-st7789", "1.0.56"
		state := &runtimeState{selector: codexbar.NewProviderSelector(), rotationProvider: "codex", rotationAt: now}
		result := selectCycleFrameFromProviders(state, providers, now, deps, nil, "select-provider", "", "", "")
		attachFirmwareUpdateState(context.Background(), state, deps, caps, &result)
		if err := sendCycleResult(context.Background(), "test-port", caps, caps.MaxFrameBytes, state, deps, result); err != nil {
			t.Fatal(err)
		}
		preview := PreviewFrames(PersistedUsage{Providers: []ProviderUsageSnapshot{snapshot}}, true, false, caps, now, state.firmwareUpdates)[0]
		for mode, frame := range map[string]*protocol.Frame{"automatic": preview.Automatic, "pinned": &preview.Pinned} {
			if frame == nil || !reflect.DeepEqual(*frame, sent) {
				t.Fatalf("%s preview must match actual send at %d-byte boundary: preview=%+v sent=%+v", mode, budget, frame, sent)
			}
		}
	}

}

func previewTestCaps(maxBytes int) protocol.DeviceCapabilities {
	return protocol.DeviceCapabilities{NegotiatedProtocolVersion: 2, SupportsProviderSlotsV1: true, MaxFrameBytes: maxBytes}
}

func TestPreviewFramesCapWindowsBeforeProjectingRootCountdown(t *testing.T) {
	for _, tc := range []struct {
		name       string
		limit      int
		firstReset int64
		wantCount  int
		wantReset  int64
	}{
		{name: "one window", limit: 1, wantCount: 1},
		{name: "three windows", limit: 3, wantCount: 3},
		{name: "retained deadline", limit: 1, firstReset: 3600, wantCount: 1, wantReset: 3600},
		{name: "unknown cap", wantCount: 4, wantReset: 7200},
	} {
		t.Run(tc.name, func(t *testing.T) {
			isolatePreviewHome(t)
			now := time.Date(2026, 10, 21, 8, 0, 0, 0, time.UTC)
			snapshot := previewSnapshot("codex", now,
				protocol.UsageWindow{ID: "session", Label: "Session", Percent: 20, ResetSec: tc.firstReset},
				protocol.UsageWindow{ID: "weekly", Label: "Weekly", Percent: 20},
				protocol.UsageWindow{ID: "third", Label: "Third", Percent: 20},
				protocol.UsageWindow{ID: "overflow", Label: "Overflow", Percent: 20, ResetSec: 7200},
			)
			original := append([]protocol.UsageWindow(nil), snapshot.Frame.UsageWindows...)
			caps := previewTestCaps(2048)
			caps.MaxUsageWindows = tc.limit
			preview := PreviewFrames(PersistedUsage{Providers: []ProviderUsageSnapshot{snapshot}}, true, false, caps, now, nil)[0]
			for mode, frame := range map[string]*protocol.Frame{"automatic": preview.Automatic, "pinned": &preview.Pinned} {
				if frame == nil || len(frame.UsageWindows) != tc.wantCount || frame.ResetSec != tc.wantReset {
					t.Errorf("%s: want %d windows and root reset %d, got %+v", mode, tc.wantCount, tc.wantReset, frame)
				}
			}
			if !reflect.DeepEqual(snapshot.Frame.UsageWindows, original) {
				t.Fatalf("preview changed the collector snapshot: %+v", snapshot.Frame.UsageWindows)
			}
		})
	}
}

func TestPreviewFramesV1RemainingMatchesSentFrame(t *testing.T) {
	isolatePreviewHome(t)
	now := time.Date(2026, 10, 21, 12, 0, 0, 0, time.UTC)
	snapshot := previewSnapshot("codex", now, protocol.UsageWindow{ID: "session", Label: "Session", Percent: 30, ResetSec: 3600})
	caps := previewTestCaps(2048)
	caps.NegotiatedProtocolVersion = protocol.ProtocolVersionV1
	deps := rotationTestDeps(3600, &runtimeconfig.ProviderDisplayConfig{Mode: "automatic"})
	deps.now = func() time.Time { return now }
	deps.usageBarsShowUsed = func() bool { return false }
	deps.transportName = "usb"
	var sent protocol.Frame
	deps.sendLine = func(_ string, line []byte) error { return json.Unmarshal(line, &sent) }
	state := &runtimeState{selector: codexbar.NewProviderSelector()}
	result := selectCycleFrameFromProviders(state, []codexbar.ParsedFrame{parsedOf(snapshot)}, now, deps, nil, "select-provider", "", "", "")
	if err := sendCycleResult(context.Background(), "test-port", caps, caps.MaxFrameBytes, state, deps, result); err != nil {
		t.Fatal(err)
	}
	if sent.Session != 70 || len(sent.UsageSlots) != 1 || sent.UsageSlots[0].Percent != 70 {
		t.Fatalf("unexpected stream fixture: %+v", sent)
	}
	preview := PreviewFrames(PersistedUsage{Providers: []ProviderUsageSnapshot{snapshot}}, false, false, caps, now, nil)[0]
	for mode, frame := range map[string]*protocol.Frame{"automatic": preview.Automatic, "pinned": &preview.Pinned} {
		if frame == nil || !reflect.DeepEqual(*frame, sent) {
			t.Errorf("%s: preview=%+v sent=%+v", mode, frame, sent)
		}
	}
}

func TestPreviewFramesReuseTheStreamUpdateCacheWithoutFetching(t *testing.T) {
	isolatePreviewHome(t)
	now := time.Date(2026, 10, 21, 12, 0, 0, 0, time.UTC)
	caps := previewTestCaps(2048)
	caps.Board, caps.Firmware = "esp8266-smalltv-st7789", "1.0.56"
	cache := &FirmwareUpdateCache{}
	deps := rotationTestDeps(3600, nil).withDefaults()
	deps.now = func() time.Time { return now }
	calls := 0
	deps.fetchUpdateState = func(context.Context, protocol.DeviceCapabilities) (protocol.UpdateState, error) {
		calls++
		return protocol.UpdateState{Status: "current", LatestVersion: "1.0.56"}, nil
	}
	state := initializeRuntimeState(now, Options{FirmwareUpdates: cache}, deps)
	result := cycleResult{}
	attachFirmwareUpdateState(context.Background(), state, deps, caps, &result)
	// A second worker and the API both read the same cache, not a preview-owned copy.
	next := initializeRuntimeState(now, Options{FirmwareUpdates: cache}, deps)
	attachFirmwareUpdateState(context.Background(), next, deps, caps, &result)
	usage := PersistedUsage{Providers: []ProviderUsageSnapshot{{Provider: "codex", NoReading: true, Frame: protocol.Frame{V: 2, Provider: "codex", UsageUnavailable: true}}}}
	preview := PreviewFrames(usage, true, false, caps, now, cache)[0]
	for mode, frame := range map[string]*protocol.Frame{"automatic": preview.Automatic, "pinned": &preview.Pinned} {
		if frame == nil || frame.Error == "" || !reflect.DeepEqual(frame.Update, compactFrameUpdate(result.frame.Update)) {
			t.Fatalf("%s error frame lost update envelope: %+v", mode, frame)
		}
	}
	caps.Firmware = "1.0.57"
	other := PreviewFrames(usage, true, false, caps, now, cache)[0]
	if other.Pinned.Update != nil {
		t.Fatal("preview reused another firmware's envelope")
	}
	if calls != 1 {
		t.Fatalf("update fetches = %d, want only the stream's first fetch", calls)
	}
}
