package companionapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/daemon"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimeconfig"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/setup"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/themeinstall"
)

func TestStatusWorksWithoutDevice(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/status", nil)

	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got statusResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !got.OK || got.Companion.Status != "ready" {
		t.Fatalf("unexpected status response: %+v", got)
	}
	if !got.Companion.Features.ThemeInstallEnabled {
		t.Fatalf("expected theme install enabled by default")
	}
	if got.Device.Connected {
		t.Fatalf("expected disconnected device without probing, got %+v", got.Device)
	}
}

func TestStatusReportsThemeInstallDisableFlag(t *testing.T) {
	t.Setenv(themeInstallDisableEnv, "1")
	server := newTestServer(t, runtimeconfig.Config{})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/status", nil)

	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got statusResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.Companion.Features.ThemeInstallEnabled {
		t.Fatalf("expected theme install disable flag to be honored")
	}
}

func TestStatusReportsCachedMacAppUpdateState(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	calls := 0
	server.fetchMacAppRelease = func(context.Context) (githubRelease, error) {
		calls++
		return githubRelease{TagName: "v1.0.99"}, nil
	}

	for i := 0; i < 2; i++ {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/v1/status", nil)
		server.Handler().ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
		}
		var got statusResponse
		if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
			t.Fatalf("decode response: %v", err)
		}
		if !got.Companion.Update.UpdateAvailable {
			t.Fatalf("expected Mac App update available, got %+v", got.Companion.Update)
		}
		if got.Companion.Update.LatestVersion != "1.0.99" || got.Companion.Update.InstalledVersion != "1.0.0" {
			t.Fatalf("unexpected Mac App update versions: %+v", got.Companion.Update)
		}
	}
	if calls != 1 {
		t.Fatalf("expected cached Mac App release check, got %d calls", calls)
	}
}

