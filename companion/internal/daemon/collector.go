package daemon

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
)

const tokenStatsCollectorTimeout = 60 * time.Second

type providerSnapshot struct {
	Provider            string                     `json:"provider"`
	Frame               protocol.Frame             `json:"frame"`
	Source              string                     `json:"source,omitempty"`
	Meta                codexbar.ProviderUsageMeta `json:"meta,omitempty"`
	Collected           time.Time                  `json:"collectedAt"`
	TokenStatsCollected time.Time                  `json:"tokenStatsCollectedAt,omitempty"`
	ActivityObservedAt  time.Time                  `json:"activityObservedAt,omitempty"`
	RateLimited         bool                       `json:"rateLimited,omitempty"`
	RateLimitedUntil    time.Time                  `json:"rateLimitedUntil,omitempty"`
}

type persistedProviderSnapshots struct {
	SavedAt   time.Time          `json:"savedAt"`
	Providers []providerSnapshot `json:"providers"`
}

type providerCollector struct {
	now              func() time.Time
	logf             func(string, ...any)
	fetchProviders   func(context.Context) ([]codexbar.ParsedFrame, error)
	fetchDashboard   func(context.Context, codexbar.DashboardServeInfo, time.Time, int) (codexbar.DashboardFetchResult, error)
	fetchInventory   func(context.Context) ([]codexbar.ProviderSetting, error)
	fetchTokenStats  func(context.Context) (map[string]codexbar.ProviderTokenStats, bool)
	dashboard        codexbar.DashboardServe
	resolvePort      func(string) (string, error)
	requestedPort    string
	requestedPortFn  func() string
	transportName    string
	order            []string
	interval         time.Duration
	activityPoll     time.Duration
	timeout          time.Duration
	snapshotMaxAge   time.Duration
	persistInterval  time.Duration
	wake             <-chan struct{}
	afterWakeCollect func()

	mu                       sync.RWMutex
	providers                map[string]providerSnapshot
	lastPersistedRaw         string
	lastPersistedAt          time.Time
	dashboardProcessKey      string
	dashboardSnapshotFetches int
	inventoryKnown           bool
	inventoryEnabled         map[string]struct{}
}

func newProviderCollector(deps runtimeDeps, opts Options) *providerCollector {
	nowFn := deps.now
	if nowFn == nil {
		nowFn = wallClockNow
	}
	logFn := deps.logf
	if logFn == nil {
		logFn = defaultRuntimeLogf
	}

	collector := &providerCollector{
		now:             nowFn,
		logf:            logFn,
		fetchProviders:  deps.fetchProviders,
		fetchDashboard:  deps.fetchDashboard,
		fetchInventory:  deps.fetchInventory,
		fetchTokenStats: deps.fetchTokenStats,
		dashboard:       deps.dashboard,
		resolvePort:     deps.resolvePort,
		requestedPort:   requestedDeviceTarget(opts),
		transportName:   usageSourceOrDefault(deps.transportName, "usb"),
		order:           collectorProviderOrder(),
		interval:        collectorInterval(opts.Interval),
		activityPoll:    activityPollInterval(),
		timeout:         collectorProviderTimeout(),
		snapshotMaxAge:  providerSnapshotMaxAge(),
		persistInterval: 1 * time.Minute,
		providers:       make(map[string]providerSnapshot),
	}
	if normalizeTransportName(opts.Transport) == "wifi" || deps.transportName == "wifi" {
		collector.requestedPortFn = func() string {
			return effectiveCycleTarget(requestedDeviceTarget(opts), nil, deps)
		}
	}

	if loaded, savedAt, ok := loadPersistedProviderSnapshotsAnyAge(); ok {
		collector.providers = loaded
		collector.lastPersistedAt = savedAt
		if raw := encodeProviderSnapshotsForCompare(loaded); raw != "" {
			collector.lastPersistedRaw = raw
		}
	}
	return collector
}

func (c *providerCollector) start(ctx context.Context) {
	if c == nil {
		return
	}
	go c.run(ctx)
}

func (c *providerCollector) run(ctx context.Context) {
	if c == nil {
		return
	}
	c.collectOnce(ctx)

	usageTicker := time.NewTicker(c.interval)
	defer usageTicker.Stop()
	activityTicker := time.NewTicker(c.activityPoll)
	defer activityTicker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-usageTicker.C:
			c.collectOnce(ctx)
		case <-c.wake:
			c.collectOnce(ctx)
			if c.afterWakeCollect != nil {
				c.afterWakeCollect()
			}
		case <-activityTicker.C:
			c.collectTokenStatsOnce(ctx)
		}
	}
}

