package daemon

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimeconfig"
)

func TestSentFrameIsKeptForItsVibeTV(t *testing.T) {
	path := filepath.Join(t.TempDir(), "shown-frames.json")
	now := time.Date(2026, 10, 16, 12, 0, 0, 0, time.UTC)
	cycle := func(sendErr error) error {
		return runCycleWithDeps(context.Background(), "http://192.168.178.159", &runtimeState{}, runtimeDeps{
			now:             func() time.Time { return now },
			transportName:   "wifi",
			shownFramesPath: path,
			homeDir:         func() (string, error) { return "/tmp/codexbar-display-test", nil },
			loadConfig: func(string) (runtimeconfig.Config, error) {
				return runtimeconfig.Config{DeviceTarget: "http://192.168.178.159", DeviceToken: "pair-token-secret"}, nil
			},
			resolvePort: func(target string) (string, error) { return target, nil },
			deviceCaps: func(string) (protocol.DeviceCapabilities, error) {
				return protocol.DeviceCapabilities{
					Known:                     true,
					DeviceID:                  "5804558",
					Board:                     "esp8266-smalltv-st7789",
					NegotiatedProtocolVersion: protocol.ProtocolVersionV2,
					MaxFrameBytes:             2048,
				}, nil
			},
			fetchProviders: func(context.Context) ([]codexbar.ParsedFrame, error) {
				return []codexbar.ParsedFrame{testParsedFrame("codex", 12, 30, 3600)}, nil
			},
			logf:     func(format string, args ...any) { _ = fmt.Sprintf(format, args...) },
			sendLine: func(string, []byte) error { return sendErr },
		})
	}

	if err := cycle(nil); err != nil {
		t.Fatalf("expected cycle success, got %v", err)
	}
	kept := LoadShownFrames(path)["5804558"]
	if !kept.SentAt.Equal(now) || !strings.HasPrefix(kept.Line, "sent frame -> http://192.168.178.159 ") || !strings.Contains(kept.Line, " provider=codex ") {
		t.Fatalf("want the sent frame kept for its VibeTV, got %+v", kept)
	}
	if strings.Contains(kept.Line, "pair-token-secret") {
		t.Fatalf("the kept frame leaked the pairing token: %q", kept.Line)
	}

	// A failed write delivered nothing: the VibeTV keeps showing the kept frame.
	sentAt := now
	now = now.Add(time.Minute)
	if err := cycle(errors.New("device offline")); err == nil {
		t.Fatal("expected the failed write to fail the cycle")
	}
	if kept := LoadShownFrames(path)["5804558"]; !kept.SentAt.Equal(sentAt) {
		t.Fatalf("a failed write must not replace the kept frame, got %+v", kept)
	}
}

func TestShownFramesKeepTheNewestVibeTVs(t *testing.T) {
	path := filepath.Join(t.TempDir(), "shown-frames.json")
	start := time.Date(2026, 10, 16, 12, 0, 0, 0, time.UTC)
	for i := 0; i <= maxShownFrames; i++ {
		if err := saveShownFrame(path, fmt.Sprintf("device-%d", i), start.Add(time.Duration(i)*time.Minute), "sent frame -> x"); err != nil {
			t.Fatalf("save: %v", err)
		}
	}
	frames := LoadShownFrames(path)
	if _, ok := frames["device-0"]; ok || len(frames) != maxShownFrames {
		t.Fatalf("want the %d newest VibeTVs, got %d with device-0 %v", maxShownFrames, len(frames), ok)
	}
}