func TestStatusReportsMacAppUpdateCheckFailure(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	server.fetchMacAppRelease = func(context.Context) (githubRelease, error) {
		return githubRelease{}, errors.New("release api unavailable")
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/status", nil)
	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got statusResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.Companion.Update.Status != "check_failed" || got.Companion.Update.UpdateAvailable {
		t.Fatalf("expected Mac App check failure without update, got %+v", got.Companion.Update)
	}
	if got.Companion.Update.Message != "Mac App check failed." {
		t.Fatalf("unexpected Mac App check failure message: %+v", got.Companion.Update)
	}
}

func TestUsageReturnsPersistedProviderSnapshots(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	collectedAt := time.Date(2026, 6, 26, 11, 59, 0, 0, time.UTC)
	server.loadUsage = func(time.Time) (daemon.PersistedUsage, bool) {
		return daemon.PersistedUsage{
			SavedAt:         collectedAt,
			CurrentProvider: "codex",
			Providers: []daemon.ProviderUsageSnapshot{
				{
					Provider: "codex",
					Source:   "openai-web",
					Frame: protocol.Frame{
						Provider:      "codex",
						Label:         "Codex",
						Session:       28,
						Weekly:        59,
						ResetSec:      5400,
						SessionTokens: 1234,
						WeekTokens:    5678,
						TotalTokens:   9000,
						Activity:      "coding",
						UsageMode:     "used",
					},
					Meta: codexbar.ProviderUsageMeta{
						Windows: []codexbar.UsageWindow{
							{ID: "primary", Label: "Session", UsedPercent: 28, ResetSec: 5400, WindowMinutes: 300},
							{ID: "secondary", Label: "Weekly", UsedPercent: 59, ResetSec: 86400, WindowMinutes: 10080},
							{ID: "codeReview", Label: "Code review", UsedPercent: 7, WindowMinutes: 10080},
						},
						Status:       &codexbar.ProviderStatus{Indicator: "none", Description: "Operational", UpdatedAt: collectedAt, URL: "https://status.openai.com/"},
						Credits:      &codexbar.ProviderCredits{Remaining: 112.4, UpdatedAt: collectedAt},
						ResetCredits: &codexbar.ProviderResetCredits{AvailableCount: 3, NextExpiresAt: time.Date(2026, 7, 12, 1, 42, 57, 0, time.UTC), UpdatedAt: collectedAt},
						Cost: &codexbar.ProviderCostUsage{
							CurrencyCode:      "USD",
							UpdatedAt:         collectedAt,
							TodayCostUSD:      72.42,
							Last30DaysCostUSD: 3694.16,
							Last30DaysTokens:  4300000000,
							LatestTokens:      77000000,
							TopModel:          "gpt-5.5",
							Daily: []codexbar.ProviderCostDay{
								{Day: "2026-06-27", TotalCostUSD: 12.3, TotalTokens: 1000},
								{Day: "2026-06-28", TotalCostUSD: 24.6, TotalTokens: 2000},
								{Day: "2026-06-29", TotalCostUSD: 72.42, TotalTokens: 77000000, Models: []codexbar.ProviderCostModel{{Name: "gpt-5.5", TotalTokens: 77000000, CostUSD: 72.42}}},
							},
						},
						Pace: []codexbar.ProviderPace{
							{Window: "primary", Stage: "ahead", DeltaPercent: 12, ExpectedUsedPercent: 16, ETASeconds: 9000, Summary: "12% in deficit | Expected 16% used | Projected empty in 2h 30m"},
						},
						OverTime: []codexbar.UsageOverTimePoint{
							{
								Day:              "2026-06-24",
								TotalCreditsUsed: 12,
								Services: []codexbar.UsageServiceUsage{
									{Service: "CLI", CreditsUsed: 8.5},
									{Service: "Code review", CreditsUsed: 3.5},
								},
							},
							{Day: "2026-06-25", TotalCreditsUsed: 10, Services: []codexbar.UsageServiceUsage{{Service: "CLI", CreditsUsed: 10}}},
						},
					},
					CollectedAt: collectedAt,
				},
			},
		}, true
	}
	server.fetchUsage = func(context.Context) ([]codexbar.ParsedFrame, error) {
		t.Fatal("fetchUsage should not run when snapshots are present")
		return nil, nil
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/usage", nil)
	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got usageResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !got.OK || got.Source != "codexbar-display" || got.CurrentProvider != "codex" || got.UsageMode != "used" {
		t.Fatalf("unexpected usage response metadata: %+v", got)
	}
	if len(got.Providers) != 1 {
		t.Fatalf("expected one provider, got %+v", got.Providers)
	}
	provider := got.Providers[0]
	if provider.ID != "codex" || provider.Label != "Codex" || provider.Source != "openai-web" {
		t.Fatalf("unexpected provider identity: %+v", provider)
	}
	if provider.Session != 28 || provider.Weekly != 59 || provider.ResetSec != 5400 {
		t.Fatalf("unexpected provider usage: %+v", provider)
	}
	if provider.SessionTokens != 1234 || provider.WeekTokens != 5678 || provider.TotalTokens != 9000 {
		t.Fatalf("unexpected token stats: %+v", provider)
	}
	if provider.CollectedAt != collectedAt.Format(time.RFC3339) {
		t.Fatalf("expected collectedAt %s, got %q", collectedAt.Format(time.RFC3339), provider.CollectedAt)
	}
	if len(provider.Windows) != 3 || provider.Windows[2].ID != "codereview" || provider.Windows[2].UsedPercent != 7 {
		t.Fatalf("expected usage windows metadata, got %+v", provider.Windows)
	}
	if provider.Status == nil || provider.Status.Description != "Operational" || provider.Status.URL == "" {
		t.Fatalf("expected status metadata, got %+v", provider.Status)
	}
	if provider.Credits == nil || provider.Credits.Remaining != 112.4 {
		t.Fatalf("expected credits metadata, got %+v", provider.Credits)
	}
	if provider.ResetCredits == nil || provider.ResetCredits.AvailableCount != 3 || provider.ResetCredits.NextExpiresAt != "2026-07-12T01:42:57Z" {
		t.Fatalf("expected reset credits metadata, got %+v", provider.ResetCredits)
	}
	if provider.Cost == nil || provider.Cost.TodayCostUSD != 72.42 || provider.Cost.Last30DaysCostUSD != 3694.16 || provider.Cost.TopModel != "gpt-5.5" {
		t.Fatalf("expected cost metadata, got %+v", provider.Cost)
	}
	if len(provider.Cost.Daily) != 3 || provider.Cost.Daily[2].Models[0].Name != "gpt-5.5" {
		t.Fatalf("expected cost history metadata, got %+v", provider.Cost.Daily)
	}
	if len(provider.Pace) != 1 || provider.Pace[0].Window != "primary" || provider.Pace[0].Summary == "" {
		t.Fatalf("expected pace metadata, got %+v", provider.Pace)
	}
	if len(provider.UsageOverTime) != 2 || provider.UsageOverTime[0].Day != "2026-06-24" || provider.UsageOverTime[0].TotalCreditsUsed != 12 {
		t.Fatalf("expected usage-over-time metadata, got %+v", provider.UsageOverTime)
	}
	if len(provider.UsageOverTime[0].Services) != 2 || provider.UsageOverTime[0].Services[0].Service != "CLI" {
		t.Fatalf("expected usage-over-time services, got %+v", provider.UsageOverTime[0].Services)
	}
}

func TestDisplayFrameLatestReturnsPersistedLastGoodFrame(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	savedAt := time.Date(2026, 6, 30, 14, 10, 35, 893363000, time.UTC)
	path := server.lastGoodDisplayFramePath()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("create display state dir: %v", err)
	}
	raw := []byte(`{
		"savedAt":"` + savedAt.Format(time.RFC3339Nano) + `",
		"frame":{
			"v":1,
			"provider":"codex",
			"label":"Codex",
			"session":24,
			"weekly":13,
			"resetSecs":6634,
			"sessionTokens":124627584,
			"weekTokens":1063961137,
			"totalTokens":4557592436
		}
	}`)
	if err := os.WriteFile(path, raw, 0o644); err != nil {
		t.Fatalf("write display frame: %v", err)
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/display-frame/latest", nil)
	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got displayFrameResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !got.OK || got.Source != "last-good-frame" {
		t.Fatalf("unexpected display frame response metadata: %+v", got)
	}
	if got.SavedAt != savedAt.Format(time.RFC3339Nano) {
		t.Fatalf("expected savedAt %s, got %s", savedAt.Format(time.RFC3339Nano), got.SavedAt)
	}
	if got.Frame.Provider != "codex" || got.Frame.Label != "Codex" {
		t.Fatalf("unexpected frame identity: %+v", got.Frame)
	}
	if got.Frame.Session != 24 || got.Frame.Weekly != 13 || got.Frame.ResetSec != 6634 {
		t.Fatalf("unexpected frame values: %+v", got.Frame)
	}
	if got.Frame.UsageMode != "" {
		t.Fatalf("expected legacy frame usage mode to stay empty, got %q", got.Frame.UsageMode)
	}
}

func TestDisplayFrameLatestReturnsNotFoundWithoutLastGoodFrame(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/display-frame/latest", nil)

	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected status 404, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got errorResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.OK || got.Error.Code != "display_frame_unavailable" {
		t.Fatalf("unexpected error response: %+v", got)
	}
}

func TestUsageFallsBackToCodexBarFetchWhenSnapshotsMissing(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	server.loadUsage = func(time.Time) (daemon.PersistedUsage, bool) {
		return daemon.PersistedUsage{}, false
	}
	server.fetchUsage = func(context.Context) ([]codexbar.ParsedFrame, error) {
		return []codexbar.ParsedFrame{
			{
				Provider: "claude",
				Source:   "web",
				Frame: protocol.Frame{
					Provider: "claude",
					Label:    "Claude",
					Session:  11,
					Weekly:   22,
					ResetSec: 3600,
				},
			},
		}, nil
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/usage", nil)
	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got usageResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.Source != "codexbar" || got.CurrentProvider != "claude" {
		t.Fatalf("unexpected fallback metadata: %+v", got)
	}
	if len(got.Providers) != 1 || got.Providers[0].ID != "claude" || got.Providers[0].UsageMode != "used" {
		t.Fatalf("unexpected fallback providers: %+v", got.Providers)
	}
}

func TestUsageRefreshesStaleProviderSnapshots(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	now := time.Date(2026, 6, 26, 13, 0, 0, 0, time.UTC)
	server.loadUsage = func(time.Time) (daemon.PersistedUsage, bool) {
		return daemon.PersistedUsage{
			SavedAt:         now.Add(-5 * time.Minute),
			CurrentProvider: "codex",
			Providers: []daemon.ProviderUsageSnapshot{
				{
					Provider:    "codex",
					Source:      "openai-web",
					CollectedAt: now.Add(-5 * time.Minute),
					Stale:       true,
					Frame: protocol.Frame{
						Provider: "codex",
						Label:    "Codex",
						Session:  4,
						Weekly:   18,
					},
				},
			},
		}, true
	}
	server.fetchUsage = func(context.Context) ([]codexbar.ParsedFrame, error) {
		return []codexbar.ParsedFrame{
			{
				Provider:    "codex",
				Source:      "openai-web",
				CollectedAt: now,
				Frame: protocol.Frame{
					Provider: "codex",
					Label:    "Codex",
					Session:  9,
					Weekly:   19,
				},
				Meta: codexbar.ProviderUsageMeta{
					OverTime: []codexbar.UsageOverTimePoint{
						{Day: "2026-06-26", TotalCreditsUsed: 12},
					},
				},
			},
		}, nil
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/usage", nil)
	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got usageResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.Source != "codexbar" {
		t.Fatalf("expected fresh codexbar source, got %+v", got)
	}
	if len(got.Providers) != 1 || got.Providers[0].Session != 9 || got.Providers[0].Stale {
		t.Fatalf("expected fresh provider usage, got %+v", got.Providers)
	}
	if len(got.Providers[0].UsageOverTime) != 1 {
		t.Fatalf("expected fresh usage-over-time, got %+v", got.Providers[0].UsageOverTime)
	}
}

func TestStartDisplayStreamUsesInjectedRefresh(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	var refreshedTarget string
	server.refreshStream = func(_ context.Context, target string) error {
		refreshedTarget = target
		return nil
	}
	server.runSetup = func(context.Context, setup.Options) error {
		t.Fatal("runSetup should not be called when refreshStream is injected")
		return nil
	}

	if err := server.startDisplayStream(context.Background(), "http://192.168.178.99"); err != nil {
		t.Fatalf("startDisplayStream returned error: %v", err)
	}
	if refreshedTarget != "http://192.168.178.99" {
		t.Fatalf("expected refresh target, got %q", refreshedTarget)
	}
}

func TestUsageReturnsStaleProviderSnapshotsWhenRefreshFails(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	now := time.Date(2026, 6, 26, 13, 0, 0, 0, time.UTC)
	server.loadUsage = func(time.Time) (daemon.PersistedUsage, bool) {
		return daemon.PersistedUsage{
			SavedAt:         now.Add(-5 * time.Minute),
			CurrentProvider: "codex",
			Providers: []daemon.ProviderUsageSnapshot{
				{
					Provider:    "codex",
					Source:      "openai-web",
					CollectedAt: now.Add(-5 * time.Minute),
					Stale:       true,
					Frame: protocol.Frame{
						Provider: "codex",
						Label:    "Codex",
						Session:  4,
						Weekly:   18,
					},
				},
			},
		}, true
	}
	server.fetchUsage = func(context.Context) ([]codexbar.ParsedFrame, error) {
		return nil, errors.New("codexbar temporarily unavailable")
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/usage", nil)
	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected stale snapshot status 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got usageResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.Source != "codexbar-display" || len(got.Providers) != 1 || !got.Providers[0].Stale {
		t.Fatalf("expected stale persisted usage, got %+v", got)
	}
}

func TestUsageUnavailableReturnsCustomerSafeError(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	server.loadUsage = func(time.Time) (daemon.PersistedUsage, bool) {
		return daemon.PersistedUsage{}, false
	}
	server.fetchUsage = func(context.Context) ([]codexbar.ParsedFrame, error) {
		return nil, errors.New("secret raw codexbar failure")
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/usage", nil)
	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected status 503, got %d body=%s", rec.Code, rec.Body.String())
	}
	body := rec.Body.String()
	if strings.Contains(body, "secret raw codexbar failure") {
		t.Fatalf("usage error leaked raw failure: %s", body)
	}
	var got errorResponse
	if err := json.Unmarshal([]byte(body), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.OK || got.Error.Code != "usage_unavailable" {
		t.Fatalf("unexpected error response: %+v", got)
	}
}

func TestCORSAllowedAndForeignOrigins(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})

	allowed := httptest.NewRecorder()
	allowedReq := httptest.NewRequest(http.MethodGet, "/v1/status", nil)
	allowedReq.Header.Set("Origin", "https://app.vibetv.shop")
	server.Handler().ServeHTTP(allowed, allowedReq)
	if got := allowed.Header().Get("Access-Control-Allow-Origin"); got != "https://app.vibetv.shop" {
		t.Fatalf("expected allowed origin header, got %q", got)
	}

	previewOrigin := "https://codex-vibetv-control-center-120qndufj-paul-anduschus-projects.vercel.app"
	preview := httptest.NewRecorder()
	previewReq := httptest.NewRequest(http.MethodGet, "/v1/status", nil)
	previewReq.Header.Set("Origin", previewOrigin)
	server.Handler().ServeHTTP(preview, previewReq)
	if got := preview.Header().Get("Access-Control-Allow-Origin"); got != previewOrigin {
		t.Fatalf("expected preview origin header %q, got %q", previewOrigin, got)
	}

	foreign := httptest.NewRecorder()
	foreignReq := httptest.NewRequest(http.MethodGet, "/v1/status", nil)
	foreignReq.Header.Set("Origin", "https://evil.example")
	server.Handler().ServeHTTP(foreign, foreignReq)
	if got := foreign.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("expected no CORS header for foreign origin, got %q", got)
	}
}

func TestCORSRejectsForeignVercelPreviewOrigins(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})

	for _, origin := range []string{
		"https://codex-vibetv-control-center-120qndufj-attacker.vercel.app",
		"https://other-vibetv-control-center-120qndufj-paul-anduschus-projects.vercel.app",
		"https://codex-vibetv-control-center-paul-anduschus-projects.vercel.app",
		"https://codex-vibetv-control-center-120qndufj-paul-anduschus-projects.vercel.app.evil.example",
		"http://codex-vibetv-control-center-120qndufj-paul-anduschus-projects.vercel.app",
		"https://codex-vibetv-control-center-120qndufj-paul-anduschus-projects.vercel.app:443",
	} {
		t.Run(origin, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodOptions, "/v1/status", nil)
			req.Header.Set("Origin", origin)
			req.Header.Set("Access-Control-Request-Method", http.MethodGet)
			req.Header.Set("Access-Control-Request-Private-Network", "true")
			server.Handler().ServeHTTP(rec, req)

			if rec.Code != http.StatusForbidden {
				t.Fatalf("expected preview origin %q to be forbidden, got %d body=%s", origin, rec.Code, rec.Body.String())
			}
			if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "" {
				t.Fatalf("expected no CORS origin header for %q, got %q", origin, got)
			}
		})
	}
}

