package companionapi

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
)

func TestAIThemeImageRequestsUseImage2Low(t *testing.T) {
	for _, editing := range []bool{false, true} {
		t.Run(map[bool]string{false: "generation", true: "edit"}[editing], func(t *testing.T) {
			calls := 0
			s := aiTestServer(t, aiRoundTrip(func(r *http.Request) (*http.Response, error) {
				calls++
				var model, quality, size string
				if editing {
					if r.URL.Path != "/v1/images/edits" {
						t.Fatal(r.URL.Path)
					}
					if err := r.ParseMultipartForm(12 << 20); err != nil {
						t.Fatal(err)
					}
					model, quality, size = r.FormValue("model"), r.FormValue("quality"), r.FormValue("size")
				} else {
					if r.URL.Path != "/v1/images/generations" {
						t.Fatal(r.URL.Path)
					}
					var payload struct{ Model, Quality, Size string }
					if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
						t.Fatal(err)
					}
					model, quality, size = payload.Model, payload.Quality, payload.Size
				}
				if model != "gpt-image-2" || quality != "low" || size != "1200x640" {
					t.Fatalf("unexpected image settings: %s %s %s", model, quality, size)
				}
				return aiResponse(200, `{"data":[{"b64_json":"`+aiTestPNG()+`"}]}`), nil
			}))
			var previous []byte
			if editing {
				previous = []byte("fixture-reference")
			}
			if _, err := s.aiTheme.createConceptImage(context.Background(), "fixture-key", "An office", previous); err != nil {
				t.Fatal(err)
			}
			if calls != 1 {
				t.Fatal("unexpected retries")
			}
		})
	}
}
