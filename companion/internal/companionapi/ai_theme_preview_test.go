package companionapi

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"image"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"testing"
)

type aiRoundTrip func(*http.Request) (*http.Response, error)

func (f aiRoundTrip) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func aiResponse(status int, body string) *http.Response {
	return &http.Response{StatusCode: status, Header: http.Header{"Content-Type": []string{"application/json"}}, Body: io.NopCloser(strings.NewReader(body))}
}
func aiTestPNG() string {
	var b bytes.Buffer
	_ = png.Encode(&b, image.NewRGBA(image.Rect(0, 0, 16, 16)))
	return base64.StdEncoding.EncodeToString(b.Bytes())
}

func TestAIThemeSceneMotionUsesVisionWithoutGeneratingOrChangingArt(t *testing.T) {
	var pngData bytes.Buffer
	_ = png.Encode(&pngData, image.NewRGBA(image.Rect(0, 0, 240, 128)))
	reference := base64.StdEncoding.EncodeToString(pngData.Bytes())
	for _, effect := range []string{"breathe", "none", "outside"} {
		t.Run(effect, func(t *testing.T) {
			calls := 0
			s := aiTestServer(t, aiRoundTrip(func(r *http.Request) (*http.Response, error) {
				calls++
				if r.URL.String() != openAIEndpoint {
					t.Fatal("scene motion must not generate an image")
				}
				body, _ := io.ReadAll(r.Body)
				if !bytes.Contains(body, []byte(`"type":"input_image"`)) || !bytes.Contains(body, []byte(reference)) || !bytes.Contains(body, []byte(`"store":false`)) {
					t.Fatal("missing private vision reference")
				}
				var requestBody map[string]any
				if json.Unmarshal(body, &requestBody) != nil {
					t.Fatal("invalid request")
				}
				style := aiTestStyle()
				style.SceneMotion = &aiSceneMotion{X: 80, Y: 24, Width: 64, Height: 64, Effect: effect}
				if effect == "outside" {
					style.SceneMotion.Effect = "breathe"
					style.SceneMotion.X = 200
				}
				encoded, _ := json.Marshal(style)
				response, _ := json.Marshal(map[string]any{"output": []any{map[string]any{"content": []any{map[string]any{"type": "output_text", "text": string(encoded)}}}}})
				return aiResponse(200, string(response)), nil
			}))
			_ = s.aiTheme.store.Set("openai", "test-key-not-a-secret")
			requestBody, _ := json.Marshal(aiThemeConceptRequest{Prompt: "Make the person breathe", Target: "scene_motion", Previous: &aiThemePreviousConcept{ImageBase64: reference, ImageContentType: "image/png", Style: aiTestStyle()}})
			response := aiCall(s, "POST", "/v1/ai-theme/concepts", string(requestBody))
			if calls != 1 {
				t.Fatalf("unexpected provider calls: %d", calls)
			}
			if effect != "breathe" {
				if response.Code != 502 || !strings.Contains(response.Body.String(), "scene_motion_unsupported") {
					t.Fatal(response.Code, response.Body.String())
				}
				return
			}
			var concept aiThemeConcept
			if response.Code != 200 || json.Unmarshal(response.Body.Bytes(), &concept) != nil {
				t.Fatal(response.Code, response.Body.String())
			}
			if concept.ImageBase64 != reference || concept.Animation != nil || !validSceneMotion(concept.SceneMotion) || concept.Style != aiTestStyle() {
				t.Fatal("changed art/style or invalid motion")
			}
		})
	}
}

