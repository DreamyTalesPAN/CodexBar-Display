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

func TestParseUsageJSONSelectsMostRecentlyActiveProvider(t *testing.T) {
	// Codex: resetsAt 20:02:05 - 300min = lastActiveAt 15:02:05
	// Claude: resetsAt 16:00:01 - 300min = lastActiveAt 11:00:01
	// Codex was used more recently, so it should be selected — even though
	// Claude has a later updatedAt (scrape timestamp).
	raw := []byte(`[
		{
			"provider":"codex",
			"source":"codex-cli",
			"usage":{
				"updatedAt":"2026-02-22T15:00:00Z",
				"primary":{"usedPercent":1,"resetsAt":"2026-02-22T20:02:05Z","windowMinutes":300},
				"secondary":{"usedPercent":2}
			}
		},
		{
			"provider":"claude",
			"source":"web",
			"usage":{
				"updatedAt":"2026-02-22T15:10:00Z",
				"primary":{"usedPercent":25,"resetsAt":"2026-02-22T16:00:01Z","windowMinutes":300},
				"secondary":{"usedPercent":16}
			}
		}
	]`)

	parsed, err := parseUsageJSON(raw)
	if err != nil {
		t.Fatalf("parseUsageJSON failed: %v", err)
	}

	if parsed.Provider != "codex" {
		t.Fatalf("expected codex (most recently active) to be selected, got %q", parsed.Provider)
	}
	if parsed.Frame.Session != 1 {
		t.Fatalf("session mismatch: got %d", parsed.Frame.Session)
	}
	if parsed.Frame.Weekly != 2 {
		t.Fatalf("weekly mismatch: got %d", parsed.Frame.Weekly)
	}
}

func TestParseUsageJSONFallsBackToUpdatedAtWithoutWindowMinutes(t *testing.T) {
	// Without windowMinutes, lastActiveAt cannot be computed — falls back to updatedAt.
	raw := []byte(`[
		{
			"provider":"codex",
			"source":"codex-cli",
			"usage":{
				"updatedAt":"2026-02-22T15:00:00Z",
				"primary":{"usedPercent":1,"resetsAt":"2026-02-22T20:02:05Z"},
				"secondary":{"usedPercent":2}
			}
		},
		{
			"provider":"claude",
			"source":"web",
			"usage":{
				"updatedAt":"2026-02-22T15:10:00Z",
				"primary":{"usedPercent":25,"resetsAt":"2026-02-22T16:00:01Z"},
				"secondary":{"usedPercent":16}
			}
		}
	]`)

	parsed, err := parseUsageJSON(raw)
	if err != nil {
		t.Fatalf("parseUsageJSON failed: %v", err)
	}

	if parsed.Provider != "claude" {
		t.Fatalf("expected claude (later updatedAt fallback) to be selected, got %q", parsed.Provider)
	}
}

func TestParseUsageJSONFallsBackToFirstWhenNoUpdatedAt(t *testing.T) {
	raw := []byte(`[
		{
			"provider":"codex",
			"source":"codex-cli",
			"usage":{
				"primary":{"usedPercent":1},
				"secondary":{"usedPercent":2}
			}
		},
		{
			"provider":"claude",
			"source":"web",
			"usage":{
				"primary":{"usedPercent":25},
				"secondary":{"usedPercent":16}
			}
		}
	]`)

	parsed, err := parseUsageJSON(raw)
	if err != nil {
		t.Fatalf("parseUsageJSON failed: %v", err)
	}

	if parsed.Provider != "codex" {
		t.Fatalf("expected first provider fallback (codex), got %q", parsed.Provider)
	}
}

func TestParseUsageJSONHandlesConcatenatedTopLevelArrays(t *testing.T) {
	// Codex lastActiveAt: 20:00:00 - 300min = 15:00:00
	// Claude lastActiveAt: 21:10:00 - 300min = 16:10:00 — more recent, should win
	raw := []byte(`[
		{
			"provider":"codex",
			"source":"codex-cli",
			"usage":{
				"updatedAt":"2026-02-22T15:00:00Z",
				"primary":{"usedPercent":1,"resetsAt":"2026-02-22T20:00:00Z","windowMinutes":300},
				"secondary":{"usedPercent":2}
			}
		}
	][
		{
			"provider":"claude",
			"source":"web",
			"usage":{
				"updatedAt":"2026-02-22T15:10:00Z",
				"primary":{"usedPercent":25,"resetsAt":"2026-02-22T21:10:00Z","windowMinutes":300},
				"secondary":{"usedPercent":16}
			}
		}
	]`)

	parsed, err := parseUsageJSON(raw)
	if err != nil {
		t.Fatalf("parseUsageJSON failed: %v", err)
	}

	if parsed.Provider != "claude" {
		t.Fatalf("expected claude from concatenated arrays, got %q", parsed.Provider)
	}
}

func TestParseUsageJSONKeepsFirstDecodedValueOnTrailingGarbage(t *testing.T) {
	raw := []byte(`[
		{
			"provider":"codex",
			"source":"codex-cli",
			"usage":{
				"primary":{"usedPercent":1},
				"secondary":{"usedPercent":2}
			}
		}
	]THIS_IS_GARBAGE`)

	parsed, err := parseUsageJSON(raw)
	if err != nil {
		t.Fatalf("parseUsageJSON failed: %v", err)
	}
	if parsed.Provider != "codex" {
		t.Fatalf("expected codex from first decoded value, got %q", parsed.Provider)
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
