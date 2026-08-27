package daemon

import (
	"testing"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
)

// Zeroed totals without the marker read as a completed all-zero history on the
// device, so Token Fire would render fabricated zeroes instead of "--".
func TestCompactUpdateCandidatesDropTokenClaimWithTotals(t *testing.T) {
	frame := protocol.Frame{
		Provider:         "codex",
		SessionTokens:    1234,
		WeekTokens:       5678,
		TotalTokens:      9012,
		TokenTotalsKnown: true,
	}

	candidates := compactUpdateCandidates(frame)
	if len(candidates) < 2 {
		t.Fatalf("expected compaction candidates, got %d", len(candidates))
	}
	if !candidates[0].TokenTotalsKnown {
		t.Fatal("the untouched candidate must keep its token claim")
	}
	for i, candidate := range candidates[1:] {
		if candidate.SessionTokens != 0 || candidate.WeekTokens != 0 || candidate.TotalTokens != 0 {
			t.Fatalf("candidate %d still carries totals", i+1)
		}
		if candidate.TokenTotalsKnown {
			t.Fatalf("candidate %d dropped the totals but kept tokenTotalsKnown", i+1)
		}
	}
}
