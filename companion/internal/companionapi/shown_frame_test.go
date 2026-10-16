package companionapi

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/daemon"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimepaths"
)

func TestShownFrameOutlivesTheLogTail(t *testing.T) {
	logPath := filepath.Join(t.TempDir(), "daemon.out.log")
	t.Setenv(displayStreamOutLogEnv, logPath)
	sentAt := time.Now().UTC().Add(-2 * time.Hour).Truncate(time.Second)
	keep := func(frames map[string]daemon.ShownFrame) {
		raw, err := json.Marshal(frames)
		if err != nil {
			t.Fatalf("marshal: %v", err)
		}
		if err := os.WriteFile(runtimepaths.DisplayShownFrames(logPath), raw, 0o600); err != nil {
			t.Fatalf("write shown frames: %v", err)
		}
	}
	// Two hours of retries pushed the frame out of the log tail.
	errorLine := time.Now().UTC().Format(time.RFC3339Nano) + ` cycle error: code=runtime_serial_write op=send-line retry=3s err=device-busy`
	if err := os.WriteFile(logPath, []byte(strings.Repeat(errorLine+"\n", 3)), 0o600); err != nil {
		t.Fatalf("write display stream log: %v", err)
	}
	keep(map[string]daemon.ShownFrame{
		"5804558": {SentAt: sentAt, Line: `sent frame -> /dev/cu.usbserial-1410 transport=usb deviceId=5804558 provider=claude label=VibeTV error=""`},
		"777":     {SentAt: sentAt.Add(time.Minute), Line: `sent frame -> http://192.168.178.73 transport=wifi deviceId=777 provider=codex label=VibeTV error=""`},
	})
	stream := withShownFrame(displayStreamInfo{Target: cableDeviceTarget, Running: true}, cableDeviceTarget)
	if stream.Provider != "claude" || stream.shownDeviceID != "5804558" || !stream.shownAt.Equal(sentAt) {
		t.Fatalf("want the kept frame of the cable VibeTV, got %+v", stream)
	}

	// A newer frame in the log wins over an older kept one.
	logFrame := sentAt.Add(time.Hour).Format(time.RFC3339Nano) + ` sent frame -> /dev/cu.usbserial-1410 transport=usb deviceId=5804558 provider=codex label=VibeTV error=""`
	if err := os.WriteFile(logPath, []byte(logFrame+"\n"), 0o600); err != nil {
		t.Fatalf("write display stream log: %v", err)
	}
	if stream := withShownFrame(displayStreamInfo{Target: cableDeviceTarget}, cableDeviceTarget); stream.Provider != "codex" {
		t.Fatalf("want the newer logged frame, got %+v", stream)
	}
}
