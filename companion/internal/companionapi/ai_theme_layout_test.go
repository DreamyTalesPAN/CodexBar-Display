package companionapi

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestLayoutRouteNeverGeneratesImages(t *testing.T) {
	for _, prompt := range []string{"Kannst du bitte einen Reset-Timer machen?", "kannst du noch ein reset timer dazu machen", "Add a weekly reset countdown", "Make SESSION red", "Remove the timer"} {
		t.Run(prompt, func(t *testing.T) {
			calls := 0
			s := aiTestServer(t, aiRoundTrip(func(r *http.Request) (*http.Response, error) {
				calls++
				if r.URL.Path != "/v1/responses" {
					t.Fatal("Layout request called image generation")
				}
				raw, _ := io.ReadAll(r.Body)
				if !strings.Contains(string(raw), "vibetv_layout_edit") || !strings.Contains(string(raw), prompt) {
					t.Fatal("Missing native planner/prompt")
				}
				return autoTextResponse(map[string]any{"mode": "layout", "notes": "Countdown hinzugefügt", "edits": []any{map[string]any{"action": "add", "index": -1, "kind": "text", "x": 12, "y": 224, "reading": "usageSlot1Reset", "color": "#FFFFFF", "fontSize": 1}}}), nil
			}))
			_ = s.aiTheme.store.Set("openai", "fixture-secret")
			body, _ := json.Marshal(map[string]any{"prompt": prompt, "target": "layout", "layout": []any{map[string]any{"type": "sprite", "protected": true}}})
			resp := aiCall(s, "POST", "/v1/ai-theme/concepts", string(body))
			if resp.Code != 200 || calls != 1 || strings.Contains(resp.Body.String(), "imageBase64") || !strings.Contains(resp.Body.String(), "usageSlot1Reset") {
				t.Fatalf("%d %s calls=%d", resp.Code, resp.Body.String(), calls)
			}
		})
	}
}

func TestLayoutRejectsInvalidPlans(t *testing.T) {
	for _, edit := range []map[string]any{
		{"action": "remove", "index": 0},
		{"action": "update", "index": 99},
		{"action": "update", "index": 0.5},
		{"action": "add", "index": -1, "kind": "sprite"},
		{"action": "add", "index": -1, "kind": "text", "assetPath": "evil"},
		{"action": "execute", "index": 1},
	} {
		s := aiTestServer(t, aiRoundTrip(func(r *http.Request) (*http.Response, error) {
			return autoTextResponse(map[string]any{"mode": "layout", "notes": "test", "edits": []any{edit}}), nil
		}))
		_ = s.aiTheme.store.Set("openai", "fixture-secret")
		resp := aiCall(s, "POST", "/v1/ai-theme/concepts", `{"prompt":"Edit","target":"layout","layout":[{"type":"sprite","protected":true},{"type":"text"}]}`)
		if resp.Code == 200 {
			t.Fatalf("Accepted unsafe edit: %v", edit)
		}
	}
}

func TestLayoutSceneAndUnsupportedDoNotGenerateImages(t *testing.T) {
	for _, mode := range []string{"scene", "unsupported"} {
		calls := 0
		s := aiTestServer(t, aiRoundTrip(func(r *http.Request) (*http.Response, error) {
			calls++
			return autoTextResponse(map[string]any{"mode": mode, "notes": "Route or clarify", "edits": []any{}}), nil
		}))
		_ = s.aiTheme.store.Set("openai", "fixture-secret")
		resp := aiCall(s, "POST", "/v1/ai-theme/concepts", `{"prompt":"Change","target":"layout","layout":[]}`)
		if resp.Code != 200 || calls != 1 {
			t.Fatalf("Routing failed %s %d", resp.Body.String(), calls)
		}
	}
}

func TestLayoutTransformsCompanionWithoutImageGeneration(t *testing.T) {
	if !strings.Contains(aiLayoutCompanionInstructions, "at most two animated companions") || !strings.Contains(aiLayoutCompanionInstructions, "choose mode=unsupported, explain the two-companion limit") {
		t.Fatal("layout planner must refuse a third companion instead of routing to scene generation")
	}
	s := aiTestServer(t, aiRoundTrip(func(r *http.Request) (*http.Response, error) {
		if r.URL.Path != "/v1/responses" {
			t.Fatal("unexpected image call")
		}
		return autoTextResponse(map[string]any{"mode": "layout", "notes": "Larger cat", "edits": []any{map[string]any{"action": "update", "index": 0, "width": 60, "height": 60, "y": 60}}}), nil
	}))
	_ = s.aiTheme.store.Set("openai", "fixture-secret")
	resp := aiCall(s, "POST", "/v1/ai-theme/concepts", `{"prompt":"mach die kartze größer","target":"layout","layout":[{"type":"sprite","role":"companion","protected":false,"width":48,"height":48,"x":170,"y":72}]}`)
	if resp.Code != 200 {
		t.Fatal(resp.Code, resp.Body.String())
	}
}

func TestLayoutUsesBoundedCompanionPreviewsForIdentity(t *testing.T) {
	s := aiTestServer(t, aiRoundTrip(func(r *http.Request) (*http.Response, error) {
		body, _ := io.ReadAll(r.Body)
		if r.URL.Path != "/v1/responses" || !strings.Contains(string(body), `"type":"input_image"`) || !strings.Contains(string(body), "Current element 0 preview") {
			t.Fatal("Missing companion identity reference")
		}
		if strings.Count(string(body), aiTestPNG()) != 1 {
			t.Fatal("Image duplicated as text metadata")
		}
		return autoTextResponse(map[string]any{"mode": "layout", "notes": "Pause cat", "edits": []any{map[string]any{"action": "update", "index": 0, "fps": 0}}}), nil
	}))
	_ = s.aiTheme.store.Set("openai", "fixture-secret")
	body, _ := json.Marshal(map[string]any{"prompt": "Pause cat", "target": "layout", "layout": []any{map[string]any{"type": "sprite", "role": "companion", "protected": false, "referenceImageBase64": aiTestPNG()}}})
	resp := aiCall(s, "POST", "/v1/ai-theme/concepts", string(body))
	if resp.Code != 200 {
		t.Fatal(resp.Code, resp.Body.String())
	}
}

func TestLayoutRejectsInvalidIdentityReferencesBeforeProviderCall(t *testing.T) {
	for _, entries := range [][]any{
		{map[string]any{"type": "sprite", "role": "companion", "referenceImageBase64": "invalid"}},
		{map[string]any{"type": "sprite", "role": "companion", "referenceImageBase64": strings.Repeat("x", 65537)}},
		{map[string]any{"type": "text", "role": "ui", "referenceImageBase64": aiTestPNG()}},
		{map[string]any{"type": "sprite", "role": "companion", "referenceImageBase64": aiTestPNG()}, map[string]any{"type": "sprite", "role": "companion", "referenceImageBase64": aiTestPNG()}, map[string]any{"type": "sprite", "role": "companion", "referenceImageBase64": aiTestPNG()}},
	} {
		s := aiTestServer(t, aiRoundTrip(func(*http.Request) (*http.Response, error) {
			t.Fatal("invalid reference reached provider")
			return nil, nil
		}))
		_ = s.aiTheme.store.Set("openai", "fixture-secret")
		body, _ := json.Marshal(map[string]any{"prompt": "Edit", "target": "layout", "layout": entries})
		if resp := aiCall(s, "POST", "/v1/ai-theme/concepts", string(body)); resp.Code == 200 {
			t.Fatal("invalid reference accepted")
		}
	}
}
