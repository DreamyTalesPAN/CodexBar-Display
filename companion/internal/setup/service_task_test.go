package setup

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/service"
)

func TestWindowsServiceConfigurationAndInstalledExecutable(t *testing.T) {
	home := t.TempDir()
	source := filepath.Join(t.TempDir(), "download.exe")
	if err := os.WriteFile(source, []byte("fixture"), 0o600); err != nil {
		t.Fatal(err)
	}
	installed, err := installBinaryForPlatform(source, home, "windows")
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Base(installed) != "codexbar-display.exe" {
		t.Fatal(installed)
	}
	for _, tc := range []struct {
		transport, target, port string
		args                    []string
	}{
		{"wifi", "http://192.0.2.10", "", []string{"daemon", "--interval", "30s", "--api-addr", "127.0.0.1:47832", "--transport", "wifi", "--target", "http://192.0.2.10", "--last-good-max-age", "168h"}},
		{"usb", "", "COM12", []string{"daemon", "--interval", "2s", "--api-addr", "127.0.0.1:47832", "--port", "COM12", "--transport", "usb", "--last-good-max-age", "168h"}},
	} {
		path, err := writeServiceConfig(home, installed, tc.transport, tc.target, tc.port, "windows")
		if err != nil {
			t.Fatal(err)
		}
		if path != service.TaskConfigPath(home, launchAgentLabel) {
			t.Fatal(path)
		}
		config, err := service.ReadTaskConfig(home, launchAgentLabel)
		if err != nil {
			t.Fatal(err)
		}
		if config.Executable != installed || !reflect.DeepEqual(config.Arguments, tc.args) {
			t.Fatalf("config=%+v", config)
		}
	}
	if _, err := os.Stat(service.PlistPath(home, launchAgentLabel)); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("Windows wrote plist: %v", err)
	}
}

func TestWindowsPreflightAndMissingCodexbarNeverUseMacTools(t *testing.T) {
	var commands []string
	d := deps{goos: "windows", lookPath: func(name string) (string, error) { commands = append(commands, name); return name, nil }, findCodexbar: func() (string, error) { return "", errors.New("missing") }}
	if err := runDependencyPreflight(Options{SkipFlash: true}, "wifi", d); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(commands, []string{"powershell.exe"}) {
		t.Fatal(commands)
	}
	if _, err := ensureCodexbar(context.Background(), d, true); err == nil {
		t.Fatal("missing CLI accepted")
	}
	if !reflect.DeepEqual(commands, []string{"powershell.exe"}) {
		t.Fatal("attempted Mac install", commands)
	}
}