func TestPrivateNetworkAccessPreflightForAllowedOrigin(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})

	allowed := httptest.NewRecorder()
	allowedReq := httptest.NewRequest(http.MethodOptions, "/v1/status", nil)
	allowedReq.Header.Set("Origin", "https://app.vibetv.shop")
	allowedReq.Header.Set("Access-Control-Request-Method", http.MethodGet)
	allowedReq.Header.Set("Access-Control-Request-Private-Network", "true")
	server.Handler().ServeHTTP(allowed, allowedReq)

	if allowed.Code != http.StatusNoContent {
		t.Fatalf("expected private network preflight 204, got %d body=%s", allowed.Code, allowed.Body.String())
	}
	if got := allowed.Header().Get("Access-Control-Allow-Origin"); got != "https://app.vibetv.shop" {
		t.Fatalf("expected allowed origin header, got %q", got)
	}
	if got := allowed.Header().Get("Access-Control-Allow-Private-Network"); got != "true" {
		t.Fatalf("expected private network allow header, got %q", got)
	}

	previewOrigin := "https://codex-vibetv-control-center-120qndufj-paul-anduschus-projects.vercel.app"
	preview := httptest.NewRecorder()
	previewReq := httptest.NewRequest(http.MethodOptions, "/v1/status", nil)
	previewReq.Header.Set("Origin", previewOrigin)
	previewReq.Header.Set("Access-Control-Request-Method", http.MethodGet)
	previewReq.Header.Set("Access-Control-Request-Private-Network", "true")
	server.Handler().ServeHTTP(preview, previewReq)

	if preview.Code != http.StatusNoContent {
		t.Fatalf("expected preview private network preflight 204, got %d body=%s", preview.Code, preview.Body.String())
	}
	if got := preview.Header().Get("Access-Control-Allow-Origin"); got != previewOrigin {
		t.Fatalf("expected preview origin header %q, got %q", previewOrigin, got)
	}
	if got := preview.Header().Get("Access-Control-Allow-Private-Network"); got != "true" {
		t.Fatalf("expected preview private network allow header, got %q", got)
	}

	foreign := httptest.NewRecorder()
	foreignReq := httptest.NewRequest(http.MethodOptions, "/v1/status", nil)
	foreignReq.Header.Set("Origin", "https://evil.example")
	foreignReq.Header.Set("Access-Control-Request-Method", http.MethodGet)
	foreignReq.Header.Set("Access-Control-Request-Private-Network", "true")
	server.Handler().ServeHTTP(foreign, foreignReq)

	if foreign.Code != http.StatusForbidden {
		t.Fatalf("expected foreign private network preflight 403, got %d body=%s", foreign.Code, foreign.Body.String())
	}
	if got := foreign.Header().Get("Access-Control-Allow-Private-Network"); got != "" {
		t.Fatalf("expected no private network allow header for foreign origin, got %q", got)
	}
}

func TestDeviceNotFoundErrorFormat(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/device", nil)

	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected status 404, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got errorResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.OK || got.Error.Code != "device_not_found" || got.Error.Message == "" || got.Error.NextAction == "" {
		t.Fatalf("unexpected error response: %+v", got)
	}
}

func TestDeviceReachableButDisplayStreamNotReadyReportsDisconnected(t *testing.T) {
	device := newHelloDeviceServer(t)
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{DeviceTarget: device.URL, DeviceToken: "pair-token"})
	server.streamStatus = func(context.Context, string) displayStreamInfo {
		return displayStreamInfo{
			Healthy: false,
			Running: false,
			Target:  device.URL,
			Detail:  "Display stream is not loaded.",
		}
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/device", nil)
	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got struct {
		Device deviceInfo `json:"device"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.Device.Connected {
		t.Fatalf("expected reachable device to stay disconnected until display stream is ready, got %+v", got.Device)
	}
	if got.Device.Stream == nil || got.Device.Stream.Healthy {
		t.Fatalf("expected unhealthy stream detail, got %+v", got.Device.Stream)
	}
}

func TestDeviceReachableButRenderFailedReportsDisconnected(t *testing.T) {
	device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hello":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"board":"esp8266-smalltv-st7789","firmware":"1.0.31","features":["theme","theme-spec-v1"],"capabilities":{"theme":{"supportsThemeSpecV1":true},"transport":{"active":"wifi"}}}`))
		case "/health":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true,"display":{"activeTheme":"mini-classic","themeSpec":{"active":true,"renderOk":false,"renderError":"low_heap_full_render","renderFailures":3}},"settings":{"display":{"brightnessPercent":40}}}`))
		default:
			t.Fatalf("unexpected device path %s", r.URL.Path)
		}
	}))
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{DeviceTarget: device.URL, DeviceToken: "pair-token"})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/device", nil)
	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got struct {
		Device deviceInfo `json:"device"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.Device.Connected {
		t.Fatalf("expected render failure to report disconnected image, got %+v", got.Device)
	}
	if got.Device.Stream == nil || !got.Device.Stream.Healthy {
		t.Fatalf("expected healthy stream detail, got %+v", got.Device.Stream)
	}
	if got.Device.Display == nil || got.Device.Display.ThemeSpec == nil ||
		got.Device.Display.ThemeSpec.RenderOK == nil ||
		*got.Device.Display.ThemeSpec.RenderOK ||
		got.Device.Display.ThemeSpec.RenderError != "low_heap_full_render" {
		t.Fatalf("expected render failure health, got %+v", got.Device.Display)
	}
}

func TestDeviceReloadDisplayWaitsForRenderHealth(t *testing.T) {
	var healthCalls int
	device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hello":
			if got := r.Header.Get("X-VibeTV-Token"); got != "pair-token" {
				t.Fatalf("expected pairing token for hello, got %q", got)
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"board":"esp8266-smalltv-st7789","firmware":"1.0.31","features":["theme","theme-spec-v1"],"capabilities":{"theme":{"supportsThemeSpecV1":true},"transport":{"active":"wifi"}}}`))
		case "/health":
			if got := r.Header.Get("X-VibeTV-Token"); got != "pair-token" {
				t.Fatalf("expected pairing token for health, got %q", got)
			}
			healthCalls++
			w.Header().Set("Content-Type", "application/json")
			if healthCalls == 1 {
				_, _ = w.Write([]byte(`{"ok":true,"display":{"activeTheme":"clippy","themeSpec":{"active":true,"renderOk":false,"renderError":"low_heap_full_render","renderFailures":1}},"settings":{"display":{"brightnessPercent":40}}}`))
				return
			}
			_, _ = w.Write([]byte(`{"ok":true,"display":{"activeTheme":"clippy","themeSpec":{"active":true,"renderOk":true,"renderFailures":1}},"settings":{"display":{"brightnessPercent":40}}}`))
		default:
			t.Fatalf("unexpected device path %s", r.URL.Path)
		}
	}))
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{DeviceTarget: device.URL, DeviceToken: "pair-token"})
	var setupCalls []setup.Options
	server.runSetup = func(_ context.Context, opts setup.Options) error {
		setupCalls = append(setupCalls, opts)
		return nil
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/device/reload-display", nil)
	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got deviceActionResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !got.OK || !got.Device.Connected || !got.Device.Paired {
		t.Fatalf("expected reload response to become connected after render recovery, got %+v", got)
	}
	if got.Device.Display == nil || got.Device.Display.ThemeSpec == nil ||
		got.Device.Display.ThemeSpec.RenderOK == nil ||
		!*got.Device.Display.ThemeSpec.RenderOK {
		t.Fatalf("expected healthy render state in response, got %+v", got.Device.Display)
	}
	if healthCalls < 2 {
		t.Fatalf("expected reload to wait for render health, got %d health call(s)", healthCalls)
	}
	if len(setupCalls) != 2 {
		t.Fatalf("expected validate and apply display stream calls, got %+v", setupCalls)
	}
	if !setupCalls[0].ValidateOnly || setupCalls[1].ValidateOnly {
		t.Fatalf("expected validate then apply setup calls, got %+v", setupCalls)
	}
}

func TestDiagnosticsWorksWithoutDeviceTarget(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/diagnostics", nil)

	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got diagnosticsResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !got.OK || got.Companion.Status != "ready" || got.GeneratedAt == "" {
		t.Fatalf("unexpected diagnostics response: %+v", got)
	}
	if got.Device.Connected || got.Device.Target != "" {
		t.Fatalf("expected no connected device target, got %+v", got.Device)
	}
	if !hasDiagnosticCheck(got.Checks, "device_target", "attention") {
		t.Fatalf("expected missing target diagnostic, got %+v", got.Checks)
	}
}

func TestDiagnosticsReportsDeviceWithoutLeakingToken(t *testing.T) {
	device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("X-VibeTV-Token"); got != "pair-token" {
			t.Fatalf("expected pairing token header for device request, got %q", got)
		}
		switch r.URL.Path {
		case "/hello":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"board":"esp8266-smalltv-st7789","firmware":"1.0.31","capabilities":{"theme":{"supportsThemeSpecV1":true},"transport":{"active":"wifi"}}}`))
		case "/health":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true,"display":{"activeTheme":"synthwave"},"settings":{"display":{"brightnessPercent":40}}}`))
		default:
			t.Fatalf("unexpected device path %s", r.URL.Path)
		}
	}))
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{DeviceTarget: device.URL, DeviceToken: "pair-token"})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/diagnostics", nil)

	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	body := rec.Body.String()
	if strings.Contains(body, "pair-token") {
		t.Fatalf("diagnostics leaked pairing token: %s", body)
	}
	var got diagnosticsResponse
	if err := json.Unmarshal([]byte(body), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !got.Device.Connected || !got.Device.Paired || got.Device.ActiveTheme != "synthwave" {
		t.Fatalf("unexpected device diagnostics: %+v", got.Device)
	}
	if !hasDiagnosticCheck(got.Checks, "device_hello", "pass") {
		t.Fatalf("expected hello pass check, got %+v", got.Checks)
	}
	if !hasDiagnosticCheck(got.Checks, "device_health", "pass") {
		t.Fatalf("expected health pass check, got %+v", got.Checks)
	}
}

func TestDiagnosticsRedactsPublicTargetCredentials(t *testing.T) {
	device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/setup/hello":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"board":"esp8266-smalltv-st7789","capabilities":{"transport":{"active":"wifi"}}}`))
		case "/setup/health":
			http.Error(w, "health unavailable", http.StatusServiceUnavailable)
		default:
			t.Fatalf("unexpected device path %s", r.URL.Path)
		}
	}))
	defer device.Close()

	target := strings.Replace(device.URL, "http://", "http://user:secret@", 1) + "/setup?token=pair-token"
	expectedPublicTarget := device.URL + "/setup"
	server := newTestServer(t, runtimeconfig.Config{DeviceTarget: target, DeviceToken: "pair-token"})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/diagnostics", nil)

	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	body := rec.Body.String()
	for _, sensitive := range []string{"user:secret", "pair-token", "token="} {
		if strings.Contains(body, sensitive) {
			t.Fatalf("diagnostics leaked %q in body: %s", sensitive, body)
		}
	}
	var got diagnosticsResponse
	if err := json.Unmarshal([]byte(body), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.Device.Target != expectedPublicTarget {
		t.Fatalf("expected public target without credentials or query, got %q", got.Device.Target)
	}
	if !hasDiagnosticCheck(got.Checks, "device_target", "pass") {
		t.Fatalf("expected device target pass check, got %+v", got.Checks)
	}
	if got := diagnosticCheckDetail(got.Checks, "device_target"); got != expectedPublicTarget {
		t.Fatalf("expected redacted target detail %q, got %q", expectedPublicTarget, got)
	}
}

