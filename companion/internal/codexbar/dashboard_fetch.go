package codexbar

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"runtime"
	"strings"
	"sync"
	"time"

	dashboardusage "github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar/dashboard"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
)

const (
	dashboardSnapshotPath = "/dashboard/v1/snapshot"
	dashboardUsagePath    = "/usage"
)

var dashboardUsageByProvider = runtime.GOOS == "windows"

// serveUsage is the usage answer the long-running serve gave the collector
// last: one item per provider, in the form "usage --json" prints it. The
// recordings in testdata/cli show the two forms are the same, for the pinned
// Mac CLI and for Win-CodexBar.
var serveUsage struct {
	mu sync.Mutex
	// at and maxAge are the snapshot's own: when serve generated it and how
	// long serve calls it current. A serve that still answers but no longer
	// refreshes must not stand in for a probe.
	at     time.Time
	maxAge time.Duration
	items  map[string]json.RawMessage
	// forgotten counts forgetServeUsage, so that a read which began before a
	// provider switch does not bring the earlier answer back after it.
	forgotten int
}

// serveUsageMaxAge is how long serve's answer stands in for a probe when the
// snapshot names no limit of its own. Serve is read every 30 to 60 s and one
// read may take as long as its slowest provider.
const serveUsageMaxAge = 2 * time.Minute

type serveReadingKey struct{}

// WithServeReading marks a check nobody asked for: the status and settings
// polls of an open window. Such a check is answered from serve's last reading
// instead of a second usage call for the same providers (#555). Every check a
// customer starts stays without the mark and asks the CLI.
func WithServeReading(ctx context.Context) context.Context {
	return context.WithValue(ctx, serveReadingKey{}, true)
}

// UsesServeReading reports the mark of WithServeReading.
func UsesServeReading(ctx context.Context) bool {
	return ctx.Value(serveReadingKey{}) != nil
}

// serveUsageAnswer is what a usage probe of the switched-on providers would
// print, taken from serve's last reading. It answers only a marked check, only
// while the reading is current, and only when every switched-on provider is
// in it: a provider that was just switched on is probed as before.
func serveUsageAnswer(ctx context.Context, settings []ProviderSetting) ([]byte, bool) {
	if !UsesServeReading(ctx) {
		return nil, false
	}
	serveUsage.mu.Lock()
	defer serveUsage.mu.Unlock()
	if age := time.Since(serveUsage.at); age < 0 || age > serveUsage.maxAge {
		return nil, false
	}
	var items []json.RawMessage
	for _, setting := range settings {
		if !setting.Enabled {
			continue
		}
		item, ok := serveUsage.items[setting.ID]
		if !ok {
			return nil, false
		}
		items = append(items, item)
	}
	if len(items) == 0 {
		return nil, false
	}
	raw, err := json.Marshal(items)
	return raw, err == nil
}

// forgetServeUsage ends the reading: a serve read that failed and a provider
// switch both leave the next check to the CLI.
func forgetServeUsage() {
	serveUsage.mu.Lock()
	defer serveUsage.mu.Unlock()
	serveUsage.at, serveUsage.items = time.Time{}, nil
	serveUsage.forgotten++
}

// serveUsageItem is one provider's item of serve's answer, or false when the
// item does not say what the collector made of it: then the CLI is asked. A
// failure serve reports in its snapshot only is carried in the item.
func serveUsageItem(provider dashboardusage.DashboardProvider, item map[string]any, usable bool) (json.RawMessage, bool) {
	if !providerPayloadHasError(item) {
		var failure any
		if json.Unmarshal(provider.Error, &failure) == nil && failure != nil {
			item = map[string]any{"provider": provider.ID, "error": failure}
		}
	}
	if item == nil || !providerPayloadHasError(item) && providerPayloadHasUsage(item) != usable {
		return nil, false
	}
	raw, err := json.Marshal(item)
	return raw, err == nil
}

