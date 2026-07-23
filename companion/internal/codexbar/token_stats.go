package codexbar

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
)

const (
	tokenStatsRefreshInterval = 30 * time.Second
	tokenStatsStaleMaxAge     = 15 * time.Minute
	tokenStatsCommandTimeout  = 2 * time.Second
	tokenStatsRepairTimeout   = 5 * time.Minute
	tokenStatsRepairCooldown  = 1 * time.Minute
)

type ProviderTokenStats struct {
	SessionTokens int64
	WeekTokens    int64
	TotalTokens   int64
	UpdatedAt     time.Time
	Source        string
	Cost          *ProviderCostUsage
}

func (s ProviderTokenStats) HasAny() bool {
	return s.SessionTokens > 0 || s.WeekTokens > 0 || s.TotalTokens > 0 || s.Cost != nil
}

type providerTokenStatsCache struct {
	mu       sync.RWMutex
	fetched  time.Time
	provider map[string]ProviderTokenStats
}

var tokenStatsCache providerTokenStatsCache

var loadProviderTokenStatsCacheFn = loadProviderTokenStatsFromCostCache

var tokenStatsRepair = struct {
	sync.Mutex
	running     bool
	nextAttempt time.Time
}{}

func FetchProviderTokenStats(ctx context.Context) (map[string]ProviderTokenStats, bool) {
	bin, err := FindBinary()
	if err != nil {
		return nil, false
	}
	if err := CheckMinimumVersion(ctx, bin); err != nil {
		return nil, false
	}
	return fetchProviderTokenStats(ctx, bin)
}

func mergeTokenStats(ctx context.Context, parsed []ParsedFrame, bin string) []ParsedFrame {
	statsByProvider, ok := fetchProviderTokenStats(ctx, bin)
	if !ok || len(statsByProvider) == 0 || len(parsed) == 0 {
		return parsed
	}

	out := make([]ParsedFrame, len(parsed))
	copy(out, parsed)
	for i := range out {
		key := providerKey(out[i])
		if key == "" {
			key = strings.TrimSpace(strings.ToLower(out[i].Frame.Provider))
		}
		stats, ok := statsByProvider[key]
		if !ok || !stats.HasAny() {
			continue
		}
		applyTokenStatsToFrame(&out[i].Frame, stats)
		if stats.Cost != nil {
			out[i].Meta.Cost = stats.Cost
		}
		if !stats.UpdatedAt.IsZero() {
			out[i].ActivityObservedAt = stats.UpdatedAt.UTC()
		}
	}
	return out
}

func mergeProviderTokenStats(ctx context.Context, parsed ParsedFrame, bin string) ParsedFrame {
	statsByProvider, ok := fetchProviderTokenStats(ctx, bin)
	if !ok || len(statsByProvider) == 0 {
		return parsed
	}

	key := providerKey(parsed)
	if key == "" {
		key = strings.TrimSpace(strings.ToLower(parsed.Frame.Provider))
	}
	stats, ok := statsByProvider[key]
	if !ok || !stats.HasAny() {
		return parsed
	}

	applyTokenStatsToFrame(&parsed.Frame, stats)
	if stats.Cost != nil {
		parsed.Meta.Cost = stats.Cost
	}
	if !stats.UpdatedAt.IsZero() {
		parsed.ActivityObservedAt = stats.UpdatedAt.UTC()
	}
	return parsed
}

func applyTokenStatsToFrame(frame *protocol.Frame, stats ProviderTokenStats) {
	if stats.SessionTokens > 0 {
		frame.SessionTokens = stats.SessionTokens
	}
	if stats.WeekTokens > 0 {
		frame.WeekTokens = stats.WeekTokens
	}
	if stats.TotalTokens > 0 {
		frame.TotalTokens = stats.TotalTokens
	}
}

