package companionapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/themespec"
)

const (
	aiThemeEnabledEnv     = "VIBETV_AI_THEME_ENABLED"
	aiThemeDevEnv         = "VIBETV_AI_THEME_DEV_ORIGINS"
	aiThemePromptLimit    = 2000
	aiThemeHistoryLimit   = 10
	aiThemePrimitiveLimit = 16
	aiThemeResponseLimit  = 128 << 10
	aiThemeOutputTokens   = 4096
	aiThemeTimeout        = 45 * time.Second
	aiThemeRateWindow     = 10 * time.Minute
	aiThemeRateLimit      = 5
	openAIEndpoint        = "https://api.openai.com/v1/responses"
	openAIModel           = "gpt-5.6-terra"
	anthropicEndpoint     = "https://api.anthropic.com/v1/messages"
	anthropicModel        = "claude-sonnet-5"
)

type aiThemeMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}
type aiThemeGenerationRequest struct {
	ProviderID string           `json:"providerId"`
	Mode       string           `json:"mode"`
	Prompt     string           `json:"prompt"`
	BaseSpec   json.RawMessage  `json:"baseSpec,omitempty"`
	History    []aiThemeMessage `json:"history,omitempty"`
}
type aiThemeCandidate struct {
	PackName string          `json:"packName"`
	Spec     json.RawMessage `json:"spec"`
	Notes    string          `json:"notes"`
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
		transport := http.DefaultTransport.(*http.Transport).Clone()
		client = &http.Client{Transport: transport}
	}
	clientCopy := *client
	clientCopy.Timeout = aiThemeTimeout
	clientCopy.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	return &aiThemeState{
		enabled:    strings.EqualFold(strings.TrimSpace(os.Getenv(aiThemeEnabledEnv)), "true") || strings.TrimSpace(os.Getenv(aiThemeEnabledEnv)) == "1",
		devOrigins: strings.EqualFold(strings.TrimSpace(os.Getenv(aiThemeDevEnv)), "true") || strings.TrimSpace(os.Getenv(aiThemeDevEnv)) == "1",
		store:      store, client: &clientCopy, now: time.Now,
	}
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
	if path == "/v1/ai-theme/generations" {
		s.handleAIThemeGeneration(w, r)
		return
	}
	const prefix = "/v1/ai-theme/providers/"
	if !strings.HasPrefix(path, prefix) {
		http.NotFound(w, r)
		return
	}
	parts := strings.Split(strings.TrimPrefix(path, prefix), "/")
	if len(parts) != 2 || !validAIThemeProvider(parts[0]) {
		http.NotFound(w, r)
		return
	}
	switch parts[1] {
	case "credential":
		s.handleAIThemeCredential(w, r, parts[0])
	case "verify":
		s.handleAIThemeVerify(w, r, parts[0])
	default:
		http.NotFound(w, r)
	}
}

func (s *Server) handleAIThemeCapabilities(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}
	providers := []map[string]any{}
	for _, id := range []string{"openai", "anthropic"} {
		_, err := s.aiTheme.store.Get(id)
		providers = append(providers, map[string]any{"id": id, "configured": err == nil})
	}
	writeJSON(w, http.StatusOK, map[string]any{"enabled": s.aiTheme.enabled, "providers": providers, "limits": map[string]int{"promptCharacters": aiThemePromptLimit, "historyTurns": aiThemeHistoryLimit, "localMessages": 20, "generatedPrimitives": aiThemePrimitiveLimit}})
}

func (s *Server) handleAIThemeCredential(w http.ResponseWriter, r *http.Request, provider string) {
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
		if err := s.aiTheme.store.Set(provider, key); err != nil {
			writeAIThemeError(w, http.StatusInternalServerError, "credential_store_failed")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"configured": true})
	case http.MethodDelete:
		err := s.aiTheme.store.Delete(provider)
		if err != nil && !errors.Is(err, ErrSecretNotFound) {
			writeAIThemeError(w, http.StatusInternalServerError, "credential_delete_failed")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"configured": false})
	default:
		requireMethod(w, r, http.MethodPut, http.MethodDelete)
	}
}

