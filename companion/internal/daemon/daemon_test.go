package daemon

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimeconfig"
	transportlayer "github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/transport"
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

func TestDefaultIntervalForTransport(t *testing.T) {
	tests := []struct {
		name      string
		transport string
		want      time.Duration
	}{
		{name: "wifi", transport: "wifi", want: defaultWiFiInterval},
		{name: "wifi uppercase", transport: "WIFI", want: defaultWiFiInterval},
		{name: "usb", transport: "usb", want: defaultInterval},
		{name: "empty", transport: "", want: defaultInterval},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := defaultIntervalForTransport(tt.transport); got != tt.want {
				t.Fatalf("defaultIntervalForTransport(%q)=%s, expected %s", tt.transport, got, tt.want)
			}
		})
	}
}

func TestRunCycleWithDepsSendsVersionErrorFrameWhenCodexBarTooOld(t *testing.T) {
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
			return nil, &codexbar.FetchError{Kind: codexbar.FetchErrorVersion, Err: errors.New("CodexBar 0.22 is too old; need >= 0.23")}
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
	if runtimeErr.Kind != runtimeErrorCodexbarVersion {
		t.Fatalf("expected codexbar version runtime error, got %s", runtimeErr.Kind)
	}

	frame := decodeFrameLine(t, sentLine)
	if frame.Error != string(runtimeErrorCodexbarVersion) {
		t.Fatalf("expected runtime error frame code %q, got %q", runtimeErrorCodexbarVersion, frame.Error)
	}
}

func TestRunCycleWithDepsLogsUsageSourceFreshModeAndTransport(t *testing.T) {
	prepareFastTestEnv(t)

	now := time.Date(2026, 2, 23, 12, 0, 0, 0, time.UTC)
	state := &runtimeState{
		selector: codexbar.NewProviderSelector(),
	}

	var logged strings.Builder
	err := runCycleWithDeps(context.Background(), "http://192.168.178.65", state, runtimeDeps{
		now:           func() time.Time { return now },
		transportName: "wifi",
		resolvePort:   func(string) (string, error) { return "http://192.168.178.65", nil },
		fetchProviders: func(context.Context) ([]codexbar.ParsedFrame, error) {
			frame := testParsedFrame("codex", 12, 30, 3600)
			frame.Source = "web"
			return []codexbar.ParsedFrame{frame}, nil
		},
		logf: func(format string, args ...any) {
			logged.WriteString(fmt.Sprintf(format, args...))
		},
		sendLine: func(string, []byte) error {
			return nil
		},
	})
	if err != nil {
		t.Fatalf("expected cycle success, got %v", err)
	}

	log := logged.String()
	for _, want := range []string{"transport=wifi", "source=web", "fresh=true", "usageMode=used"} {
		if !strings.Contains(log, want) {
			t.Fatalf("expected log to contain %q, got %q", want, log)
		}
	}
}

func TestRunCycleWithDepsUsesRuntimeConfigTargetOverStaleLaunchAgentTarget(t *testing.T) {
	prepareFastTestEnv(t)

	now := time.Date(2026, 2, 23, 12, 0, 0, 0, time.UTC)
	state := &runtimeState{
		selector: codexbar.NewProviderSelector(),
	}
	var resolvedTarget string
	var sentTarget string

	err := runCycleWithDeps(context.Background(), "http://vibetv.local", state, runtimeDeps{
		now:           func() time.Time { return now },
		transportName: "wifi",
		homeDir:       func() (string, error) { return "/tmp/codexbar-display-test", nil },
		loadConfig: func(string) (runtimeconfig.Config, error) {
			return runtimeconfig.Config{DeviceTarget: "http://192.168.178.159"}, nil
		},
		resolvePort: func(target string) (string, error) {
			resolvedTarget = target
			return target, nil
		},
		deviceCaps: func(string) (protocol.DeviceCapabilities, error) {
			return protocol.DeviceCapabilities{
				Known:                     true,
				Board:                     "esp8266-smalltv-st7789",
				NegotiatedProtocolVersion: protocol.ProtocolVersionV2,
				MaxFrameBytes:             2048,
			}, nil
		},
		fetchProviders: func(context.Context) ([]codexbar.ParsedFrame, error) {
			return []codexbar.ParsedFrame{
				testParsedFrame("codex", 12, 30, 3600),
			}, nil
		},
		logf: func(string, ...any) {},
		sendLine: func(target string, _ []byte) error {
			sentTarget = target
			return nil
		},
	})
	if err != nil {
		t.Fatalf("expected cycle success, got %v", err)
	}
	if resolvedTarget != "http://192.168.178.159" || sentTarget != "http://192.168.178.159" {
		t.Fatalf("expected runtime-config target to win, resolved=%q sent=%q", resolvedTarget, sentTarget)
	}
}

func TestRunCycleWithDepsSendsRuntimeConfigDeviceTokenWithoutLoggingIt(t *testing.T) {
	prepareFastTestEnv(t)

	now := time.Date(2026, 2, 23, 12, 0, 0, 0, time.UTC)
	state := &runtimeState{
		selector: codexbar.NewProviderSelector(),
	}
	var logged strings.Builder
	var sentTarget string

	err := runCycleWithDeps(context.Background(), "http://192.168.178.159", state, runtimeDeps{
		now:           func() time.Time { return now },
		transportName: "wifi",
		homeDir:       func() (string, error) { return "/tmp/codexbar-display-test", nil },
		loadConfig: func(string) (runtimeconfig.Config, error) {
			return runtimeconfig.Config{
				DeviceTarget: "http://192.168.178.159",
				DeviceToken:  "pair-token-secret",
			}, nil
		},
		resolvePort: func(target string) (string, error) {
			return target, nil
		},
		deviceCaps: func(string) (protocol.DeviceCapabilities, error) {
			return protocol.DeviceCapabilities{
				Known:                     true,
				Board:                     "esp8266-smalltv-st7789",
				NegotiatedProtocolVersion: protocol.ProtocolVersionV2,
				MaxFrameBytes:             2048,
			}, nil
		},
		fetchProviders: func(context.Context) ([]codexbar.ParsedFrame, error) {
			return []codexbar.ParsedFrame{
				testParsedFrame("codex", 12, 30, 3600),
			}, nil
		},
		logf: func(format string, args ...any) {
			logged.WriteString(fmt.Sprintf(format, args...))
		},
		sendLine: func(target string, _ []byte) error {
			sentTarget = target
			return nil
		},
	})
	if err != nil {
		t.Fatalf("expected cycle success, got %v", err)
	}
	if sentTarget != "http://192.168.178.159?token=pair-token-secret" {
		t.Fatalf("expected tokenized send target, got %q", sentTarget)
	}
	if strings.Contains(logged.String(), "pair-token-secret") {
		t.Fatalf("daemon log leaked pairing token: %q", logged.String())
	}
	if !strings.Contains(logged.String(), "sent frame -> http://192.168.178.159") {
		t.Fatalf("expected public target in log, got %q", logged.String())
	}
}

