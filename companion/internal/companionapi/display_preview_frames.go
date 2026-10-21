package companionapi

import (
	"net/http"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/daemon"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
)

type previewFramesResponse struct {
	OK          bool                   `json:"ok"`
	GeneratedAt string                 `json:"generatedAt"`
	Providers   []previewFramesForItem `json:"providers"`
}

// previewFramesForItem carries one provider's frame as the host would send it
// in Automatic (absent for one the stream does not rotate to) and when pinned in Manual.
type previewFramesForItem struct {
	ID        string         `json:"id"`
	Automatic *protocol.Frame `json:"automatic,omitempty"`
	Pinned    protocol.Frame `json:"pinned"`
}

// handleDisplayPreviewFrames gives the setup tiles the frames the stream would
// send, built by the daemon's own frame code from the persisted usage, so the
// app draws them without rebuilding any host logic. Providers come in
// CodexBar's order; one without a reading yet gets the host's unavailable frame,
// and has no Automatic frame while another provider has a current reading.
func (s *Server) handleDisplayPreviewFrames(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}

	now := s.currentTime()
	resp := previewFramesResponse{OK: true, GeneratedAt: now.UTC().Format(time.RFC3339Nano), Providers: []previewFramesForItem{}}
	if s.loadUsage != nil {
		if usage, ok := s.loadUsage(now); ok {
			usage = usageInInventoryOrder(usage, s.providerInventoryForUsage(r.Context()))
			for _, preview := range daemon.PreviewFrames(usage, codexbar.UsageBarsShowUsed(), now) {
				resp.Providers = append(resp.Providers, previewFramesForItem{ID: preview.Provider, Automatic: preview.Automatic, Pinned: preview.Pinned})
			}
		}
	}
	writeJSON(w, http.StatusOK, resp)
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
