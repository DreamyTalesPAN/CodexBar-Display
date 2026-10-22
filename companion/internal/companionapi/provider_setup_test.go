package companionapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/daemon"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimeconfig"
)

// ProviderReadiness.Enabled is a tri-state: only CodexBar's own inventory
// answers it, so an omitted flag stays omitted.
func providerEnabled(value bool) *bool { return &value }

// A handler that gives up before one provider check can finish reports
// "The provider check timed out." for a provider that is working, and the
// Control Center request must in turn outlast the handler (60 s).
func TestProviderCheckTimeoutOutlastsOneProviderCheck(t *testing.T) {
	if providerCheckTimeout <= codexbar.ProviderCheckBudget {
		t.Fatalf("handler timeout %s must exceed one provider check %s", providerCheckTimeout, codexbar.ProviderCheckBudget)
	}
	if providerCheckTimeout >= 60*time.Second {
		t.Fatalf("handler timeout %s must stay below the Control Center's 60 s provider check request", providerCheckTimeout)
	}
}

func TestStatusIncludesProviderSetup(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	server.probeProviderSetup = func(context.Context, string) codexbar.ProviderSetup {
		return setupFixture(codexbar.ProviderAuthRequired)
	}
	server.currentProviderSetup(context.Background(), false)
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/v1/status", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	var got statusResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.ProviderSetup.Status != "setup_required" || got.ProviderSetup.Providers[0].Status != codexbar.ProviderAuthRequired {
		t.Fatalf("unexpected provider setup: %+v", got.ProviderSetup)
	}
}

func TestProviderSetupReconcilesFreshCollectorUsageAcrossStatusUsageAndDiagnostics(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	now := time.Date(2026, 7, 28, 12, 0, 0, 0, time.UTC)
	server.now = func() time.Time { return now }
	server.probeProviderSetup = func(context.Context, string) codexbar.ProviderSetup {
		return codexbar.ProviderSetup{
			Status:    "setup_required",
			CheckedAt: now.Add(-time.Minute).Format(time.RFC3339Nano),
			Engine:    codexbar.EngineReadiness{Status: codexbar.ProviderReady, Version: "0.63.0"},
			Providers: []codexbar.ProviderReadiness{{
				ID: "codexbar", Label: "Usage service", Enabled: providerEnabled(true), Status: codexbar.ProviderEngineError,
				Detail: "The usage service could not read this provider.",
			}},
		}
	}
	server.loadUsage = func(time.Time) (daemon.PersistedUsage, bool) {
		return daemon.PersistedUsage{}, false
	}
	server.currentProviderSetup(context.Background(), true)
	server.loadUsage = func(time.Time) (daemon.PersistedUsage, bool) {
		return freshProviderUsage("codex", "Codex", now), true
	}

	statusRec := httptest.NewRecorder()
	server.Handler().ServeHTTP(statusRec, httptest.NewRequest(http.MethodGet, "/v1/status", nil))
	if statusRec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", statusRec.Code, statusRec.Body.String())
	}
	var status statusResponse
	if err := json.Unmarshal(statusRec.Body.Bytes(), &status); err != nil {
		t.Fatal(err)
	}
	assertReadyProviderSetup(t, status.ProviderSetup, "codex")
	if providerByID(status.ProviderSetup.Providers, "codexbar") != nil {
		t.Fatalf("fresh provider usage must clear stale global codexbar error: %+v", status.ProviderSetup)
	}

	usageRec := httptest.NewRecorder()
	server.Handler().ServeHTTP(usageRec, httptest.NewRequest(http.MethodGet, "/v1/usage", nil))
	if usageRec.Code != http.StatusOK {
		t.Fatalf("usage=%d body=%s", usageRec.Code, usageRec.Body.String())
	}
	var usage usageResponse
	if err := json.Unmarshal(usageRec.Body.Bytes(), &usage); err != nil {
		t.Fatal(err)
	}
	if len(usage.Providers) != 1 || usage.Providers[0].ID != "codex" || usage.Providers[0].UsageUnavailable || usage.Providers[0].Stale {
		t.Fatalf("usage endpoint disagrees with reconciled provider setup: %+v", usage)
	}

	diagnosticsRec := httptest.NewRecorder()
	server.Handler().ServeHTTP(diagnosticsRec, httptest.NewRequest(http.MethodGet, "/v1/diagnostics", nil))
	if diagnosticsRec.Code != http.StatusOK {
		t.Fatalf("diagnostics=%d body=%s", diagnosticsRec.Code, diagnosticsRec.Body.String())
	}
	var diagnostics diagnosticsResponse
	if err := json.Unmarshal(diagnosticsRec.Body.Bytes(), &diagnostics); err != nil {
		t.Fatal(err)
	}
	assertReadyProviderSetup(t, diagnostics.ProviderSetup, "codex")
	if check := diagnosticCheckByName(diagnostics.Checks, "provider_setup"); check == nil || check.Status != "pass" {
		t.Fatalf("diagnostics did not agree with fresh provider usage: %+v", diagnostics.Checks)
	}
}

func TestProviderSetupRecoversFromCachedEngineErrorAfterLaterCollectorSuccess(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	now := time.Date(2026, 7, 28, 12, 30, 0, 0, time.UTC)
	server.now = func() time.Time { return now }
	var probes atomic.Int32
	server.probeProviderSetup = func(context.Context, string) codexbar.ProviderSetup {
		probes.Add(1)
		return codexbar.ProviderSetup{
			Status: "setup_required",
			Engine: codexbar.EngineReadiness{Status: codexbar.ProviderReady},
			Providers: []codexbar.ProviderReadiness{{
				ID: "codexbar", Label: "Usage service", Enabled: providerEnabled(true), Status: codexbar.ProviderEngineError,
			}},
		}
	}
	server.loadUsage = func(time.Time) (daemon.PersistedUsage, bool) {
		return daemon.PersistedUsage{}, false
	}
	server.currentProviderSetup(context.Background(), true)

	before := httptest.NewRecorder()
	server.Handler().ServeHTTP(before, httptest.NewRequest(http.MethodGet, "/v1/status", nil))
	var beforeStatus statusResponse
	if err := json.Unmarshal(before.Body.Bytes(), &beforeStatus); err != nil {
		t.Fatal(err)
	}
	if beforeStatus.ProviderSetup.Status == codexbar.ProviderReady {
		t.Fatalf("engine error became ready without collector evidence: %+v", beforeStatus.ProviderSetup)
	}

	server.loadUsage = func(time.Time) (daemon.PersistedUsage, bool) {
		return freshProviderUsage("codex", "Codex", now.Add(10*time.Second)), true
	}
	after := httptest.NewRecorder()
	server.Handler().ServeHTTP(after, httptest.NewRequest(http.MethodGet, "/v1/status", nil))
	var afterStatus statusResponse
	if err := json.Unmarshal(after.Body.Bytes(), &afterStatus); err != nil {
		t.Fatal(err)
	}
	assertReadyProviderSetup(t, afterStatus.ProviderSetup, "codex")
	if probes.Load() != 1 {
		t.Fatalf("later collector success should clear cached setup state without another probe, probes=%d", probes.Load())
	}
}

