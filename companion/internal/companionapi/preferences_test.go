package companionapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/daemon"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimeconfig"
)

func TestPreferencesListsAllProvidersWithSafeHealth(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	server.providerPreferences.load = func(context.Context) ([]codexbar.ProviderSetting, error) {
		return []codexbar.ProviderSetting{
			{ID: "claude", Label: "Claude", Enabled: true, Health: codexbar.ProviderHealthAuthRequired, Service: codexbar.ProviderServiceOutage},
			{ID: "copilot", Label: "GitHub Copilot", Enabled: false, Health: codexbar.ProviderHealthChecking, Service: codexbar.ProviderServiceUnknown},
			{ID: "codex", Label: "Codex", Enabled: true, Health: codexbar.ProviderHealthHealthy, Service: codexbar.ProviderServiceOutage},
		}, nil
	}
	server.loadUsage = func(time.Time) (daemon.PersistedUsage, bool) { return daemon.PersistedUsage{}, false }

	recorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/v1/preferences?section=providers", nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("unexpected status %d: %s", recorder.Code, recorder.Body.String())
	}
	var response preferencesResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(response.Items) != 3 || response.Items[1].Health.State != "disabled" {
		t.Fatalf("expected enabled and disabled providers, got %#v", response.Items)
	}
	if response.Items[0].Health.State != "auth_required" || response.Items[0].Health.Service != "outage" {
		t.Fatalf("unexpected health: %#v", response.Items[0].Health)
	}
	if response.Items[2].Health.State != "service_outage" || response.Items[2].Health.Service != "outage" {
		t.Fatalf("unexpected service outage health: %#v", response.Items[2].Health)
	}
	if strings.Contains(strings.ToLower(recorder.Body.String()), "token") {
		t.Fatalf("response should not contain raw auth details: %s", recorder.Body.String())
	}
}

func TestPreferencesMarksUnavailableProviderStaleFromPersistedUsage(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	collectedAt := time.Date(2026, 7, 17, 12, 0, 0, 0, time.UTC)
	server.providerPreferences.load = func(context.Context) ([]codexbar.ProviderSetting, error) {
		return []codexbar.ProviderSetting{{ID: "codex", Label: "Codex", Enabled: true, Health: codexbar.ProviderHealthUnavailable, Service: codexbar.ProviderServiceUnknown}}, nil
	}
	server.loadUsage = func(time.Time) (daemon.PersistedUsage, bool) {
		return daemon.PersistedUsage{Providers: []daemon.ProviderUsageSnapshot{{
			Provider: "codex", Frame: protocol.Frame{Provider: "codex"}, CollectedAt: collectedAt, Stale: true,
		}}}, true
	}

	recorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/v1/preferences?section=providers", nil))
	var response preferencesResponse
	_ = json.Unmarshal(recorder.Body.Bytes(), &response)
	if response.Items[0].Health.State != "stale" || response.Items[0].Health.LastSuccessAt != collectedAt.Format(time.RFC3339) {
		t.Fatalf("unexpected stale health: %#v", response.Items[0].Health)
	}
}

