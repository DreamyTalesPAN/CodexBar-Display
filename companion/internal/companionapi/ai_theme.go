package companionapi

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"net/url"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"
)

const (
	aiThemeEnabledEnv          = "VIBETV_AI_THEME_ENABLED"
	aiThemeDevEnv              = "VIBETV_AI_THEME_DEV_ORIGINS"
	aiThemePromptLimit         = 2000
	aiThemeHistoryLimit        = 10
	aiThemeJSONResponseLimit   = 128 << 10
	aiThemeImageResponseLimit  = 8 << 20
	aiThemeConceptRequestLimit = 12 << 20
	aiThemeOutputTokens        = 2048
	aiThemeTimeout             = 120 * time.Second
	aiThemeRateWindow          = 10 * time.Minute
	aiThemeRateLimit           = 5
	openAIEndpoint             = "https://api.openai.com/v1/responses"
	openAIImageEndpoint        = "https://api.openai.com/v1/images/generations"
	openAIImageEditEndpoint    = "https://api.openai.com/v1/images/edits"
	openAIModel                = "gpt-5.6-terra"
	openAIImageModel           = "gpt-image-2"
	openAIImageQuality         = "low"
	openAIImageSize            = "1200x640"
)

var aiThemeColorPattern = regexp.MustCompile(`^#[A-Fa-f0-9]{6}$`)

type aiThemeMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type aiThemeStyle struct {
	PackName          string `json:"packName"`
	Title             string `json:"title"`
	Notes             string `json:"notes"`
	ArtPrompt         string `json:"artPrompt"`
	EnvironmentPrompt string `json:"environmentPrompt"`
	AnimationMode     string `json:"animationMode"`
	AnimationPrompt   string `json:"animationPrompt"`
	BackgroundColor   string `json:"backgroundColor"`
	PanelColor        string `json:"panelColor"`
	TextColor         string `json:"textColor"`
	SessionColor      string `json:"sessionColor"`
	WeeklyColor       string `json:"weeklyColor"`
	ProgressStyle     string `json:"progressStyle"`
	BorderRadius      int    `json:"borderRadius"`
}

type aiThemePreviousConcept struct {
	ImageBase64          string       `json:"imageBase64"`
	ImageContentType     string       `json:"imageContentType"`
	AnimationSheetBase64 string       `json:"animationSheetBase64,omitempty"`
	Style                aiThemeStyle `json:"style"`
}

type aiThemeConceptRequest struct {
	Prompt   string                  `json:"prompt"`
	History  []aiThemeMessage        `json:"history,omitempty"`
	Previous *aiThemePreviousConcept `json:"previous,omitempty"`
}

type aiThemeConcept struct {
	ImageBase64      string            `json:"imageBase64"`
	ImageContentType string            `json:"imageContentType"`
	Style            aiThemeStyle      `json:"style"`
	Animation        *aiThemeAnimation `json:"animation,omitempty"`
}

type aiThemeAnimation struct {
	SpriteSheetBase64 string `json:"spriteSheetBase64"`
	FPS               int    `json:"fps"`
	KeyColor          string `json:"keyColor"`
}

type aiThemeGeneratedImages struct {
	BackgroundBase64 string
	AnimationSheet   string
}

type aiThemeCredentialRequest struct {
	APIKey string `json:"apiKey"`
}

type aiThemeState struct {
	enabled    bool
	devOrigins bool
	store      SecretStore
	client     *http.Client
	mu         sync.Mutex
	active     bool
	requests   []time.Time
	now        func() time.Time
}

func newAIThemeState(store SecretStore, client *http.Client) *aiThemeState {
	if store == nil {
		store = keyringSecretStore{}
	}
	if client == nil {
		client = &http.Client{Transport: http.DefaultTransport.(*http.Transport).Clone()}
	}
	clientCopy := *client
	clientCopy.Timeout = aiThemeTimeout
	clientCopy.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	return &aiThemeState{
		enabled: envBool(aiThemeEnabledEnv), devOrigins: envBool(aiThemeDevEnv),
		store: store, client: &clientCopy, now: time.Now,
	}
}

func envBool(name string) bool {
	value := strings.TrimSpace(os.Getenv(name))
	return strings.EqualFold(value, "true") || value == "1"
}