func TestProviderSetupDoesNotPromoteGloballyWithHealthyAndFailingProviders(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	now := time.Date(2026, 7, 28, 13, 0, 0, 0, time.UTC)
	server.now = func() time.Time { return now }
	server.probeProviderSetup = func(context.Context, string) codexbar.ProviderSetup {
		return codexbar.ProviderSetup{
			Status: "setup_required",
			Engine: codexbar.EngineReadiness{Status: codexbar.ProviderEngineError},
			Providers: []codexbar.ProviderReadiness{{
				ID: "claude", Label: "Claude", Enabled: providerEnabled(true), Status: codexbar.ProviderAuthRequired,
				Detail: "This provider needs an active sign-in.",
			}},
		}
	}
	server.loadUsage = func(time.Time) (daemon.PersistedUsage, bool) {
		return daemon.PersistedUsage{}, false
	}
	server.currentProviderSetup(context.Background(), true)
	server.loadUsage = func(time.Time) (daemon.PersistedUsage, bool) {
		usage := freshProviderUsage("codex", "Codex", now)
		oldClaudeUsage := freshProviderUsage("claude", "Claude", now.Add(-time.Minute))
		usage.Providers = append(usage.Providers, oldClaudeUsage.Providers...)
		return usage, true
	}

	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/v1/status", nil))
	var got statusResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.ProviderSetup.Status == codexbar.ProviderReady || got.ProviderSetup.Engine.Status == codexbar.ProviderReady {
		t.Fatalf("a protected provider failure must block global ready promotion: %+v", got.ProviderSetup)
	}
	codex := providerByID(got.ProviderSetup.Providers, "codex")
	if codex == nil || codex.Status != codexbar.ProviderReady {
		t.Fatalf("healthy provider was not reconciled: %+v", got.ProviderSetup)
	}
	claude := providerByID(got.ProviderSetup.Providers, "claude")
	if claude == nil || claude.Status != codexbar.ProviderAuthRequired {
		t.Fatalf("failing provider was hidden or changed: %+v", got.ProviderSetup)
	}
}

func TestProviderSetupPreservesDisabledProviderOverCachedUsage(t *testing.T) {
	now := time.Date(2026, 8, 25, 12, 0, 0, 0, time.UTC)
	setup := codexbar.ProviderSetup{
		Status: "setup_required",
		Engine: codexbar.EngineReadiness{Status: codexbar.ProviderReady},
		Providers: []codexbar.ProviderReadiness{
			{ID: "claude", Label: "Claude", Enabled: providerEnabled(false), Status: codexbar.ProviderNotConfigured},
			{ID: "codex", Label: "Codex", Enabled: providerEnabled(true), Status: codexbar.ProviderReady},
		},
	}
	ready := []codexbar.ProviderReadiness{
		{ID: "claude", Label: "Claude", Status: codexbar.ProviderReady},
		{ID: "codex", Label: "Codex", Status: codexbar.ProviderReady},
	}

	got := reconcileProviderSetupWithUsage(setup, ready, now)
	if got.Status != codexbar.ProviderReady {
		t.Fatalf("an enabled ready provider should make setup ready: %+v", got)
	}
	claude := providerByID(got.Providers, "claude")
	if claude == nil || claude.Enabled == nil || *claude.Enabled || claude.Status != codexbar.ProviderNotConfigured {
		t.Fatalf("cached usage replaced the authoritative disabled state: %+v", got)
	}
	codex := providerByID(got.Providers, "codex")
	if codex == nil || codex.Status != codexbar.ProviderReady {
		t.Fatalf("enabled ready provider was not reconciled: %+v", got)
	}
}

func TestCheckingProviderSetupNeverReusesCachedUsage(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	now := time.Date(2026, 8, 25, 19, 18, 45, 0, time.UTC)
	server.now = func() time.Time { return now }
	server.loadUsage = func(time.Time) (daemon.PersistedUsage, bool) {
		return freshProviderUsage("codex", "Codex", now), true
	}

	for _, setup := range []codexbar.ProviderSetup{
		{Status: "checking"},
		{
			Status: "checking",
			Engine: codexbar.EngineReadiness{
				Status:     codexbar.ProviderReady,
				ConfigPath: filepath.Join(t.TempDir(), "config.json"),
			},
		},
	} {
		got := server.providerSetupWithFreshUsage(setup, now)
		if got.Status != "checking" || len(got.Providers) != 0 {
			t.Fatalf("checking provider setup consumed cached readiness: %+v", got)
		}
	}
}

func TestProviderSetupPreservesCurrentEngineErrorOverCachedUsage(t *testing.T) {
	now := time.Date(2026, 7, 28, 13, 30, 0, 0, time.UTC)
	setup := codexbar.ProviderSetup{
		Status: "setup_required",
		Engine: codexbar.EngineReadiness{Status: codexbar.ProviderEngineError},
		Providers: []codexbar.ProviderReadiness{{
			ID: "codexbar", Label: "Usage service", Enabled: providerEnabled(true), Status: codexbar.ProviderEngineError,
		}},
	}
	ready := []codexbar.ProviderReadiness{{
		ID: "codex", Label: "Codex", Enabled: providerEnabled(true), Status: codexbar.ProviderReady,
	}}

	for _, reconcile := range []struct {
		name string
		fn   func(codexbar.ProviderSetup, []codexbar.ProviderReadiness, time.Time) codexbar.ProviderSetup
	}{
		{name: "quota", fn: reconcileProviderSetupWithUsage},
		{name: "tokens", fn: reconcileProviderSetupWithTokenEvidence},
	} {
		t.Run(reconcile.name, func(t *testing.T) {
			got := reconcile.fn(setup, ready, now)
			if got.Status == codexbar.ProviderReady || got.Engine.Status != codexbar.ProviderEngineError {
				t.Fatalf("cached usage hid the current engine error: %+v", got)
			}
			if providerByID(got.Providers, "codexbar") == nil {
				t.Fatalf("cached usage removed the current engine error: %+v", got)
			}
		})
	}
}

func TestProviderSetupDoesNotReconcileFromStaleOrUnavailableUsage(t *testing.T) {
	for _, tc := range []struct {
		name     string
		mutator  func(*daemon.PersistedUsage)
		wantDesc string
	}{
		{
			name: "stale",
			mutator: func(usage *daemon.PersistedUsage) {
				usage.Providers[0].Stale = true
			},
			wantDesc: "stale",
		},
		{
			name: "unavailable",
			mutator: func(usage *daemon.PersistedUsage) {
				usage.Providers[0].Frame.UsageUnavailable = true
			},
			wantDesc: "unavailable",
		},
		{
			name: "no usable windows",
			mutator: func(usage *daemon.PersistedUsage) {
				usage.Providers[0].Frame.Session = 0
				usage.Providers[0].Frame.Weekly = 0
				usage.Providers[0].Meta = codexbar.ProviderUsageMeta{}
			},
			wantDesc: "no usable windows",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := newTestServer(t, runtimeconfig.Config{})
			now := time.Date(2026, 7, 28, 14, 0, 0, 0, time.UTC)
			server.now = func() time.Time { return now }
			server.probeProviderSetup = func(context.Context, string) codexbar.ProviderSetup {
				return codexbar.ProviderSetup{
					Status: "setup_required",
					Engine: codexbar.EngineReadiness{Status: codexbar.ProviderReady},
					Providers: []codexbar.ProviderReadiness{{
						ID: "codexbar", Label: "Usage service", Enabled: providerEnabled(true), Status: codexbar.ProviderEngineError,
					}},
				}
			}
			server.loadUsage = func(time.Time) (daemon.PersistedUsage, bool) {
				return daemon.PersistedUsage{}, false
			}
			server.currentProviderSetup(context.Background(), true)
			server.loadUsage = func(time.Time) (daemon.PersistedUsage, bool) {
				usage := freshProviderUsage("codex", "Codex", now)
				tc.mutator(&usage)
				return usage, true
			}

			rec := httptest.NewRecorder()
			server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/v1/status", nil))
			var got statusResponse
			if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
				t.Fatal(err)
			}
			if got.ProviderSetup.Status == codexbar.ProviderReady {
				t.Fatalf("%s usage fabricated ready provider setup: %+v", tc.wantDesc, got.ProviderSetup)
			}
		})
	}
}

