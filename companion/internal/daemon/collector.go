package daemon

import (
	"context"
	"strings"
	"sync"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
)

type providerSnapshot struct {
	Provider  string         `json:"provider"`
	Frame     protocol.Frame `json:"frame"`
	Source    string         `json:"source,omitempty"`
	Collected time.Time      `json:"collectedAt"`
}

type persistedProviderSnapshots struct {
	SavedAt   time.Time          `json:"savedAt"`
	Providers []providerSnapshot `json:"providers"`
}

type retryBackoff struct {
	base    time.Duration
	max     time.Duration
	current time.Duration
}

type providerCollector struct {
	now             func() time.Time
	logf            func(string, ...any)
	fetchProviders  func(context.Context) ([]codexbar.ParsedFrame, error)
	order           []string
	interval        time.Duration
	timeout         time.Duration
	snapshotMaxAge  time.Duration
	persistInterval time.Duration

	mu               sync.RWMutex
	providers        map[string]providerSnapshot
	lastPersistedRaw string
	lastPersistedAt  time.Time
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
		order:           collectorProviderOrder(),
		interval:        collectorInterval(opts.Interval),
		timeout:         collectorProviderTimeout(),
		snapshotMaxAge:  providerSnapshotMaxAge(),
		persistInterval: 1 * time.Minute,
		providers:       make(map[string]providerSnapshot),
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

	ticker := time.NewTicker(c.interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			c.collectOnce(ctx)
		}
	}
}

func (c *providerCollector) collectOnce(parent context.Context) {
	if c == nil || c.fetchProviders == nil {
		return
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

	allProviders, err := c.fetchProviders(ctx)
	if err != nil {
		c.logf("collector fetch-all err=%v timeout=%s\n", err, c.timeout)
		return
	}

	updated := false
	successes := 0

	c.mu.Lock()
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

		frame.Provider = key
		snapshot := providerSnapshot{
			Provider:  key,
			Frame:     frame,
			Source:    strings.TrimSpace(parsed.Source),
			Collected: now.UTC(),
		}
		c.providers[key] = snapshot
		successes++
		updated = true
	}
	c.mu.Unlock()

	if updated {
		c.persistIfNeeded(now)
	}
	c.logf("collector complete providers=%d succeeded=%d timeout=%s mode=fetch-all\n", len(allProviders), successes, c.timeout)
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
		if !snapshot.Collected.IsZero() && !isLastGoodFreshAt(snapshot.Collected, now, c.snapshotMaxAge) {
			continue
		}

		frame := snapshot.Frame.Normalize()
		frame.Provider = normalizeProviderKey(frame.Provider)
		if frame.Provider == "" {
			frame.Provider = key
		}
		frames = append(frames, codexbar.ParsedFrame{
			Frame:    frame,
			Provider: key,
			Source:   snapshot.Source,
		})
	}
	return frames
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
	if encoded == "" {
		return
	}
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

func newRetryBackoff(interval time.Duration) *retryBackoff {
	max := 30 * time.Second
	if interval > 0 && interval < max {
		max = interval
	}
	if max <= 0 {
		max = time.Second
	}
	base := time.Second
	if max < base {
		base = max
	}
	return &retryBackoff{
		base: base,
		max:  max,
	}
}

func (b *retryBackoff) Next() time.Duration {
	if b == nil {
		return time.Second
	}
	if b.current <= 0 {
		b.current = b.base
		return b.current
	}
	next := b.current * 2
	if next > b.max {
		next = b.max
	}
	b.current = next
	return b.current
}

func (b *retryBackoff) Reset() {
	if b == nil {
		return
	}
	b.current = 0
}