func (s *Server) registerAIThemeRoutes(mux *http.ServeMux) {
	mux.Handle("/v1/ai-theme/", s.aiThemeGuard(http.HandlerFunc(s.handleAITheme)))
	mux.Handle("/v1/ai-theme/capabilities", s.aiThemeGuard(http.HandlerFunc(s.handleAITheme)))
}

func (s *Server) aiThemeGuard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host := strings.TrimSpace(r.Host)
		hostName := strings.ToLower(host)
		if parsed, err := url.Parse("http://" + host); err == nil {
			hostName = strings.ToLower(parsed.Hostname())
		}
		if hostName != "127.0.0.1" && hostName != "localhost" && hostName != "::1" {
			writeAIThemeError(w, http.StatusForbidden, "local_access_required")
			return
		}
		origin := strings.TrimSpace(r.Header.Get("Origin"))
		expected := "http://" + host
		allowed := origin == expected
		if s.aiTheme.devOrigins && (origin == defaultDevOrigin || origin == "http://127.0.0.1:3000") {
			allowed = true
		}
		if origin == "" && strings.EqualFold(strings.TrimSpace(r.Header.Get("Sec-Fetch-Site")), "same-origin") {
			allowed = true
		}
		if origin == "" {
			if referrer, err := url.Parse(strings.TrimSpace(r.Referer())); err == nil && referrer.Scheme+"://"+referrer.Host == expected && strings.HasPrefix(referrer.Path, "/control-center") {
				allowed = true
			}
		}
		if !allowed {
			writeAIThemeError(w, http.StatusForbidden, "origin_not_allowed")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) handleAITheme(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimSuffix(r.URL.Path, "/")
	if path == "/v1/ai-theme/capabilities" {
		s.handleAIThemeCapabilities(w, r)
		return
	}
	if !s.aiTheme.enabled {
		writeAIThemeError(w, http.StatusNotFound, "feature_disabled")
		return
	}
	if path == "/v1/ai-theme/concepts" {
		s.handleAIThemeConcept(w, r)
		return
	}
	const prefix = "/v1/ai-theme/providers/"
	if !strings.HasPrefix(path, prefix) {
		http.NotFound(w, r)
		return
	}
	parts := strings.Split(strings.TrimPrefix(path, prefix), "/")
	if len(parts) != 2 || parts[0] != "openai" {
		http.NotFound(w, r)
		return
	}
	switch parts[1] {
	case "credential":
		s.handleAIThemeCredential(w, r)
	case "verify":
		s.handleAIThemeVerify(w, r)
	default:
		http.NotFound(w, r)
	}
}

func (s *Server) handleAIThemeCapabilities(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}
	_, err := s.aiTheme.store.Get("openai")
	writeJSON(w, http.StatusOK, map[string]any{
		"enabled":   s.aiTheme.enabled,
		"providers": []map[string]any{{"id": "openai", "configured": err == nil}},
		"limits":    map[string]int{"promptCharacters": aiThemePromptLimit, "historyTurns": aiThemeHistoryLimit, "localMessages": 20},
	})
}

func (s *Server) handleAIThemeCredential(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodPut:
		var req aiThemeCredentialRequest
		if !decodeJSON(w, r, &req) {
			return
		}
		key := strings.TrimSpace(req.APIKey)
		if len(key) < 16 || len(key) > 512 {
			writeAIThemeError(w, http.StatusBadRequest, "credential_invalid")
			return
		}
		if err := s.aiTheme.store.Set("openai", key); err != nil {
			writeAIThemeError(w, http.StatusInternalServerError, "credential_store_failed")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"configured": true})
	case http.MethodDelete:
		err := s.aiTheme.store.Delete("openai")
		if err != nil && !errors.Is(err, ErrSecretNotFound) {
			writeAIThemeError(w, http.StatusInternalServerError, "credential_delete_failed")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"configured": false})
	default:
		requireMethod(w, r, http.MethodPut, http.MethodDelete)
	}
}

