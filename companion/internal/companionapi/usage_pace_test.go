package companionapi

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar"
)

// CodexBar's pace from the recorded 0.75.0 codex weekly window: it will not
// last to reset and runs out in 40427 s.
func TestUsageWindowsCarryCodexBarPaceWillNotLast(t *testing.T) {
	windows := freshUsageWindows(codexbar.ProviderUsageMeta{
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
	windows := freshUsageWindows(codexbar.ProviderUsageMeta{
		Windows: []codexbar.UsageWindow{
			{ID: "session", Label: "Session", UsedPercent: 33, ResetSec: 3600},
			{ID: "weekly", Label: "Weekly", UsedPercent: 84, ResetSec: 3600},
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
	windows := freshUsageWindows(codexbar.ProviderUsageMeta{
		Windows: []codexbar.UsageWindow{{ID: "weekly", Label: "Weekly", UsedPercent: 27, ResetSec: 3600}},
	})
	raw, err := json.Marshal(windows[0])
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "willLastToReset") || strings.Contains(string(raw), "etaSeconds") {
		t.Fatalf("no pace must mean no pace fields, got %s", raw)
	}
}

// CodexBar's stage, delta and expected-used reach the window as CodexBar sent
// them, from the recorded 0.75.0 codex weekly window (54% in deficit).
func TestUsageWindowsCarryCodexBarPaceStage(t *testing.T) {
	windows := freshUsageWindows(codexbar.ProviderUsageMeta{
		Windows: []codexbar.UsageWindow{
			{ID: "session", Label: "Session", UsedPercent: 12, ResetSec: 3600},
			{ID: "weekly", Label: "Weekly", UsedPercent: 70, ResetSec: 3600},
			{ID: "fable", Label: "Fable only", UsedPercent: 0, ResetSec: 3600},
		},
		Pace: []codexbar.ProviderPace{
			{Window: "primary", Stage: "farBehind", DeltaPercent: -39, HasDeltaPercent: true, ExpectedUsedPercent: 44, HasExpectedUsedPercent: true, WillLastToReset: true},
			{Window: "secondary", Stage: "farAhead", DeltaPercent: 54, HasDeltaPercent: true, ExpectedUsedPercent: 16, HasExpectedUsedPercent: true, ETASeconds: 40427},
		},
	})
	session, weekly, fable := windows[0], windows[1], windows[2]
	if session.Stage != "farBehind" || session.DeltaPercent == nil || *session.DeltaPercent != -39 ||
		session.ExpectedUsedPercent == nil || *session.ExpectedUsedPercent != 44 {
		t.Fatalf("session must carry CodexBar's pace, got %+v", session)
	}
	if weekly.Stage != "farAhead" || weekly.DeltaPercent == nil || *weekly.DeltaPercent != 54 ||
		weekly.ExpectedUsedPercent == nil || *weekly.ExpectedUsedPercent != 16 {
		t.Fatalf("weekly must carry CodexBar's pace, got %+v", weekly)
	}
	if fable.Stage != "" || fable.DeltaPercent != nil || fable.ExpectedUsedPercent != nil {
		t.Fatalf("a lane without CodexBar pace carries none, got %+v", fable)
	}
	raw, err := json.Marshal(fable)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "stage") || strings.Contains(string(raw), "expectedUsedPercent") {
		t.Fatalf("no pace must mean no pace fields, got %s", raw)
	}
}

// An on-track lane has delta 0 and may expect 0% used: both stay on the wire.
func TestUsageWindowsKeepZeroPaceNumbers(t *testing.T) {
	windows := freshUsageWindows(codexbar.ProviderUsageMeta{
		Windows: []codexbar.UsageWindow{{ID: "weekly", Label: "Weekly", UsedPercent: 0, ResetSec: 3600}},
		Pace:    []codexbar.ProviderPace{{Window: "secondary", Stage: "onTrack", HasDeltaPercent: true, HasExpectedUsedPercent: true, WillLastToReset: true}},
	})
	raw, err := json.Marshal(windows[0])
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), `"deltaPercent":0`) || !strings.Contains(string(raw), `"expectedUsedPercent":0`) {
		t.Fatalf("zero pace numbers must stay on the wire, got %s", raw)
	}
}

// In remaining mode the expected-used percent flips with the window's percent,
// so the tick and the bar share one scale. CodexBar's delta does not change.
func TestUsageDisplayModeFlipsExpectedUsedWithTheWindow(t *testing.T) {
	expected, delta := 64, 12
	provider := usageProviderForDisplayMode(usageProviderInfo{
		UsageMode: "used",
		Windows: []usageWindowInfo{
			{ID: "weekly", Label: "Weekly", UsedPercent: 48, Stage: "ahead", DeltaPercent: &delta, ExpectedUsedPercent: &expected},
			{ID: "fable", Label: "Fable only", UsedPercent: 0, ResetSec: 3600},
		},
	}, "remaining")
	weekly := provider.Windows[0]
	if weekly.UsedPercent != 52 || weekly.ExpectedUsedPercent == nil || *weekly.ExpectedUsedPercent != 36 ||
		weekly.DeltaPercent == nil || *weekly.DeltaPercent != 12 {
		t.Fatalf("remaining mode must flip percent and expected together, got %+v", weekly)
	}
	if provider.Windows[1].ExpectedUsedPercent != nil {
		t.Fatalf("a lane without pace stays without, got %+v", provider.Windows[1])
	}
}

// A pace object with a stage but without the numbers must not turn into 0s.
func TestUsageWindowsKeepMissingPaceNumbersMissing(t *testing.T) {
	windows := freshUsageWindows(codexbar.ProviderUsageMeta{
		Windows: []codexbar.UsageWindow{{ID: "weekly", Label: "Weekly", UsedPercent: 40, ResetSec: 3600}},
		Pace:    []codexbar.ProviderPace{{Window: "secondary", Stage: "ahead", WillLastToReset: true}},
	})
	if windows[0].DeltaPercent != nil || windows[0].ExpectedUsedPercent != nil {
		t.Fatalf("missing pace numbers must stay missing, got %+v", windows[0])
	}
	raw, err := json.Marshal(windows[0])
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "deltaPercent") || strings.Contains(string(raw), "expectedUsedPercent") {
		t.Fatalf("missing pace numbers must not reach the wire, got %s", raw)
	}
}

