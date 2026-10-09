package daemon

import (
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
