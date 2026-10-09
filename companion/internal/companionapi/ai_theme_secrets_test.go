package companionapi

import (
	"errors"
	"net/http"
	"path"
	"strings"
	"testing"
)

func TestAIThemeKeepsOnlyAVerifiedKeyAcrossRestarts(t *testing.T) {
	durable := &memoryAIThemeSecrets{}
	accept := true
	start := func() *aiThemeServer {
		s := aiTestServer(t, aiRoundTrip(func(r *http.Request) (*http.Response, error) {
			if !accept {
				return aiResponse(401, `{"error":{"code":"invalid_api_key","message":"no"}}`), nil
			}
			return aiResponse(200, `{"id":"`+path.Base(r.URL.Path)+`"}`), nil
		}))
		s.aiTheme.rememberAcross(durable)
		return s
	}
	ready := func(s *aiThemeServer) bool {
		return strings.Contains(aiCall(s, "GET", "/v1/ai-theme/capabilities", "").Body.String(), `"configured":true,"id":"openai","verificationRequired":false`)
	}

	s := start()
	aiCall(s, "PUT", "/v1/ai-theme/providers/openai/credential", `{"apiKey":"fixture-key-first-one"}`)
	if _, err := durable.Get("openai"); err == nil {
		t.Fatal("an unverified key was kept")
	}
	if w := aiCall(s, "POST", "/v1/ai-theme/providers/openai/verify", ""); w.Code != 200 {
		t.Fatalf("verify: %s", w.Body.String())
	}
	if key, _ := durable.Get("openai"); key != "fixture-key-first-one" || !ready(start()) {
		t.Fatal("the verified key did not survive a restart")
	}

	// A replacement that OpenAI rejects must not leave the old key behind.
	s, accept = start(), false
	aiCall(s, "PUT", "/v1/ai-theme/providers/openai/credential", `{"apiKey":"fixture-key-second-one"}`)
	aiCall(s, "POST", "/v1/ai-theme/providers/openai/verify", "")
	if _, err := durable.Get("openai"); err == nil || ready(start()) {
		t.Fatal("a replaced key was still kept")
	}

	accept = true
	s = start()
	aiCall(s, "PUT", "/v1/ai-theme/providers/openai/credential", `{"apiKey":"fixture-key-third-one"}`)
	aiCall(s, "POST", "/v1/ai-theme/providers/openai/verify", "")
	aiCall(s, "DELETE", "/v1/ai-theme/providers/openai/credential", "")
	if _, err := durable.Get("openai"); err == nil || ready(start()) {
		t.Fatal("a disconnected key was still kept")
	}
}

type stuckAIThemeSecrets struct{ memoryAIThemeSecrets }

func (*stuckAIThemeSecrets) Delete(string) error { return errors.New("locked") }

type readOnlyAIThemeSecrets struct{ memoryAIThemeSecrets }

func (*readOnlyAIThemeSecrets) Set(string, string) error { return errors.New("locked") }

func TestAIThemeSaysWhenAVerifiedKeyCouldNotBeKept(t *testing.T) {
	ok := aiRoundTrip(func(r *http.Request) (*http.Response, error) {
		return aiResponse(200, `{"id":"`+path.Base(r.URL.Path)+`"}`), nil
	})
	for name, tc := range map[string]struct {
		durable SecretStore
		want    string
	}{
		"kept":       {&memoryAIThemeSecrets{}, `"keptAcrossRestarts":true`},
		"not kept":   {&readOnlyAIThemeSecrets{}, `"keptAcrossRestarts":false`},
		"no keeping": {nil, `"keptAcrossRestarts":false`},
	} {
		s := aiTestServer(t, ok)
		s.aiTheme.rememberAcross(tc.durable)
		aiCall(s, "PUT", "/v1/ai-theme/providers/openai/credential", `{"apiKey":"fixture-key-first-one"}`)
		if w := aiCall(s, "POST", "/v1/ai-theme/providers/openai/verify", ""); w.Code != 200 || !strings.Contains(w.Body.String(), tc.want) {
			t.Fatalf("%s: %d %s", name, w.Code, w.Body.String())
		}
	}
}

func TestAIThemeDoesNotReportAKeyAsGoneThatItCouldNotRemove(t *testing.T) {
	durable := &stuckAIThemeSecrets{}
	_ = durable.Set("openai", "fixture-key-kept-one")
	s := aiTestServer(t, aiRoundTrip(func(r *http.Request) (*http.Response, error) { return aiResponse(200, `{}`), nil }))
	s.aiTheme.rememberAcross(durable)
	if w := aiCall(s, "DELETE", "/v1/ai-theme/providers/openai/credential", ""); w.Code == 200 {
		t.Fatal("disconnect reported success while the key is still kept")
	}
	if w := aiCall(s, "PUT", "/v1/ai-theme/providers/openai/credential", `{"apiKey":"fixture-key-new-one"}`); w.Code == 200 {
		t.Fatal("replacement accepted while the old key would come back")
	}
	if !strings.Contains(aiCall(s, "GET", "/v1/ai-theme/capabilities", "").Body.String(), `"configured":true`) {
		t.Fatal("the key that is still kept must stay visible as connected")
	}
}
