package daemon

import (
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
)

// ProviderPreview is the frame the host would send for one provider: in
// Automatic, where every provider feeds the cross-provider rows, and pinned in
// Manual, where only that provider does. Automatic is nil for a provider the
// stream never shows there: the stream drops stale and unavailable providers
// while any other has a current reading (preferAvailableProviders). A provider
// without usage gets the host's unavailable frame, with no values and no
// countdown; a retained reading keeps its values under offline reset trust.
type ProviderPreview struct {
	Provider  string
	Automatic *protocol.Frame
	Pinned    protocol.Frame
}

// PreviewFrames builds, for every provider of usage, in that order, the frame
// the stream would send for it right now, with the same row, bars and
// reset-trust steps as the stream (selectCycleFrameFromProviders,
// sendCycleResult). A retained reading goes out as the stream sends it without
// a last-good frame; the stream's own last-good frame is per-device state that
// the retained snapshot stands in for. The device-specific steps (protocol version, clock, theme,
// wire budget) are left out.
func PreviewFrames(usage PersistedUsage, showUsed bool, now time.Time) []ProviderPreview {
	providers := make([]codexbar.ParsedFrame, 0, len(usage.Providers))
	for _, snapshot := range usage.Providers {
		providers = append(providers, codexbar.ParsedFrame{
			Frame:       snapshot.Frame,
			Provider:    snapshot.Provider,
			Source:      snapshot.Source,
			Meta:        snapshot.Meta,
			CollectedAt: snapshot.CollectedAt,
			Stale:       snapshot.Stale,
		})
	}
	automaticSet := preferAvailableProviders(providers)
	inAutomatic := make(map[string]bool, len(automaticSet))
	for _, shown := range automaticSet {
		inAutomatic[shown.Provider] = true
	}
	previews := make([]ProviderPreview, 0, len(providers))
	for _, shown := range providers {
		preview := ProviderPreview{
			Provider: shown.Provider,
			Pinned:   previewFrame(shown, []codexbar.ParsedFrame{shown}, showUsed, now),
		}
		if inAutomatic[shown.Provider] {
			automatic := previewFrame(shown, automaticSet, showUsed, now)
			preview.Automatic = &automatic
		}
		previews = append(previews, preview)
	}
	return previews
}

func previewFrame(shown codexbar.ParsedFrame, rowProviders []codexbar.ParsedFrame, showUsed bool, now time.Time) protocol.Frame {
	collectedAt := shown.CollectedAt
	if collectedAt.IsZero() {
		collectedAt = now
	}
	frame := shown.Frame
	if shown.Frame.UsageUnavailable {
		frame = snapshotWithUsageCleared(providerSnapshot{Frame: frame}).Frame
	}
	frame.V = protocol.ProtocolVersionV2
	frame.ProviderSlots = providerResetSlots(rowProviders, collectedAt)
	frame = applyUsageBarsPreference(frame.Normalize(), showUsed).ApplyResetTrust(collectedAt, now, !shown.Stale && !shown.Frame.UsageUnavailable)
	return frame
}
