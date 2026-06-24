package setup

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/errcode"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimeconfig"
	transportlayer "github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/transport"
)

type commandCall struct {
	dir  string
	name string
	args []string
}

func TestRunWithDepsInstallsCodexbarAndCompletesSetup(t *testing.T) {
	tmp := t.TempDir()
	home := filepath.Join(tmp, "home")
	repo := filepath.Join(tmp, "repo")
	execPath := filepath.Join(tmp, "bin", "codexbar-display-source")
	codexbarPath := "/Applications/CodexBar.app/Contents/Helpers/CodexBarCLI"

	mustWriteFile(t, filepath.Join(repo, "firmware_esp32", "platformio.ini"), []byte("[env]"), 0o644)
	mustWriteFile(t, filepath.Join(repo, "companion", "go.mod"), []byte("module test"), 0o644)
	mustWriteFile(t, execPath, []byte("binary-content"), 0o755)

	var stdout bytes.Buffer
	var calls []commandCall
	findCount := 0

	err := runWithDeps(context.Background(), Options{Transport: "usb"}, deps{
		stdin:  strings.NewReader("2\n"),
		stdout: &stdout,
		cwd: func() (string, error) {
			return filepath.Join(repo, "companion"), nil
		},
		executablePath: func() (string, error) {
			return execPath, nil
		},
		homeDir: func() (string, error) {
			return home, nil
		},
		uid: func() int { return 501 },
		listPorts: func() ([]string, error) {
			return []string{"/dev/cu.usbmodem101", "/dev/cu.usbserial42"}, nil
		},
		resolvePort: func(port string) (string, error) {
			return port, nil
		},
		probePort: func(string) error { return nil },
		findCodexbar: func() (string, error) {
			findCount++
			if findCount == 1 {
				return "", errors.New("missing")
			}
			return codexbarPath, nil
		},
		lookPath: func(file string) (string, error) {
			switch file {
			case "brew", "pio", "open", "launchctl":
				return "/usr/bin/" + file, nil
			default:
				return "", errors.New("not found")
			}
		},
		isInteractive: func() bool { return true },
		runCommand: func(_ context.Context, dir string, name string, args ...string) (string, error) {
			calls = append(calls, commandCall{
				dir:  dir,
				name: name,
				args: append([]string(nil), args...),
			})
			if name == "launchctl" && len(args) > 0 && args[0] == "print" {
				return "state = running", nil
			}
			return "", nil
		},
	})
	if err != nil {
		t.Fatalf("expected setup success, got %v", err)
	}

	if !strings.Contains(stdout.String(), "Setup complete.") {
		t.Fatalf("expected setup completion output, got:\n%s", stdout.String())
	}

	if !commandSeen(calls, "brew", []string{"install", "--cask", codexbarBrewCask}) {
		t.Fatalf("expected brew install call, got %#v", calls)
	}

	if !commandSeen(calls, execPath, []string{"upgrade", "--port", "/dev/cu.usbserial42", "--firmware-env", firmwareEnvironment}) {
		t.Fatalf("expected release firmware upgrade call with selected port, got %#v", calls)
	}

	if !commandSeen(calls, "launchctl", []string{"bootstrap", "gui/501", filepath.Join(home, "Library", "LaunchAgents", launchAgentLabel+".plist")}) {
		t.Fatalf("expected launchctl bootstrap call, got %#v", calls)
	}

	installedBinary := filepath.Join(home, "Library", "Application Support", "codexbar-display", "bin", "codexbar-display")
	installedData, readErr := os.ReadFile(installedBinary)
	if readErr != nil {
		t.Fatalf("read installed binary: %v", readErr)
	}
	if string(installedData) != "binary-content" {
		t.Fatalf("unexpected installed binary content: %q", string(installedData))
	}

	plistPath := filepath.Join(home, "Library", "LaunchAgents", launchAgentLabel+".plist")
	plistData, readErr := os.ReadFile(plistPath)
	if readErr != nil {
		t.Fatalf("read plist: %v", readErr)
	}
	plist := string(plistData)
	if strings.Contains(plist, "<string>/dev/cu.usbserial42</string>") {
		t.Fatalf("expected unpinned launch agent by default, got:\n%s", plist)
	}
	if strings.Contains(plist, "<string>--port</string>") {
		t.Fatalf("expected no --port flag in plist by default, got:\n%s", plist)
	}
	if !strings.Contains(plist, "<string>"+xmlEscape(installedBinary)+"</string>") {
		t.Fatalf("expected installed binary in plist, got:\n%s", plist)
	}
}

func TestRunWithDepsPinsDaemonPortWhenRequested(t *testing.T) {
	home := t.TempDir()
	execPath := mustCreateExecutable(t)

	err := runWithDeps(context.Background(), Options{
		Transport:     "usb",
		Port:          "/dev/cu.usbserial10",
		AssumeYes:     true,
		SkipFlash:     true,
		PinDaemonPort: true,
	}, deps{
		stdin:  strings.NewReader(""),
		stdout: &bytes.Buffer{},
		executablePath: func() (string, error) {
			return execPath, nil
		},
		homeDir: func() (string, error) {
			return home, nil
		},
		uid: func() int { return 501 },
		resolvePort: func(p string) (string, error) {
			return p, nil
		},
		probePort: func(string) error { return nil },
		findCodexbar: func() (string, error) {
			return "/opt/homebrew/bin/codexbar", nil
		},
		lookPath: func(file string) (string, error) {
			if file == "launchctl" {
				return "/bin/launchctl", nil
			}
			return "", errors.New("not found")
		},
		runCommand: func(_ context.Context, _ string, name string, args ...string) (string, error) {
			if name == "launchctl" && len(args) > 0 && args[0] == "print" {
				return "state = running", nil
			}
			return "", nil
		},
	})
	if err != nil {
		t.Fatalf("expected setup success, got %v", err)
	}

	plistPath := filepath.Join(home, "Library", "LaunchAgents", launchAgentLabel+".plist")
	plistData, readErr := os.ReadFile(plistPath)
	if readErr != nil {
		t.Fatalf("read plist: %v", readErr)
	}
	plist := string(plistData)
	if !strings.Contains(plist, "<string>--port</string>") {
		t.Fatalf("expected --port flag in pinned plist, got:\n%s", plist)
	}
	if !strings.Contains(plist, "<string>/dev/cu.usbserial10</string>") {
		t.Fatalf("expected pinned serial path in plist, got:\n%s", plist)
	}
}

