package daemon

import (
	"fmt"
	"strings"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimeconfig"
)

// providerOffFunc reports whether authoritative inventory lists a provider as
// switched off, and whether that comes from the latest collection's own read.
// Nil means no inventory is known, which never confirms it.
type providerOffFunc func(provider string) (off, current bool)

func selectCycleFrameFromProviders(state *runtimeState, allProviders []codexbar.ParsedFrame, now time.Time, deps runtimeDeps, providerOff providerOffFunc, emptyProvidersOp, emptyReason, emptyDetail, errorSource string) cycleResult {
	result := cycleResult{
		selectionReason: emptyReason,
		selectionDetail: emptyDetail,
		errorSource:     errorSource,
	}
	invalidateLastGoodTerminal(state, allProviders, deps)
	allProviders = applyProviderDisplaySelection(state, allProviders, deps, providerOff)

	if len(allProviders) == 0 {
		result.failureKind = runtimeErrorNoProviders
		result.failureOp = emptyProvidersOp
		result.failureErr = codexbar.ErrNoProviders
		return finalizeCycleResult(state, result, now)
	}
	decision, ok := state.selector.SelectWithDecision(allProviders)
	if !ok {
		result.failureKind = runtimeErrorNoProviders
		result.failureOp = "select-provider"
		result.failureErr = codexbar.ErrNoProviders
		return finalizeCycleResult(state, result, now)
	}

	// A timed rotation changes which provider is shown, nothing else: the
	// coding/idle verdict below stays the one for the provider the selector
	// chose, because the VibeTV starts its screensaver from it.
	activity := decision
	if provider, detail, ok := rotateShownProvider(state, allProviders, decision.Selected, now, deps); ok {
		decision.Selected, decision.Reason, decision.Detail = provider, "timed-rotation", detail
	}

	result.frame = decision.Selected.Frame
	if result.frame.UsageUnavailable && (state == nil || !state.hasLastGood) {
		// Providers are enumerated but none has ever delivered usage: for the
		// runtime that is the same customer state as having no providers at
		// all. Reusing the genuine no-providers failure sends the device the
		// honest error frame and gives the stream parser its
		// provider_setup_required classification, instead of the silent
		// unexplained wait behind the guest-matrix
		// firmware_current_stream_attention flake. Whatever CodexBar's error
		// says -- signed out, rate limited, unreachable -- is CodexBar's to
		// report; the runtime does not read that text to second-guess it.
		result.failureKind = runtimeErrorNoProviders
		result.failureOp = "collect-usage"
		result.failureErr = codexbar.ErrNoProviders
		return finalizeCycleResult(state, result, now)
	}
	result.selectionReason = string(decision.Reason)
	result.selectionDetail = decision.Detail
	result.usageSource = usageSourceOrDefault(decision.Selected.Source, "codexbar")
	result.usageFresh = !decision.Selected.Stale && !result.frame.UsageUnavailable
	collectedAt := decision.Selected.CollectedAt
	if collectedAt.IsZero() {
		collectedAt = now
	}
	result.collectedAt = collectedAt
	result.resetBasisAt = collectedAt
	var display *runtimeconfig.ProviderDisplayConfig
	if cfg, ok := loadRuntimeConfig(deps); ok {
		display = cfg.ProviderDisplay
	}
	result.frame.ProviderSlots = providerResetSlots(allProviders, collectedAt, display)
	result.frame = applyDisplayLimits(result.frame, allProviders, display, collectedAt)
	result.frame, result.activityDetail = applySelectionActivity(result.frame, activity, state, now)
	return result
}

