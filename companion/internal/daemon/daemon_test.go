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
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimeconfig"
)

func TestRunCycleWithDepsSendsErrorFrameWhenNoLastGood(t *testing.T) {
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

	if len(sentLine) == 0 {
		t.Fatalf("expected error frame to be sent without last-good fallback")
	}
	frame := decodeFrameLine(t, sentLine)
	if frame.Error != string(runtimeErrorCodexbarParse) {
		t.Fatalf("expected runtime error frame code %q, got %q", runtimeErrorCodexbarParse, frame.Error)
	}
}

func TestRunCycleWithDepsSkipsThemeWhenDeviceDoesNotSupportIt(t *testing.T) {
	prepareFastTestEnv(t)
	t.Setenv(themeEnvVar, "crt")

	now := time.Date(2026, 2, 23, 12, 0, 0, 0, time.UTC)
	state := &runtimeState{
		selector: codexbar.NewProviderSelector(),
	}

	var sentLine []byte
	err := runCycleWithDeps(context.Background(), "", state, runtimeDeps{
		now:         func() time.Time { return now },
		resolvePort: func(string) (string, error) { return "/dev/cu.usbmodem-test", nil },
		deviceCaps: func(string) (protocol.DeviceCapabilities, error) {
			return protocol.DeviceCapabilities{
				Known:         true,
				Board:         "esp32-lilygo-t-display-s3",
				SupportsTheme: false,
			}, nil
		},
		fetchProviders: func(context.Context) ([]codexbar.ParsedFrame, error) {
			return []codexbar.ParsedFrame{
				testParsedFrame("codex", 12, 30, 3600),
			}, nil
		},
		logf: func(string, ...any) {},
		sendLine: func(port string, line []byte) error {
			sentLine = append([]byte(nil), line...)
			return nil
		},
	})
	if err != nil {
		t.Fatalf("expected cycle success, got %v", err)
	}

	frame := decodeFrameLine(t, sentLine)
	if frame.Theme != "" {
		t.Fatalf("expected theme to be skipped for unsupported device, got %q", frame.Theme)
	}
}

func TestRunCycleWithDepsShowsRemainingWhenUsageBarsShowUsedDisabled(t *testing.T) {
	prepareFastTestEnv(t)

	now := time.Date(2026, 2, 23, 12, 0, 0, 0, time.UTC)
	state := &runtimeState{
		selector: codexbar.NewProviderSelector(),
	}

	var sentLine []byte
	err := runCycleWithDeps(context.Background(), "", state, runtimeDeps{
		now:               func() time.Time { return now },
		resolvePort:       func(string) (string, error) { return "/dev/cu.usbmodem-test", nil },
		usageBarsShowUsed: func() bool { return false },
		fetchProviders: func(context.Context) ([]codexbar.ParsedFrame, error) {
			return []codexbar.ParsedFrame{
				testParsedFrame("codex", 1, 28, 3600),
			}, nil
		},
		logf: func(string, ...any) {},
		sendLine: func(port string, line []byte) error {
			sentLine = append([]byte(nil), line...)
			return nil
		},
	})
	if err != nil {
		t.Fatalf("expected cycle success, got %v", err)
	}

	frame := decodeFrameLine(t, sentLine)
	if frame.Session != 99 || frame.Weekly != 72 {
		t.Fatalf("expected remaining view inversion, got session=%d weekly=%d", frame.Session, frame.Weekly)
	}
	if frame.UsageMode != "remaining" {
		t.Fatalf("expected remaining usage mode, got %q", frame.UsageMode)
	}
}

