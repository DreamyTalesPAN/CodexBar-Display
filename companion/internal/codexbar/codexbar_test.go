package codexbar

import (
	"testing"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
)

func TestParseUsageJSONReturnsFirstProvider(t *testing.T) {
	raw := []byte(`[
		{"provider":"codex","usage":{"primary":{"usedPercent":1}}},
		{"provider":"claude","usage":{"primary":{"usedPercent":9}}}
	]`)

	parsed, err := parseUsageJSON(raw)
	if err != nil {
		t.Fatalf("parseUsageJSON failed: %v", err)
	}
	if parsed.Provider != "codex" {
		t.Fatalf("expected first provider codex, got %q", parsed.Provider)
	}
}

func TestParseUsageJSONHandlesConcatenatedTopLevelArrays(t *testing.T) {
	raw := []byte(`[
		{"provider":"codex","usage":{"primary":{"usedPercent":1}}}
	][
		{"provider":"claude","usage":{"primary":{"usedPercent":9}}}
	]`)

	parsed, err := parseUsageJSON(raw)
	if err != nil {
		t.Fatalf("parseUsageJSON failed: %v", err)
	}
	if parsed.Provider != "codex" {
		t.Fatalf("expected first decoded provider codex, got %q", parsed.Provider)
	}
}

func TestParseUsageJSONKeepsFirstDecodedValueOnTrailingGarbage(t *testing.T) {
	raw := []byte(`[
		{"provider":"codex","usage":{"primary":{"usedPercent":1}}}
	]THIS_IS_GARBAGE`)

	parsed, err := parseUsageJSON(raw)
	if err != nil {
		t.Fatalf("parseUsageJSON failed: %v", err)
	}
	if parsed.Provider != "codex" {
		t.Fatalf("expected codex from first decoded value, got %q", parsed.Provider)
	}
}

func TestProviderSelectorSwitchesOnUsageDelta(t *testing.T) {
	selector := newSelectorWithoutLocalActivity()

	first, ok := selector.Select([]ParsedFrame{
		testParsedFrame("codex", 2, 2, 12000),
		testParsedFrame("claude", 20, 20, 15000),
	})
	if !ok {
		t.Fatalf("expected a selected provider in first cycle")
	}
	if first.Provider != "codex" {
		t.Fatalf("expected first-cycle fallback codex, got %q", first.Provider)
	}

	second, ok := selector.Select([]ParsedFrame{
		testParsedFrame("codex", 2, 2, 11940),
		testParsedFrame("claude", 21, 20, 14940),
	})
	if !ok {
		t.Fatalf("expected a selected provider in second cycle")
	}
	if second.Provider != "claude" {
		t.Fatalf("expected switch to claude on session delta, got %q", second.Provider)
	}
}

func TestProviderSelectorSticksWithoutNewActivity(t *testing.T) {
	selector := newSelectorWithoutLocalActivity()

	_, _ = selector.Select([]ParsedFrame{
		testParsedFrame("codex", 2, 2, 12000),
		testParsedFrame("claude", 20, 20, 15000),
	})

	second, ok := selector.Select([]ParsedFrame{
		testParsedFrame("claude", 20, 20, 14940),
		testParsedFrame("codex", 2, 2, 11940),
	})
	if !ok {
		t.Fatalf("expected a selected provider in second cycle")
	}
	if second.Provider != "codex" {
		t.Fatalf("expected sticky provider codex without deltas, got %q", second.Provider)
	}
}

func TestProviderSelectorSwitchesBackWhenOtherProviderMoves(t *testing.T) {
	selector := newSelectorWithoutLocalActivity()

	_, _ = selector.Select([]ParsedFrame{
		testParsedFrame("codex", 2, 2, 12000),
		testParsedFrame("claude", 20, 20, 15000),
	})

	_, _ = selector.Select([]ParsedFrame{
		testParsedFrame("codex", 2, 2, 11940),
		testParsedFrame("claude", 21, 20, 14940),
	})

	third, ok := selector.Select([]ParsedFrame{
		testParsedFrame("codex", 3, 2, 11880),
		testParsedFrame("claude", 21, 20, 14880),
	})
	if !ok {
		t.Fatalf("expected a selected provider in third cycle")
	}
	if third.Provider != "codex" {
		t.Fatalf("expected switch back to codex on new codex delta, got %q", third.Provider)
	}
}

func TestComputeActivityScoreTreatsResetJumpAsSignal(t *testing.T) {
	prev := providerSnapshot{session: 0, weekly: 0, reset: 0}
	score := computeActivityScore(prev, protocol.Frame{Session: 0, Weekly: 0, ResetSec: 9000})
	if !score.hasSignal() {
		t.Fatalf("expected reset jump to count as activity signal")
	}
}

func TestProviderSelectorPrefersRecentLocalActivity(t *testing.T) {
	now := time.Now()
	selector := NewProviderSelectorWithActivityReader(func() (map[string]time.Time, error) {
		return map[string]time.Time{
			"codex":  now.Add(-2 * time.Minute),
			"claude": now,
		}, nil
	})

	selected, ok := selector.Select([]ParsedFrame{
		testParsedFrame("codex", 4, 2, 9000),
		testParsedFrame("claude", 47, 21, 10000),
	})
	if !ok {
		t.Fatalf("expected a selected provider")
	}
	if selected.Provider != "claude" {
		t.Fatalf("expected claude from local activity, got %q", selected.Provider)
	}
}

func TestProviderSelectorFallsBackToUsageDeltaWhenNoLocalActivity(t *testing.T) {
	selector := NewProviderSelectorWithActivityReader(func() (map[string]time.Time, error) {
		return map[string]time.Time{}, nil
	})

	_, _ = selector.Select([]ParsedFrame{
		testParsedFrame("codex", 2, 2, 12000),
		testParsedFrame("claude", 20, 20, 15000),
	})

	selected, ok := selector.Select([]ParsedFrame{
		testParsedFrame("codex", 2, 2, 11940),
		testParsedFrame("claude", 21, 20, 14940),
	})
	if !ok {
		t.Fatalf("expected a selected provider")
	}
	if selected.Provider != "claude" {
		t.Fatalf("expected claude from usage delta fallback, got %q", selected.Provider)
	}
}

func TestShouldTryCodexCLIRepair(t *testing.T) {
	parsed := ParsedFrame{
		Frame:    protocol.Frame{Session: 0, Weekly: 0, ResetSec: 0},
		Provider: "codex",
		Source:   "openai-web",
	}

	if !shouldTryCodexCLIRepair(parsed) {
		t.Fatalf("expected repair=true for codex openai-web 0/0")
	}
}

func TestShouldNotTryCodexCLIRepairForNonCodex(t *testing.T) {
	parsed := ParsedFrame{
		Frame:    protocol.Frame{Session: 0, Weekly: 0, ResetSec: 0},
		Provider: "claude",
		Source:   "openai-web",
	}

	if shouldTryCodexCLIRepair(parsed) {
		t.Fatalf("expected repair=false for non-codex")
	}
}

func testParsedFrame(provider string, session, weekly int, reset int64) ParsedFrame {
	return ParsedFrame{
		Provider: provider,
		Source:   "web",
		Frame: protocol.Frame{
			Provider: provider,
			Label:    humanLabel(provider),
			Session:  session,
			Weekly:   weekly,
			ResetSec: reset,
		},
	}
}

func newSelectorWithoutLocalActivity() *ProviderSelector {
	return NewProviderSelectorWithActivityReader(func() (map[string]time.Time, error) {
		return map[string]time.Time{}, nil
	})
}