func (s *Server) handleAIThemeVerify(w http.ResponseWriter, r *http.Request, provider string) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}
	key, err := s.aiTheme.store.Get(provider)
	if err != nil {
		writeAIThemeError(w, http.StatusBadRequest, "credential_missing")
		return
	}
	endpoint := "https://api.openai.com/v1/models/" + openAIModel
	if provider == "anthropic" {
		endpoint = "https://api.anthropic.com/v1/models/" + anthropicModel
	}
	req, _ := http.NewRequestWithContext(r.Context(), http.MethodGet, endpoint, nil)
	setAIThemeHeaders(req, provider, key)
	resp, err := s.aiTheme.client.Do(req)
	if err != nil {
		writeAIThemeError(w, http.StatusBadGateway, providerErrorCode(err, 0))
		return
	}
	defer resp.Body.Close()
	read, _ := io.Copy(io.Discard, io.LimitReader(resp.Body, aiThemeResponseLimit+1))
	if read > aiThemeResponseLimit {
		writeAIThemeError(w, http.StatusBadGateway, "provider_response_too_large")
		return
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		writeAIThemeError(w, providerStatus(resp.StatusCode), providerErrorCode(nil, resp.StatusCode))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"verified": true})
}

func (s *Server) handleAIThemeGeneration(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}
	if !s.aiTheme.beginGeneration() {
		writeAIThemeError(w, http.StatusTooManyRequests, "rate_limited_or_busy")
		return
	}
	defer s.aiTheme.endGeneration()
	var req aiThemeGenerationRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	req.ProviderID = strings.TrimSpace(strings.ToLower(req.ProviderID))
	req.Prompt = strings.TrimSpace(req.Prompt)
	if !validAIThemeProvider(req.ProviderID) || (req.Mode != "create" && req.Mode != "improve") || req.Prompt == "" || len([]rune(req.Prompt)) > aiThemePromptLimit || len(req.History) > aiThemeHistoryLimit {
		writeAIThemeError(w, http.StatusBadRequest, "request_invalid")
		return
	}
	if !validAIThemeHistory(req.History) {
		writeAIThemeError(w, http.StatusBadRequest, "request_invalid")
		return
	}
	if req.Mode == "improve" && len(req.BaseSpec) == 0 {
		writeAIThemeError(w, http.StatusBadRequest, "base_spec_required")
		return
	}
	if len(req.BaseSpec) > 4096 || bytes.Contains(bytes.ToLower(req.BaseSpec), []byte("base64")) || bytes.Contains(bytes.ToLower(req.BaseSpec), []byte("http")) {
		writeAIThemeError(w, http.StatusBadRequest, "base_spec_invalid")
		return
	}
	key, err := s.aiTheme.store.Get(req.ProviderID)
	if err != nil {
		writeAIThemeError(w, http.StatusBadRequest, "credential_missing")
		return
	}
	candidate, raw, err := s.aiTheme.generate(r.Context(), key, req, "")
	if err == nil {
		err = validateAIThemeCandidate(candidate, req)
	}
	if err != nil && raw != "" {
		candidate, _, err = s.aiTheme.generate(r.Context(), key, req, "Repair this invalid candidate exactly once. Return a valid candidate only. Validation error: "+safeValidationError(err)+"\nInvalid candidate: "+boundedRepairCandidate(raw))
		if err == nil {
			err = validateAIThemeCandidate(candidate, req)
		}
	}
	if err != nil {
		writeAIThemeError(w, providerStatusFromError(err), providerErrorCode(err, 0))
		return
	}
	writeJSON(w, http.StatusOK, candidate)
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

