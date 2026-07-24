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

func TestPreferencePatchReReadsEffectiveDescriptorAfterWrite(t *testing.T) {
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
	server.providerPreferences.verify = func(_ context.Context, _ string, id string) codexbar.ProviderSetup {
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
	if response.Item.Value != true || response.Item.EffectiveValue != true || response.Item.Health.State != "auth_required" || loads != 2 {
		t.Fatalf("expected re-read effective enabled value, got %#v loads=%d", response.Item, loads)
	}
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
	server.providerPreferences.verify = func(_ context.Context, _ string, id string) codexbar.ProviderSetup {
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
	if !enabled || verified != "future-provider" || response.Item.Health.State != "auth_required" {
		t.Fatalf("exact provider readiness was not retained: enabled=%t verified=%q item=%#v", enabled, verified, response.Item)
	}
	if wakes != 0 {
		t.Fatalf("another ready provider must not wake the broken provider stream, got %d", wakes)
	}
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
	if loads != 2 {
		t.Fatalf("disable did not re-read CodexBar's effective inventory: loads=%d", loads)
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
	server.providerPreferences.verify = func(_ context.Context, _ string, id string) codexbar.ProviderSetup {
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
