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
