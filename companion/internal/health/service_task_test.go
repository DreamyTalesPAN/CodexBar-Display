package health

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func TestWindowsHealthUsesManagerStateAndTaskArguments(t *testing.T) {
	var out strings.Builder
	err := runWithDeps(context.Background(), deps{goos: "windows", stdout: &out, homeDir: func() (string, error) { return t.TempDir(), nil }, runCommand: func(context.Context, string, ...string) (string, error) { return `{"Enabled":true,"State":4}`, nil }, readFile: func(path string) ([]byte, error) {
		if strings.HasSuffix(path, ".json") {
			return []byte(`{"Executable":"C:\\VibeTV.exe","Arguments":["daemon","--transport","wifi","--target","http://192.0.2.10"]}`), nil
		}
		return nil, errors.New("no log")
	}, resolvePort: func(string) (string, error) { t.Fatal("WiFi task queried USB"); return "", nil }})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out.String(), "scheduled task: running") || !strings.Contains(out.String(), "transport: wifi") {
		t.Fatal(out.String())
	}
}

func TestWindowsHealthPropagatesSchedulerFailure(t *testing.T) {
	denied := errors.New("access denied")
	var out strings.Builder
	err := runWithDeps(context.Background(), deps{goos: "windows", stdout: &out, runCommand: func(context.Context, string, ...string) (string, error) { return "", denied }, readFile: func(string) ([]byte, error) { return nil, errors.New("missing") }, resolvePort: func(string) (string, error) { return "", errors.New("missing") }})
	if !errors.Is(err, denied) {
		t.Fatalf("swallowed error: %v", err)
	}
}

func TestWindowsUSBHealthDoesNotProbeRunningOwner(t *testing.T) {
	for _, port := range []string{"COM12", ""} {
		t.Run(port, func(t *testing.T) {
			var out strings.Builder
			err := runWithDeps(context.Background(), deps{goos: "windows", stdout: &out,
				homeDir:    func() (string, error) { return t.TempDir(), nil },
				runCommand: func(context.Context, string, ...string) (string, error) { return `{"Enabled":true,"State":4}`, nil },
				readFile: func(path string) ([]byte, error) {
					if strings.HasSuffix(path, ".json") {
						return []byte(`{"Arguments":["daemon","--transport","usb","--port","` + port + `"]}`), nil
					}
					return nil, errors.New("no log")
				},
				resolvePort: func(string) (string, error) { t.Fatal("health reopened task-owned port"); return "", nil },
			})
			if err != nil {
				t.Fatal(err)
			}
			if port != "" && !strings.Contains(out.String(), "configured port: COM12") {
				t.Fatal(out.String())
			}
			if port == "" && !strings.Contains(out.String(), "automatic") {
				t.Fatal(out.String())
			}
		})
	}
}
