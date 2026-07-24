package codexbar

import (
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

const tokenStatsCostCacheMaxAge = 24 * time.Hour

const (
	codexCostCacheArtifactVersion  = 10
	claudeCostCacheArtifactVersion = 5
	codexCostCacheProducerKey      = "codex:cu:p2d056ae5a24d5157"
)

type codexBarCostCache struct {
	Version        int                           `json:"version"`
	ProducerKey    string                        `json:"producerKey"`
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
		path, found, supported := supportedCostCachePath(cacheRoot, provider)
		if !found {
			continue
		}
		if !supported {
			return nil, false
		}
		raw, err := os.ReadFile(path)
		if err != nil {
			return nil, false
		}
		var cache codexBarCostCache
		if err := json.Unmarshal(raw, &cache); err != nil || cache.Version != 1 || len(cache.Days) == 0 {
			return nil, false
		}
		if provider == "codex" && cache.ProducerKey != codexCostCacheProducerKey {
			return nil, false
		}
		updatedAt := time.UnixMilli(cache.LastScanUnixMS).UTC()
		if updatedAt.IsZero() || updatedAt.After(now.Add(5*time.Minute)) || now.Sub(updatedAt) > tokenStatsCostCacheMaxAge {
			return nil, false
		}
		if updatedAt.In(time.Local).Format("2006-01-02") != now.In(time.Local).Format("2006-01-02") {
			return nil, false
		}
		if stats, ok := providerTokenStatsFromCostCache(provider, cache, updatedAt); ok {
			providers[provider] = stats
		} else {
			return nil, false
		}
	}
	return providers, len(providers) > 0
}

func supportedCostCachePath(cacheRoot, provider string) (path string, found bool, supported bool) {
	expectedVersion, ok := supportedCostCacheArtifactVersion(provider)
	if !ok {
		return "", false, false
	}
	paths, err := filepath.Glob(filepath.Join(cacheRoot, provider+"-v*.json"))
	if err != nil || len(paths) == 0 {
		return "", false, false
	}

	var expectedPath string
	var newestVersion int
	prefix := provider + "-v"
	for _, path := range paths {
		name := filepath.Base(path)
		versionText := strings.TrimSuffix(strings.TrimPrefix(name, prefix), ".json")
		version, err := strconv.Atoi(versionText)
		if err != nil || version <= 0 {
			return "", true, false
		}
		if version > newestVersion {
			newestVersion = version
		}
		if version == expectedVersion {
			expectedPath = path
		}
	}
	if newestVersion != expectedVersion || expectedPath == "" {
		return "", true, false
	}
	return expectedPath, true, true
}

func supportedCostCacheArtifactVersion(provider string) (int, bool) {
	switch provider {
	case "codex":
		return codexCostCacheArtifactVersion, true
	case "claude":
		return claudeCostCacheArtifactVersion, true
	default:
		return 0, false
	}
}

func providerTokenStatsFromCostCache(provider string, cache codexBarCostCache, updatedAt time.Time) (ProviderTokenStats, bool) {
	anchor := updatedAt.In(time.Local)
	anchorDay := anchor.Format("2006-01-02")
	windowStart := anchor.AddDate(0, 0, -29).Format("2006-01-02")
	days := make([]ProviderCostDay, 0, len(cache.Days))
	for dayKey, packedModels := range cache.Days {
		day := usageDayKey(dayKey)
		if day == "" || day < windowStart || day > anchorDay || len(packedModels) == 0 {
			continue
		}
		models := make([]ProviderCostModel, 0, len(packedModels))
		var dayTokens int64
		for model, packed := range packedModels {
			tokens, layoutOK := packedTokenTotal(provider, packed)
			if !layoutOK {
				return ProviderTokenStats{}, false
			}
			if strings.TrimSpace(model) == "" || tokens <= 0 {
				continue
			}
			if tokens > math.MaxInt64-dayTokens {
				return ProviderTokenStats{}, false
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

	weekStart := anchor.AddDate(0, 0, -6).Format("2006-01-02")
	var latestTokens, weekTokens, totalTokens int64
	for _, day := range days {
		if day.TotalTokens > math.MaxInt64-totalTokens {
			return ProviderTokenStats{}, false
		}
		totalTokens += day.TotalTokens
		if day.Day == anchorDay {
			latestTokens = day.TotalTokens
		}
		if day.Day >= weekStart && day.Day <= anchorDay {
			if day.TotalTokens > math.MaxInt64-weekTokens {
				return ProviderTokenStats{}, false
			}
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

func packedTokenTotal(provider string, packed []int64) (int64, bool) {
	switch provider {
	case "codex":
		return codexPackedTokenTotal(packed)
	case "claude":
		return claudePackedTokenTotal(packed)
	default:
		return 0, false
	}
}

func codexPackedTokenTotal(packed []int64) (int64, bool) {
	// Codex v10 stores [input, cached input, output]. Cached input is already
	// included in input, so adding index 1 again inflates the CLI-equivalent total.
	return sumPackedTokenIndices(packed, 3, 0, 2)
}

func claudePackedTokenTotal(packed []int64) (int64, bool) {
	// Claude v5 stores [input, cache read, cache create, output, cost nanos,
	// sample count, priced sample count, 1h cache create].
	return sumPackedTokenIndices(packed, 8, 0, 1, 2, 3)
}

func sumPackedTokenIndices(packed []int64, expectedLength int, indices ...int) (int64, bool) {
	if len(packed) != expectedLength {
		return 0, false
	}
	for _, value := range packed {
		if value < 0 {
			return 0, false
		}
	}

	var total int64
	for _, index := range indices {
		if packed[index] > math.MaxInt64-total {
			return 0, false
		}
		total += packed[index]
	}
	return total, true
}
