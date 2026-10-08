package companionapi

import (
	"regexp"
	"strings"
)

const reportedHomeNameWord = `[^\\/\s"<>|:*?;,]+`

const reportedCredentialName = `[A-Za-z0-9._-]*(?:token|cookie|secret|key|session|auth|pass(?:word|phrase|code)|bearer|credential)[A-Za-z0-9._-]*`

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
	// The folder under the home root is the account name: `/Users/<name>`,
	// `/home/<name>` and, from the Windows engine, `C:\Users\<name>` on any
	// drive, with either slash, in JSON with doubled backslashes. A name may
	// hold spaces, apostrophes and brackets (`Jane O'Doe`, `Jane (Work)`), so
	// the whole component goes: words joined by single spaces through the
	// separator that ends them, otherwise everything up to closing
	// punctuation. Words after an unterminated name go with it: a support
	// report may lose some prose but never part of the account name. `/home`
	// counts only where it starts a path, so a web address
	// (`example.com/home/...`) stays whole.
	reportedHomePath = regexp.MustCompile(`(?i)(?:\b[A-Z]:[\\/]+Users|/Users|(^|[^A-Za-z0-9.-])/home)[\\/]+` +
		`(?:` + reportedHomeNameWord + `(?: ` + reportedHomeNameWord + `)*?([\\/])|[^\\/\r\n"<>|:*?)\]},;]+)`)
	// URL userinfo carries credentials before the host (`https://token@host` or
	// `https://user:pass@host`).
	// Redact it as one span so neither the username nor password reaches the UI.
	reportedURLUserinfo = regexp.MustCompile(`(?i)([a-z][a-z0-9+.-]*://)[^/@\s?#]+@`)
	// A Cookie request header can contain several semicolon-separated pairs.
	// Redact the complete header value; otherwise the generic pair rule stops at
	// the first semicolon and can leave later cookies visible.
	reportedCookieHeader = regexp.MustCompile(`(?im)((?:^|[\s,{(\[])cookie\s*:\s*)[^\r\n]*`)
	// A credential key whose value is a JSON object or array can contain short
	// nested secrets. Redact the rest of that line before the pair scanner can
	// consume only the opening delimiter and skip the nested key.
	reportedStructuredCredential = regexp.MustCompile(`(?is)((?:^|[\s,;{(\[?&#])["']?` + reportedCredentialName + `["']?\s*[:=]\s*)[\{\[].*$`)
	// A credential-shaped key and its value: `Cookie: ...`, `sessionKey=...`,
	// `"access_token": "..."`, `?token=...&session=...`, `#token=...`. Anchored
	// at a line start or a separator -- a URL's `?`, `&` and `#` and a list's
	// `,` and `;` among them, so `path=~;token=...` loses its token -- so a
	// host inside a URL (`https://auth.example.com:8443/login`) is not read as
	// a key, and the value may carry an auth scheme word so `Authorization:
	// Bearer x` collapses to one marker instead of two. A value ends at `&` or
	// `#`, so the next pair is judged on its own.
	reportedCredentialPair = regexp.MustCompile(`(?im)((?:^|[\s,;{(\[?&#])["']?` + reportedCredentialName + `["']?\s*[:=]\s*)(?:bearer\s+|basic\s+)?(?:"[^"]*"|'[^']*'|[^\s,;&#)\]}"']*[^\s,;&#)\]}"'.])`)
	// One prose family is evidenced in the pinned engine and must survive:
	// "Safari cookies: permission denied for ...", "Chrome cookies: missing
	// auth cookie", "Firefox cookies: missing ory_session_* cookie". Without
	// this the rule ate the one word that says what went wrong and left the
	// private path standing. Only the evidenced diagnostic starts get that
	// benefit: arbitrary cookie, token and password values remain secrets.
	reportedCookieProse = regexp.MustCompile(`(?i)cookies:\s*(?:missing|permission)$`)
	// The Windows engine joins what each source answered as "<source>:
	// <error>" with the sources Web, OAuth and CLI. That "OAuth:" is a label
	// in front of a sentence ("OAuth: OAuth error: ... rate limited"), not a
	// credential key. Only a sentence after it is prose: a plain word and a
	// second one behind a space. One token is a value however it is spelled,
	// and `OAuth=...` and any longer key stay secrets.
	reportedSourceLabel    = regexp.MustCompile(`^[^A-Za-z]?OAuth:\s+[A-Za-z]+$`)
	reportedSentenceGoesOn = regexp.MustCompile(`^ [A-Za-z]`)
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
	// CodexBar runs inside VibeTV and the customer never sees it, so its
	// Gemini migration remedy names the provider by itself: "Enable
	// Antigravity", not "Enable CodexBar's Antigravity provider". The Windows
	// app bundles Win-CodexBar, so its name is covered too.
	reportedCodexBarAntigravity = regexp.MustCompile(`(?i)\b(?:Win-)?CodexBar's Antigravity provider\b`)
)

const reportedRedacted = "[redacted]"

// reportedProviderMessage keeps the usage service's sentence and replaces the
// secret-shaped material inside it with a visible marker.
func reportedProviderMessage(raw string) string {
	message := strings.TrimSpace(raw)
	if message == "" {
		return ""
	}
	message = reportedCodexBarAntigravity.ReplaceAllString(message, "Antigravity")
	// Order matters: a redacted span must never be rescanned as a secret, and
	// the pair rule must claim `Authorization: Bearer x` before the bare rule.
	message = reportedHomePath.ReplaceAllString(message, "${1}~${2}")
	message = reportedURLUserinfo.ReplaceAllString(message, "${1}"+reportedRedacted+"@")
	message = reportedCookieHeader.ReplaceAllString(message, "${1}"+reportedRedacted)
	message = reportedStructuredCredential.ReplaceAllString(message, "${1}\""+reportedRedacted+"\"")
	// By hand rather than with ReplaceAllStringFunc: the source label is
	// judged by what follows the match.
	var pairs strings.Builder
	end := 0
	for _, idx := range reportedCredentialPair.FindAllStringSubmatchIndex(message, -1) {
		match, prefix := message[idx[0]:idx[1]], message[idx[2]:idx[3]]
		pairs.WriteString(message[end:idx[0]])
		end = idx[1]
		if reportedCookieProse.MatchString(match[idx[2]-idx[0]:]) ||
			reportedSourceLabel.MatchString(match) && reportedSentenceGoesOn.MatchString(message[end:]) {
			pairs.WriteString(match)
			continue
		}
		pairs.WriteString(prefix + reportedRedacted)
	}
	message = pairs.String() + message[end:]
	message = reportedBearer.ReplaceAllString(message, "${1} "+reportedRedacted)
	message = reportedEmail.ReplaceAllString(message, reportedRedacted)
	return reportedOpaque.ReplaceAllStringFunc(message, func(run string) string {
		if reportedDigit.MatchString(run) && reportedLetter.MatchString(run) {
			return reportedRedacted
		}
		return run
	})
}
