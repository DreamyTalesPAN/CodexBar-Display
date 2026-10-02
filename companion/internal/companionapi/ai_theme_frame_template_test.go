package companionapi

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestAIThemeGeneratedFramesUseExactRestingPanelsAndProportionalOutput(t *testing.T) {
	for _, shape := range []image.Point{{32, 32}, {48, 24}, {24, 48}, {63, 23}} {
		t.Run(fmt.Sprintf("%dx%d", shape.X, shape.Y), func(t *testing.T) {
			scene := image.NewRGBA(image.Rect(0, 0, 240, 128))
			for y := 0; y < 128; y++ {
				for x := 0; x < 240; x++ {
					scene.SetRGBA(x, y, color.RGBA{uint8(x), uint8(y), 99, 255})
				}
			}
			region := aiSceneRegion{X: 30, Y: 20, Width: shape.X, Height: shape.Y, Motion: "Only a highlight moves", Reason: "A quiet highlight", Feasible: true}
			imageCalls := 0
			s := aiTestServer(t, aiRoundTrip(func(r *http.Request) (*http.Response, error) {
				if r.URL.Path == "/v1/responses" {
					body, _ := io.ReadAll(r.Body)
					if strings.Contains(string(body), "vibetv_auto_direction") {
						style := aiTestStyle()
						style.AnimationMode = "scene_loop"
						style.AnimationPrompt = region.Motion
						style.PreserveArtwork = true
						return autoTextResponse(style), nil
					}
					if strings.Contains(string(body), "vibetv_scene_region") {
						return autoTextResponse(region), nil
					}
					return autoTextResponse(map[string]any{"accepted": true, "reason": "Fits"}), nil
				}
				imageCalls++
				if err := r.ParseMultipartForm(12 << 20); err != nil {
					t.Fatal(err)
				}
				defer r.MultipartForm.RemoveAll()
				file, _, err := r.FormFile("image")
				if err != nil {
					t.Fatal(err)
				}
				defer file.Close()
				template, err := png.Decode(file)
				if err != nil {
					t.Fatal(err)
				}
				var w, h int
				_, _ = fmt.Sscanf(r.FormValue("size"), "%dx%d", &w, &h)
				if template.Bounds().Dx() != w || template.Bounds().Dy() != h || w*128 != h*240 || w%16 != 0 || h%16 != 0 || w*h < 655360 || w*h > 8294400 || w > 3840 || h > 3840 {
					t.Fatalf("reference/output geometry mismatch: input=%v output=%dx%d region=%v", template.Bounds(), w, h, shape)
				}
				if !strings.Contains(r.FormValue("prompt"), "ONE animation pose") {
					t.Fatal("asks model to invent the layout")
				}
				for y := 0; y < h; y++ {
					for x := 0; x < w; x++ {
						sx, sy := x*240/w, y*128/h
						if color.RGBAModel.Convert(template.At(x, y)).(color.RGBA) != scene.RGBAAt(sx, sy) {
							t.Fatal("resting template changed original pixels")
						}
					}
				}

				return aiResponse(200, `{"data":[{"b64_json":"`+aiTestPNG()+`"}]}`), nil
			}))
			previous, _ := base64.StdEncoding.DecodeString(aiEncodePNG(scene))
			_, err := s.aiTheme.createAutoConcept(context.Background(), "fixture-key", aiThemeConceptRequest{Prompt: "Bring this scene to life", Previous: &aiThemePreviousConcept{Style: aiTestStyle()}}, previous, nil)
			if err != nil || imageCalls != 2 {
				t.Fatalf("unexpected generation: %v, calls=%d", err, imageCalls)
			}
		})
	}
}

func TestAIThemeFramePlanningRepairsUnsupportedAspectRatio(t *testing.T) {
	regions, images := 0, 0
	s := aiTestServer(t, aiRoundTrip(func(r *http.Request) (*http.Response, error) {
		body, _ := io.ReadAll(r.Body)
		if r.URL.Path != "/v1/responses" {
			images++
			if regions != 2 {
				t.Fatal("generated frames for unsupported aspect ratio")
			}
			return aiResponse(200, `{"data":[{"b64_json":"`+aiTestPNG()+`"}]}`), nil
		}
		if bytes.Contains(body, []byte("vibetv_auto_direction")) {
			style := aiTestStyle()
			style.AnimationMode = "scene_loop"
			style.PreserveArtwork = true
			style.AnimationPrompt = "Animate a detail"
			return autoTextResponse(style), nil
		}
		if bytes.Contains(body, []byte("vibetv_scene_region")) {
			regions++
			w := 8
			if regions > 1 {
				w = 32
			}
			return autoTextResponse(aiSceneRegion{X: 20, Y: 20, Width: w, Height: 64, Feasible: true, Motion: "A small detail", Reason: "Fits"}), nil
		}
		return autoTextResponse(map[string]any{"accepted": true, "reason": "Fits"}), nil
	}))
	_ = s.aiTheme.store.Set("openai", "fixture-key")
	req, _ := json.Marshal(aiThemeConceptRequest{Target: "auto", Prompt: "Animate a detail", Previous: &aiThemePreviousConcept{ImageBase64: aiTestPNG(), ImageContentType: "image/png", Style: aiTestStyle()}})
	w := aiCall(s, "POST", "/v1/ai-theme/concepts", string(req))
	if w.Code != 200 || images != 2 || regions != 2 {
		t.Fatalf("did not replan: %d", w.Code)
	}
}
