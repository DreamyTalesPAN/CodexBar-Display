package companionapi

import (
	"regexp"
	"strings"
)

// The usage service is the only source of per-provider sign-in guidance: it
// publishes no structured destination in the pinned 0.46.0, and none in 0.56.2
// either. Its sentences are therefore worth forwarding -- "sign in at
// ollama.com/signin", "Run 'gemini' in Terminal to authenticate" -- but they are
// written for its own log, not for a customer, and a handful of them carry the
// account's private details.
//
// Measured against the pinned engine's real output for all 65 providers:
//   - 5 messages embed the account's home directory
//   - 2 tell the customer to sign in "via the CodexBar menu", naming a product
//     the Mac App deliberately never mentions -- and naming it wrongly, since
//     both providers are read straight out of browser cookies
//   - 34 say "No available fetch strategy for <id>.", which reads as "nothing
//     you can do" for providers that do have a working sign-in
//
// So the sentence is forwarded, redacted, and the caller decides whether it is
// worth showing at all.
var (
	reportedHomePath  = regexp.MustCompile(`(?i)/Users/[^/\s)]+`)
	reportedEmail     = regexp.MustCompile(`(?i)[\w.+-]+@[\w-]+\.[\w.-]+`)
	reportedLongToken = regexp.MustCompile(`\b[A-Za-z0-9_-]{24,}\b`)
)

// reportedProviderMessage is the usage service's own sentence, with everything
// private to this Mac taken out of it.
//
// Redaction is by shape rather than by a list of known secrets: the sentences
// are prose the engine may reword in any release, and a redactor that only
// covered today's five would let the sixth through on the next version bump.
func reportedProviderMessage(raw string) string {
	message := strings.TrimSpace(raw)
	if message == "" {
		return ""
	}
	// Order matters: an e-mail inside a path must not survive as a token.
	// The account name is the one private part of a home path, so only it goes;
	// what is left is the same path the customer can open in Finder.
	message = reportedHomePath.ReplaceAllString(message, "~")
	message = reportedEmail.ReplaceAllString(message, "your account")
	message = reportedLongToken.ReplaceAllString(message, "…")
	// The customer never hears the engine's name. It appears in three of its
	// sentences, always inside an instruction they cannot follow from here.
	if strings.Contains(message, "CodexBar") {
		return ""
	}
	return strings.Join(strings.Fields(message), " ")
}

// providerReportedIsUseless reports whether the engine's sentence tells the
// customer nothing they can act on.
//
// "No available fetch strategy for copilot." is its answer for 34 of 65
// providers and means only that every route it tried was unavailable -- not
// that the provider cannot be signed into. Showing it made a solvable state
// look like a dead end.
func providerReportedIsUseless(message string) bool {
	lowered := strings.ToLower(message)
	return lowered == "" ||
		strings.Contains(lowered, "no available fetch strategy")
}