func freshUsageWindows(meta codexbar.ProviderUsageMeta) []usageWindowInfo {
	return usageWindowsFromMeta(meta, false)
}

// CodexBar paced the window against the reset as it stood when the reading was
// fresh, so a stale reading carries no pace and neither does a window without
// a running reset.
func TestUsageWindowsDropPaceForStaleReadingOrWithoutReset(t *testing.T) {
	meta := codexbar.ProviderUsageMeta{
		Windows: []codexbar.UsageWindow{
			{ID: "session", Label: "Session", UsedPercent: 12, ResetSec: 3600},
			{ID: "weekly", Label: "Weekly", UsedPercent: 54},
		},
		Pace: []codexbar.ProviderPace{
			{Window: "primary", Stage: "ahead", DeltaPercent: 5, HasDeltaPercent: true, ExpectedUsedPercent: 7, HasExpectedUsedPercent: true, WillLastToReset: true},
			{Window: "secondary", Stage: "ahead", DeltaPercent: 5, HasDeltaPercent: true, WillLastToReset: true},
		},
	}
	fresh := usageWindowsFromMeta(meta, false)
	if fresh[0].Stage == "" || fresh[0].WillLastToReset == nil {
		t.Fatalf("a fresh running window keeps its pace, got %+v", fresh[0])
	}
	if fresh[1].Stage != "" || fresh[1].DeltaPercent != nil || fresh[1].WillLastToReset != nil {
		t.Fatalf("a window without a running reset carries no pace, got %+v", fresh[1])
	}
	for _, window := range usageWindowsFromMeta(meta, true) {
		if window.Stage != "" || window.DeltaPercent != nil || window.ExpectedUsedPercent != nil || window.WillLastToReset != nil {
			t.Fatalf("a stale reading carries no pace, got %+v", window)
		}
	}
}

// The page reads a collection some time after it was made: a window whose
// reset has passed by then loses its pace, one still running keeps it.
func TestUsagePaceEndsWhenItsResetHasPassed(t *testing.T) {
	collectedAt := time.Date(2026, 10, 19, 20, 0, 0, 0, time.UTC)
	delta, expected, lasts := 5, 7, true
	paced := func(resetSec int64) usageWindowInfo {
		return usageWindowInfo{ID: "session", ResetSec: resetSec, Stage: "ahead", DeltaPercent: &delta, ExpectedUsedPercent: &expected, WillLastToReset: &lasts}
	}
	windows := []usageWindowInfo{paced(30), paced(3600)}
	dropPaceAfterReset(windows, collectedAt.Add(time.Minute), collectedAt)
	if windows[0].Stage != "" || windows[0].DeltaPercent != nil || windows[0].ExpectedUsedPercent != nil || windows[0].WillLastToReset != nil {
		t.Fatalf("a window that reset 30s before the read still shows a pace: %+v", windows[0])
	}
	if windows[1].Stage != "ahead" || windows[1].DeltaPercent == nil {
		t.Fatalf("a window still running lost its pace: %+v", windows[1])
	}
}
