package daemon

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimeconfig"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/timeline"
)

// Fourteen cycles, ten of them failing: the timeline holds the transitions a
// support engineer needs, not one entry per cycle.
func TestWorkerReportsTransitionsToTheTimeline(t *testing.T) {
	prepareFastTestEnv(t)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	now := time.Date(2026, 10, 6, 12, 0, 0, 0, time.UTC)
	store := timeline.Open("")
	afterCalls := 0
	sendAttempts := 0
	err := runWithDeps(ctx, Options{
		Interval: 60 * time.Second,
		RecordEvent: func(event timeline.Event) {
			event.CorrelationID = "run-1"
			store.Record(now, event)
		},
	}, runtimeDeps{
		now: func() time.Time {
			now = now.Add(time.Second)
			return now
		},
		after: func(time.Duration) <-chan time.Time {
			afterCalls++
			if afterCalls >= 14 {
				cancel()
				return make(chan time.Time)
			}
			ch := make(chan time.Time)
			close(ch)
			return ch
		},
		resolvePort: func(string) (string, error) { return "/dev/cu.usbmodem-test", nil },
		deviceCaps: func(string) (protocol.DeviceCapabilities, error) {
			return protocol.DeviceCapabilities{
				Known:           true,
				DeviceID:        "vibetv-8caab5",
				Firmware:        "1.14.2",
				MaxFrameBytes:   2048,
				ProtocolVersion: protocol.ProtocolVersionV2,
			}, nil
		},
		logf: func(string, ...any) {},
		fetchProviders: func(context.Context) ([]codexbar.ParsedFrame, error) {
			return []codexbar.ParsedFrame{testParsedFrame("codex", 10, 20, 3600)}, nil
		},
		sendLine: func(string, []byte) error {
			sendAttempts++
			if sendAttempts <= 10 {
				return errors.New("write serial /dev/cu.usbmodem-test: I/O error")
			}
			return nil
		},
	})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("run = %v", err)
	}
	if sendAttempts < 12 {
		t.Fatalf("only %d sends; the test needs repeated failures and successes", sendAttempts)
	}

	var got []string
	for _, event := range store.Snapshot(now).Events {
		line := event.Component + "=" + event.State
		if event.Reason != "" {
			line += "(" + event.Reason + ")"
		}
		if event.DeviceID != "" {
			line += "@" + event.DeviceID
		}
		if event.CorrelationID != "run-1" {
			t.Fatalf("event without the run's correlation ID: %+v", event)
		}
		got = append(got, line)
	}
	want := []string{
		"stream=started(usb)",
		"device=unreachable(runtime/serial-write)",
		"device=reachable@vibetv-8caab5",
		"firmware=1.14.2@vibetv-8caab5",
		"provider=codex@vibetv-8caab5",
		"usage=shown@vibetv-8caab5",
		"stream=sending@vibetv-8caab5",
		"stream=stopped",
	}
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Fatalf("timeline:\n%s\nwant:\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"))
	}
}

func TestCycleFailureIsAttributedToDeviceOrStream(t *testing.T) {
	for kind, want := range map[runtimeErrorKind]string{
		runtimeErrorDeviceHello:     "device=unreachable(protocol/device-hello-unavailable)",
		runtimeErrorSerialResolve:   "device=unreachable(runtime/serial-resolve)",
		runtimeErrorPairingRequired: "device=pairing_required(runtime/device-pairing-required)",
		runtimeErrorCodexbarCmd:     "stream=failed(runtime/codexbar-command)",
		runtimeErrorCycleTimeout:    "stream=failed(runtime/cycle-timeout)",
	} {
		var got string
		recordCycleFailure(runtimeDeps{record: func(event timeline.Event) {
			got = event.Component + "=" + event.State + "(" + event.Reason + ")"
		}}, &RuntimeError{Kind: kind, Err: errors.New("open /Users/someone/secret: denied")})
		if got != want {
			t.Fatalf("%s recorded %q, want %q", kind, got, want)
		}
	}
}

func TestTimelineStateOrUnknown(t *testing.T) {
	// An error frame carries no provider; the timeline must not keep showing
	// the previous one as current.
	store := timeline.Open("")
	at := time.Date(2026, 10, 6, 12, 0, 0, 0, time.UTC)
	for _, provider := range []string{"claude", "", " ", "claude"} {
		store.Record(at, timeline.Event{Component: "provider", State: timelineStateOrUnknown(provider)})
	}
	var got []string
	for _, event := range store.Snapshot(at).Events {
		got = append(got, event.State)
	}
	if strings.Join(got, ",") != "claude,unknown,claude" {
		t.Fatalf("provider states = %v", got)
	}
}

