package daemon

import (
	"context"
	"testing"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimeconfig"
)

func TestFixedSelectionRetainsSentProviderSlotsDuringCollectionFailure(t *testing.T) {
	for _, pinned := range []string{"one", "three"} {
		t.Run(pinned, func(t *testing.T) {
			prepareFastTestEnv(t)
			basis := time.Date(2026, 10, 21, 12, 0, 0, 0, time.UTC)
			var providers []codexbar.ParsedFrame
			for _, id := range []string{"one", "two", "three"} {
				reading := providerFrameWithWindows(id, basis,
					protocol.UsageWindow{ID: "session", Label: "Session", Percent: 40, ResetSec: 600})
				reading.Frame.V = protocol.ProtocolVersionV2
				providers = append(providers, reading)
			}
			// Automatic sent the pinned provider with its first two cross-provider
			// rows. The third provider has no own row in that sent frame.
			lastGood := providers[0].Frame
			if pinned == "three" {
				lastGood = providers[2].Frame
			}
			lastGood.ProviderSlots = providerResetSlots(providers, basis)
			for i := range providers {
				providers[i].Stale = true
			}
			state := &runtimeState{selector: codexbar.NewProviderSelector(),
				lastGood: lastGood, lastGoodAt: basis, hasLastGood: true}
			deps := providerDisplayTestDeps(runtimeconfig.ProviderDisplayConfig{
				Mode: "fixed", ProviderIDs: []string{pinned},
			})
			home := t.TempDir()
			deps.homeDir = func() (string, error) { return home, nil }
			deps.now = func() time.Time { return basis.Add(time.Minute) }
			deps.usageBarsShowUsed = func() bool { return true }
			deps.logf = func(string, ...any) {}
			var sent protocol.Frame
			deps.sendLine = func(_ string, line []byte) error {
				sent = decodeFrameLine(t, line)
				return nil
			}
			deps = deps.withDefaults()
			selected := selectCycleFrameFromProviders(state, providers, deps.now(), deps, nil, "select-provider", "", "", "codexbar")
			if selected.usageFresh || len(selected.frame.ProviderSlots) != 0 {
				t.Fatalf("fixed selection must exclude stale provider rows: %+v", selected)
			}
			caps := protocol.DeviceCapabilities{NegotiatedProtocolVersion: protocol.ProtocolVersionV2,
				SupportsProviderSlotsV1: true, MaxUsageWindows: 1}
			if err := sendCycleResult(context.Background(), "test-port", caps, 2048, state, deps, selected); err != nil {
				t.Fatal(err)
			}
			if sent.Provider != pinned || sent.ResetTrust != protocol.ResetTrustOffline || len(sent.ProviderSlots) != 2 {
				t.Fatalf("fixed stale send must restate the matching last-good frame: %+v", sent)
			}
			for i, slot := range sent.ProviderSlots {
				want := lastGood.ProviderSlots[i]
				want.ResetSec -= 60
				if slot != want {
					t.Fatalf("sent row %d = %+v, want retained %+v", i, slot, want)
				}
			}
		})
	}
}

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

	slots := providerResetSlots(providers, basis, nil)
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

	slots := providerResetSlots(providers, basis, nil)
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

	slots := providerResetSlots([]codexbar.ParsedFrame{stale, unavailable, noCountdown, live}, basis, nil)
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

	slots := providerResetSlots(providers, basis, nil)
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