func (a *aiThemeState) generate(ctx context.Context, key string, req aiThemeGenerationRequest, repair string) (aiThemeCandidate, string, error) {
	ctx, cancel := context.WithTimeout(ctx, aiThemeTimeout)
	defer cancel()
	prompt := buildAIThemePrompt(req, repair)
	var body map[string]any
	endpoint := openAIEndpoint
	if req.ProviderID == "openai" {
		body = map[string]any{"model": openAIModel, "store": false, "max_output_tokens": aiThemeOutputTokens, "input": []any{map[string]any{"role": "system", "content": []any{map[string]any{"type": "input_text", "text": aiThemeSystemPrompt}}}, map[string]any{"role": "user", "content": []any{map[string]any{"type": "input_text", "text": prompt}}}}, "text": map[string]any{"format": map[string]any{"type": "json_schema", "name": "vibetv_theme_candidate", "strict": true, "schema": aiThemeCandidateSchema()}}}
	} else {
		endpoint = anthropicEndpoint
		body = map[string]any{"model": anthropicModel, "max_tokens": aiThemeOutputTokens, "system": aiThemeSystemPrompt, "messages": []any{map[string]any{"role": "user", "content": prompt}}, "output_config": map[string]any{"format": map[string]any{"type": "json_schema", "schema": aiThemeCandidateSchema()}}}
	}
	encoded, _ := json.Marshal(body)
	httpReq, _ := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(encoded))
	setAIThemeHeaders(httpReq, req.ProviderID, key)
	httpReq.Header.Set("Content-Type", "application/json")
	resp, err := a.client.Do(httpReq)
	if err != nil {
		return aiThemeCandidate{}, "", err
	}
	defer resp.Body.Close()
	rawBody, err := io.ReadAll(io.LimitReader(resp.Body, aiThemeResponseLimit+1))
	if err != nil {
		return aiThemeCandidate{}, "", err
	}
	if len(rawBody) > aiThemeResponseLimit {
		return aiThemeCandidate{}, "", errors.New("provider_response_too_large")
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return aiThemeCandidate{}, "", fmt.Errorf("provider_status_%d", resp.StatusCode)
	}
	text, err := extractAIThemeText(req.ProviderID, rawBody)
	if err != nil {
		return aiThemeCandidate{}, "", err
	}
	var candidate aiThemeCandidate
	if err := json.Unmarshal([]byte(text), &candidate); err != nil {
		return aiThemeCandidate{}, text, errors.New("provider_malformed_response")
	}
	return candidate, text, nil
}

func setAIThemeHeaders(req *http.Request, provider, key string) {
	if provider == "openai" {
		req.Header.Set("Authorization", "Bearer "+key)
	} else {
		req.Header.Set("x-api-key", key)
		req.Header.Set("anthropic-version", "2023-06-01")
	}
}

func extractAIThemeText(provider string, body []byte) (string, error) {
	if provider == "anthropic" {
		var v struct {
			Content []struct{ Type, Text string } `json:"content"`
		}
		if json.Unmarshal(body, &v) != nil {
			return "", errors.New("provider_malformed_response")
		}
		for _, c := range v.Content {
			if c.Type == "text" {
				return c.Text, nil
			}
		}
	} else {
		var v struct {
			Output []struct {
				Content []struct{ Type, Text string } `json:"content"`
			} `json:"output"`
		}
		if json.Unmarshal(body, &v) != nil {
			return "", errors.New("provider_malformed_response")
		}
		for _, o := range v.Output {
			for _, c := range o.Content {
				if c.Type == "output_text" {
					return c.Text, nil
				}
			}
		}
	}
	return "", errors.New("provider_malformed_response")
}

const aiThemeSystemPrompt = "You design safe declarative 240x240 VibeTV themes. Return only the requested JSON. Use at most 16 primitives. New themes may use rect, text, progress, and pixels only. Never emit URLs, base64, asset paths, secrets, or executable content. Preserve useful usage bindings such as session and weekly when improving a theme."

