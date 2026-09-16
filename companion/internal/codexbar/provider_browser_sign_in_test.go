package codexbar

import (
	"strings"
	"testing"
)

// Win-CodexBar's exact sentence when Anthropic rate-limits the OAuth usage
// endpoint and no claude.ai browser cookies are readable. Claude Code is
// signed in on that machine, so "sign in again" would send the customer in a
// circle; the row must ask for the browser session instead.
const windowsClaudeOAuthRefused = "Claude usage failed from all configured sources. Web: No cookies available for web API; OAuth: OAuth error: Claude OAuth usage endpoint is rate limited. Retrying in about 1s; credentials were preserved.; CLI: Parse error: Claude CLI did not return usage data"

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
}

func TestBrowserSignInStaysNarrow(t *testing.T) {
	cases := map[string]string{
		// A real sign-out is still auth_required.
		"OAuth token expired": ProviderAuthRequired,
		"Web: No cookies available for web API; OAuth: not logged in": ProviderAuthRequired,
		// Rate limited alone, cookies were readable: the web path may recover.
		"OAuth error: Claude OAuth usage endpoint is rate limited": ProviderAuthRequired,
	}
	for detail, want := range cases {
		if got := classifyProviderErrorFor("claude", detail); got != want {
			t.Fatalf("%q: got %s want %s", detail, got, want)
		}
	}
	// Providers without a listed sign-in page never get the new state.
	if got := classifyProviderErrorFor("codex", windowsClaudeOAuthRefused); got != ProviderAuthRequired {
		t.Fatalf("codex must stay auth_required: %s", got)
	}
}
