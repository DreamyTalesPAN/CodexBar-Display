package daemon

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
)

func TestRunCycleWithDepsUsesUnifiedErrorFrameWhenNoLastGood(t *testing.T) {
	prepareFastTestEnv(t)

	now := time.Date(2026, 2, 23, 12, 0, 0, 0, time.UTC)
	state := &runtimeState{
		selector: codexbar.NewProviderSelector(),
	}

	var sentLine []byte
	err := runCycleWithDeps(context.Background(), "", state, runtimeDeps{
		now:         func() time.Time { return now },
		resolvePort: func(string) (string, error) { return "/dev/cu.usbmodem-test", nil },
		fetchProviders: func(context.Context) ([]codexbar.ParsedFrame, error) {
			return nil, &codexbar.FetchError{Kind: codexbar.FetchErrorParse, Err: errors.New("invalid json")}
		},
		logf: func(string, ...any) {},
		sendLine: func(port string, line []byte) error {
			sentLine = append([]byte(nil), line...)
			return nil
		},
	})
	if err == nil {
		t.Fatalf("expected cycle error without last-good fallback")
	}

	runtimeErr := asRuntimeError(err)
	if runtimeErr.Kind != runtimeErrorCodexbarParse {
		t.Fatalf("expected codexbar parse runtime error, got %s", runtimeErr.Kind)
	}

	frame := decodeFrameLine(t, sentLine)
	if frame.Error != "runtime/codexbar-parse" {
		t.Fatalf("expected unified parse error frame, got %q", frame.Error)
	}
}

func TestRunCycleWithDepsUsesLastGoodFrameDuringTransientFetchFailure(t *testing.T) {
	prepareFastTestEnv(t)

	now := time.Date(2026, 2, 23, 12, 0, 0, 0, time.UTC)
	current := now
	state := &runtimeState{
		selector: codexbar.NewProviderSelector(),
	}

	lines := make([][]byte, 0, 2)
	deps := runtimeDeps{
		now:         func() time.Time { return current },
		resolvePort: func(string) (string, error) { return "/dev/cu.usbmodem-test", nil },
		logf:        func(string, ...any) {},
		sendLine: func(port string, line []byte) error {
			lines = append(lines, append([]byte(nil), line...))
			return nil
		},
	}

	deps.fetchProviders = func(context.Context) ([]codexbar.ParsedFrame, error) {
		return []codexbar.ParsedFrame{
			testParsedFrame("codex", 12, 30, 3600),
			testParsedFrame("claude", 40, 60, 7200),
		}, nil
	}
	if err := runCycleWithDeps(context.Background(), "", state, deps); err != nil {
		t.Fatalf("expected first cycle to succeed, got %v", err)
	}

	current = current.Add(2 * time.Minute)
	deps.fetchProviders = func(context.Context) ([]codexbar.ParsedFrame, error) {
		return nil, &codexbar.FetchError{Kind: codexbar.FetchErrorCommand, Err: errors.New("transient failure")}
	}
	if err := runCycleWithDeps(context.Background(), "", state, deps); err != nil {
		t.Fatalf("expected stale-last-good fallback to avoid hard error, got %v", err)
	}

	if len(lines) != 2 {
		t.Fatalf("expected two sent frames, got %d", len(lines))
	}
	second := decodeFrameLine(t, lines[1])
	if second.Error != "" {
		t.Fatalf("expected stale-good provider frame, got error %q", second.Error)
	}
	if second.Provider != "codex" {
		t.Fatalf("expected stale codex frame, got %q", second.Provider)
	}
}

func TestRunCycleWithDepsFallsBackToAutoDetectedPortWhenRequestedPortDisappears(t *testing.T) {
	prepareFastTestEnv(t)

	now := time.Date(2026, 2, 23, 12, 0, 0, 0, time.UTC)
	state := &runtimeState{
		selector: codexbar.NewProviderSelector(),
	}

	requestedPort := "/dev/cu.usbmodem101"
	resolvedPort := ""
	sentPort := ""
	loggedFallback := false

	err := runCycleWithDeps(context.Background(), requestedPort, state, runtimeDeps{
		now: func() time.Time { return now },
		resolvePort: func(port string) (string, error) {
			switch port {
			case requestedPort:
				return "", errors.New("serial port not found: " + requestedPort)
			case "":
				resolvedPort = "/dev/cu.usbmodem1101"
				return resolvedPort, nil
			default:
				return "", errors.New("unexpected resolve input: " + port)
			}
		},
		fetchProviders: func(context.Context) ([]codexbar.ParsedFrame, error) {
			return []codexbar.ParsedFrame{
				testParsedFrame("codex", 12, 30, 3600),
			}, nil
		},
		logf: func(format string, args ...any) {
			if strings.Contains(format, "port-fallback") {
				loggedFallback = true
			}
		},
		sendLine: func(port string, line []byte) error {
			sentPort = port
			return nil
		},
	})
	if err != nil {
		t.Fatalf("expected auto-port fallback to recover, got %v", err)
	}
	if sentPort != resolvedPort {
		t.Fatalf("expected send on auto-detected port %q, got %q", resolvedPort, sentPort)
	}
	if !loggedFallback {
		t.Fatalf("expected port-fallback runtime log")
	}
}

