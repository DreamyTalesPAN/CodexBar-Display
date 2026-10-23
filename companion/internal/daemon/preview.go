package daemon

import (
	"os"
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
	Pairs     map[string]protocol.Frame
}

// PreviewFrames builds, for every provider of usage, in that order, the frame
// the stream would send for it right now. Automatic is the stream's own
// selection (selectCycleFrameFromProviders, restateLastGoodWhenNotFresh) run
// with the rotation on that provider and the persisted last-good frame the
// runtime bootstraps, so what it returns is what the stream sends: the
// provider's rows, the restated last-good frame, or the error frame. The
// device fields and wire-budget trimming use the same steps as sending.
// hiddenWindows, when set, stands in for the stored limits: the customer's
// unsaved choice, shown the way saving it would show it.
func PreviewFrames(usage PersistedUsage, showUsed, systemBusy bool, caps protocol.DeviceCapabilities, now time.Time, updates *FirmwareUpdateCache, cliTheme string, inventory []codexbar.ProviderSetting, hiddenWindows map[string][]string, singleProviderTheme bool) []ProviderPreview {
	_, enabledProviders := enabledProviderInventory(inventory)
	providerEnabled := func(provider string) (bool, bool) {
		_, enabled := enabledProviders[normalizeProviderKey(provider)]
		return enabled, len(inventory) > 0
	}
	theme := configuredTheme(cliTheme)
	var update *protocol.UpdateState
	if cached := updates.snapshot(caps); cached != nil {
		cachedUpdate := cached.update
		update = &cachedUpdate
	}
	providers := make([]codexbar.ParsedFrame, 0, len(usage.Providers))
	for _, snapshot := range usage.Providers {
		providers = append(providers, codexbar.ParsedFrame{
			Frame:       snapshot.Frame,
			Provider:    snapshot.Provider,
			Source:      snapshot.Source,
			Meta:        snapshot.Meta,
			CollectedAt: snapshot.CollectedAt,
			Stale:       snapshot.Stale,
			Terminal:    snapshot.Terminal,
		})
	}
	var cfg runtimeconfig.Config
	if home, err := os.UserHomeDir(); err == nil {
		cfg, _ = runtimeconfig.Load(home)
	}
	display := runtimeconfig.ProviderDisplayConfig{}
	if cfg.ProviderDisplay != nil {
		display = *cfg.ProviderDisplay
	}
	display.Mode, display.ProviderIDs = "automatic", nil
	if hiddenWindows != nil {
		display.HiddenWindows = runtimeconfig.NormalizeHiddenWindows(hiddenWindows)
	}
	cfg.ProviderDisplay = &display
	cfg.DisplayRotateSeconds = 3600
	deps := runtimeDeps{
		singleProviderTheme: func() bool { return singleProviderTheme },
		homeDir:             func() (string, error) { return "preview", nil },
		loadConfig: func(string) (runtimeconfig.Config, error) {
			return cfg, nil
		},
		logf:              func(string, ...any) {},
		now:               func() time.Time { return now },
		usageBarsShowUsed: func() bool { return showUsed },
	}
	previews := make([]ProviderPreview, 0, len(providers))
	for _, shown := range providers {
		preview := ProviderPreview{
			Provider: shown.Provider,
			Pinned:   previewSelectedFrame([]string{shown.Provider}, providers, deps, systemBusy, caps, now, update, theme, providerEnabled),
		}
		preview.Pairs = make(map[string]protocol.Frame)
		for _, other := range providers {
			if other.Provider != shown.Provider {
				preview.Pairs[other.Provider] = previewSelectedFrame([]string{shown.Provider, other.Provider}, providers, deps, systemBusy, caps, now, update, theme, providerEnabled)
			}
		}
		// A fresh stream per rotation position: the timer sits on this
		// provider, the rest is the runtime's own start.
		state := &runtimeState{selector: codexbar.NewProviderSelector(), rotationProvider: normalizeProviderKey(shown.Frame.Provider), rotationAt: now}
		bootstrapStateFromPersistedLastGood(state, now, deps)
		discardLastGoodDisabledByInventory(state, providerEnabled)
		discardLastGoodTerminal(state, providers)
		// The slice is copied: selection and restating work on it in place.
		result := selectCycleFrameFromProviders(state, slices.Clone(providers), now, deps, nil, "select-provider", "", "", "")
		result.frame.Update = update
		result.systemBusy = systemBusy
		_, frame, result := restateLastGoodWhenNotFresh(state, deps, result)
		// A provider-less stream error is one stationary surface, not a rotation.
		if (frame.Error != "" && len(previews) == 0) || (frame.Error == "" && normalizeProviderKey(frame.Provider) == normalizeProviderKey(shown.Frame.Provider)) {
			frame = previewFrameWithinLimit(frame, result, caps, now, theme)
			preview.Automatic = &frame
		}
		previews = append(previews, preview)
	}
	return previews
}

func previewSelectedFrame(ids []string, providers []codexbar.ParsedFrame, deps runtimeDeps, systemBusy bool, caps protocol.DeviceCapabilities, now time.Time, update *protocol.UpdateState, theme string, providerEnabled func(string) (bool, bool)) protocol.Frame {
	cfg, _ := loadRuntimeConfig(deps)
	display := *cfg.ProviderDisplay
	display.Mode, display.ProviderIDs = "fixed", ids
	if len(ids) == 2 {
		display.Mode = "pair"
	}
	cfg.ProviderDisplay = &display
	deps.loadConfig = func(string) (runtimeconfig.Config, error) {
		return cfg, nil
	}
	state := &runtimeState{selector: codexbar.NewProviderSelector()}
	bootstrapStateFromPersistedLastGood(state, now, deps)
	discardLastGoodDisabledByInventory(state, providerEnabled)
	discardLastGoodTerminal(state, providers)
	result := selectCycleFrameFromProviders(state, slices.Clone(providers), now, deps, nil, "select-provider", "", "", "")
	result.frame.Update = update
	result.systemBusy = systemBusy
	_, frame, result := restateLastGoodWhenNotFresh(state, deps, result)
	return previewFrameWithinLimit(frame, result, caps, now, theme)
}

// A frame that cannot be encoded stays visibly unavailable in the preview.
func previewFrameWithinLimit(frame protocol.Frame, result cycleResult, caps protocol.DeviceCapabilities, now time.Time, theme string) protocol.Frame {
	frame, _ = prepareDeviceFrame(frame, result, caps, now, theme, activityTTL(0, caps.ConnectionMode))
	_, frame, err := marshalFrameWithinLimit(frame, maxFrameBytesForCaps(caps))
	if err != nil {
		return protocol.ErrorFrame(runtimeErrorFrameCode(runtimeErrorFrameTooLarge))
	}
	return frame
}
