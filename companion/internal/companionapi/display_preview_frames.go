package companionapi

import (
	"strings"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/daemon"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimeconfig"
)

// previewFramesResponse carries the frames the stream would send, built by the
// daemon's own frame code from the same persisted usage a /v1/usage response is
// built from, so the app draws them without rebuilding any host logic.
type previewFramesResponse struct {
	GeneratedAt string                 `json:"generatedAt"`
	Providers   []previewFramesForItem `json:"providers"`
}

// previewFramesForItem carries one provider's frame as the host would send it
// in Automatic (absent for one the stream does not rotate to) and when pinned in Manual.
type previewFramesForItem struct {
	ID        string                    `json:"id"`
	Automatic *protocol.Frame           `json:"automatic,omitempty"`
	Pinned    protocol.Frame            `json:"pinned"`
	Pairs     map[string]protocol.Frame `json:"pairs,omitempty"`
}

// previewFramesFor lists providers in CodexBar's order; one without a reading
// yet gets the host's unavailable frame, and has no Automatic frame while
// another provider has a current reading.
func previewFramesFor(usage daemon.PersistedUsage, inventory []codexbar.ProviderSetting, showUsed, systemBusy bool, caps protocol.DeviceCapabilities, now time.Time, updates *daemon.FirmwareUpdateCache, cliTheme string, hiddenWindows map[string][]string) *previewFramesResponse {
	resp := &previewFramesResponse{GeneratedAt: now.UTC().Format(time.RFC3339Nano), Providers: []previewFramesForItem{}}
	usage = usageInInventoryOrder(usage, inventory)
	for _, preview := range daemon.PreviewFrames(usage, showUsed, systemBusy, caps, now.In(time.Local), updates, cliTheme, inventory, hiddenWindows) {
		resp.Providers = append(resp.Providers, previewFramesForItem{ID: preview.Provider, Automatic: preview.Automatic, Pinned: preview.Pinned, Pairs: preview.Pairs})
	}
	return resp
}

// usageInInventoryOrder lists the persisted usage of every enabled provider in
// CodexBar's order, with a no-reading snapshot for one that has none yet. Without
// an inventory the persisted usage stands as it is.
func usageInInventoryOrder(usage daemon.PersistedUsage, settings []codexbar.ProviderSetting) daemon.PersistedUsage {
	if len(settings) == 0 {
		return usage
	}
	byID := make(map[string]daemon.ProviderUsageSnapshot, len(usage.Providers))
	for _, snapshot := range usage.Providers {
		byID[usageProviderID(snapshot.Provider, snapshot.Frame.Provider)] = snapshot
	}
	usage.Providers = nil
	for _, setting := range settings {
		if !setting.Enabled {
			continue
		}
		snapshot, ok := byID[setting.ID]
		if !ok {
			snapshot = daemon.ProviderUsageSnapshot{
				Provider:  setting.ID,
				NoReading: true,
				Frame:     protocol.Frame{Provider: setting.ID, Label: setting.Label, UsageUnavailable: true},
			}
		}
		usage.Providers = append(usage.Providers, snapshot)
	}
	return usage
}

// Reuse the existing hello source for the selected device; no preview-owned
// capabilities cache. An unknown limit uses the sender's protocol default.
func (s *Server) previewDeviceCapabilities() protocol.DeviceCapabilities {
	fallback := protocol.UnknownDeviceCapabilities()
	fallback.MaxFrameBytes = protocol.DefaultMaxFrameBytes
	cfg, err := s.config()
	if err != nil {
		return fallback
	}
	var hello protocol.DeviceHello
	var ok bool
	if runtimeconfig.NormalizeConnectionMode(cfg.ConnectionMode) == "cable" {
		hello, ok = s.currentCableHello()
		ok = ok && cableHelloMatchesConfig(hello, cfg.DeviceID)
	} else if strings.TrimSpace(cfg.DeviceTarget) != "" {
		// An old hello still describes capabilities, not current reachability.
		// Usage polling must never wait for a network probe of an offline device.
		s.probeMu.Lock()
		cached, found := s.helloProbeCache[deviceProbeKey(cfg.DeviceTarget, cfg.DeviceToken)]
		s.probeMu.Unlock()
		hello = cached.hello
		ok = found && cached.err == nil && (cfg.DeviceID == "" || hello.DeviceID == cfg.DeviceID)
	}
	if ok {
		return protocol.CapabilitiesFromHello(hello)
	}
	return fallback
}
