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

const (
	// Give codexbar cost --json its full source budget plus a small collector
	// margin, so the parent scan does not cancel at the same instant as the command.
	tokenStatsCollectorTimeout = 125 * time.Second
	// Cost history scans can take over a minute. Keep their post-completion
	// cadence below the ten-minute last-good window without running continuously.
	// This cadence applies only once a provider's history stopped growing;
	// see tokenStatsHistorySettled.
	tokenStatsScanCooldown = 5 * time.Minute
)

type providerSnapshot struct {
	Provider            string                     `json:"provider"`
	Frame               protocol.Frame             `json:"frame"`
	Source              string                     `json:"source,omitempty"`
	Meta                codexbar.ProviderUsageMeta `json:"meta,omitempty"`
	Collected           time.Time                  `json:"collectedAt"`
	TokenStatsCollected time.Time                  `json:"tokenStatsCollectedAt,omitempty"`
	TokenHistorySettled bool                       `json:"tokenHistorySettled,omitempty"`
	ActivityObservedAt  time.Time                  `json:"activityObservedAt,omitempty"`
	RateLimited         bool                       `json:"rateLimited,omitempty"`
	RateLimitedUntil    time.Time                  `json:"rateLimitedUntil,omitempty"`
}

type persistedProviderSnapshots struct {
	SavedAt   time.Time          `json:"savedAt"`
	Providers []providerSnapshot `json:"providers"`
}

type providerCollector struct {
	now                   func() time.Time
	logf                  func(string, ...any)
	fetchProviders        func(context.Context) ([]codexbar.ParsedFrame, error)
	fetchDashboard        func(context.Context, codexbar.DashboardServeInfo, time.Time) ([]codexbar.ParsedFrame, error)
	fetchInventory        func(context.Context) ([]codexbar.ProviderSetting, error)
	fetchTokenStats       func(context.Context) (map[string]codexbar.ProviderTokenStats, bool)
	fetchTokenStatsReport func(context.Context) (map[string]codexbar.ProviderTokenStats, codexbar.ProviderTokenStatsReport)
	dashboard             codexbar.DashboardServe
	resolvePort           func(string) (string, error)
	requestedPort         string
	requestedPortFn       func() string
	transportName         string
	order                 []string
	interval              time.Duration
	activityPoll          time.Duration
	timeout               time.Duration
	snapshotMaxAge        time.Duration
	persistInterval       time.Duration
	wake                  <-chan struct{}
	afterWakeCollect      func()

	mu                      sync.RWMutex
	providers               map[string]providerSnapshot
	lastPersistedRaw        string
	lastPersistedAt         time.Time
	inventoryKnown          bool
	inventoryEnabled        map[string]struct{}
	tokenStatsMu            sync.Mutex
	tokenStatsRunning       bool
	tokenStatsCancel        context.CancelFunc
	tokenStatsWG            sync.WaitGroup
	tokenStatsCooldown      time.Duration
	tokenStatsLastCompleted time.Time
	tokenStatsSettled       bool
	tokenHistoryPrints      map[string]string
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
		now:                   nowFn,
		logf:                  logFn,
		fetchProviders:        deps.fetchProviders,
		fetchDashboard:        deps.fetchDashboard,
		fetchInventory:        deps.fetchInventory,
		fetchTokenStats:       deps.fetchTokenStats,
		fetchTokenStatsReport: deps.fetchTokenStatsReport,
		dashboard:             deps.dashboard,
		resolvePort:           deps.resolvePort,
		requestedPort:         requestedDeviceTarget(opts),
		transportName:         usageSourceOrDefault(deps.transportName, "usb"),
		order:                 collectorProviderOrder(),
		interval:              collectorInterval(opts.Interval),
		activityPoll:          activityPollInterval(),
		timeout:               collectorProviderTimeout(),
		snapshotMaxAge:        providerSnapshotMaxAge(),
		persistInterval:       1 * time.Minute,
		tokenStatsCooldown:    tokenStatsScanCooldown,
		providers:             make(map[string]providerSnapshot),
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
	defer c.shutdownTokenStatsScan()
	c.collectOnce(ctx)
	c.requestTokenStatsScan(ctx)

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
			c.requestTokenStatsScan(ctx)
		case <-c.wake:
			c.collectOnce(ctx)
			c.requestTokenStatsScan(ctx)
			if c.afterWakeCollect != nil {
				c.afterWakeCollect()
			}
		case <-activityTicker.C:
			c.requestTokenStatsScan(ctx)
		}
	}
}

