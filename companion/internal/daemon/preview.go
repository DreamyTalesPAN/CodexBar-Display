package daemon

import (
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
)

// ProviderPreview is the frame the host would send for one provider: in
// Automatic, where every provider feeds the cross-provider rows, and pinned in
// Manual, where only that provider does. A provider without current usage gets
// the host's unavailable frame, with no values and no countdown.
type ProviderPreview struct {
	Provider  string
	Automatic protocol.Frame
	Pinned    protocol.Frame
}

// PreviewFrames builds, for every provider of usage, in that order, the frame
// the stream would send for it right now, with the same row, bars and
// reset-trust steps as the stream (selectCycleFrameFromProviders,
// sendCycleResult). The device-specific steps (protocol version, clock, theme,
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
			Stale:       snapshot.Stale || snapshot.Frame.UsageUnavailable,
		})
	}
	previews := make([]ProviderPreview, 0, len(providers))
	for _, shown := range providers {
		previews = append(previews, ProviderPreview{
			Provider:  shown.Provider,
			Automatic: previewFrame(shown, providers, showUsed, now),
			Pinned:    previewFrame(shown, []codexbar.ParsedFrame{shown}, showUsed, now),
		})
	}
	return previews
}

func previewFrame(shown codexbar.ParsedFrame, rowProviders []codexbar.ParsedFrame, showUsed bool, now time.Time) protocol.Frame {
	collectedAt := shown.CollectedAt
	if collectedAt.IsZero() {
		collectedAt = now
	}
	frame := shown.Frame
	if shown.Stale {
		frame = snapshotWithUsageCleared(providerSnapshot{Frame: frame}).Frame
	}
	frame.V = protocol.ProtocolVersionV2
	frame.ProviderSlots = providerResetSlots(rowProviders, collectedAt)
	frame = applyUsageBarsPreference(frame.Normalize(), showUsed).ApplyResetTrust(collectedAt, now, !shown.Stale)
	return frame
}
