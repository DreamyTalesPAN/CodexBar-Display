package daemon

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar"
)

func TestCollectorWakesDisplayOnceWhenFirstUsableDataArrives(t *testing.T) {
	prepareFastTestEnv(t)
	collector := newProviderCollector(runtimeDeps{logf: func(string, ...any) {}}, Options{})
	wakes := 0
	collector.onFirstFresh = func() {
		wakes++
		if frames := collector.providerFrames(time.Now()); len(frames) != 1 || frames[0].Stale {
			t.Fatalf("wake happened before fresh data: %+v", frames)
		}
	}
	collector.fetchProviders = func(context.Context) ([]codexbar.ParsedFrame, error) { return nil, errors.New("dashboard starting") }
	collector.collectOnce(context.Background())
	if wakes != 0 {
		t.Fatal("failed collection woke display")
	}
	collector.fetchProviders = func(context.Context) ([]codexbar.ParsedFrame, error) {
		return []codexbar.ParsedFrame{testParsedFrame("codex", 17, 42, 3600)}, nil
	}
	collector.collectOnce(context.Background())
	if wakes != 1 {
		t.Fatalf("first usable collection must wake immediately, got %d", wakes)
	}
	collector.collectOnce(context.Background())
	if wakes != 1 {
		t.Fatalf("routine polling must not add extra sends, got %d", wakes)
	}
}