func (s *Server) handleAIThemeVerify(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}
	key, err := s.aiTheme.store.Get("openai")
	if err != nil {
		writeAIThemeError(w, http.StatusBadRequest, "credential_missing")
		return
	}
	req, _ := http.NewRequestWithContext(r.Context(), http.MethodGet, "https://api.openai.com/v1/models/"+openAIImageModel, nil)
	setOpenAIHeaders(req, key)
	resp, err := s.aiTheme.client.Do(req)
	if err != nil {
		writeAIThemeError(w, http.StatusBadGateway, providerErrorCode(err, 0))
		return
	}
	defer resp.Body.Close()
	read, _ := io.Copy(io.Discard, io.LimitReader(resp.Body, aiThemeJSONResponseLimit+1))
	if read > aiThemeJSONResponseLimit {
		writeAIThemeError(w, http.StatusBadGateway, "provider_response_too_large")
		return
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		writeAIThemeError(w, providerStatus(resp.StatusCode), providerErrorCode(nil, resp.StatusCode))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"verified": true})
}

func (s *Server) handleAIThemeConcept(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}
	if !s.aiTheme.beginGeneration() {
		writeAIThemeError(w, http.StatusTooManyRequests, "rate_limited_or_busy")
		return
	}
	defer s.aiTheme.endGeneration()
	r.Body = http.MaxBytesReader(w, r.Body, aiThemeConceptRequestLimit)
	var req aiThemeConceptRequest
	if !decodeAIThemeConceptJSON(w, r, &req) {
		return
	}
	req.Prompt = strings.TrimSpace(req.Prompt)
	if req.Prompt == "" || len([]rune(req.Prompt)) > aiThemePromptLimit || len(req.History) > aiThemeHistoryLimit || !validAIThemeHistory(req.History) {
		writeAIThemeError(w, http.StatusBadRequest, "request_invalid")
		return
	}
	var previous []byte
	var previousAnimation []byte
	if req.Previous != nil {
		var err error
		if strings.TrimSpace(req.Previous.Style.EnvironmentPrompt) == "" {
			req.Previous.Style.EnvironmentPrompt = req.Previous.Style.ArtPrompt
		}
		previous, err = validateConceptImage(req.Previous.ImageBase64, req.Previous.ImageContentType)
		if err != nil || validateAIThemeStyle(req.Previous.Style) != nil {
			writeAIThemeError(w, http.StatusBadRequest, "previous_concept_invalid")
			return
		}
		if req.Previous.AnimationSheetBase64 != "" {
			previousAnimation, err = validateConceptImage(req.Previous.AnimationSheetBase64, "image/png")
			if err != nil {
				writeAIThemeError(w, http.StatusBadRequest, "previous_concept_invalid")
				return
			}
		}
	}
	key, err := s.aiTheme.store.Get("openai")
	if err != nil {
		writeAIThemeError(w, http.StatusBadRequest, "credential_missing")
		return
	}
	style, raw, err := s.aiTheme.planConcept(r.Context(), key, req, "")
	if err == nil {
		err = validateAIThemeStyle(style)
	}
	if err != nil && raw != "" {
		style, _, err = s.aiTheme.planConcept(r.Context(), key, req, "Repair the invalid blueprint once. Validation error: "+safeValidationError(err)+"\nInvalid blueprint: "+boundedRepairCandidate(raw))
		if err == nil {
			err = validateAIThemeStyle(style)
		}
	}
	if err != nil {
		writeAIThemeError(w, providerStatusFromError(err), providerErrorCode(err, 0))
		return
	}
	images, err := s.aiTheme.createConceptImages(r.Context(), key, style, previous, previousAnimation)
	if err != nil {
		writeAIThemeError(w, providerStatusFromError(err), providerErrorCode(err, 0))
		return
	}
	concept := aiThemeConcept{ImageBase64: images.BackgroundBase64, ImageContentType: "image/png", Style: style}
	if images.AnimationSheet != "" {
		concept.Animation = &aiThemeAnimation{
			SpriteSheetBase64: images.AnimationSheet,
			FPS:               4,
			KeyColor:          "#FF00FF",
		}
	}
	writeJSON(w, http.StatusOK, concept)
}

func decodeAIThemeConceptJSON(w http.ResponseWriter, r *http.Request, value any) bool {
	if r.Body == nil {
		writeAIThemeError(w, http.StatusBadRequest, "request_invalid")
		return false
	}
	if err := json.NewDecoder(r.Body).Decode(value); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			writeAIThemeError(w, http.StatusRequestEntityTooLarge, "request_too_large")
			return false
		}
		writeAIThemeError(w, http.StatusBadRequest, "request_invalid")
		return false
	}
	return true
}