func TestUsageTimelineEventNamesALastGoodFrameStale(t *testing.T) {
	if got := usageTimelineEvent(false, false, "", ""); got.State != "shown" {
		t.Fatalf("fresh usage = %+v", got)
	}
	if got := usageTimelineEvent(false, true, "provider/timeout", ""); got.State != "stale" || got.Reason != "provider/timeout" {
		t.Fatalf("last-good frame = %+v", got)
	}
	if got := usageTimelineEvent(true, false, "", "no-provider"); got.State != "unavailable" || got.Reason != "no-provider" {
		t.Fatalf("unavailable frame = %+v", got)
	}
	if got := usageTimelineEvent(true, true, "provider/timeout", "error-frame"); got.State != "unavailable" || got.Reason != "provider/timeout" {
		t.Fatalf("frame after a failed collection = %+v", got)
	}
}

// timelineOfWorker runs the display worker for the given number of waits and
// returns what it recorded, one "component=state(reason)" per transition.
func timelineOfWorker(t *testing.T, waits int, opts Options, deps runtimeDeps) []string {
	t.Helper()
	prepareFastTestEnv(t)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	at := time.Date(2026, 10, 9, 12, 0, 0, 0, time.UTC)
	store := timeline.Open("")
	opts.Interval = 60 * time.Second
	opts.RecordEvent = func(event timeline.Event) { store.Record(at, event) }
	afterCalls := 0
	deps.after = func(time.Duration) <-chan time.Time {
		afterCalls++
		if afterCalls >= waits {
			cancel()
			return make(chan time.Time)
		}
		ch := make(chan time.Time)
		close(ch)
		return ch
	}
	deps.resolvePort = func(string) (string, error) { return "/dev/cu.usbmodem-test", nil }
	deps.deviceCaps = func(string) (protocol.DeviceCapabilities, error) {
		return protocol.DeviceCapabilities{Known: true, DeviceID: "vibetv-8caab5", Firmware: "1.14.2", MaxFrameBytes: 2048, ProtocolVersion: protocol.ProtocolVersionV2}, nil
	}
	deps.logf = func(string, ...any) {}
	if deps.fetchProviders == nil {
		deps.fetchProviders = func(context.Context) ([]codexbar.ParsedFrame, error) {
			return []codexbar.ParsedFrame{testParsedFrame("codex", 10, 20, 3600)}, nil
		}
	}
	if err := runWithDeps(ctx, opts, deps); !errors.Is(err, context.Canceled) {
		t.Fatalf("run = %v", err)
	}

	var got []string
	for _, event := range store.Snapshot(at).Events {
		line := event.Component + "=" + event.State
		if event.Reason != "" {
			line += "(" + event.Reason + ")"
		}
		got = append(got, line)
	}
	return got
}

// Review of #525: the VibeTV accepted the error frame, so the stream is
// sending; that the collection failed is said by the usage entry, once, and
// not by a "stream failed" on every cycle.
func TestADeliveredErrorFrameIsRecordedAsSendingWithUsageUnavailable(t *testing.T) {
	sent := 0
	got := timelineOfWorker(t, 6, Options{}, runtimeDeps{
		fetchProviders: func(context.Context) ([]codexbar.ParsedFrame, error) {
			return nil, errors.New("codexbar: exit status 1 in /Users/someone/.codexbar")
		},
		sendLine: func(string, []byte) error { sent++; return nil },
	})
	if sent < 3 {
		t.Fatalf("only %d frames sent; the test needs several failing cycles", sent)
	}
	want := []string{
		"stream=started(usb)",
		"device=reachable",
		"firmware=1.14.2",
		"provider=unknown",
		"usage=unavailable(runtime/codexbar-command)",
		"stream=sending",
		"stream=stopped",
	}
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Fatalf("timeline:\n%s\nwant:\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"))
	}
}

// Review of #525: after "Run setup again" the cable frames are skipped until
// the customer chooses a connection. The last entry must not stay "sending".
func TestSkippedCableFramesAreRecordedAsAPausedStream(t *testing.T) {
	blocked := false
	got := timelineOfWorker(t, 6, Options{}, runtimeDeps{
		loadConfig: func(string) (runtimeconfig.Config, error) {
			return runtimeconfig.Config{CableAutoBindDisabled: blocked}, nil
		},
		saveConfig: func(string, runtimeconfig.Config) error { return nil },
		sendLine:   func(string, []byte) error { blocked = true; return nil },
	})
	if len(got) < 2 || got[len(got)-2] != "stream=paused(connection-choice-required)" {
		t.Fatalf("timeline:\n%s\nwant stream=paused(connection-choice-required) before the stop", strings.Join(got, "\n"))
	}
}