func FetchDashboardProviders(ctx context.Context, info DashboardServeInfo, now time.Time) (_ []ParsedFrame, err error) {
	defer func() {
		if err != nil {
			forgetServeUsage()
		}
	}()
	serveUsage.mu.Lock()
	forgotten := serveUsage.forgotten
	serveUsage.mu.Unlock()
	endpoint := strings.TrimRight(strings.TrimSpace(info.Endpoint), "/")
	if endpoint == "" || strings.TrimSpace(info.Token) == "" || !info.Running || !info.Healthy {
		return nil, fmt.Errorf("dashboard serve unavailable")
	}
	if now.IsZero() {
		now = time.Now().UTC()
	}

	snapshotRaw, err := fetchDashboardJSON(ctx, endpoint+dashboardSnapshotPath, strings.TrimSpace(info.Token))
	if err != nil {
		return nil, err
	}
	snapshot, err := dashboardusage.DecodeSnapshot(snapshotRaw)
	if err != nil {
		return nil, fmt.Errorf("decode dashboard snapshot: %w", err)
	}
	// On macOS, omitting the override selects the configured enabled set,
	// just like the dashboard. Win-CodexBar 0.60.3 instead defaults to Claude,
	// and its explicit "all" fetches every provider it knows, switched on or
	// not: on every collection it looked for browser cookies of providers the
	// customer never chose and started the Antigravity CLI (#554). So ask it
	// for exactly the providers the snapshot lists (see #415).
	usageQueries := []string{""}
	if dashboardUsageByProvider {
		usageQueries = usageQueries[:0]
		for _, provider := range snapshot.Providers {
			usageQueries = append(usageQueries, "?provider="+url.QueryEscape(provider.ID))
		}
	}
	var usageProviders []dashboardusage.UsageProvider
	usageItems := make(map[string]map[string]any)
	for _, query := range usageQueries {
		usageRaw, err := fetchDashboardJSON(ctx, endpoint+dashboardUsagePath+query, strings.TrimSpace(info.Token))
		if err != nil {
			return nil, err
		}
		decoded, err := dashboardusage.DecodeUsage(usageRaw)
		if err != nil {
			return nil, fmt.Errorf("decode dashboard usage: %w", err)
		}
		usageProviders = append(usageProviders, decoded...)
		items, _ := extractProvidersFromRawJSON(usageRaw)
		for _, item := range items {
			if payload, ok := item.(map[string]any); ok {
				usageItems[strings.ToLower(strings.TrimSpace(firstString(payload, "provider")))] = payload
			}
		}
	}

	snapshotCollectedAt := time.Time{}
	if snapshot.GeneratedAt != nil {
		snapshotCollectedAt = snapshot.GeneratedAt.UTC()
	}
	out := make([]ParsedFrame, 0, len(snapshot.Providers))
	readings := make(map[string]json.RawMessage, len(snapshot.Providers))
	for _, provider := range snapshot.Providers {
		usage, usageOK := dashboardusage.UsageForProvider(usageProviders, provider.ID)
		parsed := parsedFrameFromDashboardProvider(
			provider,
			dashboardusage.NormalizeProvider(provider, usage),
			now,
			snapshotCollectedAt,
			usage.Error,
		)
		if !usageOK {
			parsed.Frame.UsageUnavailable = true
			parsed.Frame.UsageWindows = nil
			parsed.Frame.UsageSlots = nil
			parsed.Frame.Session = 0
			parsed.Frame.Weekly = 0
			parsed.Frame.ResetSec = 0
			parsed.Frame = parsed.Frame.Normalize()
			parsed.Meta.Windows = nil
			parsed.Stale = true
		}
		out = append(out, parsed)
		id := strings.ToLower(strings.TrimSpace(provider.ID))
		if item, ok := serveUsageItem(provider, usageItems[id], !parsed.Frame.UsageUnavailable); ok {
			readings[id] = item
		}
	}
	serveUsage.mu.Lock()
	if serveUsage.forgotten == forgotten {
		serveUsage.at, serveUsage.maxAge, serveUsage.items = time.Now(), serveUsageMaxAge, readings
		if snapshot.GeneratedAt != nil {
			serveUsage.at = *snapshot.GeneratedAt
		}
		if snapshot.StaleAfterSeconds > 0 {
			serveUsage.maxAge = time.Duration(snapshot.StaleAfterSeconds) * time.Second
		}
	}
	serveUsage.mu.Unlock()
	return out, nil
}

func fetchDashboardJSON(ctx context.Context, url string, token string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return nil, fmt.Errorf("GET %s returned HTTP %d", req.URL.Path, resp.StatusCode)
	}
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	return raw, nil
}

func parsedFrameFromDashboardProvider(provider dashboardusage.DashboardProvider, normalized dashboardusage.ProviderWindows, now time.Time, collectedAt time.Time, usageError json.RawMessage) ParsedFrame {
	id := strings.TrimSpace(strings.ToLower(provider.ID))
	label := strings.TrimSpace(provider.Name)
	if label == "" {
		label = humanLabel(id)
	}
	countdownAt := collectedAt
	if countdownAt.IsZero() {
		countdownAt = now
	}
	metaWindows := usageWindowsFromDashboardWindows(normalized.Windows, countdownAt)
	windows := usageWindowsFromWindows(metaWindows)
	frame := protocol.Frame{
		V:            protocol.ProtocolVersionV2,
		Provider:     id,
		Label:        label,
		UsageWindows: windows,
	}
	if len(windows) > 0 {
		frame.Session = windows[0].Percent
		frame.ResetSec = windows[0].ResetSec
	}
	if len(windows) > 1 {
		frame.Weekly = windows[1].Percent
	}
	if normalized.Unavailable {
		frame.UsageUnavailable = true
		frame.UsageWindows = nil
		frame.Session = 0
		frame.Weekly = 0
		frame.ResetSec = 0
	}
	frame = frame.Normalize()
	activityObservedAt := time.Time{}
	if normalized.UpdatedAt != nil {
		activityObservedAt = normalized.UpdatedAt.UTC()
	}
	return ParsedFrame{
		Frame:              frame.Normalize(),
		Provider:           id,
		Source:             "codexbar-dashboard",
		Meta:               ProviderUsageMeta{Windows: metaWindows},
		CollectedAt:        collectedAt.UTC(),
		ActivityObservedAt: activityObservedAt,
		Stale:              frame.UsageUnavailable,
		Terminal:           providerErrorJSONIsTerminal(provider.Error) || providerErrorJSONIsTerminal(usageError),
	}
}

func providerErrorJSONIsTerminal(raw json.RawMessage) bool {
	var value any
	if len(raw) == 0 || json.Unmarshal(raw, &value) != nil {
		return false
	}
	return providerErrorIsTerminal(providerHealthErrorText(value))
}

func usageWindowsFromDashboardWindows(windows []dashboardusage.UsageWindow, now time.Time) []UsageWindow {
	if len(windows) == 0 {
		return nil
	}
	out := make([]UsageWindow, 0, len(windows))
	for _, window := range windows {
		resetSec := int64(0)
		if window.ResetAt != nil {
			if d := window.ResetAt.Sub(now); d > 0 {
				resetSec = int64(d.Seconds())
			}
		}
		windowMinutes := 0
		if window.WindowMinutes != nil {
			windowMinutes = *window.WindowMinutes
		}
		out = append(out, UsageWindow{
			ID:            window.ID,
			Label:         window.Label,
			UsedPercent:   int(math.Round(window.UsedPercent)),
			ResetSec:      resetSec,
			WindowMinutes: windowMinutes,
		})
	}
	return out
}