func TestRunWithDepsConfiguresWiFiLaunchAgentTarget(t *testing.T) {
	home := t.TempDir()
	execPath := mustCreateExecutable(t)

	err := runWithDeps(context.Background(), Options{
		Transport: "wifi",
		Target:    "192.168.178.66/",
		AssumeYes: true,
		SkipFlash: true,
	}, deps{
		stdin:  strings.NewReader(""),
		stdout: &bytes.Buffer{},
		executablePath: func() (string, error) {
			return execPath, nil
		},
		homeDir: func() (string, error) {
			return home, nil
		},
		uid: func() int { return 501 },
		listPorts: func() ([]string, error) {
			t.Fatalf("wifi setup must not list serial ports")
			return nil, nil
		},
		resolvePort: func(string) (string, error) {
			t.Fatalf("wifi setup must not resolve serial ports")
			return "", nil
		},
		probePort: func(string) error {
			t.Fatalf("wifi setup must not probe serial ports")
			return nil
		},
		readDeviceHello: func(string) (protocol.DeviceHello, error) {
			t.Fatalf("wifi setup must not read USB device hello")
			return protocol.DeviceHello{}, nil
		},
		discoverWiFi: noSetupWiFiDiscovery(t),
		findCodexbar: func() (string, error) {
			return "/opt/homebrew/bin/codexbar", nil
		},
		lookPath: func(file string) (string, error) {
			if file == "launchctl" {
				return "/bin/launchctl", nil
			}
			return "", errors.New("not found")
		},
		runCommand: func(_ context.Context, _ string, name string, args ...string) (string, error) {
			if name == "launchctl" && len(args) > 0 && args[0] == "print" {
				return "state = running", nil
			}
			return "", nil
		},
	})
	if err != nil {
		t.Fatalf("expected setup success, got %v", err)
	}

	plistPath := filepath.Join(home, "Library", "LaunchAgents", launchAgentLabel+".plist")
	plistData, readErr := os.ReadFile(plistPath)
	if readErr != nil {
		t.Fatalf("read plist: %v", readErr)
	}
	plist := string(plistData)
	if !strings.Contains(plist, "<string>--transport</string>") ||
		!strings.Contains(plist, "<string>wifi</string>") ||
		!strings.Contains(plist, "<string>--target</string>") ||
		!strings.Contains(plist, "<string>http://192.168.178.66</string>") {
		t.Fatalf("expected WiFi launch agent target in plist, got:\n%s", plist)
	}
	if strings.Contains(plist, "<string>--port</string>") {
		t.Fatalf("expected no serial port flag in WiFi plist, got:\n%s", plist)
	}
}

func TestRunWithDepsPersistsWiFiTargetAndTokenInRuntimeConfig(t *testing.T) {
	home := t.TempDir()
	execPath := mustCreateExecutable(t)
	var stdout bytes.Buffer

	err := runWithDeps(context.Background(), Options{
		Transport: "wifi",
		Target:    "192.168.178.66?token=pair-token-123",
		AssumeYes: true,
		SkipFlash: true,
	}, deps{
		stdin:  strings.NewReader(""),
		stdout: &stdout,
		executablePath: func() (string, error) {
			return execPath, nil
		},
		homeDir: func() (string, error) {
			return home, nil
		},
		uid: func() int { return 501 },
		listPorts: func() ([]string, error) {
			t.Fatalf("wifi setup must not list serial ports")
			return nil, nil
		},
		resolvePort: func(string) (string, error) {
			t.Fatalf("wifi setup must not resolve serial ports")
			return "", nil
		},
		discoverWiFi: noSetupWiFiDiscovery(t),
		findCodexbar: func() (string, error) {
			return "/opt/homebrew/bin/codexbar", nil
		},
		lookPath: func(file string) (string, error) {
			if file == "launchctl" {
				return "/bin/launchctl", nil
			}
			return "", errors.New("not found")
		},
		runCommand: func(_ context.Context, _ string, name string, args ...string) (string, error) {
			if name == "launchctl" && len(args) > 0 && args[0] == "print" {
				return "state = running", nil
			}
			return "", nil
		},
	})
	if err != nil {
		t.Fatalf("expected setup success, got %v", err)
	}

	cfg, err := runtimeconfig.Load(home)
	if err != nil {
		t.Fatalf("load runtime config: %v", err)
	}
	if cfg.DeviceTarget != "http://192.168.178.66" || cfg.DeviceToken != "pair-token-123" {
		t.Fatalf("unexpected runtime device config: %+v", cfg)
	}

	plistPath := filepath.Join(home, "Library", "LaunchAgents", launchAgentLabel+".plist")
	plistData, readErr := os.ReadFile(plistPath)
	if readErr != nil {
		t.Fatalf("read plist: %v", readErr)
	}
	plist := string(plistData)
	if strings.Contains(plist, "pair-token-123") || strings.Contains(stdout.String(), "pair-token-123") {
		t.Fatalf("pairing token must not be written to plist or setup output, plist:\n%s\nstdout:\n%s", plist, stdout.String())
	}
	if !strings.Contains(plist, "<string>http://192.168.178.66</string>") {
		t.Fatalf("expected public WiFi target in plist, got:\n%s", plist)
	}
}

func TestRunWithDepsDefaultsToWiFiLaunchAgentTarget(t *testing.T) {
	home := t.TempDir()
	execPath := mustCreateExecutable(t)

	err := runWithDeps(context.Background(), Options{
		AssumeYes: true,
		SkipFlash: true,
	}, deps{
		stdin:  strings.NewReader(""),
		stdout: &bytes.Buffer{},
		executablePath: func() (string, error) {
			return execPath, nil
		},
		homeDir: func() (string, error) {
			return home, nil
		},
		uid: func() int { return 501 },
		listPorts: func() ([]string, error) {
			t.Fatalf("default setup must not list serial ports")
			return nil, nil
		},
		resolvePort: func(string) (string, error) {
			t.Fatalf("default setup must not resolve serial ports")
			return "", nil
		},
		discoverWiFi: noSetupWiFiDiscovery(t),
		findCodexbar: func() (string, error) {
			return "/opt/homebrew/bin/codexbar", nil
		},
		lookPath: func(file string) (string, error) {
			if file == "launchctl" {
				return "/bin/launchctl", nil
			}
			return "", errors.New("not found")
		},
		runCommand: func(_ context.Context, _ string, name string, args ...string) (string, error) {
			if name == "launchctl" && len(args) > 0 && args[0] == "print" {
				return "state = running", nil
			}
			return "", nil
		},
	})
	if err != nil {
		t.Fatalf("expected default WiFi setup success, got %v", err)
	}

	plistPath := filepath.Join(home, "Library", "LaunchAgents", launchAgentLabel+".plist")
	plistData, readErr := os.ReadFile(plistPath)
	if readErr != nil {
		t.Fatalf("read plist: %v", readErr)
	}
	plist := string(plistData)
	if !strings.Contains(plist, "<string>--transport</string>") ||
		!strings.Contains(plist, "<string>wifi</string>") ||
		!strings.Contains(plist, "<string>--target</string>") ||
		!strings.Contains(plist, "<string>http://vibetv.local</string>") {
		t.Fatalf("expected default WiFi launch agent target in plist, got:\n%s", plist)
	}
}

