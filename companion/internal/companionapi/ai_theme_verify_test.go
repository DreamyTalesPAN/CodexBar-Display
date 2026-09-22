package companionapi

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

func TestAIThemeVerificationRetainsProviderDiagnosis(t *testing.T) {
	for _, tc := range []struct {
		status             int
		providerCode, code string
	}{
		{404, "model_not_found", "provider_model_unavailable"},
		{403, "permission_denied", "provider_permission_denied"},
		{401, "invalid_api_key", "provider_auth_failed"},
		{429, "insufficient_quota", "provider_quota_exhausted"},
		{429, "rate_limit_exceeded", "provider_rate_limited"},
		{500, "server_error", "provider_unavailable"},
	} {
		t.Run(tc.providerCode, func(t *testing.T) {
			const key = "fixture-key-never-show"
			calls := 0
			s := aiTestServer(t, aiRoundTrip(func(r *http.Request) (*http.Response, error) {
				calls++
				if r.Method != "GET" || r.URL.Path != "/v1/models/gpt-image-2" {
					t.Fatal("unexpected paid call or model")
				}
				body, _ := json.Marshal(map[string]any{"error": map[string]string{"code": tc.providerCode, "message": "Useful reason " + key + " sk-proj-other-secret\n\u202e" + strings.Repeat("x", 500)}})
				resp := aiResponse(tc.status, string(body))
				resp.Header.Set("X-Request-Id", "req_test123")
				return resp, nil
			}))
			aiCall(s, "PUT", "/v1/ai-theme/providers/openai/credential", `{"apiKey":"`+key+`"}`)
			w := aiCall(s, "POST", "/v1/ai-theme/providers/openai/verify", "")
			var got struct {
				Error struct {
					Code, Stage, Reason, ProviderCode, RequestID, Model string
					ProviderStatus                                      int
				}
			}
			_ = json.Unmarshal(w.Body.Bytes(), &got)
			if w.Code < 400 || got.Error.Code != tc.code || got.Error.Stage != "connection" || got.Error.ProviderStatus != tc.status || got.Error.ProviderCode != tc.providerCode || got.Error.RequestID != "req_test123" || got.Error.Model != "gpt-image-2" || !strings.Contains(got.Error.Reason, "Useful reason") {
				t.Fatalf("lost diagnosis: %s", w.Body.String())
			}
			if calls != 1 || strings.Contains(w.Body.String(), key) || strings.Contains(w.Body.String(), "sk-proj-other-secret") || strings.Contains(got.Error.Reason, "\u202e") || len([]rune(got.Error.Reason)) > 300 {
				t.Fatal("unsafe diagnostic or automatic retry")
			}
			cap := aiCall(s, "GET", "/v1/ai-theme/capabilities", "")
			if !strings.Contains(cap.Body.String(), `"verificationRequired":true`) {
				t.Fatal("saved key became ready after failure")
			}
		})
	}
}

func TestAIThemeVerificationReadinessAndMalformedResponses(t *testing.T) {
	for _, body := range []string{`{"id":"gpt-image-2"}`, `{}`, `<html>gateway</html>`} {
		t.Run(body, func(t *testing.T) {
			s := aiTestServer(t, aiRoundTrip(func(r *http.Request) (*http.Response, error) { return aiResponse(200, body), nil }))
			aiCall(s, "PUT", "/v1/ai-theme/providers/openai/credential", `{"apiKey":"fixture-key-first"}`)
			w := aiCall(s, "POST", "/v1/ai-theme/providers/openai/verify", "")
			valid := strings.Contains(body, `"id"`)
			if (w.Code == 200) != valid {
				t.Fatalf("wrong verification result: %s", w.Body.String())
			}
			cap := aiCall(s, "GET", "/v1/ai-theme/capabilities", "").Body.String()
			if strings.Contains(cap, `"verificationRequired":true`) == valid {
				t.Fatal("readiness does not match verification")
			}
			aiCall(s, "PUT", "/v1/ai-theme/providers/openai/credential", `{"apiKey":"fixture-key-replacement"}`)
			if !strings.Contains(aiCall(s, "GET", "/v1/ai-theme/capabilities", "").Body.String(), `"verificationRequired":true`) {
				t.Fatal("replacement inherited verification")
			}
		})
	}
}

func TestAIThemeVerificationRequiredBeforePaidGeneration(t *testing.T) {
	calls := 0
	s := aiTestServer(t, aiRoundTrip(func(r *http.Request) (*http.Response, error) { calls++; return aiResponse(500, `{}`), nil }))
	aiCall(s, "PUT", "/v1/ai-theme/providers/openai/credential", `{"apiKey":"fixture-unverified-key"}`)
	w := aiCall(s, "POST", "/v1/ai-theme/concepts", `{"prompt":"An office","target":"auto"}`)
	if w.Code != 400 || !strings.Contains(w.Body.String(), "credential_verification_required") || calls != 0 {
		t.Fatal("unverified credential started paid generation")
	}
}

func TestAIThemeVerificationDoesNotVerifyReplacementKey(t *testing.T) {
	var s *aiThemeServer
	s = aiTestServer(t, aiRoundTrip(func(r *http.Request) (*http.Response, error) {
		aiCall(s, "PUT", "/v1/ai-theme/providers/openai/credential", `{"apiKey":"fixture-replacement-key"}`)
		return aiResponse(200, `{"id":"gpt-image-2"}`), nil
	}))
	aiCall(s, "PUT", "/v1/ai-theme/providers/openai/credential", `{"apiKey":"fixture-original-key"}`)
	w := aiCall(s, "POST", "/v1/ai-theme/providers/openai/verify", "")
	if w.Code != 409 || !strings.Contains(aiCall(s, "GET", "/v1/ai-theme/capabilities", "").Body.String(), `"verificationRequired":true`) {
		t.Fatal("stale verification authorized a replacement key")
	}
}