func (a *aiThemeState) beginGeneration() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.active {
		return false
	}
	now := a.now()
	cutoff := now.Add(-aiThemeRateWindow)
	kept := a.requests[:0]
	for _, at := range a.requests {
		if at.After(cutoff) {
			kept = append(kept, at)
		}
	}
	a.requests = kept
	if len(a.requests) >= aiThemeRateLimit {
		return false
	}
	a.requests = append(a.requests, now)
	a.active = true
	return true
}

func (a *aiThemeState) endGeneration() { a.mu.Lock(); a.active = false; a.mu.Unlock() }

func (a *aiThemeState) planConcept(ctx context.Context, key string, req aiThemeConceptRequest, repair string) (aiThemeStyle, string, error) {
	ctx, cancel := context.WithTimeout(ctx, aiThemeTimeout)
	defer cancel()
	prompt := buildAIThemePlanningPrompt(req, repair)
	body := map[string]any{
		"model": openAIModel, "store": false, "max_output_tokens": aiThemeOutputTokens,
		"input": []any{
			map[string]any{"role": "system", "content": []any{map[string]any{"type": "input_text", "text": aiThemeSystemPrompt}}},
			map[string]any{"role": "user", "content": []any{map[string]any{"type": "input_text", "text": prompt}}},
		},
		"text": map[string]any{"format": map[string]any{"type": "json_schema", "name": "vibetv_screenmaster_blueprint", "strict": true, "schema": aiThemeStyleSchema()}},
	}
	encoded, _ := json.Marshal(body)
	httpReq, _ := http.NewRequestWithContext(ctx, http.MethodPost, openAIEndpoint, bytes.NewReader(encoded))
	setOpenAIHeaders(httpReq, key)
	httpReq.Header.Set("Content-Type", "application/json")
	resp, err := a.client.Do(httpReq)
	if err != nil {
		return aiThemeStyle{}, "", err
	}
	defer resp.Body.Close()
	rawBody, err := io.ReadAll(io.LimitReader(resp.Body, aiThemeJSONResponseLimit+1))
	if err != nil {
		return aiThemeStyle{}, "", err
	}
	if len(rawBody) > aiThemeJSONResponseLimit {
		return aiThemeStyle{}, "", errors.New("provider_response_too_large")
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return aiThemeStyle{}, "", fmt.Errorf("provider_status_%d", resp.StatusCode)
	}
	text, err := extractOpenAIText(rawBody)
	if err != nil {
		return aiThemeStyle{}, "", err
	}
	var style aiThemeStyle
	if json.Unmarshal([]byte(text), &style) != nil {
		return aiThemeStyle{}, text, errors.New("provider_malformed_response")
	}
	return style, text, nil
}