func TestRunCycleWithDepsRuntimeConfigDeviceTokenReplacesStaleTargetToken(t *testing.T) {
	prepareFastTestEnv(t)

	now := time.Date(2026, 2, 23, 12, 0, 0, 0, time.UTC)
	state := &runtimeState{
		selector: codexbar.NewProviderSelector(),
	}
	var sentTarget string

	err := runCycleWithDeps(context.Background(), "http://192.168.178.159?token=stale-token", state, runtimeDeps{
		now:           func() time.Time { return now },
		transportName: "wifi",
		homeDir:       func() (string, error) { return "/tmp/codexbar-display-test", nil },
		loadConfig: func(string) (runtimeconfig.Config, error) {
			return runtimeconfig.Config{
				DeviceTarget: "http://192.168.178.159",
				DeviceToken:  "fresh-token",
			}, nil
		},
		resolvePort: func(target string) (string, error) {
			return target, nil
		},
		deviceCaps: func(string) (protocol.DeviceCapabilities, error) {
			return protocol.DeviceCapabilities{
				Known:                     true,
				Board:                     "esp8266-smalltv-st7789",
				NegotiatedProtocolVersion: protocol.ProtocolVersionV2,
				MaxFrameBytes:             2048,
			}, nil
		},
		fetchProviders: func(context.Context) ([]codexbar.ParsedFrame, error) {
			return []codexbar.ParsedFrame{
				testParsedFrame("codex", 12, 30, 3600),
			}, nil
		},
		logf: func(string, ...any) {},
		sendLine: func(target string, _ []byte) error {
			sentTarget = target
			return nil
		},
	})
	if err != nil {
		t.Fatalf("expected cycle success, got %v", err)
	}
	if sentTarget != "http://192.168.178.159?token=fresh-token" {
		t.Fatalf("expected fresh runtime-config token to replace stale target token, got %q", sentTarget)
	}
}

func TestRunCycleWithDepsRepairsStaleDeviceTokenOnUnauthorizedSend(t *testing.T) {
	prepareFastTestEnv(t)

	now := time.Date(2026, 2, 23, 12, 0, 0, 0, time.UTC)
	state := &runtimeState{
		selector: codexbar.NewProviderSelector(),
	}
	cfg := runtimeconfig.Config{
		DeviceTarget: "http://192.168.178.159",
		DeviceToken:  "old-token",
	}
	var sentTargets []string
	var pairedTarget string
	var logged strings.Builder

	err := runCycleWithDeps(context.Background(), "http://192.168.178.159", state, runtimeDeps{
		now:           func() time.Time { return now },
		transportName: "wifi",
		homeDir:       func() (string, error) { return "/tmp/codexbar-display-test", nil },
		loadConfig: func(string) (runtimeconfig.Config, error) {
			return cfg, nil
		},
		saveConfig: func(_ string, next runtimeconfig.Config) error {
			cfg = next
			return nil
		},
		resolvePort: func(target string) (string, error) {
			return target, nil
		},
		deviceCaps: func(string) (protocol.DeviceCapabilities, error) {
			return protocol.DeviceCapabilities{
				Known:                     true,
				Board:                     "esp8266-smalltv-st7789",
				NegotiatedProtocolVersion: protocol.ProtocolVersionV2,
				MaxFrameBytes:             2048,
			}, nil
		},
		fetchProviders: func(context.Context) ([]codexbar.ParsedFrame, error) {
			return []codexbar.ParsedFrame{
				testParsedFrame("codex", 12, 30, 3600),
			}, nil
		},
		pairDevice: func(_ context.Context, target string) (string, error) {
			pairedTarget = target
			return "new-token", nil
		},
		logf: func(format string, args ...any) {
			logged.WriteString(fmt.Sprintf(format, args...))
		},
		sendLine: func(target string, _ []byte) error {
			sentTargets = append(sentTargets, target)
			if strings.Contains(target, "old-token") {
				return errors.New(`post frame: status=401 body="pairing token required"`)
			}
			return nil
		},
	})
	if err != nil {
		t.Fatalf("expected cycle success after token repair, got %v", err)
	}
	wantTargets := []string{
		"http://192.168.178.159?token=old-token",
		"http://192.168.178.159?token=new-token",
	}
	if !reflect.DeepEqual(sentTargets, wantTargets) {
		t.Fatalf("unexpected send targets: got %#v want %#v", sentTargets, wantTargets)
	}
	if pairedTarget != "http://192.168.178.159" {
		t.Fatalf("expected public pairing target, got %q", pairedTarget)
	}
	if cfg.DeviceTarget != "http://192.168.178.159" || cfg.DeviceToken != "new-token" {
		t.Fatalf("expected persisted new token, got %+v", cfg)
	}
	log := logged.String()
	if !strings.Contains(log, "device-token-repaired") {
		t.Fatalf("expected repair log, got %q", log)
	}
	if strings.Contains(log, "old-token") || strings.Contains(log, "new-token") {
		t.Fatalf("daemon log leaked token: %q", log)
	}
}

