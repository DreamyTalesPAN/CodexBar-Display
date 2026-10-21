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
// in Automatic and when pinned in Manual; absent when that provider has no
// current usage.
type previewFramesForItem struct {
	ID        string          `json:"id"`
	Automatic *protocol.Frame `json:"automatic,omitempty"`
	Pinned    *protocol.Frame `json:"pinned,omitempty"`
}

// handleDisplayPreviewFrames gives the setup tiles the frames the stream would
// send, built by the daemon's own frame code from the persisted usage, so the
// app draws them without rebuilding any host logic.
func (s *Server) handleDisplayPreviewFrames(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}

	now := s.currentTime()
	resp := previewFramesResponse{OK: true, GeneratedAt: now.UTC().Format(time.RFC3339Nano), Providers: []previewFramesForItem{}}
	if s.loadUsage != nil {
		if usage, ok := s.loadUsage(now); ok {
			usage = usageForEnabledProviders(usage, s.providerInventoryForUsage(r.Context()))
			for _, preview := range daemon.PreviewFrames(usage, codexbar.UsageBarsShowUsed(), now) {
				resp.Providers = append(resp.Providers, previewFramesForItem{ID: preview.Provider, Automatic: preview.Automatic, Pinned: preview.Pinned})
			}
		}
	}
	writeJSON(w, http.StatusOK, resp)
}
