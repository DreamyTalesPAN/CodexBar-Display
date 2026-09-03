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
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/daemon"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
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

func TestProviderSetupCompletionRequiresOneEnabledProviderFreshAndReady(t *testing.T) {
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
	// Nothing ready at all: VibeTV would have nothing real to put on screen.
	server.recordExactProviderSetup("codex", 0, exactSetupFixture(now, "codex", codexbar.ProviderAuthRequired))
	server.recordExactProviderSetup("claude", 0, exactSetupFixture(now, "claude", codexbar.ProviderAuthRequired))

	recorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/v1/setup/providers/complete", nil))
	if recorder.Code != http.StatusConflict || !bytes.Contains(recorder.Body.Bytes(), []byte(`"provider_check_required"`)) {
		t.Fatalf("expected no ready provider to block setup, status=%d body=%s", recorder.Code, recorder.Body.String())
	}

	// One is enough. The other is switched on and merely not signed in, which
	// the rotation skips on its own -- holding the customer on a step with no
	// Back and no Skip over it is the trap this rule removes.
	server.recordExactProviderSetup("codex", 0, exactSetupFixture(now, "codex", codexbar.ProviderReady))
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

func TestProviderSetupCompletionUsesTheSameHealthyDescriptorAsPreferences(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{ProviderDisplay: &runtimeconfig.ProviderDisplayConfig{
		Mode:        providerDisplayModeFixed,
		ProviderIDs: []string{"claude"},
	}})
	loads := 0
	server.providerPreferences.load = func(context.Context) ([]codexbar.ProviderSetting, error) {
		loads++
		return []codexbar.ProviderSetting{{
			ID: "claude", Label: "Claude", Enabled: true, Health: codexbar.ProviderHealthHealthy,
		}}, nil
	}
	server.loadUsage = func(time.Time) (daemon.PersistedUsage, bool) {
		return daemon.PersistedUsage{}, false
	}

	recorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/v1/preferences?section=providers", nil))
	if recorder.Code != http.StatusOK || loads != 1 {
		t.Fatalf("read provider screen: status=%d loads=%d body=%s", recorder.Code, loads, recorder.Body.String())
	}

	recorder = httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/v1/setup/providers/complete", nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("healthy provider descriptor did not complete setup: status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	if loads != 1 {
		t.Fatalf("Continue repeated the live provider scan: loads=%d", loads)
	}
}

func TestProviderSetupCompletionUsesCurrentHealthAfterExactCheckExpires(t *testing.T) {
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
	// The expired exact records no longer override CodexBar's current healthy
	// descriptors, which are the same answer the provider rows show.
	server.recordExactProviderSetup("codex", 0, exactSetupFixture(now.Add(-providerReadinessFreshness-time.Second), "codex", codexbar.ProviderReady))
	server.recordExactProviderSetup("claude", 0, exactSetupFixture(now.Add(-providerReadinessFreshness-time.Second), "claude", codexbar.ProviderReady))

	recorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/v1/setup/providers/complete", nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("current healthy descriptors did not pass setup: status=%d body=%s", recorder.Code, recorder.Body.String())
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

// docs/control-center-ui-principles.md rule 4: an existing healthy setup opens
// Overview without extra confirmation. A VibeTV set up before the display step
// existed has no selection stored and never had a step that could store one, so
// reporting the choice as still to be made put every one of those customers
// into the wizard on the update that adds it.
func TestLegacyInstallIsNotAskedForADisplayChoiceItNeverHad(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{
		DeviceTarget: "http://127.0.0.1:1",
		DeviceID:     "vibetv-1",
	})
	server.providerPreferences.load = providerSettingsFixture

	recorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/v1/provider-display", nil))
	var response providerDisplayResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if !response.Selection.Configured || !response.Selection.Valid {
		t.Fatalf("a completed legacy install was sent back for a display choice: %+v", response.Selection)
	}
	if len(response.Selection.ProviderIDs) == 0 {
		t.Fatalf("the synthesised pool is empty: %+v", response.Selection)
	}
}

// And a customer actually running setup still is: the flag is written the
// moment the provider step completes, so there is nothing legacy about them.
func TestAFreshSetupIsStillAskedForADisplayChoice(t *testing.T) {
	cfg := runtimeconfig.Config{DeviceTarget: "http://127.0.0.1:1", DeviceID: "vibetv-1"}
	cfg.SetProviderSelectionSetupComplete(true)
	server := newTestServer(t, cfg)
	server.providerPreferences.load = providerSettingsFixture

	recorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/v1/provider-display", nil))
	var response providerDisplayResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.Selection.Configured {
		t.Fatalf("the display step was skipped for a setup that is being run now: %+v", response.Selection)
	}
}