func (c *providerCollector) requestTokenStatsScan(parent context.Context) bool {
	if c == nil || c.fetchTokenStats == nil {
		return false
	}
	if parent == nil {
		parent = context.Background()
	}

	ctx, cancel := context.WithCancel(parent)
	c.tokenStatsMu.Lock()
	now := c.now().UTC()
	// A still-growing history must be corrected by the next scan instead of
	// waiting out the completed-scan cadence. Single-flight still prevents
	// overlapping scans.
	cooling := c.tokenStatsSettled &&
		c.tokenStatsCooldown > 0 &&
		!c.tokenStatsLastCompleted.IsZero() &&
		now.Before(c.tokenStatsLastCompleted.Add(c.tokenStatsCooldown))
	if c.tokenStatsRunning || cooling {
		c.tokenStatsMu.Unlock()
		cancel()
		return false
	}
	c.tokenStatsRunning = true
	c.tokenStatsCancel = cancel
	c.tokenStatsWG.Add(1)
	c.tokenStatsMu.Unlock()

	go func() {
		defer c.finishTokenStatsScan()
		c.collectTokenStatsOnce(ctx)
	}()
	return true
}

func (c *providerCollector) finishTokenStatsScan() {
	c.tokenStatsMu.Lock()
	c.tokenStatsLastCompleted = c.now().UTC()
	c.tokenStatsRunning = false
	c.tokenStatsCancel = nil
	c.tokenStatsMu.Unlock()
	c.tokenStatsWG.Done()
}

