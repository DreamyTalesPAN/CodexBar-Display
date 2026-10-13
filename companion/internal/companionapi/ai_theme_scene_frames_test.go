package companionapi

import (
	"bytes"
	"context"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestAIThemeSceneFramesRetainOriginalOutsideMask(t *testing.T) {
	crop := image.NewRGBA(image.Rect(0, 0, 24, 24))
	for y := 0; y < 24; y++ {
		for x := 0; x < 24; x++ {
			crop.SetRGBA(x, y, color.RGBA{10, 20, 30, 255})
		}
	}
	region := aiSceneRegion{Width: 24, Height: 24, Motion: "Turn the head", EditBounds: image.Rect(7, 7, 17, 17)}
	calls := 0
	var original []byte
	s := aiTestServer(t, aiRoundTrip(func(r *http.Request) (*http.Response, error) {
		if r.URL.Path != "/v1/images/edits" {
			t.Fatal("unexpected visual review")
		}
		calls++
		if err := r.ParseMultipartForm(12 << 20); err != nil {
			t.Fatal(err)
		}
		defer r.MultipartForm.RemoveAll()
		file, _, err := r.FormFile("image")
		if err != nil {
			t.Fatal(err)
		}
		reference, _ := io.ReadAll(file)
		file.Close()
		if calls == 1 {
			original = reference
		} else if !bytes.Equal(original, reference) {
			t.Fatal("pose edits chained instead of same original")
		}
		file, _, err = r.FormFile("mask")
		if err != nil {
			t.Fatal("missing API edit mask")
		}
		mask, err := png.Decode(file)
		file.Close()
		if err != nil {
			t.Fatal(err)
		}
		_, _, _, cornerAlpha := mask.At(0, 0).RGBA()
		_, _, _, centerAlpha := mask.At(mask.Bounds().Dx()/2, mask.Bounds().Dy()/2).RGBA()
		if cornerAlpha != 65535 || centerAlpha != 0 {
			t.Fatal("mask alpha reversed")
		}
		if !strings.Contains(r.FormValue("prompt"), fmt.Sprintf("pose %d", calls+1)) {
			t.Fatal("missing ordered pose instruction")
		}
		generated := image.NewRGBA(image.Rect(0, 0, 24, 24))
		for y := 0; y < 24; y++ {
			for x := 0; x < 24; x++ {
				generated.SetRGBA(x, y, color.RGBA{uint8(calls * 60), 99, 200, 255})
			}
		}
		return aiResponse(200, `{"data":[{"b64_json":"`+aiEncodePNG(generated)+`"}]}`), nil
	}))
	encoded, err := s.aiTheme.createGeneratedScene(context.Background(), "fixture-key", crop, region, "Cat cafe")
	if err != nil {
		t.Fatal(err)
	}
	sheet, err := aiDecodeResizePNG(encoded, 48, 48)
	if err != nil {
		t.Fatal(err)
	}
	if calls != 2 {
		t.Fatalf("calls=%d", calls)
	}
	for n := 0; n < 4; n++ {
		for y := 0; y < 24; y++ {
			for x := 0; x < 24; x++ {
				want := crop.RGBAAt(x, y)
				if n > 0 && aiSceneEditable(region, x, y) {
					phase := n
					if n == 3 {
						phase = 1
					}
					want = color.RGBA{uint8(phase * 60), 99, 200, 255}
				}
				if sheet.RGBAAt(n%2*24+x, n/2*24+y) != want {
					t.Fatalf("wrong pose or modified protected context at %d,%d,%d", n, x, y)
				}
			}
		}
	}
	if !aiSceneEditable(region, 7, 7) || !aiSceneEditable(region, 12, 12) || aiSceneEditable(region, 5, 12) {
		t.Fatal("edit bounds not preserved")
	}
}

func TestAIThemeSceneFramesUseGlobalMaskAndCropCoordinates(t *testing.T) {
	scene := image.NewRGBA(image.Rect(0, 0, 240, 128))
	region := aiSceneRegion{X: 75, Y: 55, Width: 62, Height: 60, Motion: "Blink"}
	generated := image.NewRGBA(scene.Bounds())
	for y := 0; y < 128; y++ {
		for x := 0; x < 240; x++ {
			generated.SetRGBA(x, y, color.RGBA{uint8(x), uint8(y), 99, 255})
		}
	}
	s := aiTestServer(t, aiRoundTrip(func(r *http.Request) (*http.Response, error) {
		if err := r.ParseMultipartForm(12 << 20); err != nil {
			t.Fatal(err)
		}
		defer r.MultipartForm.RemoveAll()
		file, _, err := r.FormFile("mask")
		if err != nil {
			t.Fatal(err)
		}
		defer file.Close()
		mask, err := png.Decode(file)
		if err != nil {
			t.Fatal(err)
		}
		if mask.Bounds() != image.Rect(0, 0, 1200, 640) {
			t.Fatal("not full-scene geometry")
		}
		for _, p := range []image.Point{{0, 0}, {78, 58}, {100, 80}, {134, 112}, {180, 80}} {
			_, _, _, alpha := mask.At(p.X*5, p.Y*5).RGBA()
			if (alpha == 0) != aiSceneEditable(region, p.X-region.X, p.Y-region.Y) {
				t.Fatalf("mask moved relative to subject at %v", p)
			}
		}
		return aiResponse(200, `{"data":[{"b64_json":"`+aiEncodePNG(generated)+`"}]}`), nil
	}))
	result, err := s.aiTheme.createGeneratedScene(context.Background(), "fixture-key", scene, region, "Blink")
	if err != nil {
		t.Fatal(err)
	}
	sheet, err := aiDecodeResizePNG(result, 124, 120)
	if err != nil {
		t.Fatal(err)
	}
	for _, offset := range []image.Point{{62, 0}, {0, 60}, {62, 60}} {
		if got := sheet.RGBAAt(offset.X+25, offset.Y+25); got != generated.RGBAAt(100, 80) {
			t.Fatalf("generated full scene was scaled into the crop: %v", got)
		}
		if sheet.RGBAAt(offset.X, offset.Y) != scene.RGBAAt(75, 55) {
			t.Fatal("protected border changed")
		}
	}
}

func TestAIThemeSceneFramesSkipVisualReview(t *testing.T) {
	images := 0
	s := aiTestServer(t, aiRoundTrip(func(r *http.Request) (*http.Response, error) {
		if r.URL.Path != "/v1/images/edits" {
			t.Fatal("unexpected AI visual review after image generation")
		}
		images++
		return aiResponse(200, `{"data":[{"b64_json":"`+aiTestPNG()+`"}]}`), nil
	}))
	result, err := s.aiTheme.createGeneratedScene(context.Background(), "fixture-key", image.NewRGBA(image.Rect(0, 0, 24, 24)), aiSceneRegion{Width: 24, Height: 24, Motion: "Turn the head"}, "A cat cafe")
	if err != nil || result == "" || images != 2 {
		t.Fatalf("result withheld: images=%d err=%v", images, err)
	}
}

func TestAIThemeSceneFramesRejectUnreadableImage(t *testing.T) {
	s := aiTestServer(t, aiRoundTrip(func(r *http.Request) (*http.Response, error) {
		if r.URL.Path != "/v1/images/edits" {
			t.Fatal("unexpected visual review")
		}
		return aiResponse(200, `{"data":[{"b64_json":"not-an-image"}]}`), nil
	}))
	result, err := s.aiTheme.createGeneratedScene(context.Background(), "fixture-key", image.NewRGBA(image.Rect(0, 0, 24, 24)), aiSceneRegion{Width: 24, Height: 24}, "A cat cafe")
	if err == nil || result != "" {
		t.Fatal("unreadable image escaped technical validation")
	}
}

func TestAIThemeSceneFramesStopOnFailedPose(t *testing.T) {
	calls := 0
	s := aiTestServer(t, aiRoundTrip(func(r *http.Request) (*http.Response, error) {
		if r.URL.Path != "/v1/images/edits" {
			t.Fatal("unexpected visual review")
		}
		calls++
		if calls == 2 {
			return aiResponse(429, `{"error":"rate limited"}`), nil
		}
		return aiResponse(200, `{"data":[{"b64_json":"`+aiTestPNG()+`"}]}`), nil
	}))
	result, err := s.aiTheme.createGeneratedScene(context.Background(), "fixture-key", image.NewRGBA(image.Rect(0, 0, 24, 24)), aiSceneRegion{Width: 24, Height: 24}, "Cat cafe")
	if err == nil || result != "" || calls != 2 {
		t.Fatal("partial loop returned or extra billed pose attempted")
	}
}