func TestRunCycleWithDepsUsesConfiguredUsageModeWhenShowingUsed(t *testing.T) {
	prepareFastTestEnv(t)

	now := time.Date(2026, 2, 23, 12, 0, 0, 0, time.UTC)
	state := &runtimeState{
		selector: codexbar.NewProviderSelector(),
	}

	var sentLine []byte
	err := runCycleWithDeps(context.Background(), "", state, runtimeDeps{
		now:               func() time.Time { return now },
		resolvePort:       func(string) (string, error) { return "/dev/cu.usbmodem-test", nil },
		usageBarsShowUsed: func() bool { return true },
		fetchProviders: func(context.Context) ([]codexbar.ParsedFrame, error) {
			return []codexbar.ParsedFrame{
				testParsedFrame("codex", 1, 28, 3600),
			}, nil
		},
		logf: func(string, ...any) {},
		sendLine: func(port string, line []byte) error {
			sentLine = append([]byte(nil), line...)
			return nil
		},
	})
	if err != nil {
		t.Fatalf("expected cycle success, got %v", err)
	}

	frame := decodeFrameLine(t, sentLine)
	if frame.Session != 1 || frame.Weekly != 28 {
		t.Fatalf("expected used values unchanged, got session=%d weekly=%d", frame.Session, frame.Weekly)
	}
	if frame.UsageMode != "used" {
		t.Fatalf("expected used usage mode, got %q", frame.UsageMode)
	}
}

func TestRunCycleWithDepsUsesColdStartFetchTimeout(t *testing.T) {
	prepareFastTestEnv(t)
	t.Setenv(coldStartTimeoutEnvVar, "5")

	now := time.Date(2026, 2, 23, 12, 0, 0, 0, time.UTC)
	state := &runtimeState{
		selector: codexbar.NewProviderSelector(),
	}

	err := runCycleWithDeps(context.Background(), "", state, runtimeDeps{
		now:         func() time.Time { return now },
		resolvePort: func(string) (string, error) { return "/dev/cu.usbmodem-test", nil },
		fetchProviders: func(ctx context.Context) ([]codexbar.ParsedFrame, error) {
			deadline, ok := ctx.Deadline()
			if !ok {
				t.Fatalf("expected cold-start fetch context deadline")
			}
			remaining := time.Until(deadline)
			if remaining < 3*time.Second || remaining > 6*time.Second {
				t.Fatalf("unexpected cold-start deadline budget: %s", remaining)
			}
			return []codexbar.ParsedFrame{
				testParsedFrame("codex", 1, 28, 3600),
			}, nil
		},
		logf: func(string, ...any) {},
		sendLine: func(port string, line []byte) error {
			return nil
		},
	})
	if err != nil {
		t.Fatalf("expected cycle success, got %v", err)
	}
}

func TestPersistAndLoadLastGood(t *testing.T) {
	prepareFastTestEnv(t)

	now := time.Date(2026, 2, 23, 12, 0, 0, 0, time.UTC)
	frame := protocol.Frame{
		Provider:  "codex",
		Label:     "Codex",
		Session:   98,
		Weekly:    72,
		ResetSec:  3600,
		UsageMode: "remaining",
	}

	if err := persistLastGood(frame, now); err != nil {
		t.Fatalf("persist last good: %v", err)
	}

	loaded, savedAt, ok := loadPersistedLastGood(now.Add(2 * time.Minute))
	if !ok {
		t.Fatalf("expected persisted last-good frame to load")
	}
	if !savedAt.Equal(now) {
		t.Fatalf("expected savedAt %s, got %s", now, savedAt)
	}
	if loaded.Provider != frame.Provider || loaded.Session != frame.Session || loaded.UsageMode != frame.UsageMode {
		t.Fatalf("loaded frame mismatch: got=%+v want=%+v", loaded, frame)
	}
}

func TestLoadPersistedLastGoodIgnoresExpiredSnapshot(t *testing.T) {
	prepareFastTestEnv(t)

	now := time.Date(2026, 2, 23, 12, 0, 0, 0, time.UTC)
	frame := protocol.Frame{
		Provider: "codex",
		Label:    "Codex",
		Session:  2,
		Weekly:   28,
		ResetSec: 3600,
	}

	if err := persistLastGood(frame, now); err != nil {
		t.Fatalf("persist last good: %v", err)
	}

	_, _, ok := loadPersistedLastGood(now.Add(lastGoodMaxAge() + time.Minute))
	if ok {
		t.Fatalf("expected expired snapshot to be ignored")
	}
}

