package companionapi

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestAIThemeStructuredRetriesOnlyTokenTruncationOnce(t *testing.T) {
	for _, reason := range []string{"max_output_tokens", "content_filter", "malformed"} {
		t.Run(reason, func(t *testing.T) {
			calls := 0
			s := aiTestServer(t, aiRoundTrip(func(r *http.Request) (*http.Response, error) {
				calls++
				if r.URL.Path != "/v1/responses" {
					t.Fatal("text repair generated an image")
				}
				body, _ := io.ReadAll(r.Body)
				var request map[string]any
				_ = json.Unmarshal(body, &request)
				if request["max_output_tokens"] != float64(int(aiThemeOutputTokens)<<(calls-1)) {
					t.Fatal("wrong bounded output budget")
				}
				if calls == 1 {
					if reason == "malformed" {
						return aiResponse(200, "{"), nil
					}
					return aiResponse(200, `{"status":"incomplete","incomplete_details":{"reason":"`+reason+`"},"output":[]}`), nil
				}
				return autoTextResponse(map[string]any{"accepted": true}), nil
			}))
			_, err := s.aiTheme.structuredAIReply(context.Background(), "fixture-key", "Review", []any{aiText("same frames")}, aiObjectSchema(map[string]any{}), "fixture")
			if reason == "max_output_tokens" {
				if err != nil || calls != 2 {
					t.Fatal(calls, err)
				}
			} else if err == nil || calls != 1 {
				t.Fatal("retried a non-truncation failure", calls, err)
			}
		})
	}
}

func TestAIThemeStructuredTokenRepairIsBoundedAndDiagnosed(t *testing.T) {
	calls := 0
	s := aiTestServer(t, aiRoundTrip(func(r *http.Request) (*http.Response, error) {
		calls++
		return aiResponse(200, `{"status":"incomplete","incomplete_details":{"reason":"max_output_tokens"},"output":[]}`), nil
	}))
	_, err := s.aiTheme.structuredAIReply(context.Background(), "fixture-key", "Review", nil, aiObjectSchema(map[string]any{}), "fixture")
	if calls != 2 || err == nil {
		t.Fatal("unbounded repair")
	}
	diagnostic, ok := err.(*aiThemeDiagnosticError)
	if !ok || !strings.Contains(diagnostic.Reason, "max_output_tokens") {
		t.Fatal("lost truncation diagnostic")
	}
}