func TestProviderSetupUsesFreshTokenEvidenceWithoutClaimingQuotaReady(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	now := time.Date(2026, 7, 29, 12, 15, 0, 0, time.UTC)
	server.now = func() time.Time { return now }
	server.probeProviderSetup = func(context.Context, string) codexbar.ProviderSetup {
		return codexbar.ProviderSetup{
			Status: "setup_required",
			Engine: codexbar.EngineReadiness{Status: codexbar.ProviderReady},
			Providers: []codexbar.ProviderReadiness{{
				ID: "codexbar", Label: "Usage service", Enabled: providerEnabled(true), Status: codexbar.ProviderEngineError,
				Detail: "The usage service could not read this provider.",
			}},
		}
	}
	server.loadUsage = func(time.Time) (daemon.PersistedUsage, bool) {
		return daemon.PersistedUsage{}, false
	}
	server.currentProviderSetup(context.Background(), true)
	server.loadUsage = func(time.Time) (daemon.PersistedUsage, bool) {
		return tokenRichQuotaUnavailableUsage("codex", "Codex", now), true
	}

	statusRec := httptest.NewRecorder()
	server.Handler().ServeHTTP(statusRec, httptest.NewRequest(http.MethodGet, "/v1/status", nil))
	var status statusResponse
	if err := json.Unmarshal(statusRec.Body.Bytes(), &status); err != nil {
		t.Fatal(err)
	}
	assertReadyProviderSetup(t, status.ProviderSetup, "codex")
	if providerByID(status.ProviderSetup.Providers, "codexbar") != nil {
		t.Fatalf("token evidence must clear generic codexbar setup failure: %+v", status.ProviderSetup)
	}
	if got := providerByID(status.ProviderSetup.Providers, "codex"); got == nil ||
		!strings.Contains(got.Detail, "usage limits are temporarily unavailable") {
		t.Fatalf("token readiness did not keep quota limitation visible: %+v", status.ProviderSetup)
	}

	usageRec := httptest.NewRecorder()
	server.Handler().ServeHTTP(usageRec, httptest.NewRequest(http.MethodGet, "/v1/usage", nil))
	var usage usageResponse
	if err := json.Unmarshal(usageRec.Body.Bytes(), &usage); err != nil {
		t.Fatal(err)
	}
	if len(usage.Providers) != 1 || !usage.TokenUsageReady || !usage.Providers[0].UsageUnavailable || !usage.Providers[0].Stale {
		t.Fatalf("token evidence fabricated quota readiness: %+v", usage)
	}
}

func TestProviderSetupTokenEvidencePreservesSpecificProviderFailures(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	now := time.Date(2026, 7, 29, 12, 20, 0, 0, time.UTC)
	server.now = func() time.Time { return now }
	server.probeProviderSetup = func(context.Context, string) codexbar.ProviderSetup {
		return codexbar.ProviderSetup{
			Status: "setup_required",
			Engine: codexbar.EngineReadiness{Status: codexbar.ProviderReady},
			Providers: []codexbar.ProviderReadiness{{
				ID: "codex", Label: "Codex", Enabled: providerEnabled(true), Status: codexbar.ProviderAuthRequired,
				Detail: "This provider needs an active sign-in.",
			}},
		}
	}
	server.loadUsage = func(time.Time) (daemon.PersistedUsage, bool) {
		return tokenRichQuotaUnavailableUsage("codex", "Codex", now), true
	}
	server.currentProviderSetup(context.Background(), true)

	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/v1/status", nil))
	var got statusResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	codex := providerByID(got.ProviderSetup.Providers, "codex")
	if got.ProviderSetup.Status == codexbar.ProviderReady || codex == nil || codex.Status != codexbar.ProviderAuthRequired {
		t.Fatalf("token evidence overwrote a specific provider failure: %+v", got.ProviderSetup)
	}
}

func TestProviderSetupUsagePreservesSpecificProviderFailures(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	now := time.Date(2026, 7, 29, 12, 22, 0, 0, time.UTC)
	server.now = func() time.Time { return now }
	server.probeProviderSetup = func(context.Context, string) codexbar.ProviderSetup {
		return codexbar.ProviderSetup{
			Status: "setup_required",
			Engine: codexbar.EngineReadiness{Status: codexbar.ProviderReady},
			Providers: []codexbar.ProviderReadiness{{
				ID: "codex", Label: "Codex", Enabled: providerEnabled(true), Status: codexbar.ProviderAuthRequired,
				Detail: "This provider needs an active sign-in.",
			}},
		}
	}
	server.loadUsage = func(time.Time) (daemon.PersistedUsage, bool) {
		return freshProviderUsage("codex", "Codex", now), true
	}
	server.currentProviderSetup(context.Background(), true)

	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/v1/status", nil))
	var got statusResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	codex := providerByID(got.ProviderSetup.Providers, "codex")
	if got.ProviderSetup.Status == codexbar.ProviderReady || codex == nil || codex.Status != codexbar.ProviderAuthRequired {
		t.Fatalf("usage overwrote a specific provider failure: %+v", got.ProviderSetup)
	}
}

func TestProviderSetupTokenEvidenceKeepsOneHealthyOneFailingIsolated(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	now := time.Date(2026, 7, 29, 12, 25, 0, 0, time.UTC)
	server.now = func() time.Time { return now }
	server.probeProviderSetup = func(context.Context, string) codexbar.ProviderSetup {
		return codexbar.ProviderSetup{
			Status: "setup_required",
			Engine: codexbar.EngineReadiness{Status: codexbar.ProviderReady},
			Providers: []codexbar.ProviderReadiness{{
				ID: "claude", Label: "Claude", Enabled: providerEnabled(true), Status: codexbar.ProviderAuthRequired,
				Detail: "This provider needs an active sign-in.",
			}},
		}
	}
	server.loadUsage = func(time.Time) (daemon.PersistedUsage, bool) {
		return tokenRichQuotaUnavailableUsage("codex", "Codex", now), true
	}
	server.currentProviderSetup(context.Background(), true)

	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/v1/status", nil))
	var got statusResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	assertReadyProviderSetup(t, got.ProviderSetup, "codex")
	claude := providerByID(got.ProviderSetup.Providers, "claude")
	if claude == nil || claude.Status != codexbar.ProviderAuthRequired {
		t.Fatalf("failing provider was hidden or changed: %+v", got.ProviderSetup)
	}
}

func TestStatusDoesNotWaitForColdProviderSetupProbe(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	started := make(chan struct{})
	release := make(chan struct{})
	server.probeProviderSetup = func(context.Context, string) codexbar.ProviderSetup {
		close(started)
		<-release
		return setupFixture(codexbar.ProviderReady)
	}

	begin := time.Now()
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/v1/status", nil))
	if elapsed := time.Since(begin); elapsed > 250*time.Millisecond {
		t.Fatalf("status waited for provider probe: %s", elapsed)
	}
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"status":"checking"`) {
		t.Fatalf("unexpected cold status response: %d %s", rec.Code, rec.Body.String())
	}

	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("background provider probe did not start")
	}
	close(release)

	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		rec = httptest.NewRecorder()
		server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/v1/status", nil))
		if strings.Contains(rec.Body.String(), `"status":"ready"`) {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("completed provider probe was not cached: %s", rec.Body.String())
}

func TestProviderRetryIsSingleFlightAndWakesStreamOnceReady(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	var probes atomic.Int32
	var wakes atomic.Int32
	started := make(chan struct{})
	release := make(chan struct{})
	server.probeProviderSetup = func(context.Context, string) codexbar.ProviderSetup {
		if probes.Add(1) == 1 {
			close(started)
			<-release
		}
		return setupFixture(codexbar.ProviderReady)
	}
	server.wakeDisplayStream = func() { wakes.Add(1) }

	var wg sync.WaitGroup
	results := make(chan *httptest.ResponseRecorder, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			rec := httptest.NewRecorder()
			server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/v1/providers/retry", nil))
			results <- rec
		}()
	}
	<-started
	close(release)
	wg.Wait()
	close(results)
	for rec := range results {
		if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"status":"ready"`) {
			t.Fatalf("unexpected retry response: %d %s", rec.Code, rec.Body.String())
		}
	}
	if probes.Load() != 1 {
		t.Fatalf("expected one provider probe, got %d", probes.Load())
	}
	if wakes.Load() != 2 {
		t.Fatalf("each successful request should wake the idempotent stream, got %d", wakes.Load())
	}
}

