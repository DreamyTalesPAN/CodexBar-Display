package codexbar

import (
	"fmt"
	"strings"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
)

type SelectionReason string

const (
	SelectionReasonUsageDelta    SelectionReason = "usage-delta"
	SelectionReasonStickyCurrent SelectionReason = "sticky-current"
	SelectionReasonCodexbarOrder SelectionReason = "codexbar-order"
)

type SelectionDecision struct {
	Selected             ParsedFrame
	Reason               SelectionReason
	Detail               string
	ActivitySignalReason SelectionReason
	ActivityDetail       string
}

// ProviderSelector applies deterministic provider selection rules:
// usage delta -> sticky current -> CodexBar provider order.
type ProviderSelector struct {
	currentKey string
	snapshots  map[string]providerSnapshot
}

type providerSnapshot struct {
	session       int
	weekly        int
	sessionTokens int64
	weekTokens    int64
	totalTokens   int64
	// usageUnavailable marks a reading without percentages. They read as
	// zero, so the first real reading after it is not a rise.
	usageUnavailable bool
}

type activityScore struct {
	sessionDelta       int
	weeklyDelta        int
	sessionTokensDelta int64
	weekTokensDelta    int64
	totalTokensDelta   int64
}

func NewProviderSelector() *ProviderSelector {
	return &ProviderSelector{snapshots: make(map[string]providerSnapshot)}
}

func (s *ProviderSelector) SetCurrentProvider(provider string) {
	if s == nil {
		return
	}
	s.currentKey = strings.TrimSpace(strings.ToLower(provider))
}

func (s *ProviderSelector) Select(all []ParsedFrame) (ParsedFrame, bool) {
	decision, ok := s.SelectWithDecision(all)
	if !ok {
		return ParsedFrame{}, false
	}
	return decision.Selected, true
}

func (s *ProviderSelector) SelectWithDecision(all []ParsedFrame) (SelectionDecision, bool) {
	if len(all) == 0 {
		return SelectionDecision{}, false
	}
	if s.snapshots == nil {
		s.snapshots = make(map[string]providerSnapshot)
	}

	availableIdx := firstAvailableProviderIndex(all)
	selected := all[0]
	if availableIdx >= 0 {
		selected = all[availableIdx]
	}
	reason := SelectionReasonCodexbarOrder
	detail := "initial-provider-order"

	if byDelta, score, ok := s.selectByUsageDelta(all); ok {
		selected = byDelta
		reason = SelectionReasonUsageDelta
		detail = fmt.Sprintf("provider=%s score=%s", providerKey(byDelta), formatActivityScore(score))
	} else if s.currentKey != "" {
		if idx := indexOfProviderKey(all, s.currentKey); idx >= 0 {
			if providerUsageAvailable(all[idx]) || availableIdx < 0 {
				selected = all[idx]
				reason = SelectionReasonStickyCurrent
				detail = fmt.Sprintf("provider=%s", s.currentKey)
			} else {
				detail = fmt.Sprintf("current-provider-unavailable provider=%s", s.currentKey)
			}
		} else {
			detail = "current-provider-missing"
		}
	}

	resultSignalReason := SelectionReason("")
	resultActivityDetail := ""
	if score, ok := s.activityScoreForSelected(selected); ok {
		resultSignalReason = SelectionReasonUsageDelta
		resultActivityDetail = fmt.Sprintf("source=usage-delta score=%s", formatActivityScore(score))
	}

	s.currentKey = providerKey(selected)
	next := make(map[string]providerSnapshot, len(all))
	for _, p := range all {
		next[providerKey(p)] = providerSnapshot{
			session:          p.Frame.Session,
			weekly:           p.Frame.Weekly,
			sessionTokens:    p.Frame.SessionTokens,
			weekTokens:       p.Frame.WeekTokens,
			totalTokens:      p.Frame.TotalTokens,
			usageUnavailable: p.Frame.UsageUnavailable,
		}
	}
	s.snapshots = next

	return SelectionDecision{
		Selected:             selected,
		Reason:               reason,
		Detail:               detail,
		ActivitySignalReason: resultSignalReason,
		ActivityDetail:       resultActivityDetail,
	}, true
}

func firstAvailableProviderIndex(all []ParsedFrame) int {
	for i := range all {
		if providerUsageAvailable(all[i]) {
			return i
		}
	}
	return -1
}

func providerUsageAvailable(provider ParsedFrame) bool {
	return !provider.Stale && !provider.Frame.UsageUnavailable
}

func (s *ProviderSelector) activityScoreForSelected(selected ParsedFrame) (activityScore, bool) {
	if s == nil || s.snapshots == nil {
		return activityScore{}, false
	}
	key := providerKey(selected)
	prev, ok := s.snapshots[key]
	if !ok {
		return activityScore{}, false
	}
	score := providerActivityScore(prev, selected)
	if !score.hasSignal() {
		return activityScore{}, false
	}
	return score, true
}

