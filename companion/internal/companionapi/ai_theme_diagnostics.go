package companionapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"unicode"
)

// Preserve bounded, redacted evidence for a failed connection check. Never log
// raw replies, credentials or headers; the caller alone receives diagnostics.
func writeAIThemeVerificationError(w http.ResponseWriter, key string, err error, status int, body []byte, requestID string) {
	var payload struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	_ = json.Unmarshal(body, &payload)
	code := providerErrorCode(err, status)
	if err == nil {
		switch {
		case status == 404:
			code = "provider_model_unavailable"
		case status == 403:
			code = "provider_permission_denied"
		case status == 429 && (payload.Error.Code == "insufficient_quota" || payload.Error.Code == "credit_balance_exhausted" || payload.Error.Code == "organization_spend_limit_exceeded" || payload.Error.Code == "project_spend_limit_exceeded" || payload.Error.Code == "organization_usage_limit_exceeded"):
			code = "provider_quota_exhausted"
		}
	}
	detail := map[string]any{"code": code, "stage": "connection", "model": openAIImageModel, "reason": safeAIThemeReason(payload.Error.Message, key)}
	if err != nil && detail["reason"] == "" {
		detail["reason"] = safeAIThemeReason(err.Error(), key)
	}
	if status >= 100 && status <= 599 {
		detail["providerStatus"] = status
	}
	for name, value := range map[string]string{"providerCode": payload.Error.Code, "requestId": requestID} {
		if len(value) <= 128 && aiThemeDiagnosticToken.MatchString(value) && !strings.Contains(value, key) && !aiThemeKeyPattern.MatchString(value) {
			detail[name] = value
		}
	}
	writeJSON(w, providerStatus(status), map[string]any{"ok": false, "error": detail})
}

var aiThemeDiagnosticToken = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)

// Request-scoped diagnostics only: no prompts, images, raw provider responses
// or credentials are logged or persisted.
type aiThemeDiagnosticError struct {
	Cause      error
	Stage      string
	Reason     string
	Assessment bool
}

func (e *aiThemeDiagnosticError) Error() string { return e.Cause.Error() }
func (e *aiThemeDiagnosticError) Unwrap() error { return e.Cause }

func aiThemeErrorAtStage(err error, stage string) error {
	var diagnostic *aiThemeDiagnosticError
	if errors.As(err, &diagnostic) {
		diagnostic.Stage = stage
		return diagnostic
	}
	return &aiThemeDiagnosticError{Cause: err, Stage: stage}
}

var aiThemeKeyPattern = regexp.MustCompile(`sk-[A-Za-z0-9_-]+`)

func safeAIThemeReason(reason, key string) string {
	if key != "" {
		reason = strings.ReplaceAll(reason, key, "[redacted]")
	}
	reason = aiThemeKeyPattern.ReplaceAllString(reason, "[redacted]")
	reason = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) || unicode.Is(unicode.Cf, r) {
			return ' '
		}
		return r
	}, reason)
	runes := []rune(strings.Join(strings.Fields(reason), " "))
	if len(runes) > 300 {
		runes = runes[:300]
	}
	return string(runes)
}

func aiThemeQualityFailure(stage, reason string, assessment bool) error {
	return &aiThemeDiagnosticError{Cause: errors.New("animation_quality_failed"), Stage: stage, Reason: reason, Assessment: assessment}
}

func writeAIThemeConceptError(w http.ResponseWriter, err error) {
	var diagnostic *aiThemeDiagnosticError
	if !errors.As(err, &diagnostic) {
		writeAIThemeError(w, providerStatusFromError(err), providerErrorCode(err, 0))
		return
	}
	writeJSON(w, providerStatusFromError(err), map[string]any{"ok": false, "error": map[string]any{
		"code":    providerErrorCode(err, 0),
		"message": "AI Theme Builder request could not be completed.",
		"stage":   diagnostic.Stage, "reason": diagnostic.Reason, "assessment": diagnostic.Assessment,
	}})
}
