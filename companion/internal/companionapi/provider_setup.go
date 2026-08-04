package companionapi

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar"
)

const providerSetupCacheTTL = 30 * time.Second

type providerSetupResponse struct {
	OK            bool                   `json:"ok"`
	ProviderSetup codexbar.ProviderSetup `json:"providerSetup"`
}

type exactProviderProbeFlight struct {
	done  chan struct{}
	setup codexbar.ProviderSetup
}

type providerReadinessRecord struct {
	Status     string
	Detail     string
	NextAction string
	CheckedAt  time.Time
	VerifiedAt time.Time
	Revision   uint64
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

func (s *Server) currentExactProviderSetup(ctx context.Context, providerID string) codexbar.ProviderSetup {
	s.exactProviderProbeMu.Lock()
	if s.exactProviderProbes == nil {
		s.exactProviderProbes = make(map[string]*exactProviderProbeFlight)
	}
	if current := s.exactProviderProbes[providerID]; current != nil {
		s.exactProviderProbeMu.Unlock()
		select {
		case <-current.done:
			return current.setup
		case <-ctx.Done():
			return timedOutExactProviderSetup(providerID, s.currentTime())
		}
	}
	flight := &exactProviderProbeFlight{done: make(chan struct{})}
	s.exactProviderProbes[providerID] = flight
	s.exactProviderProbeMu.Unlock()

	probe := s.probeExactProvider
	if probe == nil {
		probe = codexbar.ProbeProviderSetupForProvider
	}
	setup := probe(ctx, s.home, providerID)

	s.exactProviderProbeMu.Lock()
	flight.setup = setup
	close(flight.done)
	delete(s.exactProviderProbes, providerID)
	s.exactProviderProbeMu.Unlock()
	return setup
}

func timedOutExactProviderSetup(providerID string, now time.Time) codexbar.ProviderSetup {
	return codexbar.ProviderSetup{
		Status:    "setup_required",
		CheckedAt: now.UTC().Format(time.RFC3339Nano),
		Providers: []codexbar.ProviderReadiness{{
			ID:      providerID,
			Label:   providerID,
			Enabled: true,
			Status:  codexbar.ProviderTimeout,
		}},
	}
}

func (s *Server) handleProviderRetry(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
	defer cancel()
	providerID := strings.TrimSpace(strings.ToLower(r.URL.Query().Get("provider")))
	var setup codexbar.ProviderSetup
	if providerID == "" {
		setup = s.currentProviderSetup(ctx, true)
	} else {
		providerRevision := s.currentProviderRevision(providerID)
		setup = s.currentExactProviderSetup(ctx, providerID)
		s.recordExactProviderSetup(providerID, providerRevision, setup)
	}
	if setup.Status == codexbar.ProviderReady && s.wakeDisplayStream != nil {
		s.wakeDisplayStream()
	}
	writeJSON(w, http.StatusOK, providerSetupResponse{OK: true, ProviderSetup: setup})
}

func (s *Server) currentProviderRevision(providerID string) uint64 {
	s.providerPreferences.mu.Lock()
	defer s.providerPreferences.mu.Unlock()
	return s.providerPreferences.providerRev[providerID]
}

func (s *Server) recordExactProviderSetup(providerID string, providerRevision uint64, setup codexbar.ProviderSetup) {
	providerID = strings.TrimSpace(strings.ToLower(providerID))
	var exactReadiness *codexbar.ProviderReadiness
	for i := range setup.Providers {
		if strings.EqualFold(setup.Providers[i].ID, providerID) {
			exactReadiness = &setup.Providers[i]
			break
		}
	}
	if exactReadiness == nil {
		return
	}
	checkedAt := s.currentTime().UTC()
	if parsed, err := time.Parse(time.RFC3339Nano, setup.CheckedAt); err == nil {
		checkedAt = parsed.UTC()
	} else if parsed, err := time.Parse(time.RFC3339, setup.CheckedAt); err == nil {
		checkedAt = parsed.UTC()
	}
	record := providerReadinessRecord{
		Status:     exactReadiness.Status,
		Detail:     exactReadiness.Detail,
		NextAction: exactReadiness.NextAction,
		CheckedAt:  checkedAt,
		Revision:   providerRevision,
	}
	if exactReadiness.Status == codexbar.ProviderReady {
		record.VerifiedAt = checkedAt
	}

	s.providerPreferences.mu.Lock()
	if s.providerPreferences.providerRev[providerID] != providerRevision {
		s.providerPreferences.mu.Unlock()
		return
	}
	enabled := false
	for i := range s.providerPreferences.cached {
		if s.providerPreferences.cached[i].ID != providerID {
			continue
		}
		enabled = s.providerPreferences.cached[i].Enabled
		if enabled {
			s.providerPreferences.cached[i].Health = providerHealthFromReadiness(exactReadiness.Status)
			s.providerPreferences.cached[i].Service = codexbar.ProviderServiceUnknown
			s.providerPreferences.at = s.currentTime().UTC()
		}
		break
	}
	if enabled {
		s.providerReadinessMu.Lock()
		if s.providerReadiness == nil {
			s.providerReadiness = make(map[string]providerReadinessRecord)
		}
		s.providerReadiness[providerID] = record
		s.providerReadinessMu.Unlock()
	}
	s.providerPreferences.mu.Unlock()
	if !enabled {
		return
	}
	if exactReadiness.Status == codexbar.ProviderReady {
		if setup.ExactUsage != nil {
			s.cacheExactProviderUsage(*setup.ExactUsage)
		}
		if s.wakeDisplayStream != nil {
			s.wakeDisplayStream()
		}
	}
}

func (s *Server) providerReadinessFor(providerID string) (providerReadinessRecord, bool) {
	s.providerReadinessMu.Lock()
	defer s.providerReadinessMu.Unlock()
	record, ok := s.providerReadiness[strings.TrimSpace(strings.ToLower(providerID))]
	return record, ok
}

func (s *Server) providerHasFreshReadiness(setting codexbar.ProviderSetting, now time.Time) bool {
	providerID := setting.ID
	s.providerPreferences.mu.Lock()
	revision := s.providerPreferences.providerRev[providerID]
	s.providerReadinessMu.Lock()
	record, ok := s.providerReadiness[providerID]
	s.providerReadinessMu.Unlock()
	s.providerPreferences.mu.Unlock()
	if !ok || record.Revision != revision || record.Status != codexbar.ProviderReady || record.VerifiedAt.IsZero() || !providerReadinessAppliesToSetting(record, setting, now) {
		return false
	}
	age := now.Sub(record.VerifiedAt)
	return age >= 0 && age <= providerReadinessFreshness
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
		writeError(w, http.StatusServiceUnavailable, "codexbar_open_failed", "Provider setup could not be opened.", "Open provider setup from Applications, then check again.")
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
		NextAction: "Open provider setup, connect a provider, then click Check again.",
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
