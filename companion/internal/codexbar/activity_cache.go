package codexbar

import (
	"sync"
	"time"
)

const defaultActivityCacheTTL = 30 * time.Second

type localActivityCache struct {
	mu      sync.Mutex
	key     string
	expires time.Time
	signals map[string]providerActivitySignal
}

var providerActivityCache localActivityCache

func activityCacheTTL() time.Duration {
	return parsePositiveDurationEnv("VIBEBLOCK_ACTIVITY_CACHE_TTL", defaultActivityCacheTTL)
}

func copyProviderSignals(in map[string]providerActivitySignal) map[string]providerActivitySignal {
	if len(in) == 0 {
		return map[string]providerActivitySignal{}
	}
	out := make(map[string]providerActivitySignal, len(in))
	for k, v := range in {
		out[k] = v
	}
	return out
}

func (c *localActivityCache) get(key string, now time.Time) (map[string]providerActivitySignal, bool) {
	if c == nil {
		return nil, false
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.key == "" || c.key != key || c.expires.IsZero() || !now.Before(c.expires) || c.signals == nil {
		return nil, false
	}
	return copyProviderSignals(c.signals), true
}

func (c *localActivityCache) put(key string, signals map[string]providerActivitySignal, expires time.Time) {
	if c == nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.key = key
	c.expires = expires
	c.signals = copyProviderSignals(signals)
}