// Review of #525: when a pause ends and the VibeTV then does not answer, the
// stream entry must not stay "paused" while the worker is retrying.
func TestTheEndOfAPauseIsRecorded(t *testing.T) {
	pauseChecks := 0
	got := timelineOfWorker(t, 6, Options{
		PauseDeviceWrites: func() bool { pauseChecks++; return pauseChecks <= 2 },
	}, runtimeDeps{
		sendLine: func(string, []byte) error { return errors.New("write serial: I/O error") },
	})
	want := []string{
		"stream=started(usb)",
		"stream=paused(device-maintenance)",
		"stream=resumed",
		"device=unreachable(runtime/serial-write)",
		"stream=stopped",
	}
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Fatalf("timeline:\n%s\nwant:\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"))
	}
}

// Review of the port: a frame restated because the provider has no fresh
// reading (#369) repeats old values, so the timeline must not call it shown.
func TestARestatedFrameWithoutAFreshReadingIsRecordedAsStale(t *testing.T) {
	prepareFastTestEnv(t)

	now := time.Date(2026, 10, 9, 12, 0, 0, 0, time.UTC)
	retained := false
	var got []string
	state := &runtimeState{selector: codexbar.NewProviderSelector()}
	deps := runtimeDeps{
		now:         func() time.Time { return now },
		resolvePort: func(string) (string, error) { return "/dev/cu.usbmodem-test", nil },
		fetchProviders: func(context.Context) ([]codexbar.ParsedFrame, error) {
			frame := testParsedFrame("codex", 12, 30, 3600)
			frame.Stale = retained
			return []codexbar.ParsedFrame{frame}, nil
		},
		transportName: "usb",
		logf:          func(string, ...any) {},
		sendLine:      func(string, []byte) error { return nil },
		record: func(event timeline.Event) {
			if event.Component != "usage" {
				return
			}
			line := event.State + "(" + event.Reason + ")"
			if len(got) == 0 || got[len(got)-1] != line {
				got = append(got, line)
			}
		},
	}
	for i := 0; i < 4; i++ {
		if err := runCycleWithDeps(context.Background(), "", state, deps); err != nil {
			t.Fatalf("cycle %d: %v", i, err)
		}
		retained = true
		now = now.Add(2 * time.Second)
	}
	if want := "shown(),stale(usage-not-fresh)"; strings.Join(got, ",") != want {
		t.Fatalf("usage entries = %v, want %s", got, want)
	}
}

// Fourth review: the display was just moved to a provider whose reading is
// only retained and there is no last good frame (#369). That frame goes out
// marked as not live, so the timeline must not call it shown either.
func TestARetainedReadingWithoutALastGoodFrameIsRecordedAsStale(t *testing.T) {
	prepareFastTestEnv(t)

	var got []string
	state := &runtimeState{selector: codexbar.NewProviderSelector()}
	sent := 0
	deps := runtimeDeps{
		now:         func() time.Time { return time.Date(2026, 10, 9, 12, 0, 0, 0, time.UTC) },
		resolvePort: func(string) (string, error) { return "/dev/cu.usbmodem-test", nil },
		fetchProviders: func(context.Context) ([]codexbar.ParsedFrame, error) {
			frame := testParsedFrame("codex", 12, 30, 3600)
			frame.Stale = true
			return []codexbar.ParsedFrame{frame}, nil
		},
		transportName: "usb",
		logf:          func(string, ...any) {},
		sendLine:      func(string, []byte) error { sent++; return nil },
		record: func(event timeline.Event) {
			if event.Component == "usage" {
				got = append(got, event.State+"("+event.Reason+")")
			}
		},
	}
	if err := runCycleWithDeps(context.Background(), "", state, deps); err != nil || sent != 1 || state.hasLastGood {
		t.Fatalf("err=%v sent=%d hasLastGood=%t; the test needs one retained frame sent", err, sent, state.hasLastGood)
	}
	if want := "stale(usage-not-fresh)"; strings.Join(got, ",") != want {
		t.Fatalf("usage entries = %v, want %s", got, want)
	}
}