func fetchProviderTokenStats(ctx context.Context, bin string) (map[string]ProviderTokenStats, bool) {
	now := time.Now().UTC()

	if cached, ok := tokenStatsCache.loadFresh(now); ok {
		return cached, true
	}

	// CodexBar writes its incremental cost scan before the CLI prints the final
	// JSON payload. Reading that cache keeps Usage responsive even when a very
	// large active session makes `cost --json` take longer than the foreground
	// budget. One longer scan continues in the background and refreshes both the
	// disk cache and this in-memory snapshot when it finishes.
	if cached, ok := loadProviderTokenStatsCacheFn(now); ok {
		tokenStatsCache.store(now, cached)
		startProviderTokenStatsRepair(ctx, bin, now)
		return copyProviderTokenStats(cached), true
	}

	raw, err := runCostCommandFn(ctx, tokenStatsCommandTimeout, bin, "cost", "--json")
	if err == nil {
		parsed, parseErr := parseProviderTokenStats(raw)
		if parseErr == nil && len(parsed) > 0 {
			tokenStatsCache.store(now, parsed)
			return parsed, true
		}
		err = fmt.Errorf("parse codexbar cost --json: %w", parseErr)
	}

	// A first run can create the incremental cache before it reaches stdout.
	// Pick it up immediately instead of waiting for the next collector cycle.
	if cached, ok := loadProviderTokenStatsCacheFn(now); ok {
		tokenStatsCache.store(now, cached)
		startProviderTokenStatsRepair(ctx, bin, now)
		return copyProviderTokenStats(cached), true
	}

	if cached, ok := tokenStatsCache.loadStale(now); ok {
		startProviderTokenStatsRepair(ctx, bin, now)
		return cached, true
	}

	startProviderTokenStatsRepair(ctx, bin, now)
	_ = err
	return nil, false
}

func startProviderTokenStatsRepair(parent context.Context, bin string, now time.Time) {
	tokenStatsRepair.Lock()
	if tokenStatsRepair.running || now.Before(tokenStatsRepair.nextAttempt) {
		tokenStatsRepair.Unlock()
		return
	}
	tokenStatsRepair.running = true
	tokenStatsRepair.nextAttempt = now.Add(tokenStatsRepairCooldown)
	tokenStatsRepair.Unlock()

	run := runCostCommandFn
	if parent == nil {
		parent = context.Background()
	} else {
		parent = context.WithoutCancel(parent)
	}
	go func() {
		defer func() {
			tokenStatsRepair.Lock()
			tokenStatsRepair.running = false
			tokenStatsRepair.Unlock()
		}()

		ctx, cancel := context.WithTimeout(parent, tokenStatsRepairTimeout)
		defer cancel()
		raw, err := run(ctx, tokenStatsRepairTimeout, bin, "cost", "--json")
		if err != nil {
			return
		}
		parsed, err := parseProviderTokenStats(raw)
		if err != nil || len(parsed) == 0 {
			return
		}
		tokenStatsCache.store(time.Now().UTC(), parsed)
	}()
}

func (c *providerTokenStatsCache) loadFresh(now time.Time) (map[string]ProviderTokenStats, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	if c.fetched.IsZero() || now.Sub(c.fetched) > tokenStatsRefreshInterval || len(c.provider) == 0 {
		return nil, false
	}
	return copyProviderTokenStats(c.provider), true
}

func (c *providerTokenStatsCache) loadStale(now time.Time) (map[string]ProviderTokenStats, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	if c.fetched.IsZero() || now.Sub(c.fetched) > tokenStatsStaleMaxAge || len(c.provider) == 0 {
		return nil, false
	}
	return copyProviderTokenStats(c.provider), true
}

