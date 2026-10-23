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

// Windows and the Mac look and work the same: both offer the sign-in button.
func TestProviderSignInFeatureIsOnForWindowsAndMac(t *testing.T) {
	for _, goos := range []string{"windows", "darwin"} {
		if !providerSignInFeatureEnabledFor(goos) {
			t.Fatalf("%s must switch the provider sign-in feature on", goos)
		}
	}
	if providerSignInFeatureEnabledFor("linux") {
		t.Fatal("linux has no shell for the sign-in button")
	}
}

// The setup guide button opens exactly one fixed page, and only on POST.
func TestProviderSetupGuideOpensOnlyTheSetupPage(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	original := openProviderSignInFn
	defer func() { openProviderSignInFn = original }()
	var opened []string
	openProviderSignInFn = func(url string) error {
		opened = append(opened, url)
		return nil
	}

	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/v1/providers/setup-guide", nil))
	if rec.Code != http.StatusMethodNotAllowed || len(opened) != 0 {
		t.Fatalf("GET must open nothing: status=%d opened=%v", rec.Code, opened)
	}

	rec = httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/v1/providers/setup-guide?url=https://example.com", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	if len(opened) != 1 || opened[0] != "https://vibetv.shop/pages/setup" {
		t.Fatalf("only the setup guide may open, opened=%v", opened)
	}

	openProviderSignInFn = func(string) error { return errors.New("no browser") }
	rec = httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/v1/providers/setup-guide", nil))
	if rec.Code != http.StatusInternalServerError || !strings.Contains(rec.Body.String(), "vibetv.shop/pages/setup") {
		t.Fatalf("a failed open must name the page: status=%d body=%s", rec.Code, rec.Body.String())
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

// A row drops a diagnosis older than providerReadinessFreshness, so the
// button must drop it too. Otherwise a provider that has since become a
// signed-out tool still opened the old browser page, and pressing the row's
// own action did something other than what the row said.
func TestProviderSignInIgnoresAnExpiredBrowserDiagnosis(t *testing.T) {
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

	server.providerReadinessMu.Lock()
	server.providerReadiness = map[string]providerReadinessRecord{
		"claude": {
			Status:    codexbar.ProviderBrowserSignInRequired,
			SignInURL: "https://claude.ai/login",
			CheckedAt: time.Now().Add(-providerReadinessFreshness - time.Minute),
		},
	}
	server.providerReadinessMu.Unlock()

	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/v1/providers/sign-in?provider=claude", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	if len(opened) != 0 {
		t.Fatalf("an expired browser diagnosis must not open its page, opened=%v", opened)
	}
	if len(launched) != 1 {
		t.Fatalf("expected the tool's own sign-in instead, launched=%v", launched)
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
	// CodexBar on macOS reads Claude and Cursor from the browser sign-in, so
	// the button opens that page even when the app or CLI is installed.
	plan, _ = planProviderSignIn("cursor", "darwin", "/Users/x", none, exists("/Applications/Cursor.app"))
	if plan.Action != providerSignInActionBrowser || plan.URL != "https://cursor.com/dashboard" {
		t.Fatalf("cursor on macOS: %#v", plan)
	}
	plan, _ = planProviderSignIn("claude", "darwin", "/Users/x", func(string) (string, error) { return "/usr/local/bin/claude", nil }, exists())
	if plan.Action != providerSignInActionBrowser || plan.URL != "https://claude.ai/login" {
		t.Fatalf("claude on macOS: %#v", plan)
	}
	// The ChatGPT app ships the Codex CLI; the Companion's PATH misses it.
	chatGPTCodex := "/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex"
	plan, _ = planProviderSignIn("codex", "darwin", "/Users/x", none, exists(chatGPTCodex))
	if plan.Action != providerSignInActionCLILogin || plan.Path != chatGPTCodex || strings.Join(plan.Args, " ") != "login" {
		t.Fatalf("codex from the ChatGPT app: %#v", plan)
	}
	plan, _ = planProviderSignIn("antigravity", "darwin", "/Users/x", none, exists("/Applications/Antigravity.app"))
	if plan.Action != providerSignInActionApp || plan.Path != "/Applications/Antigravity.app" {
		t.Fatalf("antigravity on macOS: %#v", plan)
	}
	if _, ok := planProviderSignIn("copilot", "windows", home, none, exists()); ok {
		t.Fatal("copilot has no plan")
	}
	if _, ok := planProviderSignIn("gemini", "windows", home, none, exists()); ok {
		t.Fatal("gemini has no plan: its login needs a terminal (171a)")
	}
}

// The providers with their own login program (#967): each one's login when
// installed, at its known install location when PATH misses it, and its
// install page otherwise. Windsurf signs in inside its app.
func TestPlanProviderSignInOwnLoginPrograms(t *testing.T) {
	none := func(string) (string, error) { return "", errNotFound }
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
	logins := []struct {
		id, installed, args, download string
	}{
		{"grok", filepath.Join(home, ".grok", "bin", "grok.exe"), "login", "https://docs.x.ai/build/overview"},
		{"kiro", filepath.Join(home, "AppData", "Local", "Programs", "Kiro", "kiro-cli.exe"), "login", "https://kiro.dev/cli/"},
		{"augment", filepath.Join(home, "AppData", "Roaming", "npm", "auggie.cmd"), "login --headless", "https://docs.augmentcode.com/cli/setup-auggie/install-auggie-cli"},
		{"kilo", filepath.Join(home, "AppData", "Roaming", "npm", "kilo.cmd"), "auth login --provider kilo", "https://kilo.ai/cli"},
		{"vertexai", filepath.Join(home, "AppData", "Local", "Google", "Cloud SDK", "google-cloud-sdk", "bin", "gcloud.cmd"), "auth application-default login", "https://cloud.google.com/sdk/docs/install"},
	}
	for _, login := range logins {
		plan, ok := planProviderSignIn(login.id, "windows", home, none, exists(login.installed))
		if !ok || plan.Action != providerSignInActionCLILogin || plan.Path != login.installed || strings.Join(plan.Args, " ") != login.args {
			t.Fatalf("%s installed: %#v ok=%v", login.id, plan, ok)
		}
		plan, _ = planProviderSignIn(login.id, "windows", home, none, exists())
		if plan.Action != providerSignInActionDownload || plan.URL != login.download {
			t.Fatalf("%s missing: %#v", login.id, plan)
		}
	}
	onPath := func(name string) (string, error) {
		if name == "grok" {
			return "/usr/local/bin/grok", nil
		}
		return "", errNotFound
	}
	plan, _ := planProviderSignIn("grok", "darwin", "/Users/x", onPath, exists())
	if plan.Action != providerSignInActionCLILogin || plan.Path != "/usr/local/bin/grok" || strings.Join(plan.Args, " ") != "login" {
		t.Fatalf("grok on PATH on macOS: %#v", plan)
	}
	plan, _ = planProviderSignIn("grok", "darwin", "/Users/x", none, exists("/Users/x/.grok/bin/grok"))
	if plan.Action != providerSignInActionCLILogin || plan.Path != "/Users/x/.grok/bin/grok" {
		t.Fatalf("grok from its installer on macOS: %#v", plan)
	}
	windsurf := filepath.Join(home, "AppData", "Local", "Programs", "Windsurf", "Windsurf.exe")
	plan, _ = planProviderSignIn("windsurf", "windows", home, none, exists(windsurf))
	if plan.Action != providerSignInActionApp || plan.Path != windsurf {
		t.Fatalf("windsurf installed: %#v", plan)
	}
	plan, _ = planProviderSignIn("windsurf", "darwin", "/Users/x", none, exists("/Applications/Windsurf.app"))
	if plan.Action != providerSignInActionApp || plan.Path != "/Applications/Windsurf.app" {
		t.Fatalf("windsurf on macOS: %#v", plan)
	}
	plan, _ = planProviderSignIn("windsurf", "windows", home, none, exists())
	if plan.Action != providerSignInActionDownload || plan.URL != "https://windsurf.com/download" {
		t.Fatalf("windsurf missing: %#v", plan)
	}
}

var errNotFound = errors.New("not found")
