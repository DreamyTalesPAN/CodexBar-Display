package companionapi

import (
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
)

type statusAPIError struct {
	status int
	api    apiError
}

func (e *statusAPIError) Error() string {
	if e == nil {
		return ""
	}
	return e.api.Message
}

func requireMethod(w http.ResponseWriter, r *http.Request, methods ...string) bool {
	for _, method := range methods {
		if r.Method == method {
			return true
		}
	}
	writeMethodNotAllowed(w)
	return false
}

func decodeOptionalJSON(w http.ResponseWriter, r *http.Request, v any) bool {
	if r.Body == nil {
		return true
	}
	data, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", "Request body could not be read.", "Send a valid JSON request.")
		return false
	}
	if len(strings.TrimSpace(string(data))) == 0 {
		return true
	}
	if err := json.Unmarshal(data, v); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", "Request body must be valid JSON.", "Send a valid JSON request.")
		return false
	}
	return true
}

func decodeJSON(w http.ResponseWriter, r *http.Request, v any) bool {
	if r.Body == nil {
		writeError(w, http.StatusBadRequest, "invalid_json", "Request body is required.", "Send a valid JSON request.")
		return false
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(v); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", "Request body must be valid JSON.", "Send a valid JSON request.")
		return false
	}
	return true
}

func writeDeviceNotFound(w http.ResponseWriter) {
	writeError(w, http.StatusNotFound, "device_not_found", "No VibeTV device was found.", "Restart VibeTV, wait until it shows WiFi connected, then run setup again.")
}

func writeInvalidDeviceTarget(w http.ResponseWriter) {
	writeError(w, http.StatusBadRequest, "invalid_device_target", "VibeTV target is invalid.", "Enter the IP address shown on the VibeTV screen without a path, username, password, query, or fragment.")
}

func writeMethodNotAllowed(w http.ResponseWriter) {
	writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "HTTP method is not allowed.", "Use the documented method for this endpoint.")
}

func writeInternalError(w http.ResponseWriter, err error) {
	_ = err
	writeError(w, http.StatusInternalServerError, "internal_error", "The companion could not complete the request.", "Restart the companion and retry.")
}

var sensitiveQueryValuePattern = regexp.MustCompile(`(?i)([?&](?:token|auth|key|secret)=)[^&\s"]+`)

var sensitiveURLUserInfoPattern = regexp.MustCompile(`(?i)\b(https?://)[^/\s"@]+@`)

var publicLogURLPattern = regexp.MustCompile(`https?://[^\s)]+`)

func sanitizeLogLine(line string) string {
	return publicLogURLPattern.ReplaceAllStringFunc(line, func(raw string) string {
		parsed, err := url.Parse(raw)
		if err != nil {
			return raw
		}
		parsed.User = nil
		parsed.RawQuery = ""
		parsed.Fragment = ""
		return parsed.String()
	})
}

func sanitizeErrorDetail(err error) string {
	if err == nil {
		return ""
	}
	detail := strings.TrimSpace(err.Error())
	if detail == "" {
		return ""
	}
	detail = sensitiveURLUserInfoPattern.ReplaceAllString(detail, "${1}<redacted>@")
	detail = sensitiveQueryValuePattern.ReplaceAllString(detail, "${1}<redacted>")
	if len(detail) > 240 {
		detail = detail[:237] + "..."
	}
	return detail
}

func writeError(w http.ResponseWriter, status int, code, message, nextAction string) {
	writeJSON(w, status, errorResponse{
		OK: false,
		Error: apiError{
			Code:       code,
			Message:    message,
			NextAction: nextAction,
		},
	})
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func uniqueStrings(values ...string) []string {
	out := make([]string, 0, len(values))
	seen := map[string]struct{}{}
	for _, value := range values {
		value = normalizeTarget(value)
		if value == "" {
			continue
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	return out
}