func (c *providerCollector) collectOnce(parent context.Context) {
	if c == nil {
		return
	}
	if c.resolvePort != nil {
		requestedPort := c.resolveRequestedPort()
		if _, err := c.resolvePort(requestedPort); err != nil {
			c.logf("collector paused reason=no-device transport=%s target=%s err=%v\n", usageSourceOrDefault(c.transportName, "usb"), requestedPort, err)
			return
		}
	}

	now := c.now()
	ctx := parent
	cancel := func() {}
	if c.timeout > 0 {
		var timeoutCancel context.CancelFunc
		ctx, timeoutCancel = context.WithTimeout(parent, c.timeout)
		cancel = timeoutCancel
	}
	defer cancel()

	allProviders, sourceMode, err := c.fetchProvidersForCollect(ctx, now)
	var inventory []codexbar.ProviderSetting
	inventoryAuthoritative := false
	if c.fetchInventory != nil {
		if current, inventoryErr := c.fetchInventory(ctx); inventoryErr == nil {
			inventory = current
			inventoryAuthoritative = true
		}
	}
	if err != nil {
		updated := false
		if inventoryAuthoritative {
			c.mu.Lock()
			updated = c.applyProviderInventoryLocked(inventory)
			c.mu.Unlock()
		}
		if updated {
			c.persistIfNeeded(now)
		}
		c.logf("collector fetch-all transport=%s source=%s fresh=false err=%v timeout=%s\n", usageSourceOrDefault(c.transportName, "usb"), sourceMode, err, c.timeout)
		return
	}

	updated := false
	successes := 0
	var authoritativeEnabled map[string]struct{}

	c.mu.Lock()
	if inventoryAuthoritative {
		updated = c.applyProviderInventoryLocked(inventory)
		_, authoritativeEnabled = enabledProviderInventory(inventory)
	} else {
		c.order = mergeProviderOrder(providerOrderFromFrames(allProviders), c.order)
	}
	for _, parsed := range allProviders {
		frame := parsed.Frame.Normalize()
		if strings.TrimSpace(frame.Error) != "" {
			continue
		}

		key := normalizeProviderKey(parsed.Provider)
		if key == "" {
			key = normalizeProviderKey(parsed.Frame.Provider)
		}
		if key == "" {
			continue
		}
		if inventoryAuthoritative {
			if _, enabled := authoritativeEnabled[key]; !enabled {
				continue
			}
		}

		frame.Provider = key
		if frame.UsageUnavailable {
			lastGood, exists := c.providers[key]
			if exists && !lastGood.Frame.UsageUnavailable {
				if parsed.RateLimited || !parsed.RateLimitedUntil.IsZero() {
					lastGood.RateLimited = parsed.RateLimited
					lastGood.RateLimitedUntil = parsed.RateLimitedUntil.UTC()
					c.providers[key] = lastGood
					updated = true
				}
				if isLastGoodFreshAt(lastGood.Collected, now, c.snapshotMaxAge) {
					continue
				}
				lastGood.Frame.UsageUnavailable = true
				c.providers[key] = lastGood
			} else if !exists {
				c.providers[key] = providerSnapshot{
					Provider:         key,
					Frame:            frame,
					Source:           strings.TrimSpace(parsed.Source),
					Collected:        parsed.CollectedAt.UTC(),
					RateLimited:      parsed.RateLimited,
					RateLimitedUntil: parsed.RateLimitedUntil.UTC(),
				}
			}
			updated = true
			continue
		}
		snapshot := providerSnapshot{
			Provider:            key,
			Frame:               frame,
			Source:              strings.TrimSpace(parsed.Source),
			Meta:                parsed.Meta,
			Collected:           now.UTC(),
			TokenStatsCollected: parsedTokenStatsCollectedAt(parsed, now),
			ActivityObservedAt:  parsed.ActivityObservedAt,
			RateLimited:         false,
			RateLimitedUntil:    time.Time{},
		}
		if previous, exists := c.providers[key]; exists {
			carryForwardSnapshotTokenStats(previous, &snapshot, now, c.snapshotMaxAge)
		}
		c.providers[key] = snapshot
		successes++
		updated = true
	}
	c.mu.Unlock()

	if updated {
		c.persistIfNeeded(now)
	}
	c.logf("collector complete transport=%s source=%s fresh=true providers=%d succeeded=%d timeout=%s mode=fetch-all\n", usageSourceOrDefault(c.transportName, "usb"), sourceMode, len(allProviders), successes, c.timeout)
}

