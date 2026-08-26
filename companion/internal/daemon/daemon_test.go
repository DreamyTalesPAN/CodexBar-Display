package daemon

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/errcode"
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

func TestConfiguredConnectionModePrefersRuntimeConfig(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	if err := runtimeconfig.Save(home, runtimeconfig.Config{ConnectionMode: "cable"}); err != nil {
		t.Fatalf("save runtime config: %v", err)
	}
	if got := configuredConnectionMode("wifi"); got != "usb" {
		t.Fatalf("runtime config must own connection mode, got %q", got)
	}
}

func TestConfiguredConnectionModePreservesLegacyWiFiConfig(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	if err := runtimeconfig.Save(home, runtimeconfig.Config{
		DeviceTarget: "http://192.168.178.72",
		DeviceToken:  "pair-token",
		DeviceID:     "legacy-vibetv",
	}); err != nil {
		t.Fatalf("save legacy runtime config: %v", err)
	}
	if got := configuredConnectionMode("usb"); got != "wifi" {
		t.Fatalf("legacy WiFi target must override the new Cable fallback, got %q", got)
	}
}

func TestResolveCycleDevicePersistsFreshCableIdentity(t *testing.T) {
	cfg := runtimeconfig.Config{}
	port, _, _, err := resolveCycleDevice("", nil, runtimeDeps{
		transportName: "usb",
		homeDir:       func() (string, error) { return "/test-home", nil },
		loadConfig:    func(string) (runtimeconfig.Config, error) { return cfg, nil },
		saveConfig: func(_ string, next runtimeconfig.Config) error {
			cfg = next
			return nil
		},
		resolveUSBDevice: func(requested, expectedDeviceID string) (string, error) {
			if requested != "" || expectedDeviceID != "" {
				t.Fatalf("fresh Cable resolution received requested=%q expectedDeviceID=%q", requested, expectedDeviceID)
			}
			return "/dev/cu.usbserial-vibetv", nil
		},
		deviceCaps: func(string) (protocol.DeviceCapabilities, error) {
			return protocol.DeviceCapabilities{
				Known:                      true,
				DeviceID:                   "fresh-vibetv",
				ConnectionMode:             "cable",
				ActiveTransport:            "usb",
				SupportedTransportChannels: []string{"usb", "wifi"},
				MaxFrameBytes:              2048,
				ProtocolVersion:            protocol.ProtocolVersionV2,
				NegotiatedProtocolVersion:  protocol.ProtocolVersionV2,
			}, nil
		},
		logf: func(string, ...any) {},
	})
	if err != nil {
		t.Fatalf("resolve fresh Cable device: %v", err)
	}
	if port != "/dev/cu.usbserial-vibetv" || cfg.ConnectionMode != "cable" || cfg.DeviceID != "fresh-vibetv" {
		t.Fatalf("fresh Cable identity was not persisted: port=%q cfg=%+v", port, cfg)
	}
	if !cfg.ConnectionModeChoiceRequired {
		t.Fatal("fresh Cable auto-binding must preserve the connection chooser")
	}
	if len(cfg.DeviceTransports) != 2 || cfg.DeviceTransports[1] != "wifi" {
		t.Fatalf("fresh Cable capabilities were not persisted: %+v", cfg.DeviceTransports)
	}
}

func TestResolveCycleDeviceDoesNotRebindCableAfterSetupReset(t *testing.T) {
	cfg := runtimeconfig.Config{
		ConnectionMode:        "cable",
		CableAutoBindDisabled: true,
	}
	saveCalls := 0
	_, _, _, err := resolveCycleDevice("", nil, runtimeDeps{
		transportName: "usb",
		homeDir:       func() (string, error) { return "/test-home", nil },
		loadConfig:    func(string) (runtimeconfig.Config, error) { return cfg, nil },
		saveConfig: func(_ string, next runtimeconfig.Config) error {
			saveCalls++
			cfg = next
			return nil
		},
		resolveUSBDevice: func(string, string) (string, error) {
			return "/dev/cu.usbserial-vibetv", nil
		},
		deviceCaps: func(string) (protocol.DeviceCapabilities, error) {
			return protocol.DeviceCapabilities{
				Known:           true,
				DeviceID:        "previous-vibetv",
				ConnectionMode:  "cable",
				ActiveTransport: "usb",
			}, nil
		},
		logf: func(string, ...any) {},
	})
	if err != nil {
		t.Fatalf("resolve Cable device after reset: %v", err)
	}
	if saveCalls != 0 || cfg.DeviceID != "" {
		t.Fatalf("reset Cable binding was restored: saveCalls=%d cfg=%+v", saveCalls, cfg)
	}
}

func TestResolveCycleDeviceReconcilesWiFiRollbackToCable(t *testing.T) {
	cfg := runtimeconfig.Config{
		CableAutoBindDisabled:        true,
		ConnectionModeChoiceRequired: false,
		DeviceID:                     "returning-vibetv",
		DeviceTarget:                 "http://192.168.178.72",
		DeviceToken:                  "pair-token",
	}
	_, _, _, err := resolveCycleDevice("", nil, runtimeDeps{
		transportName: "usb",
		homeDir:       func() (string, error) { return "/test-home", nil },
		loadConfig:    func(string) (runtimeconfig.Config, error) { return cfg, nil },
		saveConfig: func(_ string, next runtimeconfig.Config) error {
			cfg = next
			return nil
		},
		resolveUSBDevice: func(string, string) (string, error) {
			return "/dev/cu.usbserial-vibetv", nil
		},
		deviceCaps: func(string) (protocol.DeviceCapabilities, error) {
			return protocol.DeviceCapabilities{
				Known:                      true,
				DeviceID:                   "returning-vibetv",
				ConnectionMode:             "cable",
				ActiveTransport:            "usb",
				SupportedTransportChannels: []string{"usb", "wifi"},
			}, nil
		},
		logf: func(string, ...any) {},
	})
	if err != nil {
		t.Fatalf("resolve rolled-back Cable device: %v", err)
	}
	if cfg.ConnectionMode != "cable" || cfg.CableAutoBindDisabled || !cfg.ConnectionModeChoiceRequired {
		t.Fatalf("WiFi rollback was not reconciled to an explicit Cable choice: %+v", cfg)
	}
	if cfg.DeviceTarget != "http://192.168.178.72" || cfg.DeviceToken != "pair-token" {
		t.Fatalf("WiFi rollback discarded the saved pairing: %+v", cfg)
	}
}

func TestConnectionModeChangeStopsCurrentTransportCycle(t *testing.T) {
	err := runCycleWithDeps(context.Background(), "", nil, runtimeDeps{
		transportName: "usb",
		homeDir:       func() (string, error) { return "/test-home", nil },
		loadConfig: func(string) (runtimeconfig.Config, error) {
			return runtimeconfig.Config{ConnectionMode: "wifi"}, nil
		},
	})
	if !errors.Is(err, ErrConnectionModeChanged) {
		t.Fatalf("expected current Cable cycle to stop for WiFi mode, got %v", err)
	}
}

func TestRunCycleCoordinatesOnlyTheDeviceWrite(t *testing.T) {
	prepareFastTestEnv(t)

	now := time.Date(2026, 7, 28, 12, 0, 0, 0, time.UTC)
	state := &runtimeState{selector: codexbar.NewProviderSelector()}
	preparationFinished := false
	writeLocked := false
	released := false

	err := runCycleWithDeps(context.Background(), "", state, runtimeDeps{
		now:         func() time.Time { return now },
		resolvePort: func(string) (string, error) { return "/dev/cu.usbmodem-test", nil },
		fetchProviders: func(context.Context) ([]codexbar.ParsedFrame, error) {
			preparationFinished = true
			if writeLocked {
				t.Fatal("device write lock must not cover provider preparation")
			}
			return []codexbar.ParsedFrame{testParsedFrame("claude", 12, 34, 3600)}, nil
		},
		beginDeviceWrite: func() func() {
			if !preparationFinished {
				t.Fatal("device write lock started before frame preparation completed")
			}
			writeLocked = true
			return func() {
				writeLocked = false
				released = true
			}
		},
		sendLine: func(string, []byte) error {
			if !writeLocked {
				t.Fatal("device frame was sent outside the write lock")
			}
			return nil
		},
		logf: func(string, ...any) {},
	})
	if err != nil {
		t.Fatalf("run cycle: %v", err)
	}
	if writeLocked || !released {
		t.Fatalf("device write lock was not released: locked=%t released=%t", writeLocked, released)
	}
}

