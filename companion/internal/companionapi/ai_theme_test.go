package companionapi

import (
	"bytes"
	"context"
	"encoding/base64"
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
	value, ok := s.values[account]
	if !ok {
		return "", ErrSecretNotFound
	}
	return value, nil
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
	server, err := New(Options{Addr: DefaultAddr, Home: t.TempDir(), AIThemeSecretStore: store, AIThemeHTTPClient: &http.Client{Transport: transport}})
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

func validAIStyleJSON() string {
	return `{"packName":"Moon Cat","title":"CAT MODE","notes":"Warm moonlit cat.","artPrompt":"A large orange pixel cat beneath a cream moon on deep navy.","animationMode":"static","animationPrompt":"","backgroundColor":"#081426","panelColor":"#101F36","textColor":"#FFF3CF","sessionColor":"#F6B85F","weeklyColor":"#EF6A8A","progressStyle":"segments","borderRadius":3}`
}

func animatedAIStyleJSON() string {
	return `{"packName":"Moon Cat","title":"CAT MODE","notes":"Warm moonlit cat.","artPrompt":"A large orange pixel cat.","animationMode":"four_frame","animationPrompt":"The cat gently swishes its tail and blinks once.","backgroundColor":"#081426","panelColor":"#101F36","textColor":"#FFF3CF","sessionColor":"#F6B85F","weeklyColor":"#EF6A8A","progressStyle":"segments","borderRadius":3}`
}

func tinyPNGBase64() string {
	return base64.StdEncoding.EncodeToString([]byte{137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0})
}

func response(status int, body []byte, request *http.Request) *http.Response {
	return &http.Response{StatusCode: status, Body: io.NopCloser(bytes.NewReader(body)), Header: make(http.Header), Request: request}
}

func TestAIThemeCredentialLifecycleAndCapabilitiesAreOpenAIOnly(t *testing.T) {
	store := newMemorySecretStore()
	server := newAIThemeTestServer(t, store, aiRoundTripFunc(func(r *http.Request) (*http.Response, error) { return response(200, []byte(`{}`), r), nil }))
	put := httptest.NewRecorder()
	server.Handler().ServeHTTP(put, aiRequest(http.MethodPut, "/v1/ai-theme/providers/openai/credential", `{"apiKey":"sk-test-12345678901234567890"}`))
	if put.Code != 200 || strings.Contains(put.Body.String(), "sk-test") {
		t.Fatalf("put=%d %s", put.Code, put.Body.String())
	}
	capabilities := httptest.NewRecorder()
	server.Handler().ServeHTTP(capabilities, aiRequest(http.MethodGet, "/v1/ai-theme/capabilities", ""))
	if !strings.Contains(capabilities.Body.String(), `"id":"openai"`) || strings.Contains(capabilities.Body.String(), "anthropic") {
		t.Fatalf("capabilities=%s", capabilities.Body.String())
	}
	verify := httptest.NewRecorder()
	server.Handler().ServeHTTP(verify, aiRequest(http.MethodPost, "/v1/ai-theme/providers/openai/verify", ""))
	if verify.Code != 200 {
		t.Fatalf("verify=%d %s", verify.Code, verify.Body.String())
	}
	deleteRecorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(deleteRecorder, aiRequest(http.MethodDelete, "/v1/ai-theme/providers/openai/credential", ""))
	if deleteRecorder.Code != 200 {
		t.Fatalf("delete=%d", deleteRecorder.Code)
	}
}

func TestAIThemeGuardAndDisabledDefault(t *testing.T) {
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
	t.Setenv(aiThemeEnabledEnv, "")
	disabled, err := New(Options{Addr: DefaultAddr, Home: t.TempDir(), AIThemeSecretStore: newMemorySecretStore()})
	if err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	disabled.Handler().ServeHTTP(w, aiRequest(http.MethodPost, "/v1/ai-theme/concepts", `{}`))
	if w.Code != http.StatusNotFound || !strings.Contains(w.Body.String(), "feature_disabled") {
		t.Fatalf("disabled=%d %s", w.Code, w.Body.String())
	}
}

func TestAIThemeConceptUsesFixedPlannerAndImageModels(t *testing.T) {
	store := newMemorySecretStore()
	secret := "sk-test-12345678901234567890"
	_ = store.Set("openai", secret)
	var calls int
	server := newAIThemeTestServer(t, store, aiRoundTripFunc(func(r *http.Request) (*http.Response, error) {
		calls++
		if r.Header.Get("Authorization") != "Bearer "+secret {
			t.Error("missing auth")
		}
		body, _ := io.ReadAll(r.Body)
		if bytes.Contains(body, []byte(secret)) {
			t.Error("secret leaked into request body")
		}
		if calls == 1 {
			if r.URL.String() != openAIEndpoint || !bytes.Contains(body, []byte(openAIModel)) || !bytes.Contains(body, []byte(`"strict":true`)) {
				t.Fatalf("planner request url=%s body=%s", r.URL, body)
			}
			payload, _ := json.Marshal(map[string]any{"output": []any{map[string]any{"content": []any{map[string]any{"type": "output_text", "text": validAIStyleJSON()}}}}})
			return response(200, payload, r), nil
		}
		if r.URL.String() != openAIImageEndpoint || !bytes.Contains(body, []byte(openAIImageModel)) || !bytes.Contains(body, []byte(`"size":"1200x640"`)) || bytes.Contains(body, []byte(`"size":"1920x1024"`)) || !bytes.Contains(body, []byte(`"quality":"low"`)) || bytes.Contains(body, []byte(`"quality":"high"`)) {
			t.Fatalf("image request url=%s body=%s", r.URL, body)
		}
		payload, _ := json.Marshal(map[string]any{"data": []any{map[string]any{"b64_json": tinyPNGBase64()}}})
		return response(200, payload, r), nil
	}))
	w := httptest.NewRecorder()
	server.Handler().ServeHTTP(w, aiRequest(http.MethodPost, "/v1/ai-theme/concepts", `{"prompt":"A premium cat theme","history":[{"role":"user","content":"warm colors"}]}`))
	if w.Code != 200 || calls != 2 || !strings.Contains(w.Body.String(), `"imageContentType":"image/png"`) {
		t.Fatalf("concept=%d calls=%d %s", w.Code, calls, w.Body.String())
	}
}

func TestAIThemeAnimationCreatesStaticBackgroundAndFourFrameSprite(t *testing.T) {
	store := newMemorySecretStore()
	_ = store.Set("openai", "sk-test-12345678901234567890")
	var mu sync.Mutex
	calls := 0
	generations := 0
	edits := 0
	backgrounds := 0
	keyedSheets := 0
	server := newAIThemeTestServer(t, store, aiRoundTripFunc(func(r *http.Request) (*http.Response, error) {
		mu.Lock()
		calls++
		call := calls
		if r.URL.String() == openAIImageEndpoint {
			generations++
		}
		if r.URL.String() == openAIImageEditEndpoint {
			edits++
		}
		mu.Unlock()
		if call == 1 {
			payload, _ := json.Marshal(map[string]any{"output": []any{map[string]any{"content": []any{map[string]any{"type": "output_text", "text": animatedAIStyleJSON()}}}}})
			return response(200, payload, r), nil
		}
		body, _ := io.ReadAll(r.Body)
		mu.Lock()
		if bytes.Contains(body, []byte("complete static background illustration")) {
			backgrounds++
		}
		if bytes.Contains(body, []byte("#FF00FF")) {
			keyedSheets++
		}
		mu.Unlock()
		payload, _ := json.Marshal(map[string]any{"data": []any{map[string]any{"b64_json": tinyPNGBase64()}}})
		return response(200, payload, r), nil
	}))
	w := httptest.NewRecorder()
	server.Handler().ServeHTTP(w, aiRequest(http.MethodPost, "/v1/ai-theme/concepts", `{"prompt":"Animate the cat as a four-frame sprite"}`))
	mu.Lock()
	defer mu.Unlock()
	if w.Code != http.StatusOK || calls != 3 || generations != 2 || edits != 0 || backgrounds != 1 || keyedSheets != 1 {
		t.Fatalf("animation=%d calls=%d generations=%d edits=%d backgrounds=%d keyed=%d body=%s", w.Code, calls, generations, edits, backgrounds, keyedSheets, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), `"fps":4`) || !strings.Contains(w.Body.String(), `"spriteSheetBase64"`) || strings.Count(w.Body.String(), tinyPNGBase64()) != 2 {
		t.Fatalf("animation response=%s", w.Body.String())
	}
}

func TestAIThemeConceptEditUsesPreviousPNGWithoutLoggingIt(t *testing.T) {
	store := newMemorySecretStore()
	_ = store.Set("openai", "sk-test-12345678901234567890")
	var editBody []byte
	var contentType string
	calls := 0
	server := newAIThemeTestServer(t, store, aiRoundTripFunc(func(r *http.Request) (*http.Response, error) {
		calls++
		if calls == 1 {
			payload, _ := json.Marshal(map[string]any{"output": []any{map[string]any{"content": []any{map[string]any{"type": "output_text", "text": validAIStyleJSON()}}}}})
			return response(200, payload, r), nil
		}
		if r.URL.String() != openAIImageEditEndpoint {
			t.Fatalf("edit url=%s", r.URL)
		}
		contentType = r.Header.Get("Content-Type")
		editBody, _ = io.ReadAll(r.Body)
		payload, _ := json.Marshal(map[string]any{"data": []any{map[string]any{"b64_json": tinyPNGBase64()}}})
		return response(200, payload, r), nil
	}))
	request := map[string]any{"prompt": "Make it warmer", "previous": map[string]any{"imageBase64": tinyPNGBase64(), "imageContentType": "image/png", "style": json.RawMessage(validAIStyleJSON())}}
	body, _ := json.Marshal(request)
	w := httptest.NewRecorder()
	server.Handler().ServeHTTP(w, aiRequest(http.MethodPost, "/v1/ai-theme/concepts", string(body)))
	if w.Code != 200 || !strings.HasPrefix(contentType, "multipart/form-data;") || !bytes.Contains(editBody, []byte(`filename="previous.png"`)) || !bytes.Contains(editBody, []byte("Content-Type: image/png")) || !bytes.Contains(editBody, []byte(openAIImageModel)) || !bytes.Contains(editBody, []byte(`name="size"`)) || !bytes.Contains(editBody, []byte("\r\n\r\n1200x640\r\n")) || bytes.Contains(editBody, []byte("\r\n\r\n1920x1024\r\n")) || !bytes.Contains(editBody, []byte(`name="quality"`)) || !bytes.Contains(editBody, []byte("\r\n\r\nlow\r\n")) || bytes.Contains(editBody, []byte("\r\n\r\nhigh\r\n")) || !bytes.Contains(editBody, []byte("clearly readable defining features")) || bytes.Contains(editBody, []byte("recognizable silhouette")) {
		t.Fatalf("edit=%d content-type=%s", w.Code, contentType)
	}
}

func TestAIThemeRefinePrioritizesExplicitVisualRequests(t *testing.T) {
	var style aiThemeStyle
	if err := json.Unmarshal([]byte(validAIStyleJSON()), &style); err != nil {
		t.Fatal(err)
	}
	prompt := buildAIThemePlanningPrompt(aiThemeConceptRequest{
		Prompt:   "Show the cat's face clearly instead of a silhouette.",
		Previous: &aiThemePreviousConcept{Style: style},
	}, "")
	for _, required := range []string{"latest user request has priority", "subject visibility", "detail level", "Preserve the existing animation mode", "Show the cat's face clearly instead of a silhouette."} {
		if !strings.Contains(prompt, required) {
			t.Fatalf("refine prompt missing %q: %s", required, prompt)
		}
	}
}

func TestAIThemeConceptEditAcceptsHardwareImageRequestOverOneMiB(t *testing.T) {
	store := newMemorySecretStore()
	_ = store.Set("openai", "sk-test-12345678901234567890")
	calls := 0
	server := newAIThemeTestServer(t, store, aiRoundTripFunc(func(r *http.Request) (*http.Response, error) {
		calls++
		if calls == 1 {
			payload, _ := json.Marshal(map[string]any{"output": []any{map[string]any{"content": []any{map[string]any{"type": "output_text", "text": validAIStyleJSON()}}}}})
			return response(200, payload, r), nil
		}
		payload, _ := json.Marshal(map[string]any{"data": []any{map[string]any{"b64_json": tinyPNGBase64()}}})
		return response(200, payload, r), nil
	}))
	largePNG := make([]byte, 900<<10)
	copy(largePNG, []byte{137, 80, 78, 71, 13, 10, 26, 10})
	request := map[string]any{"prompt": "Make the cat larger", "previous": map[string]any{"imageBase64": base64.StdEncoding.EncodeToString(largePNG), "imageContentType": "image/png", "style": json.RawMessage(validAIStyleJSON())}}
	body, _ := json.Marshal(request)
	if len(body) <= 1<<20 || len(body) >= aiThemeConceptRequestLimit {
		t.Fatalf("test request size=%d", len(body))
	}
	w := httptest.NewRecorder()
	server.Handler().ServeHTTP(w, aiRequest(http.MethodPost, "/v1/ai-theme/concepts", string(body)))
	if w.Code != http.StatusOK || calls != 2 {
		t.Fatalf("edit=%d calls=%d body=%s", w.Code, calls, w.Body.String())
	}
}

func TestAIThemeRejectsOversizedAndUnavailableImages(t *testing.T) {
	if _, err := validateConceptImage(base64.StdEncoding.EncodeToString(make([]byte, aiThemeImageResponseLimit+1)), "image/png"); err == nil {
		t.Fatal("oversized image accepted")
	}
	if got := providerErrorCode(errors.New("image_provider_status_403"), 0); got != "image_generation_unavailable" {
		t.Fatalf("code=%s", got)
	}
	if got := providerErrorCode(context.DeadlineExceeded, 0); got != "provider_timeout" {
		t.Fatalf("timeout=%s", got)
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
	_ = store.Set("openai", secret)
	server := newAIThemeTestServer(t, store, aiRoundTripFunc(func(r *http.Request) (*http.Response, error) {
		return response(401, []byte(`{"error":"`+secret+`"}`), r), nil
	}))
	w := httptest.NewRecorder()
	server.Handler().ServeHTTP(w, aiRequest(http.MethodPost, "/v1/ai-theme/providers/openai/verify", ""))
	if w.Code != 401 || strings.Contains(w.Body.String(), secret) || !strings.Contains(w.Body.String(), "provider_auth_failed") {
		t.Fatalf("body=%s", w.Body.String())
	}
}