// "Always show one" names exactly one provider -- that is what the mode says on
// the screen, and Settings writes and keeps it with other providers still on.
// Measuring it against the enabled set refused the customer's own choice on the
// provider step, where the only action offered that is on that screen is
// turning the providers they had just chosen to keep back off.
func TestProviderSetupCompletionKeepsAFixedChoiceBesideOtherProviders(t *testing.T) {
	now := time.Date(2026, 7, 31, 12, 0, 0, 0, time.UTC)
	server := newTestServer(t, runtimeconfig.Config{ProviderDisplay: &runtimeconfig.ProviderDisplayConfig{
		Mode:        providerDisplayModeFixed,
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
	if recorder.Code != http.StatusOK {
		t.Fatalf("a fixed display choice was refused: status=%d body=%s", recorder.Code, recorder.Body.String())
	}
}

// Fixed mode pins without fallback (daemon.go applyProviderDisplaySelection,
// pinned by TestApplyProviderDisplaySelectionKeepsFixedProviderWithoutFallback).
// Counting any healthy provider therefore finished setup on the strength of one
// VibeTV had been told never to show, and carried the customer to the live step
// in front of a device that can draw nothing.
func TestProviderSetupCompletionRefusesAFixedChoiceThatCannotShowAnything(t *testing.T) {
	now := time.Date(2026, 9, 3, 12, 0, 0, 0, time.UTC)
	server := newTestServer(t, runtimeconfig.Config{ProviderDisplay: &runtimeconfig.ProviderDisplayConfig{
		Mode:        providerDisplayModeFixed,
		ProviderIDs: []string{"claude"},
	}})
	server.now = func() time.Time { return now }
	server.providerPreferences.load = func(context.Context) ([]codexbar.ProviderSetting, error) {
		return []codexbar.ProviderSetting{
			{ID: "codex", Label: "Codex", Enabled: true, Health: codexbar.ProviderHealthHealthy},
			{ID: "claude", Label: "Claude", Enabled: true, Health: codexbar.ProviderHealthAuthRequired},
		}, nil
	}
	if _, err := server.cachedProviderSettings(context.Background(), true); err != nil {
		t.Fatal(err)
	}

	recorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/v1/setup/providers/complete", nil))
	if recorder.Code != http.StatusConflict ||
		!bytes.Contains(recorder.Body.Bytes(), []byte(`"provider_display_not_ready"`)) {
		t.Fatalf("a working provider finished setup for a pinned broken one: status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	cfg, err := server.config()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.ProviderSelectionSetupIsComplete() {
		t.Fatal("a refused completion still recorded setup as complete")
	}
}

// The same broken provider must not be routed to the display step when nothing
// else could be shown instead: that step would have nothing to offer, and
// signing the provider back in is what the provider step is for.
func TestOnlyProviderBrokenStaysOnTheProviderStep(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{ProviderDisplay: &runtimeconfig.ProviderDisplayConfig{
		Mode:        providerDisplayModeFixed,
		ProviderIDs: []string{"claude"},
	}})
	server.providerPreferences.load = func(context.Context) ([]codexbar.ProviderSetting, error) {
		return []codexbar.ProviderSetting{
			{ID: "claude", Label: "Claude", Enabled: true, Health: codexbar.ProviderHealthAuthRequired},
		}, nil
	}
	if _, err := server.cachedProviderSettings(context.Background(), true); err != nil {
		t.Fatal(err)
	}

	recorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/v1/setup/providers/complete", nil))
	if recorder.Code != http.StatusConflict ||
		!bytes.Contains(recorder.Body.Bytes(), []byte(`"provider_check_required"`)) {
		t.Fatalf("a broken only provider was sent to the display step: status=%d body=%s", recorder.Code, recorder.Body.String())
	}
}

// Automatic rotates and skips what it cannot read, so a second provider that is
// merely signed out must still not trap the customer. The pool is every enabled
// provider by construction, so the shown set and the enabled set are equal and
// the fixed-mode refusal above can never fire here.
func TestAutomaticStillCompletesWithOneWorkingProvider(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{ProviderDisplay: &runtimeconfig.ProviderDisplayConfig{
		Mode:        providerDisplayModeAutomatic,
		ProviderIDs: []string{"codex", "claude"},
	}})
	server.providerPreferences.load = func(context.Context) ([]codexbar.ProviderSetting, error) {
		return []codexbar.ProviderSetting{
			{ID: "codex", Label: "Codex", Enabled: true, Health: codexbar.ProviderHealthHealthy},
			{ID: "claude", Label: "Claude", Enabled: true, Health: codexbar.ProviderHealthAuthRequired},
		}, nil
	}
	if _, err := server.cachedProviderSettings(context.Background(), true); err != nil {
		t.Fatal(err)
	}

	recorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/v1/setup/providers/complete", nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("a signed-out second provider refused an Automatic setup: status=%d body=%s", recorder.Code, recorder.Body.String())
	}
}

// Past the snapshot's maximum age the collector clears a reading -- usage
// unavailable, windows dropped -- so the device shows nothing for it. A row
// that still read "stale" was offered on the display step and accepted by the
// completion gate; pinned, it reached the live step in front of a blank VibeTV.
func TestAnExpiredReadingIsNotAStaleOne(t *testing.T) {
	now := time.Date(2026, 9, 3, 12, 0, 0, 0, time.UTC)
	server := newTestServer(t, runtimeconfig.Config{ProviderDisplay: &runtimeconfig.ProviderDisplayConfig{
		Mode:        providerDisplayModeFixed,
		ProviderIDs: []string{"codex"},
	}})
	server.now = func() time.Time { return now }
	server.providerPreferences.load = func(context.Context) ([]codexbar.ProviderSetting, error) {
		return []codexbar.ProviderSetting{
			{ID: "codex", Label: "Codex", Enabled: true, Health: codexbar.ProviderHealthUnavailable},
			{ID: "claude", Label: "Claude", Enabled: true, Health: codexbar.ProviderHealthHealthy},
		}, nil
	}
	server.loadUsage = func(time.Time) (daemon.PersistedUsage, bool) {
		return daemon.PersistedUsage{Providers: []daemon.ProviderUsageSnapshot{{
			Provider:    "codex",
			CollectedAt: now.Add(-time.Hour),
			Frame:       protocol.Frame{Provider: "codex", UsageUnavailable: true},
		}}}, true
	}
	if _, err := server.cachedProviderSettings(context.Background(), true); err != nil {
		t.Fatal(err)
	}

	for _, descriptor := range server.providerDescriptors(providerSettingsFixtureFrom(server)) {
		if descriptor.ProviderID == "codex" && descriptor.Health != nil && descriptor.Health.State == providerHealthStateStale {
			t.Fatalf("an expired reading was reported as a saved one: %+v", descriptor.Health)
		}
	}
	recorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/v1/setup/providers/complete", nil))
	if recorder.Code != http.StatusConflict ||
		!bytes.Contains(recorder.Body.Bytes(), []byte(`"provider_display_not_ready"`)) {
		t.Fatalf("a pin on an expired reading finished setup: status=%d body=%s", recorder.Code, recorder.Body.String())
	}
}

func providerSettingsFixtureFrom(server *Server) []codexbar.ProviderSetting {
	server.providerPreferences.mu.Lock()
	defer server.providerPreferences.mu.Unlock()
	return append([]codexbar.ProviderSetting(nil), server.providerPreferences.cached...)
}

// The switch on a provider row always works. Refusing the write was the one
// case where health decided whether a provider may be turned off at all, which
// is what docs/control-center-ui-principles.md rule 3 forbids: a provider that
// cannot be switched off is one that cannot be kept off the display. The
// display selection is validated in its own right, so a selection left naming
// the provider that was just turned off reports that itself.
func TestSelectedProviderCanBeDisabledAndTheDisplaySaysSo(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{ProviderDisplay: &runtimeconfig.ProviderDisplayConfig{
		Mode:        providerDisplayModeFixed,
		ProviderIDs: []string{"codex"},
	}})
	codexEnabled := true
	server.providerPreferences.load = func(context.Context) ([]codexbar.ProviderSetting, error) {
		return []codexbar.ProviderSetting{
			{ID: "codex", Label: "Codex", Enabled: codexEnabled, Health: codexbar.ProviderHealthHealthy},
			{ID: "claude", Label: "Claude", Enabled: true, Health: codexbar.ProviderHealthHealthy},
		}, nil
	}
	writes := 0
	server.providerPreferences.set = func(_ context.Context, providerID string, enabled bool) error {
		writes++
		if providerID == "codex" {
			codexEnabled = enabled
		}
		return nil
	}

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPatch, "/v1/preferences/codexbar.providers.codex.enabled", bytes.NewBufferString(`{"value":false}`))
	server.Handler().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("turning off a displayed provider was refused: status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	if writes != 1 {
		t.Fatalf("provider write did not reach CodexBar: %d", writes)
	}

	recorder = httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/v1/provider-display", nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("get provider display: status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	var response providerDisplayResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.Selection.Valid {
		t.Fatalf("a display naming a turned-off provider still reports valid: %+v", response.Selection)
	}

	recorder = httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/v1/setup/providers/complete", nil))
	if recorder.Code != http.StatusConflict {
		t.Fatalf("setup completed with a turned-off displayed provider: status=%d body=%s", recorder.Code, recorder.Body.String())
	}
}

