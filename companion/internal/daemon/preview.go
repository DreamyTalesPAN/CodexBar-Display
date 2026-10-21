package daemon

import (
	"slices"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimeconfig"
)

// ProviderPreview is the frame the host would send for one provider: in
// Automatic, where every provider feeds the cross-provider rows, and pinned in
// Manual, where only that provider does. Automatic is nil for a provider the
// stream does not show in its rotation. A provider without usage gets the
// host's unavailable frame when pinned, with no values and no countdown; a
// retained reading keeps its values under offline reset trust.
type ProviderPreview struct {
	Provider  string
	Automatic *protocol.Frame
	Pinned    protocol.Frame
}

// PreviewFrames builds, for every provider of usage, in that order, the frame
// the stream would send for it right now. Automatic is the stream's own
// selection (selectCycleFrameFromProviders, restateLastGoodWhenNotFresh) run
// with the rotation on that provider and the persisted last-good frame the
// runtime bootstraps, so what it returns is what the stream sends: the
// provider's rows, the restated last-good frame, or the error frame. The
// device fields and wire-budget trimming use the same steps as sending.
func PreviewFrames(usage PersistedUsage, showUsed, systemBusy bool, caps protocol.DeviceCapabilities, now time.Time) []ProviderPreview {
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
	deps := runtimeDeps{
		homeDir: func() (string, error) { return "preview", nil },
		loadConfig: func(string) (runtimeconfig.Config, error) {
			return runtimeconfig.Config{ProviderDisplay: &runtimeconfig.ProviderDisplayConfig{Mode: "automatic"}, DisplayRotateSeconds: 3600}, nil
		},
		logf:              func(string, ...any) {},
		now:               func() time.Time { return now },
		usageBarsShowUsed: func() bool { return showUsed },
	}
	previews := make([]ProviderPreview, 0, len(providers))
	for _, shown := range providers {
		preview := ProviderPreview{
			Provider: shown.Provider,
			Pinned:   previewPinnedFrame(shown, deps, systemBusy, caps, now),
		}
		// A fresh stream per rotation position: the timer sits on this
		// provider, the rest is the runtime's own start.
		state := &runtimeState{selector: codexbar.NewProviderSelector(), rotationProvider: normalizeProviderKey(shown.Frame.Provider), rotationAt: now}
		bootstrapStateFromPersistedLastGood(state, now, deps)
		// The slice is copied: selection and restating work on it in place.
		result := selectCycleFrameFromProviders(state, slices.Clone(providers), now, deps, nil, "select-provider", "", "", "")
		result.systemBusy = systemBusy
		_, frame, result := restateLastGoodWhenNotFresh(state, deps, result)
		if frame.Error != "" || normalizeProviderKey(frame.Provider) == normalizeProviderKey(shown.Frame.Provider) {
			frame = previewFrameWithinLimit(frame, result, caps, now)
			preview.Automatic = &frame
		}
		previews = append(previews, preview)
	}
	return previews
}

func previewPinnedFrame(shown codexbar.ParsedFrame, deps runtimeDeps, systemBusy bool, caps protocol.DeviceCapabilities, now time.Time) protocol.Frame {
	deps.loadConfig = func(string) (runtimeconfig.Config, error) {
		return runtimeconfig.Config{ProviderDisplay: &runtimeconfig.ProviderDisplayConfig{Mode: "fixed", ProviderIDs: []string{shown.Provider}}}, nil
	}
	state := &runtimeState{selector: codexbar.NewProviderSelector()}
	bootstrapStateFromPersistedLastGood(state, now, deps)
	result := selectCycleFrameFromProviders(state, []codexbar.ParsedFrame{shown}, now, deps, nil, "select-provider", "", "", "")
	result.systemBusy = systemBusy
	_, frame, result := restateLastGoodWhenNotFresh(state, deps, result)
	return previewFrameWithinLimit(frame, result, caps, now)
}

// A frame that cannot be encoded stays visibly unavailable in the preview.
func previewFrameWithinLimit(frame protocol.Frame, result cycleResult, caps protocol.DeviceCapabilities, now time.Time) protocol.Frame {
	frame, _ = prepareDeviceFrame(frame, result, caps, now, configuredTheme(""), activityTTL(0, caps.ConnectionMode))
	_, frame, err := marshalFrameWithinLimit(frame, maxFrameBytesForCaps(caps))
	if err != nil {
		return protocol.ErrorFrame(runtimeErrorFrameCode(runtimeErrorFrameTooLarge))
	}
	return frame
}