func (c *providerTokenStatsCache) store(fetched time.Time, stats map[string]ProviderTokenStats) {
	if len(stats) == 0 {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.fetched = fetched
	c.provider = copyProviderTokenStats(stats)
}

func copyProviderTokenStats(in map[string]ProviderTokenStats) map[string]ProviderTokenStats {
	if len(in) == 0 {
		return nil
	}
	out := make(map[string]ProviderTokenStats, len(in))
	for key, value := range in {
		out[key] = value
	}
	return out
}

func parseProviderTokenStats(raw []byte) (map[string]ProviderTokenStats, error) {
	providers, err := extractProvidersFromRawJSON(raw)
	if err != nil {
		return nil, err
	}
	if len(providers) == 0 {
		return nil, ErrNoProviders
	}

	parsed := make(map[string]ProviderTokenStats, len(providers))
	for _, providerAny := range providers {
		payload, ok := providerAny.(map[string]any)
		if !ok {
			continue
		}

		key, stats, ok := parseProviderTokenStatsPayload(payload)
		if !ok {
			continue
		}
		parsed[key] = stats
	}

	if len(parsed) == 0 {
		return nil, ErrUnexpectedProviderShape
	}
	return parsed, nil
}

func parseProviderTokenStatsPayload(payload map[string]any) (string, ProviderTokenStats, bool) {
	key := strings.TrimSpace(strings.ToLower(firstString(payload, "provider", "id", "slug", "name")))
	if key == "" {
		return "", ProviderTokenStats{}, false
	}

	stats := ProviderTokenStats{
		SessionTokens: int64AtPaths(payload, "sessionTokens"),
		TotalTokens:   tokenTotalAtPaths(payload, "totals.totalTokens", "totalTokens"),
		Source:        firstString(payload, "source"),
	}

	if updatedAtRaw := firstString(payload, "updatedAt"); updatedAtRaw != "" {
		if updatedAt, err := time.Parse(time.RFC3339, updatedAtRaw); err == nil {
			stats.UpdatedAt = updatedAt.UTC()
		}
	}
	stats.WeekTokens = weekTokenTotal(payload, stats.UpdatedAt)
	if cost, ok := parseProviderCostUsagePayload(payload, stats.SessionTokens, stats.UpdatedAt); ok {
		stats.Cost = &cost
	}
	if !stats.HasAny() {
		return "", ProviderTokenStats{}, false
	}

	return key, stats, true
}

func parseProviderCostUsagePayload(payload map[string]any, fallbackLatestTokens int64, fallbackUpdatedAt time.Time) (ProviderCostUsage, bool) {
	daily := parseProviderCostDays(payload["daily"])
	cost := ProviderCostUsage{
		CurrencyCode: strings.TrimSpace(firstString(payload, "currencyCode", "currency")),
		Daily:        daily,
	}
	if cost.CurrencyCode == "" {
		cost.CurrencyCode = "USD"
	}
	if updatedAt := firstRFC3339AtPaths(payload, "updatedAt", "updated_at"); !updatedAt.IsZero() {
		cost.UpdatedAt = updatedAt.UTC()
	} else if !fallbackUpdatedAt.IsZero() {
		cost.UpdatedAt = fallbackUpdatedAt.UTC()
	}

	if value, ok := floatAtPaths(payload, "last30DaysCostUSD", "totals.totalCost", "totalCost"); ok {
		cost.Last30DaysCostUSD = value
	}
	cost.Last30DaysTokens = int64AtPaths(payload, "last30DaysTokens", "totals.totalTokens", "totalTokens")
	cost.LatestTokens = int64AtPaths(payload, "latestTokens", "sessionTokens")
	if cost.LatestTokens == 0 {
		cost.LatestTokens = fallbackLatestTokens
	}
	cost.TopModel = strings.TrimSpace(firstString(payload, "topModel"))
	if cost.TopModel == "" {
		cost.TopModel = topModelFromCostDays(daily)
	}

	if cost.Last30DaysCostUSD <= 0 {
		for _, day := range daily {
			cost.Last30DaysCostUSD += day.TotalCostUSD
		}
	}
	if cost.Last30DaysTokens <= 0 {
		for _, day := range daily {
			cost.Last30DaysTokens += day.TotalTokens
		}
	}

	anchor := cost.UpdatedAt
	if anchor.IsZero() {
		anchor = time.Now().UTC()
	}
	today := anchor.UTC().Format("2006-01-02")
	for _, day := range daily {
		if day.Day == today {
			cost.TodayCostUSD = day.TotalCostUSD
			break
		}
	}
	if cost.TodayCostUSD <= 0 {
		if value, ok := floatAtPaths(payload, "todayCostUSD", "sessionCostUSD"); ok {
			cost.TodayCostUSD = value
		}
	}

	if len(cost.Daily) == 0 &&
		cost.TodayCostUSD <= 0 &&
		cost.Last30DaysCostUSD <= 0 &&
		cost.Last30DaysTokens <= 0 &&
		cost.LatestTokens <= 0 &&
		cost.TopModel == "" {
		return ProviderCostUsage{}, false
	}
	return cost, true
}

func parseProviderCostDays(raw any) []ProviderCostDay {
	items, ok := raw.([]any)
	if !ok || len(items) == 0 {
		return nil
	}

	days := make([]ProviderCostDay, 0, len(items))
	for _, item := range items {
		dayMap, ok := item.(map[string]any)
		if !ok {
			continue
		}
		day := usageDayKey(firstString(dayMap, "date", "day", "dayKey"))
		if day == "" {
			continue
		}
		totalCost, _ := floatAtPaths(dayMap, "totalCostUSD", "totalCost", "cost")
		totalTokens := tokenTotalAtPaths(dayMap, "totalTokens")
		models := parseProviderCostModels(dayMap["modelBreakdowns"])
		if totalCost <= 0 && totalTokens <= 0 && len(models) == 0 {
			continue
		}
		days = append(days, ProviderCostDay{
			Day:          day,
			TotalCostUSD: totalCost,
			TotalTokens:  totalTokens,
			Models:       models,
		})
	}
	if len(days) == 0 {
		return nil
	}
	sort.Slice(days, func(i, j int) bool {
		return days[i].Day < days[j].Day
	})
	const maxCostHistoryDays = 30
	if len(days) > maxCostHistoryDays {
		days = days[len(days)-maxCostHistoryDays:]
	}
	return days
}

func parseProviderCostModels(raw any) []ProviderCostModel {
	items, ok := raw.([]any)
	if !ok || len(items) == 0 {
		return nil
	}

	models := make([]ProviderCostModel, 0, len(items))
	for _, item := range items {
		modelMap, ok := item.(map[string]any)
		if !ok {
			continue
		}
		name := strings.TrimSpace(firstString(modelMap, "modelName", "name", "model"))
		if name == "" {
			continue
		}
		cost, _ := floatAtPaths(modelMap, "costUSD", "cost", "totalCost")
		models = append(models, ProviderCostModel{
			Name:        name,
			TotalTokens: tokenTotalAtPaths(modelMap, "totalTokens"),
			CostUSD:     cost,
		})
	}
	if len(models) == 0 {
		return nil
	}
	sort.SliceStable(models, func(i, j int) bool {
		if models[i].TotalTokens == models[j].TotalTokens {
			if models[i].CostUSD == models[j].CostUSD {
				return strings.ToLower(models[i].Name) < strings.ToLower(models[j].Name)
			}
			return models[i].CostUSD > models[j].CostUSD
		}
		return models[i].TotalTokens > models[j].TotalTokens
	})
	const maxModelsPerCostDay = 8
	if len(models) > maxModelsPerCostDay {
		models = models[:maxModelsPerCostDay]
	}
	return models
}

func topModelFromCostDays(days []ProviderCostDay) string {
	type modelTotal struct {
		tokens int64
		cost   float64
	}
	totals := map[string]modelTotal{}
	for _, day := range days {
		for _, model := range day.Models {
			name := strings.TrimSpace(model.Name)
			if name == "" {
				continue
			}
			total := totals[name]
			total.tokens += model.TotalTokens
			total.cost += model.CostUSD
			totals[name] = total
		}
	}
	if len(totals) == 0 {
		return ""
	}

	names := make([]string, 0, len(totals))
	for name := range totals {
		names = append(names, name)
	}
	sort.SliceStable(names, func(i, j int) bool {
		left := totals[names[i]]
		right := totals[names[j]]
		if left.tokens == right.tokens {
			if left.cost == right.cost {
				return strings.ToLower(names[i]) < strings.ToLower(names[j])
			}
			return left.cost > right.cost
		}
		return left.tokens > right.tokens
	})
	return names[0]
}

func weekTokenTotal(payload map[string]any, updatedAt time.Time) int64 {
	dailyAny, ok := payload["daily"]
	if !ok {
		return 0
	}
	dailyList, ok := dailyAny.([]any)
	if !ok || len(dailyList) == 0 {
		return 0
	}

	anchor := updatedAt
	if anchor.IsZero() {
		anchor = time.Now().UTC()
	}
	cutoff := midnightUTC(anchor).AddDate(0, 0, -6)

	var total int64
	for _, dayAny := range dailyList {
		dayMap, ok := dayAny.(map[string]any)
		if !ok {
			continue
		}
		dayDateRaw := firstString(dayMap, "date")
		if dayDateRaw == "" {
			continue
		}
		dayDate, err := time.Parse("2006-01-02", dayDateRaw)
		if err != nil {
			continue
		}
		if dayDate.Before(cutoff) {
			continue
		}
		total += tokenTotalAtPaths(dayMap, "totalTokens")
	}

	return total
}

func midnightUTC(at time.Time) time.Time {
	at = at.UTC()
	return time.Date(at.Year(), at.Month(), at.Day(), 0, 0, 0, 0, time.UTC)
}

func tokenTotalAtPaths(m map[string]any, paths ...string) int64 {
	for _, p := range paths {
		if value := int64AtPaths(m, p); value > 0 {
			return value
		}
	}

	sum := int64(0)
	for _, key := range []string{
		"inputTokens",
		"outputTokens",
		"cacheReadTokens",
		"cacheCreationTokens",
		"reasoningTokens",
	} {
		sum += int64AtPaths(m, key)
	}
	return sum
}

func int64AtPaths(m map[string]any, paths ...string) int64 {
	for _, p := range paths {
		if v, ok := getPath(m, p); ok {
			if n, ok := anyToInt64(v); ok {
				if n < 0 {
					return 0
				}
				return n
			}
		}
	}
	return 0
}

func anyToInt64(v any) (int64, bool) {
	switch t := v.(type) {
	case float64:
		return int64(t), true
	case float32:
		return int64(t), true
	case int:
		return int64(t), true
	case int64:
		return t, true
	case int32:
		return int64(t), true
	case json.Number:
		i, err := t.Int64()
		if err != nil {
			return 0, false
		}
		return i, true
	case string:
		var n int64
		_, err := fmt.Sscanf(strings.TrimSpace(t), "%d", &n)
		if err != nil {
			return 0, false
		}
		return n, true
	default:
		return 0, false
	}
}