func buildAIThemePrompt(req aiThemeGenerationRequest, repair string) string {
	if repair != "" {
		return repair
	}
	var b strings.Builder
	b.WriteString("Mode: ")
	b.WriteString(req.Mode)
	b.WriteString("\nRequest: ")
	b.WriteString(req.Prompt)
	if len(req.BaseSpec) > 0 {
		b.WriteString("\nExisting ThemeSpec (asset bytes are intentionally omitted): ")
		b.Write(req.BaseSpec)
	}
	if len(req.History) > 0 {
		b.WriteString("\nRecent conversation:\n")
		for _, m := range req.History {
			b.WriteString(m.Role)
			b.WriteString(": ")
			b.WriteString(m.Content)
			b.WriteByte('\n')
		}
	}
	return b.String()
}

func validateAIThemeCandidate(candidate aiThemeCandidate, req aiThemeGenerationRequest) error {
	if strings.TrimSpace(candidate.PackName) == "" || len(candidate.Spec) == 0 {
		return errors.New("candidate_missing_fields")
	}
	if len([]rune(candidate.PackName)) > 80 || len([]rune(candidate.Notes)) > 500 {
		return errors.New("candidate_fields_too_large")
	}
	if len(candidate.Spec) > 4096 || bytes.Contains(bytes.ToLower(candidate.Spec), []byte("http")) || bytes.Contains(bytes.ToLower(candidate.Spec), []byte("base64")) {
		return errors.New("candidate_forbidden_content")
	}
	spec, _, err := themespec.Parse(candidate.Spec)
	if err != nil {
		return err
	}
	if err = themespec.Validate(spec); err != nil {
		return err
	}
	if len(spec.Primitives) > aiThemePrimitiveLimit {
		return errors.New("candidate_too_many_primitives")
	}
	allowedAssets := map[string]struct{}{}
	requiredBindings := map[string]bool{}
	if req.Mode == "improve" {
		base, _, baseErr := themespec.Parse(req.BaseSpec)
		if baseErr != nil {
			return errors.New("base_spec_invalid")
		}
		for _, primitive := range base.Primitives {
			collectAIThemeAssets(primitive, allowedAssets)
			if primitive.Binding == "session" || primitive.Binding == "weekly" {
				requiredBindings[primitive.Binding] = true
			}
		}
	}
	for _, p := range spec.Primitives {
		if p.X < 0 || p.Y < 0 || p.X > 239 || p.Y > 239 || p.Width < 0 || p.Height < 0 || p.X+p.Width > 240 || p.Y+p.Height > 240 {
			return errors.New("candidate_out_of_bounds")
		}
		if req.Mode == "create" && p.Type != "rect" && p.Type != "text" && p.Type != "progress" && p.Type != "pixels" {
			return errors.New("candidate_unsupported_primitive")
		}
		if req.Mode == "create" && (p.AssetPath != "" || len(p.StateAssets) > 0) {
			return errors.New("candidate_new_asset_reference")
		}
		if req.Mode == "improve" {
			candidateAssets := map[string]struct{}{}
			collectAIThemeAssets(p, candidateAssets)
			for asset := range candidateAssets {
				if _, ok := allowedAssets[asset]; !ok {
					return errors.New("candidate_new_asset_reference")
				}
			}
			if p.Binding == "session" || p.Binding == "weekly" {
				delete(requiredBindings, p.Binding)
			}
		}
	}
	if len(requiredBindings) > 0 {
		return errors.New("candidate_usage_binding_removed")
	}
	return nil
}

func collectAIThemeAssets(primitive themespec.Primitive, assets map[string]struct{}) {
	if primitive.AssetPath != "" {
		assets[primitive.AssetPath] = struct{}{}
	}
	for _, asset := range primitive.StateAssets {
		if asset != "" {
			assets[asset] = struct{}{}
		}
	}
}