func (c *providerCollector) fetchProvidersForCollect(ctx context.Context, now time.Time) ([]codexbar.ParsedFrame, string, error) {
	if c.dashboard != nil && c.fetchDashboard != nil {
		info := c.dashboard.Info()
		processKey := dashboardServeProcessKey(info)
		if processKey != "" {
			if processKey != c.dashboardProcessKey {
				c.dashboardProcessKey = processKey
				c.dashboardSnapshotFetches = 0
			}
			nextFetch := c.dashboardSnapshotFetches + 1
			result, err := c.fetchDashboard(ctx, info, now, nextFetch)
			if err == nil {
				c.dashboardSnapshotFetches = nextFetch
				if result.Cold {
					c.logf("collector dashboard-warmup source=codexbar-dashboard snapshotFetches=%d\n", c.dashboardSnapshotFetches)
				}
				return result.Providers, "codexbar-dashboard", nil
			}
			c.logf("collector dashboard-unavailable source=codexbar-dashboard fallback=usage-json err=%v\n", err)
		}
	}
	if c.fetchProviders == nil {
		return nil, "codexbar-usage-json", errors.New("usage provider fetcher unavailable")
	}
	providers, err := c.fetchProviders(ctx)
	return providers, "codexbar-usage-json", err
}

func (c *providerCollector) applyProviderInventoryLocked(settings []codexbar.ProviderSetting) bool {
	enabledOrder, enabled := enabledProviderInventory(settings)
	c.inventoryKnown = true
	c.inventoryEnabled = enabled
	updated := !equalProviderOrder(c.order, enabledOrder)
	c.order = enabledOrder
	for key := range c.providers {
		if _, keep := enabled[key]; keep {
			continue
		}
		delete(c.providers, key)
		updated = true
	}
	return updated
}

func (c *providerCollector) providerEnabledByInventory(provider string) (bool, bool) {
	if c == nil {
		return false, false
	}
	key := normalizeProviderKey(provider)
	if key == "" {
		return false, false
	}

	c.mu.RLock()
	defer c.mu.RUnlock()
	if !c.inventoryKnown {
		return false, false
	}
	_, enabled := c.inventoryEnabled[key]
	return enabled, true
}

func equalProviderOrder(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for i := range left {
		if left[i] != right[i] {
			return false
		}
	}
	return true
}

func enabledProviderInventory(settings []codexbar.ProviderSetting) ([]string, map[string]struct{}) {
	order := make([]string, 0, len(settings))
	enabled := make(map[string]struct{}, len(settings))
	for _, setting := range settings {
		if !setting.Enabled {
			continue
		}
		key := normalizeProviderKey(setting.ID)
		if key == "" {
			continue
		}
		if _, exists := enabled[key]; exists {
			continue
		}
		enabled[key] = struct{}{}
		order = append(order, key)
	}
	return order, enabled
}

func providerOrderFromFrames(frames []codexbar.ParsedFrame) []string {
	order := make([]string, 0, len(frames))
	seen := make(map[string]struct{}, len(frames))
	for _, frame := range frames {
		key := normalizeProviderKey(frame.Provider)
		if key == "" {
			key = normalizeProviderKey(frame.Frame.Provider)
		}
		if key == "" {
			continue
		}
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		order = append(order, key)
	}
	return order
}

func mergeProviderOrder(current, previous []string) []string {
	order := make([]string, 0, len(current)+len(previous))
	seen := make(map[string]struct{}, len(current)+len(previous))
	for _, key := range current {
		key = normalizeProviderKey(key)
		if key == "" {
			continue
		}
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		order = append(order, key)
	}
	for _, key := range previous {
		key = normalizeProviderKey(key)
		if key == "" {
			continue
		}
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		order = append(order, key)
	}
	return order
}

