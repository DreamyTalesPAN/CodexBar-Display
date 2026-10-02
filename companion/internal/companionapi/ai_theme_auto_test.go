package companionapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
)

func autoTextResponse(value any) *http.Response {
	encoded, _ := json.Marshal(value)
	response, _ := json.Marshal(map[string]any{"output": []any{map[string]any{"content": []any{map[string]any{"type": "output_text", "text": string(encoded)}}}}})
	return aiResponse(200, string(response))
}

func TestAIThemeDiagnosticsRetainStageAndProtectSecrets(t *testing.T) {
	for _, tc := range []struct {
		stage, code string
		status      int
	}{
		{"direction", "provider_timeout", 502},
		{"artwork", "image_generation_unavailable", 401},
		{"region", "provider_invalid_response", 502},
		{"frames", "provider_rate_limited", 429},
		{"infeasible", "animation_quality_failed", 502},
	} {
		t.Run(tc.stage, func(t *testing.T) {
			images := 0
			s := aiTestServer(t, aiRoundTrip(func(r *http.Request) (*http.Response, error) {
				raw, _ := io.ReadAll(r.Body)
				if r.URL.Path != "/v1/responses" {
					images++
					if tc.stage == "artwork" {
						return aiResponse(403, `{"error":"raw-secret-detail"}`), nil
					}
					if tc.stage == "frames" {
						return aiResponse(429, `{"error":"raw-secret-detail"}`), nil
					}
					return aiResponse(200, `{"data":[{"b64_json":"`+aiTestPNG()+`"}]}`), nil
				}
				if strings.Contains(string(raw), "vibetv_auto_direction") {
					if tc.stage == "direction" {
						return nil, context.DeadlineExceeded
					}
					style := aiTestStyle()
					style.AnimationMode, style.AnimationPrompt = "scene_loop", "Scroll code"
					style.PreserveArtwork = tc.stage != "artwork"
					return autoTextResponse(style), nil
				}
				if strings.Contains(string(raw), "vibetv_scene_region") {
					if tc.stage == "region" {
						return autoTextResponse("not an object"), nil
					}
					return autoTextResponse(aiSceneRegion{X: 20, Y: 20, Width: 32, Height: 32, Motion: "Scroll code", Feasible: tc.stage != "infeasible", Reason: "No suitable monitor. fixture-secret sk-test-other\n\u202e" + strings.Repeat("a", 400)}), nil
				}
				return autoTextResponse(map[string]any{"reason": "missing accepted verdict"}), nil
			}))
			_ = s.aiTheme.store.Set("openai", "fixture-secret")
			req, _ := json.Marshal(aiThemeConceptRequest{Target: "auto", Prompt: "Bring it to life", Previous: &aiThemePreviousConcept{ImageBase64: aiTestPNG(), ImageContentType: "image/png", Style: aiTestStyle()}})
			response := aiCall(s, "POST", "/v1/ai-theme/concepts", string(req))
			var payload struct {
				Error struct {
					Code, Stage, Reason string
					Assessment          bool
				}
			}
			_ = json.Unmarshal(response.Body.Bytes(), &payload)
			expectedStage := tc.stage
			if tc.stage == "infeasible" {
				expectedStage = "region"
			}
			if response.Code != tc.status || payload.Error.Code != tc.code || payload.Error.Stage != expectedStage {
				t.Fatalf("wrong diagnostics: %d %s", response.Code, response.Body.String())
			}
			for _, forbidden := range []string{"fixture-secret", "sk-test-other", "raw-secret-detail", "imageBase64", "\u202e"} {
				if strings.Contains(response.Body.String(), forbidden) {
					t.Fatal("unsafe detail escaped")
				}
			}
			if len([]rune(payload.Error.Reason)) > 300 {
				t.Fatal("unbounded reason")
			}
			if tc.stage == "infeasible" && (!payload.Error.Assessment || !strings.Contains(payload.Error.Reason, "No suitable monitor") || images != 0) {
				t.Fatal("lost assessment or generated despite infeasible region")
			}
		})
	}
	err := &aiThemeDiagnosticError{Cause: context.DeadlineExceeded, Stage: "frames"}
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatal("timeout identity lost")
	}
}

