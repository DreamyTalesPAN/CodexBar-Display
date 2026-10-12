package daemon

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimeconfig"
)

func displayLimitsClaude(basis time.Time) codexbar.ParsedFrame {
	claude := providerFrameWithWindows("claude", basis,
		protocol.UsageWindow{ID: "session", Label: "Session", Percent: 13, ResetSec: 7200},
		protocol.UsageWindow{ID: "weekly", Label: "Weekly", Percent: 72, ResetSec: 360000, Pace: protocol.UsagePace{Delta: 31, State: "deficit"}},
		protocol.UsageWindow{ID: "claude-weekly-scoped-fable", Label: "Fable only", Percent: 0, ResetSec: 360001},
	)
	claude.Frame.Label = "Claude"
	claude.Frame.V = protocol.ProtocolVersionV2
	claude.Frame.ResetSource = "claude:primary"
	return claude
}

func displayLimitsCodex(collectedAt time.Time) codexbar.ParsedFrame {
	codex := providerFrameWithWindows("codex", collectedAt,
		protocol.UsageWindow{ID: "weekly", Label: "Weekly", Percent: 32, ResetSec: 420000, Pace: protocol.UsagePace{Delta: -12, State: "reserve"}},
	)
	codex.Frame.Label = "Codex"
	codex.Frame.V = protocol.ProtocolVersionV2
	return codex
}

func TestDisplayLimitsLeaveTheFrameAloneWithoutAChoice(t *testing.T) {
	basis := time.Date(2026, 10, 9, 12, 0, 0, 0, time.UTC)
	claude := displayLimitsClaude(basis)
	for _, display := range []*runtimeconfig.ProviderDisplayConfig{nil, {Mode: "automatic"}} {
		got := applyDisplayLimits(claude.Frame, []codexbar.ParsedFrame{claude}, display, basis)
		if len(got.UsageWindows) != 3 || got.ResetSource != "claude:primary" || got.UsageWindows[1].Pace.State != "deficit" {
			t.Fatalf("display=%+v changed the frame: %+v", display, got)
		}
	}
}

func TestDisplayLimitsHideTheSessionAndMoveTheCountdownToWeekly(t *testing.T) {
	basis := time.Date(2026, 10, 9, 12, 0, 0, 0, time.UTC)
	claude := displayLimitsClaude(basis)
	display := &runtimeconfig.ProviderDisplayConfig{
		Mode:          "fixed",
		ProviderIDs:   []string{"claude"},
		HiddenWindows: map[string][]string{"claude": {"session"}},
	}

	got := applyDisplayLimits(claude.Frame, []codexbar.ParsedFrame{claude}, display, basis).Normalize()
	if len(got.UsageWindows) != 2 || got.UsageWindows[0].ID != "weekly" || got.UsageWindows[1].Label != "Fable only" {
		t.Fatalf("windows=%+v want Weekly then Fable only", got.UsageWindows)
	}
	if got.ResetSec != 360000 || got.ResetSource != "claude:weekly" {
		t.Fatalf("root countdown=%d source=%q want the weekly one", got.ResetSec, got.ResetSource)
	}
	if !got.SessionUnavailable || got.Weekly != 72 {
		t.Fatalf("legacy lanes session=%d unavailable=%t weekly=%d", got.Session, got.SessionUnavailable, got.Weekly)
	}
}

func TestDisplayLimitsNeverHideEveryWindow(t *testing.T) {
	basis := time.Date(2026, 10, 9, 12, 0, 0, 0, time.UTC)
	codex := displayLimitsCodex(basis)
	display := &runtimeconfig.ProviderDisplayConfig{
		Mode:          "automatic",
		HiddenWindows: map[string][]string{"codex": {"weekly"}},
	}
	got := applyDisplayLimits(codex.Frame, []codexbar.ParsedFrame{codex}, display, basis)
	if len(got.UsageWindows) != 1 || got.UsageWindows[0].ID != "weekly" {
		t.Fatalf("hiding the only window blanked VibeTV: %+v", got.UsageWindows)
	}
}