func TestRunWithDepsRetriesAndRecoversAfterReconnect(t *testing.T) {
	prepareFastTestEnv(t)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	now := time.Date(2026, 2, 23, 12, 0, 0, 0, time.UTC)
	var delays []time.Duration
	afterCalls := 0
	never := make(chan time.Time)

	sendAttempts := 0
	sendSuccesses := 0

	err := runWithDeps(ctx, Options{Interval: 60 * time.Second}, runtimeDeps{
		now: func() time.Time {
			n := now
			now = now.Add(time.Second)
			return n
		},
		after: func(d time.Duration) <-chan time.Time {
			delays = append(delays, d)
			afterCalls++
			if afterCalls >= 14 {
				cancel()
				return never
			}
			ch := make(chan time.Time)
			close(ch)
			return ch
		},
		resolvePort: func(string) (string, error) {
			return "/dev/cu.usbmodem-test", nil
		},
		logf: func(string, ...any) {},
		fetchProviders: func(context.Context) ([]codexbar.ParsedFrame, error) {
			return []codexbar.ParsedFrame{
				testParsedFrame("codex", 10, 20, 3600),
				testParsedFrame("claude", 20, 30, 7200),
			}, nil
		},
		sendLine: func(port string, line []byte) error {
			sendAttempts++
			if sendAttempts <= 10 {
				return errors.New("write serial /dev/cu.usbmodem-test: I/O error")
			}
			sendSuccesses++
			return nil
		},
	})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected context cancellation to stop run loop, got %v", err)
	}
	if sendSuccesses == 0 {
		t.Fatalf("expected reconnect recovery with successful writes")
	}

	if len(delays) < 5 {
		t.Fatalf("expected retry delay samples, got %v", delays)
	}
	if delays[0] != time.Second || delays[1] != 2*time.Second || delays[2] != 4*time.Second {
		t.Fatalf("unexpected retry backoff start: %v", delays[:3])
	}

	foundIntervalDelay := false
	for _, d := range delays {
		if d == startupFastPollInterval {
			foundIntervalDelay = true
			break
		}
	}
	if !foundIntervalDelay {
		t.Fatalf("expected loop to return to startup interval after recovery, got %v", delays)
	}
}

func TestStartupIntervalSwitchesAfterWarmupWindow(t *testing.T) {
	prepareFastTestEnv(t)

	if got := startupInterval(60*time.Second, 10*time.Second); got != startupFastPollInterval {
		t.Fatalf("expected startup interval during warmup, got %s", got)
	}
	if got := startupInterval(60*time.Second, startupFastPollWindow); got != 60*time.Second {
		t.Fatalf("expected normal interval after warmup window, got %s", got)
	}
	if got := startupInterval(20*time.Second, 10*time.Second); got != 20*time.Second {
		t.Fatalf("expected normal interval when already shorter than startup interval, got %s", got)
	}
}

func TestRunWithDepsResetsRetryBackoffAfterSleepWakeGap(t *testing.T) {
	prepareFastTestEnv(t)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	start := time.Date(2026, 2, 23, 12, 0, 0, 0, time.UTC)
	nowValues := []time.Time{
		start,
		start.Add(2 * time.Second),
		start.Add(4 * time.Second),
		start.Add(2*time.Minute + 5*time.Second), // sleep/wake-sized wall clock gap
		start.Add(2*time.Minute + 7*time.Second),
	}
	nowIdx := 0

	var delays []time.Duration
	afterCalls := 0
	never := make(chan time.Time)

	err := runWithDeps(ctx, Options{Interval: 60 * time.Second}, runtimeDeps{
		now: func() time.Time {
			if nowIdx >= len(nowValues) {
				return nowValues[len(nowValues)-1]
			}
			current := nowValues[nowIdx]
			nowIdx++
			return current
		},
		after: func(d time.Duration) <-chan time.Time {
			delays = append(delays, d)
			afterCalls++
			if afterCalls >= 4 {
				cancel()
				return never
			}
			ch := make(chan time.Time)
			close(ch)
			return ch
		},
		resolvePort: func(string) (string, error) {
			return "/dev/cu.usbmodem-test", nil
		},
		logf: func(string, ...any) {},
		fetchProviders: func(context.Context) ([]codexbar.ParsedFrame, error) {
			return []codexbar.ParsedFrame{
				testParsedFrame("codex", 10, 20, 3600),
			}, nil
		},
		sendLine: func(port string, line []byte) error {
			return errors.New("write serial /dev/cu.usbmodem-test: I/O error")
		},
	})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected context cancellation to stop run loop, got %v", err)
	}
	if len(delays) < 4 {
		t.Fatalf("expected 4 delay samples, got %v", delays)
	}
	want := []time.Duration{time.Second, 2 * time.Second, time.Second, 2 * time.Second}
	for i, expected := range want {
		if delays[i] != expected {
			t.Fatalf("delay[%d]=%s, expected %s (delays=%v)", i, delays[i], expected, delays)
		}
	}
}

