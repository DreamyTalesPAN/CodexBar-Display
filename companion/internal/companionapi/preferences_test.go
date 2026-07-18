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
	if len(response.Items) != 2 || response.Items[1].Health.State != "disabled" {
		t.Fatalf("expected enabled and disabled providers, got %#v", response.Items)
	}
	if response.Items[0].Health.State != "auth_required" || response.Items[0].Health.Service != "outage" {
		t.Fatalf("unexpected health: %#v", response.Items[0].Health)
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

func TestPreferencePatchWritesWithoutWaitingForHealthRefresh(t *testing.T) {
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
	server.loadUsage = func(time.Time) (daemon.PersistedUsage, bool) { return daemon.PersistedUsage{}, false }

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPatch, "/v1/preferences/codexbar.providers.claude.enabled", bytes.NewBufferString(`{"value":true}`))
	server.Handler().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("unexpected status %d: %s", recorder.Code, recorder.Body.String())
	}
	var response preferenceResponse
	_ = json.Unmarshal(recorder.Body.Bytes(), &response)
	if response.Item.Value != true || response.Item.Health.State != "checking" || loads != 1 {
		t.Fatalf("expected immediate enabled value after one load, got %#v loads=%d", response.Item, loads)
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
