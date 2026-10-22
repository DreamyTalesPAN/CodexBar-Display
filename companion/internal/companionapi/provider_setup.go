package companionapi

import (
	"context"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/daemon"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/openurl"
)

const providerSetupCacheTTL = 30 * time.Second

// providerCheckTimeout bounds a request or refresh that waits for provider
// checks. It must outlast one full provider check, or the handler reports
// a timeout while CodexBar is still answering.
const providerCheckTimeout = codexbar.ProviderCheckBudget + 5*time.Second

// exactProviderCheckTimeout bounds one exact provider check. It runs without
// a waiting request, so it may outlast the Control Center's 60 s (#786).
const exactProviderCheckTimeout = codexbar.ExactProviderCheckBudget + 5*time.Second

// exactProviderRetryWait is how long a retry request waits for its exact
// check before it answers that the provider is still checking. A variable so
// tests can run it out quickly.
var exactProviderRetryWait = providerCheckTimeout

type providerSetupResponse struct {
	OK            bool                   `json:"ok"`
	ProviderSetup codexbar.ProviderSetup `json:"providerSetup"`
}

type exactProviderProbeFlight struct {
	done      chan struct{}
	setup     codexbar.ProviderSetup
	startedAt time.Time
}

type providerReadinessRecord struct {
	Status    string
	Detail    string
	Reported  string
	SignInURL string
	CheckedAt time.Time
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
	s.logProviderCheckCauses(setup)
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
			// Nobody asked for this check, so it may read what the usage
			// service delivered last instead of asking every provider again.
			ctx, cancel := context.WithTimeout(codexbar.WithServeReading(context.Background()), providerCheckTimeout)
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
	// Checking means CodexBar has not answered this request yet. Reusing an older
	// usage snapshot would let the theme chooser overtake a first-run inventory
	// scan, including the lock-contention response that carries no config path.
	if strings.EqualFold(strings.TrimSpace(setup.Status), "checking") {
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

// Token history older than this no longer proves the provider is readable.
const tokenUsageReadinessMaxAge = 15 * time.Minute

func freshTokenUsageProviderReadiness(snapshot daemon.ProviderUsageSnapshot, now time.Time) (codexbar.ProviderReadiness, bool) {
	if snapshot.TokenStatsCollectedAt.IsZero() {
		return codexbar.ProviderReadiness{}, false
	}
	if now.IsZero() {
		now = time.Now().UTC()
	}
	tokenAt := snapshot.TokenStatsCollectedAt.UTC()
	if tokenAt.After(now.UTC().Add(5*time.Minute)) || now.Sub(tokenAt) > tokenUsageReadinessMaxAge {
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
	engineFailed := engineUnusable(setup.Engine.Status)
	blocksReady := engineFailed
	if engineFailed {
		protectedByID["codexbar"] = struct{}{}
	}
	for _, provider := range setup.Providers {
		id := strings.TrimSpace(strings.ToLower(provider.ID))
		if provider.Enabled != nil && !*provider.Enabled {
			// A disabled row must protect its own ID from cached readiness, but it
			// does not prevent another provider from proving the setup ready.
			if id != "" {
				protectedByID[id] = struct{}{}
			}
			continue
		}
		if id != "" && providerSetupFailureMustWin(provider.Status) {
			protectedByID[id] = struct{}{}
			blocksReady = true
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
	if len(readyByID) > 0 && !blocksReady {
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
		status == codexbar.ProviderBrowserSignInRequired ||
		status == codexbar.ProviderNotConfigured ||
		status == codexbar.ProviderPermissionRequired ||
		// A provider the account lost access to must keep its own row: a
		// cached reading from before the shutdown would otherwise restore a
		// "ready" Gemini and hide the migration guidance again.
		status == codexbar.ProviderUnsupported ||
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
	engineFailed := engineUnusable(setup.Engine.Status)
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
	return s.exactProviderSetupStartedAfter(ctx, providerID, time.Time{})
}

// exactProviderSetupStartedAfter joins a running probe of the provider only
// when it started at or after notBefore. A browser sign-in read changes what
// CodexBar can read, so a probe already running from before it answers for
// the old state: wait it out, then probe again (#607 Codex review).
func (s *Server) exactProviderSetupStartedAfter(ctx context.Context, providerID string, notBefore time.Time) codexbar.ProviderSetup {
	s.exactProviderProbeMu.Lock()
	if s.exactProviderProbes == nil {
		s.exactProviderProbes = make(map[string]*exactProviderProbeFlight)
	}
	for current := s.exactProviderProbes[providerID]; current != nil; current = s.exactProviderProbes[providerID] {
		s.exactProviderProbeMu.Unlock()
		select {
		case <-current.done:
			if !current.startedAt.Before(notBefore) {
				return current.setup
			}
		case <-ctx.Done():
			return timedOutExactProviderSetup(providerID, s.currentTime())
		}
		s.exactProviderProbeMu.Lock()
	}
	flight := &exactProviderProbeFlight{done: make(chan struct{}), startedAt: s.currentTime()}
	s.exactProviderProbes[providerID] = flight
	s.exactProviderProbeMu.Unlock()

	probe := s.probeExactProvider
	if probe == nil {
		probe = codexbar.ProbeProviderSetupForProvider
	}
	setup := probe(ctx, s.home, providerID)
	s.logProviderCheckCauses(setup)

	s.exactProviderProbeMu.Lock()
	flight.setup = setup
	close(flight.done)
	delete(s.exactProviderProbes, providerID)
	s.exactProviderProbeMu.Unlock()
	return setup
}

// logProviderCheckCauses writes why a check ended as a settings error (or
// lost its inventory read) to the runtime log, redacted like every reported
// provider message. The row and the setup log only carry the generic sentence,
// so without this line the cause of #527 could not be read back afterwards.
func (s *Server) logProviderCheckCauses(setup codexbar.ProviderSetup) {
	if s.logf == nil {
		return
	}
	for _, provider := range setup.Providers {
		if provider.Cause != "" {
			s.logf("VibeTV provider check: %s is %s (%s)", provider.ID, provider.Status, reportedProviderMessage(provider.Cause))
		}
	}
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

// usageServiceDeliveredSince: the running usage service delivered a fresh,
// usable reading of the provider of its own at or after since.
func (s *Server) usageServiceDeliveredSince(providerID string, since time.Time) bool {
	if s.loadUsage == nil {
		return false
	}
	now := s.currentTime()
	usage, ok := s.loadUsage(now)
	if !ok {
		return false
	}
	for _, provider := range usage.Providers {
		if !strings.EqualFold(strings.TrimSpace(provider.Provider), providerID) || provider.Retained ||
			provider.CollectedAt.Before(since) {
			continue
		}
		if _, fresh := freshUsableUsageProviderReadiness(provider, now); fresh {
			return true
		}
	}
	return false
}

// noteBrowserSignInRead records that CodexBar just read the provider's browser
// sign-in, so its row shows the check of that read instead of the failure from
// before it.
func (s *Server) noteBrowserSignInRead(providerID string, at time.Time) {
	s.browserSignInReadMu.Lock()
	defer s.browserSignInReadMu.Unlock()
	if s.browserSignInReadAt == nil {
		s.browserSignInReadAt = make(map[string]time.Time)
	}
	s.browserSignInReadAt[providerID] = at
}

// browserSignInReadBeingChecked: the Mac app reported a browser sign-in read
// for this provider within the grace period. Until the check of that read
// answers, the row's failure is from before the read and the row shows that it
// is checking. Once the check answered, a failure it names stands, and after a
// ready answer the row keeps checking only while nothing newer explains the
// missing reading: a scan after the check that names a sign-in, permission,
// throttle or outage failure shows it (Codex review on #607).
func (s *Server) browserSignInReadBeingChecked(setting codexbar.ProviderSetting, now time.Time, readiness providerReadinessRecord, hasReadiness bool) bool {
	s.browserSignInReadMu.Lock()
	at, ok := s.browserSignInReadAt[setting.ID]
	s.browserSignInReadMu.Unlock()
	if !ok || now.Before(at) || now.Sub(at) >= usageServiceStartGrace {
		return false
	}
	if !hasReadiness || readiness.CheckedAt.Before(at) {
		return true
	}
	if readiness.Status != codexbar.ProviderReady {
		return false
	}
	return providerFailureUnexplained(setting, readiness, true)
}

// providerRetryAfterBrowserSignInRead marks a check the Mac app asks for
// right after CodexBar read the provider's browser sign-in.
const providerRetryAfterBrowserSignInRead = "browser-sign-in-read"

func (s *Server) handleProviderRetry(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}
	providerID := strings.TrimSpace(strings.ToLower(r.URL.Query().Get("provider")))
	// The Mac app reports here that CodexBar just read the provider's browser
	// sign-in into its cookie cache.
	afterBrowserSignInRead := r.URL.Query().Get("after") == providerRetryAfterBrowserSignInRead
	requestedAt := s.currentTime()
	if afterBrowserSignInRead && providerID != "" {
		s.noteBrowserSignInRead(providerID, requestedAt)
	}
	if providerID == "" {
		ctx, cancel := context.WithTimeout(r.Context(), providerCheckTimeout)
		defer cancel()
		setup := s.currentProviderSetup(ctx, true)
		s.finishProviderRetry("", 0, false, requestedAt, setup)
		writeJSON(w, http.StatusOK, providerSetupResponse{OK: true, ProviderSetup: setup})
		return
	}
	providerRevision := s.currentProviderRevision(providerID)
	// One provider's check may outlast the Control Center's 60 s request: a
	// Mac Claude check through Claude Code took 55 s (#786). The check runs on
	// without the request. When the wait is over, the request answers that the
	// provider is still checking and the row shows that until the result is
	// recorded, so the page keeps asking for it.
	checked := make(chan codexbar.ProviderSetup, 1)
	go func() {
		// After a browser sign-in read the check may first wait out an older
		// probe and then probe again; each may take a full exact check, and
		// the fresh probe stays capped by its own budget (#805 Codex review).
		budget := exactProviderCheckTimeout
		if afterBrowserSignInRead {
			budget = 2 * exactProviderCheckTimeout
		}
		ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), budget)
		defer cancel()
		if afterBrowserSignInRead {
			checked <- s.exactProviderSetupStartedAfter(ctx, providerID, requestedAt)
		} else {
			checked <- s.currentExactProviderSetup(ctx, providerID)
		}
	}()
	wait, cancel := context.WithTimeout(r.Context(), exactProviderRetryWait)
	defer cancel()
	select {
	case setup := <-checked:
		s.finishProviderRetry(providerID, providerRevision, afterBrowserSignInRead, requestedAt, setup)
		writeJSON(w, http.StatusOK, providerSetupResponse{OK: true, ProviderSetup: setup})
	case <-wait.Done():
		pinned := s.markExactProviderChecking(providerID, providerRevision)
		go func() {
			if pinned {
				defer s.releaseExactChecking(providerID)
			}
			s.finishProviderRetry(providerID, providerRevision, afterBrowserSignInRead, requestedAt, <-checked)
		}()
		writeJSON(w, http.StatusOK, providerSetupResponse{OK: true, ProviderSetup: checkingProviderSetup(s.currentTime())})
	}
}

// finishProviderRetry records what a requested check found and lets the usage
// service follow a provider that is ready now.
func (s *Server) finishProviderRetry(providerID string, providerRevision uint64, afterBrowserSignInRead bool, requestedAt time.Time, setup codexbar.ProviderSetup) {
	label := ""
	if providerID != "" {
		s.recordExactProviderSetup(providerID, providerRevision, setup)
		// A too-old engine puts its own row first; name the provider asked for.
		for _, provider := range setup.Providers {
			if strings.EqualFold(provider.ID, providerID) {
				label = provider.Label
				break
			}
		}
		if s.providerRetryFollowupHook != nil {
			s.providerRetryFollowupHook()
		}
		// A check the customer overtook by switching the provider again is
		// not news, and must not touch the usage service either (#805
		// review). The revision is checked and the follow-up runs without a
		// switch in between, see whileProviderRevision.
		s.whileProviderRevision(providerID, providerRevision, func() {
			s.followProviderRetry(providerID, afterBrowserSignInRead, requestedAt, setup, label)
		})
		return
	}
	s.followProviderRetry(providerID, afterBrowserSignInRead, requestedAt, setup, label)
}

// whileProviderRevision runs follow only if the provider's revision is still
// the given one. A provider switch holds providerFollowupMu while it applies
// the change, so a follow-up either sees the new revision and does nothing,
// or finishes before the switch is applied at all. providerPreferences.mu is not held while follow runs,
// because it writes the setup log.
func (s *Server) whileProviderRevision(providerID string, providerRevision uint64, follow func()) {
	s.providerFollowupMu.Lock()
	defer s.providerFollowupMu.Unlock()
	if s.currentProviderRevision(providerID) != providerRevision {
		return
	}
	if s.providerFollowupHeldHook != nil {
		s.providerFollowupHeldHook()
	}
	follow()
}

// followProviderRetry logs what the check found and lets the usage service
// follow a provider that is ready now.
func (s *Server) followProviderRetry(providerID string, afterBrowserSignInRead bool, requestedAt time.Time, setup codexbar.ProviderSetup, label string) {
	s.recordProviderSetupEvents(setup, providerID, label)
	if setup.Status == codexbar.ProviderReady {
		// A reading the running usage service took before CodexBar's config
		// changed can still look fresh, so it is no evidence that the service
		// runs on the current config; the supervisor decides that.
		// After a browser sign-in read the config did not change, yet the
		// running service keeps its failed reading for minutes; only a fresh
		// one shows the sign-in before the Mac app reads, and asks, again.
		// A service that already delivered the provider after the read needs
		// no replacement: restarting it only put every row back on the
		// spinner for a moment (2026-10-15). A reading from before the read
		// proves nothing about the read, so it does not count.
		if providerID != "" && afterBrowserSignInRead && s.freshUsageService != nil &&
			!s.usageServiceDeliveredSince(providerID, requestedAt) {
			s.usageServiceReplacePending.Store(true)
			s.requestUsageServiceReplace(providerID)
		} else if providerID != "" && afterBrowserSignInRead {
			if s.wakeDisplayStream != nil {
				s.wakeDisplayStream()
			}
		} else if providerID != "" && s.restartUsageService != nil {
			s.requestUsageServiceReplace(providerID)
		} else if s.wakeDisplayStream != nil {
			s.wakeDisplayStream()
		}
	}
}

// markExactProviderChecking shows a switched-on provider as checking while its
// exact check runs on after the request answered. The earlier result no longer
// speaks for it, and a health scan that was already running must not replace
// the mark before the check is recorded. A scan started after the mark is held
// off as well, until releaseExactChecking, which the caller owes when the
// answer is true.
func (s *Server) markExactProviderChecking(providerID string, providerRevision uint64) bool {
	s.providerPreferences.mu.Lock()
	defer s.providerPreferences.mu.Unlock()
	if s.providerPreferences.providerRev[providerID] != providerRevision {
		return false
	}
	for i := range s.providerPreferences.cached {
		setting := &s.providerPreferences.cached[i]
		if setting.ID != providerID || !setting.Enabled {
			continue
		}
		setting.Health = codexbar.ProviderHealthChecking
		setting.Service = codexbar.ProviderServiceUnknown
		setting.Reported = ""
		setting.SignInURL = ""
		s.providerPreferences.revision++
		s.providerPreferences.at = s.currentTime().UTC()
		s.providerReadinessMu.Lock()
		delete(s.providerReadiness, providerID)
		s.providerReadinessMu.Unlock()
		s.pinExactCheckingLocked(providerID)
		return true
	}
	return false
}

// requestUsageServiceReplace asks the supervisor to check the usage service.
// A request that arrives while a replacement runs is kept, not dropped: the
// config may have changed after that replacement's child already read it,
// so the running replacement asks the supervisor once more when it is done.
func (s *Server) requestUsageServiceReplace(providerID string) {
	s.usageServiceRestartPending.Store(true)
	if s.usageServiceRestarting.CompareAndSwap(false, true) {
		go s.replaceUsageService(providerID)
	}
}

// replaceUsageService swaps the running usage service for a fresh one, then
// collects again. "Check again" just read the provider with a fresh CodexBar,
// so a running service started on older settings may be the stale part. The
// supervisor replaces it only when CodexBar's config changed after it
// started; one already running on the current config keeps collecting. It
// repeats while checks keep arriving during a restart.
func (s *Server) replaceUsageService(providerID string) {
	for {
		for s.usageServiceRestartPending.Swap(false) {
			restart := s.restartUsageService
			if s.usageServiceReplacePending.Swap(false) && s.freshUsageService != nil {
				restart = s.freshUsageService
			}
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			err := restart(ctx)
			cancel()
			if err != nil && s.logf != nil {
				s.logf("VibeTV usage service restart after checking %s failed: %v", providerID, err)
			}
		}
		s.usageServiceRestarting.Store(false)
		// A request stored just before the flag cleared saw a replacement
		// still running and left; take it over unless another one did.
		if !s.usageServiceRestartPending.Load() || !s.usageServiceRestarting.CompareAndSwap(false, true) {
			break
		}
	}
	if s.wakeDisplayStream != nil {
		s.wakeDisplayStream()
	}
}

// openProviderSignInFn opens a URL in the customer's default browser. Tests
// replace it; production goes through the OS handler without a shell. The
// handler returns as soon as the browser took the URL, so Run is fine here
// and reaps the child (Start alone would leak a handle per click).
var openProviderSignInFn = func(url string) error {
	name, args := openurl.Command(url)
	return exec.Command(name, args...).Run()
}

// providerSetupGuideURL is the customer setup guide. It explains that every
// provider reads its usage from the provider's own app on this computer.
const providerSetupGuideURL = "https://vibetv.shop/pages/setup"

// handleProviderSetupGuide opens the setup guide in the customer's default
// browser. The page is fixed; the request carries nothing. The Control Center
// cannot open it itself: the Windows window would navigate away from the app.
func (s *Server) handleProviderSetupGuide(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}
	if err := openProviderSignInFn(providerSetupGuideURL); err != nil {
		writeError(w, http.StatusInternalServerError, "provider_setup_guide_failed", "The browser could not be opened.", "Open "+providerSetupGuideURL+" in your browser.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "url": providerSetupGuideURL})
}

// handleProviderSignIn starts the sign-in for one provider. When CodexBar
// named a browser page for the provider's current browser_sign_in_required
// state, only that page opens. Otherwise the provider's own tool signs in:
// its browser sign-in page (Claude and Cursor on the Mac), its CLI login
// without a terminal window, its app, or -- when neither is installed -- its
// official install page. The request carries a provider id, never a URL or a
// path.
func (s *Server) handleProviderSignIn(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}
	providerID := strings.TrimSpace(strings.ToLower(r.URL.Query().Get("provider")))
	if url := s.providerSignInURL(providerID); url != "" {
		if err := openProviderSignInFn(url); err != nil {
			writeError(w, http.StatusInternalServerError, "provider_sign_in_failed", "The browser could not be opened.", "Open "+url+" in your browser, sign in.")
			return
		}
		if !s.useBrowserCookies(w, providerID) {
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "action": providerSignInActionBrowser, "url": url})
		return
	}
	home, _ := os.UserHomeDir()
	plan, ok := planProviderSignIn(providerID, runtime.GOOS, home, exec.LookPath, fileExists)
	if !ok {
		writeError(w, http.StatusNotFound, "provider_sign_in_unavailable", "This provider has no sign-in VibeTV can start.", "Sign in to the provider's app.")
		return
	}
	if err := launchProviderSignInFn(plan); err != nil {
		nextAction := "Sign in to the provider's app."
		if plan.URL != "" {
			nextAction = "Open " + plan.URL + " in your browser."
		}
		writeError(w, http.StatusInternalServerError, "provider_sign_in_failed", "The sign-in could not be started.", nextAction)
		return
	}
	if plan.Action == providerSignInActionBrowser && !s.useBrowserCookies(w, providerID) {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "action": plan.Action, "url": plan.URL})
}

// useBrowserCookies runs once the browser sign-in page is open. A provider
// pinned to a saved cookie would never see that sign-in, so it goes back to
// CodexBar's browser import. CodexBar 0.63.0 has no command for this (its
// config CLI only enables, disables and stores API keys), so the Companion
// changes that one field. When it cannot, the sign-in reports the failure:
// the provider would stay pinned, and checking again could never succeed.
func (s *Server) useBrowserCookies(w http.ResponseWriter, providerID string) bool {
	changed, err := codexbar.UseBrowserCookies(s.home, providerID)
	if err != nil {
		if s.logf != nil {
			s.logf("VibeTV provider sign-in: could not switch %s to browser cookies: %v", providerID, err)
		}
		writeError(w, http.StatusInternalServerError, "provider_sign_in_failed", providerReadinessMessage(codexbar.ProviderConfigError), providerReadinessNextAction(codexbar.ProviderConfigError))
		return false
	}
	if changed && s.logf != nil {
		s.logf("VibeTV provider sign-in: %s now reads the browser sign-in instead of a saved cookie", providerID)
	}
	return true
}

// providerSignInURL is the page CodexBar named in this provider's latest
// browser-sign-in diagnosis: the exact check first, then the background
// health scan. Empty when neither currently says the provider needs one.
//
// The exact record is only trusted while the row is still showing it. Rows
// drop a record older than providerReadinessFreshness, so without the same
// limit a stale browser page kept opening for a provider that had since moved
// on to a signed-out tool, and the customer's row action did something other
// than what the row said.
func (s *Server) providerSignInURL(providerID string) string {
	record, ok := s.providerReadinessFor(providerID)
	if age := s.currentTime().Sub(record.CheckedAt); ok && !record.CheckedAt.IsZero() &&
		age >= 0 && age <= providerReadinessFreshness &&
		record.Status == codexbar.ProviderBrowserSignInRequired && record.SignInURL != "" {
		return record.SignInURL
	}
	s.providerPreferences.mu.Lock()
	defer s.providerPreferences.mu.Unlock()
	for _, setting := range s.providerPreferences.cached {
		if strings.EqualFold(setting.ID, providerID) && setting.Health == codexbar.ProviderHealthBrowserSignIn {
			return setting.SignInURL
		}
	}
	return ""
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
		Status:    exactReadiness.Status,
		Detail:    exactReadiness.Detail,
		Reported:  exactReadiness.Reported,
		SignInURL: exactReadiness.SignInURL,
		CheckedAt: checkedAt,
	}

	s.providerPreferences.mu.Lock()
	if s.providerPreferences.providerRev[providerID] != providerRevision {
		s.providerPreferences.mu.Unlock()
		return
	}
	// An exact provider check is newer than any full health scan that was
	// already running. Advance the shared revision while holding the same lock
	// the background writer uses, so that older scan can never overwrite this
	// provider after the customer just confirmed it.
	s.providerPreferences.revision++
	enabled := false
	for i := range s.providerPreferences.cached {
		if s.providerPreferences.cached[i].ID != providerID {
			continue
		}
		enabled = s.providerPreferences.cached[i].Enabled
		if enabled {
			s.providerPreferences.cached[i].Health = providerHealthFromReadiness(exactReadiness.Status)
			s.providerPreferences.cached[i].Service = codexbar.ProviderServiceUnknown
			s.providerPreferences.cached[i].Reported = record.Reported
			s.providerPreferences.cached[i].SignInURL = record.SignInURL
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
	// A ready check only wakes the collector. Its own reading never stands in
	// for the collector's: what setup shows is what VibeTV can send (#480).
	if exactReadiness.Status == codexbar.ProviderReady {
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

func providerDiagnosticCheck(setup codexbar.ProviderSetup) diagnosticCheck {
	if setup.Status == codexbar.ProviderReady {
		check := diagnosticCheck{Name: "provider_setup", Status: "pass", Detail: "An AI provider is delivering usage data."}
		// One working provider must not hide another one the customer was told
		// to report: a throttled Claude next to a working Codex is the case.
		if others := failingProviderDiagnostics(setup.Providers); others != "" {
			check.Detail += " Other providers need attention: " + others
		}
		return check
	}
	check := diagnosticCheck{
		Name:       "provider_setup",
		Status:     "attention",
		Detail:     "No AI provider is delivering usage data yet.",
		ErrorCode:  "provider_setup_required",
		NextAction: "Open provider setup, connect a provider.",
	}
	if len(setup.Providers) > 0 {
		provider := setup.Providers[0]
		check.Detail = providerDiagnosticDetail(provider)
		if provider.NextAction != "" {
			check.NextAction = provider.NextAction
		}
		if provider.Status != "" {
			check.ErrorCode = provider.Status
		}
		if others := failingProviderDiagnostics(setup.Providers[1:]); others != "" {
			check.Detail += " Other providers need attention: " + others
		}
	}
	return check
}

// providerDiagnosticDetail is the row's own sentence plus CodexBar's. The
// engine sentence names every source that failed; without it a support report
// only says which category the app chose.
func providerDiagnosticDetail(provider codexbar.ProviderReadiness) string {
	detail := provider.Detail
	if reported := reportedProviderMessage(provider.Reported); reported != "" {
		detail = strings.TrimSpace(detail + " Provider message: " + reported)
	}
	return detail
}

// failingProviderDiagnostics lists every switched-on provider that is not
// delivering usage, so a support report covers each of them.
func failingProviderDiagnostics(providers []codexbar.ProviderReadiness) string {
	var parts []string
	for _, provider := range providers {
		if provider.Status == codexbar.ProviderReady || (provider.Enabled != nil && !*provider.Enabled) {
			continue
		}
		label := provider.Label
		if label == "" {
			label = provider.ID
		}
		parts = append(parts, label+": "+providerDiagnosticDetail(provider))
	}
	return strings.Join(parts, " | ")
}
