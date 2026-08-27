package codexbar

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
)

// Local token-history scans are source-bound. Measured cold history on
// 2026-07-29 took about 78s, so keep the command budget above that instead of
// assuming the fast quota path's latency.
const tokenStatsCommandTimeout = 120 * time.Second

// tokenStatsHistoryDays is the history window this product presents. CodexBar
// names its window total `last30DaysTokens` for every window length, so the
// window has to be requested explicitly instead of inherited from whatever the
// last scan used.
const tokenStatsHistoryDays = "30"

// tokenStatsCostArgs asks CodexBar for a complete scan of that window.
// `codexbar cost --json` returns cached scan results unless `--refresh` is
// given, so without it a warming or shorter-window cache entry would be
// presented as the finished history.
var tokenStatsCostArgs = []string{"cost", "--json", "--refresh", "--days", tokenStatsHistoryDays}

type ProviderTokenStats struct {
	SessionTokens int64
	WeekTokens    int64
	TotalTokens   int64
	UpdatedAt     time.Time
	Source        string
	Cost          *ProviderCostUsage
}

type ProviderTokenStatsReport struct {
	OK              bool
	Reason          string
	ProviderCount   int
	FailedProviders []string
	BinaryDuration  time.Duration
	VersionDuration time.Duration
	CostDuration    time.Duration
	ParseDuration   time.Duration
}

func (s ProviderTokenStats) HasAny() bool {
	return s.SessionTokens > 0 || s.WeekTokens > 0 || s.TotalTokens > 0 || s.Cost != nil
}

func FetchProviderTokenStats(ctx context.Context) (map[string]ProviderTokenStats, bool) {
	stats, report := FetchProviderTokenStatsWithReport(ctx)
	return stats, report.OK
}

func FetchProviderTokenStatsWithReport(ctx context.Context) (map[string]ProviderTokenStats, ProviderTokenStatsReport) {
	report := ProviderTokenStatsReport{}
	binaryStarted := time.Now()
	bin, err := FindBinary()
	report.BinaryDuration = time.Since(binaryStarted)
	if err != nil {
		report.Reason = "binary"
		return nil, report
	}

	versionStarted := time.Now()
	if err := CheckMinimumVersion(ctx, bin); err != nil {
		report.VersionDuration = time.Since(versionStarted)
		report.Reason = "version"
		return nil, report
	}
	report.VersionDuration = time.Since(versionStarted)
	return fetchProviderTokenStatsWithReport(ctx, bin, report)
}

func fetchProviderTokenStats(ctx context.Context, bin string) (map[string]ProviderTokenStats, bool) {
	stats, report := fetchProviderTokenStatsWithReport(ctx, bin, ProviderTokenStatsReport{})
	return stats, report.OK
}

func fetchProviderTokenStatsWithReport(ctx context.Context, bin string, report ProviderTokenStatsReport) (map[string]ProviderTokenStats, ProviderTokenStatsReport) {
	costStarted := time.Now()
	raw, err := runCostCommandFn(ctx, tokenStatsCommandTimeout, bin, tokenStatsCostArgs...)
	report.CostDuration = time.Since(costStarted)
	if err != nil {
		report.Reason = tokenStatsFailureReason(ctx, err, report.CostDuration, tokenStatsCommandTimeout, "cost")
		return nil, report
	}

	parseStarted := time.Now()
	parsed, failedProviders, err := parseProviderTokenStatsWithFailures(raw)
	report.ParseDuration = time.Since(parseStarted)
	if errors.Is(err, ErrNoProviders) {
		report.OK = true
		report.Reason = "no_providers"
		return map[string]ProviderTokenStats{}, report
	}
	if err != nil {
		report.Reason = "parse"
		return nil, report
	}
	report.OK = true
	report.Reason = "success"
	report.ProviderCount = len(parsed)
	report.FailedProviders = failedProviders
	return parsed, report
}

func tokenStatsFailureReason(ctx context.Context, err error, elapsed, timeout time.Duration, fallback string) string {
	if ctx != nil {
		switch ctx.Err() {
		case context.DeadlineExceeded:
			return "timeout"
		case context.Canceled:
			return "canceled"
		}
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return "timeout"
	}
	if errors.Is(err, context.Canceled) {
		return "canceled"
	}
	if timeout > 0 && elapsed >= timeout-time.Second {
		return "timeout"
	}
	return fallback
}

func parseProviderTokenStats(raw []byte) (map[string]ProviderTokenStats, error) {
	parsed, _, err := parseProviderTokenStatsWithFailures(raw)
	return parsed, err
}

func parseProviderTokenStatsWithFailures(raw []byte) (map[string]ProviderTokenStats, []string, error) {
	providers, err := extractProvidersFromRawJSON(raw)
	if err != nil {
		return nil, nil, err
	}
	if len(providers) == 0 {
		return nil, nil, ErrNoProviders
	}

	parsed := make(map[string]ProviderTokenStats, len(providers))
	failed := make(map[string]struct{})
	for _, providerAny := range providers {
		payload, ok := providerAny.(map[string]any)
		if !ok {
			continue
		}
		key := strings.TrimSpace(strings.ToLower(firstString(payload, "provider", "id", "slug", "name")))
		if key != "" && providerPayloadHasError(payload) {
			failed[key] = struct{}{}
			continue
		}

		key, stats, ok := parseProviderTokenStatsPayload(payload)
		if !ok {
			continue
		}
		parsed[key] = stats
	}

	if len(parsed) == 0 {
		return nil, nil, ErrUnexpectedProviderShape
	}
	failedProviders := make([]string, 0, len(failed))
	for key := range failed {
		failedProviders = append(failedProviders, key)
	}
	sort.Strings(failedProviders)
	return parsed, failedProviders, nil
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
		cost.TopModel == "" &&
		!providerTokenStatsPayloadHasResult(payload) {
		return ProviderCostUsage{}, false
	}
	return cost, true
}

func providerTokenStatsPayloadHasResult(payload map[string]any) bool {
	if providerPayloadHasError(payload) {
		return false
	}
	for _, key := range []string{
		"daily",
		"totals",
		"sessionTokens",
		"latestTokens",
		"last30DaysTokens",
		"totalTokens",
	} {
		if _, ok := payload[key]; ok {
			return true
		}
	}
	return false
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