func TestProviderRetryDoesNotWakeStreamUntilReady(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	server.probeProviderSetup = func(context.Context, string) codexbar.ProviderSetup {
		return setupFixture(codexbar.ProviderAuthRequired)
	}
	woke := false
	server.wakeDisplayStream = func() { woke = true }
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/v1/providers/retry", nil))
	if rec.Code != http.StatusOK || woke {
		t.Fatalf("unexpected not-ready retry: status=%d woke=%t body=%s", rec.Code, woke, rec.Body.String())
	}
}

func TestProviderRetryCanTargetExactProvider(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	var gotProvider string
	server.probeExactProvider = func(_ context.Context, _ string, providerID string) codexbar.ProviderSetup {
		gotProvider = providerID
		return codexbar.ProviderSetup{
			Status: "setup_required",
			Providers: []codexbar.ProviderReadiness{{
				ID: "future-provider", Label: "Future Provider", Enabled: providerEnabled(true), Status: codexbar.ProviderAuthRequired,
			}},
		}
	}
	woke := false
	server.wakeDisplayStream = func() { woke = true }

	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(
		rec,
		httptest.NewRequest(http.MethodPost, "/v1/providers/retry?provider=future-provider", nil),
	)
	if rec.Code != http.StatusOK || gotProvider != "future-provider" || woke {
		t.Fatalf("unexpected exact retry: status=%d provider=%q woke=%t body=%s", rec.Code, gotProvider, woke, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"id":"future-provider"`) ||
		!strings.Contains(rec.Body.String(), `"status":"auth_required"`) {
		t.Fatalf("exact provider identity/readiness missing: %s", rec.Body.String())
	}
}

// After the Mac app read a browser sign-in, CodexBar's config is unchanged,
// so the usual restart would keep the usage service that still holds the
// failed reading. A working check after such a read replaces it; a plain
// check, or one that still fails, does not (#607).
func TestProviderRetryAfterBrowserSignInReadReplacesUsageService(t *testing.T) {
	for _, tc := range []struct {
		name         string
		target       string
		status       string
		wantRestarts int32
		wantReplaces int32
	}{
		{"read works", "/v1/providers/retry?provider=claude&after=browser-sign-in-read", codexbar.ProviderReady, 0, 1},
		{"plain check", "/v1/providers/retry?provider=claude", codexbar.ProviderReady, 1, 0},
		{"read refused", "/v1/providers/retry?provider=claude&after=browser-sign-in-read", codexbar.ProviderAuthRequired, 0, 0},
		{"service already delivered", "/v1/providers/retry?provider=claude&after=browser-sign-in-read", codexbar.ProviderReady, 0, 0},
		{"reading from before the read", "/v1/providers/retry?provider=claude&after=browser-sign-in-read", codexbar.ProviderReady, 0, 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := newTestServer(t, runtimeconfig.Config{})
			server.probeExactProvider = func(_ context.Context, _ string, providerID string) codexbar.ProviderSetup {
				status := "setup_required"
				if tc.status == codexbar.ProviderReady {
					status = codexbar.ProviderReady
				}
				return codexbar.ProviderSetup{
					Status: status,
					Engine: codexbar.EngineReadiness{Status: codexbar.ProviderReady},
					Providers: []codexbar.ProviderReadiness{{
						ID: providerID, Label: "Claude", Enabled: providerEnabled(true), Status: tc.status,
					}},
				}
			}
			switch tc.name {
			case "service already delivered":
				server.loadUsage = func(time.Time) (daemon.PersistedUsage, bool) {
					return freshProviderUsage("claude", "Claude", server.currentTime().Add(time.Second)), true
				}
			case "reading from before the read":
				// Still fresh, but collected before the read: no proof the
				// running service saw the new sign-in (Codex review on #607).
				server.loadUsage = func(time.Time) (daemon.PersistedUsage, bool) {
					return freshProviderUsage("claude", "Claude", server.currentTime().Add(-30*time.Second)), true
				}
			}
			var restarts, replaces atomic.Int32
			server.restartUsageService = func(context.Context) error { restarts.Add(1); return nil }
			server.freshUsageService = func(context.Context) error { replaces.Add(1); return nil }
			woke := make(chan struct{}, 1)
			server.wakeDisplayStream = func() { woke <- struct{}{} }

			rec := httptest.NewRecorder()
			server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodPost, tc.target, nil))
			if rec.Code != http.StatusOK {
				t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
			}
			if tc.wantRestarts+tc.wantReplaces > 0 {
				select {
				case <-woke:
				case <-time.After(5 * time.Second):
					t.Fatal("the usage service swap never finished")
				}
			}
			if restarts.Load() != tc.wantRestarts || replaces.Load() != tc.wantReplaces {
				t.Fatalf("restarts=%d replaces=%d, want %d and %d", restarts.Load(), replaces.Load(), tc.wantRestarts, tc.wantReplaces)
			}
		})
	}
}

// A probe that was already running when CodexBar read the browser sign-in
// answers for the state before the read. The check the Mac app asks for after
// the read must not take that answer: it waits the old probe out and probes
// again, so a working read still replaces the usage service (#607 Codex review).
func TestProviderRetryAfterBrowserSignInReadDoesNotJoinAnOlderProbe(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	base := time.Date(2026, 10, 14, 16, 0, 0, 0, time.UTC)
	var tick atomic.Int64
	server.now = func() time.Time { return base.Add(time.Duration(tick.Add(1)) * time.Millisecond) }
	var probes atomic.Int32
	started := make(chan struct{})
	release := make(chan struct{})
	server.probeExactProvider = func(_ context.Context, _ string, providerID string) codexbar.ProviderSetup {
		status := codexbar.ProviderReady
		setupStatus := codexbar.ProviderReady
		if probes.Add(1) == 1 {
			close(started)
			<-release
			status = codexbar.ProviderBrowserSignInRequired
			setupStatus = "setup_required"
		}
		return codexbar.ProviderSetup{
			Status: setupStatus,
			Engine: codexbar.EngineReadiness{Status: codexbar.ProviderReady},
			Providers: []codexbar.ProviderReadiness{{
				ID: providerID, Label: "Claude", Enabled: providerEnabled(true), Status: status,
			}},
		}
	}
	var replaces atomic.Int32
	server.restartUsageService = func(context.Context) error { return nil }
	server.freshUsageService = func(context.Context) error { replaces.Add(1); return nil }
	woke := make(chan struct{}, 4)
	server.wakeDisplayStream = func() { woke <- struct{}{} }

	go server.Handler().ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodPost, "/v1/providers/retry?provider=claude", nil))
	<-started
	result := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		rec := httptest.NewRecorder()
		server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/v1/providers/retry?provider=claude&after=browser-sign-in-read", nil))
		result <- rec
	}()
	time.Sleep(50 * time.Millisecond)
	close(release)
	var rec *httptest.ResponseRecorder
	select {
	case rec = <-result:
	case <-time.After(5 * time.Second):
		t.Fatal("the post-read check never answered")
	}
	var got providerSetupResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if provider := providerByID(got.ProviderSetup.Providers, "claude"); provider == nil || provider.Status != codexbar.ProviderReady {
		t.Fatalf("the post-read check took the older probe's answer: %+v", got.ProviderSetup)
	}
	if probes.Load() != 2 {
		t.Fatalf("expected a second probe after the read, got %d", probes.Load())
	}
	select {
	case <-woke:
	case <-time.After(5 * time.Second):
		t.Fatal("the usage service swap never finished")
	}
	if replaces.Load() != 1 {
		t.Fatalf("a working read must replace the usage service once, got %d", replaces.Load())
	}
}

// A Mac Claude check through Claude Code took 55 s, longer than the Control
// Center waits for its request (#786). The request answers that the provider
// is still checking, the row shows that instead of the last failure, and the
// check runs on after the request ended until its result lands on the row.
func TestExactProviderRetryOutlastingTheRequestFinishesInTheBackground(t *testing.T) {
	previousWait := exactProviderRetryWait
	exactProviderRetryWait = 20 * time.Millisecond
	t.Cleanup(func() { exactProviderRetryWait = previousWait })
	server := newTestServer(t, runtimeconfig.Config{})
	server.providerPreferences.load = func(context.Context) ([]codexbar.ProviderSetting, error) {
		return []codexbar.ProviderSetting{{ID: "claude", Label: "Claude", Enabled: true, Health: codexbar.ProviderHealthUnavailable}}, nil
	}
	server.loadUsage = func(time.Time) (daemon.PersistedUsage, bool) { return daemon.PersistedUsage{}, false }
	claudeState := func() string {
		t.Helper()
		rec := httptest.NewRecorder()
		server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/v1/preferences?section=providers", nil))
		var response preferencesResponse
		if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil || len(response.Items) != 1 {
			t.Fatalf("unexpected preferences: %v %s", err, rec.Body.String())
		}
		return response.Items[0].Health.State
	}
	claudeState()
	server.recordExactProviderSetup("claude", 0, exactSetupFixture(server.currentTime(), "claude", codexbar.ProviderTimeout))
	if state := claudeState(); state == "checking" {
		t.Fatalf("the earlier timeout must show before the retry, got %q", state)
	}
	release := make(chan struct{})
	probeErr := make(chan error, 1)
	server.probeExactProvider = func(ctx context.Context, _ string, providerID string) codexbar.ProviderSetup {
		<-release
		probeErr <- ctx.Err()
		return exactSetupFixture(server.currentTime(), providerID, codexbar.ProviderReady)
	}

	requestCtx, endRequest := context.WithCancel(context.Background())
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/v1/providers/retry?provider=claude", nil).WithContext(requestCtx))
	endRequest()
	var got providerSetupResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if rec.Code != http.StatusOK || got.ProviderSetup.Status != "checking" {
		t.Fatalf("a check that outlasts the wait must answer checking: %d %s", rec.Code, rec.Body.String())
	}
	if state := claudeState(); state != "checking" {
		t.Fatalf("the row must show the running check, got %q", state)
	}

	close(release)
	select {
	case err := <-probeErr:
		if err != nil {
			t.Fatalf("the check ended with its request: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the check never finished")
	}
	waitForCachedProviderHealth(t, server, "claude", codexbar.ProviderHealthHealthy)
	if state := claudeState(); state != "healthy" {
		t.Fatalf("the finished check must land on the row, got %q", state)
	}
}

// An exact check can outlast the preferences cache (10 s). The page keeps
// polling, so a health scan then starts after the checking mark and reads the
// answer from before the retry. It must not replace the checking row: only
// the check's own result may (#805 Codex review).
func TestHealthScanStartedAfterTheCheckingMarkLeavesTheRowChecking(t *testing.T) {
	previousWait := exactProviderRetryWait
	exactProviderRetryWait = 20 * time.Millisecond
	t.Cleanup(func() { exactProviderRetryWait = previousWait })
	server := newTestServer(t, runtimeconfig.Config{})
	clock := time.Date(2026, 10, 20, 9, 0, 0, 0, time.UTC)
	var clockMu sync.Mutex
	server.now = func() time.Time {
		clockMu.Lock()
		defer clockMu.Unlock()
		return clock
	}
	var scans atomic.Int32
	server.providerPreferences.load = func(context.Context) ([]codexbar.ProviderSetting, error) {
		scans.Add(1)
		return []codexbar.ProviderSetting{{ID: "claude", Label: "Claude", Enabled: true, Health: codexbar.ProviderHealthUnavailable}}, nil
	}
	server.providerPreferences.loadInventory = func(context.Context) ([]codexbar.ProviderSetting, error) {
		return []codexbar.ProviderSetting{{ID: "claude", Label: "Claude", Enabled: true}}, nil
	}
	server.loadUsage = func(time.Time) (daemon.PersistedUsage, bool) { return daemon.PersistedUsage{}, false }
	claudeState := func() string {
		t.Helper()
		rec := httptest.NewRecorder()
		server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/v1/preferences?section=providers", nil))
		var response preferencesResponse
		if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil || len(response.Items) != 1 {
			t.Fatalf("unexpected preferences: %v %s", err, rec.Body.String())
		}
		return response.Items[0].Health.State
	}
	waitForScan := func(count int32) {
		t.Helper()
		deadline := time.Now().Add(5 * time.Second)
		for {
			server.providerPreferences.mu.Lock()
			running := server.providerPreferences.healthRefresh
			server.providerPreferences.mu.Unlock()
			if scans.Load() >= count && !running {
				return
			}
			if time.Now().After(deadline) {
				t.Fatalf("health scan %d never finished", count)
			}
			time.Sleep(5 * time.Millisecond)
		}
	}
	claudeState()
	waitForScan(1)
	if state := claudeState(); state == "checking" {
		t.Fatalf("the first scan must show the failure before the retry, got %q", state)
	}

	release := make(chan struct{})
	server.probeExactProvider = func(ctx context.Context, _ string, providerID string) codexbar.ProviderSetup {
		<-release
		return exactSetupFixture(server.currentTime(), providerID, codexbar.ProviderReady)
	}
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/v1/providers/retry?provider=claude", nil))
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"checking"`) {
		t.Fatalf("a check that outlasts the wait must answer checking: %d %s", rec.Code, rec.Body.String())
	}
	if state := claudeState(); state != "checking" {
		t.Fatalf("the row must show the running check, got %q", state)
	}

	// The check runs past the cache: the poll starts a new scan, which still
	// reads the failure from before the retry.
	clockMu.Lock()
	clock = clock.Add(providerPreferenceCache + time.Second)
	clockMu.Unlock()
	claudeState()
	waitForScan(2)
	if state := claudeState(); state != "checking" {
		t.Fatalf("a scan started after the mark replaced the running check with %q", state)
	}

	close(release)
	waitForCachedProviderHealth(t, server, "claude", codexbar.ProviderHealthHealthy)
	if state := claudeState(); state != "healthy" {
		t.Fatalf("the finished check must land on the row, got %q", state)
	}
}

// The customer can switch the provider off while its check runs on after the
// request answered. Its result then speaks for a choice that no longer holds:
// it must neither land in the setup log nor replace the usage service
// (#805 Codex review).
func TestExactProviderRetryOvertakenBySwitchingOffLeavesNoTrace(t *testing.T) {
	previousWait := exactProviderRetryWait
	exactProviderRetryWait = 20 * time.Millisecond
	t.Cleanup(func() { exactProviderRetryWait = previousWait })
	server := newTestServer(t, runtimeconfig.Config{})
	server.providerPreferences.load = func(context.Context) ([]codexbar.ProviderSetting, error) {
		return []codexbar.ProviderSetting{{ID: "claude", Label: "Claude", Enabled: true, Health: codexbar.ProviderHealthUnavailable}}, nil
	}
	server.providerPreferences.set = func(context.Context, string, bool) error { return nil }
	server.loadUsage = func(time.Time) (daemon.PersistedUsage, bool) { return daemon.PersistedUsage{}, false }
	var restarts atomic.Int32
	server.restartUsageService = func(context.Context) error { restarts.Add(1); return nil }
	release := make(chan struct{})
	probed := make(chan struct{})
	server.probeExactProvider = func(_ context.Context, _ string, providerID string) codexbar.ProviderSetup {
		<-release
		defer close(probed)
		return exactSetupFixture(server.currentTime(), providerID, codexbar.ProviderReady)
	}
	if _, err := server.cachedProviderSettings(context.Background(), true); err != nil {
		t.Fatal(err)
	}

	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/v1/providers/retry?provider=claude", nil))
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"checking"`) {
		t.Fatalf("a check that outlasts the wait must answer checking: %d %s", rec.Code, rec.Body.String())
	}
	rec = httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodPatch, "/v1/preferences/codexbar.providers.claude.enabled", strings.NewReader(`{"value":false}`)))
	if rec.Code != http.StatusOK {
		t.Fatalf("Claude could not be switched off: %d %s", rec.Code, rec.Body.String())
	}

	close(release)
	select {
	case <-probed:
	case <-time.After(5 * time.Second):
		t.Fatal("the check never finished")
	}
	time.Sleep(100 * time.Millisecond)
	if event, ok := server.setupEvents.lastOfStage(server.currentTime(), "provider_check"); ok {
		t.Fatalf("an overtaken check reached the setup log: %+v", event)
	}
	if restarts.Load() != 0 {
		t.Fatalf("an overtaken check replaced the usage service %d times", restarts.Load())
	}
}

// The customer can switch the provider off in the very moment between the
// check finishing and its follow-up. The follow-up decides on the revision it
// acts on, not on one read earlier: no event, no replacement (#805 Codex
// review).
func TestExactProviderRetrySwitchedOffBeforeFollowUpLeavesNoTrace(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	server.providerPreferences.load = func(context.Context) ([]codexbar.ProviderSetting, error) {
		return []codexbar.ProviderSetting{{ID: "claude", Label: "Claude", Enabled: true, Health: codexbar.ProviderHealthUnavailable}}, nil
	}
	server.providerPreferences.set = func(context.Context, string, bool) error { return nil }
	server.loadUsage = func(time.Time) (daemon.PersistedUsage, bool) { return daemon.PersistedUsage{}, false }
	var restarts atomic.Int32
	server.restartUsageService = func(context.Context) error { restarts.Add(1); return nil }
	server.probeExactProvider = func(_ context.Context, _ string, providerID string) codexbar.ProviderSetup {
		return exactSetupFixture(server.currentTime(), providerID, codexbar.ProviderReady)
	}
	if _, err := server.cachedProviderSettings(context.Background(), true); err != nil {
		t.Fatal(err)
	}
	switchedOff := false
	server.providerRetryFollowupHook = func() {
		rec := httptest.NewRecorder()
		server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodPatch, "/v1/preferences/codexbar.providers.claude.enabled", strings.NewReader(`{"value":false}`)))
		if rec.Code != http.StatusOK {
			t.Errorf("Claude could not be switched off: %d %s", rec.Code, rec.Body.String())
		}
		switchedOff = true
	}

	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/v1/providers/retry?provider=claude", nil))
	if rec.Code != http.StatusOK || !switchedOff {
		t.Fatalf("retry: status=%d switchedOff=%t body=%s", rec.Code, switchedOff, rec.Body.String())
	}
	time.Sleep(100 * time.Millisecond)
	if event, ok := server.setupEvents.lastOfStage(server.currentTime(), "provider_check"); ok {
		t.Fatalf("a check switched off before its follow-up reached the setup log: %+v", event)
	}
	if restarts.Load() != 0 {
		t.Fatalf("a check switched off before its follow-up replaced the usage service %d times", restarts.Load())
	}
}

// A switch that arrives while a follow-up runs waits until that follow-up is
// done before it applies anything (Codex on #805).
func TestProviderSwitchWaitsForARunningRetryFollowUp(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	server.providerPreferences.load = func(context.Context) ([]codexbar.ProviderSetting, error) {
		return []codexbar.ProviderSetting{{ID: "claude", Label: "Claude", Enabled: true, Health: codexbar.ProviderHealthUnavailable}}, nil
	}
	var applied atomic.Bool
	server.providerPreferences.set = func(context.Context, string, bool) error { applied.Store(true); return nil }
	server.loadUsage = func(time.Time) (daemon.PersistedUsage, bool) { return daemon.PersistedUsage{}, false }
	server.probeExactProvider = func(_ context.Context, _ string, providerID string) codexbar.ProviderSetup {
		return exactSetupFixture(server.currentTime(), providerID, codexbar.ProviderReady)
	}
	if _, err := server.cachedProviderSettings(context.Background(), true); err != nil {
		t.Fatal(err)
	}
	release := make(chan struct{})
	switchDone := make(chan struct{})
	var appliedDuringFollowUp atomic.Bool
	server.restartUsageService = func(context.Context) error { return nil }
	server.providerFollowupHeldHook = func() {
		go func() {
			rec := httptest.NewRecorder()
			server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodPatch, "/v1/preferences/codexbar.providers.claude.enabled", strings.NewReader(`{"value":false}`)))
			close(switchDone)
		}()
		time.Sleep(150 * time.Millisecond)
		appliedDuringFollowUp.Store(applied.Load())
		close(release)
	}
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/v1/providers/retry?provider=claude", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("retry: %d %s", rec.Code, rec.Body.String())
	}
	select {
	case <-release:
	case <-time.After(5 * time.Second):
		t.Skip("the retry did not reach the usage-service replacement in this setup")
	}
	select {
	case <-switchDone:
	case <-time.After(5 * time.Second):
		t.Fatal("the switch never finished")
	}
	if appliedDuringFollowUp.Load() {
		t.Fatal("the switch was applied while the follow-up was still running")
	}
	if !applied.Load() {
		t.Fatal("the switch was not applied after the follow-up")
	}
}

func TestExactProviderRetryPreservesFreshFailureOverLastGoodUsage(t *testing.T) {
	for _, status := range []string{
		codexbar.ProviderAuthRequired,
		codexbar.ProviderPermissionRequired,
		codexbar.ProviderConfigError,
	} {
		t.Run(status, func(t *testing.T) {
			server := newTestServer(t, runtimeconfig.Config{})
			now := time.Date(2026, 7, 30, 14, 30, 0, 0, time.UTC)
			server.now = func() time.Time { return now }
			server.loadUsage = func(time.Time) (daemon.PersistedUsage, bool) {
				return freshProviderUsage("codex", "Codex", now.Add(-time.Minute)), true
			}
			server.probeExactProvider = func(_ context.Context, _ string, providerID string) codexbar.ProviderSetup {
				return codexbar.ProviderSetup{
					Status:    "setup_required",
					CheckedAt: now.Format(time.RFC3339Nano),
					Engine:    codexbar.EngineReadiness{Status: codexbar.ProviderReady},
					Providers: []codexbar.ProviderReadiness{{
						ID: providerID, Label: "Codex", Enabled: providerEnabled(true), Status: status,
					}},
				}
			}
			woke := false
			server.wakeDisplayStream = func() { woke = true }

			rec := httptest.NewRecorder()
			server.Handler().ServeHTTP(
				rec,
				httptest.NewRequest(http.MethodPost, "/v1/providers/retry?provider=codex", nil),
			)
			if rec.Code != http.StatusOK {
				t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
			}
			var got providerSetupResponse
			if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
				t.Fatal(err)
			}
			provider := providerByID(got.ProviderSetup.Providers, "codex")
			if got.ProviderSetup.Status != "setup_required" || provider == nil ||
				provider.Status != status || woke {
				t.Fatalf("fresh exact failure was overwritten: woke=%t setup=%+v", woke, got.ProviderSetup)
			}
		})
	}
}

func TestExactProviderRetryIsSingleFlight(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	var probes atomic.Int32
	started := make(chan struct{})
	release := make(chan struct{})
	server.probeExactProvider = func(_ context.Context, _ string, providerID string) codexbar.ProviderSetup {
		if probes.Add(1) == 1 {
			close(started)
		}
		<-release
		return codexbar.ProviderSetup{
			Status: codexbar.ProviderReady,
			Providers: []codexbar.ProviderReadiness{{
				ID: providerID, Label: "Future Provider", Enabled: providerEnabled(true), Status: codexbar.ProviderReady,
			}},
		}
	}

	const requests = 2
	results := make(chan *httptest.ResponseRecorder, requests)
	var waitGroup sync.WaitGroup
	startRequests := make(chan struct{})
	for range requests {
		waitGroup.Add(1)
		go func() {
			defer waitGroup.Done()
			<-startRequests
			recorder := httptest.NewRecorder()
			server.Handler().ServeHTTP(
				recorder,
				httptest.NewRequest(http.MethodPost, "/v1/providers/retry?provider=future-provider", nil),
			)
			results <- recorder
		}()
	}
	close(startRequests)
	<-started
	time.Sleep(20 * time.Millisecond)
	close(release)
	waitGroup.Wait()
	close(results)
	for recorder := range results {
		if recorder.Code != http.StatusOK || !strings.Contains(recorder.Body.String(), `"status":"ready"`) {
			t.Fatalf("unexpected exact retry response: status=%d body=%s", recorder.Code, recorder.Body.String())
		}
	}
	if probes.Load() != 1 {
		t.Fatalf("parallel exact retries started %d probes", probes.Load())
	}
}

func TestNoProvidersStreamErrorIsProviderSetupRequired(t *testing.T) {
	logPath := filepath.Join(t.TempDir(), "daemon.out.log")
	startedAt := time.Now().UTC().Add(-time.Second)
	errorAt := startedAt.Add(100 * time.Millisecond)
	content := strings.Join([]string{
		startedAt.Format(time.RFC3339Nano) + ` runtime event=stream-start label="shop.vibetv.control-center.runtime"`,
		errorAt.Format(time.RFC3339Nano) + ` cycle error: code=runtime/no-providers op=select-provider retry=30s err=runtime/no-providers`,
	}, "\n") + "\n"
	if err := os.WriteFile(logPath, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	when, detail, code, ok := lastDisplayStreamErrorRecordAfter(logPath, startedAt)
	if !ok || when.IsZero() || code != "provider_setup_required" || !strings.Contains(detail, "AI usage") {
		t.Fatalf("unexpected provider stream error: ok=%t when=%s code=%q detail=%q", ok, when, code, detail)
	}
}

func TestProviderSetupDoesNotChangeDeviceReadiness(t *testing.T) {
	device := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hello":
			_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"board":"esp8266-smalltv-st7789","deviceId":"provider-independent","networkMode":"station","capabilities":{"transport":{"active":"wifi"}}}`))
		case "/health":
			_, _ = w.Write([]byte(`{"ok":true,"render":{"fullCount":3,"partialCount":1,"lastKind":"usage"}}`))
		default:
			t.Fatalf("unexpected device path %s", r.URL.Path)
		}
	}))
	defer device.Close()

	server := newTestServer(t, runtimeconfig.Config{
		DeviceTarget: device.URL,
		DeviceToken:  "paired-token",
		DeviceID:     "provider-independent",
	})
	server.streamStatus = func(context.Context, string) displayStreamInfo {
		return displayStreamInfo{
			Running:   true,
			Target:    device.URL,
			ErrorCode: "provider_setup_required",
			Detail:    "No provider is ready.",
		}
	}

	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/v1/status", nil))
	var got statusResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if !got.Device.Active || !got.Device.Ready || got.Device.ConnectionState != deviceConnectionReady {
		t.Fatalf("provider setup incorrectly changed device readiness: %+v", got.Device)
	}
}

