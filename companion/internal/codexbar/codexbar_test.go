package codexbar

import (
	"testing"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
)

func TestParseUsageJSONCodexCLI(t *testing.T) {
	raw := []byte(`[
		{
			"provider":"codex",
			"source":"codex-cli",
			"usage":{
				"primary":{"usedPercent":1,"resetsAt":"2026-02-22T20:02:05Z"},
				"secondary":{"usedPercent":2}
			}
		}
	]`)

	parsed, err := parseUsageJSON(raw)
	if err != nil {
		t.Fatalf("parseUsageJSON failed: %v", err)
	}

	if parsed.Provider != "codex" {
		t.Fatalf("provider mismatch: got %q", parsed.Provider)
	}
	if parsed.Source != "codex-cli" {
		t.Fatalf("source mismatch: got %q", parsed.Source)
	}
	if parsed.Frame.Session != 1 {
		t.Fatalf("session mismatch: got %d", parsed.Frame.Session)
	}
	if parsed.Frame.Weekly != 2 {
		t.Fatalf("weekly mismatch: got %d", parsed.Frame.Weekly)
	}
	if parsed.Frame.ResetSec <= 0 {
		t.Fatalf("reset should be > 0, got %d", parsed.Frame.ResetSec)
	}
}

func TestShouldTryCodexCLIFallback(t *testing.T) {
	parsed := ParsedFrame{
		Frame:    protocolFrameForTest(0, 0, 0),
		Provider: "codex",
		Source:   "openai-web",
	}

	if !shouldTryCodexCLIFallback(parsed) {
		t.Fatalf("expected fallback=true for codex openai-web 0/0")
	}
}

func TestShouldNotTryFallbackForNonCodex(t *testing.T) {
	parsed := ParsedFrame{
		Frame:    protocolFrameForTest(0, 0, 0),
		Provider: "claude",
		Source:   "openai-web",
	}

	if shouldTryCodexCLIFallback(parsed) {
		t.Fatalf("expected fallback=false for non-codex")
	}
}

func protocolFrameForTest(session, weekly int, resetSec int64) protocol.Frame {
	return protocol.Frame{
		Session:  session,
		Weekly:   weekly,
		ResetSec: resetSec,
	}
}