// rotateShownProvider is the timed rotation of Automatic (issue #322). With an
// interval set, the timer alone decides which provider is shown: each one keeps
// the screen for the interval, then the next in CodexBar's order follows, and a
// usage change elsewhere does not cut a turn short. Only providers with a
// current reading take a turn, and fewer than two of them leave nothing to
// rotate. The first turn, and the one after the provider on screen lost its
// reading, goes to selected: the provider Automatic would show anyway, so
// switching the timer on does not change the screen.
func rotateShownProvider(state *runtimeState, providers []codexbar.ParsedFrame, selected codexbar.ParsedFrame, now time.Time, deps runtimeDeps) (codexbar.ParsedFrame, string, bool) {
	cfg, _ := loadRuntimeConfig(deps)
	interval := time.Duration(cfg.DisplayRotateSeconds) * time.Second
	if interval <= 0 || (cfg.ProviderDisplay != nil && cfg.ProviderDisplay.Mode != "automatic") {
		state.rotationProvider = ""
		return codexbar.ParsedFrame{}, "", false
	}
	var available []codexbar.ParsedFrame
	for _, provider := range providers {
		if !provider.Stale && !provider.Frame.UsageUnavailable {
			available = append(available, provider)
		}
	}
	if len(available) < 2 {
		// The turn is kept: a collection that fails once must not restart
		// the rotation.
		return codexbar.ParsedFrame{}, "", false
	}

	position := func(key string) int {
		for i, provider := range available {
			if normalizeProviderKey(provider.Frame.Provider) == key {
				return i
			}
		}
		return -1
	}
	index := position(state.rotationProvider)
	if index < 0 {
		index = max(position(normalizeProviderKey(selected.Frame.Provider)), 0)
		state.rotationAt = now
	} else if now.Sub(state.rotationAt) >= interval {
		index = (index + 1) % len(available)
		state.rotationAt = now
	}
	state.rotationProvider = normalizeProviderKey(available[index].Frame.Provider)
	return available[index], fmt.Sprintf("provider=%s every=%s", state.rotationProvider, interval), true
}

func applyProviderDisplaySelection(state *runtimeState, providers []codexbar.ParsedFrame, deps runtimeDeps, providerOff providerOffFunc) []codexbar.ParsedFrame {
	cfg, ok := loadRuntimeConfig(deps)
	if !ok || cfg.ProviderDisplay == nil {
		return preferAvailableProviders(providers)
	}
	// Automatic means every provider currently enabled in CodexBar. The
	// collected list already follows that inventory, while ProviderIDs is only
	// the snapshot saved when the customer chose the mode. Filtering by that
	// snapshot silently excluded providers enabled later outside this app.
	if cfg.ProviderDisplay.Mode == "automatic" {
		return preferAvailableProviders(providers)
	}
	allowed := make(map[string]struct{}, len(cfg.ProviderDisplay.ProviderIDs))
	for _, providerID := range cfg.ProviderDisplay.ProviderIDs {
		providerID = normalizeProviderKey(providerID)
		if providerID != "" {
			allowed[providerID] = struct{}{}
		}
	}
	selectionKey := providerDisplaySelectionKey(cfg.ProviderDisplay.ProviderIDs)
	filtered := make([]codexbar.ParsedFrame, 0, len(providers))
	for _, provider := range providers {
		if _, permitted := allowed[normalizeProviderKey(provider.Frame.Provider)]; permitted {
			filtered = append(filtered, provider)
		}
	}
	// A Manual provider that was turned off in CodexBar is no longer
	// collected at all. Filtering by it would leave the device blank although
	// other providers have usage, so fall back to them like Automatic until
	// the pinned provider is switched on again. Only authoritative inventory
	// may say it is off: CodexBar can omit an enabled provider for a cycle, and
	// that must stay the pinned provider's unavailable state. A running
	// fallback survives one failed inventory read; starting one needs a
	// current read.
	fallbackActive := state != nil && selectionKey != "" && state.providerDisplayFallback == selectionKey
	if len(filtered) == 0 && len(providers) > 0 && fixedSelectionDisabled(allowed, providerOff, fallbackActive) {
		if state != nil && state.providerDisplayFallback != selectionKey {
			state.providerDisplayFallback = selectionKey
			if deps.logf != nil {
				deps.logf("runtime event=provider-display-fallback reason=fixed-provider-not-collected\n")
			}
		}
		return preferAvailableProviders(providers)
	}
	// Not confirmed off (any more): the pinned provider's own state applies,
	// including a temporary omission, which stays visibly unavailable.
	if state != nil {
		state.providerDisplayFallback = ""
	}
	if state != nil && state.hasLastGood {
		if !providerDisplayShowsProvider(cfg.ProviderDisplay, state.lastGood.Provider) {
			state.lastGood = protocol.Frame{}
			state.lastGoodAt = time.Time{}
			state.hasLastGood = false
			state.lastPersistedGood = protocol.Frame{}
			state.lastPersistedAt = time.Time{}
			state.hasPersistedGood = false
			if state.selector != nil {
				state.selector.SetCurrentProvider("")
			}
		}
	}
	if cfg.ProviderDisplay.Mode == providerDisplayModePair {
		// Two at once shows the current member alone while the other has no
		// current reading, so the selection must not settle on that other one.
		return preferAvailableProviders(filtered)
	}
	return filtered
}

