package companionapi

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
)

func companionPlanFixture(n int) (aiThemeStyle, []aiCompanionPlan) {
	style := aiTestStyle()
	style.PreserveArtwork = true
	pets := []aiCompanionPlan{}
	if n > 0 {
		style.AnimationMode = "four_frame"
		style.AnimationPrompt = "A fox and bird move"
	} else {
		style.AnimationMode = "static"
		style.AnimationPrompt = ""
	}
	for i := 0; i < n; i++ {
		id := "pet-1"
		if i == 1 {
			id = "pet-2"
		}
		pets = append(pets, aiCompanionPlan{ID: id, X: 20 + i*80, Y: 40, Size: 32, FPS: 4, Subject: "Fox", Motion: "Tail swishes"})
	}
	return style, pets
}

func TestCompanionDisplaySizeIndependentOfFrameSize(t *testing.T) {
	for _, size := range []int{64, 72, 80} {
		if !validCompanionLayout("pet-1", 40, 128-size, size, 4) {
			t.Fatalf("display size %d rejected", size)
		}
		if err := validatePreviousCompanions([]aiCompanion{{ID: "pet-1", X: 40, Y: 128 - size, Size: size, FPS: 4, FrameCount: 8, KeyColor: "#FF00FF", SheetBase64: aiTestCompanionSheet()}}); err != nil {
			t.Fatal(err)
		}
	}
	if validCompanionLayout("pet-1", 0, 0, 81, 4) || validCompanionLayout("pet-1", 0, 50, 100, 4) {
		t.Fatal("accepted out-of-scene display")
	}
}
func TestCompanionRouteModelChoosesCount(t *testing.T) {
	for _, n := range []int{0, 1, 2} {
		t.Run(string(rune('0'+n)), func(t *testing.T) {
			style, pets := companionPlanFixture(n)
			plans, images := 0, 0
			s := aiTestServer(t, aiRoundTrip(func(r *http.Request) (*http.Response, error) {
				body, _ := io.ReadAll(r.Body)
				if r.URL.Path == "/v1/responses" {
					plans++
					if !strings.Contains(string(body), "vibetv_companion_direction") {
						t.Fatal("Wrong planner")
					}
					return autoTextResponse(map[string]any{"style": style, "companions": pets}), nil
				}
				images++
				if !strings.Contains(string(body), "4-COLUMN, 2-ROW") || !strings.Contains(string(body), "1536x768") {
					t.Fatal("Not an eight-frame square-cell sheet")
				}
				return aiResponse(200, `{"data":[{"b64_json":"`+aiTestCompanionSheet()+`"}]}`), nil
			}))
			_ = s.aiTheme.store.Set("openai", "fixture-secret")
			req, _ := json.Marshal(aiThemeConceptRequest{Target: "companions", Prompt: "Make it lovely", Previous: &aiThemePreviousConcept{Style: aiTestStyle(), ImageContentType: "image/png", ImageBase64: aiTestPNG()}})
			resp := aiCall(s, "POST", "/v1/ai-theme/concepts", string(req))
			if resp.Code != 200 {
				t.Fatalf("%d %s", resp.Code, resp.Body.String())
			}
			var result aiThemeConcept
			_ = json.Unmarshal(resp.Body.Bytes(), &result)
			if len(result.Companions) != n || images != n || plans != 1 || result.ImageBase64 != aiTestPNG() || result.SceneAnimation != nil || result.Animation != nil {
				t.Fatal("Wrong layers or unexpected background/review call")
			}
		})
	}
}
func TestCompanionReusesUntouchedSprite(t *testing.T) {
	style, pets := companionPlanFixture(2)
	pets[0].Reuse = true
	images := 0
	s := aiTestServer(t, aiRoundTrip(func(r *http.Request) (*http.Response, error) {
		if r.URL.Path == "/v1/responses" {
			return autoTextResponse(map[string]any{"style": style, "companions": pets}), nil
		}
		images++
		return aiResponse(200, `{"data":[{"b64_json":"`+aiTestCompanionSheet()+`"}]}`), nil
	}))
	previous := &aiThemePreviousConcept{Style: style, ImageBase64: aiTestPNG(), ImageContentType: "image/png", Companions: []aiCompanion{{ID: "pet-1", X: 20, Y: 40, Size: 32, FPS: 4, FrameCount: 8, KeyColor: "#FF00FF", SheetBase64: aiTestPNG()}}}
	bg, _ := validateConceptImage(aiTestPNG(), "image/png")
	result, err := s.aiTheme.createCompanionConcept(context.Background(), "fixture", aiThemeConceptRequest{Prompt: "Add a bird", Previous: previous}, bg)
	if err != nil || images != 1 || len(result.Companions) != 2 || !result.Companions[0].Reuse || result.Companions[0].SheetBase64 != aiTestPNG() {
		t.Fatalf("Reuse failed: %v calls=%d", err, images)
	}
}