func TestPreferencesReturnsDynamicInventoryBeforeSlowHealthProbeFinishes(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	healthStarted := make(chan struct{})
	releaseHealth := make(chan struct{})
	healthDone := make(chan struct{})
	server.providerPreferences.loadInventory = func(context.Context) ([]codexbar.ProviderSetting, error) {
		return []codexbar.ProviderSetting{{
			ID: "future-provider", Label: "Future Provider", Enabled: true, Health: codexbar.ProviderHealthChecking,
		}}, nil
	}
	server.providerPreferences.load = func(context.Context) ([]codexbar.ProviderSetting, error) {
		close(healthStarted)
		<-releaseHealth
		defer close(healthDone)
		return []codexbar.ProviderSetting{{
			ID: "future-provider", Label: "Future Provider", Enabled: true, Health: codexbar.ProviderHealthHealthy,
		}}, nil
	}
	server.loadUsage = func(time.Time) (daemon.PersistedUsage, bool) { return daemon.PersistedUsage{}, false }

	recorder := httptest.NewRecorder()
	startedAt := time.Now()
	server.Handler().ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/v1/preferences?section=providers", nil))
	if elapsed := time.Since(startedAt); elapsed > 250*time.Millisecond {
		t.Fatalf("provider inventory waited for health: %s", elapsed)
	}
	if recorder.Code != http.StatusOK {
		t.Fatalf("get provider inventory: status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	var response preferencesResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode provider inventory: %v", err)
	}
	if len(response.Items) != 1 || response.Items[0].Label != "Future Provider" || response.Items[0].Health.State != "checking" {
		t.Fatalf("dynamic inventory was not returned immediately: %#v", response)
	}
	select {
	case <-healthStarted:
	case <-time.After(time.Second):
		t.Fatal("background health probe did not start")
	}
	close(releaseHealth)
	select {
	case <-healthDone:
	case <-time.After(time.Second):
		t.Fatal("background health probe did not finish")
	}
	deadline := time.Now().Add(time.Second)
	for {
		server.providerPreferences.mu.Lock()
		refreshing := server.providerPreferences.healthRefresh
		health := server.providerPreferences.cached[0].Health
		server.providerPreferences.mu.Unlock()
		if !refreshing {
			if health != codexbar.ProviderHealthHealthy {
				t.Fatalf("background health was not cached: %q", health)
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("background health result was not applied")
		}
		time.Sleep(time.Millisecond)
	}
}

func TestPreferencePatchReturnsCheckingBeforeExactHealthCompletes(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	enabled := false
	loads := 0
	server.providerPreferences.load = func(context.Context) ([]codexbar.ProviderSetting, error) {
		loads++
		health := codexbar.ProviderHealthChecking
		if enabled {
			health = codexbar.ProviderHealthAuthRequired
		}
		return []codexbar.ProviderSetting{{ID: "claude", Label: "Claude", Enabled: enabled, Health: health, Service: codexbar.ProviderServiceOperational}}, nil
	}
	server.providerPreferences.set = func(_ context.Context, id string, value bool) error {
		if id != "claude" {
			t.Fatalf("unexpected provider id %q", id)
		}
		enabled = value
		return nil
	}
	probeStarted := make(chan struct{})
	releaseProbe := make(chan struct{})
	probeDone := make(chan struct{})
	server.probeExactProvider = func(_ context.Context, _ string, id string) codexbar.ProviderSetup {
		close(probeStarted)
		<-releaseProbe
		defer close(probeDone)
		return codexbar.ProviderSetup{Providers: []codexbar.ProviderReadiness{{
			ID: id, Label: "Claude", Enabled: true, Status: codexbar.ProviderAuthRequired,
		}}}
	}
	server.loadUsage = func(time.Time) (daemon.PersistedUsage, bool) { return daemon.PersistedUsage{}, false }

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPatch, "/v1/preferences/codexbar.providers.claude.enabled", bytes.NewBufferString(`{"value":true}`))
	server.Handler().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("unexpected status %d: %s", recorder.Code, recorder.Body.String())
	}
	var response preferenceResponse
	_ = json.Unmarshal(recorder.Body.Bytes(), &response)
	if response.Item.Value != true || response.Item.EffectiveValue != true || response.Item.Health.State != "checking" || loads != 1 {
		t.Fatalf("expected immediate checking response, got %#v loads=%d", response.Item, loads)
	}
	select {
	case <-probeStarted:
	case <-time.After(time.Second):
		t.Fatal("exact provider probe did not start")
	}
	close(releaseProbe)
	select {
	case <-probeDone:
	case <-time.After(time.Second):
		t.Fatal("exact provider probe did not finish")
	}
	waitForCachedProviderHealth(t, server, "claude", codexbar.ProviderHealthAuthRequired)
}

func TestProviderPreferencePatchIsExactCustomerRetryPath(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	enabled := false
	server.providerPreferences.load = func(context.Context) ([]codexbar.ProviderSetting, error) {
		return []codexbar.ProviderSetting{
			{ID: "codex", Label: "Codex", Enabled: true, Health: codexbar.ProviderHealthHealthy},
			{ID: "future-provider", Label: "Future Provider", Enabled: enabled, Health: codexbar.ProviderHealthChecking},
		}, nil
	}
	server.providerPreferences.set = func(_ context.Context, id string, value bool) error {
		if id != "future-provider" {
			t.Fatalf("unexpected provider ID %q", id)
		}
		enabled = value
		return nil
	}
	var verified string
	probeDone := make(chan struct{})
	server.probeExactProvider = func(_ context.Context, _ string, id string) codexbar.ProviderSetup {
		defer close(probeDone)
		verified = id
		return codexbar.ProviderSetup{
			Status: codexbar.ProviderReady,
			Providers: []codexbar.ProviderReadiness{
				{ID: "codex", Label: "Codex", Enabled: true, Status: codexbar.ProviderReady},
				{ID: id, Label: "Future Provider", Enabled: true, Status: codexbar.ProviderAuthRequired},
			},
		}
	}
	wakes := 0
	server.wakeDisplayStream = func() { wakes++ }
	server.loadUsage = func(time.Time) (daemon.PersistedUsage, bool) { return daemon.PersistedUsage{}, false }

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(
		http.MethodPatch,
		"/v1/preferences/codexbar.providers.future-provider.enabled",
		bytes.NewBufferString(`{"value":true}`),
	)
	server.Handler().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("unexpected status %d: %s", recorder.Code, recorder.Body.String())
	}
	var response preferenceResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !enabled || response.Item.Health.State != "checking" {
		t.Fatalf("exact provider readiness was not retained: enabled=%t verified=%q item=%#v", enabled, verified, response.Item)
	}
	select {
	case <-probeDone:
	case <-time.After(time.Second):
		t.Fatal("exact provider probe did not finish")
	}
	waitForCachedProviderHealth(t, server, "future-provider", codexbar.ProviderHealthAuthRequired)
	if verified != "future-provider" {
		t.Fatalf("exact provider readiness was not retained: verified=%q", verified)
	}
	if wakes != 0 {
		t.Fatalf("another ready provider must not wake the broken provider stream, got %d", wakes)
	}
}