func (a *aiThemeState) createConceptImages(ctx context.Context, key string, style aiThemeStyle, previous, previousAnimation []byte) (aiThemeGeneratedImages, error) {
	ctx, cancel := context.WithTimeout(ctx, aiThemeTimeout)
	defer cancel()
	if style.AnimationMode != "four_frame" {
		prompt := "Create only the illustration for a tiny physical 240x240 desk display. Make a text-free, front-on 15:8 composition with one strong recognizable subject, clearly readable defining features, large simple shapes and a limited cohesive palette. No device, product mock-up, desk, frame, UI, title, letters, numbers, percentages, progress bars, logos, brackets or placeholders. The image will occupy the top 240x128 pixels. Environment: " + style.EnvironmentPrompt + ". Subject: " + style.ArtPrompt
		image, err := a.createConceptImage(ctx, key, prompt, previous)
		if err != nil {
			return aiThemeGeneratedImages{}, err
		}
		return aiThemeGeneratedImages{BackgroundBase64: image}, nil
	}

	const keyColor = "#FF00FF"
	backgroundPrompt := "Create a complete static background illustration for the top 240x128 pixels of a tiny physical desk display. Make it a text-free, front-on 15:8 scene with a strong atmosphere, large simple shapes and a limited cohesive palette. This image is environment only: do not show any character, creature, person, animal or main subject. Leave the central area visually calm so a 72x72 animated sprite can be placed over it. No device, product mock-up, desk, frame, UI, title, letters, numbers, percentages, progress bars, logos, brackets or placeholders. Environment: " + style.EnvironmentPrompt
	sheetReferenceInstruction := "Using the supplied background scene as the authoritative style reference"
	if len(previousAnimation) > 0 {
		sheetReferenceInstruction = "Using the supplied previous sprite sheet as the authoritative subject identity reference"
	}
	sheetPrompt := sheetReferenceInstruction + ", create one high-resolution sprite sheet containing exactly four frames of one seamless looping animation. The animated subject must belong naturally in the planned environment: match its art style, perspective, lighting direction, contrast and palette. Arrange the frames as four equal vertical cells in one horizontal row, ordered left to right. Keep the same isolated subject, identity, scale and camera in every cell; only the pose may change. Center each complete subject inside the square middle area of its cell. Use a perfectly flat pure magenta " + keyColor + " background across the entire image with no borders, separators, gradient, texture, shadow or reflection. Make every pose clearly readable after reduction to 72x72 pixels. Do not copy any scenery into the sprite cells. No device, product mock-up, desk, frame, UI, title, letters, numbers, percentages, progress bars, logos, brackets, labels or extra objects. Environment: " + style.EnvironmentPrompt + ". Subject: " + style.ArtPrompt + ". Motion: " + style.AnimationPrompt
	background, err := a.createConceptImage(ctx, key, backgroundPrompt, previous)
	if err != nil {
		return aiThemeGeneratedImages{}, err
	}
	backgroundBytes, err := validateConceptImage(background, "image/png")
	if err != nil {
		return aiThemeGeneratedImages{}, err
	}
	sheetReference := backgroundBytes
	if len(previousAnimation) > 0 {
		sheetReference = previousAnimation
	}
	sheet, err := a.createConceptImage(ctx, key, sheetPrompt, sheetReference)
	if err != nil {
		return aiThemeGeneratedImages{}, err
	}
	if background == "" || sheet == "" {
		return aiThemeGeneratedImages{}, errors.New("provider_malformed_response")
	}
	return aiThemeGeneratedImages{BackgroundBase64: background, AnimationSheet: sheet}, nil
}

func (a *aiThemeState) createConceptImage(ctx context.Context, key, prompt string, previous []byte) (string, error) {
	var request *http.Request
	if len(previous) == 0 {
		body, _ := json.Marshal(map[string]any{"model": openAIImageModel, "prompt": prompt, "size": openAIImageSize, "quality": openAIImageQuality, "output_format": "png", "n": 1})
		request, _ = http.NewRequestWithContext(ctx, http.MethodPost, openAIImageEndpoint, bytes.NewReader(body))
		request.Header.Set("Content-Type", "application/json")
	} else {
		var body bytes.Buffer
		writer := multipart.NewWriter(&body)
		_ = writer.WriteField("model", openAIImageModel)
		_ = writer.WriteField("prompt", prompt)
		_ = writer.WriteField("size", openAIImageSize)
		_ = writer.WriteField("quality", openAIImageQuality)
		_ = writer.WriteField("output_format", "png")
		header := make(textproto.MIMEHeader)
		header.Set("Content-Disposition", `form-data; name="image"; filename="previous.png"`)
		header.Set("Content-Type", "image/png")
		part, err := writer.CreatePart(header)
		if err != nil {
			return "", err
		}
		if _, err = part.Write(previous); err != nil {
			return "", err
		}
		_ = writer.Close()
		request, _ = http.NewRequestWithContext(ctx, http.MethodPost, openAIImageEditEndpoint, &body)
		request.Header.Set("Content-Type", writer.FormDataContentType())
	}
	setOpenAIHeaders(request, key)
	resp, err := a.client.Do(request)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, aiThemeImageResponseLimit+1))
	if err != nil {
		return "", err
	}
	if len(raw) > aiThemeImageResponseLimit {
		return "", errors.New("image_response_too_large")
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("image_provider_status_%d", resp.StatusCode)
	}
	var payload struct {
		Data []struct {
			Base64 string `json:"b64_json"`
		} `json:"data"`
	}
	if json.Unmarshal(raw, &payload) != nil || len(payload.Data) != 1 {
		return "", errors.New("provider_malformed_response")
	}
	if _, err := validateConceptImage(payload.Data[0].Base64, "image/png"); err != nil {
		return "", err
	}
	return payload.Data[0].Base64, nil
}

func setOpenAIHeaders(req *http.Request, key string) { req.Header.Set("Authorization", "Bearer "+key) }