func TestDisplayLimitsPairShowsEachProvidersFirstVisibleWindow(t *testing.T) {
	basis := time.Date(2026, 10, 9, 12, 0, 0, 0, time.UTC)
	claude := displayLimitsClaude(basis)
	// Collected five minutes earlier: by the frame's basis its countdown has
	// already burned 300 seconds.
	codex := displayLimitsCodex(basis.Add(-5 * time.Minute))
	display := &runtimeconfig.ProviderDisplayConfig{
		Mode:          "pair",
		ProviderIDs:   []string{"claude", "codex"},
		HiddenWindows: map[string][]string{"claude": {"session"}},
	}

	got := applyDisplayLimits(claude.Frame, []codexbar.ParsedFrame{codex, claude}, display, basis).Normalize()
	if got.Provider != "claude+codex" || got.Label != "Claude + Codex" {
		t.Fatalf("pair identity provider=%q label=%q", got.Provider, got.Label)
	}
	if len(got.UsageWindows) != 2 {
		t.Fatalf("pair windows=%+v", got.UsageWindows)
	}
	first, second := got.UsageWindows[0], got.UsageWindows[1]
	if first.ID != "claude:weekly" || first.Label != "Claude Weekly" || first.Percent != 72 || first.ResetSec != 360000 || first.Pace.State != "deficit" {
		t.Fatalf("first window=%+v", first)
	}
	if second.ID != "codex:weekly" || second.Label != "Codex Weekly" || second.Percent != 32 || second.ResetSec != 419700 || second.Pace.State != "reserve" {
		t.Fatalf("second window=%+v", second)
	}
	if got.ResetSource != "claude:weekly" || got.ResetSec != 360000 {
		t.Fatalf("root countdown=%d source=%q", got.ResetSec, got.ResetSource)
	}
	sent := got.ApplyResetTrust(basis, basis, true)
	if sent.ResetTrust != protocol.ResetTrustLive || sent.ResetSource != "claude:weekly" {
		t.Fatalf("pair frame lost its countdown trust: trust=%q source=%q", sent.ResetTrust, sent.ResetSource)
	}
}

func TestDisplayLimitsPairWithOneProviderMissingShowsTheOther(t *testing.T) {
	basis := time.Date(2026, 10, 9, 12, 0, 0, 0, time.UTC)
	claude := displayLimitsClaude(basis)
	codex := displayLimitsCodex(basis)
	codex.Frame.UsageUnavailable = true
	display := &runtimeconfig.ProviderDisplayConfig{
		Mode:          "pair",
		ProviderIDs:   []string{"codex", "claude"},
		HiddenWindows: map[string][]string{"claude": {"session", "claude-weekly-scoped-fable"}},
	}

	got := applyDisplayLimits(claude.Frame, []codexbar.ParsedFrame{codex, claude}, display, basis)
	if got.Provider != "claude" || len(got.UsageWindows) != 1 || got.UsageWindows[0].Label != "Weekly" {
		t.Fatalf("half a pair=%+v want Claude alone", got)
	}
}

// Two idle accounts are a current reading too: the pair frame must leave as
// live under a source the device accepts, so VibeTV can say "No active
// session" instead of "Reset unavailable".
func TestDisplayLimitsPairWithoutCountdownsStaysLive(t *testing.T) {
	basis := time.Date(2026, 10, 9, 12, 0, 0, 0, time.UTC)
	claude := providerFrameWithWindows("claude", basis,
		protocol.UsageWindow{ID: "weekly", Label: "Weekly", Percent: 0},
	)
	claude.Frame.Label = "Claude"
	claude.Frame.V = protocol.ProtocolVersionV2
	codex := providerFrameWithWindows("codex", basis,
		protocol.UsageWindow{ID: "weekly", Label: "Weekly", Percent: 0},
	)
	codex.Frame.Label = "Codex"
	codex.Frame.V = protocol.ProtocolVersionV2
	display := &runtimeconfig.ProviderDisplayConfig{Mode: "pair", ProviderIDs: []string{"claude", "codex"}}

	sent := applyDisplayLimits(claude.Frame, []codexbar.ParsedFrame{claude, codex}, display, basis).
		ApplyResetTrust(basis, basis, true)
	if sent.Provider != "claude+codex" || sent.ResetTrust != protocol.ResetTrustLive || sent.ResetSource != "claude.codex" {
		t.Fatalf("idle pair provider=%q trust=%q source=%q want live under claude.codex", sent.Provider, sent.ResetTrust, sent.ResetSource)
	}
}