func TestSanitizeErrorDetailRedactsURLCredentials(t *testing.T) {
	detail := sanitizeErrorDetail(errors.New("GET http://user:secret@vibetv.local/setup?token=pair-token&key=api-key failed"))

	for _, sensitive := range []string{"user:secret", "pair-token", "api-key"} {
		if strings.Contains(detail, sensitive) {
			t.Fatalf("sanitized detail leaked %q: %s", sensitive, detail)
		}
	}
	for _, expected := range []string{"http://<redacted>@vibetv.local", "token=<redacted>", "key=<redacted>"} {
		if !strings.Contains(detail, expected) {
			t.Fatalf("sanitized detail missing %q: %s", expected, detail)
		}
	}
}

func TestSplitInstallLogStripsPrivateURLDetails(t *testing.T) {
	logs := splitInstallLog("Theme source: https://user:secret@example.com/theme.zip?token=abc&expires=soon#frag\nDone\n")
	want := []string{
		"Theme source: https://example.com/theme.zip",
		"Done",
	}
	if len(logs) != len(want) {
		t.Fatalf("expected %d log lines, got %d: %#v", len(want), len(logs), logs)
	}
	for i := range want {
		if logs[i] != want[i] {
			t.Fatalf("log line %d = %q, want %q", i, logs[i], want[i])
		}
	}
}

func TestDeviceDiscoverFallsBackToSubnetCandidateAndPersistsTarget(t *testing.T) {
	stale := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "gone", http.StatusServiceUnavailable)
	}))
	defer stale.Close()

	device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/hello" {
			t.Fatalf("unexpected device path %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"board":"esp8266-smalltv-st7789","firmware":"1.0.31","capabilities":{"transport":{"active":"wifi"}}}`))
	}))
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{DeviceTarget: stale.URL, DeviceToken: "pair-token"})
	server.subnetTargets = func() []string {
		return []string{device.URL}
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/device/discover", strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json")

	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got struct {
		OK     bool       `json:"ok"`
		Device deviceInfo `json:"device"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !got.OK || !got.Device.Connected || got.Device.Target != device.URL {
		t.Fatalf("unexpected discovery response: %+v", got)
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/v1/status", nil)
	server.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	var status statusResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &status); err != nil {
		t.Fatalf("decode status: %v", err)
	}
	if status.Device.Target != device.URL {
		t.Fatalf("expected persisted device target %q, got %+v", device.URL, status.Device)
	}
}

func TestDeviceDiscoverReturnsConflictForMultipleSubnetCandidates(t *testing.T) {
	stale := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "gone", http.StatusServiceUnavailable)
	}))
	defer stale.Close()

	first := newHelloDeviceServer(t)
	defer first.Close()
	second := newHelloDeviceServer(t)
	defer second.Close()

	server := newTestServer(t, runtimeconfig.Config{DeviceTarget: stale.URL})
	server.subnetTargets = func() []string {
		return []string{first.URL, second.URL}
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/device/discover", strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json")

	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusConflict {
		t.Fatalf("expected status 409, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got errorResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.OK || got.Error.Code != "multiple_devices_found" {
		t.Fatalf("unexpected multiple-devices response: %+v", got)
	}
	if got.Error.NextAction == "" {
		t.Fatalf("expected next action for manual target entry")
	}
}

func TestDeviceRepairFallsBackToSubnetAndRefreshesDisplayStream(t *testing.T) {
	stale := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "gone", http.StatusServiceUnavailable)
	}))
	defer stale.Close()

	device := newRepairableDeviceServer(t)
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{DeviceTarget: stale.URL, DeviceToken: "existing-token"})
	server.subnetTargets = func() []string {
		return []string{device.URL}
	}
	var setupCalls []setup.Options
	server.runSetup = func(_ context.Context, opts setup.Options) error {
		setupCalls = append(setupCalls, opts)
		return nil
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/device/repair", strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json")

	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got deviceActionResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !got.OK || !got.Device.Connected || !got.Device.Paired || got.Device.Target != device.URL {
		t.Fatalf("unexpected repair response: %+v", got)
	}
	if len(setupCalls) != 2 {
		t.Fatalf("expected validate and apply display stream calls, got %+v", setupCalls)
	}
	for index, call := range setupCalls {
		if call.Transport != "wifi" || call.Target != device.URL || !call.AssumeYes || !call.SkipFlash {
			t.Fatalf("setup call %d must refresh wifi stream without flashing, got %+v", index, call)
		}
	}
	if !setupCalls[0].ValidateOnly || setupCalls[1].ValidateOnly {
		t.Fatalf("expected validate then apply setup calls, got %+v", setupCalls)
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/v1/status", nil)
	server.Handler().ServeHTTP(rec, req)
	var status statusResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &status); err != nil {
		t.Fatalf("decode status: %v", err)
	}
	if status.Device.Target != device.URL || !status.Device.Paired {
		t.Fatalf("expected persisted repaired target and token, got %+v", status.Device)
	}
}

func TestDeviceRepairExplicitVibetvLocalFallsBackToSubnet(t *testing.T) {
	device := newRepairableDeviceServer(t)
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{DeviceTarget: "http://vibetv.local"})
	server.client.Transport = roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if strings.EqualFold(strings.TrimSuffix(req.URL.Hostname(), "."), "vibetv.local") {
			return nil, errors.New("mdns lookup failed")
		}
		return http.DefaultTransport.RoundTrip(req)
	})
	server.subnetTargets = func() []string {
		return []string{device.URL}
	}
	var setupCalls []setup.Options
	server.runSetup = func(_ context.Context, opts setup.Options) error {
		setupCalls = append(setupCalls, opts)
		return nil
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/device/repair", strings.NewReader(`{"target":"http://vibetv.local","forcePair":true}`))
	req.Header.Set("Content-Type", "application/json")

	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got deviceActionResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !got.OK || got.Device.Target != device.URL || !got.Device.Paired {
		t.Fatalf("expected subnet repair target %q, got %+v", device.URL, got)
	}
	if len(setupCalls) == 0 || setupCalls[len(setupCalls)-1].Target != device.URL {
		t.Fatalf("expected display stream refreshed with discovered target, got %+v", setupCalls)
	}
}

func TestDeviceRepairForcePairRotatesToken(t *testing.T) {
	device := newRepairableDeviceServer(t)
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{DeviceTarget: device.URL, DeviceToken: "old-token"})
	var setupCalls []setup.Options
	server.runSetup = func(_ context.Context, opts setup.Options) error {
		setupCalls = append(setupCalls, opts)
		return nil
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/device/repair", strings.NewReader(`{"forcePair":true}`))
	req.Header.Set("Content-Type", "application/json")

	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got deviceActionResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !got.Device.Paired {
		t.Fatalf("expected paired device, got %+v", got.Device)
	}
	if len(setupCalls) != 2 {
		t.Fatalf("expected display stream refresh, got %+v", setupCalls)
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/v1/diagnostics", nil)
	server.Handler().ServeHTTP(rec, req)
	if strings.Contains(rec.Body.String(), "new-token") || strings.Contains(rec.Body.String(), "old-token") {
		t.Fatalf("diagnostics leaked token after repair: %s", rec.Body.String())
	}
}

func TestDeviceRepairForcePairIgnoresStaleTokenDuringDiscovery(t *testing.T) {
	var sawTokenlessHello bool
	var sawNewTokenHello bool
	device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hello":
			switch got := r.Header.Get("X-VibeTV-Token"); got {
			case "":
				sawTokenlessHello = true
			case "new-token":
				sawNewTokenHello = true
			default:
				http.Error(w, "stale token", http.StatusUnauthorized)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"board":"esp8266-smalltv-st7789","firmware":"1.0.31","features":["theme","theme-spec-v1"],"capabilities":{"theme":{"supportsThemeSpecV1":true},"transport":{"active":"wifi"}}}`))
		case "/api/pair":
			if r.Method != http.MethodPost {
				t.Fatalf("expected POST pair, got %s", r.Method)
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true,"token":"new-token"}`))
		case "/health":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true,"display":{"activeTheme":"mini-classic","themeSpec":{"active":true,"renderOk":true}},"settings":{"display":{"brightnessPercent":40}}}`))
		default:
			t.Fatalf("unexpected device path %s", r.URL.Path)
		}
	}))
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{DeviceTarget: "http://vibetv.local", DeviceToken: "old-token"})
	server.runSetup = func(_ context.Context, opts setup.Options) error {
		if opts.Target != device.URL {
			t.Fatalf("expected display stream target %q, got %q", device.URL, opts.Target)
		}
		return nil
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/device/repair", strings.NewReader(`{"target":"`+device.URL+`","forcePair":true}`))
	req.Header.Set("Content-Type", "application/json")

	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	if !sawTokenlessHello {
		t.Fatal("expected force repair discovery to probe without stale token")
	}
	if !sawNewTokenHello {
		t.Fatal("expected repair response refresh to use the new token")
	}
}

