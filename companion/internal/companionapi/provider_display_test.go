package companionapi

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimeconfig"
)

func TestProviderDisplayDefaultsToAllEnabledProviders(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	server.providerPreferences.load = providerSettingsFixture

	recorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/v1/provider-display", nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("get provider display: status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	var response providerDisplayResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.Selection.Mode != providerDisplayModeAutomatic || response.Selection.Configured || !response.Selection.Valid {
		t.Fatalf("unexpected legacy selection: %+v", response.Selection)
	}
	if len(response.Selection.ProviderIDs) != 2 || response.Selection.ProviderIDs[0] != "codex" || response.Selection.ProviderIDs[1] != "claude" {
		t.Fatalf("unexpected enabled providers: %+v", response.Selection.ProviderIDs)
	}
}

func TestProviderDisplayPatchPersistsValidatedFixedSelection(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	server.providerPreferences.load = providerSettingsFixture
	wakes := 0
	server.wakeDisplayStream = func() { wakes++ }

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPatch, "/v1/provider-display", bytes.NewBufferString(`{"mode":"fixed","providerIds":[" CLAUDE "]}`))
	server.Handler().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("patch provider display: status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	cfg, err := server.config()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.ProviderDisplay == nil || cfg.ProviderDisplay.Mode != providerDisplayModeFixed || len(cfg.ProviderDisplay.ProviderIDs) != 1 || cfg.ProviderDisplay.ProviderIDs[0] != "claude" {
		t.Fatalf("unexpected saved display config: %+v", cfg.ProviderDisplay)
	}
	if wakes != 1 {
		t.Fatalf("expected one display wake, got %d", wakes)
	}
}