// A retained reading must not sit beside a fresh one as if it were live: the
// fresh provider is shown alone until both are current again.
func TestDisplayLimitsPairLeavesOutAStaleProvider(t *testing.T) {
	basis := time.Date(2026, 10, 9, 12, 0, 0, 0, time.UTC)
	claude := displayLimitsClaude(basis)
	codex := displayLimitsCodex(basis)
	codex.Stale = true
	display := &runtimeconfig.ProviderDisplayConfig{Mode: "pair", ProviderIDs: []string{"codex", "claude"}}

	got := applyDisplayLimits(claude.Frame, []codexbar.ParsedFrame{codex, claude}, display, basis).Normalize()
	if got.Provider != "claude" || got.Label != "Claude" || len(got.UsageWindows) != 3 || got.UsageWindows[0].Label != "Session" {
		t.Fatalf("pair with a stale member=%+v want Claude alone", got)
	}
}

func TestDisplayLimitsSwitchOffReserveAndDeficit(t *testing.T) {
	basis := time.Date(2026, 10, 9, 12, 0, 0, 0, time.UTC)
	claude := displayLimitsClaude(basis)
	display := &runtimeconfig.ProviderDisplayConfig{Mode: "fixed", ProviderIDs: []string{"claude"}, HidePace: true}
	got := applyDisplayLimits(claude.Frame, []codexbar.ParsedFrame{claude}, display, basis)
	for _, window := range got.UsageWindows {
		if window.Pace != (protocol.UsagePace{}) {
			t.Fatalf("pace survived the switch: %+v", window)
		}
	}
}

func TestProviderResetSlotsSkipHiddenWindows(t *testing.T) {
	basis := time.Date(2026, 10, 9, 12, 0, 0, 0, time.UTC)
	display := &runtimeconfig.ProviderDisplayConfig{Mode: "automatic", HiddenWindows: map[string][]string{"claude": {"session"}}}
	slots := providerResetSlots([]codexbar.ParsedFrame{displayLimitsClaude(basis)}, basis, display)
	if len(slots) != 1 || slots[0].ResetSec != 360000 {
		t.Fatalf("slots=%+v want the weekly reset", slots)
	}
}

func TestProviderDisplayKeepsThePairsLastGoodFrame(t *testing.T) {
	// Clearing a last-good frame removes its file under HOME.
	t.Setenv("HOME", t.TempDir())
	pair := runtimeconfig.ProviderDisplayConfig{Mode: "pair", ProviderIDs: []string{"claude", "codex"}}
	state := &runtimeState{
		selector:    codexbar.NewProviderSelector(),
		lastGood:    protocol.Frame{Provider: "claude+codex", Label: "Claude + Codex"},
		lastGoodAt:  time.Now(),
		hasLastGood: true,
	}
	applyProviderDisplaySelection(state, []codexbar.ParsedFrame{testParsedFrame("claude", 1, 2, 60)}, providerDisplayTestDeps(pair), nil)
	invalidateLastGoodOutsideProviderDisplay(state, providerDisplayTestDeps(pair))
	if !state.hasLastGood {
		t.Fatalf("Two at once dropped its own last-good frame")
	}

	// Switching to One provider makes the pair frame one VibeTV must not resend.
	fixed := runtimeconfig.ProviderDisplayConfig{Mode: "fixed", ProviderIDs: []string{"claude"}}
	deps := providerDisplayTestDeps(fixed)
	deps.logf = func(string, ...any) {}
	invalidateLastGoodOutsideProviderDisplay(state, deps)
	if state.hasLastGood {
		t.Fatalf("One provider kept the pair's last-good frame")
	}
}