func TestLoadPersistedLastGoodAnyAgeLoadsExpiredSnapshot(t *testing.T) {
	prepareFastTestEnv(t)

	now := time.Date(2026, 2, 23, 12, 0, 0, 0, time.UTC)
	frame := protocol.Frame{
		Provider: "codex",
		Label:    "Codex",
		Session:  2,
		Weekly:   28,
		ResetSec: 3600,
	}

	if err := persistLastGood(frame, now); err != nil {
		t.Fatalf("persist last good: %v", err)
	}

	loaded, savedAt, ok := loadPersistedLastGoodAnyAge()
	if !ok {
		t.Fatalf("expected bootstrap loader to accept expired snapshot")
	}
	if !savedAt.Equal(now) {
		t.Fatalf("expected savedAt %s, got %s", now, savedAt)
	}
	if loaded.Provider != frame.Provider || loaded.Session != frame.Session {
		t.Fatalf("loaded frame mismatch: got=%+v want=%+v", loaded, frame)
	}
}

func TestRunCycleWithDepsRateLimitsPersistedLastGoodWrites(t *testing.T) {
	prepareFastTestEnv(t)

	now := time.Date(2026, 2, 23, 12, 0, 0, 0, time.UTC)
	current := now
	state := &runtimeState{
		selector: codexbar.NewProviderSelector(),
	}

	deps := runtimeDeps{
		now:         func() time.Time { return current },
		resolvePort: func(string) (string, error) { return "/dev/cu.usbmodem-test", nil },
		deviceCaps: func(string) (protocol.DeviceCapabilities, error) {
			return protocol.UnknownDeviceCapabilities(), nil
		},
		fetchProviders: func(context.Context) ([]codexbar.ParsedFrame, error) {
			return []codexbar.ParsedFrame{
				testParsedFrame("codex", 12, 30, 3600),
			}, nil
		},
		logf: func(string, ...any) {},
		sendLine: func(string, []byte) error {
			return nil
		},
	}

	if err := runCycleWithDeps(context.Background(), "", state, deps); err != nil {
		t.Fatalf("expected first cycle success, got %v", err)
	}
	_, savedAt, ok := loadPersistedLastGoodAnyAge()
	if !ok {
		t.Fatalf("expected first cycle to persist last-good frame")
	}
	if !savedAt.Equal(now) {
		t.Fatalf("expected initial savedAt %s, got %s", now, savedAt)
	}

	current = current.Add(30 * time.Second)
	if err := runCycleWithDeps(context.Background(), "", state, deps); err != nil {
		t.Fatalf("expected second cycle success, got %v", err)
	}
	_, savedAt, ok = loadPersistedLastGoodAnyAge()
	if !ok {
		t.Fatalf("expected persisted last-good frame after second cycle")
	}
	if !savedAt.Equal(now) {
		t.Fatalf("expected persisted savedAt to remain %s before interval, got %s", now, savedAt)
	}

	current = now.Add(lastGoodPersistInterval + time.Second)
	if err := runCycleWithDeps(context.Background(), "", state, deps); err != nil {
		t.Fatalf("expected third cycle success, got %v", err)
	}
	_, savedAt, ok = loadPersistedLastGoodAnyAge()
	if !ok {
		t.Fatalf("expected persisted last-good frame after third cycle")
	}
	if !savedAt.Equal(current) {
		t.Fatalf("expected persisted savedAt to refresh to %s, got %s", current, savedAt)
	}
}

func TestRunWithDepsBootstrapsFromExpiredPersistedLastGood(t *testing.T) {
	prepareFastTestEnv(t)

	savedAt := time.Date(2026, 2, 23, 10, 0, 0, 0, time.UTC)
	current := savedAt.Add(lastGoodMaxAge() + 2*time.Minute)
	stale := protocol.Frame{
		Provider: "codex",
		Label:    "Codex",
		Session:  98,
		Weekly:   72,
		ResetSec: 3600,
	}
	if err := persistLastGood(stale, savedAt); err != nil {
		t.Fatalf("persist last good: %v", err)
	}

	var sentLine []byte
	err := runWithDeps(context.Background(), Options{Interval: 60 * time.Second, Once: true}, runtimeDeps{
		now:         func() time.Time { return current },
		resolvePort: func(string) (string, error) { return "/dev/cu.usbmodem-test", nil },
		fetchProviders: func(context.Context) ([]codexbar.ParsedFrame, error) {
			return nil, &codexbar.FetchError{Kind: codexbar.FetchErrorCommand, Err: errors.New("context deadline exceeded")}
		},
		logf: func(string, ...any) {},
		sendLine: func(port string, line []byte) error {
			sentLine = append([]byte(nil), line...)
			return nil
		},
	})
	if err != nil {
		t.Fatalf("expected stale bootstrap frame to avoid hard error, got %v", err)
	}
	if len(sentLine) == 0 {
		t.Fatalf("expected stale bootstrap frame to be sent")
	}
	frame := decodeFrameLine(t, sentLine)
	if frame.Provider != stale.Provider || frame.Session != stale.Session || frame.Weekly != stale.Weekly {
		t.Fatalf("expected stale bootstrap frame, got %+v", frame)
	}
}

