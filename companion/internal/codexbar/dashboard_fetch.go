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

func FetchDashboardProviders(ctx context.Context, info DashboardServeInfo, now time.Time) ([]ParsedFrame, error) {
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
	usageRaw, err := fetchDashboardJSON(ctx, endpoint+dashboardUsagePath, "")
	if err != nil {
		return nil, err
	}

	snapshot, err := dashboardusage.DecodeSnapshot(snapshotRaw)
	if err != nil {
		return nil, fmt.Errorf("decode dashboard snapshot: %w", err)
	}
	usageProviders, err := dashboardusage.DecodeUsage(usageRaw)
	if err != nil {
		return nil, fmt.Errorf("decode dashboard usage: %w", err)
	}

	snapshotCollectedAt := time.Time{}
	if snapshot.GeneratedAt != nil {
		snapshotCollectedAt = snapshot.GeneratedAt.UTC()
	}
	out := make([]ParsedFrame, 0, len(snapshot.Providers))
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
	}
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
	}
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
