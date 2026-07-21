package companionapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

type memorySecretStore struct {
	mu     sync.Mutex
	values map[string]string
}

func newMemorySecretStore() *memorySecretStore {
	return &memorySecretStore{values: map[string]string{}}
}
func (s *memorySecretStore) Set(account, secret string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.values[account] = secret
	return nil
}
func (s *memorySecretStore) Get(account string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	v, ok := s.values[account]
	if !ok {
		return "", ErrSecretNotFound
	}
	return v, nil
}
func (s *memorySecretStore) Delete(account string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.values[account]; !ok {
		return ErrSecretNotFound
	}
	delete(s.values, account)
	return nil
}

type aiRoundTripFunc func(*http.Request) (*http.Response, error)

func (f aiRoundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func newAIThemeTestServer(t *testing.T, store SecretStore, transport http.RoundTripper) *Server {
	t.Helper()
	t.Setenv(aiThemeEnabledEnv, "1")
	client := &http.Client{Transport: transport, Timeout: time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	server, err := New(Options{Addr: DefaultAddr, Home: t.TempDir(), AIThemeSecretStore: store, AIThemeHTTPClient: client})
	if err != nil {
		t.Fatal(err)
	}
	return server
}

func aiRequest(method, path, body string) *http.Request {
	req := httptest.NewRequest(method, "http://127.0.0.1:47832"+path, strings.NewReader(body))
	req.Host = "127.0.0.1:47832"
	req.Header.Set("Origin", "http://127.0.0.1:47832")
	req.Header.Set("Content-Type", "application/json")
	return req
}

func TestAIThemeCredentialLifecycleDoesNotReturnSecret(t *testing.T) {
	store := newMemorySecretStore()
	server := newAIThemeTestServer(t, store, aiRoundTripFunc(func(r *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{}`)), Header: make(http.Header), Request: r}, nil
	}))
	put := httptest.NewRecorder()
	server.Handler().ServeHTTP(put, aiRequest(http.MethodPut, "/v1/ai-theme/providers/openai/credential", `{"apiKey":"sk-test-12345678901234567890"}`))
	if put.Code != 200 {
		t.Fatalf("put=%d %s", put.Code, put.Body.String())
	}
	if strings.Contains(put.Body.String(), "sk-test") {
		t.Fatal("credential leaked in response")
	}
	cap := httptest.NewRecorder()
	server.Handler().ServeHTTP(cap, aiRequest(http.MethodGet, "/v1/ai-theme/capabilities", ""))
	if !strings.Contains(cap.Body.String(), `"configured":true`) {
		t.Fatalf("capabilities=%s", cap.Body.String())
	}
	del := httptest.NewRecorder()
	server.Handler().ServeHTTP(del, aiRequest(http.MethodDelete, "/v1/ai-theme/providers/openai/credential", ""))
	if del.Code != 200 {
		t.Fatalf("delete=%d %s", del.Code, del.Body.String())
	}
}

func TestAIThemeGuardRejectsRemoteHostAndOrigin(t *testing.T) {
	server := newAIThemeTestServer(t, newMemorySecretStore(), aiRoundTripFunc(func(*http.Request) (*http.Response, error) { return nil, errors.New("unused") }))
	for _, tc := range []struct{ host, origin string }{{"example.com", "https://app.vibetv.shop"}, {"127.0.0.1:47832", "https://evil.example"}, {"127.0.0.1:47832", defaultDevOrigin}} {
		req := httptest.NewRequest(http.MethodGet, "http://"+tc.host+"/v1/ai-theme/capabilities", nil)
		req.Host = tc.host
		req.Header.Set("Origin", tc.origin)
		w := httptest.NewRecorder()
		server.Handler().ServeHTTP(w, req)
		if w.Code != http.StatusForbidden {
			t.Fatalf("host=%s origin=%s got %d", tc.host, tc.origin, w.Code)
		}
	}
}

func TestAIThemeIsDisabledByDefault(t *testing.T) {
	t.Setenv(aiThemeEnabledEnv, "")
	server, err := New(Options{Addr: DefaultAddr, Home: t.TempDir(), AIThemeSecretStore: newMemorySecretStore()})
	if err != nil {
		t.Fatal(err)
	}
	capabilities := httptest.NewRecorder()
	server.Handler().ServeHTTP(capabilities, aiRequest(http.MethodGet, "/v1/ai-theme/capabilities", ""))
	if capabilities.Code != http.StatusOK || !strings.Contains(capabilities.Body.String(), `"enabled":false`) {
		t.Fatalf("capabilities=%d %s", capabilities.Code, capabilities.Body.String())
	}
	generation := httptest.NewRecorder()
	server.Handler().ServeHTTP(generation, aiRequest(http.MethodPost, "/v1/ai-theme/generations", `{}`))
	if generation.Code != http.StatusNotFound || !strings.Contains(generation.Body.String(), "feature_disabled") {
		t.Fatalf("generation=%d %s", generation.Code, generation.Body.String())
	}
}

func TestAIThemeGenerationUsesFixedOpenAIEndpointAndRepairsOnce(t *testing.T) {
	store := newMemorySecretStore()
	_ = store.Set("openai", "sk-test-12345678901234567890")
	valid := `{"packName":"Cat","spec":{"themeSpecVersion":1,"themeId":"cat-pixels","themeRev":1,"primitives":[{"type":"rect","x":10,"y":10,"width":8,"height":8,"color":"#FFFFFF"}]},"notes":"Pixel cat"}`
	invalid := `{"packName":"Bad","spec":{"themeSpecVersion":1,"themeId":"bad","themeRev":1,"primitives":[{"type":"rect","x":239,"y":0,"width":20,"height":20}]},"notes":"bad"}`
	var calls int
	var expected aiThemeCandidate
	if err := json.Unmarshal([]byte(valid), &expected); err != nil {
		t.Fatal(err)
	}
	if err := validateAIThemeCandidate(expected, aiThemeGenerationRequest{Mode: "create"}); err != nil {
		t.Fatalf("valid fixture rejected: %v", err)
	}
	server := newAIThemeTestServer(t, store, aiRoundTripFunc(func(r *http.Request) (*http.Response, error) {
		calls++
		if r.URL.String() != openAIEndpoint {
			t.Errorf("unexpected endpoint %s", r.URL)
		}
		if r.Header.Get("Authorization") != "Bearer sk-test-12345678901234567890" {
			t.Error("missing auth")
		}
		body, _ := io.ReadAll(r.Body)
		if bytes.Contains(body, []byte("sk-test")) {
			t.Error("key leaked into JSON body")
		}
		text := invalid
		if calls == 2 {
			text = valid
		}
		payload, _ := json.Marshal(map[string]any{
			"output": []any{map[string]any{
				"content": []any{map[string]any{"type": "output_text", "text": text}},
			}},
		})
		return &http.Response{StatusCode: 200, Body: io.NopCloser(bytes.NewReader(payload)), Header: make(http.Header), Request: r}, nil
	}))
	w := httptest.NewRecorder()
	server.Handler().ServeHTTP(w, aiRequest(http.MethodPost, "/v1/ai-theme/generations", `{"providerId":"openai","mode":"create","prompt":"Eine Pixelkatze"}`))
	if w.Code != 200 {
		t.Fatalf("generation=%d %s", w.Code, w.Body.String())
	}
	if calls != 2 {
		t.Fatalf("expected one repair, calls=%d", calls)
	}
	if !strings.Contains(w.Body.String(), `"packName":"Cat"`) {
		t.Fatalf("candidate=%s", w.Body.String())
	}
}

func TestAIThemeRateLimitAndCancellation(t *testing.T) {
	state := newAIThemeState(newMemorySecretStore(), &http.Client{})
	now := time.Unix(1000, 0)
	state.now = func() time.Time { return now }
	for i := 0; i < aiThemeRateLimit; i++ {
		if !state.beginGeneration() {
			t.Fatalf("request %d rejected", i)
		}
		state.endGeneration()
	}
	if state.beginGeneration() {
		t.Fatal("sixth request must be limited")
	}
	now = now.Add(aiThemeRateWindow + time.Second)
	if !state.beginGeneration() {
		t.Fatal("window did not reset")
	}
	state.endGeneration()
	if got := providerErrorCode(context.Canceled, 0); got != "provider_timeout" {
		t.Fatalf("cancel code=%s", got)
	}
}

func TestAIThemeProviderErrorsAreRedacted(t *testing.T) {
	secret := "sk-secret-value-that-must-not-leak"
	store := newMemorySecretStore()
	_ = store.Set("anthropic", secret)
	server := newAIThemeTestServer(t, store, aiRoundTripFunc(func(r *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 401, Body: io.NopCloser(strings.NewReader(`{"error":"` + secret + `"}`)), Header: make(http.Header), Request: r}, nil
	}))
	w := httptest.NewRecorder()
	server.Handler().ServeHTTP(w, aiRequest(http.MethodPost, "/v1/ai-theme/providers/anthropic/verify", ""))
	if w.Code != 401 {
		t.Fatalf("status=%d", w.Code)
	}
	if strings.Contains(w.Body.String(), secret) {
		t.Fatal("secret leaked")
	}
	if !strings.Contains(w.Body.String(), "provider_auth_failed") {
		t.Fatalf("body=%s", w.Body.String())
	}
}

func TestAIThemeAnthropicGenerationUsesMessagesAndStrictFormat(t *testing.T) {
	store := newMemorySecretStore()
	_ = store.Set("anthropic", "anthropic-test-123456789012345")
	candidate := `{"packName":"Finance","spec":{"themeSpecVersion":1,"themeId":"ai-finance","themeRev":1,"bgColor":"#071A2B","primitives":[{"type":"progress","x":16,"y":96,"width":208,"height":18,"binding":"session","color":"#54D2D2","bgColor":"#163A55","borderColor":"#54D2D2","borderRadius":2}]},"notes":"Finance"}`
	server := newAIThemeTestServer(t, store, aiRoundTripFunc(func(r *http.Request) (*http.Response, error) {
		if r.URL.String() != anthropicEndpoint {
			t.Errorf("endpoint=%s", r.URL)
		}
		if r.Header.Get("x-api-key") == "" {
			t.Error("missing Anthropic key")
		}
		body, _ := io.ReadAll(r.Body)
		if !bytes.Contains(body, []byte(`"output_config"`)) || !bytes.Contains(body, []byte(`"json_schema"`)) {
			t.Errorf("missing strict format: %s", body)
		}
		payload, _ := json.Marshal(map[string]any{"content": []any{map[string]any{"type": "text", "text": candidate}}})
		return &http.Response{StatusCode: 200, Body: io.NopCloser(bytes.NewReader(payload)), Header: make(http.Header), Request: r}, nil
	}))
	w := httptest.NewRecorder()
	server.Handler().ServeHTTP(w, aiRequest(http.MethodPost, "/v1/ai-theme/generations", `{"providerId":"anthropic","mode":"create","prompt":"finance"}`))
	if w.Code != http.StatusOK {
		t.Fatalf("generation=%d %s", w.Code, w.Body.String())
	}
}
