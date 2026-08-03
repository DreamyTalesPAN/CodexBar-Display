package daemon

import (
	"testing"
	"time"
)

func TestNextClockTransitionUsesLocationZoneBounds(t *testing.T) {
	location, err := time.LoadLocation("Europe/Berlin")
	if err != nil {
		t.Fatalf("load test location: %v", err)
	}

	startOfDST := time.Date(2026, time.March, 29, 1, 30, 0, 0, location)
	start := nextClockTransition(startOfDST)
	if start == nil {
		t.Fatal("expected the next DST transition")
	}
	wantStartEpoch := time.Date(2026, time.March, 29, 1, 0, 0, 0, time.UTC).Unix()
	if start.CurrentOffsetMinutes != 60 ||
		start.TransitionEpoch != wantStartEpoch || start.OffsetMinutes != 120 {
		t.Fatalf("DST start = %+v, want current 60, epoch %d and offset 120", *start, wantStartEpoch)
	}

	startOfStandardTime := time.Date(2026, time.October, 25, 1, 30, 0, 0, location)
	end := nextClockTransition(startOfStandardTime)
	if end == nil {
		t.Fatal("expected the next standard-time transition")
	}
	wantEndEpoch := time.Date(2026, time.October, 25, 1, 0, 0, 0, time.UTC).Unix()
	if end.CurrentOffsetMinutes != 120 ||
		end.TransitionEpoch != wantEndEpoch || end.OffsetMinutes != 60 {
		t.Fatalf("DST end = %+v, want current 120, epoch %d and offset 60", *end, wantEndEpoch)
	}
}

func TestNextClockTransitionCarriesFixedOffsetWithoutTransition(t *testing.T) {
	fixedOffset := time.FixedZone("UTC+14", 14*60*60)
	now := time.Date(2026, time.July, 29, 2, 34, 0, 0, fixedOffset)
	got := nextClockTransition(now)
	if got == nil || got.CurrentOffsetMinutes != 840 || got.TransitionEpoch != 0 || got.OffsetMinutes != 0 {
		t.Fatalf("fixed offset schedule = %+v, want current 840 without transition", got)
	}
}