func TestEnablingAnotherProviderDoesNotCancelFirstExactProbe(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	enabled := map[string]bool{"provider-a": false, "provider-b": false}
	server.providerPreferences.load = func(context.Context) ([]codexbar.ProviderSetting, error) {
		return []codexbar.ProviderSetting{
			{ID: "provider-a", Label: "Provider A", Enabled: enabled["provider-a"], Health: codexbar.ProviderHealthChecking},
			{ID: "provider-b", Label: "Provider B", Enabled: enabled["provider-b"], Health: codexbar.ProviderHealthChecking},
		}, nil
	}
	server.providerPreferences.set = func(_ context.Context, id string, value bool) error {
		enabled[id] = value
		return nil
	}
	started := make(chan string, 2)
	releaseA := make(chan struct{})
	releaseB := make(chan struct{})
	server.probeExactProvider = func(_ context.Context, _ string, id string) codexbar.ProviderSetup {
		started <- id
		if id == "provider-a" {
			<-releaseA
		} else {
			<-releaseB
		}
		return codexbar.ProviderSetup{Providers: []codexbar.ProviderReadiness{{
			ID: id, Label: id, Enabled: true, Status: codexbar.ProviderAuthRequired,
		}}}
	}
	server.loadUsage = func(time.Time) (daemon.PersistedUsage, bool) { return daemon.PersistedUsage{}, false }

	for _, id := range []string{"provider-a", "provider-b"} {
		recorder := httptest.NewRecorder()
		server.Handler().ServeHTTP(
			recorder,
			httptest.NewRequest(
				http.MethodPatch,
				"/v1/preferences/codexbar.providers."+id+".enabled",
				bytes.NewBufferString(`{"value":true}`),
			),
		)
		if recorder.Code != http.StatusOK {
			t.Fatalf("enable %s: status=%d body=%s", id, recorder.Code, recorder.Body.String())
		}
	}
	for range 2 {
		select {
		case <-started:
		case <-time.After(time.Second):
			t.Fatal("both exact provider probes did not start")
		}
	}
	close(releaseA)
	close(releaseB)
	waitForCachedProviderHealth(t, server, "provider-a", codexbar.ProviderHealthAuthRequired)
	waitForCachedProviderHealth(t, server, "provider-b", codexbar.ProviderHealthAuthRequired)
}

func TestDisablingProviderRemovesItsPersistedUsageCard(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	cursorEnabled := true
	loads := 0
	server.providerPreferences.load = func(context.Context) ([]codexbar.ProviderSetting, error) {
		loads++
		return []codexbar.ProviderSetting{
			{ID: "codex", Label: "Codex", Enabled: true, Health: codexbar.ProviderHealthHealthy},
			{ID: "cursor", Label: "Cursor", Enabled: cursorEnabled, Health: codexbar.ProviderHealthHealthy},
		}, nil
	}
	server.providerPreferences.set = func(_ context.Context, id string, enabled bool) error {
		if id != "cursor" {
			t.Fatalf("unexpected provider ID %q", id)
		}
		cursorEnabled = enabled
		return nil
	}
	server.loadUsage = func(now time.Time) (daemon.PersistedUsage, bool) {
		return daemon.PersistedUsage{
			SavedAt:         now,
			CurrentProvider: "cursor",
			Providers: []daemon.ProviderUsageSnapshot{
				{
					Provider:    "cursor",
					Frame:       protocol.Frame{Provider: "cursor", Label: "Cursor", Session: 57, Weekly: 100},
					CollectedAt: now,
				},
				{
					Provider:    "codex",
					Frame:       protocol.Frame{Provider: "codex", Label: "Codex", Session: 12, Weekly: 34},
					CollectedAt: now,
				},
			},
		}, true
	}

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(
		http.MethodPatch,
		"/v1/preferences/codexbar.providers.cursor.enabled",
		bytes.NewBufferString(`{"value":false}`),
	)
	server.Handler().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("disable Cursor: status=%d body=%s", recorder.Code, recorder.Body.String())
	}

	recorder = httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/v1/usage", nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("get usage: status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	var response usageResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode usage: %v", err)
	}
	if response.CurrentProvider != "codex" || len(response.Providers) != 1 || response.Providers[0].ID != "codex" {
		t.Fatalf("disabled provider remained visible: %#v", response)
	}
	if loads != 1 {
		t.Fatalf("disable waited for an unnecessary health re-read: loads=%d", loads)
	}
}