func TestRunWithDepsDiscoversWiFiIPWhenDefaultMDNSIsUnreliable(t *testing.T) {
	home := t.TempDir()
	execPath := mustCreateExecutable(t)
	var gotCandidates []string
	var stdout bytes.Buffer

	err := runWithDeps(context.Background(), Options{
		AssumeYes: true,
		SkipFlash: true,
	}, deps{
		stdin:  strings.NewReader(""),
		stdout: &stdout,
		executablePath: func() (string, error) {
			return execPath, nil
		},
		homeDir: func() (string, error) {
			return home, nil
		},
		uid: func() int { return 501 },
		listPorts: func() ([]string, error) {
			t.Fatalf("default WiFi setup must not list serial ports")
			return nil, nil
		},
		resolvePort: func(string) (string, error) {
			t.Fatalf("default WiFi setup must not resolve serial ports")
			return "", nil
		},
		discoverWiFi: func(_ context.Context, candidates []string) (transportlayer.WiFiDiscoveryResult, error) {
			gotCandidates = append([]string(nil), candidates...)
			return transportlayer.WiFiDiscoveryResult{
				Target: "http://192.168.178.159",
				Hello:  protocol.DeviceHello{Kind: "hello", Board: "esp8266-smalltv-st7789", ProtocolVersion: 2},
				Source: "network-scan",
			}, nil
		},
		findCodexbar: func() (string, error) {
			return "/opt/homebrew/bin/codexbar", nil
		},
		lookPath: func(file string) (string, error) {
			if file == "launchctl" {
				return "/bin/launchctl", nil
			}
			return "", errors.New("not found")
		},
		runCommand: func(_ context.Context, _ string, name string, args ...string) (string, error) {
			if name == "launchctl" && len(args) > 0 && args[0] == "print" {
				return "state = running", nil
			}
			return "", nil
		},
	})
	if err != nil {
		t.Fatalf("expected setup success, got %v", err)
	}
	if !containsString(gotCandidates, defaultWiFiTarget) {
		t.Fatalf("expected default target candidate, got %#v", gotCandidates)
	}

	plistPath := filepath.Join(home, "Library", "LaunchAgents", launchAgentLabel+".plist")
	plistData, readErr := os.ReadFile(plistPath)
	if readErr != nil {
		t.Fatalf("read plist: %v", readErr)
	}
	plist := string(plistData)
	if !strings.Contains(plist, "<string>http://192.168.178.159</string>") {
		t.Fatalf("expected discovered IP target in plist, got:\n%s", plist)
	}

	cfg, err := runtimeconfig.Load(home)
	if err != nil {
		t.Fatalf("load runtime config: %v", err)
	}
	if cfg.DeviceTarget != "http://192.168.178.159" {
		t.Fatalf("expected discovered device target, got %+v", cfg)
	}
	if !strings.Contains(stdout.String(), "USB-C only powers") ||
		!strings.Contains(stdout.String(), "discovered at http://192.168.178.159") {
		t.Fatalf("expected customer-facing WiFi discovery output, got:\n%s", stdout.String())
	}
}

func TestRunWithDepsWritesRuntimeThemeConfig(t *testing.T) {
	home := t.TempDir()
	execPath := mustCreateExecutable(t)

	err := runWithDeps(context.Background(), Options{
		Transport: "usb",
		Port:      "/dev/cu.usbserial10",
		AssumeYes: true,
		SkipFlash: true,
		Theme:     "crt",
	}, deps{
		stdin:  strings.NewReader(""),
		stdout: &bytes.Buffer{},
		executablePath: func() (string, error) {
			return execPath, nil
		},
		homeDir: func() (string, error) {
			return home, nil
		},
		uid: func() int { return 501 },
		resolvePort: func(p string) (string, error) {
			return p, nil
		},
		probePort: func(string) error { return nil },
		findCodexbar: func() (string, error) {
			return "/opt/homebrew/bin/codexbar", nil
		},
		lookPath: func(file string) (string, error) {
			if file == "launchctl" {
				return "/bin/launchctl", nil
			}
			return "", errors.New("not found")
		},
		runCommand: func(_ context.Context, _ string, name string, args ...string) (string, error) {
			if name == "launchctl" && len(args) > 0 && args[0] == "print" {
				return "state = running", nil
			}
			return "", nil
		},
	})
	if err != nil {
		t.Fatalf("expected setup success, got %v", err)
	}

	cfg, err := runtimeconfig.Load(home)
	if err != nil {
		t.Fatalf("load runtime config: %v", err)
	}
	if cfg.Theme != "crt" {
		t.Fatalf("expected persisted theme override crt, got %q", cfg.Theme)
	}
}

func TestRunWithDepsWritesDefaultMiniThemeConfigWhenUnset(t *testing.T) {
	home := t.TempDir()
	execPath := mustCreateExecutable(t)

	err := runWithDeps(context.Background(), Options{
		Transport: "usb",
		Port:      "/dev/cu.usbserial10",
		AssumeYes: true,
		SkipFlash: true,
	}, deps{
		stdin:  strings.NewReader(""),
		stdout: &bytes.Buffer{},
		executablePath: func() (string, error) {
			return execPath, nil
		},
		homeDir: func() (string, error) {
			return home, nil
		},
		uid: func() int { return 501 },
		resolvePort: func(p string) (string, error) {
			return p, nil
		},
		probePort: func(string) error { return nil },
		findCodexbar: func() (string, error) {
			return "/opt/homebrew/bin/codexbar", nil
		},
		lookPath: func(file string) (string, error) {
			if file == "launchctl" {
				return "/bin/launchctl", nil
			}
			return "", errors.New("not found")
		},
		runCommand: func(_ context.Context, _ string, name string, args ...string) (string, error) {
			if name == "launchctl" && len(args) > 0 && args[0] == "print" {
				return "state = running", nil
			}
			return "", nil
		},
	})
	if err != nil {
		t.Fatalf("expected setup success, got %v", err)
	}

	cfg, err := runtimeconfig.Load(home)
	if err != nil {
		t.Fatalf("load runtime config: %v", err)
	}
	if cfg.Theme != "mini" {
		t.Fatalf("expected default persisted theme override mini, got %q", cfg.Theme)
	}
}

func TestRunWithDepsRejectsBluetoothOnlyPortsWhenUnset(t *testing.T) {
	home := t.TempDir()
	execPath := mustCreateExecutable(t)

	err := runWithDeps(context.Background(), Options{
		Transport: "usb",
		AssumeYes: true,
		SkipFlash: true,
	}, deps{
		stdin:  strings.NewReader(""),
		stdout: &bytes.Buffer{},
		executablePath: func() (string, error) {
			return execPath, nil
		},
		homeDir: func() (string, error) {
			return home, nil
		},
		uid: func() int { return 501 },
		listPorts: func() ([]string, error) {
			return []string{
				"/dev/cu.Bluetooth-Incoming-Port",
				"/dev/cu.iPhone-WirelessiAP",
			}, nil
		},
		findCodexbar: func() (string, error) {
			return "/opt/homebrew/bin/codexbar", nil
		},
		lookPath: func(file string) (string, error) {
			if file == "launchctl" {
				return "/bin/launchctl", nil
			}
			return "", errors.New("not found")
		},
		runCommand: func(_ context.Context, _ string, name string, args ...string) (string, error) {
			if name == "launchctl" && len(args) > 0 && args[0] == "print" {
				return "state = running", nil
			}
			return "", nil
		},
	})
	if err == nil {
		t.Fatalf("expected setup to fail without usb serial ports")
	}
	if !strings.Contains(err.Error(), "no usb serial ports found") {
		t.Fatalf("expected usb serial error, got %v", err)
	}
}

