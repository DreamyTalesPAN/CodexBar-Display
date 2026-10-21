package daemon

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimepaths"
)

type persistedLastGood struct {
	SavedAt time.Time      `json:"savedAt"`
	Frame   protocol.Frame `json:"frame"`
}

type PersistedUsage struct {
	SavedAt         time.Time
	CurrentProvider string
	Providers       []ProviderUsageSnapshot
}

type ProviderUsageSnapshot struct {
	Provider              string
	Frame                 protocol.Frame
	Source                string
	Meta                  codexbar.ProviderUsageMeta
	CollectedAt           time.Time
	Retained              bool
	TokenStatsCollectedAt time.Time
	TokenHistorySettled   bool
	ActivityObservedAt    time.Time
	Stale                 bool
	Terminal              bool
	// NoReading: CollectedAt is the time of a failed reading, because this
	// provider has not delivered one yet.
	NoReading bool
}

func loadPersistedLastGood(now time.Time) (protocol.Frame, time.Time, bool) {
	frame, savedAt, ok := loadPersistedLastGoodAnyAge()
	if !ok {
		return protocol.Frame{}, time.Time{}, false
	}
	if !isLastGoodFreshAt(savedAt, now, lastGoodMaxAge()) {
		return protocol.Frame{}, time.Time{}, false
	}
	return frame, savedAt, true
}

func loadPersistedLastGoodAnyAge() (protocol.Frame, time.Time, bool) {
	path := lastGoodSnapshotPath()
	if path == "" {
		return protocol.Frame{}, time.Time{}, false
	}

	raw, err := os.ReadFile(path)
	if err != nil {
		return protocol.Frame{}, time.Time{}, false
	}

	var saved persistedLastGood
	if err := json.Unmarshal(raw, &saved); err != nil {
		return protocol.Frame{}, time.Time{}, false
	}

	frame := saved.Frame.Normalize()
	if strings.TrimSpace(frame.Error) != "" {
		return protocol.Frame{}, time.Time{}, false
	}
	return frame, saved.SavedAt, true
}

func persistLastGood(frame protocol.Frame, savedAt time.Time) error {
	if strings.TrimSpace(frame.Error) != "" || savedAt.IsZero() {
		return nil
	}

	path := lastGoodSnapshotPath()
	if path == "" {
		return nil
	}

	payload := persistedLastGood{
		SavedAt: savedAt.UTC(),
		Frame:   frame.Normalize(),
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, raw, 0o644)
}