func TestDeviceRepairRepairsStaleTokenWithoutForcePair(t *testing.T) {
	var sawStaleToken bool
	var sawTokenlessHello bool
	var sawNewTokenHello bool
	device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hello":
			switch got := r.Header.Get("X-VibeTV-Token"); got {
			case "old-token":
				sawStaleToken = true
				http.Error(w, "stale token", http.StatusUnauthorized)
				return
			case "":
				sawTokenlessHello = true
			case "new-token":
				sawNewTokenHello = true
			default:
				t.Fatalf("unexpected token %q", got)
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"board":"esp8266-smalltv-st7789","firmware":"1.0.31","capabilities":{"transport":{"active":"wifi"}}}`))
		case "/api/pair":
			if r.Method != http.MethodPost {
				t.Fatalf("expected POST pair, got %s", r.Method)
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true,"token":"new-token"}`))
		case "/health":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true,"display":{"activeTheme":"mini-classic","themeSpec":{"active":true,"renderOk":true}},"settings":{"display":{"brightnessPercent":40}}}`))
		default:
			t.Fatalf("unexpected device path %s", r.URL.Path)
		}
	}))
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{DeviceTarget: device.URL, DeviceToken: "old-token"})
	server.runSetup = func(_ context.Context, opts setup.Options) error {
		if opts.Target != device.URL {
			t.Fatalf("expected display stream target %q, got %q", device.URL, opts.Target)
		}
		return nil
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/device/repair", strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json")

	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	if !sawStaleToken || !sawTokenlessHello || !sawNewTokenHello {
		t.Fatalf("expected stale, tokenless, and refreshed probes; stale=%t tokenless=%t new=%t", sawStaleToken, sawTokenlessHello, sawNewTokenHello)
	}
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/v1/status", nil)
	server.Handler().ServeHTTP(rec, req)
	var status statusResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &status); err != nil {
		t.Fatalf("decode status: %v", err)
	}
	if !status.Device.Paired {
		t.Fatalf("expected repaired pairing state, got %+v", status.Device)
	}
}

func TestSetupResetClearsStoredDeviceBinding(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{
		Theme:        "mini",
		DeviceTarget: "http://192.168.178.72",
		DeviceToken:  "pair-token",
	})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/setup/reset", nil)

	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got statusResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.Device.Target != "" || got.Device.Paired || got.Device.Connected {
		t.Fatalf("expected reset device state, got %+v", got.Device)
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/v1/status", nil)
	server.Handler().ServeHTTP(rec, req)
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode status: %v", err)
	}
	if got.Device.Target != "" || got.Device.Paired {
		t.Fatalf("expected persisted device reset, got %+v", got.Device)
	}
}

func TestDeviceDiscoverDoesNotFallbackWhenExplicitTargetFails(t *testing.T) {
	stale := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "gone", http.StatusServiceUnavailable)
	}))
	defer stale.Close()

	device := newHelloDeviceServer(t)
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{})
	server.subnetTargets = func() []string {
		return []string{device.URL}
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(
		http.MethodPost,
		"/v1/device/discover",
		strings.NewReader(`{"target":`+strconv.Quote(stale.URL)+`}`),
	)
	req.Header.Set("Content-Type", "application/json")

	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected explicit target failure status 404, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got errorResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.OK || got.Error.Code != "device_not_found" {
		t.Fatalf("unexpected explicit target response: %+v", got)
	}
}

func TestDeviceDiscoverRejectsInvalidExplicitTarget(t *testing.T) {
	for _, target := range []string{
		"ftp://vibetv.local",
		"http://ftp://vibetv.local",
		"http://vibetv.local:",
		"http://vibetv.local:abc",
		"http://vibetv.local:0",
		"http://vibetv.local:99999",
		"http://vibetv.local/setup",
		"http://vibetv.local?token=pair-token",
		"http://vibetv.local/#setup",
	} {
		t.Run(target, func(t *testing.T) {
			server := newTestServer(t, runtimeconfig.Config{})
			server.subnetTargets = func() []string {
				t.Fatal("subnet discovery should not run for invalid explicit target")
				return nil
			}

			rec := httptest.NewRecorder()
			req := httptest.NewRequest(
				http.MethodPost,
				"/v1/device/discover",
				strings.NewReader(`{"target":`+strconv.Quote(target)+`}`),
			)
			req.Header.Set("Content-Type", "application/json")

			server.Handler().ServeHTTP(rec, req)

			if rec.Code != http.StatusBadRequest {
				t.Fatalf("expected status 400, got %d body=%s", rec.Code, rec.Body.String())
			}
			var got errorResponse
			if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
				t.Fatalf("decode response: %v", err)
			}
			if got.OK || got.Error.Code != "invalid_device_target" {
				t.Fatalf("unexpected invalid target response: %+v", got)
			}
		})
	}
}

func TestDevicePairRejectsInvalidExplicitTarget(t *testing.T) {
	for _, target := range []string{
		"http://user:pass@vibetv.local",
		"http://vibetv.local:abc",
		"http://vibetv.local:0",
		"http://vibetv.local:99999",
	} {
		t.Run(target, func(t *testing.T) {
			server := newTestServer(t, runtimeconfig.Config{})
			server.subnetTargets = func() []string {
				t.Fatal("subnet discovery should not run for invalid explicit target")
				return nil
			}

			rec := httptest.NewRecorder()
			req := httptest.NewRequest(
				http.MethodPost,
				"/v1/device/pair",
				strings.NewReader(`{"target":`+strconv.Quote(target)+`}`),
			)
			req.Header.Set("Content-Type", "application/json")

			server.Handler().ServeHTTP(rec, req)

			if rec.Code != http.StatusBadRequest {
				t.Fatalf("expected status 400, got %d body=%s", rec.Code, rec.Body.String())
			}
			var got errorResponse
			if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
				t.Fatalf("decode response: %v", err)
			}
			if got.OK || got.Error.Code != "invalid_device_target" {
				t.Fatalf("unexpected invalid target response: %+v", got)
			}
		})
	}
}

func TestDevicePairReturnsConflictForMultipleDiscoveryCandidates(t *testing.T) {
	stale := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "gone", http.StatusServiceUnavailable)
	}))
	defer stale.Close()

	first := newHelloDeviceServer(t)
	defer first.Close()
	second := newHelloDeviceServer(t)
	defer second.Close()

	server := newTestServer(t, runtimeconfig.Config{DeviceTarget: stale.URL})
	server.subnetTargets = func() []string {
		return []string{first.URL, second.URL}
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/device/pair", strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json")

	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusConflict {
		t.Fatalf("expected status 409, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got errorResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.OK || got.Error.Code != "multiple_devices_found" {
		t.Fatalf("unexpected multiple-devices response: %+v", got)
	}
}

func TestDevicePairStartsDisplayStreamWithoutFirmwareFlash(t *testing.T) {
	device := newPairableDeviceServer(t)
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{DeviceTarget: device.URL})
	var setupCalls []setup.Options
	server.runSetup = func(_ context.Context, opts setup.Options) error {
		setupCalls = append(setupCalls, opts)
		return nil
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/device/pair", strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json")

	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	if len(setupCalls) != 2 {
		t.Fatalf("expected validate and apply setup calls, got %+v", setupCalls)
	}
	for index, call := range setupCalls {
		if call.Transport != "wifi" || call.Target != device.URL || !call.AssumeYes || !call.SkipFlash {
			t.Fatalf("setup call %d must start wifi stream without flashing, got %+v", index, call)
		}
	}
	if !setupCalls[0].ValidateOnly {
		t.Fatalf("first setup call should validate dependencies before applying, got %+v", setupCalls[0])
	}
	if setupCalls[1].ValidateOnly {
		t.Fatalf("second setup call should apply launch agent changes, got %+v", setupCalls[1])
	}
}

func TestDevicePairReturnsErrorWhenDisplayStreamCannotStart(t *testing.T) {
	device := newPairableDeviceServer(t)
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{DeviceTarget: device.URL})
	server.runSetup = func(context.Context, setup.Options) error {
		return errors.New("codexbar missing")
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/device/pair", strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json")

	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusBadGateway {
		t.Fatalf("expected status 502, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got errorResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.OK || got.Error.Code != "display_stream_start_failed" || got.Error.NextAction == "" {
		t.Fatalf("unexpected display stream error: %+v", got)
	}
}

func TestThemeInstallDelegatesToThemeInstallLogic(t *testing.T) {
	device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hello":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"board":"esp8266-smalltv-st7789","features":["theme","theme-spec-v1"],"capabilities":{"theme":{"supportsThemeSpecV1":true},"transport":{"active":"wifi"}}}`))
		case "/health":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true,"settings":{"display":{"brightnessPercent":40}}}`))
		default:
			t.Fatalf("unexpected device path %s", r.URL.Path)
		}
	}))
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{DeviceTarget: device.URL, DeviceToken: "pair-token"})
	var gotOpts themeinstall.Options
	var setupCalls []setup.Options
	server.installTheme = func(ctx context.Context, opts themeinstall.Options) (themeinstall.Result, error) {
		gotOpts = opts
		return themeinstall.Result{ThemeID: opts.ThemeID, Target: opts.Target}, nil
	}
	server.runSetup = func(_ context.Context, opts setup.Options) error {
		setupCalls = append(setupCalls, opts)
		return nil
	}

	body := strings.NewReader(`{"themeId":"cozy-meadow","packUrl":"https://example.com/cozy.zip"}`)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/themes/install", body)
	req.Header.Set("Content-Type", "application/json")

	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	if gotOpts.ThemeID != "cozy-meadow" || gotOpts.PackURL != "https://example.com/cozy.zip" {
		t.Fatalf("install did not receive theme source: %+v", gotOpts)
	}
	if !strings.Contains(gotOpts.Target, "token=") {
		t.Fatalf("expected target to include pairing token for transport auth, got %q", gotOpts.Target)
	}
	if !gotOpts.SkipFirmwareUpdate {
		t.Fatalf("expected local API theme install to skip firmware update by default")
	}
	if len(setupCalls) != 2 {
		t.Fatalf("expected validate and apply display stream refresh calls, got %+v", setupCalls)
	}
	for index, call := range setupCalls {
		if call.Transport != "wifi" || call.Target != device.URL || !call.AssumeYes || !call.SkipFlash {
			t.Fatalf("setup call %d must refresh wifi stream without flashing, got %+v", index, call)
		}
	}
	if !setupCalls[0].ValidateOnly {
		t.Fatalf("first setup refresh call should validate dependencies, got %+v", setupCalls[0])
	}
	if setupCalls[1].ValidateOnly {
		t.Fatalf("second setup refresh call should apply launch agent changes, got %+v", setupCalls[1])
	}
}

func TestThemeInstallAsyncReportsCustomerProgress(t *testing.T) {
	device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hello":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"board":"esp8266-smalltv-st7789","features":["theme","theme-spec-v1"],"capabilities":{"theme":{"supportsThemeSpecV1":true},"transport":{"active":"wifi"}}}`))
		case "/health":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true,"settings":{"display":{"brightnessPercent":40}}}`))
		default:
			t.Fatalf("unexpected device path %s", r.URL.Path)
		}
	}))
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{DeviceTarget: device.URL, DeviceToken: "pair-token"})
	server.installTheme = func(_ context.Context, opts themeinstall.Options) (themeinstall.Result, error) {
		_, _ = io.WriteString(opts.Out, "Preparing theme: Clippy\n")
		_, _ = io.WriteString(opts.Out, "Uploading theme files...\n")
		_, _ = io.WriteString(opts.Out, "Uploaded asset: /themes/u/clippy.cbi bytes=123\n")
		_, _ = io.WriteString(opts.Out, "Activating theme...\n")
		_, _ = io.WriteString(opts.Out, "Theme activation interrupted, retrying...\n")
		_, _ = io.WriteString(opts.Out, "Theme activation retry 2/3.\n")
		_, _ = io.WriteString(opts.Out, "Theme activation did not settle, retrying...\n")
		return themeinstall.Result{
			ThemeID:       opts.ThemeID,
			PackID:        "clippy",
			Name:          "Clippy",
			ActivePath:    "/themes/u/clippy.json",
			ThemeRevision: 1,
		}, nil
	}

	body := strings.NewReader(`{"themeId":"clippy","packUrl":"https://example.com/clippy.zip","async":true}`)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/themes/install", body)
	req.Header.Set("Content-Type", "application/json")

	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("expected status 202, got %d body=%s", rec.Code, rec.Body.String())
	}
	var started themeInstallJobResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &started); err != nil {
		t.Fatalf("decode start response: %v", err)
	}
	if started.Job.ID == "" || started.Job.Phase != "installing" {
		t.Fatalf("unexpected started job: %+v", started.Job)
	}

	var got themeInstallJobResponse
	for attempt := 0; attempt < 50; attempt++ {
		rec = httptest.NewRecorder()
		req = httptest.NewRequest(http.MethodGet, "/v1/themes/install/status?jobId="+started.Job.ID, nil)
		server.Handler().ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
			t.Fatalf("decode status response: %v", err)
		}
		if got.Job.Phase == "complete" {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if got.Job.Phase != "complete" {
		t.Fatalf("expected completed job, got %+v", got.Job)
	}
	if got.Job.Result == nil || got.Job.Result.ThemeID != "clippy" {
		t.Fatalf("expected result in completed job, got %+v", got.Job)
	}
	joinedLogs := strings.Join(got.Job.Logs, "\n")
	for _, want := range []string{
		"Preparing theme files.",
		"Uploading theme files.",
		"Uploaded theme file 1.",
		"Theme activation interrupted. Retrying.",
		"Retrying theme activation.",
		"Waiting for VibeTV to apply theme.",
		"Theme is active on VibeTV.",
	} {
		if !strings.Contains(joinedLogs, want) {
			t.Fatalf("expected customer progress log %q in %q", want, joinedLogs)
		}
	}
	if strings.Contains(joinedLogs, "/themes/u") || strings.Contains(joinedLogs, "https://example.com") {
		t.Fatalf("async progress leaked technical install detail: %q", joinedLogs)
	}
}

func TestFirmwareUpdateAsyncReportsCustomerProgress(t *testing.T) {
	device := newThemeInstallReadyDeviceServer(t)
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{DeviceTarget: device.URL, DeviceToken: "pair-token"})
	server.updateFirmware = func(_ context.Context, _ string, cfg runtimeconfig.Config, req firmwareUpdateRequest, out io.Writer) error {
		if cfg.DeviceTarget != device.URL || strings.TrimSpace(cfg.DeviceToken) != "pair-token" {
			t.Fatalf("unexpected update config: %+v", cfg)
		}
		if req.Force {
			t.Fatalf("force should default to false")
		}
		for _, line := range []string{
			"Checking device...",
			"Device: esp8266-smalltv-st7789 firmware 1.0.31",
			"Checking firmware...",
			"Updating firmware: 1.0.31 -> 1.0.32",
			"Firmware downloaded: /tmp/private/path sha256=secret",
			"Pausing Mac App during firmware update...",
			"Uploading firmware...",
			"Restarting VibeTV...",
			"Done: firmware 1.0.32 installed",
		} {
			_, _ = io.WriteString(out, line+"\n")
		}
		return nil
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/updates/install", strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json")
	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("expected status 202, got %d body=%s", rec.Code, rec.Body.String())
	}
	var started firmwareUpdateJobResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &started); err != nil {
		t.Fatalf("decode start response: %v", err)
	}
	if started.Job.ID == "" || started.Job.Phase != "installing" {
		t.Fatalf("unexpected started job: %+v", started.Job)
	}

	var got firmwareUpdateJobResponse
	for attempt := 0; attempt < 50; attempt++ {
		rec = httptest.NewRecorder()
		req = httptest.NewRequest(http.MethodGet, "/v1/updates/install/status?jobId="+started.Job.ID, nil)
		server.Handler().ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
			t.Fatalf("decode status response: %v", err)
		}
		if got.Job.Phase == "complete" {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if got.Job.Phase != "complete" || got.Job.Progress != 100 {
		t.Fatalf("expected completed update job, got %+v", got.Job)
	}
	if got.Job.Result == nil || got.Job.Result.Firmware != "1.0.32" {
		t.Fatalf("expected firmware result, got %+v", got.Job.Result)
	}
	joinedLogs := strings.Join(got.Job.Logs, "\n")
	for _, want := range []string{"Checking VibeTV.", "Checking update.", "Update downloaded.", "Updating VibeTV.", "Restarting VibeTV.", "Update complete."} {
		if !strings.Contains(joinedLogs, want) {
			t.Fatalf("expected customer update log %q in %q", want, joinedLogs)
		}
	}
	for _, hidden := range []string{"/tmp/private", "sha256", "secret"} {
		if strings.Contains(joinedLogs, hidden) {
			t.Fatalf("update progress leaked technical detail %q in %q", hidden, joinedLogs)
		}
	}
}

func TestFirmwareUpdateAsyncReportsCustomerError(t *testing.T) {
	device := newThemeInstallReadyDeviceServer(t)
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{DeviceTarget: device.URL, DeviceToken: "pair-token"})
	server.updateFirmware = func(_ context.Context, _ string, _ runtimeconfig.Config, _ firmwareUpdateRequest, out io.Writer) error {
		_, _ = io.WriteString(out, "Checking device...\nUploading firmware...\n")
		return errors.New(`POST /update/firmware.raw returned 401 body="pair-token rejected"`)
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/updates/install", strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json")
	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("expected status 202, got %d body=%s", rec.Code, rec.Body.String())
	}
	var started firmwareUpdateJobResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &started); err != nil {
		t.Fatalf("decode start response: %v", err)
	}

	var got firmwareUpdateJobResponse
	for attempt := 0; attempt < 50; attempt++ {
		rec = httptest.NewRecorder()
		req = httptest.NewRequest(http.MethodGet, "/v1/updates/install/status?jobId="+started.Job.ID, nil)
		server.Handler().ServeHTTP(rec, req)
		if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
			t.Fatalf("decode status response: %v", err)
		}
		if got.Job.Phase == "error" {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if got.Job.Phase != "error" || got.Job.Error == nil {
		t.Fatalf("expected failed update job, got %+v", got.Job)
	}
	if got.Job.Error.Code != "firmware_update_failed" {
		t.Fatalf("unexpected update error: %+v", got.Job.Error)
	}
	joinedLogs := strings.Join(got.Job.Logs, "\n")
	if strings.Contains(joinedLogs, "pair-token") || strings.Contains(got.Job.Error.Message, "pair-token") {
		t.Fatalf("update error leaked token: job=%+v logs=%q", got.Job, joinedLogs)
	}
}

func TestMacAppUpdateAsyncReportsCustomerProgress(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	server.updateMacApp = func(_ context.Context, home string, addr string, req macAppUpdateRequest, out io.Writer) error {
		if strings.TrimSpace(home) == "" {
			t.Fatalf("expected update to receive home directory")
		}
		if addr != DefaultAddr {
			t.Fatalf("unexpected update addr: %q", addr)
		}
		if req.Version != "1.0.36" {
			t.Fatalf("unexpected update request: %+v", req)
		}
		for _, line := range []string{
			"vibetv: repo=DreamyTalesPAN/CodexBar-Display",
			"vibetv: release=v1.0.36",
			"vibetv: arch=arm64",
			"vibetv: Mac setup binary installed at /private/tmp/codexbar-display",
			"vibetv: background service installed at /Users/customer/Library/LaunchAgents/com.codexbar-display.daemon.plist",
			"vibetv: Mac App answered with version 1.0.36; restarting once",
			"vibetv: Mac App update verified",
		} {
			_, _ = io.WriteString(out, line+"\n")
		}
		return nil
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/mac-app/update", strings.NewReader(`{"version":"1.0.36"}`))
	req.Header.Set("Content-Type", "application/json")
	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("expected status 202, got %d body=%s", rec.Code, rec.Body.String())
	}
	var started macAppUpdateJobResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &started); err != nil {
		t.Fatalf("decode start response: %v", err)
	}
	if started.Job.ID == "" || started.Job.Phase != "installing" {
		t.Fatalf("unexpected started job: %+v", started.Job)
	}

	var got macAppUpdateJobResponse
	for attempt := 0; attempt < 50; attempt++ {
		rec = httptest.NewRecorder()
		req = httptest.NewRequest(http.MethodGet, "/v1/mac-app/update/status?jobId="+started.Job.ID, nil)
		server.Handler().ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
			t.Fatalf("decode status response: %v", err)
		}
		if got.Job.Phase == "complete" {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if got.Job.Phase != "complete" || got.Job.Progress != 100 {
		t.Fatalf("expected completed Mac App update job, got %+v", got.Job)
	}
	if got.Job.Result == nil || got.Job.Result.Version != "1.0.36" {
		t.Fatalf("expected Mac App version result, got %+v", got.Job.Result)
	}
	joinedLogs := strings.Join(got.Job.Logs, "\n")
	for _, want := range []string{"Downloading Mac App update.", "Preparing this Mac.", "Installing Mac App.", "Restarting Mac App.", "Checking Mac App.", "Mac App updated."} {
		if !strings.Contains(joinedLogs, want) {
			t.Fatalf("expected customer Mac App update log %q in %q", want, joinedLogs)
		}
	}
	for _, hidden := range []string{"/private", "LaunchAgents", "DreamyTalesPAN/CodexBar-Display"} {
		if strings.Contains(joinedLogs, hidden) {
			t.Fatalf("Mac App update progress leaked technical detail %q in %q", hidden, joinedLogs)
		}
	}
}

func TestMacAppUpdateAsyncReportsCustomerError(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	server.updateMacApp = func(_ context.Context, _ string, _ string, _ macAppUpdateRequest, out io.Writer) error {
		_, _ = io.WriteString(out, "vibetv: release=v1.0.36\nvibetv: arch=arm64\n")
		return errors.New("curl https://token@example.com/private failed")
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/mac-app/update", strings.NewReader(`{"version":"1.0.36"}`))
	req.Header.Set("Content-Type", "application/json")
	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("expected status 202, got %d body=%s", rec.Code, rec.Body.String())
	}
	var started macAppUpdateJobResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &started); err != nil {
		t.Fatalf("decode start response: %v", err)
	}

	var got macAppUpdateJobResponse
	for attempt := 0; attempt < 50; attempt++ {
		rec = httptest.NewRecorder()
		req = httptest.NewRequest(http.MethodGet, "/v1/mac-app/update/status?jobId="+started.Job.ID, nil)
		server.Handler().ServeHTTP(rec, req)
		if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
			t.Fatalf("decode status response: %v", err)
		}
		if got.Job.Phase == "error" {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if got.Job.Phase != "error" || got.Job.Error == nil {
		t.Fatalf("expected failed Mac App update job, got %+v", got.Job)
	}
	if got.Job.Error.Code != "mac_app_update_failed" {
		t.Fatalf("unexpected Mac App update error: %+v", got.Job.Error)
	}
	joinedLogs := strings.Join(got.Job.Logs, "\n")
	for _, hidden := range []string{"token@example.com", "/private"} {
		if strings.Contains(joinedLogs, hidden) {
			t.Fatalf("failed Mac App update leaked technical detail in logs: %q", joinedLogs)
		}
	}
}

func TestThemeInstallErrorIncludesSanitizedDetail(t *testing.T) {
	device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hello":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"board":"esp8266-smalltv-st7789","features":["theme","theme-spec-v1"],"capabilities":{"theme":{"supportsThemeSpecV1":true},"transport":{"active":"wifi"}}}`))
		case "/health":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true,"settings":{"display":{"brightnessPercent":40}}}`))
		default:
			t.Fatalf("unexpected device path %s", r.URL.Path)
		}
	}))
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{DeviceTarget: device.URL, DeviceToken: "pair-token"})
	server.installTheme = func(ctx context.Context, opts themeinstall.Options) (themeinstall.Result, error) {
		return themeinstall.Result{}, errors.New(`theme-pack/upload: post asset /themes/u/cm.cbi: Post "http://vibetv.local/assets?path=%2Fthemes%2Fu%2Fcm.cbi&token=pair-token": connection reset by peer`)
	}

	body := strings.NewReader(`{"themeId":"cozy-meadow","packUrl":"https://example.com/cozy.zip"}`)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/themes/install", body)
	req.Header.Set("Content-Type", "application/json")

	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusBadGateway {
		t.Fatalf("expected status 502, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got errorResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !strings.Contains(got.Error.Message, "theme-pack/upload") {
		t.Fatalf("expected install detail in response, got %+v", got.Error)
	}
	if strings.Contains(got.Error.Message, "pair-token") {
		t.Fatalf("install error leaked pairing token: %q", got.Error.Message)
	}
}

func TestThemeInstallRequiresPairingBeforeWrite(t *testing.T) {
	device := newThemeInstallReadyDeviceServer(t)
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{DeviceTarget: device.URL})
	server.installTheme = func(context.Context, themeinstall.Options) (themeinstall.Result, error) {
		t.Fatal("install should not be called without pairing")
		return themeinstall.Result{}, nil
	}

	body := strings.NewReader(`{"themeId":"cozy-meadow","packUrl":"https://example.com/cozy.zip"}`)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/themes/install", body)
	req.Header.Set("Content-Type", "application/json")

	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected status 403, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got errorResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.OK || got.Error.Code != "pairing_required" {
		t.Fatalf("unexpected pairing response: %+v", got)
	}
}

func TestThemeInstallRejectsInvalidPackURLBeforeGate(t *testing.T) {
	device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatalf("device should not be contacted for invalid pack URL, got %s", r.URL.Path)
	}))
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{DeviceTarget: device.URL, DeviceToken: "pair-token"})
	server.installTheme = func(context.Context, themeinstall.Options) (themeinstall.Result, error) {
		t.Fatal("install should not be called for invalid pack URL")
		return themeinstall.Result{}, nil
	}

	body := strings.NewReader(`{"themeId":"cozy-meadow","packUrl":"/local/theme.zip"}`)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/themes/install", body)
	req.Header.Set("Content-Type", "application/json")

	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected status 400, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got errorResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.OK || got.Error.Code != "invalid_theme_pack_url" {
		t.Fatalf("unexpected invalid pack URL response: %+v", got)
	}
}

func TestThemeInstallRequiresThemeSpecSupportBeforeWrite(t *testing.T) {
	device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hello":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"board":"esp8266-smalltv-st7789","capabilities":{"transport":{"active":"wifi"}}}`))
		case "/health":
			t.Fatal("health should not be called when theme capability is missing")
		default:
			t.Fatalf("unexpected device path %s", r.URL.Path)
		}
	}))
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{DeviceTarget: device.URL, DeviceToken: "pair-token"})
	server.installTheme = func(context.Context, themeinstall.Options) (themeinstall.Result, error) {
		t.Fatal("install should not be called without ThemeSpec support")
		return themeinstall.Result{}, nil
	}

	body := strings.NewReader(`{"themeId":"cozy-meadow","packUrl":"https://example.com/cozy.zip"}`)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/themes/install", body)
	req.Header.Set("Content-Type", "application/json")

	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected status 400, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got errorResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.OK || got.Error.Code != "theme_install_unsupported" {
		t.Fatalf("unexpected unsupported response: %+v", got)
	}
}