func TestRunWithDepsKeepsExistingThemeWhenUnset(t *testing.T) {
	home := t.TempDir()
	execPath := mustCreateExecutable(t)

	if err := runtimeconfig.Save(home, runtimeconfig.Config{Theme: "crt"}); err != nil {
		t.Fatalf("seed runtime config: %v", err)
	}

	err := runWithDeps(context.Background(), Options{
		Transport: "usb",
		Port:      "/dev/cu.usbserial10",
		AssumeYes: true,
		SkipFlash: true,
	}, deps{
		stdin:  strings.NewReader(""),
		stdout: &bytes.Buffer{},
		executablePath: func() (string, error) {
			return execPath, nil
		},
		homeDir: func() (string, error) {
			return home, nil
		},
		uid: func() int { return 501 },
		resolvePort: func(p string) (string, error) {
			return p, nil
		},
		probePort: func(string) error { return nil },
		findCodexbar: func() (string, error) {
			return "/opt/homebrew/bin/codexbar", nil
		},
		lookPath: func(file string) (string, error) {
			if file == "launchctl" {
				return "/bin/launchctl", nil
			}
			return "", errors.New("not found")
		},
		runCommand: func(_ context.Context, _ string, name string, args ...string) (string, error) {
			if name == "launchctl" && len(args) > 0 && args[0] == "print" {
				return "state = running", nil
			}
			return "", nil
		},
	})
	if err != nil {
		t.Fatalf("expected setup success, got %v", err)
	}

	cfg, err := runtimeconfig.Load(home)
	if err != nil {
		t.Fatalf("load runtime config: %v", err)
	}
	if cfg.Theme != "crt" {
		t.Fatalf("expected existing theme override to stay crt, got %q", cfg.Theme)
	}
}

func TestRunWithDepsPersistsWiFiTargetInRuntimeConfig(t *testing.T) {
	home := t.TempDir()
	execPath := mustCreateExecutable(t)

	if err := runtimeconfig.Save(home, runtimeconfig.Config{
		Theme:        "crt",
		DeviceTarget: "http://192.168.178.163",
		DeviceToken:  "pair-token",
	}); err != nil {
		t.Fatalf("seed runtime config: %v", err)
	}

	err := runWithDeps(context.Background(), Options{
		Transport: "wifi",
		Target:    "http://192.168.178.72",
		AssumeYes: true,
		SkipFlash: true,
	}, deps{
		stdin:  strings.NewReader(""),
		stdout: &bytes.Buffer{},
		executablePath: func() (string, error) {
			return execPath, nil
		},
		homeDir: func() (string, error) {
			return home, nil
		},
		uid:          func() int { return 501 },
		discoverWiFi: noSetupWiFiDiscovery(t),
		findCodexbar: func() (string, error) {
			return "/opt/homebrew/bin/codexbar", nil
		},
		lookPath: func(file string) (string, error) {
			if file == "launchctl" {
				return "/bin/launchctl", nil
			}
			return "", errors.New("not found")
		},
		runCommand: func(_ context.Context, _ string, name string, args ...string) (string, error) {
			if name == "launchctl" && len(args) > 0 && args[0] == "print" {
				return "state = running", nil
			}
			return "", nil
		},
	})
	if err != nil {
		t.Fatalf("expected setup success, got %v", err)
	}

	cfg, err := runtimeconfig.Load(home)
	if err != nil {
		t.Fatalf("load runtime config: %v", err)
	}
	if cfg.DeviceTarget != "http://192.168.178.72" {
		t.Fatalf("expected runtime config target to follow setup target, got %q", cfg.DeviceTarget)
	}
	if cfg.Theme != "crt" {
		t.Fatalf("expected existing theme override to stay crt, got %q", cfg.Theme)
	}
	if cfg.DeviceToken != "pair-token" {
		t.Fatalf("expected device token to be preserved, got %q", cfg.DeviceToken)
	}

	plistPath := filepath.Join(home, "Library", "LaunchAgents", launchAgentLabel+".plist")
	plistData, readErr := os.ReadFile(plistPath)
	if readErr != nil {
		t.Fatalf("read plist: %v", readErr)
	}
	if !strings.Contains(string(plistData), "<string>http://192.168.178.72</string>") {
		t.Fatalf("expected launch agent target to match runtime config, got:\n%s", string(plistData))
	}
}

func TestRunWithDepsContinuesWhenSkipFlashAndProbeFails(t *testing.T) {
	home := t.TempDir()
	execPath := mustCreateExecutable(t)
	var stdout bytes.Buffer

	err := runWithDeps(context.Background(), Options{
		Transport: "usb",
		Port:      "/dev/cu.usbserial10",
		AssumeYes: true,
		SkipFlash: true,
		Theme:     "mini",
	}, deps{
		stdin:  strings.NewReader(""),
		stdout: &stdout,
		executablePath: func() (string, error) {
			return execPath, nil
		},
		homeDir: func() (string, error) {
			return home, nil
		},
		uid: func() int { return 501 },
		resolvePort: func(p string) (string, error) {
			return p, nil
		},
		probePort: func(string) error {
			return errors.New("serial close timeout")
		},
		findCodexbar: func() (string, error) {
			return "/opt/homebrew/bin/codexbar", nil
		},
		lookPath: func(file string) (string, error) {
			if file == "launchctl" {
				return "/bin/launchctl", nil
			}
			return "", errors.New("not found")
		},
		runCommand: func(_ context.Context, _ string, name string, args ...string) (string, error) {
			if name == "launchctl" && len(args) > 0 && args[0] == "print" {
				return "state = running", nil
			}
			return "", nil
		},
	})
	if err != nil {
		t.Fatalf("expected setup success for --skip-flash probe fallback, got %v", err)
	}
	if !strings.Contains(stdout.String(), "warning: serial probe failed") {
		t.Fatalf("expected warning in output, got:\n%s", stdout.String())
	}
}

func TestRunWithDepsFailsPreflightWhenLaunchctlMissing(t *testing.T) {
	err := runWithDeps(context.Background(), Options{SkipFlash: true, AssumeYes: true}, deps{
		stdin:  strings.NewReader(""),
		stdout: &bytes.Buffer{},
		lookPath: func(file string) (string, error) {
			if file == "launchctl" {
				return "", errors.New("not found")
			}
			return "/usr/bin/" + file, nil
		},
		findCodexbar: func() (string, error) {
			t.Fatalf("preflight should fail before CodexBar detection")
			return "", nil
		},
	})
	if err == nil {
		t.Fatalf("expected setup preflight failure")
	}
	if got := errcode.Of(err); got != errcode.SetupDependencyPreflight {
		t.Fatalf("expected dependency preflight code, got %s", got)
	}
	msg := err.Error()
	if !strings.Contains(msg, "missing dependency \"launchctl\"") {
		t.Fatalf("expected launchctl dependency message, got %q", msg)
	}
	if !strings.Contains(msg, "starts and restarts the VibeTV background service") {
		t.Fatalf("expected why-it-is-needed text, got %q", msg)
	}
	if !strings.Contains(msg, "rerun `codexbar-display setup`") {
		t.Fatalf("expected concrete recovery action, got %q", msg)
	}
}

func TestRunWithDepsFailsPreflightWhenPlatformIOMissingForUSBFlash(t *testing.T) {
	err := runWithDeps(context.Background(), Options{Transport: "usb", AssumeYes: true}, deps{
		stdin:  strings.NewReader(""),
		stdout: &bytes.Buffer{},
		lookPath: func(file string) (string, error) {
			switch file {
			case "launchctl":
				return "/bin/launchctl", nil
			case "pio":
				return "", errors.New("not found")
			default:
				return "/usr/bin/" + file, nil
			}
		},
		findCodexbar: func() (string, error) {
			t.Fatalf("preflight should fail before CodexBar detection")
			return "", nil
		},
	})
	if err == nil {
		t.Fatalf("expected setup preflight failure")
	}
	if got := errcode.Of(err); got != errcode.SetupDependencyPreflight {
		t.Fatalf("expected dependency preflight code, got %s", got)
	}
	msg := err.Error()
	if !strings.Contains(msg, "missing dependency \"pio\"") {
		t.Fatalf("expected pio dependency message, got %q", msg)
	}
	if !strings.Contains(msg, "release firmware over USB") {
		t.Fatalf("expected why-it-is-needed text, got %q", msg)
	}
	if !strings.Contains(msg, "python3 -m pip install --user platformio") {
		t.Fatalf("expected PlatformIO install action, got %q", msg)
	}
}