// Two at once with one member that delivers nothing current: the selection
// sees only the other one, so VibeTV shows it alone instead of the error the
// unavailable member would bring.
func TestProviderDisplayPairSelectsOnlyTheCurrentMember(t *testing.T) {
	pair := runtimeconfig.ProviderDisplayConfig{Mode: "pair", ProviderIDs: []string{"claude", "codex"}}
	claude := testParsedFrame("claude", 1, 2, 60)
	claude.Frame.UsageUnavailable = true
	codex := testParsedFrame("codex", 3, 4, 60)
	stale := testParsedFrame("claude", 5, 6, 60)
	stale.Stale = true
	for _, other := range []codexbar.ParsedFrame{claude, stale} {
		state := &runtimeState{selector: codexbar.NewProviderSelector()}
		got := applyProviderDisplaySelection(state, []codexbar.ParsedFrame{other, codex}, providerDisplayTestDeps(pair), nil)
		if len(got) != 1 || got[0].Frame.Provider != "codex" {
			t.Fatalf("pair selection=%+v want only codex", got)
		}
	}
}

// While collection fails VibeTV resends the last good frame. A limit or the
// reserve or deficit hidden since must leave it at once, not after recovery.
func TestCachedFrameDropsWhatWasHiddenSince(t *testing.T) {
	basis := time.Date(2026, 10, 9, 12, 0, 0, 0, time.UTC)
	claude := displayLimitsClaude(basis)
	codex := displayLimitsCodex(basis)
	shown := &runtimeconfig.ProviderDisplayConfig{Mode: "pair", ProviderIDs: []string{"claude", "codex"}}
	cached := applyDisplayLimits(claude.Frame, []codexbar.ParsedFrame{claude, codex}, shown, basis)
	if len(cached.UsageWindows) != 2 || cached.UsageWindows[0].ID != "claude:session" {
		t.Fatalf("pair frame before the change: %+v", cached.UsageWindows)
	}

	hidden := &runtimeconfig.ProviderDisplayConfig{
		Mode:          "pair",
		ProviderIDs:   []string{"claude", "codex"},
		HiddenWindows: map[string][]string{"claude": {"session"}},
		HidePace:      true,
	}
	got := limitCachedFrame(cached, hidden)
	if len(got.UsageWindows) != 1 || got.UsageWindows[0].ID != "codex:weekly" || got.UsageWindows[0].Pace != (protocol.UsagePace{}) {
		t.Fatalf("pair frame after hiding Claude Session and the pace: %+v", got.UsageWindows)
	}
	if got.ResetSource != usageWindowResetSource("codex", "weekly") {
		t.Fatalf("pair reset source=%q", got.ResetSource)
	}
	if got := limitCachedFrame(cached, shown); len(got.UsageWindows) != 2 || got.UsageWindows[1].Pace.State != "reserve" {
		t.Fatalf("an unchanged choice changed the cached pair: %+v", got.UsageWindows)
	}

	one := &runtimeconfig.ProviderDisplayConfig{Mode: "fixed", ProviderIDs: []string{"claude"}, HiddenWindows: map[string][]string{"claude": {"session"}}}
	got = limitCachedFrame(claude.Frame, one)
	if len(got.UsageWindows) != 2 || got.UsageWindows[0].ID != "weekly" || got.UsageWindows[0].Pace.State != "deficit" {
		t.Fatalf("one provider after hiding Session: %+v", got.UsageWindows)
	}

	// "claude:claude-weekly-scoped-fable" is cut to 32 bytes on the wire, and
	// the cached frame keeps the cut id.
	fableShown := &runtimeconfig.ProviderDisplayConfig{
		Mode:          "pair",
		ProviderIDs:   []string{"claude", "codex"},
		HiddenWindows: map[string][]string{"claude": {"session", "weekly"}},
	}
	cachedFable := applyDisplayLimits(claude.Frame, []codexbar.ParsedFrame{claude, codex}, fableShown, basis).Normalize()
	if len(cachedFable.UsageWindows) != 2 || cachedFable.UsageWindows[0].ID != "claude:claude-weekly-scoped-fabl" {
		t.Fatalf("cached pair with Fable only: %+v", cachedFable.UsageWindows)
	}
	fableHidden := &runtimeconfig.ProviderDisplayConfig{
		Mode:          "pair",
		ProviderIDs:   []string{"claude", "codex"},
		HiddenWindows: map[string][]string{"claude": {"claude-weekly-scoped-fable"}},
	}
	got = limitCachedFrame(cachedFable, fableHidden)
	if len(got.UsageWindows) != 1 || got.UsageWindows[0].ID != "codex:weekly" {
		t.Fatalf("cached pair after hiding Fable only: %+v", got.UsageWindows)
	}

	// Both cached limits replaced: the frame has nothing chosen left to show.
	bothReplaced := &runtimeconfig.ProviderDisplayConfig{
		Mode:          "pair",
		ProviderIDs:   []string{"claude", "codex"},
		HiddenWindows: map[string][]string{"claude": {"session"}, "codex": {"weekly"}},
	}
	got = limitCachedFrame(cached, bothReplaced)
	if !got.UsageUnavailable || len(got.UsageWindows) != 0 || got.Session != 0 || got.Weekly != 0 {
		t.Fatalf("cached pair with both limits hidden still shows usage: %+v", got)
	}
}

