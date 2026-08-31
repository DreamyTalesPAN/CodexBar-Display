package health

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimeconfig"
)

func TestParseLaunchctlStatus(t *testing.T) {
	output := `
com.codexbar-display.daemon = {
	state = running
	pid = 12345
}`

	state, pid := parseLaunchctlStatus(output)
	if state != "running" {
		t.Fatalf("expected running state, got %q", state)
	}
	if pid != "12345" {
		t.Fatalf("expected pid 12345, got %q", pid)
	}
}

func TestExtractSentFramePort(t *testing.T) {
	line := "2026-02-26T10:00:00Z sent frame -> /dev/cu.usbserial-10 provider=codex label=Codex"
	port := extractSentFramePort(line)
	if port != "/dev/cu.usbserial-10" {
		t.Fatalf("expected serial path, got %q", port)
	}
}

func TestParseLaunchAgentConfig(t *testing.T) {
	plist := []byte(`<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>com.codexbar-display.daemon</string>
    <key>ProgramArguments</key>
    <array>
      <string>/Users/test/bin/codexbar-display</string>
      <string>daemon</string>
      <string>--interval</string>
      <string>60s</string>
      <string>--transport</string>
      <string>wifi</string>
      <string>--target</string>
      <string>http://192.0.2.10</string>
    </array>
  </dict>
</plist>`)

	config := parseLaunchAgentConfig(plist)
	if config.Transport != "wifi" {
		t.Fatalf("expected wifi transport, got %q", config.Transport)
	}
	if config.Target != "http://192.0.2.10" {
		t.Fatalf("expected 192.0.2.10 target, got %q", config.Target)
	}
}

func TestRunWithDepsReportsWiFiLaunchAgentWithoutUSBPortError(t *testing.T) {
	home := t.TempDir()
	plistPath := filepath.Join(home, "Library", "LaunchAgents", launchAgentLabel+".plist")
	outLogPath := filepath.Join(home, appSupportLogSubdir, defaultOutLogName)
	errLogPath := filepath.Join(home, appSupportLogSubdir, defaultErrLogName)
	outLog := strings.Join([]string{
		`2026-05-03T15:19:35Z cycle error: code=runtime/serial-write op=send-line err=post frame timeout`,
		`2026-05-03T15:29:49Z sent frame -> http://192.168.178.66 transport=wifi source=codexbar provider=codex label=Vibe TV`,
	}, "\n")
	plist := []byte(`<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
  <dict>
    <key>ProgramArguments</key>
    <array>
      <string>/Users/test/bin/codexbar-display</string>
      <string>daemon</string>
      <string>--transport</string>
      <string>wifi</string>
      <string>--target</string>
      <string>http://192.0.2.10</string>
    </array>
  </dict>
</plist>`)

	var output strings.Builder
	readCableStatusCalled := false
	err := runWithDeps(context.Background(), deps{
		stdout:  &output,
		uid:     func() int { return 501 },
		homeDir: func() (string, error) { return home, nil },
		runCommand: func(context.Context, string, ...string) (string, error) {
			return "state = running\npid = 54146", nil
		},
		readCableCapabilities: func() (protocol.DeviceCapabilities, error) {
			readCableStatusCalled = true
			return protocol.DeviceCapabilities{}, errors.New("no Cable status")
		},
		readFile: func(path string) ([]byte, error) {
			switch path {
			case plistPath:
				return plist, nil
			case outLogPath:
				return []byte(outLog), nil
			case errLogPath:
				return nil, errors.New("missing")
			default:
				return nil, errors.New("unexpected path")
			}
		},
	})
	if err != nil {
		t.Fatalf("runWithDeps returned error: %v", err)
	}
	if readCableStatusCalled {
		t.Fatalf("expected WiFi health to skip USB port resolution")
	}

	got := output.String()
	for _, want := range []string{
		"transport: wifi",
		"device target: http://192.0.2.10",
		"last sent frame: 2026-05-03T15:29:49Z target=http://192.168.178.66",
		"last error: none since last sent frame",
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("expected output to contain %q, got:\n%s", want, got)
		}
	}
	for _, unwanted := range []string{"detected port:", "no usb serial ports found", "last error: 2026-05-03T15:19:35Z"} {
		if strings.Contains(got, unwanted) {
			t.Fatalf("expected output not to contain %q, got:\n%s", unwanted, got)
		}
	}
}

