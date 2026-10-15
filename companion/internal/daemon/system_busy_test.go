package daemon

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/url"
	"syscall"
	"testing"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/systemload"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/timeline"
)

// starvedMac is Paul's Mac on 2026-10-14 (#606): swap the size of the memory.
var starvedMac = systemload.Figures{MemoryAvailablePercent: 5, MemoryPressure: "warn", MemoryTotalMB: 24576, SwapUsedMB: 23040, Load1: 214, CPUs: 8}

type systemBusyHarness struct {
	collector *providerCollector
	now       time.Time
	running   bool
	answers   bool
	// silence is the failed fetch while the engine does not answer.
	silence  error
	figures  systemload.Figures
	reported []*SystemBusy
	events   []timeline.Event
}

func newSystemBusyHarness(t *testing.T) *systemBusyHarness {
	t.Helper()
	prepareFastTestEnv(t)
	h := &systemBusyHarness{
		now:     time.Date(2026, 10, 14, 9, 11, 0, 0, time.UTC),
		running: true,
		silence: &url.Error{Op: "Get", URL: "http://127.0.0.1:50000/dashboard/v1/snapshot", Err: context.DeadlineExceeded},
		figures: starvedMac,
	}
	h.collector = &providerCollector{
		now:             func() time.Time { return h.now },
		logf:            func(string, ...any) {},
		order:           []string{"claude"},
		interval:        30 * time.Second,
		timeout:         time.Minute,
		snapshotMaxAge:  10 * time.Minute,
		persistInterval: time.Minute,
		providers:       make(map[string]providerSnapshot),
		dashboard: dashboardServeFunc(func() codexbar.DashboardServeInfo {
			return codexbar.DashboardServeInfo{Endpoint: "http://127.0.0.1:50000", Running: h.running, Healthy: h.running}
		}),
		fetchDashboard: func(context.Context, codexbar.DashboardServeInfo, time.Time) ([]codexbar.ParsedFrame, error) {
			if !h.answers {
				return nil, h.silence
			}
			// Answering is enough, even when the provider itself failed.
			claude := testParsedFrame("claude", 28, 35, 7200)
			claude.Frame.Error = "Claude is signed out"
			return []codexbar.ParsedFrame{claude}, nil
		},
		readSystemLoad:   func() (systemload.Figures, error) { return h.figures, nil },
		reportSystemBusy: func(busy *SystemBusy) { h.reported = append(h.reported, busy) },
		record:           func(event timeline.Event) { h.events = append(h.events, event) },
	}
	return h
}

// cycles runs n collections, one collection interval apart.
func (h *systemBusyHarness) cycles(n int) {
	for range n {
		h.collector.collectOnce(context.Background())
		h.now = h.now.Add(h.collector.interval)
	}
}

func (h *systemBusyHarness) last() *SystemBusy {
	return h.reported[len(h.reported)-1]
}

func TestSystemBusyNeedsSilentEngineAndStarvedComputer(t *testing.T) {
	h := newSystemBusyHarness(t)
	// One failure, then two more intervals: still within a few cycles.
	h.cycles(3)
	if h.last() != nil || h.collector.isSystemBusy() {
		t.Fatalf("busy after %d silent cycles: %+v", 3, h.last())
	}
	h.cycles(1)
	busy := h.last()
	if busy == nil || !h.collector.isSystemBusy() {
		t.Fatal("a running engine silent for three intervals on a starved computer must be busy")
	}
	if busy.Figures != starvedMac || !busy.Since.Equal(h.now.Add(-h.collector.interval)) {
		t.Fatalf("busy = %+v", busy)
	}
	want := timeline.Event{Component: "system", State: "busy", Reason: "mem5.warn.swap23040mb.load214"}
	if len(h.events) != 1 || h.events[0] != want {
		t.Fatalf("timeline = %+v, want once %+v", h.events, want)
	}

	// Later cycles carry the current figures from the same incident and are
	// not new timeline events.
	h.figures.Load1 = 180
	h.cycles(2)
	if got := h.last(); got == nil || got.Load1 != 180 || !got.Since.Equal(busy.Since) {
		t.Fatalf("busy after two more cycles = %+v", got)
	}
	if len(h.events) != 1 {
		t.Fatalf("timeline recorded the incident again: %+v", h.events)
	}

	// The engine answers again: over, even though no provider delivered.
	h.answers = true
	h.cycles(1)
	if h.last() != nil || h.collector.isSystemBusy() {
		t.Fatalf("busy after the engine answered: %+v", h.last())
	}
	if len(h.events) != 2 || h.events[1] != (timeline.Event{Component: "system", State: "normal"}) {
		t.Fatalf("timeline = %+v", h.events)
	}
}

func TestSystemBusyNotForComputerWithMemoryToSpare(t *testing.T) {
	h := newSystemBusyHarness(t)
	// A heavy build: every core busy, memory fine.
	h.figures = systemload.Figures{MemoryAvailablePercent: 45, MemoryPressure: "normal", MemoryTotalMB: 24576, SwapUsedMB: 2048, Load1: 40, CPUs: 8}
	h.cycles(6)
	if h.last() != nil || len(h.events) != 0 {
		t.Fatalf("busy without memory starvation: %+v %+v", h.last(), h.events)
	}

	// Memory runs out while the engine is still silent.
	h.figures = starvedMac
	h.cycles(1)
	if h.last() == nil {
		t.Fatal("expected busy once the computer is starved")
	}
	// And comes back: the incident ends although the engine is still silent.
	h.figures.MemoryPressure, h.figures.MemoryAvailablePercent, h.figures.SwapUsedMB = "normal", 40, 1024
	h.cycles(1)
	if h.last() != nil {
		t.Fatalf("still busy with memory to spare: %+v", h.last())
	}
}