func TestRunCycleWithDepsWaitsForFirstAvailableUsageFrame(t *testing.T) {
	prepareFastTestEnv(t)
	t.Setenv("CODEXBAR_DISPLAY_LAST_GOOD_MAX_AGE", "168h")

	now := time.Date(2026, 7, 27, 12, 0, 0, 0, time.UTC)
	state := &runtimeState{
		selector: codexbar.NewProviderSelector(),
	}
	var sentLines [][]byte
	var logged strings.Builder
	unavailable := testParsedFrame("claude", 0, 0, 0)
	unavailable.Frame.UsageUnavailable = true
	providers := []codexbar.ParsedFrame{unavailable}
	deps := runtimeDeps{
		now:         func() time.Time { return now },
		resolvePort: func(string) (string, error) { return "/dev/cu.usbmodem-test", nil },
		fetchProviders: func(context.Context) ([]codexbar.ParsedFrame, error) {
			return providers, nil
		},
		logf: func(format string, args ...any) {
			logged.WriteString(fmt.Sprintf(format, args...))
		},
		sendLine: func(port string, line []byte) error {
			sentLines = append(sentLines, append([]byte(nil), line...))
			return nil
		},
	}

	// Before the first usage ever arrives, providers-without-usage is the
	// provider-setup state: the cycle must fail as runtime/no-providers so the
	// device receives the honest error frame and the display-stream parser
	// reports provider_setup_required instead of an unexplained silent wait.
	err := runCycleWithDeps(context.Background(), "", state, deps)
	if err == nil || !strings.Contains(err.Error(), "no-providers") {
		t.Fatalf("expected the never-had-usage cycle to fail as no-providers, got %v", err)
	}
	if len(sentLines) != 1 {
		t.Fatalf("expected the honest error frame before first usage, got %d frames", len(sentLines))
	}
	if errorFrame := decodeFrameLine(t, sentLines[0]); errorFrame.Error == "" {
		t.Fatalf("expected an error frame before first usage, got %+v", errorFrame)
	}

	// A rate-limited selection is a configured, live provider in a temporary
	// condition: it must keep its unavailable semantics and wait silently
	// instead of being reclassified as no-providers.
	rateLimited := unavailable
	rateLimited.RateLimited = true
	providers = []codexbar.ParsedFrame{rateLimited}
	if err := runCycleWithDeps(context.Background(), "", state, deps); err != nil {
		t.Fatalf("expected the rate-limited cold start to keep waiting, got %v", err)
	}
	if len(sentLines) != 1 {
		t.Fatalf("expected no extra frame for the rate-limited wait, got %d", len(sentLines))
	}
	if !strings.Contains(logged.String(), "event=usage-waiting") {
		t.Fatalf("expected the rate-limited wait to log usage-waiting, got %q", logged.String())
	}

	providers = []codexbar.ParsedFrame{testParsedFrame("claude", 0, 11, 3600)}
	if err := runCycleWithDeps(context.Background(), "", state, deps); err != nil {
		t.Fatalf("expected first available usage frame to send, got %v", err)
	}
	if len(sentLines) != 2 {
		t.Fatalf("expected the complete frame after the error frame, got %d", len(sentLines))
	}
	frame := decodeFrameLine(t, sentLines[1])
	if frame.Provider != "claude" || frame.Weekly != 11 || frame.UsageUnavailable {
		t.Fatalf("expected complete Claude usage frame, got %+v", frame)
	}

	providers = []codexbar.ParsedFrame{unavailable}
	if err := runCycleWithDeps(context.Background(), "", state, deps); err != nil {
		t.Fatalf("expected later unavailable usage to keep the valid frame, got %v", err)
	}
	if len(sentLines) != 2 {
		t.Fatalf("expected unavailable usage to preserve the valid frame, got %d sends", len(sentLines))
	}

	now = now.Add(providerSnapshotMaxAge() + time.Second)
	deps.usageBarsShowUsed = func() bool { return false }
	if err := runCycleWithDeps(context.Background(), "", state, deps); err != nil {
		t.Fatalf("expected expired usage to send unavailable state, got %v", err)
	}
	if len(sentLines) != 3 {
		t.Fatalf("expected unavailable state after last-good expiry, got %d sends", len(sentLines))
	}
	frame = decodeFrameLine(t, sentLines[2])
	if frame.Provider != "claude" || !frame.UsageUnavailable || frame.Session != 0 || frame.Weekly != 0 || frame.UsageMode != "remaining" {
		t.Fatalf("expected expired Claude usage to become unavailable, got %+v", frame)
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

func TestProviderSnapshotMaxAgeDoesNotInheritDeviceFrameRetention(t *testing.T) {
	t.Setenv("CODEXBAR_DISPLAY_LAST_GOOD_MAX_AGE", "168h")
	t.Setenv(providerMaxAgeEnvVar, "")

	if got := providerSnapshotMaxAge(); got != defaultProviderMaxAge {
		t.Fatalf("provider freshness inherited device-frame retention: got=%s want=%s", got, defaultProviderMaxAge)
	}

	t.Setenv(providerMaxAgeEnvVar, "20m")
	if got := providerSnapshotMaxAge(); got != 20*time.Minute {
		t.Fatalf("provider-specific freshness override was ignored: got=%s want=20m", got)
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
		homeDir:       func() (string, error) { return "/tmp/codexbar-display-test", nil },
		loadConfig: func(string) (runtimeconfig.Config, error) {
			return runtimeconfig.Config{DeviceToken: "pair-token"}, nil
		},
		resolvePort: func(string) (string, error) { return "http://192.168.178.65", nil },
		deviceCaps: func(string) (protocol.DeviceCapabilities, error) {
			return protocol.DeviceCapabilities{
				Known:                     true,
				NegotiatedProtocolVersion: protocol.ProtocolVersionV2,
				MaxFrameBytes:             2048,
			}, nil
		},
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

func TestRunCycleWithDepsRequiresKnownWiFiHelloBeforeSend(t *testing.T) {
	prepareFastTestEnv(t)

	knownCaps := protocol.DeviceCapabilities{
		Known:                     true,
		NegotiatedProtocolVersion: protocol.ProtocolVersionV2,
		MaxFrameBytes:             2048,
	}
	tests := []struct {
		name        string
		deviceCaps  func(string) (protocol.DeviceCapabilities, error)
		wantError   bool
		wantSent    int
		wantFetched int
	}{
		{
			name: "capabilities failure does not send",
			deviceCaps: func(string) (protocol.DeviceCapabilities, error) {
				return protocol.DeviceCapabilities{}, errors.New("hello connection refused")
			},
			wantError: true,
		},
		{
			name: "unknown capabilities do not send",
			deviceCaps: func(string) (protocol.DeviceCapabilities, error) {
				return protocol.UnknownDeviceCapabilities(), nil
			},
			wantError: true,
		},
		{
			name: "known capabilities send",
			deviceCaps: func(string) (protocol.DeviceCapabilities, error) {
				return knownCaps, nil
			},
			wantSent:    1,
			wantFetched: 1,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			state := &runtimeState{selector: codexbar.NewProviderSelector()}
			var sent, fetched int
			err := runCycleWithDeps(context.Background(), "http://192.168.178.72", state, runtimeDeps{
				transportName: "wifi",
				homeDir:       func() (string, error) { return "/tmp/codexbar-display-test", nil },
				loadConfig: func(string) (runtimeconfig.Config, error) {
					return runtimeconfig.Config{DeviceToken: "pair-token"}, nil
				},
				resolvePort: func(target string) (string, error) {
					return target, nil
				},
				deviceCaps: tt.deviceCaps,
				discoverWiFi: func([]string) (transportlayer.WiFiDiscoveryResult, error) {
					return transportlayer.WiFiDiscoveryResult{}, errors.New("no alternate VibeTV found")
				},
				fetchProviders: func(context.Context) ([]codexbar.ParsedFrame, error) {
					fetched++
					return []codexbar.ParsedFrame{testParsedFrame("codex", 12, 30, 3600)}, nil
				},
				logf: func(string, ...any) {},
				sendLine: func(string, []byte) error {
					sent++
					return nil
				},
			})

			if tt.wantError {
				if err == nil {
					t.Fatal("expected Wi-Fi hello error")
				}
				runtimeErr := asRuntimeError(err)
				if runtimeErr.Kind != runtimeErrorDeviceHello || runtimeErr.Op != "read-device-hello" {
					t.Fatalf("unexpected runtime error: %+v", runtimeErr)
				}
				if !strings.Contains(runtimeErr.RecoveryAction(), "retry /hello with backoff") {
					t.Fatalf("expected actionable retry recovery, got %q", runtimeErr.RecoveryAction())
				}
			} else if err != nil {
				t.Fatalf("expected cycle success, got %v", err)
			}
			if sent != tt.wantSent {
				t.Fatalf("sent %d frames, expected %d", sent, tt.wantSent)
			}
			if fetched != tt.wantFetched {
				t.Fatalf("fetched providers %d times, expected %d", fetched, tt.wantFetched)
			}
		})
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

	err := runCycleWithDeps(context.Background(), "http://192.0.2.10", state, runtimeDeps{
		now:           func() time.Time { return now },
		transportName: "wifi",
		homeDir:       func() (string, error) { return "/tmp/codexbar-display-test", nil },
		loadConfig: func(string) (runtimeconfig.Config, error) {
			return runtimeconfig.Config{
				DeviceTarget: "http://192.168.178.159",
				DeviceToken:  "pair-token",
			}, nil
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
	if resolvedTarget != "http://192.168.178.159" || sentTarget != "http://192.168.178.159?token=pair-token" {
		t.Fatalf("expected runtime-config target to win, resolved=%q sent=%q", resolvedTarget, sentTarget)
	}
}

func TestEffectiveCycleTargetUsesRuntimeConfigOverInMemoryTarget(t *testing.T) {
	state := &runtimeState{deviceTarget: "http://192.168.178.10"}
	got := effectiveCycleTarget("http://192.0.2.10", state, runtimeDeps{
		transportName: "wifi",
		homeDir:       func() (string, error) { return "/tmp/codexbar-display-test", nil },
		loadConfig: func(string) (runtimeconfig.Config, error) {
			return runtimeconfig.Config{DeviceTarget: "http://192.168.178.99"}, nil
		},
	})
	if got != "http://192.168.178.99" {
		t.Fatalf("expected runtime config target to win, got %q", got)
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

func TestUsageSlotsLogValueRoundTripsThroughQueryEncoding(t *testing.T) {
	slots := []protocol.UsageSlot{
		{ID: "secondary", Label: "Weekly", Percent: 75, ResetSec: 490812},
		{ID: "codex-spark-weekly", Label: "Codex Spark Weekly", Percent: 0, ResetSec: 604794},
	}
	encoded := usageSlotsLogValue(slots)
	if encoded == "" || strings.Contains(encoded, " ") {
		t.Fatalf("expected compact encoded usage slots, got %q", encoded)
	}
	raw, err := url.QueryUnescape(encoded)
	if err != nil {
		t.Fatalf("decode usage slots log value: %v", err)
	}
	var got []protocol.UsageSlot
	if err := json.Unmarshal([]byte(raw), &got); err != nil {
		t.Fatalf("parse usage slots log value: %v", err)
	}
	if !reflect.DeepEqual(got, slots) {
		t.Fatalf("usage slots mismatch: got=%+v want=%+v", got, slots)
	}
}

func TestRunCycleWithDepsDoesNotSendWiFiFrameWithoutPairingToken(t *testing.T) {
	prepareFastTestEnv(t)

	state := &runtimeState{selector: codexbar.NewProviderSelector()}
	var sent int
	err := runCycleWithDeps(context.Background(), "http://192.168.178.159", state, runtimeDeps{
		transportName: "wifi",
		homeDir:       func() (string, error) { return "/tmp/codexbar-display-test", nil },
		loadConfig: func(string) (runtimeconfig.Config, error) {
			return runtimeconfig.Config{DeviceTarget: "http://192.168.178.159"}, nil
		},
		resolvePort: func(target string) (string, error) { return target, nil },
		deviceCaps: func(string) (protocol.DeviceCapabilities, error) {
			return protocol.DeviceCapabilities{
				Known:                     true,
				NegotiatedProtocolVersion: protocol.ProtocolVersionV2,
				MaxFrameBytes:             2048,
			}, nil
		},
		fetchProviders: func(context.Context) ([]codexbar.ParsedFrame, error) {
			return []codexbar.ParsedFrame{testParsedFrame("codex", 12, 30, 3600)}, nil
		},
		logf: func(string, ...any) {},
		sendLine: func(string, []byte) error {
			sent++
			return nil
		},
	})
	if err == nil {
		t.Fatal("expected missing pairing token to block WiFi frame")
	}
	if got := errcode.Of(err); got != errcode.RuntimePairingRequired {
		t.Fatalf("error code=%q want %q: %v", got, errcode.RuntimePairingRequired, err)
	}
	if sent != 0 {
		t.Fatalf("sent %d WiFi frames without a pairing token", sent)
	}
}

func TestRunCycleWithDepsDoesNotSendWiFiFrameWhenRuntimeConfigFails(t *testing.T) {
	prepareFastTestEnv(t)

	state := &runtimeState{selector: codexbar.NewProviderSelector()}
	var sent int
	err := runCycleWithDeps(context.Background(), "http://192.168.178.159", state, runtimeDeps{
		transportName: "wifi",
		homeDir:       func() (string, error) { return "/tmp/codexbar-display-test", nil },
		loadConfig: func(string) (runtimeconfig.Config, error) {
			return runtimeconfig.Config{}, errors.New("config unreadable")
		},
		resolvePort: func(target string) (string, error) { return target, nil },
		deviceCaps: func(string) (protocol.DeviceCapabilities, error) {
			return protocol.DeviceCapabilities{
				Known:                     true,
				NegotiatedProtocolVersion: protocol.ProtocolVersionV2,
				MaxFrameBytes:             2048,
			}, nil
		},
		fetchProviders: func(context.Context) ([]codexbar.ParsedFrame, error) {
			return []codexbar.ParsedFrame{testParsedFrame("codex", 12, 30, 3600)}, nil
		},
		logf: func(string, ...any) {},
		sendLine: func(string, []byte) error {
			sent++
			return nil
		},
	})
	if err == nil || errcode.Of(err) != errcode.RuntimePairingRequired {
		t.Fatalf("expected pairing-required config error, got %v", err)
	}
	if sent != 0 {
		t.Fatalf("sent %d WiFi frames with unavailable runtime config", sent)
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

func TestRunCycleWithDepsDoesNotRotateStaleDeviceTokenOnUnauthorizedSend(t *testing.T) {
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
	if err == nil {
		t.Fatal("expected unauthorized send to stay failed until explicit repair")
	}
	wantTargets := []string{
		"http://192.168.178.159?token=old-token",
	}
	if !reflect.DeepEqual(sentTargets, wantTargets) {
		t.Fatalf("unexpected send targets: got %#v want %#v", sentTargets, wantTargets)
	}
	if cfg.DeviceTarget != "http://192.168.178.159" || cfg.DeviceToken != "old-token" {
		t.Fatalf("expected background runtime to preserve the existing token, got %+v", cfg)
	}
	log := logged.String()
	if strings.Contains(log, "device-token-repair") {
		t.Fatalf("background runtime must not rotate pairing tokens, got %q", log)
	}
	if strings.Contains(log, "old-token") {
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
	if frame.NextClockTransition == nil ||
		frame.NextClockTransition.CurrentOffsetMinutes != 0 ||
		frame.NextClockTransition.TransitionEpoch != 0 {
		t.Fatalf("expected UTC clock schedule, got %+v", frame.NextClockTransition)
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

	current := time.Date(2026, 2, 23, 12, 0, 0, 0, time.UTC)
	collectedAt := current.Add(-time.Minute)
	state := &runtimeState{
		selector: codexbar.NewProviderSelector(),
	}

	var sentLines [][]byte
	providers := []codexbar.ParsedFrame{testParsedFrame("codex", 1, 28, 3600)}
	providers[0].CollectedAt = collectedAt
	providers[0].Frame.UsageMode = "used"
	deps := runtimeDeps{
		now:               func() time.Time { return current },
		resolvePort:       func(string) (string, error) { return "/dev/cu.usbmodem-test", nil },
		usageBarsShowUsed: func() bool { return false },
		fetchProviders: func(context.Context) ([]codexbar.ParsedFrame, error) {
			return providers, nil
		},
		logf: func(string, ...any) {},
		sendLine: func(port string, line []byte) error {
			sentLines = append(sentLines, append([]byte(nil), line...))
			return nil
		},
	}
	if err := runCycleWithDeps(context.Background(), "", state, deps); err != nil {
		t.Fatalf("expected cycle success, got %v", err)
	}

	frame := decodeFrameLine(t, sentLines[0])
	if frame.Session != 99 || frame.Weekly != 72 {
		t.Fatalf("expected remaining view inversion, got session=%d weekly=%d", frame.Session, frame.Weekly)
	}
	if frame.UsageMode != "remaining" {
		t.Fatalf("expected remaining usage mode, got %q", frame.UsageMode)
	}
	if state.lastGood.Session != 1 || state.lastGood.Weekly != 28 || state.lastGood.UsageMode != "used" || !state.lastGoodAt.Equal(collectedAt) {
		t.Fatalf("last-good did not retain collector-space values and collection time: frame=%+v at=%s", state.lastGood, state.lastGoodAt)
	}

	current = current.Add(time.Minute)
	deps.fetchProviders = func(context.Context) ([]codexbar.ParsedFrame, error) {
		return nil, &codexbar.FetchError{Kind: codexbar.FetchErrorCommand, Err: errors.New("temporary failure")}
	}
	if err := runCycleWithDeps(context.Background(), "", state, deps); err != nil {
		t.Fatalf("expected last-good fallback, got %v", err)
	}
	stale := decodeFrameLine(t, sentLines[1])
	if stale.Session != 99 || stale.Weekly != 72 || stale.UsageMode != "remaining" {
		t.Fatalf("last-good fallback applied remaining conversion twice: %+v", stale)
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

func TestRunCycleWithDepsDoesNotPersistLastGoodWhenInitialSendFails(t *testing.T) {
	prepareFastTestEnv(t)

	now := time.Date(2026, 7, 29, 21, 22, 11, 0, time.UTC)
	state := &runtimeState{
		selector: codexbar.NewProviderSelector(),
	}

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
		sendLine: func(string, []byte) error {
			return errors.New("device send timed out")
		},
	})
	if err == nil {
		t.Fatalf("expected failed device send")
	}
	if state.hasLastGood {
		t.Fatalf("failed initial send must not create in-memory last-good frame: %+v", state.lastGood)
	}
	if _, _, ok := loadPersistedLastGoodAnyAge(); ok {
		t.Fatalf("failed initial send must not persist a last-good frame")
	}
}

func TestRunCycleWithDepsFailedSendDoesNotOverwriteLastGood(t *testing.T) {
	prepareFastTestEnv(t)

	now := time.Date(2026, 7, 29, 21, 22, 11, 0, time.UTC)
	current := now
	state := &runtimeState{
		selector: codexbar.NewProviderSelector(),
	}
	providers := []codexbar.ParsedFrame{
		testParsedFrame("codex", 12, 30, 3600),
	}
	failSend := false

	deps := runtimeDeps{
		now:         func() time.Time { return current },
		resolvePort: func(string) (string, error) { return "/dev/cu.usbmodem-test", nil },
		deviceCaps: func(string) (protocol.DeviceCapabilities, error) {
			return protocol.UnknownDeviceCapabilities(), nil
		},
		fetchProviders: func(context.Context) ([]codexbar.ParsedFrame, error) {
			return providers, nil
		},
		logf: func(string, ...any) {},
		sendLine: func(string, []byte) error {
			if failSend {
				return errors.New("device send timed out")
			}
			return nil
		},
	}

	if err := runCycleWithDeps(context.Background(), "", state, deps); err != nil {
		t.Fatalf("expected first send to succeed, got %v", err)
	}
	persisted, savedAt, ok := loadPersistedLastGoodAnyAge()
	if !ok {
		t.Fatalf("expected successful send to persist last-good frame")
	}
	if persisted.Provider != "codex" || !savedAt.Equal(now) {
		t.Fatalf("unexpected initial last-good frame: frame=%+v savedAt=%s", persisted, savedAt)
	}

	current = current.Add(lastGoodPersistInterval + time.Second)
	providers = []codexbar.ParsedFrame{
		testParsedFrame("claude", 70, 80, 7200),
	}
	failSend = true
	if err := runCycleWithDeps(context.Background(), "", state, deps); err == nil {
		t.Fatalf("expected second send to fail")
	}

	persisted, savedAt, ok = loadPersistedLastGoodAnyAge()
	if !ok {
		t.Fatalf("expected previous last-good frame to remain persisted")
	}
	if persisted.Provider != "codex" || persisted.Session != 12 || !savedAt.Equal(now) {
		t.Fatalf("failed send overwrote persisted last-good: frame=%+v savedAt=%s", persisted, savedAt)
	}
	if !state.hasLastGood || state.lastGood.Provider != "codex" || state.lastGood.Session != 12 {
		t.Fatalf("failed send overwrote in-memory last-good: %+v", state.lastGood)
	}
}

func TestTimedOutCycleDoesNotPersistAfterLateSuccessfulSend(t *testing.T) {
	prepareFastTestEnv(t)

	oldTarget := "http://192.168.178.20"
	newTarget := "http://192.168.178.99"
	oldAt := time.Date(2026, 7, 29, 21, 22, 11, 0, time.UTC)
	newAt := oldAt.Add(2 * time.Second)
	current := oldAt
	state := &runtimeState{selector: codexbar.NewProviderSelector()}
	cfg := runtimeconfig.Config{
		DeviceID:     "vibetv-test-device",
		DeviceTarget: oldTarget,
		DeviceToken:  "pair-token",
	}
	sendStarted := make(chan struct{})
	releaseSend := make(chan struct{})
	cycleFinished := make(chan error, 1)
	timeoutResult := make(chan error, 1)
	saveConfigCalls := 0

	go func() {
		timeoutResult <- runCycleWithTimeout(context.Background(), 100*time.Millisecond, func(ctx context.Context) error {
			err := runCycleWithDeps(ctx, oldTarget, state, runtimeDeps{
				now:           func() time.Time { return current },
				transportName: "wifi",
				homeDir:       func() (string, error) { return "/tmp/codexbar-display-test", nil },
				loadConfig: func(string) (runtimeconfig.Config, error) {
					return cfg, nil
				},
				saveConfig: func(_ string, saved runtimeconfig.Config) error {
					saveConfigCalls++
					cfg = saved
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
					return []codexbar.ParsedFrame{testParsedFrame("codex", 12, 30, 3600)}, nil
				},
				logf: func(string, ...any) {},
				sendLine: func(string, []byte) error {
					close(sendStarted)
					<-releaseSend
					return nil
				},
			})
			cycleFinished <- err
			return err
		})
	}()

	select {
	case <-sendStarted:
	case <-time.After(time.Second):
		t.Fatalf("old cycle did not reach sendLine")
	}
	select {
	case err := <-timeoutResult:
		if err == nil {
			t.Fatalf("expected old cycle to time out")
		}
		if runtimeErr := asRuntimeError(err); runtimeErr.Kind != runtimeErrorCycleTimeout {
			t.Fatalf("expected runtime cycle timeout, got %s", runtimeErr.Kind)
		}
	case <-time.After(time.Second):
		t.Fatalf("old cycle did not time out while sendLine was blocked")
	}

	newFrame := protocol.Frame{
		Provider: "claude",
		Label:    "Claude",
		Session:  70,
		Weekly:   80,
		ResetSec: 7200,
	}.Normalize()
	current = newAt
	state.lastGood = newFrame
	state.lastGoodAt = newAt
	state.hasLastGood = true
	state.lastPersistedGood = newFrame
	state.lastPersistedAt = newAt
	state.hasPersistedGood = true
	if err := persistLastGood(newFrame, newAt); err != nil {
		t.Fatalf("persist newer last-good frame: %v", err)
	}
	cfg.DeviceTarget = newTarget

	close(releaseSend)
	select {
	case err := <-cycleFinished:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("expected timed-out cycle to finish as canceled, got %v", err)
		}
	case <-time.After(time.Second):
		t.Fatalf("timed-out cycle did not finish after releasing sendLine")
	}

	if state.lastGood.Provider != "claude" || state.lastGood.Session != 70 || !state.lastGoodAt.Equal(newAt) {
		t.Fatalf("timed-out old cycle overwrote runtime last-good: %+v at %s", state.lastGood, state.lastGoodAt)
	}
	persisted, savedAt, ok := loadPersistedLastGoodAnyAge()
	if !ok {
		t.Fatalf("expected newer persisted last-good frame to remain")
	}
	if persisted.Provider != "claude" || persisted.Session != 70 || !savedAt.Equal(newAt) {
		t.Fatalf("timed-out old cycle overwrote persisted last-good: frame=%+v savedAt=%s", persisted, savedAt)
	}
	if cfg.DeviceTarget != newTarget || saveConfigCalls != 0 {
		t.Fatalf("timed-out old cycle persisted stale WiFi target: target=%q saves=%d", cfg.DeviceTarget, saveConfigCalls)
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

func TestApplySelectionActivityExpiresCodingAfterMaxAgeWithoutIdleEvidence(t *testing.T) {
	prepareFastTestEnv(t)
	t.Setenv(activityHoldEnvVar, "600")
	t.Setenv(activityCodingMaxAgeEnvVar, "45")
	t.Setenv(activityIdleEvidenceEnvVar, "10")

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
			CollectedAt:        now.Add(46 * time.Second),
			ActivityObservedAt: observedAt,
		},
		Reason: codexbar.SelectionReasonStickyCurrent,
	}, state, now.Add(46*time.Second))
	if frame.Activity != "idle" {
		t.Fatalf("expected stale coding to expire without fresh idle evidence, got %q detail=%q", frame.Activity, detail)
	}
	if !strings.Contains(detail, "coding-max-age-expired") {
		t.Fatalf("expected max-age detail, got %q", detail)
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

func TestMarshalFrameWithinLimitTrimsUsageWindowsInOrder(t *testing.T) {
	frame := protocol.Frame{
		V:         protocol.ProtocolVersionV2,
		Provider:  "codex",
		Label:     "Codex",
		UsageMode: "used",
		UsageWindows: []protocol.UsageWindow{
			{ID: "alpha", Label: "Alpha", Percent: 10, ResetSec: 1},
			{ID: "beta", Label: "Beta", Percent: 20, ResetSec: 2},
			{ID: "gamma", Label: "Gamma", Percent: 30, ResetSec: 3},
			{ID: "delta", Label: "Delta", Percent: 40, ResetSec: 4},
			{ID: "epsilon", Label: "Epsilon", Percent: 50, ResetSec: 5},
		},
	}
	threeWindows := frame
	threeWindows.UsageWindows = append([]protocol.UsageWindow(nil), frame.UsageWindows[:3]...)
	limitLine, err := threeWindows.MarshalLine()
	if err != nil {
		t.Fatalf("marshal limit frame: %v", err)
	}

	line, marshaled, err := marshalFrameWithinLimit(frame, len(limitLine))
	if err != nil {
		t.Fatalf("marshal within limit: %v", err)
	}
	if len(line) > len(limitLine) {
		t.Fatalf("expected trimmed line to fit limit %d, got %d", len(limitLine), len(line))
	}
	if len(marshaled.UsageWindows) != 3 ||
		marshaled.UsageWindows[0].ID != "alpha" ||
		marshaled.UsageWindows[1].ID != "beta" ||
		marshaled.UsageWindows[2].ID != "gamma" {
		t.Fatalf("expected first three usage windows to be preserved, got %+v", marshaled.UsageWindows)
	}
}

func TestMarshalFrameWithinLimitTrimsV1UsageSlotsInOrder(t *testing.T) {
	frame := protocol.Frame{
		V:        protocol.ProtocolVersionV1,
		Provider: "codex",
		Label:    "Codex",
		UsageSlots: []protocol.UsageSlot{
			{ID: strings.Repeat("&", protocol.DefaultUsageWindowIDBytes), Label: strings.Repeat("<", protocol.DefaultUsageWindowLabelBytes), Percent: 10, ResetSec: 1},
			{ID: strings.Repeat(`\\`, protocol.DefaultUsageWindowIDBytes), Label: strings.Repeat(`"`, protocol.DefaultUsageWindowLabelBytes), Percent: 20, ResetSec: 2},
		},
	}
	oneSlot := frame
	oneSlot.UsageSlots = oneSlot.UsageSlots[:1]
	limitLine, err := oneSlot.MarshalLine()
	if err != nil {
		t.Fatalf("marshal one-slot limit frame: %v", err)
	}

	line, marshaled, err := marshalFrameWithinLimit(frame, len(limitLine))
	if err != nil {
		t.Fatalf("marshal v1 frame within limit: %v", err)
	}
	if len(line) > len(limitLine) {
		t.Fatalf("expected trimmed v1 line to fit limit %d, got %d", len(limitLine), len(line))
	}
	if len(marshaled.UsageWindows) != 0 || len(marshaled.UsageSlots) != 1 ||
		marshaled.UsageSlots[0].ID != frame.UsageSlots[0].ID ||
		marshaled.Weekly != 0 || !marshaled.WeeklyUnavailable {
		t.Fatalf("expected first legacy usage slot to survive, got %+v", marshaled)
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
				MaxFrameBytes:             2048,
			}, nil
		},
		fetchProviders: func(context.Context) ([]codexbar.ParsedFrame, error) {
			return []codexbar.ParsedFrame{testParsedFrame("codex", 12, 30, 3600)}, nil
		},
		fetchUpdateState: func(context.Context, protocol.DeviceCapabilities) (protocol.UpdateState, error) {
			return protocol.UpdateState{
				Available:     true,
				LatestVersion: "1.0.1",
				Status:        "update_available",
				Severity:      "recommended",
				Message:       strings.Repeat("Firmware update available. ", 10),
				FirmwareURL:   "https://github.com/example/very-long-firmware-download.bin.gz",
				SHA256:        strings.Repeat("a", 64),
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
	if frame.Update == nil || !frame.Update.Available || frame.Update.LatestVersion != "1.0.1" {
		t.Fatalf("expected update state in frame, got %+v", frame.Update)
	}
	if frame.Update.Message != "" || frame.Update.FirmwareURL != "" || frame.Update.SHA256 != "" {
		t.Fatalf("expected every device frame to omit unused update metadata, got %+v", frame.Update)
	}
	if len(sentLine) > 512 {
		t.Fatalf("expected low-memory device frame to stay compact, got %d bytes", len(sentLine))
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
		resolvePort: func(string) (string, error) { return "http://192.0.2.10", nil },
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
		resolvePort: func(string) (string, error) { return "http://192.0.2.10", nil },
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
				Message:       strings.Repeat("Firmware update available. Open the VibeTV Mac App. ", 20),
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

	prereleaseUpdate, err := selectFirmwareUpdate(protocol.DeviceCapabilities{
		Board:    "esp8266-smalltv-st7789",
		Firmware: "1.0.1-dev",
	}, firmwareManifest{Artifacts: []firmwareArtifact{
		{Board: "esp8266-smalltv-st7789", FirmwareVersion: "1.0.1"},
	}})
	if err != nil {
		t.Fatalf("select prerelease update: %v", err)
	}
	if !prereleaseUpdate.Available || prereleaseUpdate.Status != "update_available" {
		t.Fatalf("expected prerelease build to be offered the matching final release, got %+v", prereleaseUpdate)
	}

	rcUpdate, err := selectFirmwareUpdate(protocol.DeviceCapabilities{
		Board:    "esp8266-smalltv-st7789",
		Firmware: "1.0.36-rc.2",
	}, firmwareManifest{Artifacts: []firmwareArtifact{
		{Board: "esp8266-smalltv-st7789", FirmwareVersion: "1.0.36"},
	}})
	if err != nil {
		t.Fatalf("select rc update: %v", err)
	}
	if !rcUpdate.Available || rcUpdate.LatestVersion != "1.0.36" || rcUpdate.Status != "update_available" {
		t.Fatalf("expected RC firmware to be offered the matching final release, got %+v", rcUpdate)
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

func TestMarshalFrameWithinLimitCompactsOptionalFieldsBeforeUsageWindows(t *testing.T) {
	frame := protocol.Frame{
		V:             protocol.ProtocolVersionV2,
		Provider:      "codex",
		Label:         "Codex",
		Theme:         "classic",
		Time:          "12:34",
		Date:          "Tue, 24 Feb",
		SessionTokens: 1437166,
		WeekTokens:    382243544,
		TotalTokens:   1078397605,
		UsageWindows: []protocol.UsageWindow{
			{ID: "session", Label: "Session", Percent: 12, ResetSec: 3600},
			{ID: "weekly", Label: "Weekly", Percent: 30, ResetSec: 604800},
			{ID: "spark", Label: "Spark", Percent: 42, ResetSec: 604800},
		},
	}

	withoutOptionalFields := frame
	withoutOptionalFields.Theme = ""
	withoutOptionalFields.Time = ""
	withoutOptionalFields.Date = ""
	withoutOptionalFields.SessionTokens = 0
	withoutOptionalFields.WeekTokens = 0
	withoutOptionalFields.TotalTokens = 0
	limitLine, err := withoutOptionalFields.MarshalLine()
	if err != nil {
		t.Fatalf("marshal fully compacted frame: %v", err)
	}

	line, marshaled, err := marshalFrameWithinLimit(frame, len(limitLine))
	if err != nil {
		t.Fatalf("marshal within limit: %v", err)
	}
	if len(line) > len(limitLine) {
		t.Fatalf("expected line to fit limit %d, got %d", len(limitLine), len(line))
	}
	if marshaled.Theme != "" || marshaled.Time != "" || marshaled.Date != "" ||
		marshaled.SessionTokens != 0 || marshaled.WeekTokens != 0 || marshaled.TotalTokens != 0 {
		t.Fatalf("expected optional fields to be compacted, got %+v", marshaled)
	}
	if len(marshaled.UsageWindows) != len(frame.UsageWindows) {
		t.Fatalf("expected all usage windows to survive optional-field compaction, got %+v", marshaled.UsageWindows)
	}
}

func TestMarshalFrameWithinAdvertisedEscapedUsageWindowCapacity(t *testing.T) {
	const advertisedMaxUsageWindows = 3
	worstEscapedText := func(maxBytes int) string {
		return strings.Repeat("&<>", maxBytes/3) + strings.Repeat("&", maxBytes%3)
	}
	frame := protocol.Frame{
		V:         protocol.ProtocolVersionV2,
		Provider:  strings.Repeat(worstEscapedText(protocol.DefaultProviderBytes), 3),
		Label:     strings.Repeat(worstEscapedText(protocol.DefaultProviderLabelBytes), 3),
		UsageMode: "used",
	}
	maxID := worstEscapedText(protocol.DefaultUsageWindowIDBytes)
	maxLabel := worstEscapedText(protocol.DefaultUsageWindowLabelBytes)
	for i := 0; i < advertisedMaxUsageWindows+1; i++ {
		frame.UsageWindows = append(frame.UsageWindows, protocol.UsageWindow{
			ID:       maxID,
			Label:    maxLabel,
			Percent:  100,
			ResetSec: 9223372036854775807,
		})
	}
	frame.UsageWindows[advertisedMaxUsageWindows].ID = "must-trim"
	frame.UsageWindows[advertisedMaxUsageWindows].Label = "must-trim"

	bounded := applyDeviceUsageWindowLimit(frame, protocol.DeviceCapabilities{
		MaxUsageWindows: advertisedMaxUsageWindows,
	})
	line, marshaled, err := marshalFrameWithinLimit(bounded, 2048)
	if err != nil {
		t.Fatalf("marshal within advertised escaped usage-window capacity: %v", err)
	}
	if len(line) > 2048 {
		t.Fatalf("expected advertised usage windows to fit 2048 bytes, got %d", len(line))
	}
	if len(marshaled.UsageWindows) != advertisedMaxUsageWindows {
		t.Fatalf("expected all advertised usage windows to survive, got %+v", marshaled.UsageWindows)
	}
	for i := 0; i < advertisedMaxUsageWindows; i++ {
		if marshaled.UsageWindows[i].ID != maxID {
			t.Fatalf("expected escaped usage window ID %d to survive: got=%q want=%q", i, marshaled.UsageWindows[i].ID, maxID)
		}
	}
	if strings.Contains(string(line), "must-trim") {
		t.Fatalf("frame included usage window above advertised capacity: %s", line)
	}
	for _, escaped := range []string{`\u0026`, `\u003c`, `\u003e`} {
		if !strings.Contains(string(line), escaped) {
			t.Fatalf("frame missing escaped usage-window text %q: %s", escaped, line)
		}
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

func TestLoadPersistedUsageReturnsOrderedProviderSnapshots(t *testing.T) {
	tmpHome := t.TempDir()
	t.Setenv("HOME", tmpHome)

	now := time.Date(2026, 6, 26, 12, 0, 0, 0, time.UTC)
	if err := persistProviderSnapshots(map[string]providerSnapshot{
		"claude": {
			Provider:  "claude",
			Source:    "web",
			Collected: now.Add(-2 * time.Minute),
			Frame: protocol.Frame{
				Provider: "claude",
				Label:    "Claude",
				Session:  20,
				Weekly:   40,
				ResetSec: 7200,
			},
		},
		"codex": {
			Provider:  "codex",
			Source:    "openai-web",
			Collected: now.Add(-20 * time.Second),
			Frame: protocol.Frame{
				Provider:      "codex",
				Label:         "Codex",
				Session:       10,
				Weekly:        30,
				ResetSec:      3600,
				SessionTokens: 500,
			},
			Meta: codexbar.ProviderUsageMeta{
				Credits: &codexbar.ProviderCredits{Remaining: 42.5},
				Status:  &codexbar.ProviderStatus{Indicator: "none", Description: "Operational"},
				OverTime: []codexbar.UsageOverTimePoint{
					{
						Day:              "2026-06-24",
						TotalCreditsUsed: 12,
						Services:         []codexbar.UsageServiceUsage{{Service: "CLI", CreditsUsed: 12}},
					},
				},
			},
		},
	}, now); err != nil {
		t.Fatalf("persist provider snapshots: %v", err)
	}
	if err := persistLastGood(protocol.Frame{Provider: "claude", Label: "Claude"}, now); err != nil {
		t.Fatalf("persist last good: %v", err)
	}

	usage, ok := LoadPersistedUsage(now)
	if !ok {
		t.Fatal("expected persisted usage")
	}
	if usage.CurrentProvider != "claude" {
		t.Fatalf("expected current provider from last good, got %q", usage.CurrentProvider)
	}
	if len(usage.Providers) != 2 {
		t.Fatalf("expected two providers, got %+v", usage.Providers)
	}
	if usage.Providers[0].Provider != "claude" || usage.Providers[1].Provider != "codex" {
		t.Fatalf("expected generic alphabetical fallback without a VibeTV provider list; got %+v", usage.Providers)
	}
	if usage.Providers[0].Stale {
		t.Fatalf("expected Claude snapshot within last-good window, got %+v", usage.Providers[0])
	}
	if usage.Providers[1].Stale {
		t.Fatalf("expected fresh codex snapshot, got %+v", usage.Providers[1])
	}
	if usage.Providers[1].Frame.UsageMode != "used" {
		t.Fatalf("expected default usage mode used, got %q", usage.Providers[1].Frame.UsageMode)
	}
	if usage.Providers[1].Frame.SessionTokens != 500 {
		t.Fatalf("expected token stats to survive, got %+v", usage.Providers[1].Frame)
	}
	if usage.Providers[1].Meta.Credits == nil || usage.Providers[1].Meta.Credits.Remaining != 42.5 {
		t.Fatalf("expected credits metadata to survive, got %+v", usage.Providers[1].Meta.Credits)
	}
	if usage.Providers[1].Meta.Status == nil || usage.Providers[1].Meta.Status.Description != "Operational" {
		t.Fatalf("expected status metadata to survive, got %+v", usage.Providers[1].Meta.Status)
	}
	if len(usage.Providers[1].Meta.OverTime) != 1 || usage.Providers[1].Meta.OverTime[0].Day != "2026-06-24" {
		t.Fatalf("expected usage-over-time metadata to survive, got %+v", usage.Providers[1].Meta.OverTime)
	}
}

func TestLoadPersistedUsageClearsExpiredProviderValues(t *testing.T) {
	tmpHome := t.TempDir()
	t.Setenv("HOME", tmpHome)

	now := time.Date(2026, 6, 26, 12, 0, 0, 0, time.UTC)
	collectedAt := now.Add(-providerSnapshotMaxAge()).Add(time.Second)
	if err := persistProviderSnapshots(map[string]providerSnapshot{
		"codex": {
			Provider:  "codex",
			Source:    "codexbar-dashboard",
			Collected: collectedAt,
			Frame: protocol.Frame{
				Provider:      "codex",
				Label:         "Codex",
				Session:       68,
				Weekly:        7,
				ResetSec:      3600,
				SessionTokens: 100,
				UsageSlots: []protocol.UsageSlot{
					{ID: "weekly", Label: "Weekly", Percent: 68, ResetSec: 3600},
				},
			},
			Meta: codexbar.ProviderUsageMeta{
				Windows: []codexbar.UsageWindow{{ID: "weekly", Label: "Weekly", UsedPercent: 68, ResetSec: 3600}},
				Cost:    &codexbar.ProviderCostUsage{Last30DaysTokens: 100},
				Status:  &codexbar.ProviderStatus{Indicator: "none", Description: "Operational"},
			},
			TokenStatsCollected: collectedAt,
		},
	}, now); err != nil {
		t.Fatalf("persist provider snapshots: %v", err)
	}

	inside, ok := LoadPersistedUsage(now)
	if !ok || len(inside.Providers) != 1 {
		t.Fatalf("expected bounded persisted usage, got ok=%t usage=%+v", ok, inside)
	}
	if inside.Providers[0].Frame.UsageUnavailable || inside.Providers[0].Frame.Session != 68 ||
		len(inside.Providers[0].Frame.UsageSlots) != 1 || len(inside.Providers[0].Meta.Windows) != 1 {
		t.Fatalf("bounded snapshot changed before expiry: %+v", inside.Providers[0])
	}

	expired, ok := LoadPersistedUsage(now.Add(2 * time.Second))
	if !ok || len(expired.Providers) != 1 {
		t.Fatalf("expected expired provider carrier, got ok=%t usage=%+v", ok, expired)
	}
	provider := expired.Providers[0]
	if !provider.Frame.UsageUnavailable || !provider.Frame.SessionUnavailable || !provider.Frame.WeeklyUnavailable ||
		provider.Frame.Session != 0 || provider.Frame.Weekly != 0 || provider.Frame.ResetSec != 0 ||
		provider.Frame.SessionTokens != 0 || len(provider.Frame.UsageSlots) != 0 ||
		len(provider.Meta.Windows) != 0 || provider.Meta.Cost != nil {
		t.Fatalf("expired persisted usage was not cleared: %+v", provider)
	}
	if provider.Meta.Status == nil || provider.Meta.Status.Description != "Operational" {
		t.Fatalf("provider status should remain available after usage expiry: %+v", provider.Meta.Status)
	}
}

func TestPersistEmptyProviderSnapshotsClearsStoredUsage(t *testing.T) {
	tmpHome := t.TempDir()
	t.Setenv("HOME", tmpHome)

	now := time.Date(2026, 6, 26, 12, 0, 0, 0, time.UTC)
	if err := persistProviderSnapshots(map[string]providerSnapshot{
		"cursor": {
			Provider:  "cursor",
			Source:    "web",
			Collected: now,
			Frame: protocol.Frame{
				Provider: "cursor",
				Label:    "Cursor",
				Session:  20,
				Weekly:   40,
			},
		},
	}, now); err != nil {
		t.Fatalf("persist provider snapshots: %v", err)
	}

	if _, _, ok := loadPersistedProviderSnapshotsAnyAge(); !ok {
		t.Fatal("expected persisted provider snapshot before clearing")
	}

	if err := persistProviderSnapshots(map[string]providerSnapshot{}, now.Add(time.Minute)); err != nil {
		t.Fatalf("clear persisted provider snapshots: %v", err)
	}
	if _, _, ok := loadPersistedProviderSnapshotsAnyAge(); ok {
		t.Fatal("expected empty persisted provider snapshot set to stay cleared")
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
	if _, _, ok := loadPersistedLastGoodAnyAge(); !ok {
		t.Fatal("expected first cycle to persist the sent display frame")
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
	if !second.UsageUnavailable {
		t.Fatalf("expected expired last-good usage to be unavailable, got %+v", second)
	}
	// The persisted last-good survives the unavailable send: it is the only
	// restart evidence that this Mac ever delivered usage, and loading already
	// marks an expired frame unavailable. Deleting it here booted every
	// restart during a hiccup into the no-providers classification.
	if _, _, ok := loadPersistedLastGoodAnyAge(); !ok {
		t.Fatal("an unavailable send must keep the persisted last-good as restart evidence")
	}
	if !state.hasLastGood || state.lastGood.UsageUnavailable {
		t.Fatalf("the unavailable send must not remove the in-memory recovery frame: %+v", state.lastGood)
	}
}

func TestRunCycleWithDepsRejectsLastGoodOutsideFixedSelectionOnFetchFailure(t *testing.T) {
	prepareFastTestEnv(t)

	now := time.Date(2026, 8, 3, 12, 0, 0, 0, time.UTC)
	lastGood := protocol.Frame{Provider: "claude", Label: "Claude", Session: 61, Weekly: 49}
	if err := persistLastGood(lastGood, now.Add(-time.Minute)); err != nil {
		t.Fatalf("persist excluded last good: %v", err)
	}
	state := &runtimeState{
		selector:          codexbar.NewProviderSelector(),
		lastGood:          lastGood,
		lastGoodAt:        now.Add(-time.Minute),
		hasLastGood:       true,
		lastPersistedGood: lastGood,
		lastPersistedAt:   now.Add(-time.Minute),
		hasPersistedGood:  true,
	}
	deps := providerDisplayTestDeps(runtimeconfig.ProviderDisplayConfig{
		Mode:        "fixed",
		ProviderIDs: []string{"codex"},
	})
	deps.now = func() time.Time { return now }
	deps.resolvePort = func(string) (string, error) { return "/dev/cu.usbmodem-test", nil }
	deps.fetchProviders = func(context.Context) ([]codexbar.ParsedFrame, error) {
		return nil, &codexbar.FetchError{Kind: codexbar.FetchErrorCommand, Err: errors.New("temporary failure")}
	}
	var sentLine []byte
	deps.sendLine = func(_ string, line []byte) error {
		sentLine = append([]byte(nil), line...)
		return nil
	}
	deps.logf = func(string, ...any) {}

	if err := runCycleWithDeps(context.Background(), "", state, deps); err == nil {
		t.Fatal("excluded last-good fallback must not hide the fetch failure")
	}
	if frame := decodeFrameLine(t, sentLine); frame.Provider == "claude" || frame.Error == "" {
		t.Fatalf("excluded last-good frame was sent after fixed selection changed: %+v", frame)
	}
	if state.hasLastGood || state.hasPersistedGood {
		t.Fatalf("excluded last-good state survived: %+v", state)
	}
	if _, _, ok := loadPersistedLastGoodAnyAge(); ok {
		t.Fatal("excluded persisted last-good frame survived")
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
	if second.UsageUnavailable {
		t.Fatalf("expected two-minute last-good frame to keep visible values, got %+v", second)
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

func TestRunCycleWithDepsPersistsRecoveredWiFiIP(t *testing.T) {
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
	savedConfig := runtimeconfig.Config{DeviceTarget: staleTarget, DeviceToken: "pair-token", DeviceID: "esp8266-123abc"}

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
			return transportlayer.WiFiDiscoveryResult{
				Target: recoveredTarget,
				Hello: protocol.DeviceHello{
					Kind:            "hello",
					DeviceID:        "esp8266-123abc",
					NetworkMode:     "station",
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
	if publicDeviceTarget(sentPort) != recoveredTarget {
		t.Fatalf("expected frame sent to discovered target, got %q", sentPort)
	}
	if !strings.Contains(logged.String(), "wifi-target-discovered") {
		t.Fatalf("expected discovery log, got %q", logged.String())
	}
	if savedConfig.DeviceTarget != recoveredTarget || savedConfig.DeviceToken != "pair-token" {
		t.Fatalf("runtime must persist the recovered IP without changing pairing, got %+v", savedConfig)
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
	if publicDeviceTarget(sentPort) != recoveredTarget {
		t.Fatalf("expected second frame sent to recovered target, got %q", sentPort)
	}
}

func TestRecoverStaleWiFiTargetRequiresMatchingIdentityForNetworkScan(t *testing.T) {
	hello := protocol.DeviceHello{
		Kind:            "hello",
		DeviceID:        "esp8266-other",
		NetworkMode:     "station",
		Board:           "esp8266-smalltv-st7789",
		ProtocolVersion: 2,
		Capabilities:    protocol.CapabilityBlock{Transport: protocol.TransportCapabilities{Active: "wifi"}},
	}
	deps := runtimeDeps{
		transportName: "wifi",
		homeDir:       func() (string, error) { return "/tmp/test", nil },
		loadConfig: func(string) (runtimeconfig.Config, error) {
			return runtimeconfig.Config{DeviceID: "esp8266-known"}, nil
		},
		discoverWiFi: func([]string) (transportlayer.WiFiDiscoveryResult, error) {
			return transportlayer.WiFiDiscoveryResult{Target: "http://192.168.1.20", Hello: hello, Source: "network-scan"}, nil
		},
		logf: func(string, ...any) {},
	}.withDefaults()
	if _, _, ok := recoverStaleWiFiTarget("http://192.168.1.10", errors.New("offline"), deps); ok {
		t.Fatal("background discovery accepted a different device identity")
	}

	deps.loadConfig = func(string) (runtimeconfig.Config, error) { return runtimeconfig.Config{}, nil }
	if _, _, ok := recoverStaleWiFiTarget("http://192.168.1.10", errors.New("offline"), deps); ok {
		t.Fatal("legacy config accepted a blind subnet result")
	}

	hello.DeviceID = "esp8266-known"
	deps.loadConfig = func(string) (runtimeconfig.Config, error) {
		return runtimeconfig.Config{DeviceID: "esp8266-known"}, nil
	}
	if target, _, ok := recoverStaleWiFiTarget("http://192.168.1.10", errors.New("offline"), deps); !ok || target != "http://192.168.1.20" {
		t.Fatalf("matching device identity was not recovered: target=%q ok=%t", target, ok)
	}
}

func TestRunCycleWithDepsDoesNotPersistRecoveredWiFiIPBeforeSuccessfulSend(t *testing.T) {
	prepareFastTestEnv(t)

	now := time.Date(2026, 2, 23, 12, 0, 0, 0, time.UTC)
	state := &runtimeState{
		selector: codexbar.NewProviderSelector(),
	}

	const staleTarget = "http://192.168.178.163"
	const recoveredTarget = "http://192.168.178.72"
	var logged strings.Builder
	savedConfig := runtimeconfig.Config{DeviceTarget: staleTarget, DeviceID: "esp8266-123abc"}

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
			return transportlayer.WiFiDiscoveryResult{
				Target: recoveredTarget,
				Hello: protocol.DeviceHello{
					Kind:            "hello",
					DeviceID:        "esp8266-123abc",
					NetworkMode:     "station",
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
		sendLine: func(string, []byte) error {
			return errors.New(`device status=400 body="empty frame body"`)
		},
		logf: func(format string, args ...any) {
			logged.WriteString(fmt.Sprintf(format, args...))
		},
	})
	if err == nil {
		t.Fatal("expected send error")
	}
	if savedConfig.DeviceTarget != staleTarget {
		t.Fatalf("expected stale target to remain persisted after failed send, got %+v", savedConfig)
	}
	if state.deviceTarget != recoveredTarget {
		t.Fatalf("expected recovered target to stay in runtime state, got %q", state.deviceTarget)
	}
	if !strings.Contains(logged.String(), "wifi-target-selected") {
		t.Fatalf("expected selected target log, got %q", logged.String())
	}
	if strings.Contains(logged.String(), "wifi-target-persisted") {
		t.Fatalf("did not expect failed send to persist target, got %q", logged.String())
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
		homeDir:       func() (string, error) { return "/tmp/codexbar-test-home", nil },
		loadConfig: func(string) (runtimeconfig.Config, error) {
			return runtimeconfig.Config{DeviceTarget: staleTarget, DeviceToken: "pair-token", DeviceID: "esp8266-123abc"}, nil
		},
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
			return transportlayer.WiFiDiscoveryResult{
				Target: recoveredTarget,
				Hello: protocol.DeviceHello{
					Kind:            "hello",
					DeviceID:        "esp8266-123abc",
					NetworkMode:     "station",
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
	if publicDeviceTarget(sentPort) != recoveredTarget {
		t.Fatalf("expected frame sent to discovered target, got %q", sentPort)
	}
}

func TestRunCycleWithDepsMigratesLegacyMDNSTargetToIP(t *testing.T) {
	prepareFastTestEnv(t)

	now := time.Date(2026, 2, 23, 12, 0, 0, 0, time.UTC)
	state := &runtimeState{
		selector: codexbar.NewProviderSelector(),
	}

	const staleTarget = "http://vibetv.local"
	const discoveredTarget = "http://192.168.178.159"
	var sentPort string
	var logged strings.Builder
	cfg := runtimeconfig.Config{DeviceTarget: staleTarget, DeviceToken: "pair-token", DeviceID: "esp8266-123abc"}

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
			if len(candidates) != 0 {
				t.Fatalf("legacy hostname must be skipped in favor of subnet discovery, got %#v", candidates)
			}
			return transportlayer.WiFiDiscoveryResult{
				Target: discoveredTarget,
				Hello: protocol.DeviceHello{
					Kind:            "hello",
					DeviceID:        "esp8266-123abc",
					NetworkMode:     "station",
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
	if publicDeviceTarget(sentPort) != discoveredTarget {
		t.Fatalf("expected frame sent to discovered target, got %q", sentPort)
	}
	if cfg.DeviceTarget != discoveredTarget {
		t.Fatalf("runtime must persist the migrated IP target, got %+v", cfg)
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
	if delays[0] != failureRetryInterval || delays[1] != failureRetryInterval || delays[2] != failureRetryInterval {
		t.Fatalf("device-unreachable cycles must use the short reconnect retry: %v", delays[:3])
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
	if got := startupInterval(2*time.Second, 10*time.Second); got != 2*time.Second {
		t.Fatalf("expected normal interval when already shorter than startup interval, got %s", got)
	}
	// The fast-poll interval must actually be faster than the WiFi default;
	// otherwise the whole startup fast-poll mechanism is dead code.
	if startupFastPollInterval >= defaultWiFiInterval {
		t.Fatalf("startup fast poll (%s) must be shorter than the WiFi interval (%s)",
			startupFastPollInterval, defaultWiFiInterval)
	}
}

func TestRunDaemonLoopRetriesQuicklyAfterCycleError(t *testing.T) {
	prepareFastTestEnv(t)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	var waits []time.Duration
	cycleCalls := 0
	err := runDaemonLoop(ctx, Options{Interval: 30 * time.Second, DisableStartupFastPoll: true}, runtimeDeps{
		now: func() time.Time {
			return time.Date(2026, 2, 23, 12, 0, cycleCalls, 0, time.UTC)
		},
		after: func(wait time.Duration) <-chan time.Time {
			waits = append(waits, wait)
			if len(waits) >= 2 {
				cancel()
				return make(chan time.Time)
			}
			ch := make(chan time.Time, 1)
			ch <- time.Date(2026, 2, 23, 12, 0, cycleCalls, 0, time.UTC)
			return ch
		},
		logf: func(string, ...any) {},
	}, func(context.Context) error {
		cycleCalls++
		if cycleCalls == 1 {
			return &RuntimeError{
				Kind: runtimeErrorDeviceHello,
				Op:   "read-device-hello",
				Err:  errors.New("device offline"),
			}
		}
		return nil
	})

	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected loop to stay alive until context cancel, got %v", err)
	}
	if len(waits) != 2 {
		t.Fatalf("expected two waits, got %d", len(waits))
	}
	if waits[0] != failureRetryInterval {
		t.Fatalf("failed cycle must retry after %s, waited %s", failureRetryInterval, waits[0])
	}
	if waits[1] != 30*time.Second {
		t.Fatalf("successful cycle must return to the normal interval, waited %s", waits[1])
	}
}

func TestRunDaemonLoopReturnsConnectionModeChange(t *testing.T) {
	prepareFastTestEnv(t)

	cycleCalls := 0
	err := runDaemonLoop(context.Background(), Options{Interval: time.Second}, runtimeDeps{
		now:  time.Now,
		logf: func(string, ...any) {},
		after: func(time.Duration) <-chan time.Time {
			t.Fatal("connection mode change must exit before retry wait")
			return nil
		},
	}, func(context.Context) error {
		cycleCalls++
		return ErrConnectionModeChanged
	})

	if !errors.Is(err, ErrConnectionModeChanged) {
		t.Fatalf("expected connection mode change, got %v", err)
	}
	if cycleCalls != 1 {
		t.Fatalf("expected one cycle before exit, got %d", cycleCalls)
	}
}

func TestRunWithDepsUsesConfiguredIntervalAfterSleepWakeGap(t *testing.T) {
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
	// Every cycle here fails at the serial write, so the loop uses the short
	// device-reconnect retry instead of the configured interval - including
	// directly after the sleep-wake gap.
	want := []time.Duration{failureRetryInterval, failureRetryInterval, failureRetryInterval, failureRetryInterval}
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
		t.Fatalf("expected two retained fresh snapshots, got %#v", second)
	}
	if second[0].Provider != "claude" || second[1].Provider != "codex" {
		t.Fatalf("expected current CodexBar order first, then retained snapshot; got %#v", second)
	}
	if second[0].Stale || second[1].Stale {
		t.Fatalf("expected retained snapshots within last-good window to stay fresh, got %#v", second)
	}

	current = current.Add(3 * time.Hour)
	expired := collector.providerFrames(current)
	if len(expired) != 2 || !expired[0].Frame.UsageUnavailable || !expired[1].Frame.UsageUnavailable {
		t.Fatalf("expected old provider snapshots to remain as unavailable carriers, got %#v", expired)
	}
	if expired[0].Frame.Session != 0 || expired[1].Frame.Session != 0 ||
		len(expired[0].Frame.UsageSlots) != 0 || len(expired[1].Frame.UsageSlots) != 0 ||
		len(expired[0].Meta.Windows) != 0 || len(expired[1].Meta.Windows) != 0 {
		t.Fatalf("expected expired usage values and windows to be cleared, got %#v", expired)
	}
}

func TestProviderCollectorWakeCollectsBeforeDisplayWake(t *testing.T) {
	prepareFastTestEnv(t)

	now := time.Date(2026, 7, 28, 10, 0, 0, 0, time.UTC)
	wake := make(chan struct{}, 1)
	displayWake := make(chan struct{}, 1)
	collected := make(chan int, 2)
	var calls atomic.Int32
	collector := &providerCollector{
		now:             func() time.Time { return now },
		logf:            func(string, ...any) {},
		order:           []string{"codex"},
		interval:        time.Hour,
		activityPoll:    time.Hour,
		timeout:         time.Second,
		snapshotMaxAge:  time.Hour,
		persistInterval: time.Minute,
		providers:       make(map[string]providerSnapshot),
		wake:            wake,
		afterWakeCollect: func() {
			signalWake(displayWake)
		},
		fetchProviders: func(context.Context) ([]codexbar.ParsedFrame, error) {
			call := int(calls.Add(1))
			collected <- call
			weekly := 10
			if call >= 2 {
				weekly = 77
			}
			return []codexbar.ParsedFrame{testParsedFrame("codex", 11, weekly, 3600)}, nil
		},
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go collector.run(ctx)

	select {
	case call := <-collected:
		if call != 1 {
			t.Fatalf("expected initial collection first, got call %d", call)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for initial collection")
	}

	wake <- struct{}{}

	select {
	case <-displayWake:
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for display wake after manual collection")
	}
	if calls.Load() < 2 {
		t.Fatalf("display woke before the collector handled the manual refresh, calls=%d", calls.Load())
	}
	frames := collector.providerFrames(now)
	if len(frames) != 1 || frames[0].Frame.Weekly != 77 {
		t.Fatalf("display wake must follow the refreshed collector snapshot, got %#v", frames)
	}
}

func TestProviderCollectorRetriesInitialCollectionWhenDashboardBecomesHealthyWithOnlyExpiredSnapshots(t *testing.T) {
	prepareFastTestEnv(t)

	now := time.Date(2026, 8, 3, 10, 0, 0, 0, time.UTC)
	var dashboardInfo atomic.Value
	dashboardInfo.Store(codexbar.DashboardServeInfo{})
	initialFailure := make(chan struct{}, 1)
	completed := make(chan struct{}, 1)
	collector := &providerCollector{
		now: func() time.Time { return now },
		logf: func(format string, _ ...any) {
			if strings.Contains(format, "fresh=false") {
				select {
				case initialFailure <- struct{}{}:
				default:
				}
			}
			if strings.Contains(format, "collector complete") {
				select {
				case completed <- struct{}{}:
				default:
				}
			}
		},
		order:           []string{"codex"},
		interval:        time.Hour,
		activityPoll:    5 * time.Millisecond,
		timeout:         time.Second,
		snapshotMaxAge:  10 * time.Minute,
		persistInterval: time.Minute,
		providers: map[string]providerSnapshot{
			"codex": {
				Provider:  "codex",
				Frame:     protocol.Frame{Provider: "codex", Session: 9},
				Collected: now.Add(-11 * time.Minute),
			},
		},
		dashboard: dashboardServeFunc(func() codexbar.DashboardServeInfo {
			return dashboardInfo.Load().(codexbar.DashboardServeInfo)
		}),
		fetchDashboard: func(context.Context, codexbar.DashboardServeInfo, time.Time) ([]codexbar.ParsedFrame, error) {
			return []codexbar.ParsedFrame{dashboardParsedFrame("codex", "Weekly", "Codex Spark Weekly", 21, 7)}, nil
		},
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go collector.run(ctx)

	select {
	case <-initialFailure:
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for initial dashboard startup race")
	}
	dashboardInfo.Store(testDashboardServeInfo(1001))
	select {
	case <-completed:
	case <-time.After(time.Second):
		t.Fatal("collector did not retry after the dashboard became healthy")
	}

	frames := collector.providerFrames(now)
	if len(frames) != 1 || frames[0].Provider != "codex" || frames[0].Frame.Session != 21 {
		t.Fatalf("expected dashboard usage after readiness retry, got %#v", frames)
	}
}

func TestProviderCollectorDoesNotMakeOldProviderObservationFresh(t *testing.T) {
	prepareFastTestEnv(t)

	now := time.Date(2026, 7, 28, 12, 0, 0, 0, time.UTC)
	collector := &providerCollector{
		now:             func() time.Time { return now },
		logf:            func(string, ...any) {},
		order:           []string{"antigravity", "claude"},
		interval:        30 * time.Second,
		timeout:         time.Second,
		snapshotMaxAge:  10 * time.Minute,
		persistInterval: time.Minute,
		providers:       make(map[string]providerSnapshot),
		fetchProviders: func(context.Context) ([]codexbar.ParsedFrame, error) {
			oldAntigravity := testParsedFrame("antigravity", 19, 0, 3600)
			oldAntigravity.Source = "codexbar-dashboard"
			oldAntigravity.ActivityObservedAt = now.Add(-time.Hour)
			oldAntigravity.CollectedAt = oldAntigravity.ActivityObservedAt
			freshClaude := testParsedFrame("claude", 13, 3, 3600)
			freshClaude.Source = "claude"
			freshClaude.ActivityObservedAt = now
			freshClaude.CollectedAt = now
			return []codexbar.ParsedFrame{oldAntigravity, freshClaude}, nil
		},
	}

	collector.collectOnce(context.Background())
	frames := collector.providerFrames(now)
	if len(frames) != 2 {
		t.Fatalf("expected two provider frames, got %#v", frames)
	}
	if frames[0].Provider != "antigravity" || !frames[0].Stale || !frames[0].Frame.UsageUnavailable {
		t.Fatalf("old Antigravity observation should be stale and unavailable, got %#v", frames[0])
	}
	if frames[1].Provider != "claude" || frames[1].Stale || frames[1].Frame.UsageUnavailable {
		t.Fatalf("fresh Claude observation should remain available, got %#v", frames[1])
	}

	decision, ok := codexbar.NewProviderSelector().SelectWithDecision(frames)
	if !ok || decision.Selected.Provider != "claude" {
		t.Fatalf("fresh Claude should win over stale ordered provider, got ok=%t decision=%#v", ok, decision)
	}
}

func TestProviderCollectorKeepsDashboardSnapshotThroughLastGoodWindow(t *testing.T) {
	prepareFastTestEnv(t)

	now := time.Date(2026, 7, 29, 18, 30, 0, 0, time.UTC)
	collectedAt := now.Add(-39 * time.Second)
	dashboard := testParsedFrame("codex", 24, 0, 3600)
	dashboard.Source = "codexbar-dashboard"
	cli := testParsedFrame("claude", 13, 3, 3600)
	cli.Source = "codexbar-usage-json"

	collector := &providerCollector{
		now:             func() time.Time { return now },
		logf:            func(string, ...any) {},
		order:           []string{"codex", "claude"},
		interval:        30 * time.Second,
		snapshotMaxAge:  10 * time.Minute,
		persistInterval: time.Minute,
		providers: map[string]providerSnapshot{
			"codex": {
				Provider:  "codex",
				Source:    dashboard.Source,
				Collected: collectedAt,
				Frame:     dashboard.Frame,
			},
			"claude": {
				Provider:  "claude",
				Source:    cli.Source,
				Collected: collectedAt,
				Frame:     cli.Frame,
			},
		},
	}

	frames := collector.providerFrames(now)
	if len(frames) != 2 {
		t.Fatalf("expected two provider frames, got %#v", frames)
	}
	if frames[0].Provider != "codex" || frames[0].Stale || frames[0].Frame.UsageUnavailable {
		t.Fatalf("dashboard snapshot within last-good window must stay fresh, got %#v", frames[0])
	}
	if frames[1].Provider != "claude" || frames[1].Stale {
		t.Fatalf("snapshot within the last-good window must stay fresh, got %#v", frames[1])
	}

	var sentLine []byte
	err := runCycleFromCollector(context.Background(), "", &runtimeState{selector: codexbar.NewProviderSelector()}, collector, runtimeDeps{
		now:         func() time.Time { return now },
		resolvePort: func(string) (string, error) { return "/dev/cu.usbmodem-test", nil },
		sendLine: func(_ string, line []byte) error {
			sentLine = append([]byte(nil), line...)
			return nil
		},
		logf: func(string, ...any) {},
	})
	if err != nil {
		t.Fatalf("publisher should send dashboard snapshot before CodexBar deadline: %v", err)
	}
	if frame := decodeFrameLine(t, sentLine); frame.Provider != "codex" || frame.Session != 24 {
		t.Fatalf("expected sent Codex dashboard frame, got %+v", frame)
	}

	if err := persistProviderSnapshots(collector.providers, now); err != nil {
		t.Fatalf("persist provider snapshots: %v", err)
	}
	usage, ok := LoadPersistedUsage(now)
	if !ok || len(usage.Providers) != 2 {
		t.Fatalf("expected persisted usage for both providers, ok=%t usage=%#v", ok, usage)
	}
	var dashboardUsage *ProviderUsageSnapshot
	for i := range usage.Providers {
		if usage.Providers[i].Provider == "codex" {
			dashboardUsage = &usage.Providers[i]
		}
	}
	if dashboardUsage == nil || dashboardUsage.Stale {
		t.Fatalf("persisted dashboard usage within last-good window must stay fresh, got %#v", usage.Providers)
	}

	usage, ok = LoadPersistedUsage(now.Add(10*time.Minute + 2*time.Second))
	if !ok || len(usage.Providers) != 2 {
		t.Fatalf("persisted usage must remain readable after its last-good window, ok=%t usage=%#v", ok, usage)
	}
	for _, provider := range usage.Providers {
		if provider.Provider == "codex" && !provider.Stale {
			t.Fatalf("dashboard usage must become stale after its last-good window, usage=%#v", usage)
		}
	}
}

func TestRunCycleFromCollectorSendsSnapshotCollectedAfterSlowFetch(t *testing.T) {
	prepareFastTestEnv(t)

	current := time.Date(2026, 7, 28, 12, 0, 0, 0, time.UTC)
	collector := &providerCollector{
		now:             func() time.Time { return current },
		logf:            func(string, ...any) {},
		order:           []string{"claude"},
		interval:        30 * time.Second,
		timeout:         time.Minute,
		snapshotMaxAge:  10 * time.Minute,
		persistInterval: time.Minute,
		providers:       make(map[string]providerSnapshot),
		fetchProviders: func(context.Context) ([]codexbar.ParsedFrame, error) {
			current = current.Add(40 * time.Second)
			return []codexbar.ParsedFrame{testParsedFrame("claude", 14, 4, 3600)}, nil
		},
	}
	collector.collectOnce(context.Background())

	frames := collector.providerFrames(current)
	if len(frames) != 1 || frames[0].Stale || frames[0].Frame.UsageUnavailable {
		t.Fatalf("slow successful fetch should be fresh at completion time, got %#v", frames)
	}

	var sentLine []byte
	err := runCycleFromCollector(context.Background(), "", &runtimeState{selector: codexbar.NewProviderSelector()}, collector, runtimeDeps{
		now:         func() time.Time { return current },
		resolvePort: func(string) (string, error) { return "/dev/cu.usbmodem-test", nil },
		sendLine: func(_ string, line []byte) error {
			sentLine = append([]byte(nil), line...)
			return nil
		},
		logf: func(string, ...any) {},
	})
	if err != nil {
		t.Fatalf("publisher should send slow successful collector snapshot: %v", err)
	}
	frame := decodeFrameLine(t, sentLine)
	if frame.Provider != "claude" || frame.Session != 14 || frame.Weekly != 4 {
		t.Fatalf("expected Claude frame from collector, got %+v", frame)
	}
}

func TestProviderCollectorUsesFetchCompletionForDashboardWithoutProducerTime(t *testing.T) {
	prepareFastTestEnv(t)

	current := time.Date(2026, 7, 28, 12, 0, 0, 0, time.UTC)
	collector := &providerCollector{
		now:             func() time.Time { return current },
		logf:            func(string, ...any) {},
		order:           []string{"codex"},
		interval:        30 * time.Second,
		timeout:         time.Minute,
		snapshotMaxAge:  10 * time.Minute,
		persistInterval: time.Minute,
		providers:       make(map[string]providerSnapshot),
		dashboard:       staticDashboardServe{info: testDashboardServeInfo(1001)},
		fetchDashboard: func(context.Context, codexbar.DashboardServeInfo, time.Time) ([]codexbar.ParsedFrame, error) {
			current = current.Add(40 * time.Second)
			return []codexbar.ParsedFrame{dashboardParsedFrame("codex", "Weekly", "Codex Spark Weekly", 24, 0)}, nil
		},
	}
	collector.collectOnce(context.Background())

	frames := collector.providerFrames(current)
	if len(frames) != 1 || frames[0].Stale || frames[0].Frame.UsageUnavailable {
		t.Fatalf("slow dashboard fetch without producer time should be fresh at fetch completion, got %#v", frames)
	}
	if !frames[0].CollectedAt.Equal(current) {
		t.Fatalf("expected fetch completion collectedAt %s, got %s", current, frames[0].CollectedAt)
	}
}

func TestProviderCollectorUsesAuthoritativeUsageWhileFirstRunSetupIsPending(t *testing.T) {
	prepareFastTestEnv(t)

	current := time.Date(2026, 7, 28, 12, 0, 0, 0, time.UTC)
	pending := true
	usageCalls := 0
	dashboardCalls := 0
	collector := &providerCollector{
		now:                  func() time.Time { return current },
		logf:                 func(string, ...any) {},
		order:                []string{"codex"},
		interval:             30 * time.Second,
		timeout:              time.Minute,
		snapshotMaxAge:       10 * time.Minute,
		persistInterval:      time.Minute,
		providers:            make(map[string]providerSnapshot),
		firstRunSetupPending: func() bool { return pending },
		dashboard:            staticDashboardServe{info: testDashboardServeInfo(1001)},
		fetchProviders: func(context.Context) ([]codexbar.ParsedFrame, error) {
			usageCalls++
			return []codexbar.ParsedFrame{testParsedFrame("codex", 17, 0, 3600)}, nil
		},
		fetchDashboard: func(context.Context, codexbar.DashboardServeInfo, time.Time) ([]codexbar.ParsedFrame, error) {
			dashboardCalls++
			return []codexbar.ParsedFrame{dashboardParsedFrame("codex", "Weekly", "Codex Spark Weekly", 24, 0)}, nil
		},
	}

	collector.collectOnce(context.Background())
	if usageCalls != 1 || dashboardCalls != 0 {
		t.Fatalf("pending first run must use only authoritative usage, usage=%d dashboard=%d", usageCalls, dashboardCalls)
	}
	pending = false
	collector.collectOnce(context.Background())
	if usageCalls != 1 || dashboardCalls != 1 {
		t.Fatalf("completed first run may use dashboard, usage=%d dashboard=%d", usageCalls, dashboardCalls)
	}
}

func TestRunCycleFromCollectorSendsFreshDashboardQuotaWithOldActivityTime(t *testing.T) {
	prepareFastTestEnv(t)

	current := time.Date(2026, 7, 28, 12, 0, 0, 0, time.UTC)
	oldActivity := current.Add(-2 * time.Minute)
	collector := &providerCollector{
		now:             func() time.Time { return current },
		logf:            func(string, ...any) {},
		order:           []string{"codex"},
		interval:        30 * time.Second,
		timeout:         time.Minute,
		snapshotMaxAge:  10 * time.Minute,
		persistInterval: time.Minute,
		providers:       make(map[string]providerSnapshot),
		fetchProviders: func(context.Context) ([]codexbar.ParsedFrame, error) {
			frame := testParsedFrame("codex", 24, 0, 3600)
			frame.Source = "codexbar-dashboard"
			frame.CollectedAt = current
			frame.ActivityObservedAt = oldActivity
			frame.Frame.Label = "Codex"
			frame.Frame.UsageWindows = []protocol.UsageWindow{
				{ID: "weekly", Label: "Weekly", Percent: 24, ResetSec: 3600},
				{ID: "codex-spark-weekly", Label: "Codex Spark Weekly", Percent: 0, ResetSec: 3600},
			}
			frame.Meta.Windows = []codexbar.UsageWindow{
				{ID: "weekly", Label: "Weekly", UsedPercent: 24, ResetSec: 3600},
				{ID: "codex-spark-weekly", Label: "Codex Spark Weekly", UsedPercent: 0, ResetSec: 3600},
			}
			return []codexbar.ParsedFrame{frame}, nil
		},
	}
	collector.collectOnce(context.Background())

	frames := collector.providerFrames(current)
	if len(frames) != 1 || frames[0].Stale || frames[0].Frame.UsageUnavailable {
		t.Fatalf("successful dashboard fetch must be stream-fresh at collection time, got %#v", frames)
	}
	if !frames[0].CollectedAt.Equal(current) || !frames[0].ActivityObservedAt.Equal(oldActivity) {
		t.Fatalf("collectedAt and activityObservedAt must stay separate, got collected=%s activity=%s", frames[0].CollectedAt, frames[0].ActivityObservedAt)
	}

	var sentLine []byte
	err := runCycleFromCollector(context.Background(), "", &runtimeState{selector: codexbar.NewProviderSelector()}, collector, runtimeDeps{
		now:         func() time.Time { return current },
		resolvePort: func(string) (string, error) { return "/dev/cu.usbmodem-test", nil },
		sendLine: func(_ string, line []byte) error {
			sentLine = append([]byte(nil), line...)
			return nil
		},
		logf: func(string, ...any) {},
	})
	if err != nil {
		t.Fatalf("publisher should send fresh dashboard quota despite old activity time: %v", err)
	}
	frame := decodeFrameLine(t, sentLine)
	if strings.Contains(string(sentLine), `"usageWindows"`) {
		t.Fatalf("v1 collector frame must not send usageWindows: %s", sentLine)
	}
	if frame.V != protocol.ProtocolVersionV1 ||
		frame.Provider != "codex" ||
		frame.Label != "Codex" ||
		len(frame.UsageWindows) != 0 ||
		len(frame.UsageSlots) != 2 ||
		frame.UsageSlots[0].Label != "Weekly" ||
		frame.UsageSlots[1].Label != "Codex Spark Weekly" ||
		frame.Session != 24 ||
		frame.Weekly != 0 ||
		frame.ResetSec != 3600 {
		t.Fatalf("expected Codex dashboard usage as v1 legacy slots in sent frame, got %+v", frame)
	}
}

func TestProviderCollectorLearnsDynamicCodexBarOrder(t *testing.T) {
	prepareFastTestEnv(t)

	now := time.Date(2026, 7, 24, 8, 0, 0, 0, time.UTC)
	collector := &providerCollector{
		now:             func() time.Time { return now },
		logf:            func(string, ...any) {},
		snapshotMaxAge:  10 * time.Minute,
		persistInterval: time.Minute,
		providers:       make(map[string]providerSnapshot),
		fetchProviders: func(context.Context) ([]codexbar.ParsedFrame, error) {
			return []codexbar.ParsedFrame{
				testParsedFrame("antigravity", 17, 23, 3600),
				testParsedFrame("gemini", 41, 52, 7200),
			}, nil
		},
	}
	collector.collectOnce(context.Background())

	if !reflect.DeepEqual(collector.order, []string{"antigravity", "gemini"}) {
		t.Fatalf("collector did not learn CodexBar order dynamically: %v", collector.order)
	}
	frames := collector.providerFrames(now)
	if len(frames) != 2 || frames[0].Provider != "antigravity" || frames[1].Provider != "gemini" {
		t.Fatalf("dynamic provider order was not preserved: %#v", frames)
	}

	collector.fetchProviders = func(context.Context) ([]codexbar.ParsedFrame, error) {
		return []codexbar.ParsedFrame{
			testParsedFrame("gemini", 41, 52, 7200),
			testParsedFrame("antigravity", 17, 23, 3600),
		}, nil
	}
	collector.collectOnce(context.Background())
	if !reflect.DeepEqual(collector.order, []string{"gemini", "antigravity"}) {
		t.Fatalf("collector kept stale order instead of current CodexBar order: %v", collector.order)
	}
}

func TestProviderCollectorPrunesDisabledProviderFromAuthoritativeInventory(t *testing.T) {
	prepareFastTestEnv(t)

	now := time.Date(2026, 7, 24, 8, 0, 0, 0, time.UTC)
	cursorEnabled := true
	collector := &providerCollector{
		now:             func() time.Time { return now },
		logf:            func(string, ...any) {},
		snapshotMaxAge:  10 * time.Minute,
		persistInterval: time.Minute,
		providers:       make(map[string]providerSnapshot),
		fetchProviders: func(context.Context) ([]codexbar.ParsedFrame, error) {
			frames := []codexbar.ParsedFrame{testParsedFrame("codex", 12, 34, 3600)}
			if cursorEnabled {
				frames = append(frames, testParsedFrame("cursor", 57, 100, 7200))
			}
			return frames, nil
		},
		fetchInventory: func(context.Context) ([]codexbar.ProviderSetting, error) {
			return []codexbar.ProviderSetting{
				{ID: "codex", Enabled: true},
				{ID: "cursor", Enabled: cursorEnabled},
			}, nil
		},
	}
	collector.collectOnce(context.Background())
	if len(collector.providerFrames(now)) != 2 {
		t.Fatalf("expected initial provider snapshots: %#v", collector.providerFrames(now))
	}

	cursorEnabled = false
	collector.collectOnce(context.Background())
	frames := collector.providerFrames(now)
	if len(frames) != 1 || frames[0].Provider != "codex" {
		t.Fatalf("disabled provider snapshot was not pruned: %#v", frames)
	}
	if !reflect.DeepEqual(collector.order, []string{"codex"}) {
		t.Fatalf("disabled provider remained in authoritative order: %v", collector.order)
	}
}

func TestProviderCollectorDoesNotPruneWhenInventoryRefreshFails(t *testing.T) {
	prepareFastTestEnv(t)

	now := time.Date(2026, 7, 24, 8, 0, 0, 0, time.UTC)
	inventoryAvailable := true
	includeCursorUsage := true
	collector := &providerCollector{
		now:             func() time.Time { return now },
		logf:            func(string, ...any) {},
		snapshotMaxAge:  10 * time.Minute,
		persistInterval: time.Minute,
		providers:       make(map[string]providerSnapshot),
		fetchProviders: func(context.Context) ([]codexbar.ParsedFrame, error) {
			frames := []codexbar.ParsedFrame{testParsedFrame("codex", 12, 34, 3600)}
			if includeCursorUsage {
				frames = append(frames, testParsedFrame("cursor", 57, 100, 7200))
			}
			return frames, nil
		},
		fetchInventory: func(context.Context) ([]codexbar.ProviderSetting, error) {
			if !inventoryAvailable {
				return nil, errors.New("temporary inventory failure")
			}
			return []codexbar.ProviderSetting{
				{ID: "codex", Enabled: true},
				{ID: "cursor", Enabled: true},
			}, nil
		},
	}
	collector.collectOnce(context.Background())

	inventoryAvailable = false
	includeCursorUsage = false
	collector.collectOnce(context.Background())
	frames := collector.providerFrames(now)
	if len(frames) != 2 {
		t.Fatalf("transient inventory failure pruned a provider snapshot: %#v", frames)
	}
}

func TestProviderCollectorUsesInventoryWithoutTreatingFetchFailureAsDisable(t *testing.T) {
	prepareFastTestEnv(t)

	now := time.Date(2026, 7, 24, 8, 0, 0, 0, time.UTC)
	fetchFailed := false
	cursorEnabled := true
	collector := &providerCollector{
		now:             func() time.Time { return now },
		logf:            func(string, ...any) {},
		snapshotMaxAge:  10 * time.Minute,
		persistInterval: time.Minute,
		providers:       make(map[string]providerSnapshot),
		fetchProviders: func(context.Context) ([]codexbar.ParsedFrame, error) {
			if fetchFailed {
				return nil, errors.New("temporary usage failure")
			}
			return []codexbar.ParsedFrame{testParsedFrame("cursor", 57, 100, 7200)}, nil
		},
		fetchInventory: func(context.Context) ([]codexbar.ProviderSetting, error) {
			return []codexbar.ProviderSetting{{ID: "cursor", Enabled: cursorEnabled}}, nil
		},
	}
	collector.collectOnce(context.Background())

	fetchFailed = true
	collector.collectOnce(context.Background())
	if frames := collector.providerFrames(now); len(frames) != 1 || frames[0].Provider != "cursor" {
		t.Fatalf("transient usage failure pruned enabled provider: %#v", frames)
	}

	cursorEnabled = false
	collector.collectOnce(context.Background())
	if frames := collector.providerFrames(now); len(frames) != 0 {
		t.Fatalf("authoritative inventory did not prune disabled last provider: %#v", frames)
	}
}

func TestProviderCollectorBuffersUnavailableAndRecoversWithoutFlicker(t *testing.T) {
	prepareFastTestEnv(t)

	now := time.Date(2026, 7, 22, 12, 0, 0, 0, time.UTC)
	current := now
	collector := &providerCollector{
		now:             func() time.Time { return current },
		logf:            func(string, ...any) {},
		order:           []string{"gemini"},
		snapshotMaxAge:  10 * time.Minute,
		persistInterval: time.Minute,
		providers:       make(map[string]providerSnapshot),
	}
	unavailable := codexbar.ParsedFrame{
		Provider: "gemini",
		Source:   "oauth-api",
		Stale:    true,
		Frame: protocol.Frame{
			Provider:         "gemini",
			Label:            "Gemini",
			UsageUnavailable: true,
		},
	}
	collector.fetchProviders = func(context.Context) ([]codexbar.ParsedFrame, error) {
		return []codexbar.ParsedFrame{unavailable}, nil
	}
	collector.collectOnce(context.Background())
	if frames := collector.providerFrames(current); len(frames) != 1 || frames[0].Provider != "gemini" || !frames[0].Frame.UsageUnavailable || frames[0].Frame.Session != 0 {
		t.Fatalf("expected neutral cold-start Gemini error, got %#v", frames)
	}

	current = current.Add(time.Second)
	collector.fetchProviders = func(context.Context) ([]codexbar.ParsedFrame, error) {
		return []codexbar.ParsedFrame{testParsedFrame("gemini", 73, 21, 3600)}, nil
	}
	collector.collectOnce(context.Background())
	freshAt := current
	collector.fetchProviders = func(context.Context) ([]codexbar.ParsedFrame, error) {
		return []codexbar.ParsedFrame{unavailable}, nil
	}

	for _, age := range []time.Duration{65 * time.Second, 9*time.Minute + 59*time.Second} {
		current = freshAt.Add(age)
		collector.collectOnce(context.Background())
		frames := collector.providerFrames(current)
		if len(frames) != 1 || frames[0].Frame.UsageUnavailable || frames[0].Frame.Session != 73 {
			t.Fatalf("expected buffered last-good values at %s, got %#v", age, frames)
		}
	}

	current = freshAt.Add(10*time.Minute + time.Second)
	collector.collectOnce(context.Background())
	frames := collector.providerFrames(current)
	if len(frames) != 1 || !frames[0].Frame.UsageUnavailable || frames[0].Frame.Session != 0 ||
		len(frames[0].Frame.UsageSlots) != 0 || len(frames[0].Meta.Windows) != 0 {
		t.Fatalf("expected unavailable Gemini with cleared values after ten minutes, got %#v", frames)
	}
	current = freshAt.Add(4 * 24 * time.Hour)
	frames = collector.providerFrames(current)
	if len(frames) != 1 || frames[0].Provider != "gemini" || !frames[0].Frame.UsageUnavailable || frames[0].Frame.Session != 0 ||
		len(frames[0].Frame.UsageSlots) != 0 || len(frames[0].Meta.Windows) != 0 {
		t.Fatalf("expected multi-day support snapshot to keep Gemini as cleared unavailable carrier, got %#v", frames)
	}

	collectedAt := collector.providers["gemini"].Collected
	collector.fetchTokenStats = func(context.Context) (map[string]codexbar.ProviderTokenStats, bool) {
		return map[string]codexbar.ProviderTokenStats{
			"gemini": {SessionTokens: 123, UpdatedAt: current},
		}, true
	}
	collector.collectTokenStatsOnce(context.Background())
	if got := collector.providers["gemini"]; !got.Frame.UsageUnavailable || !got.Collected.Equal(collectedAt) {
		t.Fatalf("token stats made unavailable quota look fresh: %#v", got)
	}

	current = current.Add(time.Second)
	collector.fetchProviders = func(context.Context) ([]codexbar.ParsedFrame, error) {
		return []codexbar.ParsedFrame{testParsedFrame("gemini", 12, 34, 7200)}, nil
	}
	collector.collectOnce(context.Background())
	frames = collector.providerFrames(current)
	if len(frames) != 1 || frames[0].Frame.UsageUnavailable || frames[0].Frame.Session != 12 {
		t.Fatalf("expected immediate recovery from unavailable state, got %#v", frames)
	}
}

func TestProviderCollectorReplacesRateLimitMetadataOnLaterUnavailableResponse(t *testing.T) {
	prepareFastTestEnv(t)

	now := time.Date(2026, 8, 3, 10, 0, 0, 0, time.UTC)
	current := testParsedFrame("claude", 64, 32, 3600)
	collector := &providerCollector{
		now:             func() time.Time { return now },
		logf:            func(string, ...any) {},
		order:           []string{"claude"},
		snapshotMaxAge:  10 * time.Minute,
		persistInterval: time.Minute,
		providers:       make(map[string]providerSnapshot),
		fetchProviders: func(context.Context) ([]codexbar.ParsedFrame, error) {
			return []codexbar.ParsedFrame{current}, nil
		},
	}
	collector.collectOnce(context.Background())

	blockedUntil := now.Add(2 * time.Minute)
	current = codexbar.ParsedFrame{
		Provider:         "claude",
		RateLimited:      true,
		RateLimitedUntil: blockedUntil,
		Frame: protocol.Frame{
			Provider:         "claude",
			UsageUnavailable: true,
		},
	}
	collector.collectOnce(context.Background())
	if got := collector.providers["claude"]; !got.RateLimited || !got.RateLimitedUntil.Equal(blockedUntil) {
		t.Fatalf("expected current rate limit metadata, got %#v", got)
	}

	current.RateLimited = false
	current.RateLimitedUntil = time.Time{}
	collector.collectOnce(context.Background())
	got := collector.providers["claude"]
	if got.RateLimited || !got.RateLimitedUntil.IsZero() || got.Frame.UsageUnavailable || got.Frame.Session != 64 {
		t.Fatalf("later unavailable error must clear only obsolete rate limit metadata, got %#v", got)
	}

	now = now.Add(11 * time.Minute)
	blockedUntil = now.Add(2 * time.Minute)
	current.RateLimited = true
	current.RateLimitedUntil = blockedUntil
	collector.collectOnce(context.Background())
	got = collector.providers["claude"]
	if !got.Frame.UsageUnavailable || !got.RateLimited || !got.RateLimitedUntil.Equal(blockedUntil) {
		t.Fatalf("already unavailable provider did not receive current rate limit metadata: %#v", got)
	}

	current.RateLimited = false
	current.RateLimitedUntil = time.Time{}
	collector.collectOnce(context.Background())
	got = collector.providers["claude"]
	if !got.Frame.UsageUnavailable || got.RateLimited || !got.RateLimitedUntil.IsZero() {
		t.Fatalf("already unavailable provider kept obsolete rate limit metadata: %#v", got)
	}
}

func TestProviderCollectorPreservesTokenStatsAcrossTemporaryFailureAndRecovers(t *testing.T) {
	prepareFastTestEnv(t)

	current := time.Date(2026, 7, 28, 9, 0, 0, 0, time.UTC)
	collector := &providerCollector{
		now:             func() time.Time { return current },
		logf:            func(string, ...any) {},
		order:           []string{"codex"},
		interval:        30 * time.Second,
		snapshotMaxAge:  10 * time.Minute,
		persistInterval: time.Minute,
		providers:       make(map[string]providerSnapshot),
	}

	collector.fetchProviders = func(context.Context) ([]codexbar.ParsedFrame, error) {
		return []codexbar.ParsedFrame{testParsedFrame("codex", 17, 42, 3600)}, nil
	}
	collector.collectOnce(context.Background())
	if frames := collector.providerFrames(current); len(frames) != 1 || frames[0].Frame.TotalTokens != 0 {
		t.Fatalf("expected first usage snapshot without token totals, got %#v", frames)
	}

	collector.fetchTokenStats = func(context.Context) (map[string]codexbar.ProviderTokenStats, bool) {
		return nil, false
	}
	collector.collectTokenStatsOnce(context.Background())
	if got := collector.providers["codex"]; got.Frame.TotalTokens != 0 || got.Meta.Cost != nil {
		t.Fatalf("failed token stats fetch changed the snapshot: %#v", got)
	}

	current = current.Add(time.Second)
	collector.fetchTokenStats = func(context.Context) (map[string]codexbar.ProviderTokenStats, bool) {
		return map[string]codexbar.ProviderTokenStats{
			"codex": {
				SessionTokens: 10,
				WeekTokens:    20,
				TotalTokens:   30,
				UpdatedAt:     current,
				Source:        "codexbar-cost",
				Cost:          &codexbar.ProviderCostUsage{Last30DaysTokens: 30, LatestTokens: 10},
			},
		}, true
	}
	collector.collectTokenStatsOnce(context.Background())
	withTokens := collector.providers["codex"]
	if withTokens.Frame.SessionTokens != 10 || withTokens.Frame.WeekTokens != 20 || withTokens.Frame.TotalTokens != 30 || withTokens.Meta.Cost == nil {
		t.Fatalf("expected successful token stats to enrich existing snapshot, got %#v", withTokens)
	}
	if withTokens.Frame.UsageUnavailable {
		t.Fatalf("token stats recovery should not mark a fresh usage snapshot unavailable: %#v", withTokens)
	}

	current = current.Add(30 * time.Second)
	collector.fetchProviders = func(context.Context) ([]codexbar.ParsedFrame, error) {
		return []codexbar.ParsedFrame{testParsedFrame("codex", 18, 43, 3500)}, nil
	}
	collector.collectOnce(context.Background())
	held := collector.providers["codex"]
	if held.Frame.SessionTokens != 10 || held.Frame.WeekTokens != 20 || held.Frame.TotalTokens != 30 || held.Meta.Cost == nil {
		t.Fatalf("temporary token stats miss erased last-good token totals: %#v", held)
	}

	current = current.Add(time.Second)
	collector.fetchTokenStats = func(context.Context) (map[string]codexbar.ProviderTokenStats, bool) {
		return map[string]codexbar.ProviderTokenStats{
			"codex": {
				SessionTokens: 40,
				WeekTokens:    50,
				TotalTokens:   60,
				UpdatedAt:     current,
				Source:        "codexbar-cost",
				Cost:          &codexbar.ProviderCostUsage{Last30DaysTokens: 60, LatestTokens: 40},
			},
		}, true
	}
	collector.collectTokenStatsOnce(context.Background())
	recovered := collector.providers["codex"]
	if recovered.Frame.SessionTokens != 40 || recovered.Frame.WeekTokens != 50 || recovered.Frame.TotalTokens != 60 {
		t.Fatalf("later successful token stats did not replace last-good totals: %#v", recovered)
	}
}

func TestProviderCollectorTokenStatsDoNotDependOnDeviceTransport(t *testing.T) {
	prepareFastTestEnv(t)

	current := time.Date(2026, 7, 29, 8, 0, 0, 0, time.UTC)
	var tokenFetches int
	collector := &providerCollector{
		now:             func() time.Time { return current },
		logf:            func(string, ...any) {},
		resolvePort:     func(string) (string, error) { return "", errors.New("no usb serial ports found") },
		order:           []string{"codex"},
		interval:        30 * time.Second,
		snapshotMaxAge:  10 * time.Minute,
		persistInterval: time.Minute,
		providers: map[string]providerSnapshot{
			"codex": {
				Provider:  "codex",
				Frame:     protocol.Frame{Provider: "codex", Label: "Codex", Weekly: 42},
				Collected: current,
			},
		},
	}
	collector.fetchTokenStats = func(context.Context) (map[string]codexbar.ProviderTokenStats, bool) {
		tokenFetches++
		return map[string]codexbar.ProviderTokenStats{
			"codex": {
				SessionTokens: 12,
				WeekTokens:    34,
				TotalTokens:   56,
				UpdatedAt:     current,
				Cost:          &codexbar.ProviderCostUsage{UpdatedAt: current, Last30DaysTokens: 56, LatestTokens: 12},
			},
		}, true
	}

	collector.collectTokenStatsOnce(context.Background())

	got := collector.providers["codex"]
	if tokenFetches != 1 || got.Frame.TotalTokens != 56 || got.Meta.Cost == nil {
		t.Fatalf("local token scan must ignore device transport failure, fetches=%d snapshot=%#v", tokenFetches, got)
	}
}

func TestProviderCollectorTokenStatsStartAndWakeTriggers(t *testing.T) {
	prepareFastTestEnv(t)

	current := time.Date(2026, 7, 29, 8, 30, 0, 0, time.UTC)
	var clockNanos atomic.Int64
	clockNanos.Store(current.UnixNano())
	now := func() time.Time {
		return time.Unix(0, clockNanos.Load()).UTC()
	}
	wake := make(chan struct{}, 1)
	afterWake := make(chan struct{}, 2)
	var tokenFetches atomic.Int32
	collector := &providerCollector{
		now:                now,
		logf:               func(string, ...any) {},
		order:              []string{"codex"},
		interval:           time.Hour,
		activityPoll:       time.Hour,
		timeout:            time.Second,
		snapshotMaxAge:     10 * time.Minute,
		persistInterval:    time.Minute,
		tokenStatsCooldown: tokenStatsScanCooldown,
		wake:               wake,
		afterWakeCollect:   func() { afterWake <- struct{}{} },
		providers:          make(map[string]providerSnapshot),
		fetchProviders: func(context.Context) ([]codexbar.ParsedFrame, error) {
			return []codexbar.ParsedFrame{testParsedFrame("codex", 17, 42, 3600)}, nil
		},
	}
	collector.fetchTokenStats = func(context.Context) (map[string]codexbar.ProviderTokenStats, bool) {
		count := tokenFetches.Add(1)
		collectedAt := now()
		return map[string]codexbar.ProviderTokenStats{
			"codex": {
				TotalTokens: int64(100 + count),
				UpdatedAt:   collectedAt,
				Cost:        &codexbar.ProviderCostUsage{UpdatedAt: collectedAt, Last30DaysTokens: int64(100 + count)},
			},
		}, true
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go collector.run(ctx)
	waitForCondition(t, time.Second, func() bool {
		return tokenFetches.Load() == 1
	})
	waitForCondition(t, time.Second, func() bool {
		collector.tokenStatsMu.Lock()
		defer collector.tokenStatsMu.Unlock()
		return !collector.tokenStatsRunning
	})
	clockNanos.Add(int64(time.Minute))
	wake <- struct{}{}
	<-afterWake
	waitForCondition(t, time.Second, func() bool {
		return tokenFetches.Load() == 2
	})
	waitForCondition(t, time.Second, func() bool {
		collector.tokenStatsMu.Lock()
		defer collector.tokenStatsMu.Unlock()
		return !collector.tokenStatsRunning
	})
	collector.mu.RLock()
	afterGrowingHistoryWake := collector.providers["codex"]
	collector.mu.RUnlock()
	if !afterGrowingHistoryWake.Collected.Equal(now()) || !afterGrowingHistoryWake.TokenStatsCollected.Equal(now()) {
		t.Fatalf("manual wake did not refresh growing quota and token history: snapshot=%#v want=%s", afterGrowingHistoryWake, now())
	}

	clockNanos.Add(int64(time.Minute))
	wake <- struct{}{}
	<-afterWake
	if got := tokenFetches.Load(); got != 2 {
		t.Fatalf("manual wake bypassed settled token scan cooldown: fetches=%d", got)
	}
	collector.mu.RLock()
	afterCooldownWake := collector.providers["codex"]
	collector.mu.RUnlock()
	if !afterCooldownWake.Collected.Equal(now()) {
		t.Fatalf("manual wake did not refresh quota snapshot: collected=%s want=%s", afterCooldownWake.Collected, now())
	}
	if !afterCooldownWake.TokenStatsCollected.Equal(afterGrowingHistoryWake.TokenStatsCollected) {
		t.Fatalf("skipped token scan falsely advanced freshness: got=%s want=%s", afterCooldownWake.TokenStatsCollected, afterGrowingHistoryWake.TokenStatsCollected)
	}

	clockNanos.Add(int64(tokenStatsScanCooldown - time.Minute))
	wake <- struct{}{}
	<-afterWake
	waitForCondition(t, time.Second, func() bool {
		return tokenFetches.Load() == 3
	})
	cancel()
	collector.shutdownTokenStatsScan()
}

func TestProviderCollectorTokenStatsFreshnessSemantics(t *testing.T) {
	prepareFastTestEnv(t)

	current := time.Date(2026, 7, 28, 11, 0, 0, 0, time.UTC)
	collector := &providerCollector{
		now:             func() time.Time { return current },
		logf:            func(string, ...any) {},
		order:           []string{"codex"},
		interval:        30 * time.Second,
		snapshotMaxAge:  10 * time.Minute,
		persistInterval: time.Minute,
		providers:       make(map[string]providerSnapshot),
	}
	collector.fetchProviders = func(context.Context) ([]codexbar.ParsedFrame, error) {
		return []codexbar.ParsedFrame{testParsedFrame("codex", 17, 42, 3600)}, nil
	}
	collector.collectOnce(context.Background())

	tokenAt := current
	collector.fetchTokenStats = func(context.Context) (map[string]codexbar.ProviderTokenStats, bool) {
		return map[string]codexbar.ProviderTokenStats{
			"codex": {
				SessionTokens: 10,
				WeekTokens:    20,
				TotalTokens:   30,
				UpdatedAt:     tokenAt,
				Source:        "codexbar-cost",
				Cost:          &codexbar.ProviderCostUsage{UpdatedAt: tokenAt, Last30DaysTokens: 30, LatestTokens: 10, Last30DaysCostUSD: 1.25},
			},
		}, true
	}
	collector.collectTokenStatsOnce(context.Background())

	current = current.Add(2 * time.Minute)
	collector.fetchTokenStats = func(context.Context) (map[string]codexbar.ProviderTokenStats, bool) {
		return nil, false
	}
	collector.collectTokenStatsOnce(context.Background())
	if frames := collector.providerFrames(current); len(frames) != 1 || frames[0].Frame.TotalTokens != 30 || frames[0].Meta.Cost == nil {
		t.Fatalf("temporary token failure did not keep bounded last-good stats: %#v", frames)
	}

	zeroAt := current.Add(time.Minute)
	current = zeroAt
	collector.fetchTokenStats = func(context.Context) (map[string]codexbar.ProviderTokenStats, bool) {
		return map[string]codexbar.ProviderTokenStats{
			"codex": {
				UpdatedAt: zeroAt,
				Source:    "codexbar-cost",
				Cost:      &codexbar.ProviderCostUsage{UpdatedAt: zeroAt},
			},
		}, true
	}
	collector.collectTokenStatsOnce(context.Background())
	zero := collector.providers["codex"]
	if zero.Frame.SessionTokens != 0 || zero.Frame.WeekTokens != 0 || zero.Frame.TotalTokens != 0 || zero.Meta.Cost == nil {
		t.Fatalf("successful zero token result did not replace positive stats: %#v", zero)
	}

	recoveredAt := zeroAt.Add(time.Minute)
	current = recoveredAt
	collector.fetchTokenStats = func(context.Context) (map[string]codexbar.ProviderTokenStats, bool) {
		return map[string]codexbar.ProviderTokenStats{
			"codex": {
				SessionTokens: 40,
				WeekTokens:    50,
				TotalTokens:   60,
				UpdatedAt:     recoveredAt,
				Source:        "codexbar-cost",
				Cost:          &codexbar.ProviderCostUsage{UpdatedAt: recoveredAt, Last30DaysTokens: 60, LatestTokens: 40, Last30DaysCostUSD: 2.5},
			},
		}, true
	}
	collector.collectTokenStatsOnce(context.Background())

	current = recoveredAt.Add(9 * time.Minute)
	collector.fetchProviders = func(context.Context) ([]codexbar.ParsedFrame, error) {
		return []codexbar.ParsedFrame{testParsedFrame("codex", 18, 43, 3500)}, nil
	}
	collector.collectOnce(context.Background())
	freshCarry := collector.providerFrames(current)
	if len(freshCarry) != 1 || freshCarry[0].Frame.Session != 18 || freshCarry[0].Frame.TotalTokens != 60 || freshCarry[0].Meta.Cost == nil {
		t.Fatalf("fresh token stats were not carried across a quota-only refresh: %#v", freshCarry)
	}

	current = recoveredAt.Add(10*time.Minute + time.Second)
	collector.fetchProviders = func(context.Context) ([]codexbar.ParsedFrame, error) {
		return []codexbar.ParsedFrame{testParsedFrame("codex", 19, 44, 3400)}, nil
	}
	collector.collectOnce(context.Background())
	expired := collector.providerFrames(current)
	if len(expired) != 1 || expired[0].Frame.Session != 19 || expired[0].Frame.TotalTokens != 0 || expired[0].Meta.Cost != nil {
		t.Fatalf("quota refresh kept expired token stats alive: %#v", expired)
	}
	if expired[0].Frame.UsageUnavailable {
		t.Fatalf("expired token stats should not make fresh quota usage unavailable: %#v", expired)
	}

	current = current.Add(time.Minute)
	collector.fetchTokenStats = func(context.Context) (map[string]codexbar.ProviderTokenStats, bool) {
		return map[string]codexbar.ProviderTokenStats{
			"cursor": {
				SessionTokens: 1,
				UpdatedAt:     current,
				Source:        "codexbar-cost",
				Cost:          &codexbar.ProviderCostUsage{UpdatedAt: current, LatestTokens: 1},
			},
		}, true
	}
	codexSnapshot := collector.providers["codex"]
	codexSnapshot.Frame.TotalTokens = 99
	codexSnapshot.Meta.Cost = &codexbar.ProviderCostUsage{Last30DaysTokens: 99}
	codexSnapshot.TokenStatsCollected = current
	collector.providers["codex"] = codexSnapshot
	collector.collectTokenStatsOnce(context.Background())
	absent := collector.providers["codex"]
	if absent.Frame.TotalTokens != 0 || absent.Meta.Cost != nil || !absent.TokenStatsCollected.Equal(current) {
		t.Fatalf("successful token scan without provider did not clear stats and mark completion: %#v", absent)
	}

	current = current.Add(time.Minute)
	collector.fetchTokenStats = func(context.Context) (map[string]codexbar.ProviderTokenStats, bool) {
		return map[string]codexbar.ProviderTokenStats{
			"codex": {
				SessionTokens: 70,
				WeekTokens:    80,
				TotalTokens:   90,
				UpdatedAt:     current,
				Source:        "codexbar-cost",
				Cost:          &codexbar.ProviderCostUsage{UpdatedAt: current, Last30DaysTokens: 90, LatestTokens: 70},
			},
		}, true
	}
	collector.collectTokenStatsOnce(context.Background())
	recovered := collector.providerFrames(current)
	if len(recovered) == 0 || recovered[0].Provider != "codex" || recovered[0].Frame.TotalTokens != 90 || recovered[0].Meta.Cost == nil {
		t.Fatalf("provider token recovery did not replace unavailable state: %#v", recovered)
	}
}

func TestProviderCollectorSuccessfulIdleTokenScanRefreshesAtCollectionTime(t *testing.T) {
	prepareFastTestEnv(t)

	current := time.Date(2026, 7, 29, 11, 0, 0, 0, time.UTC)
	activityObservedAt := current.Add(-time.Hour)
	collector := &providerCollector{
		now:            func() time.Time { return current },
		logf:           func(string, ...any) {},
		order:          []string{"codex"},
		snapshotMaxAge: 10 * time.Minute,
		providers: map[string]providerSnapshot{
			"codex": {
				Provider:  "codex",
				Frame:     protocol.Frame{Provider: "codex", Label: "Codex", Weekly: 42},
				Collected: current,
			},
		},
	}
	collector.fetchTokenStats = func(context.Context) (map[string]codexbar.ProviderTokenStats, bool) {
		return map[string]codexbar.ProviderTokenStats{
			"codex": {
				TotalTokens: 99,
				UpdatedAt:   activityObservedAt,
				Cost:        &codexbar.ProviderCostUsage{UpdatedAt: activityObservedAt, Last30DaysTokens: 99},
			},
		}, true
	}

	collector.collectTokenStatsOnce(context.Background())
	firstSuccessfulScan := collector.providers["codex"]
	if !firstSuccessfulScan.TokenStatsCollected.Equal(current) || !firstSuccessfulScan.ActivityObservedAt.Equal(activityObservedAt) {
		t.Fatalf("successful idle scan must refresh totals at collection time without changing activity: %#v", firstSuccessfulScan)
	}

	current = current.Add(9 * time.Minute)
	collector.collectTokenStatsOnce(context.Background())
	secondSuccessfulScan := collector.providers["codex"]
	if !secondSuccessfulScan.TokenStatsCollected.Equal(current) || !secondSuccessfulScan.ActivityObservedAt.Equal(activityObservedAt) {
		t.Fatalf("later successful idle scan did not refresh token freshness independently of activity: %#v", secondSuccessfulScan)
	}

	current = current.Add(9*time.Minute + 30*time.Second)
	collector.fetchTokenStats = func(context.Context) (map[string]codexbar.ProviderTokenStats, bool) {
		return nil, false
	}
	collector.collectTokenStatsOnce(context.Background())
	failedScan := collector.providers["codex"]
	if !failedScan.TokenStatsCollected.Equal(secondSuccessfulScan.TokenStatsCollected) {
		t.Fatalf("failed token scan refreshed last-good token totals: %#v", failedScan)
	}
	if frames := collector.providerFrames(current); len(frames) != 1 || frames[0].Frame.TotalTokens != 99 || frames[0].Meta.Cost == nil {
		t.Fatalf("fresh last-good totals were not retained after a failed scan: %#v", frames)
	}

	current = current.Add(31 * time.Second)
	if frames := collector.providerFrames(current); len(frames) != 1 || frames[0].Frame.TotalTokens != 0 || frames[0].Meta.Cost != nil {
		t.Fatalf("failed scan kept token totals fresh beyond their last successful collection: %#v", frames)
	}
}

func TestProviderCollectorSuccessfulEmptyTokenStatsClearsLastGood(t *testing.T) {
	prepareFastTestEnv(t)

	current := time.Date(2026, 7, 29, 9, 0, 0, 0, time.UTC)
	collector := &providerCollector{
		now:             func() time.Time { return current },
		logf:            func(string, ...any) {},
		order:           []string{"codex"},
		interval:        30 * time.Second,
		snapshotMaxAge:  10 * time.Minute,
		persistInterval: time.Minute,
		providers: map[string]providerSnapshot{
			"codex": {
				Provider:            "codex",
				Frame:               protocol.Frame{Provider: "codex", Label: "Codex", Weekly: 42, TotalTokens: 99},
				Collected:           current,
				TokenStatsCollected: current,
				Meta:                codexbar.ProviderUsageMeta{Cost: &codexbar.ProviderCostUsage{UpdatedAt: current, Last30DaysTokens: 99}},
			},
		},
	}
	collector.fetchTokenStatsReport = func(context.Context) (map[string]codexbar.ProviderTokenStats, codexbar.ProviderTokenStatsReport) {
		return map[string]codexbar.ProviderTokenStats{}, codexbar.ProviderTokenStatsReport{
			OK:     true,
			Reason: "no_providers",
		}
	}

	collector.collectTokenStatsOnce(context.Background())

	got := collector.providers["codex"]
	if got.Frame.TotalTokens != 0 || got.Meta.Cost != nil || !got.TokenStatsCollected.Equal(current) {
		t.Fatalf("successful empty token scan did not clear stats and mark completion: %#v", got)
	}

	current = current.Add(time.Minute)
	collector.fetchProviders = func(context.Context) ([]codexbar.ParsedFrame, error) {
		return []codexbar.ParsedFrame{testParsedFrame("codex", 18, 43, 3500)}, nil
	}
	collector.collectOnce(context.Background())
	got = collector.providers["codex"]
	if got.Frame.TotalTokens != 0 || got.Meta.Cost != nil || !got.TokenStatsCollected.Equal(current.Add(-time.Minute)) {
		t.Fatalf("quota refresh dropped successful empty token completion: %#v", got)
	}

	current = current.Add(10 * time.Minute)
	collector.collectOnce(context.Background())
	if got := collector.providers["codex"]; !got.TokenStatsCollected.IsZero() {
		t.Fatalf("expired empty token completion stayed ready: %#v", got)
	}
}

func TestProviderCollectorPartialTokenScanKeepsFailedProviderLastGood(t *testing.T) {
	prepareFastTestEnv(t)

	current := time.Date(2026, 7, 29, 10, 0, 0, 0, time.UTC)
	oldTokenStats := current.Add(-10*time.Minute + time.Second)
	collector := &providerCollector{
		now:             func() time.Time { return current },
		logf:            func(string, ...any) {},
		order:           []string{"codex", "claude"},
		snapshotMaxAge:  10 * time.Minute,
		persistInterval: time.Minute,
		providers: map[string]providerSnapshot{
			"codex": {
				Provider:  "codex",
				Frame:     protocol.Frame{Provider: "codex", Label: "Codex", Weekly: 42, TotalTokens: 7},
				Collected: current,
			},
			"claude": {
				Provider:            "claude",
				Frame:               protocol.Frame{Provider: "claude", Label: "Claude", Weekly: 31, TotalTokens: 99},
				Collected:           current,
				TokenStatsCollected: oldTokenStats,
				Meta:                codexbar.ProviderUsageMeta{Cost: &codexbar.ProviderCostUsage{UpdatedAt: oldTokenStats, Last30DaysTokens: 99}},
			},
		},
	}
	collector.fetchTokenStatsReport = func(context.Context) (map[string]codexbar.ProviderTokenStats, codexbar.ProviderTokenStatsReport) {
		return map[string]codexbar.ProviderTokenStats{
			"codex": {
				TotalTokens: 12,
				UpdatedAt:   current,
				Cost:        &codexbar.ProviderCostUsage{UpdatedAt: current, Last30DaysTokens: 12},
			},
		}, codexbar.ProviderTokenStatsReport{OK: true, Reason: "success", FailedProviders: []string{"claude"}}
	}

	collector.collectTokenStatsOnce(context.Background())
	if got := collector.providers["claude"]; got.Frame.TotalTokens != 99 || got.Meta.Cost == nil {
		t.Fatalf("partial token scan erased failed provider last-good data: %#v", got)
	}

	current = current.Add(2 * time.Second)
	for _, frame := range collector.providerFrames(current) {
		if frame.Provider == "claude" && (frame.Frame.TotalTokens != 0 || frame.Meta.Cost != nil) {
			t.Fatalf("failed provider token data outlived its freshness bound: %#v", frame)
		}
	}
}

func TestProviderCollectorExpiredQuotaKeepsFreshTokenStats(t *testing.T) {
	prepareFastTestEnv(t)

	now := time.Date(2026, 7, 29, 10, 0, 0, 0, time.UTC)
	collector := &providerCollector{
		now:            func() time.Time { return now },
		logf:           func(string, ...any) {},
		order:          []string{"codex"},
		snapshotMaxAge: 10 * time.Minute,
		providers: map[string]providerSnapshot{
			"codex": {
				Provider: "codex",
				Frame: protocol.Frame{
					Provider:     "codex",
					Label:        "Codex",
					Session:      17,
					Weekly:       42,
					ResetSec:     3600,
					Activity:     "coding",
					TotalTokens:  99,
					UsageSlots:   []protocol.UsageSlot{{ID: "weekly", Label: "Weekly", Percent: 42}},
					UsageWindows: []protocol.UsageWindow{{ID: "weekly", Label: "Weekly", Percent: 42}},
				},
				Collected:           now.Add(-10*time.Minute - time.Second),
				TokenStatsCollected: now,
				ActivityObservedAt:  now,
				Meta: codexbar.ProviderUsageMeta{
					Windows: []codexbar.UsageWindow{{ID: "weekly", Label: "Weekly", UsedPercent: 42}},
					Cost:    &codexbar.ProviderCostUsage{UpdatedAt: now, Last30DaysTokens: 99},
					Status:  &codexbar.ProviderStatus{Description: "Operational"},
				},
			},
		},
	}

	frames := collector.providerFrames(now)
	if len(frames) != 1 {
		t.Fatalf("expected one provider frame, got %#v", frames)
	}
	got := frames[0]
	if !got.Frame.UsageUnavailable || got.Frame.Session != 0 || got.Frame.Weekly != 0 || len(got.Frame.UsageSlots) != 0 || len(got.Meta.Windows) != 0 {
		t.Fatalf("expired quota values were retained: %#v", got)
	}
	if got.Frame.TotalTokens != 99 || got.Meta.Cost == nil || got.Frame.Activity != "coding" || !got.ActivityObservedAt.Equal(now) {
		t.Fatalf("fresh token, cost, or activity data was erased with expired quota: %#v", got)
	}
}

func TestProviderCollectorSlowTokenScanUsesPostCompletionCooldown(t *testing.T) {
	prepareFastTestEnv(t)

	current := time.Date(2026, 7, 28, 12, 0, 0, 0, time.UTC)
	var clockNanos atomic.Int64
	clockNanos.Store(current.UnixNano())
	now := func() time.Time {
		return time.Unix(0, clockNanos.Load()).UTC()
	}
	release := make(chan struct{})
	started := make(chan struct{}, 1)
	var calls atomic.Int32
	var inFlight atomic.Int32
	var maxInFlight atomic.Int32

	collector := &providerCollector{
		now:                now,
		logf:               func(string, ...any) {},
		order:              []string{"codex"},
		interval:           30 * time.Second,
		snapshotMaxAge:     10 * time.Minute,
		persistInterval:    time.Minute,
		tokenStatsCooldown: tokenStatsScanCooldown,
		providers: map[string]providerSnapshot{
			"codex": {
				Provider:  "codex",
				Frame:     protocol.Frame{Provider: "codex", Label: "Codex", Session: 11, Weekly: 22},
				Collected: current,
			},
		},
	}
	collector.fetchTokenStats = func(ctx context.Context) (map[string]codexbar.ProviderTokenStats, bool) {
		active := inFlight.Add(1)
		defer inFlight.Add(-1)
		calls.Add(1)
		for {
			previous := maxInFlight.Load()
			if active <= previous || maxInFlight.CompareAndSwap(previous, active) {
				break
			}
		}
		select {
		case started <- struct{}{}:
		default:
		}
		select {
		case <-release:
			collectedAt := now()
			return map[string]codexbar.ProviderTokenStats{
				"codex": {SessionTokens: 12, WeekTokens: 34, TotalTokens: 56, UpdatedAt: collectedAt},
			}, true
		case <-ctx.Done():
			return nil, false
		}
	}

	if !collector.requestTokenStatsScan(context.Background()) {
		t.Fatal("expected first token scan to start")
	}
	<-started
	for i := 0; i < 5; i++ {
		if collector.requestTokenStatsScan(context.Background()) {
			t.Fatalf("activity tick %d started overlapping token scan", i)
		}
	}
	if got := calls.Load(); got != 1 {
		t.Fatalf("expected one in-flight scan, got %d calls", got)
	}
	if got := maxInFlight.Load(); got != 1 {
		t.Fatalf("expected max one in-flight scan, got %d", got)
	}

	// Model a documented long history scan. The cooldown starts when that scan
	// finishes, not when it started.
	clockNanos.Add(int64(78 * time.Second))
	close(release)
	waitForCondition(t, time.Second, func() bool {
		collector.tokenStatsMu.Lock()
		defer collector.tokenStatsMu.Unlock()
		return !collector.tokenStatsRunning
	})
	if collector.requestTokenStatsScan(context.Background()) {
		t.Fatal("activity tick immediately restarted a completed long token scan")
	}
	clockNanos.Add(int64(tokenStatsScanCooldown - time.Nanosecond))
	if collector.requestTokenStatsScan(context.Background()) {
		t.Fatal("activity tick started a token scan before cooldown expiry")
	}
	clockNanos.Add(int64(time.Nanosecond))
	if !collector.requestTokenStatsScan(context.Background()) {
		t.Fatal("expected token scan to start when cooldown expired")
	}
	collector.shutdownTokenStatsScan()
	if got := calls.Load(); got != 2 {
		t.Fatalf("expected exactly two scans across cooldown, got %d", got)
	}
	if got := maxInFlight.Load(); got != 1 {
		t.Fatalf("expected max one in-flight scan after cooldown, got %d", got)
	}
}

func TestProviderCollectorFailedTokenScanUsesPostCompletionCooldown(t *testing.T) {
	prepareFastTestEnv(t)

	current := time.Date(2026, 7, 28, 12, 15, 0, 0, time.UTC)
	var clockNanos atomic.Int64
	clockNanos.Store(current.UnixNano())
	now := func() time.Time {
		return time.Unix(0, clockNanos.Load()).UTC()
	}
	var calls atomic.Int32
	collector := &providerCollector{
		now:                now,
		logf:               func(string, ...any) {},
		order:              []string{"codex"},
		tokenStatsCooldown: tokenStatsScanCooldown,
		providers: map[string]providerSnapshot{
			"codex": {
				Provider:            "codex",
				Frame:               protocol.Frame{Provider: "codex", Label: "Codex", TotalTokens: 99},
				TokenStatsCollected: current.Add(-time.Minute),
				TokenHistorySettled: true,
			},
		},
		tokenStatsSettled: true,
	}
	previousCollected := collector.providers["codex"].TokenStatsCollected
	collector.fetchTokenStats = func(context.Context) (map[string]codexbar.ProviderTokenStats, bool) {
		calls.Add(1)
		return nil, false
	}

	if !collector.requestTokenStatsScan(context.Background()) {
		t.Fatal("expected first failed token scan to start")
	}
	collector.shutdownTokenStatsScan()
	if got := calls.Load(); got != 1 {
		t.Fatalf("expected one failed token scan, got %d", got)
	}
	collector.tokenStatsMu.Lock()
	settled := collector.tokenStatsSettled
	collector.tokenStatsMu.Unlock()
	if settled {
		t.Fatal("failed token scan must remain unsettled")
	}
	got := collector.providers["codex"]
	if got.Frame.TotalTokens != 99 || !got.TokenStatsCollected.Equal(previousCollected) {
		t.Fatalf("failed token scan changed token freshness or last-good data: %#v", got)
	}
	if collector.requestTokenStatsScan(context.Background()) {
		t.Fatal("activity tick immediately restarted a failed token scan")
	}

	clockNanos.Add(int64(tokenStatsScanCooldown))
	if !collector.requestTokenStatsScan(context.Background()) {
		t.Fatal("expected failed token scan to retry after cooldown")
	}
	collector.shutdownTokenStatsScan()
	if got := calls.Load(); got != 2 {
		t.Fatalf("expected exactly two failed scans across cooldown, got %d", got)
	}
}

func TestProviderCollectorKeepsScanningWhileTokenHistoryStillGrows(t *testing.T) {
	prepareFastTestEnv(t)

	current := time.Date(2026, 7, 30, 11, 35, 0, 0, time.UTC)
	collector := &providerCollector{
		now:                func() time.Time { return current },
		logf:               func(string, ...any) {},
		order:              []string{"codex"},
		interval:           30 * time.Second,
		snapshotMaxAge:     10 * time.Minute,
		persistInterval:    time.Minute,
		tokenStatsCooldown: tokenStatsScanCooldown,
		providers: map[string]providerSnapshot{
			"codex": {
				Provider:  "codex",
				Frame:     protocol.Frame{Provider: "codex", Label: "Codex", Weekly: 42, UsageMode: "used"},
				Collected: current,
			},
		},
	}

	// CodexBar warms its cost scan incrementally: the same request returns more
	// history each time until it stops changing.
	histories := [][]codexbar.ProviderCostDay{
		{{Day: "2026-07-30", TotalTokens: 120}},
		{{Day: "2026-07-29", TotalTokens: 900}, {Day: "2026-07-30", TotalTokens: 120}},
		{{Day: "2026-07-29", TotalTokens: 900}, {Day: "2026-07-30", TotalTokens: 120}},
	}
	scan := 0
	collector.fetchTokenStats = func(context.Context) (map[string]codexbar.ProviderTokenStats, bool) {
		days := histories[min(scan, len(histories)-1)]
		scan++
		var total int64
		for _, day := range days {
			total += day.TotalTokens
		}
		return map[string]codexbar.ProviderTokenStats{
			"codex": {
				TotalTokens: total,
				UpdatedAt:   current,
				Cost:        &codexbar.ProviderCostUsage{UpdatedAt: current, Last30DaysTokens: total, Daily: days},
			},
		}, true
	}

	settled := func() bool {
		collector.tokenStatsMu.Lock()
		defer collector.tokenStatsMu.Unlock()
		return collector.tokenStatsSettled
	}
	snapshotSettled := func() bool {
		collector.mu.RLock()
		defer collector.mu.RUnlock()
		return collector.providers["codex"].TokenHistorySettled
	}

	collector.collectTokenStatsOnce(context.Background())
	if settled() || snapshotSettled() {
		t.Fatal("a first history cannot be settled without a second agreeing scan")
	}
	if !collector.requestTokenStatsScan(context.Background()) {
		t.Fatal("a growing history must not be held back by the completed-scan cooldown")
	}
	collector.shutdownTokenStatsScan()
	if settled() || snapshotSettled() {
		t.Fatal("a grown history must stay unsettled")
	}

	if !collector.requestTokenStatsScan(context.Background()) {
		t.Fatal("expected the correcting scan to start immediately")
	}
	collector.shutdownTokenStatsScan()
	if !settled() || !snapshotSettled() {
		t.Fatal("two agreeing histories must settle the token result")
	}
	if collector.requestTokenStatsScan(context.Background()) {
		t.Fatal("a settled history must fall back to the completed-scan cooldown")
	}
	if got := collector.providers["codex"].Meta.Cost.Last30DaysTokens; got != 1020 {
		t.Fatalf("expected the settled total, got %d", got)
	}
}

func TestTokenHistoryFingerprintSeparatesTodayHistoryFromLiveActivity(t *testing.T) {
	now := time.Date(2026, 7, 30, 11, 35, 0, 0, time.UTC)
	fingerprint := func(todayTokens, latestTokens int64) string {
		return tokenHistoryFingerprint(&codexbar.ProviderCostUsage{
			LatestTokens: latestTokens,
			Daily: []codexbar.ProviderCostDay{{
				Day:         "2026-07-30",
				TotalTokens: todayTokens,
			}},
		}, now)
	}

	if fingerprint(120, 120) != fingerprint(150, 150) {
		t.Fatal("ordinary activity in today's latest session must not keep history unsettled")
	}
	if fingerprint(150, 150) == fingerprint(320, 150) {
		t.Fatal("earlier sessions discovered today must keep history unsettled")
	}
	if got := fingerprint(120, 120); got == "" {
		t.Fatal("today's presence must distinguish a populated history from an empty scan")
	}
}

func TestProviderCollectorAcceptedTokenStatsPersistForImmediateUsageAPIRead(t *testing.T) {
	prepareFastTestEnv(t)

	current := time.Date(2026, 7, 29, 9, 30, 0, 0, time.UTC)
	collector := &providerCollector{
		now:             func() time.Time { return current },
		logf:            func(string, ...any) {},
		order:           []string{"codex"},
		interval:        30 * time.Second,
		snapshotMaxAge:  10 * time.Minute,
		persistInterval: time.Minute,
		providers: map[string]providerSnapshot{
			"codex": {
				Provider:  "codex",
				Frame:     protocol.Frame{Provider: "codex", Label: "Codex", Weekly: 42, UsageMode: "used"},
				Collected: current,
			},
		},
	}
	collector.fetchTokenStats = func(context.Context) (map[string]codexbar.ProviderTokenStats, bool) {
		return map[string]codexbar.ProviderTokenStats{
			"codex": {
				SessionTokens: 12,
				WeekTokens:    34,
				TotalTokens:   56,
				UpdatedAt:     current,
				Cost:          &codexbar.ProviderCostUsage{UpdatedAt: current, Last30DaysTokens: 56, LatestTokens: 12},
			},
		}, true
	}

	collector.collectTokenStatsOnce(context.Background())

	usage, ok := LoadPersistedUsage(current)
	if !ok || len(usage.Providers) != 1 {
		t.Fatalf("expected persisted usage after accepted token scan, ok=%t usage=%#v", ok, usage)
	}
	got := usage.Providers[0]
	if got.Frame.TotalTokens != 56 || got.Meta.Cost == nil || got.TokenStatsCollectedAt.IsZero() {
		t.Fatalf("accepted token stats were not immediately visible through persisted usage: %#v", got)
	}
}

func TestProviderCollectorTokenStatsTimeoutPreservesLastGood(t *testing.T) {
	prepareFastTestEnv(t)

	current := time.Date(2026, 7, 28, 12, 30, 0, 0, time.UTC)
	collector := &providerCollector{
		now:             func() time.Time { return current },
		logf:            func(string, ...any) {},
		order:           []string{"codex"},
		interval:        30 * time.Second,
		snapshotMaxAge:  10 * time.Minute,
		persistInterval: time.Minute,
		providers: map[string]providerSnapshot{
			"codex": {
				Provider:            "codex",
				Frame:               protocol.Frame{Provider: "codex", Label: "Codex", Session: 11, Weekly: 22, TotalTokens: 99},
				Collected:           current,
				TokenStatsCollected: current,
			},
		},
	}
	collector.fetchTokenStats = func(ctx context.Context) (map[string]codexbar.ProviderTokenStats, bool) {
		<-ctx.Done()
		return nil, false
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
	defer cancel()
	collector.collectTokenStatsOnce(ctx)

	got := collector.providers["codex"]
	if got.Frame.TotalTokens != 99 || got.TokenStatsCollected.IsZero() {
		t.Fatalf("timeout erased bounded last-good token stats: %#v", got)
	}
}

func TestProviderCollectorShutdownCancelsTokenScan(t *testing.T) {
	prepareFastTestEnv(t)

	current := time.Date(2026, 7, 28, 13, 0, 0, 0, time.UTC)
	started := make(chan struct{})
	cancelled := make(chan struct{})
	collector := &providerCollector{
		now:             func() time.Time { return current },
		logf:            func(string, ...any) {},
		order:           []string{"codex"},
		interval:        30 * time.Second,
		snapshotMaxAge:  10 * time.Minute,
		persistInterval: time.Minute,
		providers:       make(map[string]providerSnapshot),
	}
	collector.fetchTokenStats = func(ctx context.Context) (map[string]codexbar.ProviderTokenStats, bool) {
		close(started)
		<-ctx.Done()
		close(cancelled)
		return nil, false
	}

	if !collector.requestTokenStatsScan(context.Background()) {
		t.Fatal("expected token scan to start")
	}
	<-started
	collector.shutdownTokenStatsScan()
	select {
	case <-cancelled:
	case <-time.After(time.Second):
		t.Fatal("shutdown did not cancel the token scan")
	}
	collector.fetchTokenStats = func(context.Context) (map[string]codexbar.ProviderTokenStats, bool) {
		return nil, false
	}
	if !collector.requestTokenStatsScan(context.Background()) {
		t.Fatal("expected collector to accept a new scan after shutdown")
	}
	collector.shutdownTokenStatsScan()
}

func TestProviderCollectorDoesNotFallBackToUsageJSONWhenDashboardUnavailable(t *testing.T) {
	prepareFastTestEnv(t)

	cases := []struct {
		name string
		err  error
	}{
		{name: "timeout", err: context.DeadlineExceeded},
		{name: "malformed", err: errors.New("malformed dashboard snapshot")},
		{name: "process exit", err: errors.New("dashboard process exited")},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			current := time.Date(2026, 7, 28, 9, 30, 0, 0, time.UTC)
			fallbackCalls := 0
			dashboardCalls := 0
			collector := &providerCollector{
				now:             func() time.Time { return current },
				logf:            func(string, ...any) {},
				order:           []string{"codex"},
				interval:        30 * time.Second,
				snapshotMaxAge:  10 * time.Minute,
				persistInterval: time.Minute,
				providers:       make(map[string]providerSnapshot),
				dashboard:       staticDashboardServe{info: testDashboardServeInfo(1001)},
				fetchDashboard: func(_ context.Context, _ codexbar.DashboardServeInfo, _ time.Time) ([]codexbar.ParsedFrame, error) {
					dashboardCalls++
					if dashboardCalls == 1 {
						return []codexbar.ParsedFrame{dashboardParsedFrame("codex", "Weekly", "Codex Spark Weekly", 68, 0)}, nil
					}
					return nil, tc.err
				},
				fetchProviders: func(context.Context) ([]codexbar.ParsedFrame, error) {
					fallbackCalls++
					return []codexbar.ParsedFrame{testParsedFrame("codex", 14, 22, 3600)}, nil
				},
			}

			collector.collectOnce(context.Background())
			current = current.Add(9*time.Minute + 59*time.Second)
			collector.collectOnce(context.Background())
			frames := collector.providerFrames(current)
			if dashboardCalls != 2 || fallbackCalls != 0 {
				t.Fatalf("expected dashboard attempts without usage-json fallback, dashboard=%d fallback=%d", dashboardCalls, fallbackCalls)
			}
			if len(frames) != 1 || frames[0].Source != "codexbar-dashboard" || frames[0].Frame.Session != 68 ||
				len(frames[0].Frame.UsageSlots) != 2 || frames[0].Frame.UsageSlots[0].Label != "Weekly" ||
				frames[0].Stale || frames[0].Frame.UsageUnavailable {
				t.Fatalf("expected dashboard snapshot within last-good window unchanged, got %+v", frames)
			}

			current = current.Add(2 * time.Second)
			frames = collector.providerFrames(current)
			if len(frames) != 1 || !frames[0].Frame.UsageUnavailable || frames[0].Frame.Session != 0 ||
				frames[0].Frame.Weekly != 0 || frames[0].Frame.ResetSec != 0 ||
				len(frames[0].Frame.UsageSlots) != 0 || len(frames[0].Meta.Windows) != 0 {
				t.Fatalf("expected expired dashboard snapshot to clear usage values, got %+v", frames)
			}

			collector.fetchDashboard = func(_ context.Context, _ codexbar.DashboardServeInfo, _ time.Time) ([]codexbar.ParsedFrame, error) {
				dashboardCalls++
				return []codexbar.ParsedFrame{dashboardParsedFrame("codex", "Weekly", "Codex Spark Weekly", 21, 7)}, nil
			}
			current = current.Add(time.Second)
			collector.collectOnce(context.Background())
			frames = collector.providerFrames(current)
			if len(frames) != 1 || frames[0].Frame.UsageUnavailable || frames[0].Frame.Session != 21 ||
				len(frames[0].Frame.UsageSlots) != 2 || frames[0].Frame.UsageSlots[0].Label != "Weekly" {
				t.Fatalf("expected fresh dashboard recovery, got %+v", frames)
			}
		})
	}
}

func TestProviderCollectorDashboardNotRunningDoesNotUseUsageJSONFallback(t *testing.T) {
	prepareFastTestEnv(t)

	fallbackCalls := 0
	dashboardCalls := 0
	collector := &providerCollector{
		now:       func() time.Time { return time.Date(2026, 7, 29, 18, 0, 0, 0, time.UTC) },
		logf:      func(string, ...any) {},
		providers: make(map[string]providerSnapshot),
		dashboard: staticDashboardServe{info: codexbar.DashboardServeInfo{}},
		fetchDashboard: func(_ context.Context, _ codexbar.DashboardServeInfo, _ time.Time) ([]codexbar.ParsedFrame, error) {
			dashboardCalls++
			return nil, nil
		},
		fetchProviders: func(context.Context) ([]codexbar.ParsedFrame, error) {
			fallbackCalls++
			return []codexbar.ParsedFrame{testParsedFrame("codex", 14, 22, 3600)}, nil
		},
	}

	providers, source, err := collector.fetchProvidersForCollect(context.Background(), collector.now())
	if err == nil || !strings.Contains(err.Error(), "dashboard serve unavailable") {
		t.Fatalf("expected dashboard unavailable error, got providers=%+v source=%s err=%v", providers, source, err)
	}
	if source != "codexbar-dashboard" {
		t.Fatalf("expected dashboard source, got %q", source)
	}
	if dashboardCalls != 0 || fallbackCalls != 0 {
		t.Fatalf("dashboard not running must not call fetchers, dashboard=%d fallback=%d", dashboardCalls, fallbackCalls)
	}
}

func TestProviderCollectorStartupWithoutDashboardSnapshotDoesNotUseFallback(t *testing.T) {
	prepareFastTestEnv(t)

	current := time.Date(2026, 7, 28, 9, 30, 0, 0, time.UTC)
	fallbackCalls := 0
	collector := &providerCollector{
		now:             func() time.Time { return current },
		logf:            func(string, ...any) {},
		order:           []string{"codex"},
		interval:        30 * time.Second,
		snapshotMaxAge:  10 * time.Minute,
		persistInterval: time.Minute,
		providers:       make(map[string]providerSnapshot),
		dashboard:       staticDashboardServe{info: testDashboardServeInfo(1001)},
		fetchDashboard: func(_ context.Context, _ codexbar.DashboardServeInfo, _ time.Time) ([]codexbar.ParsedFrame, error) {
			return nil, errors.New("connection refused")
		},
		fetchProviders: func(context.Context) ([]codexbar.ParsedFrame, error) {
			fallbackCalls++
			return []codexbar.ParsedFrame{testParsedFrame("codex", 14, 22, 3600)}, nil
		},
	}

	collector.collectOnce(context.Background())
	if fallbackCalls != 0 {
		t.Fatalf("startup dashboard failure used usage-json fallback %d times", fallbackCalls)
	}
	if frames := collector.providerFrames(current); len(frames) != 0 {
		t.Fatalf("startup without a dashboard snapshot must remain unavailable, got %+v", frames)
	}
}

func TestProviderCollectorDashboardOutagePreservesProviderIsolationAndRecovers(t *testing.T) {
	prepareFastTestEnv(t)

	current := time.Date(2026, 7, 28, 9, 30, 0, 0, time.UTC)
	collector := &providerCollector{
		now:             func() time.Time { return current },
		logf:            func(string, ...any) {},
		order:           []string{"codex", "claude"},
		interval:        30 * time.Second,
		snapshotMaxAge:  10 * time.Minute,
		persistInterval: time.Minute,
		providers:       make(map[string]providerSnapshot),
		dashboard:       staticDashboardServe{info: testDashboardServeInfo(1001)},
		fetchDashboard: func(_ context.Context, _ codexbar.DashboardServeInfo, _ time.Time) ([]codexbar.ParsedFrame, error) {
			return []codexbar.ParsedFrame{
				dashboardParsedFrame("codex", "Weekly", "Codex Spark Weekly", 68, 0),
				dashboardParsedFrame("claude", "Session", "Weekly", 12, 34),
			}, nil
		},
		fetchProviders: func(context.Context) ([]codexbar.ParsedFrame, error) {
			t.Fatal("usage-json fallback must not run")
			return nil, nil
		},
	}
	collector.collectOnce(context.Background())

	current = current.Add(10*time.Minute + time.Second)
	collector.fetchDashboard = func(_ context.Context, _ codexbar.DashboardServeInfo, _ time.Time) ([]codexbar.ParsedFrame, error) {
		claude := dashboardParsedFrame("claude", "Session", "Weekly", 22, 44)
		claude.CollectedAt = current
		return []codexbar.ParsedFrame{
			dashboardUnavailableFrame("codex"),
			claude,
		}, nil
	}
	collector.collectOnce(context.Background())
	frames := collector.providerFrames(current)
	if len(frames) != 2 {
		t.Fatalf("expected codex unavailable and claude fresh, got %+v", frames)
	}
	if frames[0].Provider != "codex" || !frames[0].Frame.UsageUnavailable || frames[0].Frame.Session != 0 || len(frames[0].Meta.Windows) != 0 {
		t.Fatalf("expected expired Codex usage to be cleared, got %+v", frames[0])
	}
	if frames[1].Provider != "claude" || frames[1].Frame.UsageUnavailable || frames[1].Frame.Session != 22 || len(frames[1].Meta.Windows) != 2 {
		t.Fatalf("expected Claude to remain fresh while Codex is unavailable, got %+v", frames[1])
	}

	current = current.Add(time.Second)
	collector.fetchDashboard = func(_ context.Context, _ codexbar.DashboardServeInfo, _ time.Time) ([]codexbar.ParsedFrame, error) {
		return []codexbar.ParsedFrame{
			dashboardParsedFrame("codex", "Weekly", "Codex Spark Weekly", 31, 9),
			dashboardParsedFrame("claude", "Session", "Weekly", 23, 45),
		}, nil
	}
	collector.collectOnce(context.Background())
	frames = collector.providerFrames(current)
	if len(frames) != 2 || frames[0].Provider != "codex" || frames[0].Frame.UsageUnavailable ||
		frames[0].Frame.Session != 31 || len(frames[0].Frame.UsageSlots) != 2 {
		t.Fatalf("expected Codex dashboard recovery to replace unavailable state, got %+v", frames)
	}
}

func TestProviderCollectorPreservesFreshPartialUsageAndWindows(t *testing.T) {
	prepareFastTestEnv(t)

	now := time.Date(2026, 7, 24, 8, 0, 0, 0, time.UTC)
	collector := &providerCollector{
		now:             func() time.Time { return now },
		logf:            func(string, ...any) {},
		snapshotMaxAge:  10 * time.Minute,
		persistInterval: time.Minute,
		providers:       make(map[string]providerSnapshot),
		fetchProviders: func(context.Context) ([]codexbar.ParsedFrame, error) {
			return []codexbar.ParsedFrame{{
				Provider: "codex",
				Source:   "oauth",
				Frame: protocol.Frame{
					Provider:           "codex",
					Label:              "Codex",
					Weekly:             57,
					SessionUnavailable: true,
				},
				Meta: codexbar.ProviderUsageMeta{Windows: []codexbar.UsageWindow{
					{ID: "secondary", Label: "Weekly", UsedPercent: 57},
					{ID: "codex-spark-weekly", Label: "Codex Spark Weekly", UsedPercent: 12},
				}},
			}}, nil
		},
	}

	collector.collectOnce(context.Background())
	frames := collector.providerFrames(now)
	if len(frames) != 1 {
		t.Fatalf("expected one partial provider snapshot, got %#v", frames)
	}
	got := frames[0]
	if got.Stale || got.Frame.UsageUnavailable || !got.Frame.SessionUnavailable ||
		got.Frame.WeeklyUnavailable || got.Frame.Weekly != 57 {
		t.Fatalf("partial usage was not kept fresh: %#v", got)
	}
	if !got.CollectedAt.Equal(now) || len(got.Meta.Windows) != 2 ||
		got.Meta.Windows[1].Label != "Codex Spark Weekly" {
		t.Fatalf("partial usage metadata was lost: %#v", got)
	}
}

func TestRunCycleCanSelectPartialActiveProviderWhenCompleteProviderExists(t *testing.T) {
	prepareFastTestEnv(t)

	var sent []byte
	state := &runtimeState{selector: codexbar.NewProviderSelector()}
	state.selector.SetCurrentProvider("codex")
	err := runCycleWithDeps(context.Background(), "", state, runtimeDeps{
		now:         time.Now,
		resolvePort: func(string) (string, error) { return "/dev/cu.usbmodem-test", nil },
		fetchProviders: func(context.Context) ([]codexbar.ParsedFrame, error) {
			return []codexbar.ParsedFrame{
				testParsedFrame("antigravity", 17, 42, 3600),
				{
					Provider: "codex",
					Frame: protocol.Frame{
						Provider:           "codex",
						Label:              "Codex",
						Weekly:             57,
						SessionUnavailable: true,
					},
				},
			}, nil
		},
		sendLine: func(_ string, line []byte) error {
			sent = append([]byte(nil), line...)
			return nil
		},
		logf: func(string, ...any) {},
	})
	if err != nil {
		t.Fatalf("run cycle: %v", err)
	}

	frame := decodeFrameLine(t, sent)
	if frame.Provider != "codex" || frame.UsageUnavailable || !frame.SessionUnavailable ||
		frame.WeeklyUnavailable || frame.Weekly != 57 {
		t.Fatalf("partial sticky provider was excluded from normal selection: %#v", frame)
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

func TestProviderCollectorUsesRuntimeConfigWiFiTarget(t *testing.T) {
	prepareFastTestEnv(t)

	const target = "http://192.168.178.72"
	var resolved string
	deps := runtimeDeps{
		transportName: "wifi",
		now:           func() time.Time { return time.Date(2026, 2, 23, 12, 0, 0, 0, time.UTC) },
		logf:          func(string, ...any) {},
		homeDir:       func() (string, error) { return "/tmp/codexbar-display-test", nil },
		loadConfig: func(string) (runtimeconfig.Config, error) {
			return runtimeconfig.Config{DeviceTarget: target}, nil
		},
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
		Interval:  60 * time.Second,
	})
	collector.collectOnce(context.Background())

	if resolved != target {
		t.Fatalf("expected collector to resolve runtime config target %q, got %q", target, resolved)
	}
	if got := collector.providerFrames(deps.now()); len(got) != 1 {
		t.Fatalf("expected collector to fetch providers, got %#v", got)
	}
}

func TestRunCycleFromCollectorKeepsLastGoodWhenUsageAndInventoryFail(t *testing.T) {
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
		fetchProviders: func(context.Context) ([]codexbar.ParsedFrame, error) {
			return nil, errors.New("temporary usage failure")
		},
		fetchInventory: func(context.Context) ([]codexbar.ProviderSetting, error) {
			return nil, errors.New("temporary inventory failure")
		},
	}
	collector.collectOnce(context.Background())

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
		t.Fatalf("transient usage/inventory failures cleared last-good frame: %+v", frame)
	}
}

func TestRunCycleFromCollectorClearsDisabledLastGoodAndPersistedRestartFallback(t *testing.T) {
	prepareFastTestEnv(t)

	now := time.Date(2026, 7, 24, 12, 0, 0, 0, time.UTC)
	lastGood := protocol.Frame{
		Provider: "future-provider",
		Label:    "Future Provider",
		Session:  61,
		Weekly:   49,
		ResetSec: 3600,
	}
	if err := persistLastGood(lastGood, now.Add(-time.Minute)); err != nil {
		t.Fatalf("persist last good: %v", err)
	}

	deps := runtimeDeps{
		now:         func() time.Time { return now },
		resolvePort: func(string) (string, error) { return "/dev/cu.usbmodem-test", nil },
		logf:        func(string, ...any) {},
	}
	deps = deps.withDefaults()
	state := initializeRuntimeState(now, Options{}, deps)
	if !state.hasLastGood || state.lastGood.Provider != "future-provider" {
		t.Fatalf("expected persisted last good before authoritative inventory, got %+v", state)
	}

	collector := &providerCollector{
		now:            func() time.Time { return now },
		logf:           func(string, ...any) {},
		snapshotMaxAge: 2 * time.Hour,
		providers:      map[string]providerSnapshot{},
		fetchProviders: func(context.Context) ([]codexbar.ParsedFrame, error) {
			return nil, nil
		},
		fetchInventory: func(context.Context) ([]codexbar.ProviderSetting, error) {
			return []codexbar.ProviderSetting{{ID: "future-provider", Enabled: false}}, nil
		},
	}
	collector.collectOnce(context.Background())

	var sentLine []byte
	deps.sendLine = func(_ string, line []byte) error {
		sentLine = append([]byte(nil), line...)
		return nil
	}
	if err := runCycleFromCollector(context.Background(), "", state, collector, deps); err == nil {
		t.Fatal("expected no-providers runtime error after disabling the last provider")
	}

	frame := decodeFrameLine(t, sentLine)
	if frame.Provider == "future-provider" || frame.Error == "" {
		t.Fatalf("disabled last-good frame was sent instead of unavailable error: %+v", frame)
	}
	if state.hasLastGood || state.hasPersistedGood {
		t.Fatalf("disabled last-good state survived authoritative inventory: %+v", state)
	}
	if _, _, ok := loadPersistedLastGoodAnyAge(); ok {
		t.Fatal("disabled last-good file survived authoritative inventory")
	}

	restarted := initializeRuntimeState(now.Add(time.Minute), Options{}, deps)
	if restarted.hasLastGood || restarted.hasPersistedGood {
		t.Fatalf("restart resurrected disabled last-good frame: %+v", restarted)
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

func TestRunDaemonLoopRetriesAfterCycleTimeout(t *testing.T) {
	prepareFastTestEnv(t)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	var logged strings.Builder
	afterCalls := 0
	cycleCalls := 0
	err := runDaemonLoop(ctx, Options{Interval: time.Second}, runtimeDeps{
		now: func() time.Time {
			return time.Date(2026, 2, 23, 12, 0, cycleCalls, 0, time.UTC)
		},
		after: func(time.Duration) <-chan time.Time {
			afterCalls++
			cancel()
			return make(chan time.Time)
		},
		logf: func(format string, args ...any) {
			logged.WriteString(fmt.Sprintf(format, args...))
		},
	}, func(context.Context) error {
		cycleCalls++
		return &RuntimeError{
			Kind: runtimeErrorCycleTimeout,
			Op:   "run-cycle-timeout",
			Err:  errors.New("cycle exceeded timeout"),
		}
	})

	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected loop to stay alive until context cancel, got %v", err)
	}
	if cycleCalls != 1 {
		t.Fatalf("expected one cycle before cancellation, got %d", cycleCalls)
	}
	if afterCalls != 1 {
		t.Fatalf("expected retry wait after timeout, got %d", afterCalls)
	}
	log := logged.String()
	if !strings.Contains(log, "cycle timeout:") {
		t.Fatalf("expected recoverable timeout log, got %q", log)
	}
	if strings.Contains(log, "fatal") || strings.Contains(log, "exit-for-launchd-restart") {
		t.Fatalf("timeout should not be logged as fatal, got %q", log)
	}
}

func TestRunDaemonLoopPausesDeviceCyclesDuringMaintenance(t *testing.T) {
	prepareFastTestEnv(t)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	resume := make(chan time.Time, 1)
	resume <- time.Now()
	var pauseChecks atomic.Int32
	var cycleCalls atomic.Int32
	var logged strings.Builder

	err := runDaemonLoop(ctx, Options{
		Interval: time.Second,
		PauseDeviceWrites: func() bool {
			return pauseChecks.Add(1) == 1
		},
	}, runtimeDeps{
		now: time.Now,
		after: func(time.Duration) <-chan time.Time {
			return resume
		},
		logf: func(format string, args ...any) {
			logged.WriteString(fmt.Sprintf(format, args...))
		},
	}, func(context.Context) error {
		cycleCalls.Add(1)
		cancel()
		return nil
	})

	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected loop cancellation after resumed cycle, got %v", err)
	}
	if got := cycleCalls.Load(); got != 1 {
		t.Fatalf("device cycle calls=%d want 1 after resume", got)
	}
	log := logged.String()
	if !strings.Contains(log, "runtime event=device-writes-paused reason=device-maintenance") {
		t.Fatalf("missing pause log: %q", log)
	}
	if !strings.Contains(log, "runtime event=device-writes-resumed reason=device-maintenance-complete") {
		t.Fatalf("missing resume log: %q", log)
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

func TestApplyProviderDisplaySelectionRestrictsAutomaticPoolAndSkipsUnavailable(t *testing.T) {
	state := &runtimeState{
		selector:    codexbar.NewProviderSelector(),
		lastGood:    protocol.Frame{Provider: "cursor", Session: 88},
		lastGoodAt:  time.Now(),
		hasLastGood: true,
	}
	codex := testParsedFrame("codex", 10, 20, 3600)
	codex.Frame.UsageUnavailable = true
	claude := testParsedFrame("claude", 30, 40, 3600)
	cursor := testParsedFrame("cursor", 50, 60, 3600)
	deps := providerDisplayTestDeps(runtimeconfig.ProviderDisplayConfig{
		Mode:        "automatic",
		ProviderIDs: []string{"codex", "claude"},
	})

	got := applyProviderDisplaySelection(state, []codexbar.ParsedFrame{codex, claude, cursor}, deps)
	if len(got) != 1 || got[0].Frame.Provider != "claude" {
		t.Fatalf("automatic pool selection=%+v want ready claude only", got)
	}
	if state.hasLastGood {
		t.Fatalf("last-good outside pool survived: %+v", state.lastGood)
	}
}

func TestApplyProviderDisplaySelectionKeepsFixedProviderWithoutFallback(t *testing.T) {
	codex := testParsedFrame("codex", 10, 20, 3600)
	codex.Frame.UsageUnavailable = true
	claude := testParsedFrame("claude", 30, 40, 3600)
	deps := providerDisplayTestDeps(runtimeconfig.ProviderDisplayConfig{
		Mode:        "fixed",
		ProviderIDs: []string{"codex"},
	})

	got := applyProviderDisplaySelection(&runtimeState{selector: codexbar.NewProviderSelector()}, []codexbar.ParsedFrame{codex, claude}, deps)
	if len(got) != 1 || got[0].Frame.Provider != "codex" || !got[0].Frame.UsageUnavailable {
		t.Fatalf("fixed selection silently fell back: %+v", got)
	}
}

func providerDisplayTestDeps(display runtimeconfig.ProviderDisplayConfig) runtimeDeps {
	return runtimeDeps{
		homeDir: func() (string, error) { return "/tmp/provider-display-test", nil },
		loadConfig: func(string) (runtimeconfig.Config, error) {
			return runtimeconfig.Config{ProviderDisplay: &display}, nil
		},
	}
}

type staticDashboardServe struct {
	info codexbar.DashboardServeInfo
}

func (s staticDashboardServe) Info() codexbar.DashboardServeInfo {
	return s.info
}

type dashboardServeFunc func() codexbar.DashboardServeInfo

func (f dashboardServeFunc) Info() codexbar.DashboardServeInfo {
	return f()
}

func testDashboardServeInfo(pid int) codexbar.DashboardServeInfo {
	return codexbar.DashboardServeInfo{
		Endpoint: "http://127.0.0.1:50000",
		Token:    "test-token",
		Healthy:  true,
		Running:  true,
		PID:      pid,
	}
}

func dashboardParsedFrame(provider, firstLabel, secondLabel string, firstPercent, secondPercent int) codexbar.ParsedFrame {
	return codexbar.ParsedFrame{
		Provider: provider,
		Source:   "codexbar-dashboard",
		Frame: protocol.Frame{
			Provider: provider,
			Label:    provider,
			Session:  firstPercent,
			Weekly:   secondPercent,
			UsageSlots: []protocol.UsageSlot{
				{ID: "weekly", Label: firstLabel, Percent: firstPercent, ResetSec: 3600},
				{ID: "codex-spark-weekly", Label: secondLabel, Percent: secondPercent, ResetSec: 3600},
			},
		},
		Meta: codexbar.ProviderUsageMeta{Windows: []codexbar.UsageWindow{
			{ID: "weekly", Label: firstLabel, UsedPercent: firstPercent, ResetSec: 3600},
			{ID: "codex-spark-weekly", Label: secondLabel, UsedPercent: secondPercent, ResetSec: 3600},
		}},
	}
}

func dashboardUnavailableFrame(provider string) codexbar.ParsedFrame {
	return codexbar.ParsedFrame{
		Provider: provider,
		Source:   "codexbar-dashboard",
		Stale:    true,
		Frame: protocol.Frame{
			Provider:         provider,
			Label:            provider,
			UsageUnavailable: true,
		},
	}
}

func prepareFastTestEnv(t *testing.T) {
	t.Helper()

	tmpHome := t.TempDir()
	t.Setenv("HOME", tmpHome)
	t.Setenv("CODEXBAR_DISPLAY_CHROMIUM_COOKIE_DB_PATHS", tmpHome+"/missing-cookies.db")
}

func waitForCondition(t *testing.T, timeout time.Duration, ready func() bool) {
	t.Helper()

	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if ready() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	if ready() {
		return
	}
	t.Fatal("condition was not met before timeout")
}

// Until the first collection since runtime start completes, an empty collector
// is warm-up, not a no-providers verdict: the cycle waits instead of sending
// the error frame that Control Center reports as provider_setup_required.
func TestRunCycleFromCollectorWaitsForFirstCollectionBeforeNoProviders(t *testing.T) {
	prepareFastTestEnv(t)

	now := time.Date(2026, 8, 25, 12, 0, 0, 0, time.UTC)
	state := &runtimeState{selector: codexbar.NewProviderSelector()}
	collector := &providerCollector{
		now:            func() time.Time { return now },
		logf:           func(string, ...any) {},
		snapshotMaxAge: 2 * time.Hour,
		providers:      map[string]providerSnapshot{},
		warmupUntil:    now.Add(2 * time.Minute),
	}

	sent := false
	var logged []string
	err := runCycleFromCollector(context.Background(), "", state, collector, runtimeDeps{
		now:         func() time.Time { return now },
		resolvePort: func(string) (string, error) { return "/dev/cu.usbmodem-test", nil },
		sendLine: func(string, []byte) error {
			sent = true
			return nil
		},
		logf: func(format string, args ...any) {
			logged = append(logged, fmt.Sprintf(format, args...))
		},
	})
	if err != nil {
		t.Fatalf("warm-up must not fail the cycle, got %v", err)
	}
	if sent {
		t.Fatal("warm-up must not send a no-providers frame")
	}
	found := false
	for _, line := range logged {
		if strings.Contains(line, "reason=collector-warming") {
			found = true
		}
	}
	if !found {
		t.Fatalf("the waiting cycle must say why it waits, got %v", logged)
	}
}

// Past the warm-up bound a collection that never completed reports its own
// failure kind instead of flattening into no-providers: a Mac whose usage
// engine cannot be read is not a Mac without providers.
func TestRunCycleFromCollectorReportsFetchErrorKindPastWarmup(t *testing.T) {
	prepareFastTestEnv(t)

	now := time.Date(2026, 8, 25, 12, 0, 0, 0, time.UTC)
	state := &runtimeState{selector: codexbar.NewProviderSelector()}
	// Started, window expired, every fetch failed so far: the collector state
	// after a whole warm-up window of failing collections. collectOnce cannot
	// stage this directly because starting a collection re-anchors the window.
	collector := &providerCollector{
		now:                 func() time.Time { return now },
		logf:                func(string, ...any) {},
		snapshotMaxAge:      2 * time.Hour,
		providers:           map[string]providerSnapshot{},
		warmupUntil:         now.Add(-time.Second),
		firstCollectStarted: true,
		lastFetchErr:        &codexbar.FetchError{Kind: codexbar.FetchErrorCommand, Err: errors.New("engine unreadable")},
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
	var runtimeErr *RuntimeError
	if !errors.As(err, &runtimeErr) || runtimeErr.Kind != runtimeErrorCodexbarCmd {
		t.Fatalf("expected the collector failure to keep its own kind, got %v", err)
	}
	frame := decodeFrameLine(t, sentLine)
	if frame.Error == string(errcode.RuntimeNoProviders) {
		t.Fatalf("an unreadable engine must not claim no-providers: %+v", frame)
	}
}

func TestRunCycleFromCollectorReportsTimeoutWhileFirstCollectionStillRunsPastWarmup(t *testing.T) {
	prepareFastTestEnv(t)

	now := time.Date(2026, 8, 25, 12, 0, 0, 0, time.UTC)
	state := &runtimeState{selector: codexbar.NewProviderSelector()}
	collector := &providerCollector{
		now:                 func() time.Time { return now },
		logf:                func(string, ...any) {},
		snapshotMaxAge:      2 * time.Hour,
		providers:           map[string]providerSnapshot{},
		warmupUntil:         now.Add(-time.Second),
		firstCollectStarted: true,
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
	var runtimeErr *RuntimeError
	if !errors.As(err, &runtimeErr) || runtimeErr.Kind != runtimeErrorCodexbarCmd {
		t.Fatalf("expected an overlong first collection to report a collection error, got %v", err)
	}
	frame := decodeFrameLine(t, sentLine)
	if frame.Error == string(errcode.RuntimeNoProviders) {
		t.Fatalf("an in-flight collection must not claim no-providers: %+v", frame)
	}
}

func TestFirstCollectionWarmupStartsWhenCollectionStarts(t *testing.T) {
	prepareFastTestEnv(t)

	startedAt := time.Date(2026, 8, 25, 12, 10, 0, 0, time.UTC)
	collector := &providerCollector{
		providers:   map[string]providerSnapshot{},
		warmupUntil: startedAt.Add(-5 * time.Minute),
	}
	collector.beginFirstCollect(startedAt)
	if first := collector.firstCollectState(startedAt); !first.warming || !first.started {
		t.Fatalf("the warm-up window must restart with the first real collection, until=%v", collector.warmupUntil)
	}
	want := startedAt.Add(collectorWarmupMaxAge())
	if !collector.warmupUntil.Equal(want) {
		t.Fatalf("unexpected first-collection warm-up bound: got=%v want=%v", collector.warmupUntil, want)
	}
}

// Once CodexBar has answered -- even with nothing usable -- the no-providers
// verdict stands regardless of the warm-up bound. The hosted guest matrix
// depends on a provider-less Mac still sending this honest error frame.
func TestRunCycleFromCollectorKeepsNoProvidersVerdictAfterFirstCollection(t *testing.T) {
	prepareFastTestEnv(t)

	now := time.Date(2026, 8, 25, 12, 0, 0, 0, time.UTC)
	state := &runtimeState{selector: codexbar.NewProviderSelector()}
	collector := &providerCollector{
		now:            func() time.Time { return now },
		logf:           func(string, ...any) {},
		snapshotMaxAge: 2 * time.Hour,
		providers:      map[string]providerSnapshot{},
		warmupUntil:    now.Add(2 * time.Minute),
		fetchProviders: func(context.Context) ([]codexbar.ParsedFrame, error) {
			return nil, nil
		},
	}
	collector.collectOnce(context.Background())

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
	var runtimeErr *RuntimeError
	if !errors.As(err, &runtimeErr) || runtimeErr.Kind != runtimeErrorNoProviders {
		t.Fatalf("a completed empty collection is the genuine no-providers state, got %v", err)
	}
	frame := decodeFrameLine(t, sentLine)
	if frame.Error != string(errcode.RuntimeNoProviders) {
		t.Fatalf("the honest error frame must reach the device: %+v", frame)
	}
}

// `daemon --once` runs one support cycle and reports what it finds now; the
// warm-up wait belongs to the continuous runtime only.
func TestNewProviderCollectorSkipsWarmupForOnce(t *testing.T) {
	prepareFastTestEnv(t)

	deps := runtimeDeps{
		now:  func() time.Time { return time.Date(2026, 8, 25, 12, 0, 0, 0, time.UTC) },
		logf: func(string, ...any) {},
	}
	if collector := newProviderCollector(deps, Options{Once: true}); !collector.warmupUntil.IsZero() {
		t.Fatalf("--once must not wait out a warm-up window, got %v", collector.warmupUntil)
	}
	if collector := newProviderCollector(deps, Options{}); collector.warmupUntil.IsZero() {
		t.Fatal("the continuous runtime must get a warm-up window")
	}
}

// The hosted guest matrix greps `error code=runtime/no-providers` from a
// provider-less `daemon --once`: without a warm-up window the immediate
// verdict must stay exactly that, even while the collector's first fetch --
// which on a fresh Mac includes the first-run provider detection -- is still
// running.
func TestRunCycleFromCollectorOnceKeepsNoProvidersWhileFirstCollectionRuns(t *testing.T) {
	prepareFastTestEnv(t)

	now := time.Date(2026, 8, 25, 12, 0, 0, 0, time.UTC)
	state := &runtimeState{selector: codexbar.NewProviderSelector()}
	deps := runtimeDeps{
		now:  func() time.Time { return now },
		logf: func(string, ...any) {},
	}
	collector := newProviderCollector(deps, Options{Once: true})
	collector.now = func() time.Time { return now }
	collector.logf = func(string, ...any) {}
	// The single cycle races the collector startup; the collector is still
	// inside its first fetch and has neither settled nor errored.
	collector.mu.Lock()
	collector.firstCollectStarted = true
	collector.mu.Unlock()

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
	var runtimeErr *RuntimeError
	if !errors.As(err, &runtimeErr) || runtimeErr.Kind != runtimeErrorNoProviders {
		t.Fatalf("--once must keep the immediate no-providers verdict, got %v", err)
	}
	frame := decodeFrameLine(t, sentLine)
	if frame.Error != string(errcode.RuntimeNoProviders) {
		t.Fatalf("--once must send the honest no-providers frame, got %+v", frame)
	}
}

// Pairing can happen long after the warm-up window anchored at runtime start
// has passed. Until the device gate lets the collector ask CodexBar even once,
// there is nothing to report -- fabricating a collection error here painted a
// CodexBar failure onto the exact post-pairing window #405 removes.
func TestRunCycleFromCollectorWaitsWhenFirstCollectionNeverStarted(t *testing.T) {
	prepareFastTestEnv(t)

	now := time.Date(2026, 8, 25, 12, 0, 0, 0, time.UTC)
	state := &runtimeState{selector: codexbar.NewProviderSelector()}
	collector := &providerCollector{
		now:            func() time.Time { return now },
		logf:           func(string, ...any) {},
		snapshotMaxAge: 2 * time.Hour,
		providers:      map[string]providerSnapshot{},
		warmupUntil:    now.Add(-time.Minute),
	}

	sent := false
	var logged []string
	err := runCycleFromCollector(context.Background(), "", state, collector, runtimeDeps{
		now:         func() time.Time { return now },
		resolvePort: func(string) (string, error) { return "/dev/cu.usbmodem-test", nil },
		sendLine: func(string, []byte) error {
			sent = true
			return nil
		},
		logf: func(format string, args ...any) {
			logged = append(logged, fmt.Sprintf(format, args...))
		},
	})
	if err != nil || sent {
		t.Fatalf("a never-started collection is not an answer: err=%v sent=%t", err, sent)
	}
	found := false
	for _, line := range logged {
		if strings.Contains(line, "reason=collector-warming") {
			found = true
		}
	}
	if !found {
		t.Fatalf("the waiting cycle must say why it waits, got %v", logged)
	}
}

// The very first fetch on a cold start fails instantly with "dashboard serve
// unavailable" while the serve is still booting. That transport failure must
// not settle the first collection, or the warm-up never waits on exactly the
// production path it exists for.
func TestFirstCollectionDoesNotSettleOnTransportError(t *testing.T) {
	prepareFastTestEnv(t)

	now := time.Date(2026, 8, 25, 12, 0, 0, 0, time.UTC)
	collector := &providerCollector{
		now:            func() time.Time { return now },
		logf:           func(string, ...any) {},
		snapshotMaxAge: 2 * time.Hour,
		providers:      map[string]providerSnapshot{},
		warmupUntil:    now.Add(2 * time.Minute),
		fetchProviders: func(context.Context) ([]codexbar.ParsedFrame, error) {
			return nil, errors.New("dashboard serve unavailable")
		},
	}
	collector.collectOnce(context.Background())

	first := collector.firstCollectState(now)
	if first.settled {
		t.Fatal("a transport failure is not a CodexBar answer and must not settle")
	}
	if !first.warming || !first.started || first.fetchErr == nil {
		t.Fatalf("the failed attempt keeps warming with its error retained: %+v", first)
	}
}