func (c *providerCollector) collectTokenStatsOnce(parent context.Context) {
	if c == nil || c.fetchTokenStats == nil {
		return
	}
	if c.resolvePort != nil {
		if _, err := c.resolvePort(c.resolveRequestedPort()); err != nil {
			return
		}
	}

	ctx := parent
	cancel := func() {}
	if _, ok := parent.Deadline(); !ok {
		var timeoutCancel context.CancelFunc
		ctx, timeoutCancel = context.WithTimeout(parent, tokenStatsCollectorTimeout)
		cancel = timeoutCancel
	}
	defer cancel()

	statsByProvider, ok := c.fetchTokenStats(ctx)
	if !ok || len(statsByProvider) == 0 {
		return
	}

	now := c.now().UTC()
	updated := 0

	c.mu.Lock()
	seen := make(map[string]struct{}, len(statsByProvider))
	for rawKey, stats := range statsByProvider {
		key := normalizeProviderKey(rawKey)
		if key == "" || !stats.HasAny() {
			continue
		}
		seen[key] = struct{}{}

		snapshot, exists := c.providers[key]
		if !exists {
			snapshot = providerSnapshot{
				Provider: key,
				Frame: protocol.Frame{
					Provider:         key,
					Label:            key,
					UsageUnavailable: true,
				},
				Source: strings.TrimSpace(stats.Source),
			}
		}
		frame := snapshot.Frame.Normalize()
		if strings.TrimSpace(frame.Provider) == "" {
			frame.Provider = key
		}
		if strings.TrimSpace(frame.Label) == "" {
			frame.Label = key
		}
		frame.SessionTokens = stats.SessionTokens
		frame.WeekTokens = stats.WeekTokens
		frame.TotalTokens = stats.TotalTokens
		meta := snapshot.Meta
		meta.Cost = stats.Cost

		source := strings.TrimSpace(snapshot.Source)
		if source == "" {
			source = strings.TrimSpace(stats.Source)
		}
		if source == "" {
			source = "codexbar-cost"
		}

		activityObservedAt := snapshot.ActivityObservedAt
		if !stats.UpdatedAt.IsZero() {
			activityObservedAt = stats.UpdatedAt.UTC()
		}

		c.providers[key] = providerSnapshot{
			Provider:            key,
			Frame:               frame,
			Source:              source,
			Meta:                meta,
			Collected:           snapshot.Collected,
			TokenStatsCollected: tokenStatsCollectedAt(stats, now),
			ActivityObservedAt:  activityObservedAt,
			RateLimited:         snapshot.RateLimited,
			RateLimitedUntil:    snapshot.RateLimitedUntil,
		}
		updated++
	}
	for key, snapshot := range c.providers {
		if _, ok := seen[key]; ok {
			continue
		}
		if !snapshotHasTokenStats(snapshot) {
			continue
		}
		clearSnapshotTokenStats(&snapshot)
		c.providers[key] = snapshot
		updated++
	}
	c.mu.Unlock()

	if updated > 0 {
		c.persistIfNeeded(now)
	}
}

func carryForwardSnapshotTokenStats(previous providerSnapshot, next *providerSnapshot, now time.Time, maxAge time.Duration) {
	if next == nil {
		return
	}
	if frameHasTokenStats(next.Frame) || next.Meta.Cost != nil {
		return
	}
	if !snapshotTokenStatsFresh(previous, now, maxAge) {
		return
	}
	prevFrame := previous.Frame.Normalize()
	next.Frame.SessionTokens = prevFrame.SessionTokens
	next.Frame.WeekTokens = prevFrame.WeekTokens
	next.Frame.TotalTokens = prevFrame.TotalTokens
	next.Meta.Cost = previous.Meta.Cost
	next.TokenStatsCollected = previous.TokenStatsCollected
	if next.ActivityObservedAt.IsZero() {
		next.ActivityObservedAt = previous.ActivityObservedAt
	}
}

func frameHasTokenStats(frame protocol.Frame) bool {
	return frame.SessionTokens > 0 || frame.WeekTokens > 0 || frame.TotalTokens > 0
}

func snapshotHasTokenStats(snapshot providerSnapshot) bool {
	return frameHasTokenStats(snapshot.Frame.Normalize()) || snapshot.Meta.Cost != nil
}

func clearSnapshotTokenStats(snapshot *providerSnapshot) {
	if snapshot == nil {
		return
	}
	snapshot.Frame.SessionTokens = 0
	snapshot.Frame.WeekTokens = 0
	snapshot.Frame.TotalTokens = 0
	snapshot.Meta.Cost = nil
	snapshot.TokenStatsCollected = time.Time{}
}

func tokenStatsCollectedAt(stats codexbar.ProviderTokenStats, fallback time.Time) time.Time {
	if !stats.UpdatedAt.IsZero() {
		return stats.UpdatedAt.UTC()
	}
	if stats.Cost != nil && !stats.Cost.UpdatedAt.IsZero() {
		return stats.Cost.UpdatedAt.UTC()
	}
	return fallback.UTC()
}

