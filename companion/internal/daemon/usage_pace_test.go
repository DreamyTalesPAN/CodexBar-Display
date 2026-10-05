package daemon

import (
	"bytes"
	"context"
	"testing"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
)

func pacedUsageWindows() []protocol.UsageWindow {
	lasts := true
	return []protocol.UsageWindow{
		{ID: "session", Label: "Session", Percent: 8, ResetSec: 12000, Pace: protocol.UsagePace{Delta: -25, State: protocol.PaceReserve, Lasts: &lasts}},
		{ID: "weekly", Label: "Weekly", Percent: 73, ResetSec: 95000, Pace: protocol.UsagePace{Delta: 14, State: protocol.PaceDeficit}},
		{ID: "fable", Label: "Fable only", Percent: 100, ResetSec: 95000},
	}
}

// Firmware without usage-pace-v1 renders an unknown usageSlotN key as that
// window's percent, so it must never be handed pace in the first place.
func TestUsagePaceReachesOnlyFirmwareThatAdvertisesIt(t *testing.T) {
	prepareFastTestEnv(t)
	now := time.Date(2026, 9, 21, 8, 30, 0, 0, time.UTC)
	for _, supported := range []bool{false, true} {
		parsed := testParsedFrame("claude", 8, 73, 12000)
		parsed.CollectedAt = now
		parsed.Frame.UsageWindows = pacedUsageWindows()
		var sent []byte
		err := runCycleWithDeps(context.Background(), "", &runtimeState{selector: codexbar.NewProviderSelector()}, runtimeDeps{
			now:         func() time.Time { return now },
			resolvePort: func(string) (string, error) { return "/dev/cu.usbmodem-test", nil },
			deviceCaps: func(string) (protocol.DeviceCapabilities, error) {
				return protocol.DeviceCapabilities{
					Known:                     true,
					Board:                     "esp8266-smalltv-st7789",
					NegotiatedProtocolVersion: protocol.ProtocolVersionV2,
					SupportsUsagePaceV1:       supported,
				}, nil
			},
			fetchProviders: func(context.Context) ([]codexbar.ParsedFrame, error) {
				return []codexbar.ParsedFrame{parsed}, nil
			},
			logf: func(string, ...any) {},
			sendLine: func(_ string, line []byte) error {
				sent = append([]byte(nil), line...)
				return nil
			},
		})
		if err != nil {
			t.Fatal(err)
		}
		if got := bytes.Contains(sent, []byte(`"pace":{"delta":-25,"state":"reserve","lasts":true}`)) &&
			bytes.Contains(sent, []byte(`"pace":{"delta":14,"state":"deficit"}`)); got != supported {
			t.Fatalf("supportsUsagePaceV1=%t sent pace=%t:\n%s", supported, got, sent)
		}
		if !supported && bytes.Contains(sent, []byte(`"pace"`)) {
			t.Fatalf("pace reached firmware without usage-pace-v1:\n%s", sent)
		}
	}
}

func TestMarshalFrameWithinLimitDropsPaceBeforeUsageWindows(t *testing.T) {
	frame := protocol.Frame{V: protocol.ProtocolVersionV2, Provider: "claude", Label: "Claude", UsageWindows: pacedUsageWindows()}
	withoutPace := withoutUsagePace(frame)
	limitLine, err := withoutPace.MarshalLine()
	if err != nil {
		t.Fatal(err)
	}
	line, marshaled, err := marshalFrameWithinLimit(frame, len(limitLine))
	if err != nil {
		t.Fatal(err)
	}
	if len(marshaled.UsageWindows) != 3 || bytes.Contains(line, []byte(`"pace"`)) {
		t.Fatalf("expected all three windows without pace, got %s", line)
	}
	if frame.UsageWindows[0].Pace.State != protocol.PaceReserve {
		t.Fatal("trimming must not touch the authoritative frame")
	}
}