func TestCompanionAppearanceEditReachesImagePrompt(t *testing.T) {
	style, pets := companionPlanFixture(1)
	pets[0].Subject = "The same cat with pink fur"
	s := aiTestServer(t, aiRoundTrip(func(r *http.Request) (*http.Response, error) {
		if r.URL.Path == "/v1/responses" {
			return autoTextResponse(map[string]any{"style": style, "companions": pets}), nil
		}
		body, _ := io.ReadAll(r.Body)
		if strings.Contains(string(body), "change only the requested motion") || !strings.Contains(string(body), "Customer change request: Make the cat pink") {
			t.Fatal("Appearance request is missing or contradicted by identity instructions")
		}
		return aiResponse(200, `{"data":[{"b64_json":"`+aiTestCompanionSheet()+`"}]}`), nil
	}))
	previous := &aiThemePreviousConcept{Style: style, ImageBase64: aiTestPNG(), ImageContentType: "image/png", Companions: []aiCompanion{{ID: "pet-1", X: 20, Y: 40, Size: 32, FPS: 4, FrameCount: 8, KeyColor: "#FF00FF", SheetBase64: aiTestPNG()}}}
	bg, _ := validateConceptImage(aiTestPNG(), "image/png")
	if _, err := s.aiTheme.createCompanionConcept(context.Background(), "fixture", aiThemeConceptRequest{Prompt: "Make the cat pink", Previous: previous}, bg); err != nil {
		t.Fatal(err)
	}
}
func TestCompanionRejectsInvalidPlansBeforeImages(t *testing.T) {
	for _, kind := range []string{"overlap", "offscreen", "duplicate", "missing-reuse", "three"} {
		t.Run(kind, func(t *testing.T) {
			style, pets := companionPlanFixture(2)
			switch kind {
			case "overlap":
				pets[1].X = pets[0].X
			case "offscreen":
				pets[0].X = 239
			case "duplicate":
				pets[1].ID = pets[0].ID
			case "missing-reuse":
				pets[0].Reuse = true
			case "three":
				pets = append(pets, pets[0])
			}
			s := aiTestServer(t, aiRoundTrip(func(r *http.Request) (*http.Response, error) {
				if r.URL.Path != "/v1/responses" {
					t.Fatal("Generated despite invalid plan")
				}
				return autoTextResponse(map[string]any{"style": style, "companions": pets}), nil
			}))
			_, err := s.aiTheme.createCompanionConcept(context.Background(), "fixture", aiThemeConceptRequest{Prompt: "Animate"}, nil)
			if err == nil {
				t.Fatal("Invalid plan accepted")
			}
		})
	}
}
func TestCompanionCreatesCleanBackgroundAndNoPartialResult(t *testing.T) {
	style, pets := companionPlanFixture(2)
	style.PreserveArtwork = false
	images := 0
	s := aiTestServer(t, aiRoundTrip(func(r *http.Request) (*http.Response, error) {
		body, _ := io.ReadAll(r.Body)
		if r.URL.Path == "/v1/responses" {
			return autoTextResponse(map[string]any{"style": style, "companions": pets}), nil
		}
		images++
		if images == 1 && !strings.Contains(string(body), "Do NOT draw any of the animated subjects") {
			t.Fatal("Background duplicates pets")
		}
		if images == 3 {
			return aiResponse(429, `{"error":"private"}`), nil
		}
		return aiResponse(200, `{"data":[{"b64_json":"`+aiTestCompanionSheet()+`"}]}`), nil
	}))
	_ = s.aiTheme.store.Set("openai", "fixture")
	req, _ := json.Marshal(aiThemeConceptRequest{Target: "companions", Prompt: "New forest with two pets"})
	resp := aiCall(s, "POST", "/v1/ai-theme/concepts", string(req))
	if resp.Code != 429 || strings.Contains(resp.Body.String(), "sheetBase64") || strings.Contains(resp.Body.String(), "private") || !strings.Contains(resp.Body.String(), `"stage":"frames"`) {
		t.Fatalf("Unsafe partial result: %d %s", resp.Code, resp.Body.String())
	}
}
