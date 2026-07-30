package companionapi

import (
	"context"
	"encoding/json"
	"errors"
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
			Engine:    codexbar.EngineReadiness{Status: codexbar.ProviderReady, Version: "0.46.0"},
			Providers: []codexbar.ProviderReadiness{{
				ID: "codexbar", Label: "Usage service", Enabled: true, Status: codexbar.ProviderEngineError,
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
				ID: "codexbar", Label: "Usage service", Enabled: true, Status: codexbar.ProviderEngineError,
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

func TestProviderSetupKeepsFailingProviderScopedBesideHealthyCollectorProvider(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	now := time.Date(2026, 7, 28, 13, 0, 0, 0, time.UTC)
	server.now = func() time.Time { return now }
	server.probeProviderSetup = func(context.Context, string) codexbar.ProviderSetup {
		return codexbar.ProviderSetup{
			Status: "setup_required",
			Engine: codexbar.EngineReadiness{Status: codexbar.ProviderReady},
			Providers: []codexbar.ProviderReadiness{{
				ID: "claude", Label: "Claude", Enabled: true, Status: codexbar.ProviderAuthRequired,
				Detail: "This provider needs an active sign-in.",
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
						ID: "codexbar", Label: "Usage service", Enabled: true, Status: codexbar.ProviderEngineError,
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
				ID: "codexbar", Label: "Usage service", Enabled: true, Status: codexbar.ProviderEngineError,
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
				ID: "codex", Label: "Codex", Enabled: true, Status: codexbar.ProviderAuthRequired,
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

func TestProviderSetupTokenEvidenceKeepsOneHealthyOneFailingIsolated(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	now := time.Date(2026, 7, 29, 12, 25, 0, 0, time.UTC)
	server.now = func() time.Time { return now }
	server.probeProviderSetup = func(context.Context, string) codexbar.ProviderSetup {
		return codexbar.ProviderSetup{
			Status: "setup_required",
			Engine: codexbar.EngineReadiness{Status: codexbar.ProviderReady},
			Providers: []codexbar.ProviderReadiness{{
				ID: "claude", Label: "Claude", Enabled: true, Status: codexbar.ProviderAuthRequired,
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
				ID: "future-provider", Label: "Future Provider", Enabled: true, Status: codexbar.ProviderAuthRequired,
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

func TestExactProviderRetryPreservesFreshAuthFailureOverLastGoodUsage(t *testing.T) {
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
				ID: providerID, Label: "Codex", Enabled: true, Status: codexbar.ProviderAuthRequired,
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
		provider.Status != codexbar.ProviderAuthRequired || woke {
		t.Fatalf("fresh exact auth failure was overwritten: woke=%t setup=%+v", woke, got.ProviderSetup)
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
				ID: providerID, Label: "Future Provider", Enabled: true, Status: codexbar.ProviderReady,
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

func TestOpenCodexBarUsesFixedActionAndReturnsSetup(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	called := false
	server.openCodexBar = func(context.Context) error { called = true; return nil }
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/v1/providers/open-codexbar", nil))
	if rec.Code != http.StatusOK || !called || !strings.Contains(rec.Body.String(), `"providerSetup"`) {
		t.Fatalf("unexpected open response: called=%t status=%d body=%s", called, rec.Code, rec.Body.String())
	}

	server.openCodexBar = func(context.Context) error { return errors.New("not found") }
	rec = httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/v1/providers/open-codexbar", nil))
	if rec.Code != http.StatusServiceUnavailable || !strings.Contains(rec.Body.String(), `"codexbar_open_failed"`) {
		t.Fatalf("unexpected open error: %d %s", rec.Code, rec.Body.String())
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
	if !ok || when.IsZero() || code != "provider_setup_required" || !strings.Contains(detail, "AI provider") {
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
	check := providerDiagnosticCheck(setupFixture(codexbar.ProviderAuthRequired))
	if strings.Contains(strings.ToLower(check.NextAction), "fix connection") || check.ErrorCode != codexbar.ProviderAuthRequired {
		t.Fatalf("unexpected provider diagnostic: %+v", check)
	}
}

func setupFixture(status string) codexbar.ProviderSetup {
	setup := codexbar.ProviderSetup{
		Status: "setup_required",
		Engine: codexbar.EngineReadiness{Status: codexbar.ProviderReady},
		Providers: []codexbar.ProviderReadiness{{
			ID: "claude", Label: "Claude", Enabled: true, Status: status,
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