func TestRunWithDepsFailsWithRecoveryWhenCodexbarInstallNotPossible(t *testing.T) {
	var calls []commandCall
	err := runWithDeps(context.Background(), Options{SkipFlash: true, AssumeYes: true}, deps{
		stdin:  strings.NewReader(""),
		stdout: &bytes.Buffer{},
		executablePath: func() (string, error) {
			return mustCreateExecutable(t), nil
		},
		homeDir: func() (string, error) {
			return t.TempDir(), nil
		},
		uid:          func() int { return 501 },
		listPorts:    func() ([]string, error) { return []string{"/dev/cu.usbmodem101"}, nil },
		resolvePort:  func(p string) (string, error) { return p, nil },
		probePort:    func(string) error { return nil },
		discoverWiFi: noSetupWiFiDiscovery(t),
		findCodexbar: func() (string, error) {
			return "", errors.New("missing")
		},
		lookPath: func(file string) (string, error) {
			if file == "launchctl" || file == "open" {
				return "/usr/bin/open", nil
			}
			return "", errors.New("not found")
		},
		runCommand: func(_ context.Context, dir string, name string, args ...string) (string, error) {
			calls = append(calls, commandCall{
				dir:  dir,
				name: name,
				args: append([]string(nil), args...),
			})
			return "", nil
		},
	})
	if err == nil {
		t.Fatalf("expected setup failure when CodexBar cannot be installed")
	}

	msg := err.Error()
	if !strings.Contains(msg, "codexbar-install") {
		t.Fatalf("expected codexbar-install error, got %q", msg)
	}
	if !strings.Contains(msg, "brew install --cask "+codexbarBrewCask) {
		t.Fatalf("expected brew recovery hint, got %q", msg)
	}
	if !commandSeen(calls, "open", []string{codexbarInstallURL}) {
		t.Fatalf("expected setup to open CodexBar install page, got %#v", calls)
	}
}

func TestRunWithDepsRejectsInvalidInteractivePortSelection(t *testing.T) {
	err := runWithDeps(context.Background(), Options{Transport: "usb", SkipFlash: true}, deps{
		stdin:  strings.NewReader("9\n"),
		stdout: &bytes.Buffer{},
		executablePath: func() (string, error) {
			return mustCreateExecutable(t), nil
		},
		homeDir: func() (string, error) {
			return t.TempDir(), nil
		},
		uid:           func() int { return 501 },
		isInteractive: func() bool { return true },
		listPorts: func() ([]string, error) {
			return []string{"/dev/cu.usbmodem101", "/dev/cu.usbmodem102"}, nil
		},
		resolvePort: func(p string) (string, error) { return p, nil },
		probePort:   func(string) error { return nil },
		findCodexbar: func() (string, error) {
			return "/opt/homebrew/bin/codexbar", nil
		},
		lookPath: func(file string) (string, error) {
			switch file {
			case "launchctl":
				return "/bin/launchctl", nil
			default:
				return "", errors.New("not found")
			}
		},
		runCommand: func(_ context.Context, _ string, name string, args ...string) (string, error) {
			if name == "launchctl" && len(args) > 0 && args[0] == "print" {
				return "state = running", nil
			}
			return "", nil
		},
	})
	if err == nil {
		t.Fatalf("expected invalid port selection error")
	}
	if !strings.Contains(err.Error(), "invalid selection") {
		t.Fatalf("expected invalid selection message, got %q", err.Error())
	}
}

func TestRunWithDepsReportsFlashFailureWithConcreteHint(t *testing.T) {
	tmp := t.TempDir()
	home := filepath.Join(tmp, "home")
	repo := filepath.Join(tmp, "repo")
	execPath := filepath.Join(tmp, "bin", "codexbar-display-source")

	mustWriteFile(t, filepath.Join(repo, "firmware_esp32", "platformio.ini"), []byte("[env]"), 0o644)
	mustWriteFile(t, filepath.Join(repo, "companion", "go.mod"), []byte("module test"), 0o644)
	mustWriteFile(t, execPath, []byte("binary-content"), 0o755)

	err := runWithDeps(context.Background(), Options{Transport: "usb", AssumeYes: true}, deps{
		stdin:  strings.NewReader(""),
		stdout: &bytes.Buffer{},
		cwd: func() (string, error) {
			return filepath.Join(repo, "companion"), nil
		},
		executablePath: func() (string, error) {
			return execPath, nil
		},
		homeDir: func() (string, error) {
			return home, nil
		},
		uid: func() int { return 501 },
		listPorts: func() ([]string, error) {
			return []string{"/dev/cu.usbmodem101"}, nil
		},
		resolvePort: func(p string) (string, error) { return p, nil },
		probePort:   func(string) error { return nil },
		findCodexbar: func() (string, error) {
			return "/opt/homebrew/bin/codexbar", nil
		},
		lookPath: func(file string) (string, error) {
			switch file {
			case "pio", "brew", "open", "launchctl":
				return "/usr/bin/" + file, nil
			default:
				return "", errors.New("not found")
			}
		},
		runCommand: func(_ context.Context, _ string, name string, args ...string) (string, error) {
			if name == execPath {
				return "Failed to connect to ESP32-S3: Resource busy", errors.New("exit status 1")
			}
			return "", nil
		},
	})
	if err == nil {
		t.Fatalf("expected flash failure")
	}

	msg := err.Error()
	if !strings.Contains(msg, "flash-firmware") {
		t.Fatalf("expected flash-firmware step error, got %q", msg)
	}
	if !strings.Contains(msg, "launchctl bootout") {
		t.Fatalf("expected launchctl recovery hint, got %q", msg)
	}
	if !strings.Contains(msg, "/dev/cu.usbmodem101") {
		t.Fatalf("expected selected port in recovery hint, got %q", msg)
	}
}

func TestRunWithDepsWaitsForLaunchAgentToBecomeRunning(t *testing.T) {
	tmp := t.TempDir()
	home := filepath.Join(tmp, "home")
	repo := filepath.Join(tmp, "repo")
	execPath := filepath.Join(tmp, "bin", "codexbar-display-source")

	mustWriteFile(t, filepath.Join(repo, "firmware_esp32", "platformio.ini"), []byte("[env]"), 0o644)
	mustWriteFile(t, filepath.Join(repo, "companion", "go.mod"), []byte("module test"), 0o644)
	mustWriteFile(t, execPath, []byte("binary-content"), 0o755)

	printAttempts := 0

	err := runWithDeps(context.Background(), Options{Transport: "usb", AssumeYes: true}, deps{
		stdin:  strings.NewReader(""),
		stdout: &bytes.Buffer{},
		cwd: func() (string, error) {
			return filepath.Join(repo, "companion"), nil
		},
		executablePath: func() (string, error) {
			return execPath, nil
		},
		homeDir: func() (string, error) {
			return home, nil
		},
		uid: func() int { return 501 },
		listPorts: func() ([]string, error) {
			return []string{"/dev/cu.usbmodem101"}, nil
		},
		resolvePort: func(p string) (string, error) { return p, nil },
		probePort:   func(string) error { return nil },
		findCodexbar: func() (string, error) {
			return "/opt/homebrew/bin/codexbar", nil
		},
		lookPath: func(file string) (string, error) {
			switch file {
			case "pio", "brew", "open", "launchctl":
				return "/usr/bin/" + file, nil
			default:
				return "", errors.New("not found")
			}
		},
		runCommand: func(_ context.Context, _ string, name string, args ...string) (string, error) {
			if name == "launchctl" && len(args) >= 1 && args[0] == "print" {
				printAttempts++
				if printAttempts < 3 {
					return "state = exited", nil
				}
				return "state = running", nil
			}
			return "", nil
		},
	})
	if err != nil {
		t.Fatalf("expected setup success after transient non-running state, got %v", err)
	}
	if printAttempts < 3 {
		t.Fatalf("expected retries for launchctl print, got %d attempts", printAttempts)
	}
}

