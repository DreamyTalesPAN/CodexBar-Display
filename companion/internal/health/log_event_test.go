package health

import (
	"testing"
	"time"
)

func TestParseLogTimestampReadsRFC3339FirstField(t *testing.T) {
	utc := time.Date(2026, 5, 3, 15, 19, 35, 0, time.UTC)
	tests := []struct {
		name string
		line string
		want time.Time
	}{
		{name: "RFC3339 with Z", line: "2026-05-03T15:19:35Z cycle error: x", want: utc},
		{name: "RFC3339 with fractional seconds", line: "2026-05-03T15:19:35.250Z sent frame", want: utc.Add(250 * time.Millisecond)},
		{name: "RFC3339 with offset", line: "2026-05-03T17:19:35+02:00 sent frame", want: utc},
		{name: "leading spaces are trimmed", line: "   2026-05-03T15:19:35Z padded", want: utc},
		{name: "timestamp only", line: "2026-05-03T15:19:35Z", want: utc},
		{name: "space instead of T is not recognized", line: "2026-05-03 15:19:35 cycle error", want: time.Time{}},
		{name: "message without timestamp", line: "sent frame -> /dev/cu.usbserial-10", want: time.Time{}},
		{name: "blank line", line: "   ", want: time.Time{}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := parseLogTimestamp(tt.line)
			if got.IsZero() != tt.want.IsZero() || (!tt.want.IsZero() && !got.Equal(tt.want)) {
				t.Fatalf("parseLogTimestamp(%q)=%v, expected %v", tt.line, got, tt.want)
			}
		})
	}
}

func TestFindLastNonEmptyEventReturnsNewestNonBlankLine(t *testing.T) {
	lines := []string{
		"2026-05-03T15:00:00Z first",
		"   ",
		"2026-05-03T15:10:00Z last  ",
		"",
	}
	got := findLastNonEmptyEvent(lines)
	if got.Line != "2026-05-03T15:10:00Z last" {
		t.Fatalf("Line=%q, expected the trimmed last non-blank line", got.Line)
	}
	want := time.Date(2026, 5, 3, 15, 10, 0, 0, time.UTC)
	if !got.Timestamp.Equal(want) {
		t.Fatalf("Timestamp=%v, expected %v", got.Timestamp, want)
	}
}

func TestFindLastNonEmptyEventIsEmptyWhenNoContent(t *testing.T) {
	for name, lines := range map[string][]string{
		"nil":         nil,
		"blank lines": {"", " \t "},
	} {
		if got := findLastNonEmptyEvent(lines); got.Line != "" || !got.Timestamp.IsZero() {
			t.Fatalf("%s: findLastNonEmptyEvent=%+v, expected empty event", name, got)
		}
	}
}