func TestEnabledProviderExactUsageReplacesStaleSnapshotWithoutWaitingForAnotherCycle(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	enabled := false
	now := time.Now().UTC()
	server.now = func() time.Time { return now }
	server.providerPreferences.load = func(context.Context) ([]codexbar.ProviderSetting, error) {
		return []codexbar.ProviderSetting{
			{ID: "codex", Label: "Codex", Enabled: true, Health: codexbar.ProviderHealthHealthy},
			{ID: "future-provider", Label: "Future Provider", Enabled: enabled, Health: codexbar.ProviderHealthChecking},
		}, nil
	}
	server.providerPreferences.set = func(_ context.Context, id string, value bool) error {
		if id != "future-provider" {
			t.Fatalf("unexpected provider ID %q", id)
		}
		enabled = value
		return nil
	}
	probeDone := make(chan struct{})
	server.probeExactProvider = func(_ context.Context, _ string, id string) codexbar.ProviderSetup {
		defer close(probeDone)
		return codexbar.ProviderSetup{
			Status: codexbar.ProviderReady,
			Providers: []codexbar.ProviderReadiness{{
				ID: id, Label: "Future Provider", Enabled: true, Status: codexbar.ProviderReady,
			}},
			ExactUsage: &codexbar.ParsedFrame{
				Provider:    id,
				Frame:       protocol.Frame{Provider: id, Label: "Future Provider", Weekly: 43, UsageUnavailable: true},
				Source:      "oauth",
				CollectedAt: now,
				Meta: codexbar.ProviderUsageMeta{Windows: []codexbar.UsageWindow{{
					ID: "secondary", Label: "Weekly", UsedPercent: 43,
				}}},
			},
		}
	}
	server.loadUsage = func(time.Time) (daemon.PersistedUsage, bool) {
		return daemon.PersistedUsage{
			SavedAt:         now.Add(-time.Hour),
			CurrentProvider: "gemini",
			Providers: []daemon.ProviderUsageSnapshot{
				{
					Provider:    "codex",
					Frame:       protocol.Frame{Provider: "codex", Label: "Codex", Session: 12, Weekly: 34},
					CollectedAt: now,
				},
				{
					Provider:    "future-provider",
					Frame:       protocol.Frame{Provider: "future-provider", Label: "Future Provider"},
					CollectedAt: now.Add(-time.Hour),
					Stale:       true,
				},
			},
		}, true
	}
	server.fetchUsage = func(context.Context) ([]codexbar.ParsedFrame, error) {
		t.Fatal("usage endpoint must reuse the completed exact activation probe")
		return nil, errors.New("unexpected fetch")
	}

	recorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(
		recorder,
		httptest.NewRequest(
			http.MethodPatch,
			"/v1/preferences/codexbar.providers.future-provider.enabled",
			bytes.NewBufferString(`{"value":true}`),
		),
	)
	if recorder.Code != http.StatusOK {
		t.Fatalf("enable future provider: status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	select {
	case <-probeDone:
	case <-time.After(time.Second):
		t.Fatal("exact provider probe did not finish")
	}
	deadline := time.Now().Add(time.Second)
	for {
		server.usageCacheMu.RLock()
		cached := server.usageCache != nil
		server.usageCacheMu.RUnlock()
		if cached {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("exact provider usage was not cached")
		}
		time.Sleep(time.Millisecond)
	}

	recorder = httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/v1/usage", nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("get usage: status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	var response usageResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode usage: %v", err)
	}
	if response.CurrentProvider != "future-provider" {
		t.Fatalf("fresh exact provider did not displace stale current provider: %#v", response)
	}
	for _, provider := range response.Providers {
		if provider.ID != "future-provider" {
			continue
		}
		if provider.Weekly != 43 || len(provider.Windows) != 1 || provider.Stale || provider.UsageUnavailable {
			t.Fatalf("exact provider usage did not replace stale snapshot: %#v", provider)
		}
		return
	}
	t.Fatalf("freshly enabled provider missing from usage: %#v", response)
}

func TestFreshExactZeroUsageDisplacesStaleGeminiSnapshot(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	now := time.Date(2026, 7, 24, 8, 0, 0, 0, time.UTC)
	server.now = func() time.Time { return now }
	server.loadUsage = func(time.Time) (daemon.PersistedUsage, bool) {
		return daemon.PersistedUsage{
			SavedAt:         now.Add(-48 * time.Hour),
			CurrentProvider: "gemini",
			Providers: []daemon.ProviderUsageSnapshot{{
				Provider:    "gemini",
				Frame:       protocol.Frame{Provider: "gemini", Label: "Gemini", Session: 0, Weekly: 0},
				CollectedAt: now.Add(-48 * time.Hour),
				Stale:       true,
			}},
		}, true
	}

	server.cacheExactProviderUsage(codexbar.ParsedFrame{
		Provider:    "antigravity",
		Frame:       protocol.Frame{Provider: "antigravity", Label: "Antigravity", Session: 0, Weekly: 0},
		Source:      "cli",
		CollectedAt: now,
	})

	server.usageCacheMu.RLock()
	defer server.usageCacheMu.RUnlock()
	if server.usageCache == nil || server.usageCache.CurrentProvider != "antigravity" {
		t.Fatalf("fresh Antigravity did not become current: %#v", server.usageCache)
	}
	for _, provider := range server.usageCache.Providers {
		if provider.ID == "antigravity" && !provider.Stale && !provider.UsageUnavailable {
			return
		}
	}
	t.Fatalf("fresh zero-usage Antigravity snapshot missing: %#v", server.usageCache)
}

