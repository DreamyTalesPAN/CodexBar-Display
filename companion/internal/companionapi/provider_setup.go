package companionapi

import (
	"context"
	"net/http"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar"
)

const providerSetupCacheTTL = 30 * time.Second

type providerSetupResponse struct {
	OK            bool                   `json:"ok"`
	ProviderSetup codexbar.ProviderSetup `json:"providerSetup"`
}

// currentProviderSetup caches normal status polling and serializes explicit
// retries. A second concurrent retry reuses the first result instead of
// starting another CodexBar/browser probe.
func (s *Server) currentProviderSetup(ctx context.Context, force bool) codexbar.ProviderSetup {
	s.providerSetupMu.Lock()
	defer s.providerSetupMu.Unlock()
	if !s.providerSetupCachedAt.IsZero() {
		age := s.currentTime().Sub(s.providerSetupCachedAt)
		if age >= 0 && (age < providerSetupCacheTTL && !force || age < time.Second) {
			return s.providerSetupCache
		}
	}
	probe := s.probeProviderSetup
	if probe == nil {
		probe = codexbar.ProbeProviderSetup
	}
	setup := probe(ctx, s.home)
	s.providerSetupCache = setup
	s.providerSetupCachedAt = s.currentTime()
	return setup
}

// providerSetupForStatus keeps the general status endpoint responsive while a
// CodexBar usage probe is cold or slow. Device connection and pairing state
// must not wait for unrelated provider dashboard requests.
func (s *Server) providerSetupForStatus() codexbar.ProviderSetup {
	if !s.providerSetupMu.TryLock() {
		return checkingProviderSetup(s.currentTime())
	}
	cached := s.providerSetupCache
	cachedAt := s.providerSetupCachedAt
	s.providerSetupMu.Unlock()

	if !cachedAt.IsZero() {
		age := s.currentTime().Sub(cachedAt)
		if age >= 0 && age < providerSetupCacheTTL {
			return cached
		}
	}

	if s.providerSetupRefresh.CompareAndSwap(false, true) {
		go func() {
			defer s.providerSetupRefresh.Store(false)
			ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
			defer cancel()
			_ = s.currentProviderSetup(ctx, false)
		}()
	}
	if !cachedAt.IsZero() {
		return cached
	}
	return checkingProviderSetup(s.currentTime())
}

func checkingProviderSetup(now time.Time) codexbar.ProviderSetup {
	return codexbar.ProviderSetup{
		Status:    "checking",
		CheckedAt: now.UTC().Format(time.RFC3339Nano),
	}
}

func (s *Server) handleProviderRetry(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
	defer cancel()
	setup := s.currentProviderSetup(ctx, true)
	if setup.Status == codexbar.ProviderReady && s.wakeDisplayStream != nil {
		s.wakeDisplayStream()
	}
	writeJSON(w, http.StatusOK, providerSetupResponse{OK: true, ProviderSetup: setup})
}

func (s *Server) handleOpenCodexBar(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}
	openApp := s.openCodexBar
	if openApp == nil {
		openApp = codexbar.OpenApp
	}
	if err := openApp(r.Context()); err != nil {
		writeError(w, http.StatusServiceUnavailable, "codexbar_open_failed", "CodexBar could not be opened.", "Open CodexBar from Applications, then check again.")
		return
	}
	writeJSON(w, http.StatusOK, providerSetupResponse{
		OK:            true,
		ProviderSetup: s.currentProviderSetup(r.Context(), false),
	})
}

func providerDiagnosticCheck(setup codexbar.ProviderSetup) diagnosticCheck {
	if setup.Status == codexbar.ProviderReady {
		return diagnosticCheck{Name: "provider_setup", Status: "pass", Detail: "An AI provider is delivering usage data."}
	}
	check := diagnosticCheck{
		Name:       "provider_setup",
		Status:     "attention",
		Detail:     "No AI provider is delivering usage data yet.",
		ErrorCode:  "provider_setup_required",
		NextAction: "Open CodexBar, connect a provider, then click Check again.",
	}
	if len(setup.Providers) > 0 {
		provider := setup.Providers[0]
		check.Detail = provider.Detail
		if provider.NextAction != "" {
			check.NextAction = provider.NextAction
		}
		if provider.Status != "" {
			check.ErrorCode = provider.Status
		}
	}
	return check
}