func TestProviderDiagnosticsNeverRecommendFixConnection(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{DeviceTarget: "http://127.0.0.1:1", DeviceToken: "paired"})
	server.probeProviderSetup = func(context.Context, string) codexbar.ProviderSetup {
		return setupFixture(codexbar.ProviderAuthRequired)
	}
	server.streamStatus = func(context.Context, string) displayStreamInfo {
		return displayStreamInfo{Running: true, ErrorCode: "provider_setup_required", Detail: "No provider is ready."}
	}
	// Exercise the pure diagnostic mapping without relying on an actual device.
	check := providerDiagnosticCheck(setupFixture(codexbar.ProviderAuthRequired), true)
	if strings.Contains(strings.ToLower(check.NextAction), "fix connection") || check.ErrorCode != codexbar.ProviderAuthRequired {
		t.Fatalf("unexpected provider diagnostic: %+v", check)
	}
}

// A support report must carry the engine sentence of every switched-on
// provider that fails, also when another provider works (#500).
func TestProviderDiagnosticsReportEveryFailingProvider(t *testing.T) {
	throttled := codexbar.ProviderReadiness{
		ID: "claude", Label: "Claude", Enabled: providerEnabled(true), Status: codexbar.ProviderRateLimited,
		Detail:   "Claude received too many usage checks and is pausing them for a few minutes.",
		Reported: "OAuth: Claude OAuth usage endpoint is rate limited. Retrying in about 198s.",
	}
	signedOut := codexbar.ProviderReadiness{
		ID: "gemini", Label: "Gemini", Enabled: providerEnabled(true), Status: codexbar.ProviderAuthRequired,
		Detail: "Sign in to Gemini.", Reported: "Gemini credentials not found at C:\\Users\\Patrick\\.gemini.",
	}
	off := codexbar.ProviderReadiness{
		ID: "cursor", Label: "Cursor", Enabled: providerEnabled(false), Status: codexbar.ProviderAuthRequired,
		Detail: "Sign in to Cursor.",
	}
	working := codexbar.ProviderReadiness{ID: "codex", Label: "Codex", Enabled: providerEnabled(true), Status: codexbar.ProviderReady}

	ready := providerDiagnosticCheck(codexbar.ProviderSetup{
		Status:    codexbar.ProviderReady,
		Providers: []codexbar.ProviderReadiness{working, throttled, off, signedOut},
	}, true)
	if ready.Status != "pass" {
		t.Fatalf("a working provider keeps the check passing: %+v", ready)
	}
	for _, want := range []string{"Claude: " + throttled.Detail, "Retrying in about 198s", "Gemini: Sign in to Gemini.", "~\\.gemini"} {
		if !strings.Contains(ready.Detail, want) {
			t.Fatalf("ready report misses %q: %s", want, ready.Detail)
		}
	}
	if strings.Contains(ready.Detail, "Cursor") || strings.Contains(ready.Detail, "Patrick") {
		t.Fatalf("ready report names a switched-off provider or the account: %s", ready.Detail)
	}

	failing := providerDiagnosticCheck(codexbar.ProviderSetup{
		Status:    "setup_required",
		Providers: []codexbar.ProviderReadiness{signedOut, throttled},
	}, true)
	if failing.ErrorCode != codexbar.ProviderAuthRequired || !strings.HasPrefix(failing.Detail, "Sign in to Gemini.") {
		t.Fatalf("first provider stays the headline: %+v", failing)
	}
	if !strings.Contains(failing.Detail, "Claude: "+throttled.Detail) || !strings.Contains(failing.Detail, "Retrying in about 198s") {
		t.Fatalf("second failing provider missing from the report: %s", failing.Detail)
	}
}