func extractOpenAIText(body []byte) (string, error) {
	var value struct {
		Output []struct {
			Content []struct{ Type, Text string } `json:"content"`
		} `json:"output"`
	}
	if json.Unmarshal(body, &value) != nil {
		return "", errors.New("provider_malformed_response")
	}
	for _, output := range value.Output {
		for _, content := range output.Content {
			if content.Type == "output_text" {
				return content.Text, nil
			}
		}
	}
	return "", errors.New("provider_malformed_response")
}

const aiThemeSystemPrompt = `You are the lead UI designer for a physical 240 by 240 pixel desk display, not an app or product mock-up. Plan one premium firmware theme. The client owns all geometry, text and live data. You only choose a concise title, colors, atmosphere, bar treatment and text-free illustration prompts. artPrompt describes only the main recognizable subject with clearly readable defining features, large simple shapes and minimal details. environmentPrompt describes the matching scenery without that subject or any duplicate character; it must share the subject's art style, perspective, lighting and palette. For a new concept, set animationMode to four_frame only when the latest user request explicitly asks for animation, movement, a GIF or a sprite; otherwise set it to static. When refining, preserve the previous animationMode and animationPrompt unless the latest request explicitly asks to add, remove or change animation. For four_frame, animationPrompt must describe one subtle seamless motion loop. For static, animationPrompt must be an empty string. Never request text, numbers, UI, progress bars, a device, a desk or product photography in either illustration prompt. Return only the strict JSON blueprint.`

func buildAIThemePlanningPrompt(req aiThemeConceptRequest, repair string) string {
	if repair != "" {
		return repair
	}
	var b strings.Builder
	if req.Previous == nil {
		b.WriteString("Create one new screenmaster concept. Use four_frame only for an explicit animation request.\n")
	} else {
		b.WriteString("Refine the existing concept. The latest user request has priority over the previous blueprint. Change every explicitly requested visual property, including subject visibility, scale, pose, lighting, color, composition, or detail level. Preserve the existing animation mode and motion unless the user explicitly asks to change or remove animation. Preserve only what the user did not ask to change.\nPrevious blueprint: ")
		previous, _ := json.Marshal(req.Previous.Style)
		b.Write(previous)
		b.WriteByte('\n')
	}
	b.WriteString("Request: ")
	b.WriteString(req.Prompt)
	if len(req.History) > 0 {
		b.WriteString("\nRecent conversation:\n")
		for _, message := range req.History {
			b.WriteString(message.Role)
			b.WriteString(": ")
			b.WriteString(message.Content)
			b.WriteByte('\n')
		}
	}
	return b.String()
}

func validateAIThemeStyle(style aiThemeStyle) error {
	if strings.TrimSpace(style.PackName) == "" || strings.TrimSpace(style.Title) == "" || strings.TrimSpace(style.Notes) == "" || strings.TrimSpace(style.ArtPrompt) == "" || strings.TrimSpace(style.EnvironmentPrompt) == "" {
		return errors.New("blueprint_missing_fields")
	}
	if len([]rune(style.PackName)) > 48 || len([]rune(style.Title)) > 18 || len([]rune(style.Notes)) > 300 || len([]rune(style.ArtPrompt)) > 1000 || len([]rune(style.EnvironmentPrompt)) > 1000 {
		return errors.New("blueprint_fields_too_large")
	}
	for _, color := range []string{style.BackgroundColor, style.PanelColor, style.TextColor, style.SessionColor, style.WeeklyColor} {
		if !aiThemeColorPattern.MatchString(color) {
			return errors.New("blueprint_invalid_color")
		}
	}
	if style.ProgressStyle != "solid" && style.ProgressStyle != "segments" {
		return errors.New("blueprint_invalid_progress_style")
	}
	if style.AnimationMode != "static" && style.AnimationMode != "four_frame" {
		return errors.New("blueprint_invalid_animation_mode")
	}
	if style.AnimationMode == "four_frame" && strings.TrimSpace(style.AnimationPrompt) == "" {
		return errors.New("blueprint_missing_animation_prompt")
	}
	if style.AnimationMode == "static" && style.AnimationPrompt != "" {
		return errors.New("blueprint_static_animation_prompt")
	}
	if len([]rune(style.AnimationPrompt)) > 300 {
		return errors.New("blueprint_animation_prompt_too_large")
	}
	if style.BorderRadius < 0 || style.BorderRadius > 7 {
		return errors.New("blueprint_invalid_radius")
	}
	return nil
}