func TestRunWithDepsBootstrapsStickyProviderFromPersistedLastGood(t *testing.T) {
	prepareFastTestEnv(t)

	savedAt := time.Date(2026, 2, 23, 10, 0, 0, 0, time.UTC)
	current := savedAt.Add(2 * time.Minute)
	lastGood := protocol.Frame{
		Provider: "claude",
		Label:    "Claude",
		Session:  74,
		Weekly:   51,
		ResetSec: 3600,
	}
	if err := persistLastGood(lastGood, savedAt); err != nil {
		t.Fatalf("persist last good: %v", err)
	}

	var sentLine []byte
	err := runWithDeps(context.Background(), Options{Interval: 60 * time.Second, Once: true}, runtimeDeps{
		now:         func() time.Time { return current },
		resolvePort: func(string) (string, error) { return "/dev/cu.usbmodem-test", nil },
		fetchProviders: func(context.Context) ([]codexbar.ParsedFrame, error) {
			// Same score and no local-activity signal: selection must keep persisted sticky provider.
			return []codexbar.ParsedFrame{
				testParsedFrame("codex", 10, 10, 3600),
				testParsedFrame("claude", 10, 10, 3600),
			}, nil
		},
		logf: func(string, ...any) {},
		sendLine: func(port string, line []byte) error {
			sentLine = append([]byte(nil), line...)
			return nil
		},
	})
	if err != nil {
		t.Fatalf("expected cycle success, got %v", err)
	}
	if len(sentLine) == 0 {
		t.Fatalf("expected frame to be sent")
	}
	frame := decodeFrameLine(t, sentLine)
	if frame.Provider != "claude" {
		t.Fatalf("expected sticky persisted provider claude, got %q", frame.Provider)
	}
}

func TestRunCycleWithDepsAppliesThemeWhenDeviceSupportsIt(t *testing.T) {
	prepareFastTestEnv(t)

	for _, requestedTheme := range []string{"classic", "crt", "mini"} {
		t.Run(requestedTheme, func(t *testing.T) {
			t.Setenv(themeEnvVar, requestedTheme)

			now := time.Date(2026, 2, 23, 12, 0, 0, 0, time.UTC)
			state := &runtimeState{
				selector: codexbar.NewProviderSelector(),
			}

			var sentLine []byte
			err := runCycleWithDeps(context.Background(), "", state, runtimeDeps{
				now:         func() time.Time { return now },
				resolvePort: func(string) (string, error) { return "/dev/cu.usbmodem-test", nil },
				deviceCaps: func(string) (protocol.DeviceCapabilities, error) {
					return protocol.DeviceCapabilities{
						Known:         true,
						Board:         "esp8266-smalltv-st7789",
						SupportsTheme: true,
					}, nil
				},
				fetchProviders: func(context.Context) ([]codexbar.ParsedFrame, error) {
					return []codexbar.ParsedFrame{
						testParsedFrame("codex", 12, 30, 3600),
					}, nil
				},
				logf: func(string, ...any) {},
				sendLine: func(port string, line []byte) error {
					sentLine = append([]byte(nil), line...)
					return nil
				},
			})
			if err != nil {
				t.Fatalf("expected cycle success, got %v", err)
			}

			frame := decodeFrameLine(t, sentLine)
			if frame.Theme != requestedTheme {
				t.Fatalf("expected theme %q for supported device, got %q", requestedTheme, frame.Theme)
			}
		})
	}
}