func TestThemeInstallRequiresHealthBeforeWrite(t *testing.T) {
	device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hello":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"board":"esp8266-smalltv-st7789","features":["theme","theme-spec-v1"],"capabilities":{"theme":{"supportsThemeSpecV1":true},"transport":{"active":"wifi"}}}`))
		case "/health":
			http.Error(w, "health unavailable", http.StatusServiceUnavailable)
		default:
			t.Fatalf("unexpected device path %s", r.URL.Path)
		}
	}))
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{DeviceTarget: device.URL, DeviceToken: "pair-token"})
	server.installTheme = func(context.Context, themeinstall.Options) (themeinstall.Result, error) {
		t.Fatal("install should not be called when health check fails")
		return themeinstall.Result{}, nil
	}

	body := strings.NewReader(`{"themeId":"cozy-meadow","packUrl":"https://example.com/cozy.zip"}`)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/themes/install", body)
	req.Header.Set("Content-Type", "application/json")

	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusBadGateway {
		t.Fatalf("expected status 502, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got errorResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.OK || got.Error.Code != "device_health_failed" {
		t.Fatalf("unexpected health response: %+v", got)
	}
}

func TestThemeInstallCanBeDisabledByLocalEnv(t *testing.T) {
	t.Setenv(themeInstallDisableEnv, "1")

	device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatalf("device should not be contacted while theme install is disabled, got %s", r.URL.Path)
	}))
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{DeviceTarget: device.URL, DeviceToken: "pair-token"})
	body := strings.NewReader(`{"themeId":"cozy-meadow","packUrl":"https://example.com/cozy.zip"}`)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/themes/install", body)
	req.Header.Set("Content-Type", "application/json")

	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected status 403, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got errorResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.OK || got.Error.Code != "theme_install_disabled" {
		t.Fatalf("unexpected disabled response: %+v", got)
	}
}

