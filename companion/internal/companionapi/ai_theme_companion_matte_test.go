package companionapi

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"image"
	"image/color"
	"image/png"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

func aiTestCompanionSheet() string {
	return aiTestCompanionSheetWithMatte(color.NRGBA{240, 45, 229, 255})
}

func aiTestCompanionSheetWithMatte(matte color.NRGBA) string {
	img := image.NewNRGBA(image.Rect(0, 0, 320, 160))
	for y := 0; y < 160; y++ {
		for x := 0; x < 320; x++ {
			c := matte
			if x%80 >= 20 && x%80 < 60 && y%80 >= 20 && y%80 < 60 {
				c = color.NRGBA{255, 90, 170, 255}
			}
			img.SetNRGBA(x, y, c)
		}
	}
	var b bytes.Buffer
	_ = png.Encode(&b, img)
	return base64.StdEncoding.EncodeToString(b.Bytes())
}

func TestCompanionMatteValidation(t *testing.T) {
	if issue := companionSheetIssue(aiTestCompanionSheet()); issue != "" {
		t.Fatal(issue)
	}
	if issue := companionSheetIssue(aiTestPNG()); issue == "" {
		t.Fatal("accepted invalid grid/empty sheet")
	}
	if issue := companionSheetIssue("invalid"); issue == "" {
		t.Fatal("accepted malformed PNG")
	}
	for _, matte := range []color.NRGBA{{0, 0, 0, 0}, {201, 22, 219, 255}, {250, 70, 230, 255}} {
		if issue := companionSheetIssue(aiTestCompanionSheetWithMatte(matte)); issue != "" {
			t.Fatal(issue)
		}
	}
	for _, matte := range []color.NRGBA{{109, 63, 32, 255}, {255, 255, 255, 255}} {
		if issue := companionSheetIssue(aiTestCompanionSheetWithMatte(matte)); !strings.Contains(issue, "frame 1") {
			t.Fatalf("accepted scene/white background: %s", issue)
		}
	}
}

// The model sometimes draws the scene's furniture around the subject in every
// frame. Such a sheet has several separate shapes and is not one figure.
func TestCompanionSheetRejectsSeveralSeparateShapes(t *testing.T) {
	img := image.NewNRGBA(image.Rect(0, 0, 320, 160))
	for y := 0; y < 160; y++ {
		for x := 0; x < 320; x++ {
			c := color.NRGBA{255, 0, 255, 255}
			cx, cy := x%80, y%80
			for _, prop := range [][4]int{{8, 8, 26, 22}, {50, 8, 72, 24}, {8, 50, 28, 72}, {46, 44, 70, 70}} {
				if cx >= prop[0] && cx < prop[2] && cy >= prop[1] && cy < prop[3] {
					c = color.NRGBA{90, 60, 140, 255}
				}
			}
			img.SetNRGBA(x, y, c)
		}
	}
	var b bytes.Buffer
	_ = png.Encode(&b, img)
	if issue := companionSheetIssue(base64.StdEncoding.EncodeToString(b.Bytes())); !strings.Contains(issue, "several separate shapes") {
		t.Fatalf("accepted a sheet of scene props: %q", issue)
	}
}

