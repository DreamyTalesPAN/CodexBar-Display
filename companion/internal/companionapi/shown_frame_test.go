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

func TestShownFrameFollowsTheConfiguredVibeTV(t *testing.T) {
	sentAt := time.Now().UTC().Add(-time.Hour).Truncate(time.Second)
	at := func(d time.Duration) string { return sentAt.Add(d).Format(time.RFC3339Nano) }
	cableA := at(0) + ` sent frame -> /dev/cu.usbserial-1410 transport=usb deviceId=5804558 provider=codex label=VibeTV error=""`
	cableB := at(time.Minute) + ` sent frame -> /dev/cu.usbserial-1410 transport=usb deviceId=777 provider=claude label=VibeTV error=""`
	wifiA := at(0) + ` sent frame -> http://192.168.178.72 transport=wifi deviceId=5804558 provider=claude label=VibeTV error=""`
	for _, tc := range []struct {
		name      string
		lines     []string
		errorCode string
		want      string
	}{
		{"cable A, then B, back to A", []string{cableA, cableB}, "", "codex"},
		{"A moved from WiFi to Cable, no Cable frame yet", []string{wifiA}, "", "claude"},
		{"stream sends to B while A is configured", []string{cableA, cableB}, "device_frame_mismatch", "codex"},
		{"no frame for A", []string{cableB}, "", ""},
		{"frame logged without a device ID", []string{at(0) + ` sent frame -> /dev/cu.usbserial-1410 transport=usb provider=codex label=VibeTV error=""`}, "", "codex"},
		{"USB unplugged", []string{cableA}, "device_not_found", ""},
		{"pairing rejected", []string{cableA}, "pairing_token_rejected", ""},
	} {
		logPath := filepath.Join(t.TempDir(), "daemon.out.log")
		t.Setenv(displayStreamOutLogEnv, logPath)
		if err := os.WriteFile(logPath, []byte(strings.Join(tc.lines, "\n")+"\n"), 0o600); err != nil {
			t.Fatalf("write display stream log: %v", err)
		}
		stream := withShownFrame(displayStreamInfo{Target: cableDeviceTarget, Running: true, ErrorCode: tc.errorCode}, cableDeviceTarget)
		got := withConfiguredDeviceFrame(deviceInfo{Target: cableDeviceTarget, Stream: &stream}, "5804558")
		if got.Stream.Provider != tc.want || (tc.want != "" && got.Stream.shownDeviceID != "5804558" && got.Stream.shownDeviceID != "") {
			t.Fatalf("%s: want provider %q of the configured VibeTV, got %+v", tc.name, tc.want, got.Stream)
		}
	}
}
