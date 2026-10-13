package codexbar

import (
	"strings"
	"testing"
)

// Win-CodexBar's failure summary when Anthropic rate-limits the OAuth usage
// endpoint and no claude.ai browser cookies are readable; the bundled CLI
// appends its browser-session marker. Claude Code is signed in on that
// machine, so "sign in again" would send the customer in a circle; the row
// must ask for the browser session instead.
const windowsClaudeOAuthRefused = "Claude usage failed from all configured sources. Web: No cookies available for web API; OAuth: OAuth error: Claude OAuth usage endpoint is rate limited. Retrying in about 1s; credentials were preserved.; CLI: Parse error: Claude CLI did not return usage data [claude:browser-sign-in-required https://claude.ai/login]"

func TestClaudeOAuthRefusedWithoutCookiesNeedsBrowserSignIn(t *testing.T) {
	providers := providerReadinessFromOutput([]byte(`[{"provider":"claude","error":"`+windowsClaudeOAuthRefused+`"}]`), nil, nil)
	if len(providers) != 1 || providers[0].Status != ProviderBrowserSignInRequired {
		t.Fatalf("expected browser_sign_in_required: %+v", providers)
	}
	claude := providers[0]
	if claude.SignInURL != "https://claude.ai/login" {
		t.Fatalf("sign-in URL missing: %+v", claude)
	}
	if !strings.Contains(claude.Detail, "claude.ai") || !strings.Contains(claude.NextAction, "browser") {
		t.Fatalf("guidance must name the browser session: %+v", claude)
	}

	health := parseProviderHealth([]byte(`[{"provider":"claude","error":{"message":"` + windowsClaudeOAuthRefused + `"}}]`))
	if health["claude"].health != ProviderHealthBrowserSignIn {
		t.Fatalf("background health must agree: %#v", health["claude"])
	}
	if health["claude"].signInURL != "https://claude.ai/login" {
		t.Fatalf("background health must carry the page: %#v", health["claude"])
	}
}

// The summary a Windows customer read in a dialog titled "Claude" while Claude
// was delivering usage: one throttled OAuth call that CodexBar was already
// retrying. The marker stays the diagnosis and the guidance is ours. The
// summary is kept beside it for "Copy provider message" only (issue #551):
// companionapi shows the guidance, never this text.
func TestBrowserSignInSummaryIsKeptForCopyAndNotAsGuidance(t *testing.T) {
	const summary = "Claude usage failed from all configured sources. Web: No cookies available for web API; OAuth: OAuth error: Claude OAuth usage endpoint is rate limited. Retrying in about 1s; credentials were preserved.; CLI: Claude CLI /usage opened, but this Claude version returned local activity stats instead of plan limit percentages. Use Auto, OAuth, or Web mode for Claude limits. [claude:browser-sign-in-required https://claude.ai/login]"

	scanned := parseProviderHealth([]byte(`[{"provider":"claude","error":{"message":"` + summary + `"}}]`))["claude"]
	if scanned.health != ProviderHealthBrowserSignIn || scanned.signInURL != "https://claude.ai/login" {
		t.Fatalf("the marker must stay the diagnosis: %#v", scanned)
	}
	if scanned.reported != summary {
		t.Fatalf("health scan lost the summary: %q", scanned.reported)
	}

	checked := providerReadinessFromOutput([]byte(`[{"provider":"claude","error":"`+summary+`"}]`), nil, nil)
	if len(checked) != 1 || checked[0].Status != ProviderBrowserSignInRequired || checked[0].SignInURL != "https://claude.ai/login" {
		t.Fatalf("the marker must stay the diagnosis: %+v", checked)
	}
	if checked[0].Reported != summary {
		t.Fatalf("exact check lost the summary: %q", checked[0].Reported)
	}
	for _, fragment := range []string{"OAuth", "cookies", "[claude:", "configured sources"} {
		if strings.Contains(checked[0].Detail+checked[0].NextAction, fragment) {
			t.Fatalf("guidance repeats the summary (%q): %+v", fragment, checked[0])
		}
	}
}

func TestBrowserSignInStaysNarrow(t *testing.T) {
	cases := map[string]string{
		// A real sign-out is still auth_required.
		"OAuth token expired": ProviderAuthRequired,
		"Web: No cookies available for web API; OAuth: not logged in": ProviderAuthRequired,
		// Rate limited alone, cookies were readable: the web path may recover,
		// so the customer is asked to wait rather than to sign in again (#448).
		// What matters to this test is that it is not a browser sign-in.
		"OAuth error: Claude OAuth usage endpoint is rate limited": ProviderRateLimited,
		// Win-CodexBar's own suffix says the credential is fine, so it must not
		// turn the wait into a sign-in.
		"OAuth error: Claude OAuth usage endpoint is rate limited. Retrying in about 1s; credentials were preserved.": ProviderRateLimited,
		// The English summary alone, without CodexBar's marker, is not enough.
		"Claude usage failed from all configured sources. Web: No cookies available for web API; OAuth: OAuth error: Claude OAuth usage endpoint is rate limited.": ProviderAuthRequired,
		// A marker without a page, or with a page that is not https, is ignored.
		"OAuth error: not logged in [claude:browser-sign-in-required]":                        ProviderAuthRequired,
		"OAuth error: not logged in [claude:browser-sign-in-required http://claude.ai/login]": ProviderAuthRequired,
	}
	for detail, want := range cases {
		if got := classifyProviderErrorFor("claude", detail); got != want {
			t.Fatalf("%q: got %s want %s", detail, got, want)
		}
	}
	// The marker names its provider; another provider's summary never inherits it.
	if got := classifyProviderErrorFor("codex", windowsClaudeOAuthRefused); got != ProviderAuthRequired {
		t.Fatalf("codex must stay auth_required: %s", got)
	}
	// CodexBar's marker beats incidental wording in the summary around it.
	mixed := "Claude usage failed from all configured sources. Web: No cookies available for web API; OAuth: request timed out; CLI: permission denied [claude:browser-sign-in-required https://claude.ai/login]"
	if got := classifyProviderErrorFor("claude", mixed); got != ProviderBrowserSignInRequired {
		t.Fatalf("marker must win over timeout/permission wording, got %s", got)
	}
}