func TestExactUsageCacheRejectsOldOrUndatedSnapshots(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	now := time.Date(2026, 7, 24, 8, 0, 0, 0, time.UTC)
	server.now = func() time.Time { return now }

	for _, collectedAt := range []time.Time{{}, now.Add(-16 * time.Minute)} {
		server.cacheExactProviderUsage(codexbar.ParsedFrame{
			Provider:    "future-provider",
			Frame:       protocol.Frame{Provider: "future-provider", Label: "Future Provider", Weekly: 42},
			CollectedAt: collectedAt,
		})
	}

	server.usageCacheMu.RLock()
	defer server.usageCacheMu.RUnlock()
	if server.usageCache != nil {
		t.Fatalf("untrusted exact usage was cached as fresh: %#v", server.usageCache)
	}
}

func TestStaleUsageSnapshotNeverPresentsUnknownPercentagesAsRealZero(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	now := time.Date(2026, 7, 24, 8, 0, 0, 0, time.UTC)
	server.providerPreferences.loadInventory = func(context.Context) ([]codexbar.ProviderSetting, error) {
		return []codexbar.ProviderSetting{{ID: "future-provider", Label: "Future Provider", Enabled: true}}, nil
	}
	server.loadUsage = func(time.Time) (daemon.PersistedUsage, bool) {
		return daemon.PersistedUsage{
			SavedAt: now.Add(-time.Hour),
			Providers: []daemon.ProviderUsageSnapshot{{
				Provider:    "future-provider",
				Frame:       protocol.Frame{Provider: "future-provider", Label: "Future Provider"},
				CollectedAt: now.Add(-time.Hour),
				Stale:       true,
			}},
		}, true
	}
	server.fetchUsage = nil

	recorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/v1/usage", nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("get usage: status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	var response usageResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode usage: %v", err)
	}
	if len(response.Providers) != 1 || !response.Providers[0].UsageUnavailable {
		t.Fatalf("stale zero usage looked trustworthy: %#v", response)
	}
}

func TestEnablingProviderInvalidatesWarmUsageCache(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	enabled := false
	server.providerPreferences.load = func(context.Context) ([]codexbar.ProviderSetting, error) {
		return []codexbar.ProviderSetting{
			{ID: "codex", Label: "Codex", Enabled: true, Health: codexbar.ProviderHealthHealthy},
			{ID: "future-provider", Label: "Future Provider", Enabled: enabled, Health: codexbar.ProviderHealthHealthy},
		}, nil
	}
	server.providerPreferences.set = func(_ context.Context, id string, value bool) error {
		if id != "future-provider" {
			t.Fatalf("unexpected provider ID %q", id)
		}
		enabled = value
		return nil
	}
	server.probeExactProvider = func(_ context.Context, _ string, id string) codexbar.ProviderSetup {
		return codexbar.ProviderSetup{Status: codexbar.ProviderReady, Providers: []codexbar.ProviderReadiness{{
			ID: id, Label: "Future Provider", Enabled: true, Status: codexbar.ProviderReady,
		}}}
	}
	server.loadUsage = func(time.Time) (daemon.PersistedUsage, bool) { return daemon.PersistedUsage{}, false }
	fetches := 0
	server.fetchUsage = func(context.Context) ([]codexbar.ParsedFrame, error) {
		fetches++
		return []codexbar.ParsedFrame{
			{Provider: "codex", Frame: protocol.Frame{Provider: "codex", Label: "Codex", Session: 12, Weekly: 34}},
			{Provider: "future-provider", Frame: protocol.Frame{Provider: "future-provider", Label: "Future Provider", Session: 21, Weekly: 43}},
		}, nil
	}
	server.usageCache = &usageResponse{
		CurrentProvider: "codex",
		Providers:       []usageProviderInfo{{ID: "codex", Label: "Codex", Session: 12, Weekly: 34}},
	}
	server.usageCacheAt = time.Now().UTC()

	recorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(
		recorder,
		httptest.NewRequest(
			http.MethodPatch,
			"/v1/preferences/codexbar.providers.future-provider.enabled",
			bytes.NewBufferString(`{"value":true}`),
		),
	)
	if recorder.Code != http.StatusOK {
		t.Fatalf("enable future provider: status=%d body=%s", recorder.Code, recorder.Body.String())
	}

	recorder = httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/v1/usage", nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("get usage: status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	var response usageResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode usage: %v", err)
	}
	if fetches != 1 || len(response.Providers) != 2 || response.Providers[1].ID != "future-provider" {
		t.Fatalf("warm usage cache survived enable: fetches=%d response=%#v", fetches, response)
	}
}