func TestAIThemeSceneMotionRejectsMissingReferenceBeforeProviderCall(t *testing.T) {
	s := aiTestServer(t, aiRoundTrip(func(*http.Request) (*http.Response, error) { t.Fatal("unexpected provider call"); return nil, nil }))
	_ = s.aiTheme.store.Set("openai", "test-key-not-a-secret")
	response := aiCall(s, "POST", "/v1/ai-theme/concepts", `{"target":"scene_motion","prompt":"breathe"}`)
	if response.Code != 400 {
		t.Fatal(response.Code)
	}
}
func aiTestStyle() aiThemeStyle {
	return aiThemeStyle{PackName: "Cabin", Title: "Cabin", Notes: "A calm scene", ArtPrompt: "A cabin", EnvironmentPrompt: "A quiet lake", AnimationMode: "static", BackgroundColor: "#112233", PanelColor: "#112233", TextColor: "#EEEEEE", SessionColor: "#CCFF00", WeeklyColor: "#CCFF00", ProgressStyle: "solid"}
}
func aiTestServer(t *testing.T, transport http.RoundTripper) *aiThemeServer {
	t.Helper()
	t.Setenv(aiThemeEnabledEnv, "1")
	t.Setenv(aiThemeDevEnv, "")
	a := newAIThemeState(&memoryAIThemeSecrets{}, &http.Client{Transport: transport})
	return &aiThemeServer{aiTheme: a}
}
func aiCall(s *aiThemeServer, method, path, body string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, "http://127.0.0.1:47852"+path, strings.NewReader(body))
	r.Header.Set("Origin", "http://127.0.0.1:47852")
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	s.aiThemeGuard(http.HandlerFunc(s.handleAITheme)).ServeHTTP(w, r)
	return w
}

func TestAIThemeOnlyBlocksActiveRequests(t *testing.T) {
	calls := 0
	s := aiTestServer(t, aiRoundTrip(func(r *http.Request) (*http.Response, error) {
		calls++
		return autoTextResponse(map[string]any{"mode": "unsupported", "notes": "Clarify", "edits": []any{}}), nil
	}))
	_ = s.aiTheme.store.Set("openai", "fixture-secret")
	if !s.aiTheme.beginGeneration() {
		t.Fatal("initial request blocked")
	}
	for _, path := range []string{"/v1/ai-theme/concepts", "/v1/ai-theme/providers/openai/verify"} {
		resp := aiCall(s, "POST", path, `{}`)
		if resp.Code != http.StatusConflict || !strings.Contains(resp.Body.String(), "generation_busy") {
			t.Fatalf("unexpected busy response: %d %s", resp.Code, resp.Body.String())
		}
		if s.aiTheme.beginGeneration() {
			t.Fatal("rejected request released the active request")
		}
	}
	s.aiTheme.endGeneration()
	for i := 0; i < 12; i++ {
		resp := aiCall(s, "POST", "/v1/ai-theme/concepts", `{"prompt":"Change","target":"layout","layout":[]}`)
		if resp.Code != http.StatusOK {
			t.Fatalf("sequential request %d failed: %d %s", i+1, resp.Code, resp.Body.String())
		}
	}
	if calls != 12 {
		t.Fatalf("unexpected provider call count: %d", calls)
	}
}

