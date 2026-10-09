package protocol

import (
	"strings"
	"testing"
	"time"
)

func TestUsagePaceWireShape(t *testing.T) {
	lasts, runsOut := true, false
	frame := Frame{V: ProtocolVersionV2, Provider: "claude", UsageWindows: []UsageWindow{
		{ID: "session", Label: "Session", Percent: 8, ResetSec: 600, Pace: UsagePace{Delta: -25, State: PaceReserve, Lasts: &lasts}},
		{ID: "weekly", Label: "Weekly", Percent: 73, ResetSec: 900, Pace: UsagePace{Delta: 14, State: PaceDeficit, Lasts: &runsOut}},
		{ID: "fable", Label: "Fable only", Percent: 100, ResetSec: 900, Pace: UsagePace{State: PaceOnPace}},
		{ID: "monthly", Label: "Monthly", Percent: 5, ResetSec: 900},
	}}
	line, err := frame.MarshalLine()
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		`"resetSecs":600,"pace":{"delta":-25,"state":"reserve","lasts":true}}`,
		`"resetSecs":900,"pace":{"delta":14,"state":"deficit","lasts":false}}`,
		// No projection from CodexBar: no lasts on the wire.
		`"resetSecs":900,"pace":{"delta":0,"state":"on pace"}}`,
		// No pace at all: not even an empty object.
		`"label":"Monthly","percent":5,"resetSecs":900}`,
	} {
		if !strings.Contains(string(line), want) {
			t.Fatalf("wire frame lacks %s:\n%s", want, line)
		}
	}
}

func TestUsagePaceEndsWithItsWindowReset(t *testing.T) {
	collectedAt := time.Date(2026, 9, 21, 8, 30, 0, 0, time.UTC)
	frame := Frame{V: ProtocolVersionV2, Provider: "claude", UsageWindows: []UsageWindow{
		{ID: "session", Label: "Session", Percent: 8, ResetSec: 60, Pace: UsagePace{Delta: -25, State: PaceReserve}},
		{ID: "weekly", Label: "Weekly", Percent: 73, ResetSec: 3600, Pace: UsagePace{Delta: -11, State: PaceReserve}},
	}}

	live := frame.ApplyResetTrust(collectedAt, collectedAt.Add(30*time.Second), true)
	if live.UsageWindows[0].Pace.State != PaceReserve || live.UsageWindows[1].Pace.State != PaceReserve {
		t.Fatalf("pace of running windows must stay: %+v", live.UsageWindows)
	}
	// The session window resets 60 s after collection; its pace ends with it.
	pastReset := frame.ApplyResetTrust(collectedAt, collectedAt.Add(2*time.Minute), true)
	if pastReset.UsageWindows[0].Pace != (UsagePace{}) || pastReset.UsageWindows[1].Pace.Delta != -11 {
		t.Fatalf("only the expired window loses its pace: %+v", pastReset.UsageWindows)
	}
	// An untrusted basis clears every countdown, and every pace with it.
	stale := frame.ApplyResetTrust(time.Time{}, collectedAt, true)
	for _, window := range stale.UsageWindows {
		if window.Pace != (UsagePace{}) {
			t.Fatalf("stale frame kept pace: %+v", stale.UsageWindows)
		}
	}
}

func TestUsagePaceOutsideTheContractIsDropped(t *testing.T) {
	for _, pace := range []UsagePace{
		{Delta: -25, State: "farBehind"},
		{Delta: -101, State: PaceReserve},
		{Delta: 101, State: PaceDeficit},
	} {
		frame := Frame{V: ProtocolVersionV2, UsageWindows: []UsageWindow{
			{ID: "weekly", Label: "Weekly", Percent: 10, ResetSec: 60, Pace: pace},
		}}.Normalize()
		if frame.UsageWindows[0].Pace != (UsagePace{}) {
			t.Fatalf("pace %+v reached the wire", pace)
		}
	}
}
