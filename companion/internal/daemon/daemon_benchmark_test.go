package daemon

import (
	"context"
	"testing"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
)

func BenchmarkRunCycleWithDeps(b *testing.B) {
	prepareFastTestEnvForBench(b)

	state := &runtimeState{
		selector: codexbar.NewProviderSelector(),
	}

	deps := runtimeDeps{
		now:         func() time.Time { return time.Date(2026, 2, 26, 12, 0, 0, 0, time.UTC) },
		resolvePort: func(string) (string, error) { return "/dev/cu.usbmodem-bench", nil },
		deviceCaps:  func(string) (protocol.DeviceCapabilities, error) { return protocol.UnknownDeviceCapabilities(), nil },
		fetchProviders: func(context.Context) ([]codexbar.ParsedFrame, error) {
			return []codexbar.ParsedFrame{
				testParsedFrame("codex", 13, 41, 3600),
				testParsedFrame("claude", 19, 44, 4200),
			}, nil
		},
		sendLine: func(string, []byte) error { return nil },
		logf:     func(string, ...any) {},
	}

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if err := runCycleWithDeps(context.Background(), "", state, deps); err != nil {
			b.Fatalf("run cycle: %v", err)
		}
	}
}

func BenchmarkMarshalFrameWithinLimit(b *testing.B) {
	frame := testParsedFrame("codex", 21, 54, 1800).Frame
	frame.Theme = "crt"
	const maxBytes = 512

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, _, err := marshalFrameWithinLimit(frame, maxBytes); err != nil {
			b.Fatalf("marshal frame: %v", err)
		}
	}
}

func prepareFastTestEnvForBench(tb testing.TB) {
	tb.Helper()
	tmpHome := tb.TempDir()
	tb.Setenv("HOME", tmpHome)
	tb.Setenv("VIBEBLOCK_CHROMIUM_COOKIE_DB_PATHS", tmpHome+"/missing-cookies.db")
}
