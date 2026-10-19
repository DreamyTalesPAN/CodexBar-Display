package companionapi

import (
	"net/http"
	"net/url"
	"strings"
)

func (s *Server) withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := strings.TrimSpace(r.Header.Get("Origin"))
		allowed := s.isAllowedOrigin(origin)
		if origin != "" && !allowed {
			writeError(w, http.StatusForbidden, "cors_origin_not_allowed", "Origin is not allowed.", "Open the hosted VibeTV app or the configured local dev origin.")
			return
		}
		if origin != "" && allowed {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
			if strings.EqualFold(strings.TrimSpace(r.Header.Get("Access-Control-Request-Private-Network")), "true") {
				w.Header().Set("Access-Control-Allow-Private-Network", "true")
			}
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) isAllowedOrigin(origin string) bool {
	origin = strings.TrimSpace(origin)
	if origin == "" {
		return false
	}
	if _, allowed := s.allowedOrigins[origin]; allowed {
		return true
	}
	return isAllowedPreviewOrigin(origin)
}

func isAllowedPreviewOrigin(origin string) bool {
	parsed, err := url.Parse(strings.TrimSpace(origin))
	if err != nil {
		return false
	}
	if parsed.Scheme != "https" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return false
	}
	host := strings.ToLower(strings.TrimSpace(parsed.Hostname()))
	if host == "" || parsed.Port() != "" {
		return false
	}
	if !strings.HasPrefix(host, previewOriginHostPrefix) || !strings.HasSuffix(host, previewOriginHostSuffix) {
		return false
	}
	previewID := strings.TrimSuffix(strings.TrimPrefix(host, previewOriginHostPrefix), previewOriginHostSuffix)
	return previewID != "" && !strings.Contains(previewID, ".")
}
