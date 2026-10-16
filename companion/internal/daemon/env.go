package daemon

import (
	"os"
	"strconv"
	"strings"
	"time"
)

func defaultIntervalForTransport(transportName string) time.Duration {
	if strings.EqualFold(strings.TrimSpace(transportName), "wifi") {
		return defaultWiFiInterval
	}
	return defaultInterval
}

func coldStartFetchTimeout() time.Duration {
	const fallback = 2 * time.Second

	raw := strings.TrimSpace(os.Getenv(coldStartTimeoutEnvVar))
	if raw == "" {
		return fallback
	}

	n, err := strconv.Atoi(raw)
	if err != nil || n <= 0 {
		return fallback
	}
	return time.Duration(n) * time.Second
}

func collectorInterval(renderInterval time.Duration) time.Duration {
	const (
		min = 30 * time.Second
		max = 60 * time.Second
	)

	if override := parseSecondsEnv(collectorIntervalEnvVar, 0); override > 0 {
		if override < min {
			return min
		}
		if override > max {
			return max
		}
		return override
	}

	if renderInterval <= 0 {
		return max
	}
	if renderInterval < min {
		return min
	}
	if renderInterval > max {
		return max
	}
	return renderInterval
}

func activityPollInterval() time.Duration {
	const (
		def = 2 * time.Second
		min = 1 * time.Second
		max = 10 * time.Second
	)

	override := parseSecondsEnv(activityPollEnvVar, int(def.Seconds()))
	if override < min {
		return min
	}
	if override > max {
		return max
	}
	return override
}

func activityHoldDuration() time.Duration {
	const (
		def = 180 * time.Second
		min = 5 * time.Second
		max = 600 * time.Second
	)

	override := parseSecondsEnv(activityHoldEnvVar, int(def.Seconds()))
	if override < min {
		return min
	}
	if override > max {
		return max
	}
	return override
}

func activityCodingMaxAge() time.Duration {
	const (
		def = 5 * time.Minute
		min = 30 * time.Second
		max = 30 * time.Minute
	)

	override := parseSecondsEnv(activityCodingMaxAgeEnvVar, int(def.Seconds()))
	if override < min {
		return min
	}
	if override > max {
		return max
	}
	return override
}

func activityIdleEvidenceRequired() int {
	const (
		def = 2
		min = 1
		max = 10
	)

	raw := strings.TrimSpace(os.Getenv(activityIdleEvidenceEnvVar))
	if raw == "" {
		return def
	}
	parsed, err := strconv.Atoi(raw)
	if err != nil {
		return def
	}
	if parsed < min {
		return min
	}
	if parsed > max {
		return max
	}
	return parsed
}

func cycleRunTimeout() time.Duration {
	const (
		min = 5 * time.Second
		max = 600 * time.Second
	)

	override := parseSecondsEnv(cycleTimeoutEnvVar, int(defaultCycleTimeout.Seconds()))
	if override < min {
		return min
	}
	if override > max {
		return max
	}
	return override
}

func collectorProviderTimeout() time.Duration {
	const (
		def = 600 * time.Second
		min = 60 * time.Second
		max = 900 * time.Second
	)

	override := parseSecondsEnv(collectorTimeoutEnvVar, int(def.Seconds()))
	if override < min {
		return min
	}
	if override > max {
		return max
	}
	return override
}

func collectorProviderOrder() []string {
	raw := strings.TrimSpace(os.Getenv(collectorOrderEnvVar))
	if raw == "" {
		return nil
	}

	var out []string
	seen := make(map[string]struct{})
	for _, part := range strings.Split(raw, ",") {
		key := normalizeProviderKey(part)
		if key == "" {
			continue
		}
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, key)
	}
	return out
}

func providerSnapshotMaxAge() time.Duration {
	// Keep per-provider snapshots alive for stale-while-revalidate rendering.
	raw := strings.TrimSpace(os.Getenv(providerMaxAgeEnvVar))
	if raw == "" {
		return defaultProviderMaxAge
	}
	parsed, err := time.ParseDuration(raw)
	if err != nil || parsed <= 0 {
		return defaultProviderMaxAge
	}
	return parsed
}

func collectorWarmupMaxAge() time.Duration {
	// Bound the warm-up window in which a cycle waits for the first collection
	// instead of settling on a provider verdict. The bound must outlast the
	// five-minute CodexBar command budget plus the observed dashboard recovery
	// after that command. A definitive answer still ends warm-up immediately.
	const fallback = 7 * time.Minute
	raw := strings.TrimSpace(os.Getenv(collectorWarmupEnvVar))
	if raw == "" {
		return fallback
	}
	parsed, err := time.ParseDuration(raw)
	if err != nil || parsed <= 0 {
		return fallback
	}
	return parsed
}

func parseSecondsEnv(key string, fallback int) time.Duration {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return time.Duration(fallback) * time.Second
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n <= 0 {
		return time.Duration(fallback) * time.Second
	}
	return time.Duration(n) * time.Second
}

func normalizeProviderKey(raw string) string {
	return strings.TrimSpace(strings.ToLower(raw))
}
