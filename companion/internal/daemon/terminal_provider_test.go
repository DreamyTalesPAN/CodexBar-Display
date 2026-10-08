package daemon

import (
	"context"
	"testing"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
)

// Issue #428: a terminal provider error clears retained quota immediately,
// while a transient error keeps the bounded last-good.
func terminalTestFrame(provider string, terminal bool) codexbar.ParsedFrame {
	return codexbar.ParsedFrame{
		Provider: provider,
		Stale:    true,
		Terminal: terminal,
		Frame:    protocol.Frame{Provider: provider, Label: provider, UsageUnavailable: true},
	}
}

func terminalTestCollector(now *time.Time, frames *[]codexbar.ParsedFrame) *providerCollector {
	return &providerCollector{
		now:            func() time.Time { return *now },
		logf:           func(string, ...any) {},
		order:          []string{"gemini", "claude"},
		snapshotMaxAge: 10 * time.Minute,
		providers:      map[string]providerSnapshot{},
		fetchProviders: func(context.Context) ([]codexbar.ParsedFrame, error) {
			return *frames, nil
		},
	}
}

func TestProviderCollectorTerminalErrorClearsRetainedQuota(t *testing.T) {
	prepareFastTestEnv(t)
	for _, tc := range []struct {
		name     string
		terminal bool
	}{{"terminal", true}, {"transient", false}} {
		t.Run(tc.name, func(t *testing.T) {
			now := time.Date(2026, 9, 23, 12, 0, 0, 0, time.UTC)
			frames := []codexbar.ParsedFrame{
				testParsedFrame("gemini", 73, 21, 3600),
				testParsedFrame("claude", 40, 30, 3600),
			}
			collector := terminalTestCollector(&now, &frames)
			collector.collectOnce(context.Background())

			now = now.Add(time.Minute)
			frames = []codexbar.ParsedFrame{terminalTestFrame("gemini", tc.terminal), testParsedFrame("claude", 40, 30, 3600)}
			collector.collectOnce(context.Background())

			got := collector.providerFrames(now)
			if len(got) != 2 || got[0].Provider != "gemini" || got[1].Provider != "claude" {
				t.Fatalf("unexpected providers: %#v", got)
			}
			gemini := got[0]
			if tc.terminal {
				if !gemini.Frame.UsageUnavailable || gemini.Frame.Session != 0 || gemini.Frame.Weekly != 0 ||
					len(gemini.Frame.UsageWindows) != 0 || len(gemini.Meta.Windows) != 0 || !gemini.Terminal {
					t.Fatalf("terminal error kept retained quota: %#v", gemini)
				}
			} else if gemini.Frame.UsageUnavailable || gemini.Frame.Session != 73 || !gemini.Stale {
				t.Fatalf("transient error lost bounded last-good: %#v", gemini)
			}
			claude := got[1]
			if claude.Stale || claude.Frame.UsageUnavailable || claude.Frame.Session != 40 || claude.Frame.Weekly != 30 {
				t.Fatalf("other provider changed: %#v", claude)
			}
		})
	}
}

func TestRunCycleFromCollectorSoleProviderTerminalErrorDropsLastGood(t *testing.T) {
	for _, tc := range []struct {
		name     string
		terminal bool
	}{{"terminal", true}, {"transient", false}} {
		t.Run(tc.name, func(t *testing.T) {
			prepareFastTestEnv(t)
			now := time.Date(2026, 9, 23, 12, 0, 0, 0, time.UTC)
			frames := []codexbar.ParsedFrame{testParsedFrame("gemini", 73, 21, 3600)}
			collector := terminalTestCollector(&now, &frames)
			collector.order = []string{"gemini"}

			var sentLine []byte
			deps := runtimeDeps{
				now:         func() time.Time { return now },
				resolvePort: func(string) (string, error) { return "/dev/cu.usbmodem-test", nil },
				sendLine: func(_ string, line []byte) error {
					sentLine = append([]byte(nil), line...)
					return nil
				},
				logf: func(string, ...any) {},
			}.withDefaults()
			state := initializeRuntimeState(now, Options{}, deps)

			collector.collectOnce(context.Background())
			if err := runCycleFromCollector(context.Background(), "", state, collector, deps); err != nil {
				t.Fatalf("initial cycle: %v", err)
			}
			if !state.hasLastGood || !state.hasPersistedGood {
				t.Fatalf("expected persisted last-good after success: %+v", state)
			}

			now = now.Add(time.Minute)
			frames = []codexbar.ParsedFrame{terminalTestFrame("gemini", tc.terminal)}
			collector.collectOnce(context.Background())
			sentLine = nil
			err := runCycleFromCollector(context.Background(), "", state, collector, deps)

			if !tc.terminal {
				// Transient: the retained snapshot is stale, so the runtime keeps
				// the device on its last frame and the last-good stays intact.
				if err != nil || !state.hasLastGood || state.lastGood.Session != 73 {
					t.Fatalf("transient error dropped bounded last-good: err=%v state=%+v", err, state)
				}
				if _, _, ok := loadPersistedLastGoodAnyAge(); !ok {
					t.Fatal("transient error cleared the persisted last-good")
				}
				return
			}
			if err == nil {
				t.Fatal("expected unavailable runtime error for a terminal sole provider")
			}
			frame := decodeFrameLine(t, sentLine)
			if frame.Session != 0 || frame.Weekly != 0 || len(frame.UsageWindows) != 0 || frame.Error == "" {
				t.Fatalf("sole-provider fallback still showed retained quota: %+v", frame)
			}
			if state.hasLastGood || state.hasPersistedGood {
				t.Fatalf("terminal error left runtime last-good: %+v", state)
			}
			if _, _, ok := loadPersistedLastGoodAnyAge(); ok {
				t.Fatal("terminal error left the persisted last-good")
			}
		})
	}
}