func TestUsageFiltersDisabledProviderWithColdPreferenceCache(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	server.providerPreferences.cached = nil
	server.providerPreferences.inventory = nil
	server.providerPreferences.loadInventory = func(context.Context) ([]codexbar.ProviderSetting, error) {
		return []codexbar.ProviderSetting{
			{ID: "codex", Label: "Codex", Enabled: true},
			{ID: "cursor", Label: "Cursor", Enabled: false},
		}, nil
	}
	server.loadUsage = func(now time.Time) (daemon.PersistedUsage, bool) {
		return daemon.PersistedUsage{
			SavedAt:         now,
			CurrentProvider: "cursor",
			Providers: []daemon.ProviderUsageSnapshot{
				{Provider: "cursor", Frame: protocol.Frame{Provider: "cursor", Label: "Cursor", Session: 57, Weekly: 100}, CollectedAt: now},
				{Provider: "codex", Frame: protocol.Frame{Provider: "codex", Label: "Codex", Session: 12, Weekly: 34}, CollectedAt: now},
			},
		}, true
	}

	recorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/v1/usage", nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("get cold usage: status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	var response usageResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode usage: %v", err)
	}
	if response.CurrentProvider != "codex" || len(response.Providers) != 1 || response.Providers[0].ID != "codex" {
		t.Fatalf("cold preference cache exposed disabled provider: %#v", response)
	}
}