func TestRunCycleWithDepsAppliesThemeForUnknownDeviceCapabilities(t *testing.T) {
	prepareFastTestEnv(t)
	t.Setenv(themeEnvVar, "crt")

	now := time.Date(2026, 2, 23, 12, 0, 0, 0, time.UTC)
	state := &runtimeState{
		selector: codexbar.NewProviderSelector(),
	}

	var sentLine []byte
	err := runCycleWithDeps(context.Background(), "", state, runtimeDeps{
		now:         func() time.Time { return now },
		resolvePort: func(string) (string, error) { return "/dev/cu.usbmodem-test", nil },
		deviceCaps: func(string) (protocol.DeviceCapabilities, error) {
			return protocol.UnknownDeviceCapabilities(), nil
		},
		fetchProviders: func(context.Context) ([]codexbar.ParsedFrame, error) {
			return []codexbar.ParsedFrame{
				testParsedFrame("codex", 12, 30, 3600),
			}, nil
		},
		logf: func(string, ...any) {},
		sendLine: func(port string, line []byte) error {
			sentLine = append([]byte(nil), line...)
			return nil
		},
	})
	if err != nil {
		t.Fatalf("expected cycle success, got %v", err)
	}

	frame := decodeFrameLine(t, sentLine)
	if frame.Theme != "crt" {
		t.Fatalf("expected theme for unknown device capabilities fallback, got %q", frame.Theme)
	}
}

func TestMarshalFrameWithinLimitDropsThemeBeforeFallback(t *testing.T) {
	base := protocol.Frame{
		Provider: "codex",
		Label:    "Codex",
		Session:  12,
		Weekly:   30,
		ResetSec: 3600,
	}
	withTheme := base
	withTheme.Theme = "crt"

	withoutThemeLine, err := base.MarshalLine()
	if err != nil {
		t.Fatalf("marshal base frame: %v", err)
	}

	line, marshaled, err := marshalFrameWithinLimit(withTheme, len(withoutThemeLine))
	if err != nil {
		t.Fatalf("marshal within limit: %v", err)
	}
	if marshaled.Theme != "" {
		t.Fatalf("expected theme to be dropped to fit frame, got %q", marshaled.Theme)
	}
	if len(line) > len(withoutThemeLine) {
		t.Fatalf("expected line to fit limit %d, got %d", len(withoutThemeLine), len(line))
	}
}

func TestMarshalFrameWithinLimitFallsBackToErrorFrame(t *testing.T) {
	frame := protocol.Frame{
		Provider: "codex",
		Label:    strings.Repeat("very-long-label-", 20),
		Session:  12,
		Weekly:   30,
		ResetSec: 3600,
		Theme:    "crt",
	}

	line, marshaled, err := marshalFrameWithinLimit(frame, 80)
	if err != nil {
		t.Fatalf("marshal within limit: %v", err)
	}
	if marshaled.Error != "runtime/frame-too-large" {
		t.Fatalf("expected frame-too-large fallback, got %q", marshaled.Error)
	}
	if len(line) > 80 {
		t.Fatalf("expected fallback line to fit limit, got %d", len(line))
	}
}

func TestRunCycleWithDepsUsesMaxFrameBytesFromDeviceHello(t *testing.T) {
	prepareFastTestEnv(t)

	now := time.Date(2026, 2, 23, 12, 0, 0, 0, time.UTC)
	state := &runtimeState{
		selector: codexbar.NewProviderSelector(),
	}

	var sentLine []byte
	err := runCycleWithDeps(context.Background(), "", state, runtimeDeps{
		now:         func() time.Time { return now },
		resolvePort: func(string) (string, error) { return "/dev/cu.usbmodem-test", nil },
		deviceCaps: func(string) (protocol.DeviceCapabilities, error) {
			return protocol.DeviceCapabilities{
				Known:         true,
				Board:         "esp8266-smalltv-st7789",
				SupportsTheme: true,
				MaxFrameBytes: 80,
			}, nil
		},
		fetchProviders: func(context.Context) ([]codexbar.ParsedFrame, error) {
			frame := testParsedFrame("codex", 12, 30, 3600)
			frame.Frame.Label = strings.Repeat("codex-", 30)
			return []codexbar.ParsedFrame{frame}, nil
		},
		logf: func(string, ...any) {},
		sendLine: func(port string, line []byte) error {
			sentLine = append([]byte(nil), line...)
			return nil
		},
	})
	if err != nil {
		t.Fatalf("expected cycle success, got %v", err)
	}
	if len(sentLine) > 80 {
		t.Fatalf("expected sent line <= maxFrameBytes, got %d", len(sentLine))
	}

	frame := decodeFrameLine(t, sentLine)
	if frame.Error != "runtime/frame-too-large" {
		t.Fatalf("expected frame-too-large fallback, got %q", frame.Error)
	}
}