func TestDaemonSoakSimulation24hEquivalent(t *testing.T) {
	prepareFastTestEnv(t)

	const cycles = 24 * 60 // 24h with 60s interval
	base := time.Date(2026, 2, 23, 0, 0, 0, 0, time.UTC)
	now := base
	cycleIdx := 0

	state := &runtimeState{
		selector: codexbar.NewProviderSelector(),
	}

	sendCount := 0
	errorCount := 0

	deps := runtimeDeps{
		now: func() time.Time { return now },
		resolvePort: func(string) (string, error) {
			if cycleIdx > 0 && cycleIdx%300 == 0 {
				return "", errors.New("no serial ports found")
			}
			return "/dev/cu.usbmodem-test", nil
		},
		fetchProviders: func(context.Context) ([]codexbar.ParsedFrame, error) {
			if cycleIdx > 0 && cycleIdx%97 == 0 {
				return nil, &codexbar.FetchError{Kind: codexbar.FetchErrorParse, Err: errors.New("bad json")}
			}
			codexSession := 10 + (cycleIdx % 35)
			claudeSession := 12 + ((cycleIdx + 3) % 40)
			return []codexbar.ParsedFrame{
				testParsedFrame("codex", codexSession, 25, 9000-int64(cycleIdx*10)),
				testParsedFrame("claude", claudeSession, 45, 12000-int64(cycleIdx*10)),
			}, nil
		},
		sendLine: func(port string, line []byte) error {
			sendCount++
			if cycleIdx > 0 && cycleIdx%113 == 0 {
				return errors.New("write serial /dev/cu.usbmodem-test: I/O error")
			}
			return nil
		},
		logf: func(string, ...any) {},
	}

	for i := 0; i < cycles; i++ {
		cycleIdx = i
		if i > 0 {
			now = now.Add(60 * time.Second)
		}
		if i == 480 || i == 960 {
			now = now.Add(2 * time.Hour)
		}

		if err := runCycleWithDeps(context.Background(), "", state, deps); err != nil {
			errorCount++
		}
	}

	if sendCount < cycles-20 {
		t.Fatalf("expected near-continuous frame sends in soak simulation, got %d/%d", sendCount, cycles)
	}
	if errorCount == 0 {
		t.Fatalf("expected some injected runtime errors in soak simulation")
	}
	if errorCount > 40 {
		t.Fatalf("too many runtime errors in soak simulation: %d", errorCount)
	}
}

func TestDetectSleepWakeGap(t *testing.T) {
	prepareFastTestEnv(t)

	base := time.Date(2026, 2, 23, 12, 0, 0, 0, time.UTC)
	if detectSleepWakeGap(base, base.Add(30*time.Second), 60*time.Second) {
		t.Fatalf("did not expect sleep/wake detection inside threshold")
	}
	if !detectSleepWakeGap(base, base.Add(2*time.Minute), 60*time.Second) {
		t.Fatalf("expected sleep/wake detection for large wall-clock gap")
	}
}

func decodeFrameLine(t *testing.T, line []byte) protocol.Frame {
	t.Helper()

	trimmed := strings.TrimSpace(string(line))
	if trimmed == "" {
		t.Fatalf("expected non-empty frame line")
	}

	var frame protocol.Frame
	if err := json.Unmarshal([]byte(trimmed), &frame); err != nil {
		t.Fatalf("unmarshal frame: %v", err)
	}
	return frame
}

func testParsedFrame(provider string, session, weekly int, reset int64) codexbar.ParsedFrame {
	return codexbar.ParsedFrame{
		Provider: provider,
		Source:   "web",
		Frame: protocol.Frame{
			Provider: provider,
			Label:    provider,
			Session:  session,
			Weekly:   weekly,
			ResetSec: reset,
		},
	}
}

func prepareFastTestEnv(t *testing.T) {
	t.Helper()

	tmpHome := t.TempDir()
	t.Setenv("HOME", tmpHome)
	t.Setenv("VIBEBLOCK_CHROMIUM_COOKIE_DB_PATHS", tmpHome+"/missing-cookies.db")
}
