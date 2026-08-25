package companionapi

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/daemon"
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

// currentProviderSetup caches normal status polling and serializes explicit
// retries. A second concurrent retry reuses the first result instead of
// starting another CodexBar/browser probe.
func (s *Server) currentProviderSetup(ctx context.Context, force bool) codexbar.ProviderSetup {
	s.providerSetupMu.Lock()
	now := s.currentTime()
	if !s.providerSetupCachedAt.IsZero() {
		age := now.Sub(s.providerSetupCachedAt)
		if age >= 0 && (age < providerSetupCacheTTL && !force || age < time.Second) {
			cached := s.providerSetupCache
			s.providerSetupMu.Unlock()
			return s.providerSetupWithFreshUsage(cached, now)
		}
	}
	probe := s.probeProviderSetup
	if probe == nil {
		probe = codexbar.ProbeProviderSetup
	}
	setup := probe(ctx, s.home)
	s.providerSetupCache = setup
	s.providerSetupCachedAt = now
	s.providerSetupMu.Unlock()
	return s.providerSetupWithFreshUsage(setup, now)
}

// providerSetupForStatus keeps the general status endpoint responsive while a
// CodexBar usage probe is cold or slow. Device connection and pairing state
// must not wait for unrelated provider dashboard requests.
func (s *Server) providerSetupForStatus() codexbar.ProviderSetup {
	now := s.currentTime()
	if !s.providerSetupMu.TryLock() {
		return s.providerSetupWithFreshUsage(checkingProviderSetup(now), now)
	}
	cached := s.providerSetupCache
	cachedAt := s.providerSetupCachedAt
	s.providerSetupMu.Unlock()

	if !cachedAt.IsZero() {
		age := now.Sub(cachedAt)
		if age >= 0 && age < providerSetupCacheTTL {
			return s.providerSetupWithFreshUsage(cached, now)
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
		return s.providerSetupWithFreshUsage(cached, now)
	}
	return s.providerSetupWithFreshUsage(checkingProviderSetup(now), now)
}

func (s *Server) providerSetupWithFreshUsage(setup codexbar.ProviderSetup, now time.Time) codexbar.ProviderSetup {
	if s == nil || s.loadUsage == nil {
		return setup
	}
	if now.IsZero() {
		now = time.Now().UTC()
	}
	usage, ok := s.loadUsage(now)
	if !ok || len(usage.Providers) == 0 {
		return setup
	}
	readiness := freshUsableUsageReadiness(usage, now)
	if len(readiness) == 0 {
		tokenReadiness := freshTokenUsageReadiness(usage, now)
		if len(tokenReadiness) == 0 {
			return setup
		}
		return reconcileProviderSetupWithTokenEvidence(setup, tokenReadiness, now)
	}
	return reconcileProviderSetupWithUsage(setup, readiness, now)
}

func freshUsableUsageReadiness(usage daemon.PersistedUsage, now time.Time) []codexbar.ProviderReadiness {
	out := make([]codexbar.ProviderReadiness, 0, len(usage.Providers))
	for _, snapshot := range usage.Providers {
		readiness, ok := freshUsableUsageProviderReadiness(snapshot, now)
		if !ok {
			continue
		}
		out = append(out, readiness)
	}
	return out
}

func freshUsableUsageProviderReadiness(snapshot daemon.ProviderUsageSnapshot, now time.Time) (codexbar.ProviderReadiness, bool) {
	if snapshot.Stale || snapshot.CollectedAt.IsZero() {
		return codexbar.ProviderReadiness{}, false
	}
	if !now.IsZero() && snapshot.CollectedAt.After(now.UTC().Add(5*time.Minute)) {
		return codexbar.ProviderReadiness{}, false
	}
	frame := snapshot.Frame.Normalize()
	if strings.TrimSpace(frame.Error) != "" || frame.UsageUnavailable {
		return codexbar.ProviderReadiness{}, false
	}
	if !snapshotHasUsableUsage(frame, snapshot.Meta) {
		return codexbar.ProviderReadiness{}, false
	}
	info, ok := usageProviderFromSnapshot(snapshot)
	if !ok || info.Stale || info.UsageUnavailable {
		return codexbar.ProviderReadiness{}, false
	}
	return codexbar.ProviderReadiness{
		ID:          info.ID,
		Label:       info.Label,
		Status:      codexbar.ProviderReady,
		Source:      strings.TrimSpace(info.Source),
		CollectedAt: info.CollectedAt,
		Detail:      "Usage data is available.",
	}, true
}

func freshTokenUsageReadiness(usage daemon.PersistedUsage, now time.Time) []codexbar.ProviderReadiness {
	out := make([]codexbar.ProviderReadiness, 0, len(usage.Providers))
	for _, snapshot := range usage.Providers {
		readiness, ok := freshTokenUsageProviderReadiness(snapshot, now)
		if !ok {
			continue
		}
		out = append(out, readiness)
	}
	return out
}

func freshTokenUsageProviderReadiness(snapshot daemon.ProviderUsageSnapshot, now time.Time) (codexbar.ProviderReadiness, bool) {
	if snapshot.TokenStatsCollectedAt.IsZero() {
		return codexbar.ProviderReadiness{}, false
	}
	if now.IsZero() {
		now = time.Now().UTC()
	}
	tokenAt := snapshot.TokenStatsCollectedAt.UTC()
	if tokenAt.After(now.UTC().Add(5*time.Minute)) || now.Sub(tokenAt) > exactUsageCacheMaxAge {
		return codexbar.ProviderReadiness{}, false
	}
	if strings.TrimSpace(snapshot.Frame.Normalize().Error) != "" {
		return codexbar.ProviderReadiness{}, false
	}
	info, ok := usageProviderFromSnapshot(snapshot)
	if !ok || !usageProviderHasTokenEvidence(info) {
		return codexbar.ProviderReadiness{}, false
	}
	return codexbar.ProviderReadiness{
		ID:          info.ID,
		Label:       info.Label,
		Status:      codexbar.ProviderReady,
		Source:      strings.TrimSpace(info.Source),
		CollectedAt: tokenAt.Format(time.RFC3339),
		Detail:      "Token history is available; usage limits are temporarily unavailable.",
	}, true
}

func usageProviderHasTokenEvidence(provider usageProviderInfo) bool {
	return provider.Cost != nil ||
		provider.SessionTokens > 0 ||
		provider.WeekTokens > 0 ||
		provider.TotalTokens > 0
}

func reconcileProviderSetupWithUsage(setup codexbar.ProviderSetup, ready []codexbar.ProviderReadiness, now time.Time) codexbar.ProviderSetup {
	if len(ready) == 0 {
		return setup
	}
	if setup.CheckedAt == "" {
		setup.CheckedAt = now.UTC().Format(time.RFC3339Nano)
	}
	protectedByID := make(map[string]struct{}, len(setup.Providers))
	engineFailed := setup.Engine.Status == codexbar.ProviderEngineError
	if engineFailed {
		protectedByID["codexbar"] = struct{}{}
	}
	for _, provider := range setup.Providers {
		// A switched-off provider row is switch-state disclosure, not a probe
		// failure; it must not stop fresh usage evidence from proving another
		// provider ready.
		if provider.Enabled != nil && !*provider.Enabled {
			continue
		}
		id := strings.TrimSpace(strings.ToLower(provider.ID))
		if id != "" && providerSetupFailureMustWin(provider.Status) {
			protectedByID[id] = struct{}{}
		}
	}
	readyByID := make(map[string]codexbar.ProviderReadiness, len(ready))
	providers := make([]codexbar.ProviderReadiness, 0, len(ready)+len(setup.Providers))
	for _, provider := range ready {
		id := strings.TrimSpace(strings.ToLower(provider.ID))
		if id == "" {
			continue
		}
		if _, protected := protectedByID[id]; protected {
			continue
		}
		provider.ID = id
		readyByID[id] = provider
		providers = append(providers, provider)
	}
	if len(readyByID) > 0 && len(protectedByID) == 0 {
		setup.Status = codexbar.ProviderReady
		setup.Engine.Status = codexbar.ProviderReady
	}
	for _, provider := range setup.Providers {
		id := strings.TrimSpace(strings.ToLower(provider.ID))
		if id == "" {
			continue
		}
		if _, replaced := readyByID[id]; replaced {
			continue
		}
		if id == "codexbar" && !engineFailed {
			continue
		}
		provider.ID = id
		providers = append(providers, provider)
	}
	setup.Providers = providers
	return setup
}

func providerSetupFailureMustWin(status string) bool {
	return status == codexbar.ProviderAuthRequired ||
		status == codexbar.ProviderNotConfigured ||
		status == codexbar.ProviderPermissionRequired ||
		status == codexbar.ProviderConfigError
}

func reconcileProviderSetupWithTokenEvidence(setup codexbar.ProviderSetup, ready []codexbar.ProviderReadiness, now time.Time) codexbar.ProviderSetup {
	if len(ready) == 0 {
		return setup
	}
	original := setup
	if setup.CheckedAt == "" {
		setup.CheckedAt = now.UTC().Format(time.RFC3339Nano)
	}

	existingByID := make(map[string]struct{}, len(setup.Providers))
	for _, provider := range setup.Providers {
		id := strings.TrimSpace(strings.ToLower(provider.ID))
		if id != "" && id != "codexbar" {
			existingByID[id] = struct{}{}
		}
	}

	providers := make([]codexbar.ProviderReadiness, 0, len(ready)+len(setup.Providers))
	for _, provider := range ready {
		id := strings.TrimSpace(strings.ToLower(provider.ID))
		if id == "" {
			continue
		}
		if _, preserveSpecificIssue := existingByID[id]; preserveSpecificIssue {
			continue
		}
		provider.ID = id
		providers = append(providers, provider)
	}
	if len(providers) == 0 {
		return original
	}
	engineFailed := setup.Engine.Status == codexbar.ProviderEngineError
	if !engineFailed {
		setup.Status = codexbar.ProviderReady
		setup.Engine.Status = codexbar.ProviderReady
	}
	for _, provider := range setup.Providers {
		id := strings.TrimSpace(strings.ToLower(provider.ID))
		if id == "" || (id == "codexbar" && !engineFailed) {
			continue
		}
		provider.ID = id
		providers = append(providers, provider)
	}
	setup.Providers = providers
	return setup
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
			ID:     providerID,
			Label:  providerID,
			Status: codexbar.ProviderTimeout,
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
		setup = s.currentExactProviderSetup(ctx, providerID)
	}
	if setup.Status == codexbar.ProviderReady && s.wakeDisplayStream != nil {
		s.wakeDisplayStream()
	}
	writeJSON(w, http.StatusOK, providerSetupResponse{OK: true, ProviderSetup: setup})
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