func clearPersistedLastGood() error {
	path := lastGoodSnapshotPath()
	if path == "" {
		return nil
	}
	err := os.Remove(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

func lastGoodSnapshotPath() string {
	home, err := os.UserHomeDir()
	if err != nil || strings.TrimSpace(home) == "" {
		return ""
	}
	return runtimepaths.Path(home, "last-good-frame.json")
}

func providerSnapshotsPath() string {
	home, err := os.UserHomeDir()
	if err != nil || strings.TrimSpace(home) == "" {
		return ""
	}
	return runtimepaths.Path(home, "provider-snapshots.json")
}

func persistProviderSnapshots(snapshots map[string]providerSnapshot, cycle *CollectorCycle, savedAt time.Time) error {
	if savedAt.IsZero() {
		return nil
	}

	path := providerSnapshotsPath()
	if path == "" {
		return nil
	}

	payload := persistedProviderSnapshots{
		SavedAt:   savedAt.UTC(),
		Providers: make([]providerSnapshot, 0, len(snapshots)),
		LastCycle: cycle,
	}
	for _, key := range sortedSnapshotKeys(snapshots) {
		snapshot := snapshots[key]
		snapshot.Provider = normalizeProviderKey(snapshot.Provider)
		if snapshot.Provider == "" {
			snapshot.Provider = key
		}
		snapshot.Frame = snapshot.Frame.Normalize()
		if strings.TrimSpace(snapshot.Frame.Error) != "" {
			continue
		}
		payload.Providers = append(payload.Providers, snapshot)
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, raw, 0o644)
}

func loadPersistedProviderSnapshotsAnyAge() (map[string]providerSnapshot, time.Time, bool) {
	path := providerSnapshotsPath()
	if path == "" {
		return nil, time.Time{}, false
	}

	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, time.Time{}, false
	}

	var saved persistedProviderSnapshots
	if err := json.Unmarshal(raw, &saved); err != nil {
		return nil, time.Time{}, false
	}

	out := make(map[string]providerSnapshot, len(saved.Providers))
	for _, snapshot := range saved.Providers {
		key := normalizeProviderKey(snapshot.Provider)
		if key == "" {
			key = normalizeProviderKey(snapshot.Frame.Provider)
		}
		if key == "" {
			continue
		}
		snapshot.Provider = key
		snapshot.Frame = snapshot.Frame.Normalize()
		if strings.TrimSpace(snapshot.Frame.Error) != "" {
			continue
		}
		if snapshotHasTokenStats(snapshot) && snapshot.TokenStatsCollected.IsZero() {
			if !snapshot.ActivityObservedAt.IsZero() {
				snapshot.TokenStatsCollected = snapshot.ActivityObservedAt.UTC()
			} else {
				snapshot.TokenStatsCollected = snapshot.Collected.UTC()
			}
		}
		out[key] = snapshot
	}
	if len(out) == 0 {
		return nil, time.Time{}, false
	}
	return out, saved.SavedAt, true
}

// LoadCollectorCycle reads the last completed collection the collector
// stored beside its provider snapshots.
func LoadCollectorCycle() (CollectorCycle, bool) {
	raw, err := os.ReadFile(providerSnapshotsPath())
	if err != nil {
		return CollectorCycle{}, false
	}
	var saved persistedProviderSnapshots
	if err := json.Unmarshal(raw, &saved); err != nil || saved.LastCycle == nil {
		return CollectorCycle{}, false
	}
	return *saved.LastCycle, true
}

func LoadPersistedUsage(now time.Time) (PersistedUsage, bool) {
	snapshots, savedAt, ok := loadPersistedProviderSnapshotsAnyAge()
	if !ok || len(snapshots) == 0 {
		return PersistedUsage{}, false
	}
	if now.IsZero() {
		now = time.Now().UTC()
	}

	usage := PersistedUsage{
		SavedAt: savedAt.UTC(),
	}
	if frame, _, ok := loadPersistedLastGoodAnyAge(); ok {
		usage.CurrentProvider = normalizeProviderKey(frame.Provider)
	}

	for _, key := range orderedProviderUsageKeys(snapshots) {
		snapshot, ok := snapshots[key]
		if !ok {
			continue
		}
		snapshot = snapshotWithFreshTokenStats(snapshot, now, providerSnapshotMaxAge())
		snapshot = snapshotWithExpiredUsageCleared(snapshot, now, providerSnapshotMaxAge())
		frame := snapshot.Frame.Normalize()
		frame.Provider = normalizeProviderKey(frame.Provider)
		if frame.Provider == "" {
			frame.Provider = key
		}
		if frame.UsageMode == "" {
			frame.UsageMode = "used"
		}
		usage.Providers = append(usage.Providers, ProviderUsageSnapshot{
			Provider:              key,
			Frame:                 frame,
			Source:                strings.TrimSpace(snapshot.Source),
			Meta:                  snapshot.Meta,
			CollectedAt:           snapshot.Collected.UTC(),
			NoReading:             snapshot.NoReading,
			Terminal:              snapshot.Terminal,
			Retained:              snapshot.Retained,
			TokenStatsCollectedAt: snapshot.TokenStatsCollected.UTC(),
			TokenHistorySettled:   snapshot.TokenHistorySettled,
			ActivityObservedAt:    snapshot.ActivityObservedAt.UTC(),
			Stale:                 providerUsageSnapshotIsStale(snapshot, now),
		})
	}
	if len(usage.Providers) == 0 {
		return PersistedUsage{}, false
	}
	if usage.CurrentProvider == "" {
		usage.CurrentProvider = usage.Providers[0].Provider
	}
	return usage, true
}

func orderedProviderUsageKeys(snapshots map[string]providerSnapshot) []string {
	if len(snapshots) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(snapshots))
	keys := make([]string, 0, len(snapshots))
	for _, key := range collectorProviderOrder() {
		key = normalizeProviderKey(key)
		if key == "" {
			continue
		}
		if _, ok := snapshots[key]; !ok {
			continue
		}
		keys = append(keys, key)
		seen[key] = struct{}{}
	}
	remaining := make([]string, 0, len(snapshots)-len(keys))
	for key := range snapshots {
		if _, ok := seen[key]; ok {
			continue
		}
		remaining = append(remaining, key)
	}
	sort.Strings(remaining)
	return append(keys, remaining...)
}

func providerUsageSnapshotIsStale(snapshot providerSnapshot, now time.Time) bool {
	return snapshot.Retained || !providerSnapshotIsFresh(snapshot, now, providerSnapshotMaxAge())
}

func encodeProviderSnapshotsForCompare(snapshots map[string]providerSnapshot) string {
	ordered := make([]providerSnapshot, 0, len(snapshots))
	for _, key := range sortedSnapshotKeys(snapshots) {
		snapshot := snapshots[key]
		snapshot.Provider = normalizeProviderKey(snapshot.Provider)
		if snapshot.Provider == "" {
			snapshot.Provider = key
		}
		snapshot.Frame = snapshot.Frame.Normalize()
		if strings.TrimSpace(snapshot.Frame.Error) != "" {
			continue
		}
		ordered = append(ordered, snapshot)
	}
	raw, err := json.Marshal(ordered)
	if err != nil {
		return ""
	}
	return string(raw)
}

func sortedSnapshotKeys(snapshots map[string]providerSnapshot) []string {
	keys := make([]string, 0, len(snapshots))
	for key := range snapshots {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func isLastGoodFreshAt(lastGoodAt time.Time, now time.Time, maxAge time.Duration) bool {
	if lastGoodAt.IsZero() || now.IsZero() || maxAge <= 0 {
		return false
	}
	return now.Sub(lastGoodAt) <= maxAge
}

func lastGoodMaxAge() time.Duration {
	// If CodexBar requests fail for a short period, keep rendering the most recent good frame.
	d := 10 * time.Minute
	raw := os.Getenv("CODEXBAR_DISPLAY_LAST_GOOD_MAX_AGE")
	if raw == "" {
		return d
	}
	parsed, err := time.ParseDuration(raw)
	if err != nil || parsed <= 0 {
		return d
	}
	return parsed
}

func LastGoodMaxAge() time.Duration {
	return lastGoodMaxAge()
}