func validateConceptImage(value, contentType string) ([]byte, error) {
	if contentType != "image/png" || value == "" {
		return nil, errors.New("image_invalid")
	}
	decoded, err := base64.StdEncoding.DecodeString(value)
	if err != nil || len(decoded) == 0 || len(decoded) > aiThemeImageResponseLimit || len(decoded) < 8 || !bytes.Equal(decoded[:8], []byte{137, 80, 78, 71, 13, 10, 26, 10}) {
		return nil, errors.New("image_invalid")
	}
	return decoded, nil
}

func aiThemeStyleSchema() map[string]any {
	color := map[string]any{"type": "string", "pattern": "^#[A-Fa-f0-9]{6}$"}
	return map[string]any{
		"type": "object", "additionalProperties": false,
		"properties": map[string]any{
			"packName": map[string]any{"type": "string", "maxLength": 48}, "title": map[string]any{"type": "string", "maxLength": 18},
			"notes": map[string]any{"type": "string", "maxLength": 300}, "artPrompt": map[string]any{"type": "string", "maxLength": 1000},
			"environmentPrompt": map[string]any{"type": "string", "maxLength": 1000},
			"animationMode":     map[string]any{"type": "string", "enum": []string{"static", "four_frame"}},
			"animationPrompt":   map[string]any{"type": "string", "maxLength": 300},
			"backgroundColor":   color, "panelColor": color, "textColor": color, "sessionColor": color, "weeklyColor": color,
			"progressStyle": map[string]any{"type": "string", "enum": []string{"solid", "segments"}},
			"borderRadius":  map[string]any{"type": "integer", "minimum": 0, "maximum": 7},
		},
		"required": []string{"packName", "title", "notes", "artPrompt", "environmentPrompt", "animationMode", "animationPrompt", "backgroundColor", "panelColor", "textColor", "sessionColor", "weeklyColor", "progressStyle", "borderRadius"},
	}
}

func validAIThemeHistory(history []aiThemeMessage) bool {
	total := 0
	for _, message := range history {
		if (message.Role != "user" && message.Role != "assistant") || len([]rune(message.Content)) > aiThemePromptLimit {
			return false
		}
		total += len([]rune(message.Content))
	}
	return total <= aiThemePromptLimit*aiThemeHistoryLimit
}

func boundedRepairCandidate(value string) string {
	if len(value) > 8192 {
		return value[:8192]
	}
	return value
}
func safeValidationError(err error) string {
	value := err.Error()
	if len(value) > 160 {
		value = value[:160]
	}
	return value
}
func providerStatus(code int) int {
	if code == 401 || code == 403 {
		return http.StatusUnauthorized
	}
	if code == 429 {
		return http.StatusTooManyRequests
	}
	return http.StatusBadGateway
}
func providerStatusFromError(err error) int {
	value := err.Error()
	if strings.Contains(value, "401") || strings.Contains(value, "403") {
		return http.StatusUnauthorized
	}
	if strings.Contains(value, "429") {
		return http.StatusTooManyRequests
	}
	return http.StatusBadGateway
}
func providerErrorCode(err error, status int) string {
	value := errorString(err)
	if strings.Contains(value, "image_provider_status_401") || strings.Contains(value, "image_provider_status_403") {
		return "image_generation_unavailable"
	}
	if status == 401 || status == 403 || strings.Contains(value, "provider_status_401") || strings.Contains(value, "provider_status_403") {
		return "provider_auth_failed"
	}
	if status == 429 || strings.Contains(value, "429") {
		return "provider_rate_limited"
	}
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
		return "provider_timeout"
	}
	if strings.Contains(value, "too_large") {
		return "provider_response_too_large"
	}
	if strings.Contains(value, "malformed") || strings.Contains(value, "image_invalid") {
		return "provider_invalid_response"
	}
	return "provider_unavailable"
}
func errorString(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}
func writeAIThemeError(w http.ResponseWriter, status int, code string) {
	writeJSON(w, status, map[string]any{"ok": false, "error": map[string]string{"code": code, "message": "AI Theme Builder request could not be completed."}})
}
