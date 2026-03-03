package health

import (
	"strings"
	"testing"
	"time"
)

func TestParseLaunchctlStatus(t *testing.T) {
	output := `
com.codexbar-display.daemon = {
	state = running
	pid = 12345
}`

	state, pid := parseLaunchctlStatus(output)
	if state != "running" {
		t.Fatalf("expected running state, got %q", state)
	}
	if pid != "12345" {
		t.Fatalf("expected pid 12345, got %q", pid)
	}
}

func TestExtractSentFramePort(t *testing.T) {
	line := "2026-02-26T10:00:00Z sent frame -> /dev/cu.usbserial-10 provider=codex label=Codex"
	port := extractSentFramePort(line)
	if port != "/dev/cu.usbserial-10" {
		t.Fatalf("expected serial path, got %q", port)
	}
}

func TestFindLastMatchingEvent(t *testing.T) {
	logBody := strings.Join([]string{
		"2026-02-26T09:59:00Z cycle error: kind=serial-write",
		"2026-02-26T10:00:00Z sent frame -> /dev/cu.usbserial-10 provider=codex",
		"",
	}, "\n")

	event := findLastSentFrameEvent("/tmp/out.log", func(string) ([]byte, error) {
		return []byte(logBody), nil
	})
	if !strings.Contains(event.Line, "sent frame ->") {
		t.Fatalf("expected sent frame line, got %q", event.Line)
	}
	if event.Timestamp.IsZero() {
		t.Fatalf("expected parsed timestamp")
	}
}

func TestLatestEventPrefersNewerTimestamp(t *testing.T) {
	oldEvent := logEvent{
		Line:      "2026-02-26T10:00:00Z cycle error: old",
		Timestamp: time.Date(2026, 2, 26, 10, 0, 0, 0, time.UTC),
	}
	newEvent := logEvent{
		Line:      "2026-02-26T10:01:00Z cycle error: new",
		Timestamp: time.Date(2026, 2, 26, 10, 1, 0, 0, time.UTC),
	}

	chosen := latestEvent(oldEvent, newEvent)
	if chosen.Line != newEvent.Line {
		t.Fatalf("expected newer event, got %q", chosen.Line)
	}
}