// A Mac that has never written a display selection must not have every enabled
// provider locked on. The synthesised "everything enabled" pool is not a choice
// the customer made, and treating it as one made the switch inert on a fresh
// setup and, for an older companion that never writes one, permanently.
func TestProviderCanBeDisabledBeforeADisplayIsChosen(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	server.providerPreferences.load = providerSettingsFixture
	writes := 0
	server.providerPreferences.set = func(context.Context, string, bool) error {
		writes++
		return nil
	}

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPatch, "/v1/preferences/codexbar.providers.claude.enabled", bytes.NewBufferString(`{"value":false}`))
	server.Handler().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("provider could not be turned off before a display was chosen: status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	if writes != 1 {
		t.Fatalf("provider write did not reach CodexBar: %d", writes)
	}
}

func TestExactProviderReadinessUsesDetailWhenNothingWasReported(t *testing.T) {
	now := time.Date(2026, 7, 31, 12, 0, 0, 0, time.UTC)
	server := newTestServer(t, runtimeconfig.Config{})
	server.now = func() time.Time { return now }
	server.providerPreferences.load = providerSettingsFixture
	if _, err := server.cachedProviderSettings(context.Background(), true); err != nil {
		t.Fatal(err)
	}
	setup := exactSetupFixture(now, "codex", codexbar.ProviderAuthRequired)
	setup.Providers[0].Detail = "This provider needs an active sign-in."
	setup.Providers[0].NextAction = "Sign in as customer@example.com"
	server.recordExactProviderSetup("codex", 0, setup)

	recorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/v1/preferences?section=providers", nil))
	var response preferencesResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if recorder.Code != http.StatusOK || len(response.Items) != 3 || response.Items[0].Health.Reported != "" || response.Items[0].Health.Message != setup.Providers[0].Detail || bytes.Contains(recorder.Body.Bytes(), []byte("customer@example.com")) {
		t.Fatalf("exact readiness did not keep Detail as the generic fallback: status=%d body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestProviderDescriptorsDoNotShowStaleOrContradictedExactReadiness(t *testing.T) {
	now := time.Date(2026, 8, 3, 12, 0, 0, 0, time.UTC)
	server := newTestServer(t, runtimeconfig.Config{})
	server.now = func() time.Time { return now }
	server.providerReadinessMu.Lock()
	server.providerReadiness = make(map[string]providerReadinessRecord)
	server.providerReadiness["codex"] = providerReadinessRecord{
		Status:    codexbar.ProviderReady,
		CheckedAt: now,
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
	if items[0].Health.State != "auth_required" {
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

// Setting up again asks for the display choice again. Carrying the old
// selection over meant a provider switched on during the new run was not in
// it, and completion was refused with provider_display_incomplete on a step
// that offers no control to change the selection -- so the customer could
// neither finish setup nor get back out of it.
func TestSetupResetDropsTheDisplaySelectionItWillAskForAgain(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{
		DeviceTarget: "http://127.0.0.1:1",
		DeviceID:     "vibetv-1",
		ProviderDisplay: &runtimeconfig.ProviderDisplayConfig{
			Mode:        providerDisplayModeFixed,
			ProviderIDs: []string{"codex"},
		},
	})
	server.providerPreferences.load = providerSettingsFixture

	recorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/v1/setup/reset", nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("setup reset: status=%d body=%s", recorder.Code, recorder.Body.String())
	}

	cfg, err := server.config()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.ProviderDisplay != nil {
		t.Fatalf("the discarded setup's display selection survived: %+v", cfg.ProviderDisplay)
	}

	// And the wizard can finish again: every enabled provider is included by
	// the synthesised pool rather than measured against a stale one.
	recorder = httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/v1/provider-display", nil))
	var response providerDisplayResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.Selection.Configured || !response.Selection.Valid {
		t.Fatalf("unexpected selection after reset: %+v", response.Selection)
	}
}