// The setup log is read by the customer: a failing provider's line carries
// the fixed sentence of its state, never CodexBar's own text. The support
// report keeps that text (#500). Paul, 16.10.; #579.
func TestProviderSetupLogShowsTheFixedSentenceNotTheEngine(t *testing.T) {
	const engine = "No available fetch strategy for openai."
	server := newTestServer(t, runtimeconfig.Config{})
	setup := codexbar.ProviderSetup{
		Status: "setup_required",
		Providers: []codexbar.ProviderReadiness{{
			ID: "openai", Label: "OpenAI API", Status: codexbar.ProviderEngineError,
			Detail: "The usage service could not read this provider.", NextAction: "Check this provider, then try again.",
			Reported: engine,
		}},
	}
	server.recordProviderSetupEvents(setup, "openai", "OpenAI API")
	got := getSetupLog(t, server).Events
	if len(got) != 1 || got[0].Status != "failed" ||
		got[0].Message != "OpenAI API: The usage service could not read this provider." {
		t.Fatalf("setup log = %+v", got)
	}
	if strings.Contains(got[0].Message, "fetch strategy") {
		t.Fatalf("setup log shows the engine's own sentence: %q", got[0].Message)
	}
	if report := providerDiagnosticCheck(setup, true).Detail; !strings.Contains(report, engine) {
		t.Fatalf("support report misses the engine sentence: %s", report)
	}
}