func TestConfiguredThemeFallsBackToRuntimeConfig(t *testing.T) {
	tmpHome := t.TempDir()
	t.Setenv("HOME", tmpHome)
	t.Setenv(themeEnvVar, "")

	if err := runtimeconfig.Save(tmpHome, runtimeconfig.Config{Theme: "crt"}); err != nil {
		t.Fatalf("save runtime config: %v", err)
	}

	if got := configuredTheme(""); got != "crt" {
		t.Fatalf("expected theme from runtime config, got %q", got)
	}
}

func TestConfiguredThemeEnvOverridesRuntimeConfig(t *testing.T) {
	tmpHome := t.TempDir()
	t.Setenv("HOME", tmpHome)
	t.Setenv(themeEnvVar, "classic")

	if err := runtimeconfig.Save(tmpHome, runtimeconfig.Config{Theme: "crt"}); err != nil {
		t.Fatalf("save runtime config: %v", err)
	}

	if got := configuredTheme(""); got != "classic" {
		t.Fatalf("expected env theme override, got %q", got)
	}
}

func TestConfiguredThemeCLIOverridesEnvAndRuntimeConfig(t *testing.T) {
	tmpHome := t.TempDir()
	t.Setenv("HOME", tmpHome)
	t.Setenv(themeEnvVar, "classic")

	if err := runtimeconfig.Save(tmpHome, runtimeconfig.Config{Theme: "crt"}); err != nil {
		t.Fatalf("save runtime config: %v", err)
	}

	if got := configuredTheme("crt"); got != "crt" {
		t.Fatalf("expected cli theme override, got %q", got)
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

	current = current.Add(lastGoodMaxAge() + time.Minute)
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

func TestRunCycleWithDepsUsesLastGoodFrameWhenNoProvidersAfterSelection(t *testing.T) {
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
		}, nil
	}
	if err := runCycleWithDeps(context.Background(), "", state, deps); err != nil {
		t.Fatalf("expected first cycle to succeed, got %v", err)
	}

	current = current.Add(2 * time.Minute)
	deps.fetchProviders = func(context.Context) ([]codexbar.ParsedFrame, error) {
		return []codexbar.ParsedFrame{}, nil
	}
	if err := runCycleWithDeps(context.Background(), "", state, deps); err != nil {
		t.Fatalf("expected no-provider fallback to avoid hard error, got %v", err)
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

func TestRunCycleWithDepsDoesNotFallbackWhenRequestedPortDisappears(t *testing.T) {
	prepareFastTestEnv(t)

	now := time.Date(2026, 2, 23, 12, 0, 0, 0, time.UTC)
	state := &runtimeState{
		selector: codexbar.NewProviderSelector(),
	}

	requestedPort := "/dev/cu.usbmodem101"
	sentPort := ""

	err := runCycleWithDeps(context.Background(), requestedPort, state, runtimeDeps{
		now: func() time.Time { return now },
		resolvePort: func(port string) (string, error) {
			if port == requestedPort {
				return "", errors.New("serial port not found: " + requestedPort)
			}
			return "", errors.New("unexpected resolve input: " + port)
		},
		fetchProviders: func(context.Context) ([]codexbar.ParsedFrame, error) {
			return []codexbar.ParsedFrame{
				testParsedFrame("codex", 12, 30, 3600),
			}, nil
		},
		sendLine: func(port string, line []byte) error {
			sentPort = port
			return nil
		},
	})
	if err == nil {
		t.Fatalf("expected explicit-port resolve error")
	}
	if sentPort != "" {
		t.Fatalf("expected no send on resolve failure, got %q", sentPort)
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
			return nil, &codexbar.FetchError{Kind: codexbar.FetchErrorCommand, Err: errors.New("context deadline exceeded")}
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

func TestProviderCollectorCollectOnceKeepsPerProviderLastGood(t *testing.T) {
	prepareFastTestEnv(t)

	now := time.Date(2026, 2, 23, 12, 0, 0, 0, time.UTC)
	current := now

	collector := &providerCollector{
		now:             func() time.Time { return current },
		logf:            func(string, ...any) {},
		order:           []string{"codex", "claude"},
		interval:        30 * time.Second,
		timeout:         3 * time.Second,
		maxParallel:     2,
		snapshotMaxAge:  2 * time.Hour,
		persistInterval: time.Minute,
		providers:       make(map[string]providerSnapshot),
	}

	collector.fetchProvider = func(_ context.Context, provider string) (codexbar.ParsedFrame, error) {
		switch provider {
		case "codex":
			return testParsedFrame("codex", 14, 22, 3600), nil
		case "claude":
			return codexbar.ParsedFrame{}, errors.New("timeout")
		default:
			return codexbar.ParsedFrame{}, errors.New("unknown provider")
		}
	}
	collector.collectOnce(context.Background())

	initial := collector.providerFrames(current)
	if len(initial) != 1 || initial[0].Provider != "codex" {
		t.Fatalf("expected only codex snapshot after first collect, got %#v", initial)
	}

	current = current.Add(30 * time.Second)
	collector.fetchProvider = func(_ context.Context, provider string) (codexbar.ParsedFrame, error) {
		switch provider {
		case "codex":
			return codexbar.ParsedFrame{}, errors.New("codex unavailable")
		case "claude":
			return testParsedFrame("claude", 28, 35, 7200), nil
		default:
			return codexbar.ParsedFrame{}, errors.New("unknown provider")
		}
	}
	collector.collectOnce(context.Background())

	second := collector.providerFrames(current)
	if len(second) != 2 {
		t.Fatalf("expected codex stale + claude fresh snapshots, got %#v", second)
	}
	if second[0].Provider != "codex" || second[1].Provider != "claude" {
		t.Fatalf("expected provider order codex,claude; got %#v", second)
	}

	current = current.Add(3 * time.Hour)
	expired := collector.providerFrames(current)
	if len(expired) != 0 {
		t.Fatalf("expected snapshots to expire by max age, got %#v", expired)
	}
}

func TestRunCycleFromCollectorUsesStaleLastGoodWhenCollectorEmpty(t *testing.T) {
	prepareFastTestEnv(t)

	now := time.Date(2026, 2, 23, 12, 0, 0, 0, time.UTC)
	state := &runtimeState{
		selector:    codexbar.NewProviderSelector(),
		lastGood:    protocol.Frame{Provider: "claude", Label: "Claude", Session: 61, Weekly: 49, ResetSec: 3600},
		lastGoodAt:  now.Add(-time.Minute),
		hasLastGood: true,
	}

	collector := &providerCollector{
		now:            func() time.Time { return now },
		logf:           func(string, ...any) {},
		order:          []string{"codex", "claude"},
		snapshotMaxAge: 2 * time.Hour,
		providers:      map[string]providerSnapshot{},
	}

	var sentLine []byte
	err := runCycleFromCollector(context.Background(), "", state, collector, runtimeDeps{
		now:         func() time.Time { return now },
		resolvePort: func(string) (string, error) { return "/dev/cu.usbmodem-test", nil },
		sendLine: func(_ string, line []byte) error {
			sentLine = append([]byte(nil), line...)
			return nil
		},
		logf: func(string, ...any) {},
	})
	if err != nil {
		t.Fatalf("expected stale-last-good fallback, got %v", err)
	}

	frame := decodeFrameLine(t, sentLine)
	if frame.Provider != "claude" || frame.Session != 61 {
		t.Fatalf("expected stale last-good claude frame, got %+v", frame)
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
	t.Setenv("CODEXBAR_DISPLAY_CHROMIUM_COOKIE_DB_PATHS", tmpHome+"/missing-cookies.db")
}
