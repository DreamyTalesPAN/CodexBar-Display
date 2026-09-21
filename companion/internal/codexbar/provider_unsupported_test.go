package codexbar

import (
	"testing"
)

// The exact sentences bundled CodexBar emits for a Google account whose Gemini
// CLI OAuth access Google discontinued. Taken verbatim from the pinned
// CodexBar 0.63.0 CLI binary, which is the contract this classification reads;
// they are byte-identical in 0.56.8, 0.57.0 and 0.63.0.
//
// Each one names OAuth, credentials or signing in, which is why the generic
// auth markers used to claim them -- and why the customer was told to sign in
// to an account that Google will keep refusing. The token itself is valid: the
// reporter's OAuth userinfo call returns 200 and loadCodeAssist returns 200
// with ineligibleTiers/UNSUPPORTED_CLIENT. Only the follow-up quota call 403s.
const (
	geminiConsumerShutdown = "Google no longer supports Gemini CLI OAuth for individual, AI Pro, or Ultra accounts. Enable CodexBar's Antigravity provider, sign in to Antigravity or run `agy`, then refresh."
	geminiRefreshShutdown  = "Could not refresh Gemini OAuth credentials from Gemini CLI. Enable CodexBar's Antigravity provider, sign in to Antigravity or run `agy`, then refresh."
)

func TestGeminiConsumerGuidancePreservesUntypedUpstreamMessage(t *testing.T) {
	providers := providerReadinessFromOutput(
		[]byte(`[{"provider":"gemini","error":{"message":"`+geminiConsumerShutdown+`","code":1,"kind":"provider"}}]`), nil, nil)
	if len(providers) != 1 || providers[0].Status != ProviderAuthRequired {
		t.Fatalf("expected upstream untyped fallback, got %+v", providers)
	}
	gemini := providers[0]
	// CodexBar's own sentence must survive to the row: it carries the path.
	if gemini.Reported != geminiConsumerShutdown {
		t.Fatalf("upstream migration message was dropped: %q", gemini.Reported)
	}

	health := parseProviderHealth(
		[]byte(`[{"provider":"gemini","error":{"message":"` + geminiConsumerShutdown + `"}}]`))
	if health["gemini"].health != ProviderHealthAuthRequired {
		t.Fatalf("background health must agree: %#v", health["gemini"])
	}
}

// CodexBar owns provider semantics. Its untyped English guidance passes through
// unchanged; only a typed upstream terminal status may disable recovery.
func TestUntypedProviderGuidanceDoesNotInventTerminalState(t *testing.T) {
	for detail, want := range map[string]string{
		geminiConsumerShutdown: ProviderAuthRequired,
		geminiRefreshShutdown:  ProviderAuthRequired,
		// A plain signed-out Gemini is still an ordinary sign-in.
		"Not logged in to Gemini. Run 'gemini' in Terminal to authenticate.": ProviderAuthRequired,
		// A licensed account that merely lacks a project, or any unrelated
		// 403, must not be told its provider ended.
		"Gemini API error: HTTP 403":                                              ProviderEngineError,
		"PERMISSION_DENIED: SUBSCRIPTION_REQUIRED":                                ProviderPermissionRequired,
		"Antigravity language server not detected. Launch Antigravity and retry.": ProviderEngineError,
		// A real expiry on another provider keeps its sign-in.
		"OAuth token expired": ProviderAuthRequired,
		// A recoverable message from any provider may still say that some
		// method is no longer supported while naming a real remedy. Matching a
		// bare "no longer supported" would strip its sign-in and re-check.
		"This OAuth method is no longer supported; sign in again": ProviderAuthRequired,
		"The legacy config format is no longer supported":         ProviderConfigError,
	} {
		if got := classifyProviderError(detail); got != want {
			t.Fatalf("%q: got %s want %s", detail, got, want)
		}
	}
}