func TestSystemBusyNotForProviderFailures(t *testing.T) {
	h := newSystemBusyHarness(t)
	// Signed out, outage, rate limit: the engine answers with the error.
	h.answers = true
	h.cycles(6)
	if h.last() != nil || len(h.events) != 0 {
		t.Fatalf("provider failures reported as a busy computer: %+v %+v", h.last(), h.events)
	}
}

func TestSystemBusyNeedsRunningEngine(t *testing.T) {
	h := newSystemBusyHarness(t)
	// An engine that is not running is the repair's case, not this one.
	h.running = false
	h.cycles(6)
	if h.last() != nil {
		t.Fatalf("busy without a running engine: %+v", h.last())
	}

	h.running = true
	h.cycles(1)
	if h.last() == nil {
		t.Fatal("expected busy once the silent engine is running")
	}
	// Its supervisor restarting it does not end the starvation.
	h.running = false
	h.cycles(1)
	if h.last() == nil || len(h.events) != 1 {
		t.Fatalf("restart of the engine ended the incident: %+v %+v", h.last(), h.events)
	}
}

func TestSystemBusyKeepsVerdictWhenFiguresUnreadable(t *testing.T) {
	h := newSystemBusyHarness(t)
	h.cycles(4)
	if h.last() == nil {
		t.Fatal("expected busy")
	}
	h.collector.readSystemLoad = func() (systemload.Figures, error) { return systemload.Figures{}, errors.New("sysctl failed") }
	h.cycles(1)
	if h.last() == nil {
		t.Fatal("an unreadable figure is no evidence the computer recovered")
	}
}

func TestSystemBusyReplacesLabelOnVibeTV(t *testing.T) {
	h := newSystemBusyHarness(t)
	// The last good reading is on screen when the engine falls silent.
	h.answers = true
	h.collector.fetchDashboard = func(context.Context, codexbar.DashboardServeInfo, time.Time) ([]codexbar.ParsedFrame, error) {
		if !h.answers {
			return nil, h.silence
		}
		return []codexbar.ParsedFrame{testParsedFrame("claude", 28, 35, 7200)}, nil
	}
	state := &runtimeState{selector: codexbar.NewProviderSelector()}
	var sent []byte
	deps := runtimeDeps{
		now:         func() time.Time { return h.now },
		resolvePort: func(string) (string, error) { return "/dev/cu.usbmodem-test", nil },
		sendLine: func(_ string, line []byte) error {
			sent = append([]byte(nil), line...)
			return nil
		},
		logf: func(string, ...any) {},
	}
	send := func() {
		t.Helper()
		if err := runCycleFromCollector(context.Background(), "", state, h.collector, deps); err != nil {
			t.Fatal(err)
		}
	}
	h.cycles(1)
	send()
	if frame := decodeFrameLine(t, sent); frame.Label == SystemBusyLabel || frame.Session != 28 {
		t.Fatalf("frame before the incident = %+v", frame)
	}

	h.answers = false
	h.cycles(4)
	send()
	frame := decodeFrameLine(t, sent)
	if frame.Label != SystemBusyLabel || frame.Provider != "claude" || frame.Session != 28 {
		t.Fatalf("frame while busy = %+v, want the last good values under %q", frame, SystemBusyLabel)
	}
	if state.lastGood.Label == SystemBusyLabel {
		t.Fatal("the busy label must never become the last good frame")
	}

	h.answers = true
	h.cycles(1)
	send()
	if frame := decodeFrameLine(t, sent); frame.Label == SystemBusyLabel {
		t.Fatalf("frame after the incident = %+v", frame)
	}
}

// An HTTP error or a reply that does not decode is the engine answering: its
// own message stays, it is not a busy computer (review of #628).
func TestSystemBusyOnlyForSilence(t *testing.T) {
	for _, test := range []struct {
		name   string
		err    error
		silent bool
	}{
		{name: "request timed out", err: &url.Error{Op: "Get", URL: "http://127.0.0.1:50000/x", Err: context.DeadlineExceeded}, silent: true},
		{name: "collection deadline", err: fmt.Errorf("dashboard snapshot: %w", context.DeadlineExceeded), silent: true},
		{name: "connection cut", err: &url.Error{Op: "Get", URL: "http://127.0.0.1:50000/x", Err: syscall.ECONNRESET}, silent: true},
		{name: "no serve", err: codexbar.ErrDashboardServeUnavailable, silent: true},
		{name: "cut in the body", err: io.ErrUnexpectedEOF, silent: true},
		{name: "reset in the body", err: &net.OpError{Op: "read", Net: "tcp", Err: syscall.ECONNRESET}, silent: true},
		{name: "HTTP error", err: errors.New("GET /dashboard/v1/snapshot returned HTTP 500")},
		{name: "undecodable", err: errors.New("decode dashboard snapshot: unexpected end of JSON input")},
	} {
		t.Run(test.name, func(t *testing.T) {
			h := newSystemBusyHarness(t)
			h.silence = test.err
			h.cycles(5)
			if busy := h.last() != nil; busy != test.silent {
				t.Fatalf("busy = %v after five cycles of %v, want %v", busy, test.err, test.silent)
			}
		})
	}
}