func TestCompanionRepairIsBoundedAndPreservesOtherLayers(t *testing.T) {
	for _, tc := range []struct {
		name      string
		fixedAt   int // image call that returns a clean sheet; 0 = never
		wantCalls int
	}{{"repair-success", 2, 2}, {"second-repair-success", 3, 3}, {"repairs-fail", 0, 1 + companionSheetRepairs}} {
		t.Run(tc.name, func(t *testing.T) {
			style, pets := companionPlanFixture(2)
			pets[0].Reuse = true
			images := 0
			s := aiTestServer(t, aiRoundTrip(func(r *http.Request) (*http.Response, error) {
				if r.URL.Path == "/v1/responses" {
					return autoTextResponse(map[string]any{"style": style, "companions": pets}), nil
				}
				images++
				body, _ := io.ReadAll(r.Body)
				if images >= 2 && !strings.Contains(string(body), "REPAIR") {
					t.Fatal("not a targeted repair")
				}
				if images > 1+companionSheetRepairs {
					t.Fatal("unbounded retry")
				}
				encoded := aiTestCompanionSheetWithMatte(color.NRGBA{109, 63, 32, 255})
				if images == tc.fixedAt {
					encoded = aiTestCompanionSheet()
				}
				return aiResponse(200, `{"data":[{"b64_json":"`+encoded+`"}]}`), nil
			}))
			previous := &aiThemePreviousConcept{Style: style, ImageBase64: aiTestPNG(), ImageContentType: "image/png", Companions: []aiCompanion{{ID: "pet-1", X: 20, Y: 40, Size: 32, FPS: 4, FrameCount: 8, KeyColor: "#FF00FF", SheetBase64: aiTestCompanionSheet()}}}
			bg, _ := validateConceptImage(aiTestPNG(), "image/png")
			result, err := s.aiTheme.createCompanionConcept(context.Background(), "fixture", aiThemeConceptRequest{Prompt: "Add a bird", Previous: previous}, bg)
			if images != tc.wantCalls {
				t.Fatalf("wanted %d attempts, got %d", tc.wantCalls, images)
			}
			if err != nil || result.ImageBase64 != previous.ImageBase64 || result.Companions[0].SheetBase64 != previous.Companions[0].SheetBase64 {
				t.Fatalf("repair changed unaffected layers: %v", err)
			}
			if tc.fixedAt == 0 {
				// The new bird never came out clean: the design still arrives,
				// with the existing pet and without the bird, and without an error.
				if len(result.Companions) != 1 || result.Companions[0].ID != "pet-1" || result.Style.AnimationMode != "four_frame" {
					t.Fatalf("wanted the design without the failed new companion: %#v", result.Companions)
				}
			} else if len(result.Companions) != 2 || result.Companions[1].SheetBase64 != aiTestCompanionSheet() {
				t.Fatalf("repaired companion missing: %#v", result.Companions)
			}
		})
	}
}

func TestCompanionThatNeverComesOutCleanKeepsItsPreviousDrawings(t *testing.T) {
	style, pets := companionPlanFixture(1)
	images := 0
	s := aiTestServer(t, aiRoundTrip(func(r *http.Request) (*http.Response, error) {
		if r.URL.Path == "/v1/responses" {
			return autoTextResponse(map[string]any{"style": style, "companions": pets}), nil
		}
		images++
		return aiResponse(200, `{"data":[{"b64_json":"`+aiTestCompanionSheetWithMatte(color.NRGBA{109, 63, 32, 255})+`"}]}`), nil
	}))
	previous := &aiThemePreviousConcept{Style: style, ImageBase64: aiTestPNG(), ImageContentType: "image/png", Companions: []aiCompanion{{ID: "pet-1", X: 20, Y: 40, Size: 32, FPS: 4, FrameCount: 8, KeyColor: "#FF00FF", SheetBase64: aiTestCompanionSheet()}}}
	bg, _ := validateConceptImage(aiTestPNG(), "image/png")
	result, err := s.aiTheme.createCompanionConcept(context.Background(), "fixture", aiThemeConceptRequest{Prompt: "Make the fox pink", Previous: previous}, bg)
	if err != nil || images != 1+companionSheetRepairs || len(result.Companions) != 1 || !result.Companions[0].Reuse || result.Companions[0].SheetBase64 != previous.Companions[0].SheetBase64 {
		t.Fatalf("wanted the previous fox kept after %d calls: %v %#v", images, err, result.Companions)
	}
}

