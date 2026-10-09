package companionapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/daemon"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimeconfig"
)

// The Mac on 2026-10-09: after a restart Claude showed only "Sign in to
// claude.ai (or refresh Claude cookies)". CodexBar's config pinned Claude to
// an expired saved cookie, so it never looked at the browser, and the usage
// service that was already running kept failing Claude even once the config
// was fixed. The customer must get Claude back with the row's buttons alone:
// "Sign in to Claude" opens claude.ai in the browser (no terminal) and hands
// Claude back to the browser sign-in, and the check that follows replaces
// the stale usage service.
func TestExpiredSavedClaudeCookieRecoversWithTheRowButtonsAlone(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("CodexBar on macOS reads Claude from the browser sign-in")
	}
	t.Setenv("CODEXBAR_CONFIG", "")
	server := newTestServer(t, runtimeconfig.Config{})
	now := time.Date(2026, 10, 9, 8, 0, 0, 0, time.UTC)
	server.now = func() time.Time { return now }

	configPath := filepath.Join(server.home, ".codexbar", "config.json")
	if err := os.MkdirAll(filepath.Dir(configPath), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(configPath, []byte(`{"version":1,"providers":[{"id":"claude","enabled":true,"cookieSource":"manual","cookieHeader":"sessionKey=expired"}]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	claudeReadsBrowser := func() bool {
		raw, err := os.ReadFile(configPath)
		if err != nil {
			t.Fatal(err)
		}
		var config struct {
			Providers []struct {
				ID           string `json:"id"`
				CookieSource string `json:"cookieSource"`
			} `json:"providers"`
		}
		if err := json.Unmarshal(raw, &config); err != nil {
			t.Fatal(err)
		}
		return len(config.Providers) == 1 && config.Providers[0].CookieSource == "auto"
	}

	// A fresh CodexBar reads the config on every call: with the saved
	// cookie it fails, with the browser it finds the signed-in session.
	server.probeExactProvider = func(_ context.Context, _ string, id string) codexbar.ProviderSetup {
		status := codexbar.ProviderAuthRequired
		detail := "Sign in to claude.ai (or refresh Claude cookies) to load usage data."
		if claudeReadsBrowser() {
			status, detail = codexbar.ProviderReady, ""
		}
		return codexbar.ProviderSetup{
			Status:    status,
			CheckedAt: now.Format(time.RFC3339Nano),
			Engine:    codexbar.EngineReadiness{Status: codexbar.ProviderReady},
			Providers: []codexbar.ProviderReadiness{{
				ID: id, Label: "Claude", Enabled: providerEnabled(true), Status: status, Detail: detail,
			}},
		}
	}
	// The running usage service keeps the config it started with. Like the
	// supervisor, a restart replaces it only when the config changed after
	// that start. Its Claude reading from before the cookie expired still
	// looks fresh, which must not keep the old service running.
	readConfig := func() string {
		raw, err := os.ReadFile(configPath)
		if err != nil {
			t.Error(err)
		}
		return string(raw)
	}
	var serviceMu sync.Mutex
	serviceConfig := readConfig()
	serviceReadsBrowser := func() bool {
		serviceMu.Lock()
		defer serviceMu.Unlock()
		return !strings.Contains(serviceConfig, `"manual"`)
	}
	var restarts, wakes atomic.Int32
	server.loadUsage = func(time.Time) (daemon.PersistedUsage, bool) {
		return freshProviderUsage("claude", "Claude", now.Add(-time.Second)), true
	}
	server.restartUsageService = func(context.Context) error {
		serviceMu.Lock()
		defer serviceMu.Unlock()
		if current := readConfig(); current != serviceConfig {
			serviceConfig = current
			restarts.Add(1)
		}
		return nil
	}
	server.wakeDisplayStream = func() { wakes.Add(1) }
	var opened []string
	originalOpen := openProviderSignInFn
	defer func() { openProviderSignInFn = originalOpen }()
	openProviderSignInFn = func(url string) error {
		opened = append(opened, url)
		return nil
	}
	var launched []providerSignInPlan
	originalLaunch := launchProviderSignInFn
	defer func() { launchProviderSignInFn = originalLaunch }()
	launchProviderSignInFn = func(plan providerSignInPlan) error {
		launched = append(launched, plan)
		return nil
	}
	retry := func() providerSetupResponse {
		t.Helper()
		rec := httptest.NewRecorder()
		server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/v1/providers/retry?provider=claude", nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("check again: status=%d body=%s", rec.Code, rec.Body.String())
		}
		var got providerSetupResponse
		if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
			t.Fatal(err)
		}
		return got
	}

	// 1. "Check again" alone cannot help: the saved cookie is still used.
	if got := retry(); got.ProviderSetup.Status != codexbar.ProviderAuthRequired || restarts.Load() != 0 {
		t.Fatalf("expected Claude signed out before the sign-in: restarts=%d setup=%+v", restarts.Load(), got.ProviderSetup)
	}

	// 2. "Sign in to Claude" opens claude.ai in the browser, never a
	// terminal, and lets CodexBar read that browser sign-in again.
	// A browser that does not open leaves the customer's settings alone.
	launchProviderSignInFn = func(providerSignInPlan) error { return errors.New("no browser") }
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/v1/providers/sign-in?provider=claude", nil))
	if rec.Code != http.StatusInternalServerError || claudeReadsBrowser() {
		t.Fatalf("a failed sign-in must not change the cookie source: status=%d", rec.Code)
	}
	launchProviderSignInFn = func(plan providerSignInPlan) error {
		launched = append(launched, plan)
		return nil
	}
	rec = httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/v1/providers/sign-in?provider=claude", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("sign in: status=%d body=%s", rec.Code, rec.Body.String())
	}
	if len(launched) != 1 || launched[0].Action != providerSignInActionBrowser || launched[0].URL != "https://claude.ai/login" {
		t.Fatalf("expected only claude.ai/login in the browser, got launched=%+v opened=%v", launched, opened)
	}
	if !claudeReadsBrowser() {
		t.Fatal("the saved cookie must no longer hide the browser sign-in")
	}

	// 3. The automatic re-check finds Claude and replaces the stale usage
	// service, so the display gets Claude's usage again.
	if got := retry(); got.ProviderSetup.Status != codexbar.ProviderReady {
		t.Fatalf("expected Claude ready after the sign-in: %+v", got.ProviderSetup)
	}
	deadline := time.Now().Add(5 * time.Second)
	for (restarts.Load() != 1 || wakes.Load() == 0) && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if restarts.Load() != 1 || wakes.Load() == 0 || !serviceReadsBrowser() {
		t.Fatalf("expected one usage service restart onto the browser sign-in: restarts=%d wakes=%d", restarts.Load(), wakes.Load())
	}

	// 4. A service already running on the current config is left alone.
	for server.usageServiceRestarting.Load() && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	retry()
	for server.usageServiceRestarting.Load() && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if restarts.Load() != 1 {
		t.Fatalf("a working usage service must not be restarted again: restarts=%d", restarts.Load())
	}
}

// When the saved cookie cannot be lifted, the provider stays pinned and no
// later check can succeed, so the sign-in says so instead of reporting
// success and starting three minutes of checks that cannot help.
func TestProviderSignInReportsASavedCookieItCannotLift(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Win-CodexBar keeps saved cookies in a file of its own")
	}
	t.Setenv("CODEXBAR_CONFIG", "")
	server := newTestServer(t, runtimeconfig.Config{})
	dir := filepath.Join(server.home, ".codexbar")
	configPath := filepath.Join(dir, "config.json")
	original := `{"providers":[{"id":"claude","cookieSource":"manual","cookieHeader":"sessionKey=expired"}]}`
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(configPath, []byte(original), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(dir, 0o500); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(dir, 0o700) })
	server.providerReadinessMu.Lock()
	server.providerReadiness = map[string]providerReadinessRecord{"claude": {
		Status: codexbar.ProviderBrowserSignInRequired, SignInURL: "https://claude.ai/login", CheckedAt: time.Now(),
	}}
	server.providerReadinessMu.Unlock()
	originalOpen := openProviderSignInFn
	defer func() { openProviderSignInFn = originalOpen }()
	openProviderSignInFn = func(string) error { return nil }

	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/v1/providers/sign-in?provider=claude", nil))
	if rec.Code != http.StatusInternalServerError || !strings.Contains(rec.Body.String(), "Provider settings could not be read or saved.") {
		t.Fatalf("expected the settings failure, got status=%d body=%s", rec.Code, rec.Body.String())
	}
	if raw, _ := os.ReadFile(configPath); string(raw) != original {
		t.Fatalf("the config must be left as it was: %s", raw)
	}
}