func setupFixture(status string) codexbar.ProviderSetup {
	setup := codexbar.ProviderSetup{
		Status: "setup_required",
		Engine: codexbar.EngineReadiness{Status: codexbar.ProviderReady},
		Providers: []codexbar.ProviderReadiness{{
			ID: "claude", Label: "Claude", Enabled: providerEnabled(true), Status: status,
			Detail: "Provider setup needs attention.", NextAction: "Open CodexBar and check again.",
		}},
	}
	if status == codexbar.ProviderReady {
		setup.Status = codexbar.ProviderReady
	}
	return setup
}

func freshProviderUsage(id, label string, collectedAt time.Time) daemon.PersistedUsage {
	return daemon.PersistedUsage{
		SavedAt:         collectedAt,
		CurrentProvider: id,
		Providers: []daemon.ProviderUsageSnapshot{{
			Provider: id,
			Frame: protocol.Frame{
				Provider:  id,
				Label:     label,
				Session:   12,
				Weekly:    34,
				UsageMode: "used",
			},
			Meta: codexbar.ProviderUsageMeta{Windows: []codexbar.UsageWindow{
				{ID: "session", Label: "Session", UsedPercent: 12},
				{ID: "weekly", Label: "Weekly", UsedPercent: 34},
			}},
			CollectedAt: collectedAt,
		}},
	}
}

