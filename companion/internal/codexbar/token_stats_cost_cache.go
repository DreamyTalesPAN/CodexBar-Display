package codexbar

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const tokenStatsCostCacheMaxAge = 24 * time.Hour

type codexBarCostCache struct {
	Version        int                           `json:"version"`
	LastScanUnixMS int64                         `json:"lastScanUnixMs"`
	Days           map[string]map[string][]int64 `json:"days"`
}

func loadProviderTokenStatsFromCostCache(now time.Time) (map[string]ProviderTokenStats, bool) {
	cacheRoot, err := os.UserCacheDir()
	if err != nil || strings.TrimSpace(cacheRoot) == "" {
		return nil, false
	}
	return loadProviderTokenStatsFromCostCacheAt(filepath.Join(cacheRoot, "CodexBar", "cost-usage"), now)
}

func loadProviderTokenStatsFromCostCacheAt(cacheRoot string, now time.Time) (map[string]ProviderTokenStats, bool) {
	providers := make(map[string]ProviderTokenStats, 2)
	for _, provider := range []string{"codex", "claude"} {
		path, ok := newestCostCachePath(cacheRoot, provider)
		if !ok {
			continue
		}
		raw, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		var cache codexBarCostCache
		if err := json.Unmarshal(raw, &cache); err != nil || cache.Version != 1 || len(cache.Days) == 0 {
			continue
		}
		updatedAt := time.UnixMilli(cache.LastScanUnixMS).UTC()
		if updatedAt.IsZero() || updatedAt.After(now.Add(5*time.Minute)) || now.Sub(updatedAt) > tokenStatsCostCacheMaxAge {
			continue
		}
		if stats, ok := providerTokenStatsFromCostCache(provider, cache, updatedAt); ok {
			providers[provider] = stats
		}
	}
	return providers, len(providers) > 0
}

func newestCostCachePath(cacheRoot, provider string) (string, bool) {
	paths, err := filepath.Glob(filepath.Join(cacheRoot, provider+"-v*.json"))
	if err != nil || len(paths) == 0 {
		return "", false
	}
	sort.Slice(paths, func(i, j int) bool {
		left, leftErr := os.Stat(paths[i])
		right, rightErr := os.Stat(paths[j])
		if leftErr != nil {
			return false
		}
		if rightErr != nil {
			return true
		}
		return left.ModTime().After(right.ModTime())
	})
	return paths[0], true
}

func providerTokenStatsFromCostCache(provider string, cache codexBarCostCache, updatedAt time.Time) (ProviderTokenStats, bool) {
	days := make([]ProviderCostDay, 0, len(cache.Days))
	for dayKey, packedModels := range cache.Days {
		day := usageDayKey(dayKey)
		if day == "" || len(packedModels) == 0 {
			continue
		}
		models := make([]ProviderCostModel, 0, len(packedModels))
		var dayTokens int64
		for model, packed := range packedModels {
			tokens := packedTokenTotal(provider, packed)
			if strings.TrimSpace(model) == "" || tokens <= 0 {
				continue
			}
			models = append(models, ProviderCostModel{Name: model, TotalTokens: tokens})
			dayTokens += tokens
		}
		if dayTokens <= 0 {
			continue
		}
		sort.SliceStable(models, func(i, j int) bool {
			if models[i].TotalTokens == models[j].TotalTokens {
				return strings.ToLower(models[i].Name) < strings.ToLower(models[j].Name)
			}
			return models[i].TotalTokens > models[j].TotalTokens
		})
		if len(models) > 8 {
			models = models[:8]
		}
		days = append(days, ProviderCostDay{Day: day, TotalTokens: dayTokens, Models: models})
	}
	if len(days) == 0 {
		return ProviderTokenStats{}, false
	}
	sort.Slice(days, func(i, j int) bool { return days[i].Day < days[j].Day })
	if len(days) > 30 {
		days = days[len(days)-30:]
	}

	anchorDay := updatedAt.Format("2006-01-02")
	weekStart := updatedAt.AddDate(0, 0, -6).Format("2006-01-02")
	var latestTokens, weekTokens, totalTokens int64
	for _, day := range days {
		totalTokens += day.TotalTokens
		if day.Day == anchorDay {
			latestTokens = day.TotalTokens
		}
		if day.Day >= weekStart && day.Day <= anchorDay {
			weekTokens += day.TotalTokens
		}
	}
	if latestTokens == 0 {
		latestTokens = days[len(days)-1].TotalTokens
	}
	cost := ProviderCostUsage{
		CurrencyCode:     "USD",
		UpdatedAt:        updatedAt,
		Last30DaysTokens: totalTokens,
		LatestTokens:     latestTokens,
		TopModel:         topModelFromCostDays(days),
		Daily:            days,
	}
	return ProviderTokenStats{
		SessionTokens: latestTokens,
		WeekTokens:    weekTokens,
		TotalTokens:   totalTokens,
		UpdatedAt:     updatedAt,
		Source:        "codexbar-cost-cache",
		Cost:          &cost,
	}, true
}

func packedTokenTotal(provider string, packed []int64) int64 {
	indices := []int{0, 1, 2}
	if provider == "claude" {
		indices = []int{0, 1, 2, 3}
	}
	var total int64
	for _, index := range indices {
		if index < len(packed) && packed[index] > 0 {
			total += packed[index]
		}
	}
	return total
}