func TestRunWithDepsRetriesLaunchAgentBootstrapRace(t *testing.T) {
	tmp := t.TempDir()
	home := filepath.Join(tmp, "home")
	repo := filepath.Join(tmp, "repo")
	execPath := filepath.Join(tmp, "bin", "codexbar-display-source")

	mustWriteFile(t, filepath.Join(repo, "firmware_esp32", "platformio.ini"), []byte("[env]"), 0o644)
	mustWriteFile(t, filepath.Join(repo, "companion", "go.mod"), []byte("module test"), 0o644)
	mustWriteFile(t, execPath, []byte("binary-content"), 0o755)

	bootstrapAttempts := 0

	err := runWithDeps(context.Background(), Options{Transport: "usb", Port: "/dev/cu.usbserial10", AssumeYes: true, SkipFlash: true}, deps{
		stdin:  strings.NewReader(""),
		stdout: &bytes.Buffer{},
		cwd: func() (string, error) {
			return filepath.Join(repo, "companion"), nil
		},
		executablePath: func() (string, error) {
			return execPath, nil
		},
		homeDir: func() (string, error) {
			return home, nil
		},
		uid: func() int { return 501 },
		resolvePort: func(p string) (string, error) {
			if p != "" {
				return p, nil
			}
			return "/dev/cu.usbserial10", nil
		},
		probePort: func(string) error { return nil },
		findCodexbar: func() (string, error) {
			return "/opt/homebrew/bin/codexbar", nil
		},
		lookPath: func(file string) (string, error) {
			switch file {
			case "pio", "brew", "open", "launchctl":
				return "/usr/bin/" + file, nil
			default:
				return "", errors.New("not found")
			}
		},
		runCommand: func(_ context.Context, _ string, name string, args ...string) (string, error) {
			if name == "launchctl" && len(args) > 0 {
				switch args[0] {
				case "bootstrap":
					bootstrapAttempts++
					if bootstrapAttempts == 1 {
						return "Bootstrap failed: 5: Input/output error", errors.New("exit status 5")
					}
				case "print":
					if bootstrapAttempts == 1 {
						return "Could not find service", errors.New("exit status 113")
					}
					return "state = running", nil
				}
			}
			return "", nil
		},
	})
	if err != nil {
		t.Fatalf("expected setup success after bootstrap retry, got %v", err)
	}
	if bootstrapAttempts != 2 {
		t.Fatalf("expected bootstrap retry, got %d attempts", bootstrapAttempts)
	}
}

func TestRunWithDepsFallsBackToKickstartWhenLaunchAgentAlreadyLoaded(t *testing.T) {
	tmp := t.TempDir()
	home := filepath.Join(tmp, "home")
	repo := filepath.Join(tmp, "repo")
	execPath := filepath.Join(tmp, "bin", "codexbar-display-source")

	mustWriteFile(t, filepath.Join(repo, "firmware_esp32", "platformio.ini"), []byte("[env]"), 0o644)
	mustWriteFile(t, filepath.Join(repo, "companion", "go.mod"), []byte("module test"), 0o644)
	mustWriteFile(t, execPath, []byte("binary-content"), 0o755)

	kickstartCalled := false

	err := runWithDeps(context.Background(), Options{Transport: "usb", Port: "/dev/cu.usbserial10", AssumeYes: true, SkipFlash: true}, deps{
		stdin:  strings.NewReader(""),
		stdout: &bytes.Buffer{},
		cwd: func() (string, error) {
			return filepath.Join(repo, "companion"), nil
		},
		executablePath: func() (string, error) {
			return execPath, nil
		},
		homeDir: func() (string, error) {
			return home, nil
		},
		uid: func() int { return 501 },
		resolvePort: func(p string) (string, error) {
			if p != "" {
				return p, nil
			}
			return "/dev/cu.usbserial10", nil
		},
		probePort: func(string) error { return nil },
		findCodexbar: func() (string, error) {
			return "/opt/homebrew/bin/codexbar", nil
		},
		lookPath: func(file string) (string, error) {
			switch file {
			case "pio", "brew", "open", "launchctl":
				return "/usr/bin/" + file, nil
			default:
				return "", errors.New("not found")
			}
		},
		runCommand: func(_ context.Context, _ string, name string, args ...string) (string, error) {
			if name == "launchctl" && len(args) > 0 {
				switch args[0] {
				case "bootstrap":
					return "Bootstrap failed: 5: Input/output error", errors.New("exit status 5")
				case "kickstart":
					kickstartCalled = true
				case "print":
					return "state = running", nil
				}
			}
			return "", nil
		},
	})
	if err != nil {
		t.Fatalf("expected setup success with loaded launch agent fallback, got %v", err)
	}
	if !kickstartCalled {
		t.Fatalf("expected kickstart fallback")
	}
}

func TestRunWithDepsStopsLaunchAgentBeforeSerialProbe(t *testing.T) {
	bootoutCalled := false

	err := runWithDeps(context.Background(), Options{
		Transport: "usb",
		Port:      "/dev/cu.usbserial10",
		AssumeYes: true,
		SkipFlash: true,
	}, deps{
		stdin:  strings.NewReader(""),
		stdout: &bytes.Buffer{},
		executablePath: func() (string, error) {
			return mustCreateExecutable(t), nil
		},
		homeDir: func() (string, error) {
			return t.TempDir(), nil
		},
		uid: func() int { return 501 },
		resolvePort: func(p string) (string, error) {
			return p, nil
		},
		probePort: func(string) error {
			if !bootoutCalled {
				return errors.New("probe called before launchctl bootout")
			}
			return nil
		},
		findCodexbar: func() (string, error) {
			return "/opt/homebrew/bin/codexbar", nil
		},
		lookPath: func(file string) (string, error) {
			if file == "launchctl" {
				return "/bin/launchctl", nil
			}
			return "", errors.New("not found")
		},
		runCommand: func(_ context.Context, _ string, name string, args ...string) (string, error) {
			if name == "launchctl" && len(args) > 0 && args[0] == "bootout" {
				bootoutCalled = true
			}
			if name == "launchctl" && len(args) > 0 && args[0] == "print" {
				return "state = running", nil
			}
			return "", nil
		},
	})
	if err != nil {
		t.Fatalf("expected setup success, got %v", err)
	}
	if !bootoutCalled {
		t.Fatalf("expected setup to attempt launchctl bootout before probe")
	}
}

