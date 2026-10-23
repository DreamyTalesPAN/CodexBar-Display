package companionapi

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar"
)

// CodexBar's pace from the recorded 0.75.0 codex weekly window: it will not
// last to reset and runs out in 40427 s.
func TestUsageWindowsCarryCodexBarPaceWillNotLast(t *testing.T) {
	windows := usageWindowsFromMeta(codexbar.ProviderUsageMeta{
		Windows: []codexbar.UsageWindow{
			{ID: "session", Label: "Session", UsedPercent: 12, ResetSec: 3600},
			{ID: "weekly", Label: "Weekly", UsedPercent: 54, ResetSec: 500000},
		},
		Pace: []codexbar.ProviderPace{{Window: "secondary", WillLastToReset: false, ETASeconds: 40427}},
	})
	if len(windows) != 2 {
		t.Fatalf("expected two windows, got %+v", windows)
	}
	if windows[0].WillLastToReset != nil || windows[0].ETASeconds != 0 {
		t.Fatalf("session has no pace from CodexBar, got %+v", windows[0])
	}
	if windows[1].WillLastToReset == nil || *windows[1].WillLastToReset || windows[1].ETASeconds != 40427 {
		t.Fatalf("weekly must carry CodexBar's pace, got %+v", windows[1])
	}
	raw, err := json.Marshal(windows[1])
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), `"willLastToReset":false`) || !strings.Contains(string(raw), `"etaSeconds":40427`) {
		t.Fatalf("pace missing on the wire: %s", raw)
	}
}

// A primary window that will last to reset carries the flag and no ETA.
// CodexBar's "primary" is the session window, which the dashboard calls "session".
func TestUsageWindowsCarryCodexBarPaceWillLast(t *testing.T) {
	windows := usageWindowsFromMeta(codexbar.ProviderUsageMeta{
		Windows: []codexbar.UsageWindow{
			{ID: "session", Label: "Session", UsedPercent: 33},
			{ID: "weekly", Label: "Weekly", UsedPercent: 84},
		},
		Pace: []codexbar.ProviderPace{{Window: "primary", WillLastToReset: true}},
	})
	if windows[0].WillLastToReset == nil || !*windows[0].WillLastToReset || windows[0].ETASeconds != 0 {
		t.Fatalf("session must carry will-last, got %+v", windows[0])
	}
	raw, err := json.Marshal(windows[0])
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), `"willLastToReset":true`) || strings.Contains(string(raw), "etaSeconds") {
		t.Fatalf("expected will-last without an ETA, got %s", raw)
	}
	if windows[1].WillLastToReset != nil {
		t.Fatalf("weekly has no pace, got %+v", windows[1])
	}
}

// Without CodexBar pace the fields stay off the wire.
func TestUsageWindowsOmitPaceWhenCodexBarSendsNone(t *testing.T) {
	windows := usageWindowsFromMeta(codexbar.ProviderUsageMeta{
		Windows: []codexbar.UsageWindow{{ID: "weekly", Label: "Weekly", UsedPercent: 27}},
	})
	raw, err := json.Marshal(windows[0])
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "willLastToReset") || strings.Contains(string(raw), "etaSeconds") {
		t.Fatalf("no pace must mean no pace fields, got %s", raw)
	}
}