func TestNewCompanionsThatNeverComeOutCleanLeaveAStillPicture(t *testing.T) {
	style, pets := companionPlanFixture(2)
	style.PreserveArtwork = false
	images := 0
	s := aiTestServer(t, aiRoundTrip(func(r *http.Request) (*http.Response, error) {
		if r.URL.Path == "/v1/responses" {
			return autoTextResponse(map[string]any{"style": style, "companions": pets}), nil
		}
		images++
		if images == 1 {
			return aiResponse(200, `{"data":[{"b64_json":"`+aiTestPNG()+`"}]}`), nil
		}
		return aiResponse(200, `{"data":[{"b64_json":"`+aiTestCompanionSheetWithMatte(color.NRGBA{109, 63, 32, 255})+`"}]}`), nil
	}))
	result, err := s.aiTheme.createCompanionConcept(context.Background(), "fixture", aiThemeConceptRequest{Prompt: "A forest with a fox and a bird"}, nil)
	if err != nil || images != 1+2*(1+companionSheetRepairs) || len(result.Companions) != 0 || result.ImageBase64 != aiTestPNG() || result.Style.AnimationMode != "static" || result.Style.AnimationPrompt != "" {
		t.Fatalf("wanted the still picture after %d calls: %v %#v %q", images, err, result.Companions, result.Style.AnimationMode)
	}
}

func TestCompanionRepairThatRunsOutOfTimeKeepsTheDesign(t *testing.T) {
	budget := companionRepairBudget
	companionRepairBudget = 0
	t.Cleanup(func() { companionRepairBudget = budget })
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	style, pets := companionPlanFixture(2)
	images := 0
	s := aiTestServer(t, aiRoundTrip(func(r *http.Request) (*http.Response, error) {
		if r.URL.Path == "/v1/responses" {
			return autoTextResponse(map[string]any{"style": style, "companions": pets}), nil
		}
		images++
		if images == 1 {
			return aiResponse(200, `{"data":[{"b64_json":"`+aiTestCompanionSheetWithMatte(color.NRGBA{109, 63, 32, 255})+`"}]}`), nil
		}
		// The repair outlives the request deadline.
		<-r.Context().Done()
		return nil, r.Context().Err()
	}))
	previous := &aiThemePreviousConcept{Style: style, ImageBase64: aiTestPNG(), ImageContentType: "image/png", Companions: []aiCompanion{{ID: "pet-1", X: 20, Y: 40, Size: 32, FPS: 4, FrameCount: 8, KeyColor: "#FF00FF", SheetBase64: aiTestCompanionSheet()}}}
	bg, _ := validateConceptImage(aiTestPNG(), "image/png")
	result, err := s.aiTheme.createCompanionConcept(ctx, "fixture", aiThemeConceptRequest{Prompt: "Make the fox pink and add a bird", Previous: previous}, bg)
	if err != nil || images != 2 || result.ImageBase64 != previous.ImageBase64 || len(result.Companions) != 1 || !result.Companions[0].Reuse || result.Companions[0].SheetBase64 != previous.Companions[0].SheetBase64 {
		t.Fatalf("wanted the design with the previous fox after %d calls: %v %#v", images, err, result.Companions)
	}
}

func TestCompanionRepairStopsBeforeTheDeadline(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), companionRepairBudget/2)
	defer cancel()
	if companionRepairFits(ctx) || !companionRepairFits(context.Background()) {
		t.Fatal("repair budget ignores the request deadline")
	}
}

func TestCompanionCancelledPreparationDoesNotRetry(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	style, pets := companionPlanFixture(1)
	images := 0
	s := aiTestServer(t, aiRoundTrip(func(r *http.Request) (*http.Response, error) {
		if r.URL.Path == "/v1/responses" {
			return autoTextResponse(map[string]any{"style": style, "companions": pets}), nil
		}
		images++
		cancel()
		return aiResponse(200, `{"data":[{"b64_json":"`+aiTestPNG()+`"}]}`), nil
	}))
	bg, _ := validateConceptImage(aiTestPNG(), "image/png")
	_, err := s.aiTheme.createCompanionConcept(ctx, "fixture", aiThemeConceptRequest{Prompt: "Cat"}, bg)
	if !errors.Is(err, context.Canceled) || images != 1 {
		t.Fatalf("cancel ignored: %v calls=%d", err, images)
	}
}
