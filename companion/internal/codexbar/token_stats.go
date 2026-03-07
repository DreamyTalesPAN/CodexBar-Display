package codexbar

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
)

const (
	tokenStatsRefreshInterval = 60 * time.Second
	tokenStatsStaleMaxAge     = 15 * time.Minute
	tokenStatsCommandTimeout  = 12 * time.Second
)

type ProviderTokenStats struct {
	SessionTokens int64
	WeekTokens    int64
	TotalTokens   int64
	UpdatedAt     time.Time
	Source        string
}

func (s ProviderTokenStats) HasAny() bool {
	return s.SessionTokens > 0 || s.WeekTokens > 0 || s.TotalTokens > 0
}

type providerTokenStatsCache struct {
	mu       sync.RWMutex
	fetched  time.Time
	provider map[string]ProviderTokenStats
}

var tokenStatsCache providerTokenStatsCache

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
	return parsed
}

func applyTokenStatsToFrame(frame *protocol.Frame, stats ProviderTokenStats) {
	frame.SessionTokens = stats.SessionTokens
	frame.WeekTokens = stats.WeekTokens
	frame.TotalTokens = stats.TotalTokens
}

func fetchProviderTokenStats(ctx context.Context, bin string) (map[string]ProviderTokenStats, bool) {
	now := time.Now().UTC()

	if cached, ok := tokenStatsCache.loadFresh(now); ok {
		return cached, true
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

	if cached, ok := tokenStatsCache.loadStale(now); ok {
		return cached, true
	}

	_ = err
	return nil, false
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
	if !stats.HasAny() {
		return "", ProviderTokenStats{}, false
	}

	return key, stats, true
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
