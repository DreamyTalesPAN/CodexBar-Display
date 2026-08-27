package daemon

import (
	"testing"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
)

func providerFrameWithWindows(provider string, collectedAt time.Time, windows ...protocol.UsageWindow) codexbar.ParsedFrame {
	frame := testParsedFrame(provider, 10, 20, 0)
	frame.CollectedAt = collectedAt
	frame.Frame.UsageWindows = windows
	return frame
}

func TestProviderResetSlotsPickSoonestResetPerProvider(t *testing.T) {
	basis := time.Date(2026, 8, 13, 12, 0, 0, 0, time.UTC)
	providers := []codexbar.ParsedFrame{
		providerFrameWithWindows("claude", basis,
			protocol.UsageWindow{ID: "session", Label: "Session", Percent: 40, ResetSec: 7200},
			protocol.UsageWindow{ID: "weekly", Label: "Weekly", Percent: 12, ResetSec: 3600},
		),
		providerFrameWithWindows("codex", basis,
			protocol.UsageWindow{ID: "weekly", Label: "Weekly", Percent: 4, ResetSec: 9000},
		),
	}

	slots := providerResetSlots(providers, basis)
	if len(slots) != 2 {
		t.Fatalf("expected 2 provider slots, got %d", len(slots))
	}
	if slots[0].Label != "claude" || slots[0].ResetSec != 3600 {
		t.Fatalf("claude slot must carry its soonest reset: %+v", slots[0])
	}
	if slots[0].Percent != 40 {
		t.Fatalf("claude slot must carry its highest window percent: %+v", slots[0])
	}
	if slots[1].Label != "codex" || slots[1].ResetSec != 9000 {
		t.Fatalf("codex slot mismatch: %+v", slots[1])
	}
}

func TestProviderResetSlotsReanchorOlderSnapshotsToTheSelectedBasis(t *testing.T) {
	basis := time.Date(2026, 8, 13, 12, 0, 0, 0, time.UTC)
	providers := []codexbar.ParsedFrame{
		// Collected five minutes before the selected frame's basis: by basis
		// time the countdown has already burned 300 seconds.
		providerFrameWithWindows("codex", basis.Add(-5*time.Minute),
			protocol.UsageWindow{ID: "weekly", Label: "Weekly", Percent: 4, ResetSec: 3600},
		),
	}

	slots := providerResetSlots(providers, basis)
	if len(slots) != 1 {
		t.Fatalf("expected 1 provider slot, got %d", len(slots))
	}
	if slots[0].ResetSec != 3300 {
		t.Fatalf("expected re-anchored reset of 3300s, got %d", slots[0].ResetSec)
	}
}

func TestProviderResetSlotsExcludeStaleUnavailableAndCountdownFreeProviders(t *testing.T) {
	basis := time.Date(2026, 8, 13, 12, 0, 0, 0, time.UTC)
	stale := providerFrameWithWindows("stale", basis,
		protocol.UsageWindow{ID: "session", Label: "Session", Percent: 10, ResetSec: 600},
	)
	stale.Stale = true
	unavailable := providerFrameWithWindows("unavailable", basis,
		protocol.UsageWindow{ID: "session", Label: "Session", Percent: 10, ResetSec: 600},
	)
	unavailable.Frame.UsageUnavailable = true
	noCountdown := providerFrameWithWindows("idle", basis,
		protocol.UsageWindow{ID: "session", Label: "Session", Percent: 10, ResetSec: 0},
	)
	live := providerFrameWithWindows("claude", basis,
		protocol.UsageWindow{ID: "session", Label: "Session", Percent: 10, ResetSec: 600},
	)

	slots := providerResetSlots([]codexbar.ParsedFrame{stale, unavailable, noCountdown, live}, basis)
	if len(slots) != 1 || slots[0].Label != "claude" {
		t.Fatalf("only the live provider with a countdown may appear: %+v", slots)
	}
}

func TestProviderResetSlotsCapAtTheWireLimit(t *testing.T) {
	basis := time.Date(2026, 8, 13, 12, 0, 0, 0, time.UTC)
	var providers []codexbar.ParsedFrame
	for _, name := range []string{"one", "two", "three"} {
		providers = append(providers, providerFrameWithWindows(name, basis,
			protocol.UsageWindow{ID: "session", Label: "Session", Percent: 10, ResetSec: 600},
		))
	}

	slots := providerResetSlots(providers, basis)
	if len(slots) != protocol.MaxProviderSlots {
		t.Fatalf("expected the %d-slot wire cap, got %d", protocol.MaxProviderSlots, len(slots))
	}
}

func TestNormalizeDropsProviderSlotsForLegacyProtocol(t *testing.T) {
	frame := protocol.Frame{
		V: 1,
		ProviderSlots: []protocol.UsageSlot{
			{ID: "claude", Label: "Claude", ResetSec: 600},
		},
	}
	if got := frame.Normalize().ProviderSlots; got != nil {
		t.Fatalf("v1 frames must not carry provider slots, got %+v", got)
	}

	frame.V = protocol.ProtocolVersionV2
	if got := frame.Normalize().ProviderSlots; len(got) != 1 {
		t.Fatalf("v2 frames keep provider slots, got %+v", got)
	}
}