func aiThemeCandidateSchema() map[string]any {
	coordinateProperties := func(kind string) map[string]any {
		return map[string]any{"type": map[string]any{"type": "string", "const": kind}, "x": map[string]any{"type": "integer", "minimum": 0, "maximum": 239}, "y": map[string]any{"type": "integer", "minimum": 0, "maximum": 239}}
	}
	object := func(kind string, extra map[string]any) map[string]any {
		properties := coordinateProperties(kind)
		required := []string{"type", "x", "y"}
		for name, value := range extra {
			properties[name] = value
			required = append(required, name)
		}
		return map[string]any{"type": "object", "additionalProperties": false, "properties": properties, "required": required}
	}
	color := map[string]any{"type": "string", "pattern": "^#[A-Fa-f0-9]{6}$"}
	dimension := map[string]any{"type": "integer", "minimum": 1, "maximum": 240}
	primitive := map[string]any{"anyOf": []any{
		object("rect", map[string]any{"width": dimension, "height": dimension, "color": color, "bgColor": color, "borderColor": color, "borderRadius": map[string]any{"type": "integer", "minimum": 0, "maximum": 120}}),
		object("text", map[string]any{"text": map[string]any{"type": "string", "maxLength": 120}, "binding": map[string]any{"type": "string", "maxLength": 32}, "fontSize": map[string]any{"type": "integer", "minimum": 1, "maximum": 8}, "color": color, "bgColor": color}),
		object("progress", map[string]any{"width": dimension, "height": dimension, "binding": map[string]any{"type": "string", "maxLength": 32}, "color": color, "bgColor": color, "borderColor": color, "borderRadius": map[string]any{"type": "integer", "minimum": 0, "maximum": 120}}),
		object("pixels", map[string]any{"width": dimension, "height": dimension, "data": map[string]any{"type": "string", "maxLength": 2048}, "p": map[string]any{"type": "array", "maxItems": 16, "items": color}, "r": map[string]any{"type": "array", "maxItems": 32, "items": map[string]any{"type": "string", "maxLength": 64}}}),
		object("gif", map[string]any{"width": dimension, "height": dimension, "assetPath": map[string]any{"type": "string", "maxLength": 31}}),
		object("sprite", map[string]any{"width": dimension, "height": dimension, "assetPath": map[string]any{"type": "string", "maxLength": 31}}),
	}}
	spec := map[string]any{"type": "object", "additionalProperties": false, "properties": map[string]any{"themeSpecVersion": map[string]any{"type": "integer", "const": 1}, "themeId": map[string]any{"type": "string", "pattern": "^[a-z0-9][a-z0-9_-]{2,63}$"}, "themeRev": map[string]any{"type": "integer", "minimum": 1}, "bgColor": color, "primitives": map[string]any{"type": "array", "minItems": 1, "maxItems": 16, "items": primitive}}, "required": []string{"themeSpecVersion", "themeId", "themeRev", "bgColor", "primitives"}}
	return map[string]any{"type": "object", "additionalProperties": false, "properties": map[string]any{"packName": map[string]any{"type": "string", "maxLength": 80}, "spec": spec, "notes": map[string]any{"type": "string", "maxLength": 500}}, "required": []string{"packName", "spec", "notes"}}
}

func validAIThemeProvider(id string) bool { return id == "openai" || id == "anthropic" }
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
	const limit = 8192
	if len(value) > limit {
		return value[:limit]
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
	if status == 401 || status == 403 || strings.Contains(errorString(err), "401") || strings.Contains(errorString(err), "403") {
		return "provider_auth_failed"
	}
	if status == 429 || strings.Contains(errorString(err), "429") {
		return "provider_rate_limited"
	}
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
		return "provider_timeout"
	}
	if strings.Contains(errorString(err), "too_large") {
		return "provider_response_too_large"
	}
	if strings.Contains(errorString(err), "malformed") {
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
