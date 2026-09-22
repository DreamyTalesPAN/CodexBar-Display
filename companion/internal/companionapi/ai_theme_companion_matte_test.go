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

func TestCompanionRepairIsBoundedAndPreservesOtherLayers(t *testing.T) {
	for _, repaired := range []bool{true, false} {
		t.Run(map[bool]string{true: "repair-success", false: "repair-failure"}[repaired], func(t *testing.T) {
			style, pets := companionPlanFixture(2)
			pets[0].Reuse = true
			images := 0
			s := aiTestServer(t, aiRoundTrip(func(r *http.Request) (*http.Response, error) {
				if r.URL.Path == "/v1/responses" {
					return autoTextResponse(map[string]any{"style": style, "companions": pets}), nil
				}
				images++
				body, _ := io.ReadAll(r.Body)
				if images == 2 && !strings.Contains(string(body), "REPAIR") {
					t.Fatal("not a targeted repair")
				}
				if images > 2 {
					t.Fatal("unbounded retry")
				}
				encoded := aiTestCompanionSheetWithMatte(color.NRGBA{109, 63, 32, 255})
				if images == 2 && repaired {
					encoded = aiTestCompanionSheet()
				}
				return aiResponse(200, `{"data":[{"b64_json":"`+encoded+`"}]}`), nil
			}))
			previous := &aiThemePreviousConcept{Style: style, ImageBase64: aiTestPNG(), ImageContentType: "image/png", Companions: []aiCompanion{{ID: "pet-1", X: 20, Y: 40, Size: 32, FPS: 4, FrameCount: 8, KeyColor: "#FF00FF", SheetBase64: aiTestCompanionSheet()}}}
			bg, _ := validateConceptImage(aiTestPNG(), "image/png")
			result, err := s.aiTheme.createCompanionConcept(context.Background(), "fixture", aiThemeConceptRequest{Prompt: "Add a bird", Previous: previous}, bg)
			if images != 2 {
				t.Fatalf("wanted two attempts, got %d", images)
			}
			if repaired {
				if err != nil || result.ImageBase64 != previous.ImageBase64 || result.Companions[0].SheetBase64 != previous.Companions[0].SheetBase64 {
					t.Fatalf("repair changed unaffected layers: %v", err)
				}
			} else {
				var diagnostic *aiThemeDiagnosticError
				if !errors.As(err, &diagnostic) || diagnostic.Stage != "frames" || !strings.Contains(diagnostic.Reason, "pet-2") {
					t.Fatalf("missing safe failure diagnostic: %#v", err)
				}
			}
		})
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
