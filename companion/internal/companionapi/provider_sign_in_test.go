package companionapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimeconfig"
)

// The Companion keeps no sign-in table: it opens only the page CodexBar named
// in the provider's current browser-sign-in diagnosis.
func TestProviderSignInOpensOnlyThePageCodexBarNamed(t *testing.T) {
	server := newTestServer(t, runtimeconfig.Config{})
	original := openProviderSignInFn
	defer func() { openProviderSignInFn = original }()
	var opened []string
	openProviderSignInFn = func(url string) error {
		opened = append(opened, url)
		return nil
	}

	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/v1/providers/sign-in?provider=claude", nil))
	if rec.Code != http.StatusNotFound || len(opened) != 0 {
		t.Fatalf("without a diagnosis nothing may open: status=%d opened=%v", rec.Code, opened)
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
	if rec.Code != http.StatusNotFound || len(opened) != 1 {
		t.Fatalf("a provider without a page must not open anything: status=%d opened=%v", rec.Code, opened)
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