func (c *providerCollector) shutdownTokenStatsScan() {
	if c == nil {
		return
	}
	c.tokenStatsMu.Lock()
	cancel := c.tokenStatsCancel
	c.tokenStatsMu.Unlock()
	if cancel != nil {
		cancel()
	}
	c.tokenStatsWG.Wait()
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
	collectedAt := c.now().UTC()
	if err != nil {
		updated := false
		if inventoryAuthoritative {
			c.mu.Lock()
			updated = c.applyProviderInventoryLocked(inventory)
			c.mu.Unlock()
		}
		if updated {
			c.persistIfNeeded(collectedAt)
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
		parsedCollectedAt := parsedProviderCollectedAt(parsed, collectedAt)
		if frame.UsageUnavailable {
			lastGood, exists := c.providers[key]
			if exists && !lastGood.Frame.UsageUnavailable {
				if parsed.RateLimited || !parsed.RateLimitedUntil.IsZero() {
					lastGood.RateLimited = parsed.RateLimited
					lastGood.RateLimitedUntil = parsed.RateLimitedUntil.UTC()
					c.providers[key] = lastGood
					updated = true
				}
				if isLastGoodFreshAt(lastGood.Collected, collectedAt, c.snapshotMaxAge) {
					continue
				}
				lastGood.Frame.UsageUnavailable = true
				c.providers[key] = lastGood
			} else if !exists {
				c.providers[key] = providerSnapshot{
					Provider:         key,
					Frame:            frame,
					Source:           strings.TrimSpace(parsed.Source),
					Collected:        parsedCollectedAt,
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
			Collected:           parsedCollectedAt,
			TokenStatsCollected: parsedTokenStatsCollectedAt(parsed, now),
			ActivityObservedAt:  parsed.ActivityObservedAt,
			RateLimited:         false,
			RateLimitedUntil:    time.Time{},
		}
		if previous, exists := c.providers[key]; exists {
			// Only a token scan can change the history, so a quota collection
			// must never reset how settled that history already is.
			snapshot.TokenHistorySettled = previous.TokenHistorySettled
			carryForwardSnapshotTokenStats(previous, &snapshot, now, c.snapshotMaxAge)
		}
		c.providers[key] = snapshot
		successes++
		updated = true
	}
	c.mu.Unlock()

	if updated {
		c.persistIfNeeded(collectedAt)
	}
	c.logf("collector complete transport=%s source=%s fresh=true providers=%d succeeded=%d timeout=%s mode=fetch-all\n", usageSourceOrDefault(c.transportName, "usb"), sourceMode, len(allProviders), successes, c.timeout)
}

func parsedProviderCollectedAt(parsed codexbar.ParsedFrame, fallback time.Time) time.Time {
	if !parsed.CollectedAt.IsZero() {
		return parsed.CollectedAt.UTC()
	}
	return fallback.UTC()
}

func (c *providerCollector) fetchProvidersForCollect(ctx context.Context, now time.Time) ([]codexbar.ParsedFrame, string, error) {
	if c.dashboard != nil && c.fetchDashboard != nil {
		info := c.dashboard.Info()
		if strings.TrimSpace(info.Endpoint) != "" && info.Running {
			providers, err := c.fetchDashboard(ctx, info, now)
			if err == nil {
				return providers, "codexbar-dashboard", nil
			}
			c.logf("collector dashboard-unavailable source=codexbar-dashboard err=%v\n", err)
			return nil, "codexbar-dashboard", err
		}
		return nil, "codexbar-dashboard", errors.New("dashboard serve unavailable")
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
	if c == nil || (c.fetchTokenStats == nil && c.fetchTokenStatsReport == nil) {
		return
	}

	ctx := parent
	cancel := func() {}
	if _, ok := parent.Deadline(); !ok {
		var timeoutCancel context.CancelFunc
		ctx, timeoutCancel = context.WithTimeout(parent, tokenStatsCollectorTimeout)
		cancel = timeoutCancel
	}
	defer cancel()

	statsByProvider, report := c.fetchTokenStatsWithReport(ctx)
	if !report.OK {
		c.logTokenStatsReport(report, 0)
		return
	}

	now := c.now().UTC()
	updated := 0
	settled := true

	c.mu.Lock()
	prints := make(map[string]string, len(statsByProvider))
	seen := make(map[string]struct{}, len(statsByProvider)+len(report.FailedProviders))
	for _, provider := range report.FailedProviders {
		if key := normalizeProviderKey(provider); key != "" {
			seen[key] = struct{}{}
		}
	}
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

		print := tokenHistoryFingerprint(stats.Cost, now)
		prints[key] = print
		previousPrint, hadPrevious := c.tokenHistoryPrints[key]
		// Without a cost history there is nothing that can still grow, so such
		// a provider must not keep the collector scanning.
		providerSettled := stats.Cost == nil || (hadPrevious && previousPrint == print)
		settled = settled && providerSettled

		c.providers[key] = providerSnapshot{
			Provider:  key,
			Frame:     frame,
			Source:    source,
			Meta:      meta,
			Collected: snapshot.Collected,
			// A successful scan makes these totals current even when CodexBar
			// reports that no new activity occurred. UpdatedAt remains the
			// activity timestamp above, not the token-stat freshness timestamp.
			TokenStatsCollected: now,
			TokenHistorySettled: providerSettled,
			ActivityObservedAt:  activityObservedAt,
			RateLimited:         snapshot.RateLimited,
			RateLimitedUntil:    snapshot.RateLimitedUntil,
		}
		updated++
	}
	c.tokenHistoryPrints = prints
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

	c.tokenStatsMu.Lock()
	c.tokenStatsSettled = settled
	c.tokenStatsMu.Unlock()

	if updated > 0 {
		c.persistIfNeeded(now)
	}
	c.logTokenStatsReport(report, updated)
}

func (c *providerCollector) fetchTokenStatsWithReport(ctx context.Context) (map[string]codexbar.ProviderTokenStats, codexbar.ProviderTokenStatsReport) {
	if c.fetchTokenStatsReport != nil {
		return c.fetchTokenStatsReport(ctx)
	}
	statsByProvider, ok := c.fetchTokenStats(ctx)
	report := codexbar.ProviderTokenStatsReport{
		OK:            ok,
		ProviderCount: len(statsByProvider),
	}
	if ok {
		report.Reason = "success"
	} else {
		report.Reason = "unavailable"
	}
	return statsByProvider, report
}

func (c *providerCollector) logTokenStatsReport(report codexbar.ProviderTokenStatsReport, accepted int) {
	if c == nil || c.logf == nil {
		return
	}
	reason := strings.TrimSpace(report.Reason)
	if reason == "" {
		if report.OK {
			reason = "success"
		} else {
			reason = "unavailable"
		}
	}
	c.logf(
		"collector token-stats fresh=%t providers=%d accepted=%d reason=%s binary=%s version=%s cost=%s parse=%s timeout=%s\n",
		report.OK,
		report.ProviderCount,
		accepted,
		reason,
		report.BinaryDuration.Round(time.Millisecond),
		report.VersionDuration.Round(time.Millisecond),
		report.CostDuration.Round(time.Millisecond),
		report.ParseDuration.Round(time.Millisecond),
		tokenStatsCollectorTimeout,
	)
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
	next.TokenHistorySettled = previous.TokenHistorySettled
	if next.ActivityObservedAt.IsZero() {
		next.ActivityObservedAt = previous.ActivityObservedAt
	}
}

// tokenHistoryFingerprint identifies the finished part of a provider's history.
// CodexBar warms its cost scan incrementally and reports every intermediate
// result as a success, so a history that stops changing is the only available
// completeness signal. Today is excluded because a warming scan fills in older
// days while ordinary usage only moves today, which would otherwise keep an
// active provider permanently unsettled.
func tokenHistoryFingerprint(cost *codexbar.ProviderCostUsage, now time.Time) string {
	if cost == nil {
		return ""
	}
	today := now.UTC().Format("2006-01-02")
	var print strings.Builder
	for _, day := range cost.Daily {
		if day.Day == today {
			continue
		}
		print.WriteString(day.Day)
		print.WriteByte(':')
		print.WriteString(strconv.FormatInt(day.TotalTokens, 10))
		print.WriteByte(';')
	}
	return print.String()
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
	snapshot.TokenHistorySettled = false
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

func snapshotWithExpiredUsageCleared(snapshot providerSnapshot, now time.Time, maxAge time.Duration) providerSnapshot {
	if isLastGoodFreshAt(snapshot.Collected, now, maxAge) {
		return snapshot
	}
	if !snapshotTokenStatsFresh(snapshot, now, maxAge) {
		clearSnapshotTokenStats(&snapshot)
	}

	frame := snapshot.Frame.Normalize()
	frame.UsageUnavailable = true
	frame.SessionUnavailable = true
	frame.WeeklyUnavailable = true
	frame.Session = 0
	frame.Weekly = 0
	frame.ResetSec = 0
	frame.UsageWindows = nil
	frame.UsageSlots = nil
	snapshot.Frame = frame
	meta := snapshot.Meta
	meta.Windows = nil
	meta.Credits = nil
	meta.ResetCredits = nil
	meta.Pace = nil
	meta.OverTime = nil
	snapshot.Meta = meta
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
		snapshot = snapshotWithExpiredUsageCleared(snapshot, now, c.snapshotMaxAge)
		frame := snapshot.Frame.Normalize()
		frame.Provider = normalizeProviderKey(frame.Provider)
		if frame.Provider == "" {
			frame.Provider = key
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
	return providerSnapshotIsFresh(snapshot, now, c.snapshotMaxAge)
}

func providerSnapshotIsFresh(snapshot providerSnapshot, now time.Time, maxAge time.Duration) bool {
	return isLastGoodFreshAt(snapshot.Collected, now, maxAge)
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