func TestUsageInventoryDoesNotWaitForParallelPreferenceHealth(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	healthStarted := make(chan struct{})
	releaseHealth := make(chan struct{})
	server.providerPreferences.load = func(context.Context) ([]codexbar.ProviderSetting, error) {
		close(healthStarted)
		<-releaseHealth
		return []codexbar.ProviderSetting{{ID: "codex", Label: "Codex", Enabled: true}}, nil
	}
	server.providerPreferences.cached = nil
	server.providerPreferences.inventory = nil
	server.providerPreferences.loadInventory = func(context.Context) ([]codexbar.ProviderSetting, error) {
		return []codexbar.ProviderSetting{
			{ID: "codex", Label: "Codex", Enabled: true},
			{ID: "cursor", Label: "Cursor", Enabled: false},
		}, nil
	}
	server.loadUsage = func(now time.Time) (daemon.PersistedUsage, bool) {
		return daemon.PersistedUsage{
			SavedAt: now,
			Providers: []daemon.ProviderUsageSnapshot{
				{Provider: "cursor", Frame: protocol.Frame{Provider: "cursor", Label: "Cursor", Session: 57, Weekly: 100}, CollectedAt: now},
				{Provider: "codex", Frame: protocol.Frame{Provider: "codex", Label: "Codex", Session: 12, Weekly: 34}, CollectedAt: now},
			},
		}, true
	}

	preferencesDone := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		recorder := httptest.NewRecorder()
		server.Handler().ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/v1/preferences?section=providers", nil))
		preferencesDone <- recorder
	}()
	<-healthStarted

	usageDone := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		recorder := httptest.NewRecorder()
		server.Handler().ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/v1/usage", nil))
		usageDone <- recorder
	}()
	select {
	case recorder := <-usageDone:
		if recorder.Code != http.StatusOK || strings.Contains(recorder.Body.String(), `"id":"cursor"`) {
			t.Fatalf("parallel usage was not safely filtered: status=%d body=%s", recorder.Code, recorder.Body.String())
		}
	case <-time.After(time.Second):
		t.Fatal("usage waited for the slower provider-health request")
	}
	close(releaseHealth)
	if recorder := <-preferencesDone; recorder.Code != http.StatusOK {
		t.Fatalf("preferences request failed: status=%d body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestUsageInventoryLookupHasShortDeadlineAndPreservesStaleUsage(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	previousTimeout := providerUsageInventoryTimeout
	providerUsageInventoryTimeout = 25 * time.Millisecond
	t.Cleanup(func() { providerUsageInventoryTimeout = previousTimeout })

	server.providerPreferences.cached = nil
	server.providerPreferences.inventory = nil
	server.providerPreferences.loadInventory = func(ctx context.Context) ([]codexbar.ProviderSetting, error) {
		<-ctx.Done()
		return nil, ctx.Err()
	}
	server.loadUsage = func(now time.Time) (daemon.PersistedUsage, bool) {
		return daemon.PersistedUsage{
			SavedAt:         now.Add(-time.Hour),
			CurrentProvider: "future-provider",
			Providers: []daemon.ProviderUsageSnapshot{{
				Provider:    "future-provider",
				Frame:       protocol.Frame{Provider: "future-provider", Label: "Future Provider", Session: 57, Weekly: 100},
				CollectedAt: now.Add(-time.Hour),
				Stale:       true,
			}},
		}, true
	}
	server.fetchUsage = nil

	startedAt := time.Now()
	recorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/v1/usage", nil))
	if elapsed := time.Since(startedAt); elapsed > 500*time.Millisecond {
		t.Fatalf("usage waited too long for provider inventory: %s", elapsed)
	}
	if recorder.Code != http.StatusOK {
		t.Fatalf("get usage: status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	var response usageResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode usage: %v", err)
	}
	if len(response.Providers) != 1 || response.Providers[0].ID != "future-provider" || !response.Providers[0].Stale {
		t.Fatalf("inventory timeout changed safe stale usage semantics: %#v", response)
	}
}

func TestPreferencePatchRejectsUnknownAndNonBooleanWithoutWrite(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	server.providerPreferences.load = func(context.Context) ([]codexbar.ProviderSetting, error) {
		return []codexbar.ProviderSetting{{ID: "claude", Label: "Claude", Enabled: true}}, nil
	}
	writes := 0
	server.providerPreferences.set = func(context.Context, string, bool) error { writes++; return nil }

	tests := []struct {
		path string
		body string
		want int
	}{
		{"/v1/preferences/codexbar.providers.unknown.enabled", `{"value":true}`, http.StatusNotFound},
		{"/v1/preferences/codexbar.providers.claude.enabled", `{"value":"true"}`, http.StatusBadRequest},
	}
	for _, test := range tests {
		recorder := httptest.NewRecorder()
		server.Handler().ServeHTTP(recorder, httptest.NewRequest(http.MethodPatch, test.path, bytes.NewBufferString(test.body)))
		if recorder.Code != test.want {
			t.Fatalf("%s: got %d want %d: %s", test.path, recorder.Code, test.want, recorder.Body.String())
		}
	}
	if writes != 0 {
		t.Fatalf("expected no writes, got %d", writes)
	}
}

func TestPreferencesRedactsBackendErrorsAndCachesReads(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	loads := 0
	server.providerPreferences.load = func(context.Context) ([]codexbar.ProviderSetting, error) {
		loads++
		if loads == 1 {
			return []codexbar.ProviderSetting{{ID: "codex", Label: "Codex", Enabled: true}}, nil
		}
		return nil, &codexbar.ProviderSettingsError{Kind: codexbar.ProviderSettingsErrorUnavailable, Err: errors.New("secret-token-value")}
	}

	for range 2 {
		recorder := httptest.NewRecorder()
		server.Handler().ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/v1/preferences?section=providers", nil))
		if recorder.Code != http.StatusOK {
			t.Fatalf("unexpected cached read status %d", recorder.Code)
		}
	}
	if loads != 1 {
		t.Fatalf("expected one cached load, got %d", loads)
	}

	server.providerPreferences.cached = nil
	recorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/v1/preferences?section=providers", nil))
	if recorder.Code != http.StatusServiceUnavailable || strings.Contains(recorder.Body.String(), "secret-token-value") {
		t.Fatalf("expected safe unavailable error, got %d %s", recorder.Code, recorder.Body.String())
	}
}

type testPreferenceAdapter struct {
	section string
	items   []preferenceDescriptor
	writes  map[string]any
}

func waitForCachedProviderHealth(
	t *testing.T,
	server *Server,
	providerID string,
	want codexbar.ProviderHealthState,
) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for {
		server.providerPreferences.mu.Lock()
		var got codexbar.ProviderHealthState
		for _, setting := range server.providerPreferences.cached {
			if setting.ID == providerID {
				got = setting.Health
				break
			}
		}
		server.providerPreferences.mu.Unlock()
		if got == want {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("provider %q health=%q want=%q", providerID, got, want)
		}
		time.Sleep(time.Millisecond)
	}
}

func (a *testPreferenceAdapter) Section() string { return a.section }

func (a *testPreferenceAdapter) Owns(settingID string) bool {
	return strings.HasPrefix(settingID, "test.")
}

func (a *testPreferenceAdapter) List(context.Context) ([]preferenceDescriptor, error) {
	return append([]preferenceDescriptor(nil), a.items...), nil
}

func (a *testPreferenceAdapter) Write(_ context.Context, settingID string, value any) (preferenceDescriptor, error) {
	for i := range a.items {
		if a.items[i].ID == settingID {
			a.items[i].Value = value
			a.items[i].EffectiveValue = value
			if a.writes == nil {
				a.writes = make(map[string]any)
			}
			a.writes[settingID] = value
			return a.items[i], nil
		}
	}
	return preferenceDescriptor{}, errPreferenceNotFound
}