func TestRunWithDepsSkipsSerialProbeOnFlashPath(t *testing.T) {
	tmp := t.TempDir()
	home := filepath.Join(tmp, "home")
	repo := filepath.Join(tmp, "repo")
	execPath := filepath.Join(tmp, "bin", "codexbar-display-source")

	mustWriteFile(t, filepath.Join(repo, "firmware_esp32", "platformio.ini"), []byte("[env]"), 0o644)
	mustWriteFile(t, filepath.Join(repo, "companion", "go.mod"), []byte("module test"), 0o644)
	mustWriteFile(t, execPath, []byte("binary-content"), 0o755)

	probeCalled := false

	err := runWithDeps(context.Background(), Options{
		Transport: "usb",
		Port:      "/dev/cu.usbserial10",
		AssumeYes: true,
	}, deps{
		stdin:  strings.NewReader(""),
		stdout: &bytes.Buffer{},
		cwd: func() (string, error) {
			return filepath.Join(repo, "companion"), nil
		},
		executablePath: func() (string, error) {
			return execPath, nil
		},
		homeDir: func() (string, error) {
			return home, nil
		},
		uid: func() int { return 501 },
		resolvePort: func(p string) (string, error) {
			return p, nil
		},
		probePort: func(string) error {
			probeCalled = true
			return nil
		},
		findCodexbar: func() (string, error) {
			return "/opt/homebrew/bin/codexbar", nil
		},
		lookPath: func(file string) (string, error) {
			switch file {
			case "launchctl", "pio":
				return "/bin/" + file, nil
			default:
				return "", errors.New("not found")
			}
		},
		runCommand: func(_ context.Context, _ string, name string, args ...string) (string, error) {
			if name == "launchctl" && len(args) > 0 && args[0] == "print" {
				return "state = running", nil
			}
			return "", nil
		},
	})
	if err != nil {
		t.Fatalf("expected setup success, got %v", err)
	}
	if probeCalled {
		t.Fatalf("expected serial probe to be skipped on flash path")
	}
}

func TestRunWithDepsUsesReleaseUpgradeForEsp8266FirmwareEnvironment(t *testing.T) {
	tmp := t.TempDir()
	home := filepath.Join(tmp, "home")
	repo := filepath.Join(tmp, "repo")
	execPath := filepath.Join(tmp, "bin", "codexbar-display-source")

	mustWriteFile(t, filepath.Join(repo, "firmware_esp32", "platformio.ini"), []byte("[env:lilygo_t_display_s3]"), 0o644)
	mustWriteFile(t, filepath.Join(repo, "firmware_esp8266", "platformio.ini"), []byte("[env:esp8266_smalltv_st7789]"), 0o644)
	mustWriteFile(t, filepath.Join(repo, "companion", "go.mod"), []byte("module test"), 0o644)
	mustWriteFile(t, execPath, []byte("binary-content"), 0o755)

	var upgradeCall *commandCall
	err := runWithDeps(context.Background(), Options{
		Transport:   "usb",
		AssumeYes:   true,
		FirmwareEnv: "esp8266_smalltv_st7789",
	}, deps{
		stdin:  strings.NewReader(""),
		stdout: &bytes.Buffer{},
		cwd: func() (string, error) {
			return filepath.Join(repo, "companion"), nil
		},
		executablePath: func() (string, error) {
			return execPath, nil
		},
		homeDir: func() (string, error) {
			return home, nil
		},
		uid: func() int { return 501 },
		listPorts: func() ([]string, error) {
			return []string{"/dev/cu.usbserial42"}, nil
		},
		resolvePort: func(p string) (string, error) {
			return p, nil
		},
		probePort: func(string) error { return nil },
		findCodexbar: func() (string, error) {
			return "/opt/homebrew/bin/codexbar", nil
		},
		lookPath: func(file string) (string, error) {
			switch file {
			case "pio", "launchctl":
				return "/usr/bin/" + file, nil
			default:
				return "", errors.New("not found")
			}
		},
		runCommand: func(_ context.Context, dir string, name string, args ...string) (string, error) {
			if name == execPath {
				c := commandCall{dir: dir, name: name, args: append([]string(nil), args...)}
				upgradeCall = &c
			}
			if name == "launchctl" && len(args) > 0 && args[0] == "print" {
				return "state = running", nil
			}
			return "", nil
		},
	})
	if err != nil {
		t.Fatalf("expected setup success, got %v", err)
	}
	if upgradeCall == nil {
		t.Fatalf("expected release firmware upgrade call")
	}
	if upgradeCall.dir != "" {
		t.Fatalf("expected release upgrade to run outside the repo, got dir %q", upgradeCall.dir)
	}
	if !commandSeen([]commandCall{*upgradeCall}, execPath, []string{"upgrade", "--port", "/dev/cu.usbserial42", "--firmware-env", "esp8266_smalltv_st7789"}) {
		t.Fatalf("unexpected release upgrade args: %#v", upgradeCall.args)
	}
}

func TestRunWithDepsValidateOnlyPerformsChecksWithoutApplyingChanges(t *testing.T) {
	tmp := t.TempDir()
	home := filepath.Join(tmp, "home")
	repo := filepath.Join(tmp, "repo")
	execPath := filepath.Join(tmp, "bin", "codexbar-display-source")

	mustWriteFile(t, filepath.Join(repo, "firmware_esp32", "platformio.ini"), []byte("[env:lilygo_t_display_s3]"), 0o644)
	mustWriteFile(t, filepath.Join(repo, "firmware_esp8266", "platformio.ini"), []byte("[env:esp8266_smalltv_st7789]"), 0o644)
	mustWriteFile(t, filepath.Join(repo, "companion", "go.mod"), []byte("module test"), 0o644)
	mustWriteFile(t, execPath, []byte("binary-content"), 0o755)

	var calls []commandCall
	err := runWithDeps(context.Background(), Options{
		Transport:     "usb",
		AssumeYes:     true,
		ValidateOnly:  true,
		FirmwareEnv:   "esp8266_smalltv_st7789",
		PinDaemonPort: true,
	}, deps{
		stdin:  strings.NewReader(""),
		stdout: &bytes.Buffer{},
		cwd: func() (string, error) {
			return filepath.Join(repo, "companion"), nil
		},
		executablePath: func() (string, error) {
			return execPath, nil
		},
		homeDir: func() (string, error) {
			return home, nil
		},
		uid: func() int { return 501 },
		listPorts: func() ([]string, error) {
			return []string{"/dev/cu.usbserial42"}, nil
		},
		resolvePort: func(p string) (string, error) { return p, nil },
		probePort:   func(string) error { return nil },
		findCodexbar: func() (string, error) {
			return "/opt/homebrew/bin/codexbar", nil
		},
		lookPath: func(file string) (string, error) {
			if file == "pio" {
				return "/usr/bin/pio", nil
			}
			return "", errors.New("not found")
		},
		runCommand: func(_ context.Context, dir string, name string, args ...string) (string, error) {
			calls = append(calls, commandCall{
				dir:  dir,
				name: name,
				args: append([]string(nil), args...),
			})
			return "", nil
		},
	})
	if err != nil {
		t.Fatalf("expected validate-only success, got %v", err)
	}

	if len(calls) > 0 {
		t.Fatalf("expected no side-effect commands in validate-only mode, got %#v", calls)
	}
	installPath := filepath.Join(home, "Library", "Application Support", "codexbar-display", "bin", "codexbar-display")
	if _, err := os.Stat(installPath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("expected no installed binary in validate-only mode, err=%v", err)
	}
}