func TestAIThemeAutoDirectorOwnsRepresentationWithoutVisualReview(t *testing.T) {
	for _, mode := range []string{"static", "four_frame", "scene_loop"} {
		t.Run(mode, func(t *testing.T) {
			imageCalls, plans, regions := 0, 0, 0
			style := aiTestStyle()
			style.AnimationMode = mode
			style.PreserveArtwork = true
			if mode != "static" {
				style.AnimationPrompt = "A gentle meaningful movement"
			}
			s := aiTestServer(t, aiRoundTrip(func(r *http.Request) (*http.Response, error) {
				if r.URL.Path == "/v1/responses" {
					raw, _ := io.ReadAll(r.Body)
					if !strings.Contains(string(raw), `"store":false`) || !strings.Contains(string(raw), `"type":"input_image"`) {
						t.Fatal("missing private visual context")
					}
					switch {
					case strings.Contains(string(raw), `"name":"vibetv_auto_direction"`):
						plans++
						return autoTextResponse(style), nil
					case strings.Contains(string(raw), `"name":"vibetv_scene_region"`):
						regions++
						return autoTextResponse(aiSceneRegion{X: 24, Y: 20, Width: 32, Height: 32, Motion: "Only the monitor contents move", Feasible: true}), nil
					default:
						t.Fatal("unexpected planner request")
					}
				}
				imageCalls++
				if r.URL.Path != "/v1/images/edits" {
					t.Fatal("existing picture must be a reference")
				}
				if err := r.ParseMultipartForm(12 << 20); err != nil {
					t.Fatal(err)
				}
				if r.FormValue("model") != "gpt-image-2" || r.FormValue("quality") != "low" {
					t.Fatal("all generated frames must use GPT Image 2 low")
				}
				if mode == "scene_loop" && (r.FormValue("size") != "1200x640" || !strings.Contains(r.FormValue("prompt"), "ENTIRE scene") || strings.Contains(r.FormValue("prompt"), "clean background plate")) {
					t.Fatal("not a genuine generated scene sequence")
				}
				b, _ := json.Marshal(map[string]any{"data": []any{map[string]any{"b64_json": aiTestPNG()}}})
				return aiResponse(200, string(b)), nil
			}))
			_ = s.aiTheme.store.Set("openai", "not-a-real-key")
			req, _ := json.Marshal(aiThemeConceptRequest{Target: "auto", Prompt: "Make this scene work well", Previous: &aiThemePreviousConcept{ImageBase64: aiTestPNG(), ReferenceImageBase64: aiTestPNG(), ImageContentType: "image/png", Style: aiTestStyle()}})
			response := aiCall(s, "POST", "/v1/ai-theme/concepts", string(req))
			if response.Code != 200 {
				t.Fatal(response.Code, response.Body.String())
			}
			var concept aiThemeConcept
			_ = json.Unmarshal(response.Body.Bytes(), &concept)
			if concept.Style.AnimationMode != mode || plans != 1 {
				t.Fatal("client overrode director choice")
			}
			switch mode {
			case "static":
				if imageCalls != 0 || concept.Animation != nil || concept.SceneAnimation != nil {
					t.Fatal("did not preserve static reference")
				}
			case "four_frame":
				if imageCalls != 1 || concept.Animation == nil || regions != 0 {
					t.Fatal("invalid independent animation")
				}
			case "scene_loop":
				if imageCalls != 2 || regions != 1 || concept.SceneAnimation == nil || concept.Animation != nil {
					t.Fatal("invalid scene pipeline")
				}
			}
		})
	}
}

func TestAIThemeAutoRejectsInvalidRegionsWithoutReturningPartialConcept(t *testing.T) {
	for _, failure := range []string{"region"} {
		t.Run(failure, func(t *testing.T) {
			images := 0
			s := aiTestServer(t, aiRoundTrip(func(r *http.Request) (*http.Response, error) {
				raw, _ := io.ReadAll(r.Body)
				if r.URL.Path != "/v1/responses" {
					images++
					return aiResponse(200, `{"data":[{"b64_json":"`+aiTestPNG()+`"}]}`), nil
				}
				if strings.Contains(string(raw), "vibetv_auto_direction") {
					style := aiTestStyle()
					style.PreserveArtwork = true
					style.AnimationMode = "scene_loop"
					style.AnimationPrompt = "Scroll code"
					return autoTextResponse(style), nil
				}
				if strings.Contains(string(raw), "vibetv_scene_region") {
					region := aiSceneRegion{X: 20, Y: 20, Width: 32, Height: 32, Motion: "Scroll monitor code", Feasible: true}
					if failure == "region" {
						region.X = 230
					}
					return autoTextResponse(region), nil
				}
				return autoTextResponse(map[string]any{"accepted": false, "reason": "The whole image moves, not the monitor"}), nil
			}))
			_ = s.aiTheme.store.Set("openai", "not-a-real-key")
			req, _ := json.Marshal(aiThemeConceptRequest{Target: "auto", Prompt: "Bring it to life", Previous: &aiThemePreviousConcept{ImageBase64: aiTestPNG(), ImageContentType: "image/png", Style: aiTestStyle()}})
			response := aiCall(s, "POST", "/v1/ai-theme/concepts", string(req))
			if response.Code != 502 || !strings.Contains(response.Body.String(), "animation_quality_failed") || strings.Contains(response.Body.String(), "imageBase64") {
				t.Fatal(response.Code, response.Body.String())
			}
			var payload struct {
				Error struct{ Stage, Reason string }
			}
			_ = json.Unmarshal(response.Body.Bytes(), &payload)
			if payload.Error.Stage != failure || payload.Error.Reason == "" {
				t.Fatalf("missing stage/reason: %s", response.Body.String())
			}

			if failure == "region" && images != 0 {
				t.Fatal("generated despite invalid region")
			}
		})
	}
}