// A restart between clearing the provider snapshot and clearing the separate
// last-good frame must still drop that frame, even if CodexBar does not answer
// the first fetch after the restart.
func TestTerminalVerdictSurvivesRestartAndDropsLastGood(t *testing.T) {
	prepareFastTestEnv(t)
	now := time.Date(2026, 9, 23, 12, 0, 0, 0, time.UTC)
	frames := []codexbar.ParsedFrame{testParsedFrame("gemini", 73, 21, 3600)}
	collector := terminalTestCollector(&now, &frames)
	collector.collectOnce(context.Background())
	now = now.Add(time.Minute)
	frames = []codexbar.ParsedFrame{terminalTestFrame("gemini", true)}
	collector.collectOnce(context.Background())
	if err := persistProviderSnapshots(collector.providers, nil, now); err != nil {
		t.Fatalf("persist: %v", err)
	}

	loaded, _, ok := loadPersistedProviderSnapshotsAnyAge()
	if !ok || !loaded["gemini"].Terminal {
		t.Fatalf("terminal verdict lost on reload: ok=%v %#v", ok, loaded["gemini"])
	}

	restarted := terminalTestCollector(&now, &frames)
	restarted.providers = loaded
	restarted.fetchProviders = func(context.Context) ([]codexbar.ParsedFrame, error) {
		return nil, context.DeadlineExceeded
	}
	restarted.collectOnce(context.Background())
	state := &runtimeState{
		selector:    codexbar.NewProviderSelector(),
		lastGood:    protocol.Frame{Provider: "gemini", Session: 73, Weekly: 21},
		lastGoodAt:  now,
		hasLastGood: true,
	}
	invalidateLastGoodTerminal(state, restarted.providerFrames(now), runtimeDeps{logf: func(string, ...any) {}})
	if state.hasLastGood {
		t.Fatalf("obsolete Gemini last-good survived the restart")
	}
}

// Issue #368: "no usage reading since" is read from the stored collection
// time, so that time must not move while a provider keeps failing. It is the
// last good reading, or the first failed one for a provider that never
// delivered -- also after the reading expired and the Companion restarted.
func TestPersistedUsageKeepsCollectionTimeWhileProviderKeepsFailing(t *testing.T) {
	prepareFastTestEnv(t)
	start := time.Date(2026, 9, 23, 12, 0, 0, 0, time.UTC)
	now := start
	frames := []codexbar.ParsedFrame{testParsedFrame("gemini", 73, 21, 3600), terminalTestFrame("claude", false)}
	collector := terminalTestCollector(&now, &frames)
	collector.collectOnce(context.Background())

	frames = []codexbar.ParsedFrame{terminalTestFrame("gemini", false), terminalTestFrame("claude", false)}
	for _, later := range []time.Duration{time.Minute, 16 * 24 * time.Hour} {
		now = start.Add(later)
		collector.collectOnce(context.Background())
	}

	usage, ok := LoadPersistedUsage(now)
	if !ok || len(usage.Providers) != 2 {
		t.Fatalf("expected both providers on disk, got ok=%v %#v", ok, usage.Providers)
	}
	for _, provider := range usage.Providers {
		if !provider.CollectedAt.Equal(start) || !provider.Frame.UsageUnavailable {
			t.Fatalf("%s: collection time moved or usage survived: %#v", provider.Provider, provider)
		}
	}
}
