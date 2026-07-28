package codexbar

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"strings"
	"time"

	dashboardusage "github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar/dashboard"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
)

const (
	dashboardSnapshotPath = "/dashboard/v1/snapshot"
	dashboardUsagePath    = "/usage"
)

type DashboardFetchResult struct {
	Providers []ParsedFrame
	Cold      bool
}

func FetchDashboardProviders(ctx context.Context, info DashboardServeInfo, now time.Time, snapshotFetches int) (DashboardFetchResult, error) {
	endpoint := strings.TrimRight(strings.TrimSpace(info.Endpoint), "/")
	if endpoint == "" || strings.TrimSpace(info.Token) == "" || !info.Running || !info.Healthy {
		return DashboardFetchResult{}, fmt.Errorf("dashboard serve unavailable")
	}
	if now.IsZero() {
		now = time.Now().UTC()
	}

	client := &http.Client{Timeout: dashboardServeHealthTimeout}
	snapshotRaw, err := fetchDashboardJSON(ctx, client, endpoint+dashboardSnapshotPath, strings.TrimSpace(info.Token))
	if err != nil {
		return DashboardFetchResult{}, err
	}
	usageRaw, err := fetchDashboardJSON(ctx, client, endpoint+dashboardUsagePath, "")
	if err != nil {
		return DashboardFetchResult{}, err
	}

	snapshot, err := dashboardusage.DecodeSnapshot(snapshotRaw)
	if err != nil {
		return DashboardFetchResult{}, fmt.Errorf("decode dashboard snapshot: %w", err)
	}
	usageProviders, err := dashboardusage.DecodeUsage(usageRaw)
	if err != nil {
		return DashboardFetchResult{}, fmt.Errorf("decode dashboard usage: %w", err)
	}

	coldSource := snapshotFetches < 2
	out := make([]ParsedFrame, 0, len(snapshot.Providers))
	for _, provider := range snapshot.Providers {
		usage, usageOK := dashboardusage.UsageForProvider(usageProviders, provider.ID)
		normalized := dashboardusage.NormalizeProvider(provider, usage)
		parsed := parsedFrameFromDashboardProvider(provider, normalized, now, usage.Error)
		if coldSource || provider.UpdatedAt == nil || !usageOK {
			parsed.Frame.UsageUnavailable = true
			parsed.Frame.UsageSlots = nil
			parsed.Frame.Session = 0
			parsed.Frame.Weekly = 0
			parsed.Frame.ResetSec = 0
			parsed.Meta.Windows = nil
			parsed.Stale = true
		}
		out = append(out, parsed)
	}
	return DashboardFetchResult{Providers: out, Cold: coldSource}, nil
}

func fetchDashboardJSON(ctx context.Context, client *http.Client, url string, token string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := client.Do(req)
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

func parsedFrameFromDashboardProvider(provider dashboardusage.DashboardProvider, normalized dashboardusage.ProviderWindows, now time.Time, usageError json.RawMessage) ParsedFrame {
	id := strings.TrimSpace(strings.ToLower(provider.ID))
	label := strings.TrimSpace(provider.Name)
	if label == "" {
		label = humanLabel(id)
	}
	metaWindows := usageWindowsFromDashboardWindows(normalized.Windows, now)
	slots := usageSlotsFromWindows(metaWindows)
	frame := protocol.Frame{
		V:          1,
		Provider:   id,
		Label:      label,
		UsageSlots: slots,
	}
	if len(slots) > 0 {
		frame.Session = slots[0].Percent
		frame.ResetSec = slots[0].ResetSec
	}
	if len(slots) > 1 {
		frame.Weekly = slots[1].Percent
	}
	if normalized.Unavailable {
		frame.UsageUnavailable = true
		frame.UsageSlots = nil
		frame.Session = 0
		frame.Weekly = 0
		frame.ResetSec = 0
	}
	activityObservedAt := time.Time{}
	if normalized.UpdatedAt != nil {
		activityObservedAt = normalized.UpdatedAt.UTC()
	}
	return ParsedFrame{
		Frame:              frame.Normalize(),
		Provider:           id,
		Source:             "codexbar-dashboard",
		Meta:               ProviderUsageMeta{Windows: metaWindows},
		CollectedAt:        now.UTC(),
		ActivityObservedAt: activityObservedAt,
		RateLimited:        dashboardErrorsAreRateLimited(provider.Error, usageError),
		RateLimitedUntil:   rateLimitedUntilFromDashboardErrors(provider.Error, usageError),
		Stale:              frame.UsageUnavailable,
	}
}

func dashboardErrorsAreRateLimited(errors ...json.RawMessage) bool {
	for _, raw := range errors {
		if len(raw) == 0 {
			continue
		}
		var payload map[string]any
		if err := json.Unmarshal(raw, &payload); err != nil || len(payload) == 0 {
			continue
		}
		if payloadIsRateLimited(map[string]any{"error": payload}) {
			return true
		}
	}
	return false
}

func rateLimitedUntilFromDashboardErrors(errors ...json.RawMessage) time.Time {
	for _, raw := range errors {
		if len(raw) == 0 {
			continue
		}
		var payload map[string]any
		if err := json.Unmarshal(raw, &payload); err != nil || len(payload) == 0 {
			continue
		}
		if blockedUntil := rateLimitedUntilFromPayload(map[string]any{"error": payload}); !blockedUntil.IsZero() {
			return blockedUntil
		}
	}
	return time.Time{}
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