func TestPreferenceRegistrySupportsTypedDescriptorsWithoutNewRoutes(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	minimum := int64(30)
	maximum := int64(3600)
	step := int64(30)
	adapter := &testPreferenceAdapter{
		section: "test",
		items: []preferenceDescriptor{
			{
				ID: "test.enabled", Section: "test", Owner: "vibetv", Type: preferenceTypeBoolean,
				Label: "Enabled", Value: true, EffectiveValue: true, Availability: preferenceAvailability{State: "available"},
				WriteStrategy: "vibetv_override", Writable: true,
			},
			{
				ID: "test.mode", Section: "test", Owner: "vibetv", Type: preferenceTypeEnum,
				Label: "Mode", Value: "used", EffectiveValue: "used", AllowsDefault: true,
				Options:      []preferenceOption{{Value: "used", Label: "Used"}, {Value: "remaining", Label: "Remaining"}},
				Availability: preferenceAvailability{State: "available"}, WriteStrategy: "vibetv_override", Writable: true,
			},
			{
				ID: "test.refresh", Section: "test", Owner: "vibetv", Type: preferenceTypeDuration,
				Label: "Refresh", Value: int64(60), EffectiveValue: int64(60),
				Constraints:  &preferenceConstraints{Min: &minimum, Max: &maximum, Step: &step, Unit: "seconds"},
				Availability: preferenceAvailability{State: "available"}, WriteStrategy: "vibetv_override", Writable: true,
			},
		},
	}
	server.preferenceAdapters = []preferenceAdapter{adapter}

	list := httptest.NewRecorder()
	server.Handler().ServeHTTP(list, httptest.NewRequest(http.MethodGet, "/v1/preferences?section=test", nil))
	if list.Code != http.StatusOK {
		t.Fatalf("list typed preferences: %d %s", list.Code, list.Body.String())
	}
	var response preferencesResponse
	if err := json.Unmarshal(list.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode typed preferences: %v", err)
	}
	if response.SchemaVersion != preferenceSchemaVersion || len(response.Items) != 3 {
		t.Fatalf("unexpected typed registry response: %#v", response)
	}

	for _, test := range []struct {
		id    string
		value string
		want  any
	}{
		{id: "test.enabled", value: `false`, want: false},
		{id: "test.mode", value: `"remaining"`, want: "remaining"},
		{id: "test.refresh", value: `90`, want: int64(90)},
	} {
		recorder := httptest.NewRecorder()
		body := bytes.NewBufferString(`{"value":` + test.value + `}`)
		server.Handler().ServeHTTP(recorder, httptest.NewRequest(http.MethodPatch, "/v1/preferences/"+test.id, body))
		if recorder.Code != http.StatusOK {
			t.Fatalf("patch %s: %d %s", test.id, recorder.Code, recorder.Body.String())
		}
		if adapter.writes[test.id] != test.want {
			t.Fatalf("patch %s wrote %#v, want %#v", test.id, adapter.writes[test.id], test.want)
		}
	}
}

func TestPreferenceRegistryRejectsInvalidEnumRangeAndDefault(t *testing.T) {
	minimum := int64(30)
	maximum := int64(120)
	descriptors := []preferenceDescriptor{
		{Type: preferenceTypeEnum, Options: []preferenceOption{{Value: "used", Label: "Used"}}},
		{Type: preferenceTypeDuration, Constraints: &preferenceConstraints{Min: &minimum, Max: &maximum}},
		{Type: preferenceTypeBoolean},
	}
	for index, test := range []struct {
		descriptor preferenceDescriptor
		raw        string
	}{
		{descriptor: descriptors[0], raw: `"other"`},
		{descriptor: descriptors[1], raw: `10`},
		{descriptor: descriptors[1], raw: `121`},
		{descriptor: descriptors[2], raw: `null`},
	} {
		if _, err := validatePreferenceValue(test.descriptor, json.RawMessage(test.raw)); err == nil {
			t.Fatalf("case %d unexpectedly accepted %s", index, test.raw)
		}
	}

	inheritable := preferenceDescriptor{Type: preferenceTypeEnum, AllowsDefault: true}
	value, err := validatePreferenceValue(inheritable, json.RawMessage(`null`))
	if err != nil || value != nil {
		t.Fatalf("default inheritance should produce nil, got %#v err=%v", value, err)
	}
}

func TestSecretPreferenceDescriptorNeverReturnsSecretValue(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	server.preferenceAdapters = []preferenceAdapter{&testPreferenceAdapter{
		section: "test",
		items: []preferenceDescriptor{{
			ID: "test.secret", Section: "test", Owner: "vibetv", Type: preferenceTypeSecret,
			Label: "Credential", Value: nil, EffectiveValue: nil, SecretState: "configured",
			Availability: preferenceAvailability{State: "available"}, WriteStrategy: "secure_session", Writable: false,
		}},
	}}

	recorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/v1/preferences?section=test", nil))
	if recorder.Code != http.StatusOK || strings.Contains(recorder.Body.String(), "super-secret") {
		t.Fatalf("secret descriptor response is unsafe: %d %s", recorder.Code, recorder.Body.String())
	}
	if !strings.Contains(recorder.Body.String(), `"secretState":"configured"`) || !strings.Contains(recorder.Body.String(), `"value":null`) {
		t.Fatalf("secret descriptor should expose state only: %s", recorder.Body.String())
	}
}
