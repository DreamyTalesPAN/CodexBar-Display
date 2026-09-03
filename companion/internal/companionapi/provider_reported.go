package companionapi

import (
	"regexp"
	"strings"
)

// CodexBar's own provider sentence is the only sign-in guidance that exists, so
// it is passed through -- but 0.46.0 assembles it from raw provider output.
// Templates such as "OpenAI dashboard signed in as ", "Antigravity local
// session is signed in as " and "Unexpected response body (" interpolate the
// account address, a cookie header or a whole HTTP body into the very string
// this function publishes, and the provider row offers it as a Copy button.
// CodexBar treats exactly these shapes as secret in its own log redactor and
// never applies that to the `error` field of `usage --json`, so the redaction
// has to happen here. Replace the secret-shaped span and keep the words around
// it: those words are the guidance, and a visible marker is honest where a
// silently dropped sentence would not be.
var (
	reportedHomePath = regexp.MustCompile(`(?i)/Users/[^/\s)]+`)
	// A credential-shaped key and its value: `Cookie: ...`, `sessionKey=...`,
	// `"access_token": "..."`, `?token=...&session=...`, `#token=...`. Anchored
	// at a line start or a separator -- a URL's `?`, `&` and `#` among them -- so a
	// host inside a URL (`https://auth.example.com:8443/login`) is not read as
	// a key, and the value may carry an auth scheme word so `Authorization:
	// Bearer x` collapses to one marker instead of two. A value ends at `&` or
	// `#`, so the next pair is judged on its own.
	reportedCredentialPair = regexp.MustCompile(`(?im)((?:^|[\s,{(\[?&#])["']?[A-Za-z0-9._-]*(?:token|cookie|secret|key|session|auth|password|bearer)[A-Za-z0-9._-]*["']?\s*[:=]\s*)(?:bearer\s+|basic\s+)?(?:"[^"]*"|'[^']*'|[^\s,;&#)\]}"']*[^\s,;&#)\]}"'.])`)
	// One prose family is evidenced in the pinned engine and must survive:
	// "Safari cookies: permission denied for ...", "Chrome cookies: missing
	// auth cookie", "Firefox cookies: missing ory_session_* cookie". Without
	// this the rule ate the one word that says what went wrong and left the
	// private path standing. Nothing else gets the benefit: `token: letmein`
	// and `password=hunter` are values however short.
	reportedPlainWord = regexp.MustCompile(`^[A-Za-z]{1,15}$`)
	reportedProseKey  = regexp.MustCompile(`(?i)cookies:\s*$`)
	// The same credential with no key in front of it. It is the only rule that
	// catches a short scheme-prefixed token (`Bearer abc12345`); a long one is
	// caught by reportedOpaque.
	reportedBearer = regexp.MustCompile(`(?i)\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}`)
	reportedEmail  = regexp.MustCompile(`[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}`)
	// A long opaque run, redacted only where it mixes letters and digits: that
	// keeps ordinary words and path segments (`globalStorage`) intact while
	// catching a bare `sk-ant-...` or a JWT that arrived without a key.
	reportedOpaque = regexp.MustCompile(`[A-Za-z0-9_-]{24,}`)
	reportedDigit  = regexp.MustCompile(`[0-9]`)
	reportedLetter = regexp.MustCompile(`[A-Za-z]`)
)

const reportedRedacted = "[redacted]"

// reportedProviderMessage keeps the usage service's sentence and replaces the
// secret-shaped material inside it with a visible marker.
func reportedProviderMessage(raw string) string {
	message := strings.TrimSpace(raw)
	if message == "" {
		return ""
	}
	// Order matters: a redacted span must never be rescanned as a secret, and
	// the pair rule must claim `Authorization: Bearer x` before the bare rule.
	message = reportedHomePath.ReplaceAllString(message, "~")
	message = reportedCredentialPair.ReplaceAllStringFunc(message, func(match string) string {
		idx := reportedCredentialPair.FindStringSubmatchIndex(match)
		if idx == nil {
			return match
		}
		prefix, value := match[idx[2]:idx[3]], match[idx[3]:]
		if reportedPlainWord.MatchString(value) && reportedProseKey.MatchString(prefix) {
			return match
		}
		return prefix + reportedRedacted
	})
	message = reportedBearer.ReplaceAllString(message, "${1} "+reportedRedacted)
	message = reportedEmail.ReplaceAllString(message, reportedRedacted)
	return reportedOpaque.ReplaceAllStringFunc(message, func(run string) string {
		if reportedDigit.MatchString(run) && reportedLetter.MatchString(run) {
			return reportedRedacted
		}
		return run
	})
}
