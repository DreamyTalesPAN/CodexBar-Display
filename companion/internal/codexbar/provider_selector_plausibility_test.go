package codexbar

import "testing"

func TestProviderSelectorIgnoresUsageAndTokenDeltas(t *testing.T) {
	selector := NewProviderSelector()
	providers := []ParsedFrame{testParsedFrame("codex", 2, 2, 12000), testParsedFrame("claude", 20, 20, 15000)}
	providers[1].Frame.TotalTokens = 1_000_000_000
	selector.Select(providers)
	for _, delta := range []int64{50, 617_000_000, 1_700_000_000} {
		providers[1].Frame.TotalTokens += delta
		providers[1].Frame.Session++
		providers[1].Frame.Weekly++
		got, _ := selector.SelectWithDecision(providers)
		if got.Selected.Provider != "codex" || got.Reason != SelectionReasonStickyCurrent {
			t.Fatalf("usage changed selection: %+v", got)
		}
	}
	got, _ := selector.SelectWithDecision(providers, "claude")
	if got.Selected.Provider != "claude" || got.Reason != SelectionReasonAgentActivity {
		t.Fatalf("agent did not switch selection: %+v", got)
	}
}