func TestProviderDisplayRejectsDisabledProvider(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	server.providerPreferences.load = providerSettingsFixture

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPatch, "/v1/provider-display", bytes.NewBufferString(`{"mode":"fixed","providerIds":["cursor"]}`))
	server.Handler().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusConflict || !bytes.Contains(recorder.Body.Bytes(), []byte(`"provider_display_disabled"`)) {
		t.Fatalf("expected safe disabled-provider conflict, status=%d body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestProviderSetupCompletionRequiresEveryEnabledProviderFreshAndReady(t *testing.T) {
	now := time.Date(2026, 7, 31, 12, 0, 0, 0, time.UTC)
	server := newTestServer(t, runtimeconfig.Config{
		DeviceID: "device-a",
		ProviderDisplay: &runtimeconfig.ProviderDisplayConfig{
			Mode:        providerDisplayModeAutomatic,
			ProviderIDs: []string{"codex", "claude"},
		},
	})
	server.now = func() time.Time { return now }
	server.providerPreferences.load = providerSettingsFixture
	if _, err := server.cachedProviderSettings(context.Background(), true); err != nil {
		t.Fatal(err)
	}
	server.recordExactProviderSetup("codex", 0, exactSetupFixture(now, "codex", codexbar.ProviderReady))
	server.recordExactProviderSetup("claude", 0, exactSetupFixture(now, "claude", codexbar.ProviderAuthRequired))

	recorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/v1/setup/providers/complete", nil))
	if recorder.Code != http.StatusConflict || !bytes.Contains(recorder.Body.Bytes(), []byte(`"provider_check_required"`)) {
		t.Fatalf("expected mixed readiness to block setup, status=%d body=%s", recorder.Code, recorder.Body.String())
	}

	server.recordExactProviderSetup("claude", 0, exactSetupFixture(now, "claude", codexbar.ProviderReady))
	recorder = httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/v1/setup/providers/complete", nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("complete provider setup: status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	cfg, err := server.config()
	if err != nil {
		t.Fatal(err)
	}
	if !cfg.ProviderSelectionSetupIsComplete() {
		t.Fatalf("provider setup completion was not persisted: %+v", cfg)
	}
}

func TestProviderSetupCompletionRejectsExpiredExactCheck(t *testing.T) {
	now := time.Date(2026, 7, 31, 12, 0, 0, 0, time.UTC)
	server := newTestServer(t, runtimeconfig.Config{ProviderDisplay: &runtimeconfig.ProviderDisplayConfig{
		Mode:        providerDisplayModeAutomatic,
		ProviderIDs: []string{"codex", "claude"},
	}})
	server.now = func() time.Time { return now }
	server.providerPreferences.load = providerSettingsFixture
	if _, err := server.cachedProviderSettings(context.Background(), true); err != nil {
		t.Fatal(err)
	}
	server.recordExactProviderSetup("codex", 0, exactSetupFixture(now.Add(-providerReadinessFreshness-time.Second), "codex", codexbar.ProviderReady))
	server.recordExactProviderSetup("claude", 0, exactSetupFixture(now, "claude", codexbar.ProviderReady))

	recorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/v1/setup/providers/complete", nil))
	if recorder.Code != http.StatusConflict || !bytes.Contains(recorder.Body.Bytes(), []byte(`"provider_check_required"`)) {
		t.Fatalf("expired readiness passed setup: status=%d body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestProviderSetupCompletionRejectsCurrentHealthContradictingExactReady(t *testing.T) {
	now := time.Date(2026, 8, 4, 12, 0, 0, 0, time.UTC)
	server := newTestServer(t, runtimeconfig.Config{ProviderDisplay: &runtimeconfig.ProviderDisplayConfig{
		Mode:        providerDisplayModeFixed,
		ProviderIDs: []string{"codex"},
	}})
	server.now = func() time.Time { return now }
	server.providerPreferences.load = func(context.Context) ([]codexbar.ProviderSetting, error) {
		return []codexbar.ProviderSetting{{
			ID: "codex", Label: "Codex", Enabled: true, Health: codexbar.ProviderHealthAuthRequired,
		}}, nil
	}
	if _, err := server.cachedProviderSettings(context.Background(), true); err != nil {
		t.Fatal(err)
	}
	server.recordExactProviderSetup("codex", 0, exactSetupFixture(now, "codex", codexbar.ProviderReady))
	server.providerPreferences.mu.Lock()
	server.providerPreferences.cached[0].Health = codexbar.ProviderHealthAuthRequired
	server.providerPreferences.mu.Unlock()

	recorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/v1/setup/providers/complete", nil))
	if recorder.Code != http.StatusConflict || !bytes.Contains(recorder.Body.Bytes(), []byte(`"provider_check_required"`)) {
		t.Fatalf("contradicted readiness passed setup: status=%d body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestProviderSetupCompletionRejectsEnabledProviderOutsideDisplayPool(t *testing.T) {
	now := time.Date(2026, 7, 31, 12, 0, 0, 0, time.UTC)
	server := newTestServer(t, runtimeconfig.Config{ProviderDisplay: &runtimeconfig.ProviderDisplayConfig{
		Mode:        providerDisplayModeAutomatic,
		ProviderIDs: []string{"codex"},
	}})
	server.now = func() time.Time { return now }
	server.providerPreferences.load = providerSettingsFixture
	if _, err := server.cachedProviderSettings(context.Background(), true); err != nil {
		t.Fatal(err)
	}
	server.recordExactProviderSetup("codex", 0, exactSetupFixture(now, "codex", codexbar.ProviderReady))
	server.recordExactProviderSetup("claude", 0, exactSetupFixture(now, "claude", codexbar.ProviderReady))

	recorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/v1/setup/providers/complete", nil))
	if recorder.Code != http.StatusConflict || !bytes.Contains(recorder.Body.Bytes(), []byte(`"provider_display_incomplete"`)) {
		t.Fatalf("enabled provider outside display pool passed setup: status=%d body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestSelectedProviderCannotBeDisabled(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{ProviderDisplay: &runtimeconfig.ProviderDisplayConfig{
		Mode:        providerDisplayModeFixed,
		ProviderIDs: []string{"codex"},
	}})
	server.providerPreferences.load = providerSettingsFixture
	writes := 0
	server.providerPreferences.set = func(context.Context, string, bool) error {
		writes++
		return nil
	}

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPatch, "/v1/preferences/codexbar.providers.codex.enabled", bytes.NewBufferString(`{"value":false}`))
	server.Handler().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusConflict || !bytes.Contains(recorder.Body.Bytes(), []byte(`"provider_display_selected"`)) {
		t.Fatalf("expected selected-provider conflict, status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	if writes != 0 {
		t.Fatalf("selected provider reached CodexBar write: %d", writes)
	}
}

func TestExactProviderReadinessIsRedactedInPreferences(t *testing.T) {
	now := time.Date(2026, 7, 31, 12, 0, 0, 0, time.UTC)
	server := newTestServer(t, runtimeconfig.Config{})
	server.now = func() time.Time { return now }
	server.providerPreferences.load = providerSettingsFixture
	if _, err := server.cachedProviderSettings(context.Background(), true); err != nil {
		t.Fatal(err)
	}
	setup := exactSetupFixture(now, "codex", codexbar.ProviderAuthRequired)
	setup.Providers[0].Detail = "/Users/private/account.db secret-token-value"
	setup.Providers[0].NextAction = "Sign in as customer@example.com"
	server.recordExactProviderSetup("codex", 0, setup)

	recorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/v1/preferences?section=providers", nil))
	body := recorder.Body.String()
	if recorder.Code != http.StatusOK || bytes.Contains(recorder.Body.Bytes(), []byte("secret-token-value")) || bytes.Contains(recorder.Body.Bytes(), []byte("customer@example.com")) || bytes.Contains(recorder.Body.Bytes(), []byte("/Users/private")) {
		t.Fatalf("exact readiness leaked raw detail: status=%d body=%s", recorder.Code, body)
	}
}

func TestProviderDescriptorsDoNotShowStaleOrContradictedExactReadiness(t *testing.T) {
	now := time.Date(2026, 8, 3, 12, 0, 0, 0, time.UTC)
	server := newTestServer(t, runtimeconfig.Config{})
	server.now = func() time.Time { return now }
	server.providerReadinessMu.Lock()
	server.providerReadiness = make(map[string]providerReadinessRecord)
	server.providerReadiness["codex"] = providerReadinessRecord{
		Status:     codexbar.ProviderReady,
		CheckedAt:  now,
		VerifiedAt: now,
	}
	server.providerReadiness["claude"] = providerReadinessRecord{
		Status:    codexbar.ProviderAuthRequired,
		CheckedAt: now.Add(-providerReadinessFreshness - time.Second),
	}
	server.providerReadinessMu.Unlock()

	items := server.providerDescriptors([]codexbar.ProviderSetting{
		{ID: "codex", Label: "Codex", Enabled: true, Health: codexbar.ProviderHealthAuthRequired},
		{ID: "claude", Label: "Claude", Enabled: true, Health: codexbar.ProviderHealthHealthy},
	})
	if items[0].Health.State != "auth_required" || items[0].Health.VerifiedAt != "" {
		t.Fatalf("fresh current auth failure was hidden by old ready record: %+v", items[0].Health)
	}
	if items[1].Health.State != "healthy" || items[1].Health.CheckedAt != "" {
		t.Fatalf("expired exact failure overrode current provider health: %+v", items[1].Health)
	}
}

func TestFilterDisabledProvidersRecomputesTokenUsageReadiness(t *testing.T) {
	response := usageResponse{
		TokenUsageReady: true,
		CurrentProvider: "claude",
		Providers: []usageProviderInfo{
			{ID: "codex"},
			{ID: "claude", Cost: &usageCostInfo{}},
		},
	}

	got := filterDisabledProviders(response, []codexbar.ProviderSetting{
		{ID: "codex", Enabled: true},
		{ID: "claude", Enabled: false},
	})
	if got.TokenUsageReady || len(got.Providers) != 1 || got.Providers[0].ID != "codex" {
		t.Fatalf("disabled token provider left usage falsely ready: %+v", got)
	}
}

func TestLegacyConfiguredDeviceDoesNotRequireProviderOnboarding(t *testing.T) {
	progress := setupProgressForConfig(runtimeconfig.Config{DeviceID: "existing-device"})
	if progress.ProviderSelectionRequired || !progress.ProviderSelectionComplete {
		t.Fatalf("legacy configured device was forced through onboarding: %+v", progress)
	}
}

func providerSettingsFixture(context.Context) ([]codexbar.ProviderSetting, error) {
	return []codexbar.ProviderSetting{
		{ID: "codex", Label: "Codex", Enabled: true, Health: codexbar.ProviderHealthHealthy},
		{ID: "claude", Label: "Claude", Enabled: true, Health: codexbar.ProviderHealthHealthy},
		{ID: "cursor", Label: "Cursor", Enabled: false, Health: codexbar.ProviderHealthChecking},
	}, nil
}

func exactSetupFixture(now time.Time, providerID, status string) codexbar.ProviderSetup {
	return codexbar.ProviderSetup{
		Status:    status,
		CheckedAt: now.Format(time.RFC3339Nano),
		Providers: []codexbar.ProviderReadiness{{
			ID: providerID, Label: providerID, Enabled: providerEnabled(true), Status: status,
			Detail: "Safe provider status.", NextAction: "Check the provider, then try again.",
		}},
	}
}