func providerDisplaySelectionKey(providerIDs []string) string {
	keys := make([]string, 0, len(providerIDs))
	for _, providerID := range providerIDs {
		if key := normalizeProviderKey(providerID); key != "" {
			keys = append(keys, key)
		}
	}
	if len(keys) == 0 {
		return ""
	}
	return "fixed:" + strings.Join(keys, ",")
}

func fixedSelectionDisabled(allowed map[string]struct{}, providerOff providerOffFunc, acceptOlderInventory bool) bool {
	if providerOff == nil || len(allowed) == 0 {
		return false
	}
	for providerID := range allowed {
		off, current := providerOff(providerID)
		if !off || (!current && !acceptOlderInventory) {
			return false
		}
	}
	return true
}

func preferAvailableProviders(providers []codexbar.ParsedFrame) []codexbar.ParsedFrame {
	available := make([]codexbar.ParsedFrame, 0, len(providers))
	for _, provider := range providers {
		if !provider.Stale && !provider.Frame.UsageUnavailable {
			available = append(available, provider)
		}
	}
	if len(available) > 0 {
		return available
	}
	return providers
}

// providerResetSlots turns every provider with a live usage countdown into one
// cross-provider row: label plus that provider's soonest window reset. Each
// snapshot was collected at its own time, so every reset is first expressed as
// of resetBasisAt — the selected frame's basis — because ApplyResetTrust later
// re-anchors the whole frame from exactly that instant. Stale or unavailable
// providers stay out: a countdown the collector cannot vouch for must not tick
// on the customer's screen. Windows the customer took off VibeTV stay out too.
func providerResetSlots(allProviders []codexbar.ParsedFrame, resetBasisAt time.Time, display *runtimeconfig.ProviderDisplayConfig) []protocol.UsageSlot {
	var slots []protocol.UsageSlot
	for _, provider := range allProviders {
		if provider.Stale || provider.Frame.UsageUnavailable {
			continue
		}
		var soonest int64
		var percent int
		for _, window := range visibleUsageWindows(provider.Frame.Provider, provider.Frame.UsageWindows, display) {
			reset := window.ResetSec
			if reset > 0 && !provider.CollectedAt.IsZero() && !resetBasisAt.IsZero() {
				reset -= int64(resetBasisAt.Sub(provider.CollectedAt) / time.Second)
			}
			if reset > 0 && (soonest == 0 || reset < soonest) {
				soonest = reset
			}
			if window.Percent > percent {
				percent = window.Percent
			}
		}
		if soonest <= 0 {
			continue
		}
		label := strings.TrimSpace(provider.Frame.Label)
		if label == "" {
			label = provider.Provider
		}
		id := strings.TrimSpace(provider.Frame.Provider)
		if id == "" {
			id = provider.Provider
		}
		slots = append(slots, protocol.UsageSlot{
			ID:       id,
			Label:    label,
			Percent:  percent,
			ResetSec: soonest,
		})
		if len(slots) == protocol.MaxProviderSlots {
			break
		}
	}
	return slots
}