func TestRunWithDepsUsesBundledRuntimeWiFiSelection(t *testing.T) {
	home := t.TempDir()
	var output strings.Builder
	cableCalled := false
	printedService := ""
	err := runWithDeps(context.Background(), deps{
		stdout:           &output,
		uid:              func() int { return 501 },
		launchAgentLabel: "com.vibetv.preview.runtime",
		homeDir:          func() (string, error) { return home, nil },
		runCommand: func(_ context.Context, _ string, args ...string) (string, error) {
			if len(args) > 1 && args[0] == "print" {
				printedService = args[1]
			}
			return "state = running\npid = 54146", nil
		},
		loadRuntimeConfig: func(string) (runtimeconfig.Config, error) {
			return runtimeconfig.Config{ConnectionMode: "wifi", DeviceTarget: "http://192.0.2.20"}, nil
		},
		readCableCapabilities: func() (protocol.DeviceCapabilities, error) {
			cableCalled = true
			return protocol.DeviceCapabilities{}, errors.New("unexpected Cable read")
		},
		readFile: func(string) ([]byte, error) { return nil, os.ErrNotExist },
	})
	if err != nil {
		t.Fatal(err)
	}
	if cableCalled {
		t.Fatal("bundled WiFi health must not call the Cable status reader")
	}
	if printedService != "gui/501/com.vibetv.preview.runtime" {
		t.Fatalf("health inspected %q instead of the selected runtime label", printedService)
	}
	got := output.String()
	if !strings.Contains(got, "transport: wifi") || !strings.Contains(got, "device target: http://192.0.2.20") {
		t.Fatalf("bundled WiFi selection was ignored:\n%s", got)
	}
}

func TestRunWithDepsReadsCableIdentityFromRunningCompanion(t *testing.T) {
	home := t.TempDir()
	plistPath := filepath.Join(home, "Library", "LaunchAgents", launchAgentLabel+".plist")
	var output strings.Builder
	err := runWithDeps(context.Background(), deps{
		stdout:  &output,
		uid:     func() int { return 501 },
		homeDir: func() (string, error) { return home, nil },
		runCommand: func(context.Context, string, ...string) (string, error) {
			return "state = running\npid = 54146", nil
		},
		readCableCapabilities: func() (protocol.DeviceCapabilities, error) {
			return protocol.DeviceCapabilities{
				DeviceID:        "vibetv-cable",
				Board:           "esp8266-smalltv-st7789",
				Firmware:        "1.0.55",
				ActiveTransport: "usb",
				ConnectionMode:  "cable",
			}, nil
		},
		readFile: func(path string) ([]byte, error) {
			if path == plistPath {
				return []byte(`<plist><dict><key>ProgramArguments</key><array><string>codexbar-display</string><string>daemon</string><string>--transport</string><string>usb</string></array></dict></plist>`), nil
			}
			return nil, errors.New("missing")
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	got := output.String()
	if !strings.Contains(got, "Cable device: vibetv-cable board=esp8266-smalltv-st7789 firmware=1.0.55") {
		t.Fatalf("running Companion identity missing from health output:\n%s", got)
	}
	if strings.Contains(got, "detected port") {
		t.Fatalf("health still reports a separately opened serial port:\n%s", got)
	}
}

func TestFindLastMatchingEvent(t *testing.T) {
	logBody := strings.Join([]string{
		"2026-02-26T09:59:00Z cycle error: kind=serial-write",
		"2026-02-26T10:00:00Z sent frame -> /dev/cu.usbserial-10 provider=codex",
		"",
	}, "\n")

	event := findLastSentFrameEvent("/tmp/out.log", func(string) ([]byte, error) {
		return []byte(logBody), nil
	})
	if !strings.Contains(event.Line, "sent frame ->") {
		t.Fatalf("expected sent frame line, got %q", event.Line)
	}
	if event.Timestamp.IsZero() {
		t.Fatalf("expected parsed timestamp")
	}
}

func TestLatestEventPrefersNewerTimestamp(t *testing.T) {
	oldEvent := logEvent{
		Line:      "2026-02-26T10:00:00Z cycle error: old",
		Timestamp: time.Date(2026, 2, 26, 10, 0, 0, 0, time.UTC),
	}
	newEvent := logEvent{
		Line:      "2026-02-26T10:01:00Z cycle error: new",
		Timestamp: time.Date(2026, 2, 26, 10, 1, 0, 0, time.UTC),
	}

	chosen := latestEvent(oldEvent, newEvent)
	if chosen.Line != newEvent.Line {
		t.Fatalf("expected newer event, got %q", chosen.Line)
	}
}
