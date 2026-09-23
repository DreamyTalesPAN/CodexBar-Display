package codexbar

import (
	"encoding/json"
	"testing"
	"time"

	dashboardusage "github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar/dashboard"
)

// GeminiConsumerTierMigration.deprecationError, verbatim from the bundled
// CodexBar 0.46.0 CLI (identical in 0.63.0).
const geminiDeprecationError = "Google no longer supports Gemini CLI OAuth for individual, AI Pro, or Ultra accounts. Enable CodexBar's Antigravity provider, sign in to Antigravity or run `agy`, then refresh."

func TestParseAllProvidersMarksOnlyTerminalProviderErrors(t *testing.T) {
	raw, _ := json.Marshal([]map[string]any{
		{"provider": "gemini", "source": "api", "error": map[string]any{"code": 3, "kind": "provider", "message": geminiDeprecationError}},
		{"provider": "cursor", "source": "auto", "error": map[string]any{"code": 1, "kind": "provider", "message": "Not logged in to Gemini. Run 'gemini' in Terminal to authenticate."}},
		{"provider": "codex", "usage": map[string]any{"primary": map[string]any{"usedPercent": 10}}},
	})
	parsed, err := parseAllProviders(raw)
	if err != nil || len(parsed) != 3 {
		t.Fatalf("parse: %v %#v", err, parsed)
	}
	if !parsed[0].Terminal || !parsed[0].Frame.UsageUnavailable {
		t.Fatalf("deprecation error must be terminal: %#v", parsed[0])
	}
	if parsed[1].Terminal || parsed[2].Terminal {
		t.Fatalf("transient error or usage marked terminal: %#v", parsed[1:])
	}
}

func TestDashboardProviderCarriesTerminalError(t *testing.T) {
	usageErr, _ := json.Marshal(map[string]any{"code": 3, "kind": "provider", "message": geminiDeprecationError})
	provider := dashboardusage.DashboardProvider{ID: "gemini", Name: "Gemini"}
	usage := dashboardusage.UsageProvider{Provider: "gemini", Error: usageErr}
	now := time.Date(2026, 9, 23, 12, 0, 0, 0, time.UTC)
	got := parsedFrameFromDashboardProvider(provider, dashboardusage.NormalizeProvider(provider, usage), now, now, usage.Error)
	if !got.Terminal || !got.Frame.UsageUnavailable {
		t.Fatalf("dashboard terminal error lost: %#v", got)
	}
	transient, _ := json.Marshal(map[string]any{"message": "Gemini quota API request timed out."})
	usage.Error = transient
	if got := parsedFrameFromDashboardProvider(provider, dashboardusage.NormalizeProvider(provider, usage), now, now, usage.Error); got.Terminal {
		t.Fatalf("transient dashboard error marked terminal: %#v", got)
	}
}