func TestRunWithDepsDryRunSkipsApplyingChanges(t *testing.T) {
	tmp := t.TempDir()
	home := filepath.Join(tmp, "home")
	repo := filepath.Join(tmp, "repo")
	execPath := filepath.Join(tmp, "bin", "codexbar-display-source")

	mustWriteFile(t, filepath.Join(repo, "firmware_esp32", "platformio.ini"), []byte("[env:lilygo_t_display_s3]"), 0o644)
	mustWriteFile(t, filepath.Join(repo, "firmware_esp8266", "platformio.ini"), []byte("[env:esp8266_smalltv_st7789]"), 0o644)
	mustWriteFile(t, filepath.Join(repo, "companion", "go.mod"), []byte("module test"), 0o644)
	mustWriteFile(t, execPath, []byte("binary-content"), 0o755)

	var calls []commandCall
	err := runWithDeps(context.Background(), Options{
		AssumeYes:   true,
		DryRun:      true,
		FirmwareEnv: "esp8266_smalltv_st7789",
		Theme:       "crt",
	}, deps{
		stdin:  strings.NewReader(""),
		stdout: &bytes.Buffer{},
		cwd: func() (string, error) {
			return filepath.Join(repo, "companion"), nil
		},
		executablePath: func() (string, error) {
			return execPath, nil
		},
		homeDir: func() (string, error) {
			return home, nil
		},
		uid: func() int { return 501 },
		listPorts: func() ([]string, error) {
			return []string{"/dev/cu.usbserial42"}, nil
		},
		resolvePort: func(p string) (string, error) { return p, nil },
		probePort:   func(string) error { return nil },
		findCodexbar: func() (string, error) {
			return "/opt/homebrew/bin/codexbar", nil
		},
		lookPath: func(file string) (string, error) {
			if file == "pio" {
				return "/usr/bin/pio", nil
			}
			return "", errors.New("not found")
		},
		runCommand: func(_ context.Context, dir string, name string, args ...string) (string, error) {
			calls = append(calls, commandCall{
				dir:  dir,
				name: name,
				args: append([]string(nil), args...),
			})
			return "", nil
		},
	})
	if err != nil {
		t.Fatalf("expected dry-run success, got %v", err)
	}

	if len(calls) > 0 {
		t.Fatalf("expected no side-effect commands in dry-run mode, got %#v", calls)
	}
	plistPath := filepath.Join(home, "Library", "LaunchAgents", launchAgentLabel+".plist")
	if _, err := os.Stat(plistPath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("expected no plist write in dry-run mode, err=%v", err)
	}
}

func TestDefaultFirmwareEnvironment(t *testing.T) {
	if got := DefaultFirmwareEnvironment(); got != "esp8266_smalltv_st7789" {
		t.Fatalf("unexpected default firmware env: %q", got)
	}
}

func TestResolveFirmwareEnvironmentRejectsUnsupported(t *testing.T) {
	if _, ok := ResolveFirmwareEnvironment("esp8266_smalltv_st7789_crt"); ok {
		t.Fatalf("expected legacy compile-theme env to be rejected")
	}
	if _, ok := ResolveFirmwareEnvironment("esp8266_probe"); ok {
		t.Fatalf("expected unsupported firmware env to be rejected")
	}
}

func TestFirmwareProjectDirForLilygoEnvironment(t *testing.T) {
	repo := t.TempDir()
	mustWriteFile(t, filepath.Join(repo, "firmware_esp32", "platformio.ini"), []byte("[env:lilygo_t_display_s3]"), 0o644)
	mustWriteFile(t, filepath.Join(repo, "firmware_esp8266", "platformio.ini"), []byte("[env:esp8266_smalltv_st7789]"), 0o644)

	got := firmwareProjectDirForEnvironment(repo, "lilygo_t_display_s3")
	want := filepath.Join(repo, "firmware_esp32")
	if got != want {
		t.Fatalf("expected %q, got %q", want, got)
	}
}

func TestRunWithDepsFailsWhenDetectedBoardMismatchesFirmwareEnvironment(t *testing.T) {
	tmp := t.TempDir()
	home := filepath.Join(tmp, "home")
	repo := filepath.Join(tmp, "repo")
	execPath := filepath.Join(tmp, "bin", "codexbar-display-source")

	mustWriteFile(t, filepath.Join(repo, "firmware_esp32", "platformio.ini"), []byte("[env:lilygo_t_display_s3]"), 0o644)
	mustWriteFile(t, filepath.Join(repo, "firmware_esp8266", "platformio.ini"), []byte("[env:esp8266_smalltv_st7789]"), 0o644)
	mustWriteFile(t, filepath.Join(repo, "companion", "go.mod"), []byte("module test"), 0o644)
	mustWriteFile(t, execPath, []byte("binary-content"), 0o755)

	err := runWithDeps(context.Background(), Options{
		Transport:   "usb",
		AssumeYes:   true,
		SkipFlash:   true,
		FirmwareEnv: "esp8266_smalltv_st7789",
	}, deps{
		stdin:  strings.NewReader(""),
		stdout: &bytes.Buffer{},
		cwd: func() (string, error) {
			return filepath.Join(repo, "companion"), nil
		},
		executablePath: func() (string, error) {
			return execPath, nil
		},
		homeDir: func() (string, error) {
			return home, nil
		},
		uid: func() int { return 501 },
		listPorts: func() ([]string, error) {
			return []string{"/dev/cu.usbserial42"}, nil
		},
		resolvePort: func(p string) (string, error) {
			return p, nil
		},
		probePort: func(string) error { return nil },
		readDeviceHello: func(string) (protocol.DeviceHello, error) {
			return protocol.DeviceHello{
				Kind:            "hello",
				ProtocolVersion: 1,
				Board:           "esp32-lilygo-t-display-s3",
			}, nil
		},
		findCodexbar: func() (string, error) {
			return "/opt/homebrew/bin/codexbar", nil
		},
		lookPath: func(file string) (string, error) {
			if file == "launchctl" {
				return "/usr/bin/launchctl", nil
			}
			return "", errors.New("not found")
		},
		runCommand: func(_ context.Context, _ string, name string, args ...string) (string, error) {
			if name == "launchctl" && len(args) > 0 && args[0] == "print" {
				return "state = running", nil
			}
			return "", nil
		},
	})
	if err == nil {
		t.Fatalf("expected setup to fail on board mismatch")
	}
	if !strings.Contains(err.Error(), "unsupported-hardware") {
		t.Fatalf("expected unsupported-hardware step, got %v", err)
	}
}

func commandSeen(calls []commandCall, name string, args []string) bool {
	for _, call := range calls {
		if call.name != name {
			continue
		}
		if len(call.args) != len(args) {
			continue
		}
		match := true
		for i := range args {
			if call.args[i] != args[i] {
				match = false
				break
			}
		}
		if match {
			return true
		}
	}
	return false
}

func mustWriteFile(t *testing.T, path string, data []byte, mode os.FileMode) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("mkdir %s: %v", filepath.Dir(path), err)
	}
	if err := os.WriteFile(path, data, mode); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}

func mustCreateExecutable(t *testing.T) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "codexbar-display-source")
	mustWriteFile(t, path, []byte("binary-content"), 0o755)
	return path
}

func noSetupWiFiDiscovery(t *testing.T) func(context.Context, []string) (transportlayer.WiFiDiscoveryResult, error) {
	t.Helper()
	return func(context.Context, []string) (transportlayer.WiFiDiscoveryResult, error) {
		return transportlayer.WiFiDiscoveryResult{}, errors.New("not found")
	}
}