func (s *ProviderSelector) selectByUsageDelta(all []ParsedFrame) (ParsedFrame, activityScore, bool) {
	bestIdx := -1
	bestScore := activityScore{}

	for i, p := range all {
		key := providerKey(p)
		prev, ok := s.snapshots[key]
		if !ok {
			continue
		}

		score := providerActivityScore(prev, p)
		if !score.hasSignal() {
			continue
		}
		if bestIdx == -1 || score.betterThan(bestScore) {
			bestIdx = i
			bestScore = score
		}
	}

	if bestIdx == -1 {
		return ParsedFrame{}, activityScore{}, false
	}
	return all[bestIdx], bestScore, true
}

func formatActivityScore(score activityScore) string {
	return fmt.Sprintf("session+%d weekly+%d sessionTokens+%d weekTokens+%d totalTokens+%d", score.sessionDelta, score.weeklyDelta, score.sessionTokensDelta, score.weekTokensDelta, score.totalTokensDelta)
}

// maxPlausibleTokenDeltaPerCycle bounds what one collector cycle can count as
// real usage. Observed live (2026-08-06): the dashboard reported codex
// totalTokens jumps of +0.6 to +1.7 billion tokens between two 30s cycles -
// counter noise that must never be scored as activity, because the selector
// would then park on that provider forever while another provider has real,
// fresh activity.
const maxPlausibleTokenDeltaPerCycle = 100_000_000

func plausibleTokenDelta(delta int64) int64 {
	if delta > maxPlausibleTokenDeltaPerCycle {
		return 0
	}
	return delta
}

// providerActivityScore leaves token totals out while the history is still
// being read in; percentages still count.
func providerActivityScore(prev providerSnapshot, provider ParsedFrame) activityScore {
	cur := provider.Frame
	if provider.TokenHistoryGrowing {
		prev.sessionTokens, prev.weekTokens, prev.totalTokens = 0, 0, 0
		cur.SessionTokens, cur.WeekTokens, cur.TotalTokens = 0, 0, 0
	}
	return computeActivityScore(prev, cur)
}

func computeActivityScore(prev providerSnapshot, cur protocol.Frame) activityScore {
	score := activityScore{}
	tokenScore := activityScore{
		sessionTokensDelta: plausibleTokenDelta(positiveInt64Delta(prev.sessionTokens, cur.SessionTokens)),
		weekTokensDelta:    plausibleTokenDelta(positiveInt64Delta(prev.weekTokens, cur.WeekTokens)),
		totalTokensDelta:   plausibleTokenDelta(positiveInt64Delta(prev.totalTokens, cur.TotalTokens)),
	}
	if tokenScore.hasSignal() {
		return tokenScore
	}

	if comparableTokenStats(prev, cur) || prev.usageUnavailable {
		return score
	}

	if d := cur.Session - prev.session; d > 0 {
		score.sessionDelta = d
	}
	if d := cur.Weekly - prev.weekly; d > 0 {
		score.weeklyDelta = d
	}
	return score
}

func (s activityScore) hasSignal() bool {
	return s.sessionDelta > 0 ||
		s.weeklyDelta > 0 ||
		s.sessionTokensDelta > 0 ||
		s.weekTokensDelta > 0 ||
		s.totalTokensDelta > 0
}

func (s activityScore) betterThan(other activityScore) bool {
	if s.totalTokensDelta != other.totalTokensDelta {
		return s.totalTokensDelta > other.totalTokensDelta
	}
	if s.sessionTokensDelta != other.sessionTokensDelta {
		return s.sessionTokensDelta > other.sessionTokensDelta
	}
	if s.weekTokensDelta != other.weekTokensDelta {
		return s.weekTokensDelta > other.weekTokensDelta
	}
	if s.sessionDelta != other.sessionDelta {
		return s.sessionDelta > other.sessionDelta
	}
	if s.weeklyDelta != other.weeklyDelta {
		return s.weeklyDelta > other.weeklyDelta
	}
	return false
}

func positiveInt64Delta(prev, cur int64) int64 {
	if prev <= 0 || cur <= prev {
		return 0
	}
	return cur - prev
}

func comparableTokenStats(prev providerSnapshot, cur protocol.Frame) bool {
	return (prev.sessionTokens > 0 && cur.SessionTokens > 0) ||
		(prev.weekTokens > 0 && cur.WeekTokens > 0) ||
		(prev.totalTokens > 0 && cur.TotalTokens > 0)
}

func providerKey(p ParsedFrame) string {
	provider := strings.TrimSpace(strings.ToLower(p.Provider))
	if provider == "" {
		provider = strings.TrimSpace(strings.ToLower(p.Frame.Provider))
	}
	if provider == "" {
		provider = strings.TrimSpace(strings.ToLower(p.Frame.Label))
	}
	if provider == "" {
		provider = "provider"
	}
	return provider
}

func indexOfProviderKey(all []ParsedFrame, key string) int {
	for i, p := range all {
		if providerKey(p) == key {
			return i
		}
	}
	return -1
}