func tokenRichQuotaUnavailableUsage(id, label string, tokenAt time.Time) daemon.PersistedUsage {
	return daemon.PersistedUsage{
		SavedAt:         tokenAt,
		CurrentProvider: id,
		Providers: []daemon.ProviderUsageSnapshot{{
			Provider: id,
			Frame: protocol.Frame{
				Provider:           id,
				Label:              label,
				UsageMode:          "used",
				UsageUnavailable:   true,
				SessionUnavailable: true,
				WeeklyUnavailable:  true,
				SessionTokens:      12,
				WeekTokens:         34,
				TotalTokens:        56,
			},
			Meta: codexbar.ProviderUsageMeta{Cost: &codexbar.ProviderCostUsage{
				UpdatedAt:        tokenAt,
				Last30DaysTokens: 56,
				LatestTokens:     12,
			}},
			CollectedAt:           tokenAt.Add(-20 * time.Minute),
			TokenStatsCollectedAt: tokenAt,
			Stale:                 true,
		}},
	}
}

func assertReadyProviderSetup(t *testing.T, setup codexbar.ProviderSetup, providerID string) {
	t.Helper()
	provider := providerByID(setup.Providers, providerID)
	if setup.Status != codexbar.ProviderReady || setup.Engine.Status != codexbar.ProviderReady ||
		provider == nil || provider.Status != codexbar.ProviderReady {
		t.Fatalf("provider setup is not ready for %s: %+v", providerID, setup)
	}
}

func providerByID(providers []codexbar.ProviderReadiness, id string) *codexbar.ProviderReadiness {
	for i := range providers {
		if providers[i].ID == id {
			return &providers[i]
		}
	}
	return nil
}

func diagnosticCheckByName(checks []diagnosticCheck, name string) *diagnosticCheck {
	for i := range checks {
		if checks[i].Name == name {
			return &checks[i]
		}
	}
	return nil
}

// #527: the row and the setup log only carry the generic settings sentence.
// The runtime log gets the source and CodexBar's reason, redacted.
func TestProviderCheckLogsRedactedCauseOfSettingsError(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	var lines []string
	server.logf = func(format string, args ...any) { lines = append(lines, fmt.Sprintf(format, args...)) }
	server.probeExactProvider = func(_ context.Context, _ string, id string) codexbar.ProviderSetup {
		return codexbar.ProviderSetup{Status: "setup_required", Providers: []codexbar.ProviderReadiness{
			{
				ID: id, Status: codexbar.ProviderConfigError,
				Cause: "inventory: Failed to decode /Users/paul/.codexbar/config.json for hallo@dreamytales.de",
			},
			{ID: "codex", Status: codexbar.ProviderAuthRequired},
		}}
	}
	server.currentExactProviderSetup(context.Background(), "claude")
	want := "VibeTV provider check: claude is config_error (inventory: Failed to decode ~/.codexbar/config.json for [redacted])"
	if len(lines) != 1 || lines[0] != want {
		t.Fatalf("unexpected log lines:\n got %q\nwant %q", lines, want)
	}
}

// The status poll and the provider-row poll of an open window are checks
// nobody asked for: they read what the usage service delivered last (#555).
// "Check again" and Run diagnostics are the customer's and ask the provider.
func TestOnlyChecksNobodyAskedForReadTheServeReading(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	server.loadUsage = func(time.Time) (daemon.PersistedUsage, bool) { return daemon.PersistedUsage{}, false }
	setupChecks := make(chan bool, 4)
	server.probeProviderSetup = func(ctx context.Context, _ string) codexbar.ProviderSetup {
		setupChecks <- codexbar.UsesServeReading(ctx)
		return setupFixture(codexbar.ProviderReady)
	}
	rowChecks := make(chan bool, 1)
	server.providerPreferences.loadInventory = func(context.Context) ([]codexbar.ProviderSetting, error) {
		return []codexbar.ProviderSetting{{ID: "claude", Label: "Claude", Enabled: true}}, nil
	}
	server.providerPreferences.load = func(ctx context.Context) ([]codexbar.ProviderSetting, error) {
		rowChecks <- codexbar.UsesServeReading(ctx)
		return []codexbar.ProviderSetting{{ID: "claude", Label: "Claude", Enabled: true, Health: codexbar.ProviderHealthHealthy}}, nil
	}
	next := func(checks chan bool, what string) bool {
		t.Helper()
		select {
		case fromServe := <-checks:
			return fromServe
		case <-time.After(2 * time.Second):
			t.Fatalf("%s started no check", what)
			return false
		}
	}

	server.providerSetupForStatus()
	if !next(setupChecks, "the status poll") {
		t.Fatal("the status poll asked every provider instead of reading the serve reading")
	}
	server.Handler().ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/v1/preferences?section=providers", nil))
	if !next(rowChecks, "the provider-row poll") {
		t.Fatal("the provider-row poll asked every provider instead of reading the serve reading")
	}

	forgetCachedSetup := func() {
		server.providerSetupMu.Lock()
		server.providerSetupCachedAt = time.Time{}
		server.providerSetupMu.Unlock()
	}
	forgetCachedSetup()
	server.Handler().ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodPost, "/v1/providers/retry", nil))
	if next(setupChecks, "Check again") {
		t.Fatal("Check again must ask the provider, not repeat the serve reading")
	}
	forgetCachedSetup()
	if server.currentProviderSetup(context.Background(), false); next(setupChecks, "Run diagnostics") {
		t.Fatal("Run diagnostics must ask the provider, not repeat the serve reading")
	}
}

// The popup offers the sign-in only for the providers the Companion can start
// (providerSignInLaunches); the codexbar package keeps the same list for its
// sentences, so both must name the same providers.
func TestSignInStartableProvidersAreTheOnesWithALaunch(t *testing.T) {
	ids := codexbar.SignInStartableProviderIDs()
	if len(ids) != len(providerSignInLaunches) {
		t.Fatalf("sentence list %v, launches %d", ids, len(providerSignInLaunches))
	}
	for _, id := range ids {
		if _, ok := providerSignInLaunches[id]; !ok {
			t.Fatalf("%s is named as sign-in startable but has no launch", id)
		}
	}
}