func parsedTokenStatsCollectedAt(parsed codexbar.ParsedFrame, fallback time.Time) time.Time {
	if frameHasTokenStats(parsed.Frame.Normalize()) || parsed.Meta.Cost != nil {
		if !parsed.ActivityObservedAt.IsZero() {
			return parsed.ActivityObservedAt.UTC()
		}
		if parsed.Meta.Cost != nil && !parsed.Meta.Cost.UpdatedAt.IsZero() {
			return parsed.Meta.Cost.UpdatedAt.UTC()
		}
		return fallback.UTC()
	}
	return time.Time{}
}

func snapshotTokenStatsFresh(snapshot providerSnapshot, now time.Time, maxAge time.Duration) bool {
	if !snapshotHasTokenStats(snapshot) {
		return false
	}
	return isLastGoodFreshAt(snapshot.TokenStatsCollected, now, maxAge)
}

func snapshotWithFreshTokenStats(snapshot providerSnapshot, now time.Time, maxAge time.Duration) providerSnapshot {
	if snapshotHasTokenStats(snapshot) && !snapshotTokenStatsFresh(snapshot, now, maxAge) {
		clearSnapshotTokenStats(&snapshot)
	}
	return snapshot
}

func (c *providerCollector) providerFrames(now time.Time) []codexbar.ParsedFrame {
	if c == nil {
		return nil
	}

	c.mu.RLock()
	defer c.mu.RUnlock()

	if len(c.providers) == 0 {
		return nil
	}

	var frames []codexbar.ParsedFrame
	for _, key := range c.orderedKeysLocked() {
		snapshot, ok := c.providers[key]
		if !ok {
			continue
		}
		snapshot = snapshotWithFreshTokenStats(snapshot, now, c.snapshotMaxAge)
		frame := snapshot.Frame.Normalize()
		frame.Provider = normalizeProviderKey(frame.Provider)
		if frame.Provider == "" {
			frame.Provider = key
		}
		if snapshot.Collected.IsZero() || !isLastGoodFreshAt(snapshot.Collected, now, c.snapshotMaxAge) {
			frame.UsageUnavailable = true
		}
		frames = append(frames, codexbar.ParsedFrame{
			Frame:              frame,
			Provider:           key,
			Source:             snapshot.Source,
			Meta:               snapshot.Meta,
			CollectedAt:        snapshot.Collected,
			ActivityObservedAt: snapshot.ActivityObservedAt,
			RateLimited:        snapshot.RateLimited,
			RateLimitedUntil:   snapshot.RateLimitedUntil,
			Stale:              frame.UsageUnavailable || !c.snapshotIsFresh(snapshot, now),
		})
	}
	return frames
}

func (c *providerCollector) resolveRequestedPort() string {
	if c == nil {
		return ""
	}
	if c.requestedPortFn != nil {
		return strings.TrimSpace(c.requestedPortFn())
	}
	return strings.TrimSpace(c.requestedPort)
}

func (c *providerCollector) snapshotIsFresh(snapshot providerSnapshot, now time.Time) bool {
	if snapshot.Collected.IsZero() || now.IsZero() {
		return false
	}
	age := now.Sub(snapshot.Collected)
	if age < 0 {
		return true
	}
	freshFor := c.interval + 5*time.Second
	if freshFor <= 5*time.Second {
		freshFor = 35 * time.Second
	}
	return age <= freshFor
}

func (c *providerCollector) orderedKeysLocked() []string {
	keys := make([]string, 0, len(c.providers))
	seen := make(map[string]struct{}, len(c.providers))
	for _, key := range c.order {
		key = normalizeProviderKey(key)
		if key == "" {
			continue
		}
		if _, ok := c.providers[key]; !ok {
			continue
		}
		keys = append(keys, key)
		seen[key] = struct{}{}
	}
	for key := range c.providers {
		if _, ok := seen[key]; ok {
			continue
		}
		keys = append(keys, key)
	}
	return keys
}

func (c *providerCollector) persistIfNeeded(now time.Time) {
	if c == nil {
		return
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	encoded := encodeProviderSnapshotsForCompare(c.providers)
	if c.lastPersistedRaw == encoded && !c.lastPersistedAt.IsZero() && now.Sub(c.lastPersistedAt) < c.persistInterval {
		return
	}

	if err := persistProviderSnapshots(c.providers, now); err != nil {
		c.logf("runtime event=provider-snapshot-persist-failed err=%v\n", err)
		return
	}
	c.lastPersistedRaw = encoded
	c.lastPersistedAt = now
}

func dashboardServeProcessKey(info codexbar.DashboardServeInfo) string {
	endpoint := strings.TrimSpace(info.Endpoint)
	if endpoint == "" || !info.Running {
		return ""
	}
	return endpoint + "#" + strconv.Itoa(info.PID)
}