func TestSettingsGetReportsActiveTheme(t *testing.T) {
	device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hello":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"board":"esp8266-smalltv-st7789","capabilities":{"display":{"brightness":{"supported":true}},"transport":{"active":"wifi"}}}`))
		case "/health":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true,"display":{"activeTheme":"synthwave"},"settings":{"display":{"brightnessPercent":40}}}`))
		default:
			t.Fatalf("unexpected device path %s", r.URL.Path)
		}
	}))
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{DeviceTarget: device.URL, DeviceToken: "pair-token"})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/settings", nil)

	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	var got settingsResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.Device.ActiveTheme != "synthwave" {
		t.Fatalf("expected active theme synthwave, got %+v", got.Device)
	}
}

func TestSettingsValidatesAndForwardsBrightness(t *testing.T) {
	settingsCalls := 0
	device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hello":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"board":"esp8266-smalltv-st7789","capabilities":{"display":{"brightness":{"supported":true,"minPercent":10,"maxPercent":80}},"transport":{"active":"wifi"}}}`))
		case "/api/settings":
			settingsCalls++
			if got := r.Header.Get("X-VibeTV-Token"); got != "pair-token" {
				t.Fatalf("expected pairing token header, got %q", got)
			}
			if err := r.ParseForm(); err != nil {
				t.Fatalf("parse form: %v", err)
			}
			if got := r.Form.Get("b"); got != "40" {
				t.Fatalf("expected brightness b=40, got %q", got)
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true,"settings":{"display":{"brightnessPercent":40}}}`))
		case "/health":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true,"display":{"activeTheme":"mini-classic","themeSpec":{"active":true,"renderOk":true}},"settings":{"display":{"brightnessPercent":40}}}`))
		default:
			t.Fatalf("unexpected device path %s", r.URL.Path)
		}
	}))
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{DeviceTarget: device.URL, DeviceToken: "pair-token"})

	invalid := httptest.NewRecorder()
	invalidReq := httptest.NewRequest(http.MethodPost, "/v1/settings", strings.NewReader(`{"brightnessPercent":90}`))
	invalidReq.Header.Set("Content-Type", "application/json")
	server.Handler().ServeHTTP(invalid, invalidReq)
	if invalid.Code != http.StatusBadRequest {
		t.Fatalf("expected invalid brightness status 400, got %d body=%s", invalid.Code, invalid.Body.String())
	}
	if settingsCalls != 0 {
		t.Fatalf("invalid brightness should not be forwarded")
	}

	valid := httptest.NewRecorder()
	validReq := httptest.NewRequest(http.MethodPost, "/v1/settings", strings.NewReader(`{"brightnessPercent":40}`))
	validReq.Header.Set("Content-Type", "application/json")
	server.Handler().ServeHTTP(valid, validReq)
	if valid.Code != http.StatusOK {
		t.Fatalf("expected valid brightness status 200, got %d body=%s", valid.Code, valid.Body.String())
	}
	body, _ := io.ReadAll(valid.Body)
	if !strings.Contains(string(body), `"brightnessPercent":40`) {
		t.Fatalf("expected forwarded settings in response, got %s", string(body))
	}
	if settingsCalls != 1 {
		t.Fatalf("expected one forwarded settings call, got %d", settingsCalls)
	}
}

