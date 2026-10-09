package companionapi

import (
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
