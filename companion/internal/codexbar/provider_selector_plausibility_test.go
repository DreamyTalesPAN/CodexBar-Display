package codexbar

import (
	"testing"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
)

// Regression test for the live-observed selection bug (2026-08-06): the
// CodexBar dashboard reported codex totalTokens values that jumped by
// +0.6 to +1.7 BILLION tokens between two 30s cycles (counter noise, not
// usage). The selector scored these jumps as real activity and kept codex
// selected while Claude had genuine fresh activity. Implausible counter
// jumps must not count as an activity signal; real deltas must.
//
// DO NOT weaken this test to make it pass. Fix the scoring.
func TestComputeActivityScoreIgnoresImplausibleTokenJumps(t *testing.T) {
	prev := providerSnapshot{totalTokens: 1_000_000_000}
	cur := protocol.Frame{TotalTokens: 2_700_000_000} // +1.7B in one cycle
	if score := computeActivityScore(prev, cur); score.hasSignal() {
		t.Fatalf("implausible +1.7B token jump must not count as activity: %+v", score)
	}

	prevWeek := providerSnapshot{weekTokens: 80_000_000}
	curWeek := protocol.Frame{WeekTokens: 697_383_203} // +617M week jump
	if score := computeActivityScore(prevWeek, curWeek); score.hasSignal() {
		t.Fatalf("implausible +617M week-token jump must not count as activity: %+v", score)
	}

	realPrev := providerSnapshot{sessionTokens: 100_000}
	realCur := protocol.Frame{SessionTokens: 490_312} // real usage burst
	if score := computeActivityScore(realPrev, realCur); !score.hasSignal() {
		t.Fatal("a real session-token delta must count as activity")
	}
}