func newTestServer(t *testing.T, cfg runtimeconfig.Config) *Server {
	t.Helper()
	server, err := New(Options{Home: t.TempDir()})
	if err != nil {
		t.Fatalf("new server: %v", err)
	}
	current := cfg
	server.loadConfig = func(string) (runtimeconfig.Config, error) {
		return current, nil
	}
	server.saveConfig = func(_ string, next runtimeconfig.Config) error {
		current = next
		return nil
	}
	server.runSetup = func(context.Context, setup.Options) error {
		return nil
	}
	server.updateFirmware = func(context.Context, string, runtimeconfig.Config, firmwareUpdateRequest, io.Writer) error {
		return nil
	}
	server.updateMacApp = func(context.Context, string, string, macAppUpdateRequest, io.Writer) error {
		return nil
	}
	server.fetchMacAppRelease = func(context.Context) (githubRelease, error) {
		return githubRelease{TagName: "v1.0.0"}, nil
	}
	server.subnetTargets = func() []string {
		return nil
	}
	healthyStream := func(_ context.Context, target string) displayStreamInfo {
		return displayStreamInfo{
			Healthy:    true,
			Running:    true,
			LastSentAt: time.Now().UTC().Format(time.RFC3339),
			Target:     publicTarget(target),
			LastTarget: publicTarget(target),
			Detail:     "Display stream is sending usage frames.",
		}
	}
	server.streamStatus = healthyStream
	server.waitStream = healthyStream
	return server
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (fn roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return fn(req)
}

func newHelloDeviceServer(t *testing.T) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/hello" {
			t.Fatalf("unexpected device path %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"board":"esp8266-smalltv-st7789","firmware":"1.0.31","capabilities":{"transport":{"active":"wifi"}}}`))
	}))
}

func newPairableDeviceServer(t *testing.T) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hello":
			if got := r.Header.Get("X-VibeTV-Token"); got != "pair-token" {
				t.Fatalf("expected pairing token for hello, got %q", got)
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"board":"esp8266-smalltv-st7789","firmware":"1.0.31","capabilities":{"transport":{"active":"wifi"}}}`))
		case "/api/pair":
			if r.Method != http.MethodPost {
				t.Fatalf("expected POST pair, got %s", r.Method)
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true,"token":"pair-token"}`))
		case "/health":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true,"display":{"activeTheme":"mini-classic","themeSpec":{"active":true,"renderOk":true}},"settings":{"display":{"brightnessPercent":40}}}`))
		default:
			t.Fatalf("unexpected device path %s", r.URL.Path)
		}
	}))
}

func newRepairableDeviceServer(t *testing.T) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hello":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"board":"esp8266-smalltv-st7789","firmware":"1.0.31","features":["theme","theme-spec-v1"],"capabilities":{"theme":{"supportsThemeSpecV1":true},"transport":{"active":"wifi"}}}`))
		case "/api/pair":
			if r.Method != http.MethodPost {
				t.Fatalf("expected POST pair, got %s", r.Method)
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true,"token":"new-token"}`))
		case "/health":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true,"display":{"activeTheme":"clippy"},"settings":{"display":{"brightnessPercent":40}}}`))
		default:
			t.Fatalf("unexpected device path %s", r.URL.Path)
		}
	}))
}

func newThemeInstallReadyDeviceServer(t *testing.T) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hello":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"board":"esp8266-smalltv-st7789","firmware":"1.0.31","features":["theme","theme-spec-v1"],"capabilities":{"theme":{"supportsThemeSpecV1":true},"transport":{"active":"wifi"}}}`))
		case "/health":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true,"settings":{"display":{"brightnessPercent":40}}}`))
		default:
			t.Fatalf("unexpected device path %s", r.URL.Path)
		}
	}))
}

func hasDiagnosticCheck(checks []diagnosticCheck, name, status string) bool {
	for _, check := range checks {
		if check.Name == name && check.Status == status {
			return true
		}
	}
	return false
}

func diagnosticCheckDetail(checks []diagnosticCheck, name string) string {
	for _, check := range checks {
		if check.Name == name {
			return check.Detail
		}
	}
	return ""
}