func TestAIThemeDefaultOffAndNoDeviceRoutes(t *testing.T) {
	t.Setenv(aiThemeEnabledEnv, "")
	h := NewAIThemePreviewHandler()
	for _, path := range []string{"/v1/device/pair", "/v1/themes/install", "/v1/updates/install", "/v1/ai-theme/concepts"} {
		r := httptest.NewRequest("POST", "http://127.0.0.1:47852"+path, nil)
		r.Header.Set("Origin", "http://127.0.0.1:47852")
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != 404 {
			t.Fatalf("%s exposed: %d", path, w.Code)
		}
	}
	r := httptest.NewRequest("GET", "http://127.0.0.1:47852/v1/ai-theme/capabilities", nil)
	r.Header.Set("Origin", "http://127.0.0.1:47852")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if !strings.Contains(w.Body.String(), `"enabled":false`) {
		t.Fatal(w.Body.String())
	}
}
func TestAIThemeRejectsForeignOriginsAndRebinding(t *testing.T) {
	s := aiTestServer(t, aiRoundTrip(func(*http.Request) (*http.Response, error) { t.Fatal("unexpected outbound request"); return nil, nil }))
	for _, test := range []struct{ host, origin string }{{"evil.test", "http://evil.test"}, {"localhost:47852", "https://app.vibetv.shop"}, {"127.0.0.1:47852", "null"}, {"127.0.0.1:47852", "http://localhost:3015"}, {"127.0.0.1:47852", ""}} {
		r := httptest.NewRequest("PUT", "http://"+test.host+"/v1/ai-theme/providers/openai/credential", strings.NewReader(`{"apiKey":"test-key-not-a-secret"}`))
		r.Header.Set("Origin", test.origin)
		w := httptest.NewRecorder()
		s.aiThemeGuard(http.HandlerFunc(s.handleAITheme)).ServeHTTP(w, r)
		if w.Code != 403 {
			t.Fatalf("accepted %+v", test)
		}
	}
}
func TestAIThemePublicDestinationPolicy(t *testing.T) {
	for _, address := range []string{"127.0.0.1", "::1", "::ffff:127.0.0.1", "10.2.3.4", "172.16.0.1", "192.168.1.1", "169.254.169.254", "fe80::1", "fd00::1", "224.0.0.1", "ff02::1", "0.0.0.0", "100.100.100.200", "198.18.0.1", "64:ff9b::7f00:1"} {
		if aiThemePublicIP(netip.MustParseAddr(address)) {
			t.Fatalf("accepted %s", address)
		}
	}
	if !aiThemePublicIP(netip.MustParseAddr("8.8.8.8")) {
		t.Fatal("public address rejected")
	}
	transport := newAIThemeTransport()
	for _, url := range []string{"http://api.openai.com/v1/responses", "https://127.0.0.1/v1/responses", "https://[::1]/v1/responses", "https://api.openai.com.evil.test/v1/responses", "https://api.openai.com:444/v1/responses", "https://api.openai.com/v1/files", "https://api.openai.com/v1/responses?key=secret"} {
		r, _ := http.NewRequest("POST", url, nil)
		if _, err := transport.RoundTrip(r); err == nil {
			t.Fatalf("accepted %s", url)
		}
	}
}
func TestAIThemeRedirectNeverForwardsCredential(t *testing.T) {
	for _, target := range []string{"http://127.0.0.1/", "https://169.254.169.254/", "https://[::1]/", "https://other.example/"} {
		calls := 0
		s := aiTestServer(t, aiRoundTrip(func(r *http.Request) (*http.Response, error) {
			calls++
			resp := aiResponse(302, `{}`)
			resp.Header.Set("Location", target)
			return resp, nil
		}))
		_, _, err := s.aiTheme.planConcept(context.Background(), "secret-test", aiThemeConceptRequest{Prompt: "A cabin"}, "")
		if err == nil || calls != 1 {
			t.Fatalf("redirect followed: %s, %d", target, calls)
		}
	}
}
func TestAIThemeCredentialMemoryAndSafeErrors(t *testing.T) {
	const key = "test-secret-never-persist-this"
	s := aiTestServer(t, aiRoundTrip(func(r *http.Request) (*http.Response, error) {
		return aiResponse(401, `{"error":{"message":"`+key+`"}}`), nil
	}))
	w := aiCall(s, "PUT", "/v1/ai-theme/providers/openai/credential", `{"apiKey":"`+key+`"}`)
	if w.Code != 200 || strings.Contains(w.Body.String(), key) {
		t.Fatal(w.Body.String())
	}
	w = aiCall(s, "POST", "/v1/ai-theme/providers/openai/verify", "")
	if w.Code != 401 || strings.Contains(w.Body.String(), key) {
		t.Fatal(w.Body.String())
	}
	w = aiCall(s, "GET", "/v1/ai-theme/capabilities", "")
	if strings.Contains(w.Body.String(), key) {
		t.Fatal("key reflected")
	}
	if _, err := (&memoryAIThemeSecrets{}).Get("openai"); err == nil {
		t.Fatal("key leaked into another session")
	}
	aiCall(s, "DELETE", "/v1/ai-theme/providers/openai/credential", "")
	if _, err := s.aiTheme.store.Get("openai"); err == nil {
		t.Fatal("key not forgotten")
	}
	for _, body := range []string{`{"apiKey":"` + key + `","baseURL":"http://localhost"}`, `{"apiKey":"` + key + `"} {}`, strings.Repeat("x", 5000)} {
		if w := aiCall(s, "PUT", "/v1/ai-theme/providers/openai/credential", body); w.Code < 400 {
			t.Fatal("invalid credential input accepted")
		}
	}
}
func TestAIThemeGenerationThroughFixedAdapter(t *testing.T) {
	style, _ := json.Marshal(aiTestStyle())
	png := aiTestPNG()
	calls := []string{}
	s := aiTestServer(t, aiRoundTrip(func(r *http.Request) (*http.Response, error) {
		calls = append(calls, r.URL.String())
		if r.Header.Get("Authorization") != "Bearer test-key-not-a-secret" {
			t.Fatal("missing credential")
		}
		if r.URL.Path == "/v1/responses" {
			out, _ := json.Marshal(map[string]any{"output": []any{map[string]any{"content": []any{map[string]any{"type": "output_text", "text": string(style)}}}}})
			return aiResponse(200, string(out)), nil
		}
		return aiResponse(200, `{"data":[{"b64_json":"`+png+`"}]}`), nil
	}))
	_ = s.aiTheme.store.Set("openai", "test-key-not-a-secret")
	w := aiCall(s, "POST", "/v1/ai-theme/concepts", `{"prompt":"A cabin"}`)
	if w.Code != 200 || !strings.Contains(w.Body.String(), "imageBase64") {
		t.Fatalf("generation failed: %d %s", w.Code, w.Body.String())
	}
	if len(calls) != 2 || calls[0] != openAIEndpoint || calls[1] != openAIImageEndpoint {
		t.Fatal(calls)
	}
}
func TestAIThemeAnimationEditPreservesBackground(t *testing.T) {
	calls := 0
	png := aiTestPNG()
	s := aiTestServer(t, aiRoundTrip(func(r *http.Request) (*http.Response, error) {
		calls++
		if r.URL.Path != "/v1/images/edits" {
			t.Fatal("must edit existing sprite")
		}
		return aiResponse(200, `{"data":[{"b64_json":"`+png+`"}]}`), nil
	}))
	style := aiTestStyle()
	style.AnimationMode = "four_frame"
	style.AnimationPrompt = "Breathe"
	bytes, _ := base64.StdEncoding.DecodeString(png)
	result, err := s.aiTheme.createConceptImages(context.Background(), "key", style, bytes, bytes, true)
	if err != nil || calls != 1 || result.BackgroundBase64 != png {
		t.Fatalf("background regenerated: %v %d", err, calls)
	}
}
func TestAIThemeBoundsAndCancellation(t *testing.T) {
	s := aiTestServer(t, aiRoundTrip(func(r *http.Request) (*http.Response, error) { <-r.Context().Done(); return nil, r.Context().Err() }))
	for _, body := range []string{`{"prompt":"` + strings.Repeat("x", 2001) + `"}`, `{"prompt":"ok","baseURL":"http://localhost"}`, `{"prompt":"ok","previous":{"imageBase64":"not-png"}}`} {
		if w := aiCall(s, "POST", "/v1/ai-theme/concepts", body); w.Code < 400 {
			t.Fatal("invalid generation input accepted")
		}
	}
	if _, err := validateConceptImage(base64.StdEncoding.EncodeToString([]byte{137, 80, 78, 71, 13, 10, 26, 10}), "image/png"); err == nil {
		t.Fatal("truncated PNG accepted")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, _, err := s.aiTheme.planConcept(ctx, "secret", aiThemeConceptRequest{Prompt: "x"}, "")
	if err == nil {
		t.Fatal("cancellation ignored")
	}
	a := newAIThemeState(nil, nil)
	if !a.beginGeneration() || a.beginGeneration() {
		t.Fatal("concurrent requests allowed")
	}
	a.endGeneration()
	for i := 0; i < 100; i++ {
		if !a.beginGeneration() {
			t.Fatalf("sequential request %d was blocked", i+1)
		}
		if a.beginGeneration() {
			t.Fatal("concurrent request allowed")
		}
		a.endGeneration()
	}
}
