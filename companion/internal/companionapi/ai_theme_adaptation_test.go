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

func TestAIThemeAdaptationStopsOnCancellation(t *testing.T) {
	for _, cancelStage := range []string{"region", "frames"} {
		t.Run(cancelStage, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			regions, images := 0, 0
			s := aiTestServer(t, aiRoundTrip(func(r *http.Request) (*http.Response, error) {
				raw, _ := io.ReadAll(r.Body)
				if r.URL.Path != "/v1/responses" {
					images++
					if cancelStage == "frames" {
						cancel()
						return nil, ctx.Err()
					}
					return aiResponse(200, `{"data":[{"b64_json":"`+aiTestPNG()+`"}]}`), nil
				}
				if strings.Contains(string(raw), "vibetv_auto_direction") {
					style := aiTestStyle()
					style.AnimationMode, style.AnimationPrompt, style.PreserveArtwork = "scene_loop", "Move code", true
					return autoTextResponse(style), nil
				}
				if strings.Contains(string(raw), "vibetv_scene_region") {
					regions++
					if cancelStage == "region" {
						cancel()
					}
					return autoTextResponse(aiSceneRegion{X: 20, Y: 20, Width: 32, Height: 32, Motion: "Move code", Feasible: cancelStage != "region", Reason: "Too large"}), nil
				}
				t.Fatal("unexpected visual review")
				return nil, nil
			}))
			previous, _ := validateConceptImage(aiTestPNG(), "image/png")
			_, err := s.aiTheme.createAutoConcept(ctx, "fixture-key", aiThemeConceptRequest{Prompt: "Bring it to life", Previous: &aiThemePreviousConcept{Style: aiTestStyle()}}, previous, nil)
			if !errors.Is(err, context.Canceled) || regions != 1 || (cancelStage == "region" && images != 0) || (cancelStage == "frames" && images != 1) {
				t.Fatalf("cancellation did not stop retries: regions=%d images=%d err=%v", regions, images, err)
			}
		})
	}
}

func TestAIThemeAdaptsBalloonPlanBeforeGeneratingFrames(t *testing.T) {
	for _, invalidBounds := range []bool{false, true} {
		t.Run(map[bool]string{false: "infeasible", true: "invalid bounds"}[invalidBounds], func(t *testing.T) {
			regions, images := 0, 0
			s := aiTestServer(t, aiRoundTrip(func(r *http.Request) (*http.Response, error) {
				raw, _ := io.ReadAll(r.Body)
				if r.URL.Path != "/v1/responses" {
					images++
					if regions != 2 {
						t.Fatal("image generated before a feasible plan")
					}
					return aiResponse(200, `{"data":[{"b64_json":"`+aiTestPNG()+`"}]}`), nil
				}
				if strings.Contains(string(raw), "vibetv_auto_direction") {
					style := aiTestStyle()
					style.PreserveArtwork = true
					style.AnimationMode = "scene_loop"
					style.AnimationPrompt = "Move both balloons and strings"
					return autoTextResponse(style), nil
				}
				if strings.Contains(string(raw), "vibetv_scene_region") {
					regions++
					if regions == 1 {
						return autoTextResponse(aiSceneRegion{X: 20, Y: 20, Width: 32, Height: 90, Feasible: invalidBounds, Motion: "Move both balloons", Reason: "Both balloons and strings exceed 64 pixels."}), nil
					}
					if !strings.Contains(string(raw), "Previous proposal") || !strings.Contains(string(raw), "Customer request: Black cat with balloons") {
						t.Fatal("retry lost rejection feedback or original intent")
					}
					return autoTextResponse(aiSceneRegion{X: 20, Y: 20, Width: 32, Height: 32, Feasible: true, Motion: "Only the upper balloon gently changes its highlight; strings stay still", Reason: "Only one balloon gently moves; the strings stay still."}), nil
				}
				t.Fatal("unexpected visual review")
				return nil, nil
			}))
			_ = s.aiTheme.store.Set("openai", "fixture-key")
			req, _ := json.Marshal(aiThemeConceptRequest{Target: "auto", Prompt: "Black cat with balloons", Previous: &aiThemePreviousConcept{ImageBase64: aiTestPNG(), ImageContentType: "image/png", Style: aiTestStyle()}})
			response := aiCall(s, "POST", "/v1/ai-theme/concepts", string(req))
			if response.Code != 200 {
				t.Fatalf("did not adapt: %d %s", response.Code, response.Body.String())
			}
			var concept aiThemeConcept
			_ = json.Unmarshal(response.Body.Bytes(), &concept)
			if regions != 2 || images != 2 || concept.SceneAnimation == nil || !strings.Contains(concept.Style.Notes, "one balloon") || strings.Contains(concept.Style.AnimationPrompt, "both balloons") {
				t.Fatal("adaptation not applied or disclosed")
			}
		})
	}
}

func TestAIThemeAdaptationAndGenerationAreBounded(t *testing.T) {
	for _, tc := range []struct {
		name                    string
		fresh, regionFails      bool
		status, regions, images int
	}{
		{"no feasible alternative", false, true, 502, 3, 0},
		{"existing scene returns generated frames", false, false, 200, 1, 2},
		{"new artwork keeps total image budget", true, false, 200, 1, 3},
	} {
		t.Run(tc.name, func(t *testing.T) {
			regions, images := 0, 0
			s := aiTestServer(t, aiRoundTrip(func(r *http.Request) (*http.Response, error) {
				raw, _ := io.ReadAll(r.Body)
				if r.URL.Path != "/v1/responses" {
					images++

					return aiResponse(200, `{"data":[{"b64_json":"`+aiTestPNG()+`"}]}`), nil
				}
				if strings.Contains(string(raw), "vibetv_auto_direction") {
					style := aiTestStyle()
					style.PreserveArtwork = !tc.fresh
					style.AnimationMode = "scene_loop"
					style.AnimationPrompt = "Animate code"
					return autoTextResponse(style), nil
				}
				if strings.Contains(string(raw), "vibetv_scene_region") {
					regions++
					return autoTextResponse(aiSceneRegion{X: 20, Y: 20, Width: 32, Height: 32, Motion: "Only code moves", Feasible: !tc.regionFails, Reason: "No usable detail"}), nil
				}
				t.Fatal("unexpected visual review")
				return nil, nil
			}))
			_ = s.aiTheme.store.Set("openai", "fixture-key")
			req, _ := json.Marshal(aiThemeConceptRequest{Target: "auto", Prompt: "Bring it to life", Previous: &aiThemePreviousConcept{ImageBase64: aiTestPNG(), ImageContentType: "image/png", Style: aiTestStyle()}})
			response := aiCall(s, "POST", "/v1/ai-theme/concepts", string(req))
			if response.Code != tc.status || regions != tc.regions || images != tc.images {
				t.Fatalf("got status=%d regions=%d images=%d", response.Code, regions, images)
			}
			if response.Code != 200 && strings.Contains(response.Body.String(), "imageBase64") {
				t.Fatal("partial result escaped")
			}
		})
	}
}