func TestRunCycleWithDepsFallbackFollowsLimitsHiddenSince(t *testing.T) {
	prepareFastTestEnv(t)

	current := time.Date(2026, 10, 9, 12, 0, 0, 0, time.UTC)
	display := runtimeconfig.ProviderDisplayConfig{Mode: "fixed", ProviderIDs: []string{"claude"}}
	state := &runtimeState{selector: codexbar.NewProviderSelector()}
	lines := make([][]byte, 0, 2)
	deps := providerDisplayTestDeps(display)
	deps.loadConfig = func(string) (runtimeconfig.Config, error) {
		return runtimeconfig.Config{ProviderDisplay: &display}, nil
	}
	deps.now = func() time.Time { return current }
	deps.resolvePort = func(string) (string, error) { return "/dev/cu.usbmodem-test", nil }
	deps.deviceCaps = func(string) (protocol.DeviceCapabilities, error) {
		return protocol.DeviceCapabilities{Known: true, NegotiatedProtocolVersion: protocol.ProtocolVersionV2, MaxFrameBytes: 2048}, nil
	}
	deps.logf = func(string, ...any) {}
	deps.sendLine = func(port string, line []byte) error {
		lines = append(lines, append([]byte(nil), line...))
		return nil
	}
	deps.fetchProviders = func(context.Context) ([]codexbar.ParsedFrame, error) {
		return []codexbar.ParsedFrame{displayLimitsClaude(current)}, nil
	}
	if err := runCycleWithDeps(context.Background(), "", state, deps); err != nil {
		t.Fatalf("first cycle: %v", err)
	}

	display.HiddenWindows = map[string][]string{"claude": {"session"}}
	current = current.Add(time.Minute)
	deps.fetchProviders = func(context.Context) ([]codexbar.ParsedFrame, error) {
		return nil, &codexbar.FetchError{Kind: codexbar.FetchErrorCommand, Err: errors.New("transient failure")}
	}
	if err := runCycleWithDeps(context.Background(), "", state, deps); err != nil {
		t.Fatalf("fallback cycle: %v", err)
	}
	if len(lines) != 2 {
		t.Fatalf("sent %d frames, want 2", len(lines))
	}
	first, second := decodeFrameLine(t, lines[0]), decodeFrameLine(t, lines[1])
	if len(first.UsageWindows) == 0 || first.UsageWindows[0].ID != "session" {
		t.Fatalf("first frame windows: %+v", first.UsageWindows)
	}
	for _, window := range second.UsageWindows {
		if window.ID == "session" {
			t.Fatalf("the fallback frame still shows the hidden Session: %+v", second.UsageWindows)
		}
	}
	if len(second.UsageWindows) == 0 {
		t.Fatalf("the fallback frame lost every window: %+v", second)
	}
}
