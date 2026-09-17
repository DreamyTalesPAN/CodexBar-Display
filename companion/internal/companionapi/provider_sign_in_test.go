package companionapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimeconfig"
)

// The shortened provider list and the sign-in button are Windows-only launch
// decisions. The Mac app must keep CodexBar's full provider inventory and the
// rows it shows today, so the flag the app reads stays off there.
func TestProviderSignInFeatureIsWindowsOnly(t *testing.T) {
	if !providerSignInFeatureEnabledFor("windows") {
		t.Fatal("Windows must switch the provider sign-in feature on")
	}
	for _, goos := range []string{"darwin", "linux"} {
		if providerSignInFeatureEnabledFor(goos) {
			t.Fatalf("%s must keep the provider sign-in feature off", goos)
		}
	}
}

// A browser-sign-in diagnosis from CodexBar wins: only the page it named opens,
// never the tool's own login.
func TestProviderSignInOpensOnlyThePageCodexBarNamed(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	original := openProviderSignInFn
	defer func() { openProviderSignInFn = original }()
	var opened []string
	openProviderSignInFn = func(url string) error {
		opened = append(opened, url)
		return nil
	}
	originalLaunch := launchProviderSignInFn
	defer func() { launchProviderSignInFn = originalLaunch }()
	var launched []providerSignInPlan
	launchProviderSignInFn = func(plan providerSignInPlan) error {
		launched = append(launched, plan)
		return nil
	}

	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/v1/providers/sign-in?provider=copilot", nil))
	if rec.Code != http.StatusNotFound || len(opened) != 0 {
		t.Fatalf("a provider without a diagnosis or a plan opens nothing: status=%d opened=%v", rec.Code, opened)
	}

	server.providerReadinessMu.Lock()
	server.providerReadiness = map[string]providerReadinessRecord{
		"claude": {
			Status:    codexbar.ProviderBrowserSignInRequired,
			SignInURL: "https://claude.ai/login",
			CheckedAt: time.Now(),
		},
		"codex": {Status: codexbar.ProviderAuthRequired, CheckedAt: time.Now()},
	}
	server.providerReadinessMu.Unlock()

	rec = httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/v1/providers/sign-in?provider=claude", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	var got struct {
		URL string `json:"url"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.URL != "https://claude.ai/login" || len(opened) != 1 || opened[0] != got.URL {
		t.Fatalf("expected the named claude page to open once: body=%s opened=%v", rec.Body.String(), opened)
	}

	rec = httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/v1/providers/sign-in?provider=codex", nil))
	if rec.Code != http.StatusOK || len(opened) != 1 || len(launched) != 1 {
		t.Fatalf("a signed-out tool starts its own sign-in, not a browser page: status=%d opened=%v launched=%v", rec.Code, opened, launched)
	}

	// The background health scan is the other source of the page.
	server.providerReadinessMu.Lock()
	server.providerReadiness = nil
	server.providerReadinessMu.Unlock()
	server.providerPreferences.mu.Lock()
	server.providerPreferences.cached = []codexbar.ProviderSetting{{
		ID: "claude", Label: "Claude", Enabled: true,
		Health: codexbar.ProviderHealthBrowserSignIn, SignInURL: "https://claude.ai/login",
	}}
	server.providerPreferences.mu.Unlock()
	rec = httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/v1/providers/sign-in?provider=claude", nil))
	if rec.Code != http.StatusOK || len(opened) != 2 {
		t.Fatalf("the health scan's page must open: status=%d opened=%v", rec.Code, opened)
	}

	rec = httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/v1/providers/sign-in?provider=claude", nil))
	if rec.Code == http.StatusOK || len(opened) != 2 {
		t.Fatalf("GET must not open a browser: status=%d opened=%v", rec.Code, opened)
	}
}

// The plan for a signed-out tool: its CLI login when the CLI is installed
// (PATH first, then the known install location), its app when only that is
// installed, and the official install page when nothing is.
func TestPlanProviderSignIn(t *testing.T) {
	none := func(string) (string, error) { return "", errNotFound }
	onPath := func(name string) (string, error) {
		if name == "codex" {
			return "/path/codex", nil
		}
		return "", errNotFound
	}
	exists := func(paths ...string) func(string) bool {
		return func(path string) bool {
			for _, candidate := range paths {
				if candidate == path {
					return true
				}
			}
			return false
		}
	}
	home := filepath.Join("home", "erwin")
	windowsCodex := filepath.Join(home, "AppData", "Local", "Programs", "codex", "codex.exe")
	windowsClaude := filepath.Join(home, ".local", "bin", "claude.exe")
	windowsCursor := filepath.Join(home, "AppData", "Local", "Programs", "cursor", "Cursor.exe")

	plan, ok := planProviderSignIn("codex", "windows", home, onPath, exists())
	if !ok || plan.Action != providerSignInActionCLILogin || plan.Path != "/path/codex" || strings.Join(plan.Args, " ") != "login" {
		t.Fatalf("codex on PATH: %#v ok=%v", plan, ok)
	}
	plan, _ = planProviderSignIn("codex", "windows", home, none, exists(windowsCodex))
	if plan.Action != providerSignInActionCLILogin || plan.Path != windowsCodex {
		t.Fatalf("codex at its install location: %#v", plan)
	}
	plan, _ = planProviderSignIn("claude", "windows", home, none, exists(windowsClaude))
	if plan.Action != providerSignInActionCLILogin || plan.Path != windowsClaude || strings.Join(plan.Args, " ") != "auth login" {
		t.Fatalf("claude at its install location: %#v", plan)
	}
	plan, _ = planProviderSignIn("claude", "windows", home, none, exists())
	if plan.Action != providerSignInActionDownload || plan.URL != "https://docs.anthropic.com/en/docs/claude-code/setup" {
		t.Fatalf("claude missing: %#v", plan)
	}
	plan, _ = planProviderSignIn("cursor", "windows", home, none, exists(windowsCursor))
	if plan.Action != providerSignInActionApp || plan.Path != windowsCursor {
		t.Fatalf("cursor installed: %#v", plan)
	}
	plan, _ = planProviderSignIn("antigravity", "windows", home, none, exists())
	if plan.Action != providerSignInActionDownload || plan.URL != "https://antigravity.google/download" {
		t.Fatalf("antigravity missing: %#v", plan)
	}
	plan, _ = planProviderSignIn("cursor", "darwin", "/Users/x", none, exists("/Applications/Cursor.app"))
	if plan.Action != providerSignInActionApp || plan.Path != "/Applications/Cursor.app" {
		t.Fatalf("cursor on macOS: %#v", plan)
	}
	if _, ok := planProviderSignIn("copilot", "windows", home, none, exists()); ok {
		t.Fatal("copilot has no plan")
	}
}

var errNotFound = errors.New("not found")
