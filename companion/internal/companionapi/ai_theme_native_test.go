package companionapi

import (
	"net/http"
	"net/http/httptest"
	"path"
	"strings"
	"testing"
)

// Exercise the production Handler, not the separate browser-preview service.
func TestNativeThemeStudioCredentialAndGeneration(t *testing.T) {
	t.Setenv(aiThemeEnabledEnv, "")
	server, err := New(Options{Home: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	calls := 0
	server.aiThemeServer.aiTheme.client = &http.Client{Transport: aiRoundTrip(func(r *http.Request) (*http.Response, error) {
		calls++
		if r.Header.Get("Authorization") != "Bearer fixture-key-not-a-secret" {
			t.Fatal("missing native credential")
		}
		if r.Method == http.MethodGet {
			return aiResponse(200, `{"id":"`+path.Base(r.URL.Path)+`"}`), nil
		}
		return autoTextResponse(map[string]any{"mode": "layout", "notes": "Updated", "edits": []any{}}), nil
	})}
	handler := server.Handler()
	call := func(method, path, body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, "http://127.0.0.1:47832"+path, strings.NewReader(body))
		r.Header.Set("Origin", "http://127.0.0.1:47832")
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	for _, step := range []struct{ method, path, body string }{
		{"GET", "/v1/ai-theme/capabilities", ""},
		{"PUT", "/v1/ai-theme/providers/openai/credential", `{"apiKey":"fixture-key-not-a-secret"}`},
		{"POST", "/v1/ai-theme/providers/openai/verify", `{}`},
		{"POST", "/v1/ai-theme/concepts", `{"prompt":"Make it blue","target":"layout","layout":[]}`},
	} {
		response := call(step.method, step.path, step.body)
		if response.Code != http.StatusOK {
			t.Fatalf("%s: %d %s", step.path, response.Code, response.Body.String())
		}
		if step.path == "/v1/ai-theme/capabilities" && !strings.Contains(response.Body.String(), `"enabled":true`) {
			t.Fatal("native AI disabled")
		}
	}
	if calls != 3 {
		t.Fatalf("provider calls = %d", calls)
	}
	r := httptest.NewRequest("GET", "http://127.0.0.1:47832/v1/ai-theme/capabilities", nil)
	r.Header.Set("Origin", "https://foreign.example")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	if w.Code != http.StatusForbidden {
		t.Fatal("foreign origin allowed")
	}
}