func finalizeCycleResult(state *runtimeState, result cycleResult, now time.Time) cycleResult {
	if result.failureErr == nil {
		return result
	}

	if state != nil && state.hasLastGood {
		result.frame = state.lastGood
		if !isLastGoodFreshAt(state.lastGoodAt, now, lastGoodMaxAge()) {
			result.frame.UsageUnavailable = true
		}
		result.resetBasisAt = state.lastGoodAt
		result.usedLastGood = true
		result.selectionReason = "stale-last-good"
		result.selectionDetail = fmt.Sprintf("kind=%s", result.failureKind)
		result.usageSource = "last-good"
		result.usageFresh = false
		return result
	}

	if result.failureKind == "" {
		result.failureKind = runtimeErrorUnknown
	}
	source := strings.TrimSpace(result.errorSource)
	if source == "" {
		source = "codexbar"
	}
	result.frame = protocol.ErrorFrame(runtimeErrorFrameCode(result.failureKind))
	result.selectionReason = "error-frame"
	result.selectionDetail = fmt.Sprintf("kind=%s source=%s", result.failureKind, source)
	result.usageSource = source
	result.usageFresh = false
	return result
}

func applySelectionActivity(frame protocol.Frame, decision codexbar.SelectionDecision, state *runtimeState, now time.Time) (protocol.Frame, string) {
	if strings.TrimSpace(frame.Activity) != "" {
		return frame, fmt.Sprintf("activity=explicit value=%s", frame.Activity)
	}
	if now.IsZero() {
		now = time.Now()
	}
	if state == nil {
		state = &runtimeState{}
	}

	collectedAt := decision.Selected.CollectedAt
	if collectedAt.IsZero() {
		collectedAt = now
	}
	activityObservedAt := decision.Selected.ActivityObservedAt
	if activityObservedAt.IsZero() {
		activityObservedAt = collectedAt
	}
	codingExpired := state.lastActivity == "coding" && codingMaxAgeExpired(state, now)
	// A token scan that completed after the one that showed the work, and
	// brought no delta, is the answer coding was waiting for. It must be
	// looked at, not answered from the remembered activity.
	tokenScanAnswered := state.lastActivity == "coding" && !state.lastCodingTokenScanAt.IsZero() &&
		decision.Selected.TokenStatsCollectedAt.After(state.lastCodingTokenScanAt)
	if decision.ActivitySignalReason != codexbar.SelectionReasonUsageDelta &&
		!activityObservedAt.IsZero() &&
		activityObservedAt.Equal(state.lastActivityObservedAt) &&
		state.lastActivity != "" &&
		!codingExpired && !tokenScanAnswered {
		state.lastActivityAt = collectedAt
		frame.Activity = state.lastActivity
		return frame, fmt.Sprintf("activity=%s reason=unchanged-codexbar-activity detail=%s observedAt=%s", frame.Activity, state.lastActivityCause, activityObservedAt.Format(time.RFC3339))
	}
	// Token totals are scanned on their own schedule and land on a usage
	// snapshot that keeps its collection time, so a delta must never be
	// answered from the remembered activity.
	if decision.ActivitySignalReason != codexbar.SelectionReasonUsageDelta &&
		!collectedAt.IsZero() && collectedAt.Equal(state.lastActivityAt) && state.lastActivity != "" && !codingExpired && !tokenScanAnswered {
		frame.Activity = state.lastActivity
		return frame, fmt.Sprintf("activity=%s reason=unchanged-usage-frame detail=%s", frame.Activity, state.lastActivityCause)
	}

	activity := "idle"
	signalDetail := strings.TrimSpace(decision.ActivityDetail)
	signalReason := decision.ActivitySignalReason
	switch signalReason {
	case codexbar.SelectionReasonUsageDelta:
		activity = "coding"
		state.lastCodingAt = now
		// The mark names the token scan that showed this work. A provider
		// without token totals, or one whose history is still being read
		// in, has no such scan; its delta leaves alone the scan another
		// provider's work is still waiting for.
		if decision.Selected.Frame.TokenTotalsKnown && !decision.Selected.TokenHistoryGrowing {
			state.lastCodingTokenScanAt = decision.Selected.TokenStatsCollectedAt
		}
		state.lastIdleEvidenceAt = time.Time{}
		state.idleEvidenceCount = 0
	default:
		if state.lastActivity == "coding" {
			if codingMaxAgeExpired(state, now) {
				state.lastIdleEvidenceAt = time.Time{}
				state.idleEvidenceCount = 0
				signalReason = "coding-max-age-expired"
				signalDetail = fmt.Sprintf("last_delta_age=%s max=%s observedAt=%s", now.Sub(state.lastCodingAt).Round(time.Second), activityCodingMaxAge(), activityObservedAt.Format(time.RFC3339))
			} else {
				if !activityObservedAt.IsZero() && activityObservedAt.After(state.lastActivityObservedAt) && !activityObservedAt.Equal(state.lastIdleEvidenceAt) {
					state.lastIdleEvidenceAt = activityObservedAt
					state.idleEvidenceCount++
				}
				// Token totals only move with a token scan. Until the next
				// scan has completed, usage refreshes without a delta say
				// nothing about whether the customer stopped working. That
				// scan covers the whole time since the last one, so it is
				// all the idle evidence there can be.
				awaitingTokenScan := !state.lastCodingTokenScanAt.IsZero() && !tokenScanAnswered
				needsIdleEvidence := !tokenScanAnswered && state.idleEvidenceCount < activityIdleEvidenceRequired()
				if codingHoldActive(state.lastCodingAt, now) || needsIdleEvidence || awaitingTokenScan {
					activity = "coding"
					signalReason = "coding-waiting-for-idle-evidence"
					signalDetail = fmt.Sprintf("last_delta_age=%s hold=%s max=%s idle_evidence=%d/%d awaiting_token_scan=%t observedAt=%s", now.Sub(state.lastCodingAt).Round(time.Second), activityHoldDuration(), activityCodingMaxAge(), state.idleEvidenceCount, activityIdleEvidenceRequired(), awaitingTokenScan, activityObservedAt.Format(time.RFC3339))
				} else {
					state.lastIdleEvidenceAt = time.Time{}
					state.idleEvidenceCount = 0
				}
			}
		}
	}

	if signalDetail == "" {
		signalDetail = string(signalReason)
	}
	if signalDetail == "" {
		signalDetail = "no-usage-delta"
	}
	reason := string(signalReason)
	if reason == "" {
		reason = "no-usage-delta"
	}

	if activity == "idle" {
		state.lastCodingTokenScanAt = time.Time{}
	}
	state.lastActivityAt = collectedAt
	state.lastActivityObservedAt = activityObservedAt
	state.lastActivity = activity
	state.lastActivityCause = signalDetail
	frame.Activity = activity
	return frame, fmt.Sprintf("activity=%s reason=%s detail=%s", activity, reason, signalDetail)
}

func codingHoldActive(lastCodingAt time.Time, now time.Time) bool {
	if lastCodingAt.IsZero() {
		return false
	}
	if now.Before(lastCodingAt) {
		return true
	}
	return now.Sub(lastCodingAt) <= activityHoldDuration()
}

func codingMaxAgeExpired(state *runtimeState, now time.Time) bool {
	if state.lastCodingAt.IsZero() {
		return false
	}
	if now.Before(state.lastCodingAt) {
		return false
	}
	maxAge := activityCodingMaxAge()
	if !state.lastCodingTokenScanAt.IsZero() {
		// Coding that waits for the next token scan must outlast one scan
		// period (cooldown plus the scan itself), or continuous work is cut
		// to idle just before that scan.
		maxAge = max(maxAge, tokenStatsScanCooldown+tokenStatsCollectorTimeout+time.Minute)
	}
	return now.Sub(state.lastCodingAt) > maxAge
}
