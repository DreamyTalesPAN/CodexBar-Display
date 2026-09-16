package companionapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimeconfig"
)

func TestProviderSignInOpensOnlyListedPages(t *testing.T) {
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
		t.Fatalf("expected the listed claude page to open once: body=%s opened=%v", rec.Body.String(), opened)
	}

	rec = httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/v1/providers/sign-in?provider=codex", nil))
	if rec.Code != http.StatusNotFound || len(opened) != 1 {
		t.Fatalf("a provider without a page must not open anything: status=%d opened=%v", rec.Code, opened)
	}

	rec = httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/v1/providers/sign-in?provider=claude", nil))
	if rec.Code == http.StatusOK || len(opened) != 1 {
		t.Fatalf("GET must not open a browser: status=%d opened=%v", rec.Code, opened)
	}
}