func TestRunCycleWithDepsAttachesClockFields(t *testing.T) {
	prepareFastTestEnv(t)

	now := time.Date(2026, 2, 23, 12, 34, 0, 0, time.UTC)
	state := &runtimeState{
		selector: codexbar.NewProviderSelector(),
	}

	var sentLine []byte
	err := runCycleWithDeps(context.Background(), "", state, runtimeDeps{
		now:         func() time.Time { return now },
		resolvePort: func(string) (string, error) { return "/dev/cu.usbmodem-test", nil },
		fetchProviders: func(context.Context) ([]codexbar.ParsedFrame, error) {
			return []codexbar.ParsedFrame{
				testParsedFrame("codex", 12, 30, 3600),
			}, nil
		},
		logf: func(string, ...any) {},
		sendLine: func(_ string, line []byte) error {
			sentLine = append([]byte(nil), line...)
			return nil
		},
	})
	if err != nil {
		t.Fatalf("expected cycle success, got %v", err)
	}

	frame := decodeFrameLine(t, sentLine)
	if frame.Time != "12:34" || frame.Date != "23.02.2026" {
		t.Fatalf("expected clock fields from daemon time, got time=%q date=%q", frame.Time, frame.Date)
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

func TestApplySelectionActivityHoldsCodingUntilNextUsageFrame(t *testing.T) {
	prepareFastTestEnv(t)

	now := time.Date(2026, 2, 23, 12, 0, 0, 0, time.UTC)
	state := &runtimeState{}
	frame, detail := applySelectionActivity(protocol.Frame{Provider: "codex"}, codexbar.SelectionDecision{
		Selected:             codexbar.ParsedFrame{CollectedAt: now},
		Reason:               codexbar.SelectionReasonUsageDelta,
		ActivitySignalReason: codexbar.SelectionReasonUsageDelta,
		ActivityDetail:       "source=usage-delta",
	}, state, now)
	if frame.Activity != "coding" {
		t.Fatalf("expected first usage delta to show coding activity, got %q detail=%q", frame.Activity, detail)
	}

	frame, detail = applySelectionActivity(protocol.Frame{Provider: "codex"}, codexbar.SelectionDecision{
		Selected: codexbar.ParsedFrame{CollectedAt: now},
		Reason:   codexbar.SelectionReasonStickyCurrent,
	}, state, now.Add(10*time.Second))
	if frame.Activity != "coding" {
		t.Fatalf("expected coding to hold until next usage frame, got %q detail=%q", frame.Activity, detail)
	}

	frame, detail = applySelectionActivity(protocol.Frame{Provider: "codex"}, codexbar.SelectionDecision{
		Selected: codexbar.ParsedFrame{CollectedAt: now.Add(10 * time.Second)},
		Reason:   codexbar.SelectionReasonStickyCurrent,
	}, state, now.Add(10*time.Second))
	if frame.Activity != "coding" {
		t.Fatalf("expected coding hold for unchanged fast cost frame, got %q detail=%q", frame.Activity, detail)
	}

	frame, detail = applySelectionActivity(protocol.Frame{Provider: "codex"}, codexbar.SelectionDecision{
		Selected: codexbar.ParsedFrame{CollectedAt: now.Add(time.Minute)},
		Reason:   codexbar.SelectionReasonStickyCurrent,
	}, state, now.Add(time.Minute))
	if frame.Activity != "coding" {
		t.Fatalf("expected coding until explicit idle evidence arrives, got %q detail=%q", frame.Activity, detail)
	}
}

func TestApplySelectionActivityTreatsCachedCodexBarSnapshotAsNotFreshIdleEvidence(t *testing.T) {
	prepareFastTestEnv(t)
	t.Setenv(activityHoldEnvVar, "20")

	now := time.Date(2026, 2, 23, 12, 0, 0, 0, time.UTC)
	observedAt := now.Add(-5 * time.Second)
	state := &runtimeState{}

	frame, detail := applySelectionActivity(protocol.Frame{Provider: "codex"}, codexbar.SelectionDecision{
		Selected: codexbar.ParsedFrame{
			CollectedAt:        now,
			ActivityObservedAt: observedAt,
		},
		ActivitySignalReason: codexbar.SelectionReasonUsageDelta,
		ActivityDetail:       "source=usage-delta",
	}, state, now)
	if frame.Activity != "coding" {
		t.Fatalf("expected token delta to show coding, got %q detail=%q", frame.Activity, detail)
	}

	frame, detail = applySelectionActivity(protocol.Frame{Provider: "codex"}, codexbar.SelectionDecision{
		Selected: codexbar.ParsedFrame{
			CollectedAt:        now.Add(30 * time.Second),
			ActivityObservedAt: observedAt,
		},
		Reason: codexbar.SelectionReasonStickyCurrent,
	}, state, now.Add(30*time.Second))
	if frame.Activity != "coding" {
		t.Fatalf("expected cached CodexBar snapshot to keep short coding hold, got %q detail=%q", frame.Activity, detail)
	}

	frame, detail = applySelectionActivity(protocol.Frame{Provider: "codex"}, codexbar.SelectionDecision{
		Selected: codexbar.ParsedFrame{
			CollectedAt:        now.Add(50 * time.Second),
			ActivityObservedAt: observedAt,
		},
		Reason: codexbar.SelectionReasonStickyCurrent,
	}, state, now.Add(50*time.Second))
	if frame.Activity != "coding" {
		t.Fatalf("expected cached CodexBar snapshot not to count as idle evidence, got %q detail=%q", frame.Activity, detail)
	}
}

func TestApplySelectionActivityRequiresFreshNoDeltaEvidenceBeforeIdle(t *testing.T) {
	prepareFastTestEnv(t)
	t.Setenv(activityHoldEnvVar, "20")
	t.Setenv(activityIdleEvidenceEnvVar, "2")

	now := time.Date(2026, 2, 23, 12, 0, 0, 0, time.UTC)
	state := &runtimeState{}

	frame, detail := applySelectionActivity(protocol.Frame{Provider: "codex"}, codexbar.SelectionDecision{
		Selected: codexbar.ParsedFrame{
			CollectedAt:        now,
			ActivityObservedAt: now,
		},
		ActivitySignalReason: codexbar.SelectionReasonUsageDelta,
		ActivityDetail:       "source=usage-delta",
	}, state, now)
	if frame.Activity != "coding" {
		t.Fatalf("expected token delta to show coding, got %q detail=%q", frame.Activity, detail)
	}

	frame, detail = applySelectionActivity(protocol.Frame{Provider: "codex"}, codexbar.SelectionDecision{
		Selected: codexbar.ParsedFrame{
			CollectedAt:        now.Add(30 * time.Second),
			ActivityObservedAt: now.Add(30 * time.Second),
		},
		Reason: codexbar.SelectionReasonStickyCurrent,
	}, state, now.Add(30*time.Second))
	if frame.Activity != "coding" {
		t.Fatalf("expected first fresh no-delta CodexBar snapshot to keep coding, got %q detail=%q", frame.Activity, detail)
	}

	frame, detail = applySelectionActivity(protocol.Frame{Provider: "codex"}, codexbar.SelectionDecision{
		Selected: codexbar.ParsedFrame{
			CollectedAt:        now.Add(60 * time.Second),
			ActivityObservedAt: now.Add(60 * time.Second),
		},
		Reason: codexbar.SelectionReasonStickyCurrent,
	}, state, now.Add(60*time.Second))
	if frame.Activity != "idle" {
		t.Fatalf("expected second fresh no-delta CodexBar snapshot to confirm idle, got %q detail=%q", frame.Activity, detail)
	}
}

func TestApplySelectionActivityKeepsExplicitActivity(t *testing.T) {
	frame, _ := applySelectionActivity(protocol.Frame{Provider: "codex", Activity: "idle"}, codexbar.SelectionDecision{
		Reason: codexbar.SelectionReasonLocalActivity,
	}, &runtimeState{}, time.Date(2026, 2, 23, 12, 0, 0, 0, time.UTC))
	if frame.Activity != "idle" {
		t.Fatalf("expected explicit activity to be preserved, got %q", frame.Activity)
	}
}

func TestApplySelectionActivityTreatsStaleLocalSignalAsIdle(t *testing.T) {
	prepareFastTestEnv(t)

	now := time.Date(2026, 2, 23, 12, 0, 0, 0, time.UTC)
	frame, detail := applySelectionActivity(protocol.Frame{Provider: "claude"}, codexbar.SelectionDecision{
		Reason: codexbar.SelectionReasonLocalActivity,
		Detail: "provider=claude confidence=high at=2026-02-23T11:00:00Z evidence=test",
	}, &runtimeState{}, now)
	if frame.Activity != "idle" {
		t.Fatalf("expected stale local activity to render idle, got %q detail=%q", frame.Activity, detail)
	}
}

func TestRunCycleActivityFollowsEachUsageSnapshot(t *testing.T) {
	prepareFastTestEnv(t)
	t.Setenv(activityHoldEnvVar, "60")

	base := time.Date(2026, 2, 23, 12, 0, 0, 0, time.UTC)
	now := base
	state := &runtimeState{
		selector: codexbar.NewProviderSelector(),
	}
	session := 10
	collectedAt := base
	var frames []protocol.Frame

	run := func(t *testing.T) {
		t.Helper()
		err := runCycleWithDeps(context.Background(), "", state, runtimeDeps{
			now:         func() time.Time { return now },
			resolvePort: func(string) (string, error) { return "/dev/cu.usbmodem-test", nil },
			fetchProviders: func(context.Context) ([]codexbar.ParsedFrame, error) {
				frame := testParsedFrame("codex", session, 20, 3600)
				frame.CollectedAt = collectedAt
				return []codexbar.ParsedFrame{frame}, nil
			},
			logf: func(string, ...any) {},
			sendLine: func(_ string, line []byte) error {
				frames = append(frames, decodeFrameLine(t, line))
				return nil
			},
		})
		if err != nil {
			t.Fatalf("expected cycle success, got %v", err)
		}
	}

	run(t)
	if frames[len(frames)-1].Activity != "idle" {
		t.Fatalf("expected initial frame idle, got %q", frames[len(frames)-1].Activity)
	}

	now = base.Add(2 * time.Second)
	collectedAt = now
	session = 11
	run(t)
	if frames[len(frames)-1].Activity != "coding" {
		t.Fatalf("expected first usage delta to mark coding, got %q", frames[len(frames)-1].Activity)
	}

	now = base.Add(10 * time.Second)
	collectedAt = now
	run(t)
	if frames[len(frames)-1].Activity != "coding" {
		t.Fatalf("expected coding to hold for unchanged fast cost snapshot, got %q", frames[len(frames)-1].Activity)
	}

	now = base.Add(time.Minute)
	collectedAt = now
	run(t)
	if frames[len(frames)-1].Activity != "coding" {
		t.Fatalf("expected first no-delta snapshot to keep coding, got %q", frames[len(frames)-1].Activity)
	}

	now = base.Add(2 * time.Minute)
	collectedAt = now
	run(t)
	if frames[len(frames)-1].Activity != "idle" {
		t.Fatalf("expected second no-delta snapshot to confirm idle, got %q", frames[len(frames)-1].Activity)
	}
}

func TestRunCycleSendsIdleAfterFailedCodingSendWhenUsageStopsChanging(t *testing.T) {
	prepareFastTestEnv(t)
	t.Setenv(activityHoldEnvVar, "60")

	base := time.Date(2026, 2, 23, 12, 0, 0, 0, time.UTC)
	now := base
	state := &runtimeState{
		selector: codexbar.NewProviderSelector(),
	}
	session := 10
	sendShouldFail := false
	var sent []protocol.Frame

	run := func(t *testing.T) error {
		t.Helper()
		return runCycleWithDeps(context.Background(), "", state, runtimeDeps{
			now:         func() time.Time { return now },
			resolvePort: func(string) (string, error) { return "/dev/cu.usbmodem-test", nil },
			fetchProviders: func(context.Context) ([]codexbar.ParsedFrame, error) {
				return []codexbar.ParsedFrame{testParsedFrame("codex", session, 20, 3600)}, nil
			},
			logf: func(string, ...any) {},
			sendLine: func(_ string, line []byte) error {
				if sendShouldFail {
					return errors.New("write failed")
				}
				sent = append(sent, decodeFrameLine(t, line))
				return nil
			},
		})
	}

	if err := run(t); err != nil {
		t.Fatalf("expected baseline cycle success, got %v", err)
	}

	now = base.Add(2 * time.Second)
	session = 11
	sendShouldFail = true
	if err := run(t); err == nil {
		t.Fatalf("expected coding send failure")
	}

	now = base.Add(time.Minute)
	sendShouldFail = false
	if err := run(t); err != nil {
		t.Fatalf("expected recovery cycle success, got %v", err)
	}
	if got := sent[len(sent)-1].Activity; got != "coding" {
		t.Fatalf("expected first recovery no-delta frame to keep coding, got %q", got)
	}

	now = base.Add(2 * time.Minute)
	if err := run(t); err != nil {
		t.Fatalf("expected second recovery cycle success, got %v", err)
	}
	if got := sent[len(sent)-1].Activity; got != "idle" {
		t.Fatalf("expected second recovery frame to confirm idle, got %q", got)
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

func TestMarshalFrameWithinLimitDropsUpdateBeforeFallback(t *testing.T) {
	base := protocol.Frame{
		Provider: "codex",
		Label:    "Codex",
		Session:  12,
		Weekly:   30,
		ResetSec: 3600,
	}
	withUpdate := base
	withUpdate.Update = &protocol.UpdateState{
		Available:     true,
		LatestVersion: strings.Repeat("9", 80),
		Status:        "update_available",
	}

	baseLine, err := base.MarshalLine()
	if err != nil {
		t.Fatalf("marshal base frame: %v", err)
	}

	line, marshaled, err := marshalFrameWithinLimit(withUpdate, len(baseLine))
	if err != nil {
		t.Fatalf("marshal within limit: %v", err)
	}
	if marshaled.Update != nil {
		t.Fatalf("expected update state to be dropped to fit frame, got %+v", marshaled.Update)
	}
	if len(line) > len(baseLine) {
		t.Fatalf("expected line to fit limit %d, got %d", len(baseLine), len(line))
	}
}

func TestMarshalFrameWithinLimitCompactsUpdateBeforeDropping(t *testing.T) {
	base := protocol.Frame{
		Provider: "codex",
		Label:    "Codex",
		Session:  12,
		Weekly:   30,
		ResetSec: 3600,
	}
	withUpdate := base
	withUpdate.Update = &protocol.UpdateState{
		Available:     true,
		LatestVersion: "1.0.19",
		Status:        "update_available",
		Message:       strings.Repeat("Firmware update available. ", 20),
		FirmwareURL:   "https://github.com/DreamyTalesPAN/CodexBar-Display/releases/download/v1.0.19/" + strings.Repeat("firmware-", 30) + ".bin.gz",
		SHA256:        strings.Repeat("a", 64),
	}
	compact := withUpdate
	compact.Update = compactFrameUpdate(withUpdate.Update)
	compactLine, err := compact.MarshalLine()
	if err != nil {
		t.Fatalf("marshal compact frame: %v", err)
	}

	line, marshaled, err := marshalFrameWithinLimit(withUpdate, len(compactLine))
	if err != nil {
		t.Fatalf("marshal within limit: %v", err)
	}
	if len(line) > len(compactLine) {
		t.Fatalf("expected compact update to fit limit %d, got %d", len(compactLine), len(line))
	}
	if marshaled.Update == nil || !marshaled.Update.Available {
		t.Fatalf("expected compact update state, got %+v", marshaled.Update)
	}
	if marshaled.Update.LatestVersion != "1.0.19" || marshaled.Update.Status != "update_available" {
		t.Fatalf("unexpected compact update state: %+v", marshaled.Update)
	}
	if marshaled.Update.Message != "" || marshaled.Update.FirmwareURL != "" || marshaled.Update.SHA256 != "" {
		t.Fatalf("expected verbose update fields to be dropped, got %+v", marshaled.Update)
	}
}

func TestMarshalFrameWithinLimitKeepsCompactUpdateBeforeTokens(t *testing.T) {
	frame := protocol.Frame{
		Provider:      "codex",
		Label:         "Codex",
		Session:       12,
		Weekly:        30,
		ResetSec:      3600,
		SessionTokens: 999999999999,
		WeekTokens:    888888888888,
		TotalTokens:   777777777777,
		Update: &protocol.UpdateState{
			Available:     true,
			LatestVersion: "1.0.19",
			Status:        "update_available",
			Message:       strings.Repeat("Firmware update available. ", 20),
			FirmwareURL:   "https://github.com/DreamyTalesPAN/CodexBar-Display/releases/download/v1.0.19/" + strings.Repeat("firmware-", 30) + ".bin.gz",
			SHA256:        strings.Repeat("a", 64),
		},
	}
	withoutTokens := frame
	withoutTokens.SessionTokens = 0
	withoutTokens.WeekTokens = 0
	withoutTokens.TotalTokens = 0
	withoutTokens.Update = compactFrameUpdate(frame.Update)
	withoutTokensLine, err := withoutTokens.MarshalLine()
	if err != nil {
		t.Fatalf("marshal compact frame without tokens: %v", err)
	}

	line, marshaled, err := marshalFrameWithinLimit(frame, len(withoutTokensLine))
	if err != nil {
		t.Fatalf("marshal within limit: %v", err)
	}
	if len(line) > len(withoutTokensLine) {
		t.Fatalf("expected compact update without tokens to fit limit %d, got %d", len(withoutTokensLine), len(line))
	}
	if marshaled.Update == nil || !marshaled.Update.Available {
		t.Fatalf("expected update to be preserved, got %+v", marshaled.Update)
	}
	if marshaled.SessionTokens != 0 || marshaled.WeekTokens != 0 || marshaled.TotalTokens != 0 {
		t.Fatalf("expected token counts to be dropped before update, got %+v", marshaled)
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

func TestRunCycleWithDepsAttachesFirmwareUpdateState(t *testing.T) {
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
				Known:                     true,
				Board:                     "esp8266-smalltv-st7789",
				Firmware:                  "1.0.0",
				NegotiatedProtocolVersion: 2,
				MaxFrameBytes:             1024,
			}, nil
		},
		fetchProviders: func(context.Context) ([]codexbar.ParsedFrame, error) {
			return []codexbar.ParsedFrame{testParsedFrame("codex", 12, 30, 3600)}, nil
		},
		fetchUpdateState: func(context.Context, protocol.DeviceCapabilities) (protocol.UpdateState, error) {
			return protocol.UpdateState{Available: true, LatestVersion: "1.0.1", Status: "update_available"}, nil
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
	if frame.Update == nil || !frame.Update.Available || frame.Update.LatestVersion != "1.0.1" {
		t.Fatalf("expected update state in frame, got %+v", frame.Update)
	}
}

func TestRunCycleWithDepsRefreshesFirmwareUpdateCacheWhenFirmwareChanges(t *testing.T) {
	prepareFastTestEnv(t)

	now := time.Date(2026, 6, 10, 12, 0, 0, 0, time.UTC)
	state := &runtimeState{
		selector: codexbar.NewProviderSelector(),
	}
	firmwareVersion := "1.0.0"
	var fetchUpdateCalls int
	var sentLine []byte
	deps := runtimeDeps{
		now:         func() time.Time { return now },
		resolvePort: func(string) (string, error) { return "http://vibetv.local", nil },
		deviceCaps: func(string) (protocol.DeviceCapabilities, error) {
			return protocol.DeviceCapabilities{
				Known:                     true,
				Board:                     "esp8266-smalltv-st7789",
				Firmware:                  firmwareVersion,
				NegotiatedProtocolVersion: 2,
				MaxFrameBytes:             1024,
			}, nil
		},
		fetchProviders: func(context.Context) ([]codexbar.ParsedFrame, error) {
			return []codexbar.ParsedFrame{testParsedFrame("codex", 12, 30, 3600)}, nil
		},
		fetchUpdateState: func(_ context.Context, caps protocol.DeviceCapabilities) (protocol.UpdateState, error) {
			fetchUpdateCalls++
			if caps.Firmware == "1.0.0" {
				return protocol.UpdateState{Available: true, LatestVersion: "1.0.1", Status: "update_available"}, nil
			}
			return protocol.UpdateState{Available: false, LatestVersion: "1.0.1", Status: "current"}, nil
		},
		logf: func(string, ...any) {},
		sendLine: func(_ string, line []byte) error {
			sentLine = append([]byte(nil), line...)
			return nil
		},
	}

	if err := runCycleWithDeps(context.Background(), "", state, deps); err != nil {
		t.Fatalf("first cycle: %v", err)
	}
	firstFrame := decodeFrameLine(t, sentLine)
	if firstFrame.Update == nil || !firstFrame.Update.Available {
		t.Fatalf("expected first cycle update available, got %+v", firstFrame.Update)
	}

	firmwareVersion = "1.0.1"
	now = now.Add(time.Minute)
	if err := runCycleWithDeps(context.Background(), "", state, deps); err != nil {
		t.Fatalf("second cycle: %v", err)
	}
	secondFrame := decodeFrameLine(t, sentLine)
	if secondFrame.Update == nil || secondFrame.Update.Available || secondFrame.Update.Status != "current" {
		t.Fatalf("expected second cycle current update state, got %+v", secondFrame.Update)
	}
	if fetchUpdateCalls != 2 {
		t.Fatalf("expected update state to refresh after firmware change, got %d calls", fetchUpdateCalls)
	}
}

func TestRunCycleWithDepsPreservesFirmwareUpdateNoticeForLegacyDevice(t *testing.T) {
	prepareFastTestEnv(t)

	now := time.Date(2026, 5, 19, 14, 0, 0, 0, time.UTC)
	state := &runtimeState{
		selector: codexbar.NewProviderSelector(),
	}

	var sentLine []byte
	err := runCycleWithDeps(context.Background(), "", state, runtimeDeps{
		now:         func() time.Time { return now },
		resolvePort: func(string) (string, error) { return "http://vibetv.local", nil },
		deviceCaps: func(string) (protocol.DeviceCapabilities, error) {
			return protocol.DeviceCapabilities{
				Known:                     true,
				Board:                     "esp8266-smalltv-st7789",
				Firmware:                  "1.0.17",
				NegotiatedProtocolVersion: 2,
				MaxFrameBytes:             1024,
			}, nil
		},
		fetchProviders: func(context.Context) ([]codexbar.ParsedFrame, error) {
			frame := testParsedFrame("codex", 33, 48, 397557)
			frame.Frame.Label = "Codex"
			frame.Frame.UsageMode = "remaining"
			frame.Frame.SessionTokens = 999999999999
			frame.Frame.WeekTokens = 888888888888
			frame.Frame.TotalTokens = 777777777777
			return []codexbar.ParsedFrame{frame}, nil
		},
		fetchUpdateState: func(context.Context, protocol.DeviceCapabilities) (protocol.UpdateState, error) {
			return protocol.UpdateState{
				Available:     true,
				LatestVersion: "1.0.20",
				Status:        "update_available",
				Severity:      "recommended",
				Message:       strings.Repeat("Firmware update available. Open vibetv.local. ", 20),
				FirmwareURL:   "https://github.com/DreamyTalesPAN/CodexBar-Display/releases/download/v1.0.20/" + strings.Repeat("codexbar-display-firmware-esp8266-smalltv-st7789-", 10) + "v1.0.20.bin.gz",
				SHA256:        strings.Repeat("a", 128),
			}, nil
		},
		logf: func(string, ...any) {},
		sendLine: func(_ string, line []byte) error {
			sentLine = append([]byte(nil), line...)
			return nil
		},
	})
	if err != nil {
		t.Fatalf("expected cycle success, got %v", err)
	}
	if len(sentLine) > 1024 {
		t.Fatalf("expected frame to fit legacy 1024-byte device limit, got %d bytes", len(sentLine))
	}

	frame := decodeFrameLine(t, sentLine)
	if frame.Update == nil || !frame.Update.Available {
		t.Fatalf("expected firmware update notice to reach legacy device, got %+v", frame.Update)
	}
	if frame.Update.LatestVersion != "1.0.20" || frame.Update.Status != "update_available" {
		t.Fatalf("unexpected firmware update notice: %+v", frame.Update)
	}
	if frame.Update.FirmwareURL != "" || frame.Update.SHA256 != "" || frame.Update.Message != "" {
		t.Fatalf("expected verbose update fields to be compacted for legacy device, got %+v", frame.Update)
	}
}

func TestSelectFirmwareUpdateComparesBoardRelease(t *testing.T) {
	update, err := selectFirmwareUpdate(protocol.DeviceCapabilities{
		Board:    "esp8266-smalltv-st7789",
		Firmware: "1.0.0",
	}, firmwareManifest{Artifacts: []firmwareArtifact{
		{Board: "esp8266-smalltv-st7789", FirmwareVersion: "1.0.1"},
		{Board: "other-board", FirmwareVersion: "9.0.0"},
	}})
	if err != nil {
		t.Fatalf("select update: %v", err)
	}
	if !update.Available || update.LatestVersion != "1.0.1" || update.Status != "update_available" {
		t.Fatalf("unexpected update state: %+v", update)
	}

	current, err := selectFirmwareUpdate(protocol.DeviceCapabilities{
		Board:    "esp8266-smalltv-st7789",
		Firmware: "1.0.1",
	}, firmwareManifest{Artifacts: []firmwareArtifact{
		{Board: "esp8266-smalltv-st7789", FirmwareVersion: "1.0.1"},
	}})
	if err != nil {
		t.Fatalf("select current: %v", err)
	}
	if current.Available || current.Status != "current" {
		t.Fatalf("expected current state, got %+v", current)
	}

	devCurrent, err := selectFirmwareUpdate(protocol.DeviceCapabilities{
		Board:    "esp8266-smalltv-st7789",
		Firmware: "1.0.1-dev",
	}, firmwareManifest{Artifacts: []firmwareArtifact{
		{Board: "esp8266-smalltv-st7789", FirmwareVersion: "1.0.1"},
	}})
	if err != nil {
		t.Fatalf("select dev current: %v", err)
	}
	if devCurrent.Available || devCurrent.Status != "current" {
		t.Fatalf("expected dev build for same release to be current, got %+v", devCurrent)
	}

	nextRelease, err := selectFirmwareUpdate(protocol.DeviceCapabilities{
		Board:    "esp8266-smalltv-st7789",
		Firmware: "1.0.1-dev",
	}, firmwareManifest{Artifacts: []firmwareArtifact{
		{Board: "esp8266-smalltv-st7789", FirmwareVersion: "1.0.2"},
	}})
	if err != nil {
		t.Fatalf("select next release for dev build: %v", err)
	}
	if !nextRelease.Available || nextRelease.Status != "update_available" {
		t.Fatalf("expected newer release to update dev build, got %+v", nextRelease)
	}
}

func TestMarshalFrameWithinLimitDropsTokenStatsBeforeFallback(t *testing.T) {
	frame := protocol.Frame{
		Provider:      "codex",
		Label:         "Codex",
		Session:       12,
		Weekly:        30,
		ResetSec:      3600,
		SessionTokens: 1437166,
		WeekTokens:    382243544,
		TotalTokens:   1078397605,
	}

	withoutTokens := frame
	withoutTokens.SessionTokens = 0
	withoutTokens.WeekTokens = 0
	withoutTokens.TotalTokens = 0
	withoutTokensLine, err := withoutTokens.MarshalLine()
	if err != nil {
		t.Fatalf("marshal base frame without tokens: %v", err)
	}

	line, marshaled, err := marshalFrameWithinLimit(frame, len(withoutTokensLine))
	if err != nil {
		t.Fatalf("marshal within limit: %v", err)
	}
	if marshaled.Error != "" {
		t.Fatalf("expected token stats to be dropped before error fallback, got %q", marshaled.Error)
	}
	if marshaled.SessionTokens != 0 || marshaled.WeekTokens != 0 || marshaled.TotalTokens != 0 {
		t.Fatalf("expected token stats to be removed to fit frame, got %+v", marshaled)
	}
	if len(line) > len(withoutTokensLine) {
		t.Fatalf("expected line to fit limit %d, got %d", len(withoutTokensLine), len(line))
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

func TestRunCycleWithDepsDiscoversNewWiFiIPWhenStoredIPStales(t *testing.T) {
	prepareFastTestEnv(t)

	now := time.Date(2026, 2, 23, 12, 0, 0, 0, time.UTC)
	state := &runtimeState{
		selector: codexbar.NewProviderSelector(),
	}

	const staleTarget = "http://192.168.178.163"
	const recoveredTarget = "http://192.168.178.72"
	var resolved []string
	var sentPort string
	var logged strings.Builder
	savedConfig := runtimeconfig.Config{DeviceTarget: staleTarget}

	err := runCycleWithDeps(context.Background(), staleTarget, state, runtimeDeps{
		now:           func() time.Time { return now },
		transportName: "wifi",
		homeDir:       func() (string, error) { return "/tmp/codexbar-test-home", nil },
		loadConfig: func(string) (runtimeconfig.Config, error) {
			return savedConfig, nil
		},
		saveConfig: func(_ string, cfg runtimeconfig.Config) error {
			savedConfig = cfg
			return nil
		},
		resolvePort: func(target string) (string, error) {
			resolved = append(resolved, target)
			return target, nil
		},
		deviceCaps: func(target string) (protocol.DeviceCapabilities, error) {
			if target == staleTarget {
				return protocol.DeviceCapabilities{}, errors.New("host is down")
			}
			return protocol.DeviceCapabilities{}, fmt.Errorf("unexpected direct fallback target %s", target)
		},
		discoverWiFi: func(candidates []string) (transportlayer.WiFiDiscoveryResult, error) {
			if !containsString(candidates, staleTarget) {
				t.Fatalf("expected stale IP candidate, got %#v", candidates)
			}
			if containsString(candidates, defaultWiFiTarget) {
				t.Fatalf("did not expect default mDNS candidate before network scan for stale IP, got %#v", candidates)
			}
			return transportlayer.WiFiDiscoveryResult{
				Target: recoveredTarget,
				Hello: protocol.DeviceHello{
					Kind:            "hello",
					ProtocolVersion: 2,
					Board:           "esp8266-smalltv-st7789",
					Capabilities: protocol.CapabilityBlock{
						Transport: protocol.TransportCapabilities{Active: "wifi"},
					},
				},
				Source: "network-scan",
			}, nil
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
		logf: func(format string, args ...any) {
			logged.WriteString(fmt.Sprintf(format, args...))
		},
	})
	if err != nil {
		t.Fatalf("runCycleWithDeps returned error: %v", err)
	}
	if got := strings.Join(resolved, ","); got != staleTarget {
		t.Fatalf("unexpected resolve order %q", got)
	}
	if sentPort != recoveredTarget {
		t.Fatalf("expected frame sent to discovered target, got %q", sentPort)
	}
	if !strings.Contains(logged.String(), "wifi-target-discovered") {
		t.Fatalf("expected discovery log, got %q", logged.String())
	}
	if savedConfig.DeviceTarget != recoveredTarget {
		t.Fatalf("expected discovered target to be persisted, got %+v", savedConfig)
	}
	if state.deviceTarget != recoveredTarget {
		t.Fatalf("expected discovered target in runtime state, got %q", state.deviceTarget)
	}

	resolved = nil
	sentPort = ""
	now = now.Add(time.Second)
	err = runCycleWithDeps(context.Background(), staleTarget, state, runtimeDeps{
		now:           func() time.Time { return now },
		transportName: "wifi",
		homeDir:       func() (string, error) { return "/tmp/codexbar-test-home", nil },
		loadConfig: func(string) (runtimeconfig.Config, error) {
			return savedConfig, nil
		},
		saveConfig: func(_ string, cfg runtimeconfig.Config) error {
			savedConfig = cfg
			return nil
		},
		resolvePort: func(target string) (string, error) {
			resolved = append(resolved, target)
			return target, nil
		},
		deviceCaps: func(target string) (protocol.DeviceCapabilities, error) {
			if target != recoveredTarget {
				return protocol.DeviceCapabilities{}, fmt.Errorf("unexpected target after recovery %s", target)
			}
			return protocol.DeviceCapabilities{
				Known:                     true,
				Board:                     "esp8266-smalltv-st7789",
				NegotiatedProtocolVersion: protocol.ProtocolVersionV2,
				MaxFrameBytes:             2048,
			}, nil
		},
		fetchProviders: func(context.Context) ([]codexbar.ParsedFrame, error) {
			return []codexbar.ParsedFrame{testParsedFrame("codex", 12, 30, 3600)}, nil
		},
		sendLine: func(port string, line []byte) error {
			sentPort = port
			return nil
		},
		logf: func(string, ...any) {},
	})
	if err != nil {
		t.Fatalf("second runCycleWithDeps returned error: %v", err)
	}
	if got := strings.Join(resolved, ","); got != recoveredTarget {
		t.Fatalf("expected second cycle to use recovered target only, got %q", got)
	}
	if sentPort != recoveredTarget {
		t.Fatalf("expected second frame sent to recovered target, got %q", sentPort)
	}
}

func TestRunCycleWithDepsDiscoversWiFiIPWhenStoredIPCapabilitiesAreUnknown(t *testing.T) {
	prepareFastTestEnv(t)

	now := time.Date(2026, 2, 23, 12, 0, 0, 0, time.UTC)
	state := &runtimeState{
		selector: codexbar.NewProviderSelector(),
	}

	const staleTarget = "http://192.168.178.163"
	const recoveredTarget = "http://192.168.178.72"
	var sentPort string

	err := runCycleWithDeps(context.Background(), staleTarget, state, runtimeDeps{
		now:           func() time.Time { return now },
		transportName: "wifi",
		resolvePort: func(target string) (string, error) {
			return target, nil
		},
		deviceCaps: func(target string) (protocol.DeviceCapabilities, error) {
			if target == staleTarget {
				return protocol.UnknownDeviceCapabilities(), nil
			}
			return protocol.DeviceCapabilities{}, fmt.Errorf("unexpected direct fallback target %s", target)
		},
		discoverWiFi: func(candidates []string) (transportlayer.WiFiDiscoveryResult, error) {
			if !containsString(candidates, staleTarget) {
				t.Fatalf("expected stale IP candidate, got %#v", candidates)
			}
			if containsString(candidates, defaultWiFiTarget) {
				t.Fatalf("did not expect default mDNS candidate before network scan for stale IP, got %#v", candidates)
			}
			return transportlayer.WiFiDiscoveryResult{
				Target: recoveredTarget,
				Hello: protocol.DeviceHello{
					Kind:            "hello",
					ProtocolVersion: 2,
					Board:           "esp8266-smalltv-st7789",
					Capabilities: protocol.CapabilityBlock{
						Transport: protocol.TransportCapabilities{Active: "wifi"},
					},
				},
				Source: "network-scan",
			}, nil
		},
		fetchProviders: func(context.Context) ([]codexbar.ParsedFrame, error) {
			return []codexbar.ParsedFrame{testParsedFrame("codex", 12, 30, 3600)}, nil
		},
		sendLine: func(port string, line []byte) error {
			sentPort = port
			return nil
		},
		logf: func(string, ...any) {},
	})
	if err != nil {
		t.Fatalf("runCycleWithDeps returned error: %v", err)
	}
	if sentPort != recoveredTarget {
		t.Fatalf("expected frame sent to discovered target, got %q", sentPort)
	}
}

func TestRunCycleWithDepsDiscoversWiFiIPWhenMDNSFails(t *testing.T) {
	prepareFastTestEnv(t)

	now := time.Date(2026, 2, 23, 12, 0, 0, 0, time.UTC)
	state := &runtimeState{
		selector: codexbar.NewProviderSelector(),
	}

	const staleTarget = "http://vibetv.local"
	const discoveredTarget = "http://192.168.178.159"
	var sentPort string
	var logged strings.Builder
	cfg := runtimeconfig.Config{DeviceTarget: staleTarget}

	err := runCycleWithDeps(context.Background(), staleTarget, state, runtimeDeps{
		now:           func() time.Time { return now },
		transportName: "wifi",
		homeDir:       func() (string, error) { return "/tmp/codexbar-display-test", nil },
		loadConfig: func(string) (runtimeconfig.Config, error) {
			return cfg, nil
		},
		saveConfig: func(_ string, next runtimeconfig.Config) error {
			cfg = next
			return nil
		},
		resolvePort: func(target string) (string, error) {
			return target, nil
		},
		deviceCaps: func(target string) (protocol.DeviceCapabilities, error) {
			if target == staleTarget {
				return protocol.DeviceCapabilities{}, errors.New("mDNS timeout")
			}
			return protocol.DeviceCapabilities{}, fmt.Errorf("unexpected target %s", target)
		},
		discoverWiFi: func(candidates []string) (transportlayer.WiFiDiscoveryResult, error) {
			if !containsString(candidates, staleTarget) {
				t.Fatalf("expected stale target candidate, got %#v", candidates)
			}
			return transportlayer.WiFiDiscoveryResult{
				Target: discoveredTarget,
				Hello: protocol.DeviceHello{
					Kind:            "hello",
					ProtocolVersion: 2,
					Board:           "esp8266-smalltv-st7789",
					Capabilities: protocol.CapabilityBlock{
						Transport: protocol.TransportCapabilities{Active: "wifi"},
					},
				},
				Source: "network-scan",
			}, nil
		},
		fetchProviders: func(context.Context) ([]codexbar.ParsedFrame, error) {
			return []codexbar.ParsedFrame{testParsedFrame("codex", 12, 30, 3600)}, nil
		},
		sendLine: func(port string, line []byte) error {
			sentPort = port
			return nil
		},
		logf: func(format string, args ...any) {
			logged.WriteString(fmt.Sprintf(format, args...))
		},
	})
	if err != nil {
		t.Fatalf("runCycleWithDeps returned error: %v", err)
	}
	if sentPort != discoveredTarget {
		t.Fatalf("expected frame sent to discovered target, got %q", sentPort)
	}
	if cfg.DeviceTarget != discoveredTarget {
		t.Fatalf("expected discovered target persisted, got %+v", cfg)
	}
	if !strings.Contains(logged.String(), "wifi-target-discovered") {
		t.Fatalf("expected discovery log, got %q", logged.String())
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
	beforeGap := start.Add(2 * time.Second)
	afterGap := start.Add(2*time.Minute + 5*time.Second)
	afterGapNext := start.Add(2*time.Minute + 7*time.Second)
	nowValues := []time.Time{
		start, start,
		beforeGap, beforeGap,
		afterGap, afterGap, // sleep/wake-sized wall clock gap
		afterGapNext, afterGapNext,
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
		resolvePort:     func(string) (string, error) { return "/dev/cu.usbmodem-test", nil },
		order:           []string{"codex", "claude"},
		interval:        30 * time.Second,
		timeout:         3 * time.Second,
		snapshotMaxAge:  2 * time.Hour,
		persistInterval: time.Minute,
		providers:       make(map[string]providerSnapshot),
	}

	collector.fetchProviders = func(_ context.Context) ([]codexbar.ParsedFrame, error) {
		return []codexbar.ParsedFrame{
			testParsedFrame("codex", 14, 22, 3600),
		}, nil
	}
	collector.collectOnce(context.Background())

	initial := collector.providerFrames(current)
	if len(initial) != 1 || initial[0].Provider != "codex" {
		t.Fatalf("expected only codex snapshot after first collect, got %#v", initial)
	}

	current = current.Add(40 * time.Second)
	collector.fetchProviders = func(_ context.Context) ([]codexbar.ParsedFrame, error) {
		return []codexbar.ParsedFrame{
			testParsedFrame("claude", 28, 35, 7200),
		}, nil
	}
	collector.collectOnce(context.Background())

	second := collector.providerFrames(current)
	if len(second) != 2 {
		t.Fatalf("expected codex stale + claude fresh snapshots, got %#v", second)
	}
	if second[0].Provider != "codex" || second[1].Provider != "claude" {
		t.Fatalf("expected provider order codex,claude; got %#v", second)
	}
	if !second[0].Stale || second[1].Stale {
		t.Fatalf("expected codex stale and claude fresh snapshots, got %#v", second)
	}

	current = current.Add(3 * time.Hour)
	expired := collector.providerFrames(current)
	if len(expired) != 0 {
		t.Fatalf("expected snapshots to expire by max age, got %#v", expired)
	}
}

func TestProviderCollectorCollectOnceSkipsFetchWithoutDevice(t *testing.T) {
	prepareFastTestEnv(t)

	var fetchCalled bool
	var logged string
	collector := &providerCollector{
		now:             func() time.Time { return time.Date(2026, 2, 23, 12, 0, 0, 0, time.UTC) },
		logf:            func(format string, args ...any) { logged = logged + strings.TrimSpace(format) },
		resolvePort:     func(string) (string, error) { return "", errors.New("no usb serial ports found") },
		order:           []string{"codex"},
		interval:        30 * time.Second,
		timeout:         3 * time.Second,
		snapshotMaxAge:  2 * time.Hour,
		persistInterval: time.Minute,
		providers:       make(map[string]providerSnapshot),
		fetchProviders: func(_ context.Context) ([]codexbar.ParsedFrame, error) {
			fetchCalled = true
			return []codexbar.ParsedFrame{testParsedFrame("codex", 14, 22, 3600)}, nil
		},
	}

	collector.collectOnce(context.Background())

	if fetchCalled {
		t.Fatalf("expected collector to skip fetchProviders when no device is available")
	}
	if !strings.Contains(logged, "collector paused reason=no-device") {
		t.Fatalf("expected no-device pause log, got %q", logged)
	}
}

func TestProviderCollectorUsesWiFiTarget(t *testing.T) {
	prepareFastTestEnv(t)

	const target = "http://192.168.178.65"
	var resolved string
	deps := runtimeDeps{
		now:  func() time.Time { return time.Date(2026, 2, 23, 12, 0, 0, 0, time.UTC) },
		logf: func(string, ...any) {},
		resolvePort: func(requested string) (string, error) {
			resolved = requested
			return requested, nil
		},
		fetchProviders: func(_ context.Context) ([]codexbar.ParsedFrame, error) {
			return []codexbar.ParsedFrame{testParsedFrame("codex", 14, 22, 3600)}, nil
		},
	}
	collector := newProviderCollector(deps, Options{
		Transport: "wifi",
		Target:    target,
		Interval:  60 * time.Second,
	})
	collector.collectOnce(context.Background())

	if resolved != target {
		t.Fatalf("expected collector to resolve wifi target %q, got %q", target, resolved)
	}
	if got := collector.providerFrames(deps.now()); len(got) != 1 {
		t.Fatalf("expected collector to fetch providers, got %#v", got)
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

func TestRunCycleFromCollectorUsesDirectProviderFallbackWhenCollectorEmpty(t *testing.T) {
	prepareFastTestEnv(t)

	now := time.Date(2026, 2, 23, 12, 0, 0, 0, time.UTC)
	state := &runtimeState{
		selector: codexbar.NewProviderSelector(),
	}

	collector := &providerCollector{
		now:            func() time.Time { return now },
		logf:           func(string, ...any) {},
		order:          []string{"codex", "claude", "cursor"},
		snapshotMaxAge: 2 * time.Hour,
		providers:      map[string]providerSnapshot{},
	}

	var sentLine []byte
	err := runCycleFromCollector(context.Background(), "", state, collector, runtimeDeps{
		now:         func() time.Time { return now },
		resolvePort: func(string) (string, error) { return "/dev/cu.usbmodem-test", nil },
		fetchProvider: func(_ context.Context, provider string) (codexbar.ParsedFrame, error) {
			switch provider {
			case "codex":
				return testParsedFrame("codex", 12, 34, 3600), nil
			default:
				return codexbar.ParsedFrame{}, codexbar.ErrNoProviders
			}
		},
		sendLine: func(_ string, line []byte) error {
			sentLine = append([]byte(nil), line...)
			return nil
		},
		logf: func(string, ...any) {},
	})
	if err != nil {
		t.Fatalf("expected direct provider fallback success, got %v", err)
	}

	frame := decodeFrameLine(t, sentLine)
	if frame.Provider != "codex" || frame.Session != 12 || frame.Weekly != 34 {
		t.Fatalf("expected direct fallback codex frame, got %+v", frame)
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

func TestRunCycleWithTimeoutReturnsRuntimeCycleTimeout(t *testing.T) {
	prepareFastTestEnv(t)

	block := make(chan struct{})
	err := runCycleWithTimeout(context.Background(), 10*time.Millisecond, func(context.Context) error {
		<-block
		return nil
	})
	close(block)

	if err == nil {
		t.Fatalf("expected timeout error")
	}
	runtimeErr := asRuntimeError(err)
	if runtimeErr.Kind != runtimeErrorCycleTimeout {
		t.Fatalf("expected runtime cycle timeout, got %s", runtimeErr.Kind)
	}
}

func TestCycleRunTimeoutHonorsBounds(t *testing.T) {
	prepareFastTestEnv(t)

	t.Setenv(cycleTimeoutEnvVar, "999")
	if got := cycleRunTimeout(); got != 600*time.Second {
		t.Fatalf("expected max clamp, got %s", got)
	}

	t.Setenv(cycleTimeoutEnvVar, "1")
	if got := cycleRunTimeout(); got != 5*time.Second {
		t.Fatalf("expected min clamp, got %s", got)
	}
}

func TestCycleRunTimeoutDefault(t *testing.T) {
	prepareFastTestEnv(t)

	if got := cycleRunTimeout(); got != defaultCycleTimeout {
		t.Fatalf("expected default cycle timeout %s, got %s", defaultCycleTimeout, got)
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

func containsString(values []string, needle string) bool {
	for _, value := range values {
		if value == needle {
			return true
		}
	}
	return false
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
