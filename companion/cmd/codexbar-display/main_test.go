package main

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestParseDaemonOptionsWiFiTarget(t *testing.T) {
	opts, err := parseDaemonOptions([]string{
		"--transport", "wifi",
		"--target", "http://192.168.178.123",
		"--once",
	})
	if err != nil {
		t.Fatalf("parseDaemonOptions returned error: %v", err)
	}
	if opts.Transport != "wifi" {
		t.Fatalf("expected wifi transport, got %q", opts.Transport)
	}
	if opts.Target != "http://192.168.178.123" {
		t.Fatalf("unexpected target %q", opts.Target)
	}
	if !opts.Once {
		t.Fatalf("expected once option")
	}
}

func TestParseDaemonOptionsDefaultsToWiFi(t *testing.T) {
	opts, err := parseDaemonOptions(nil)
	if err != nil {
		t.Fatalf("parseDaemonOptions returned error: %v", err)
	}
	if opts.Transport != "wifi" {
		t.Fatalf("expected wifi transport default, got %q", opts.Transport)
	}
	if opts.Target != "http://vibetv.local" {
		t.Fatalf("expected default WiFi target, got %q", opts.Target)
	}
}

func TestResolveThemeSpecTransportNamePreservesPortOnlyUSBFlow(t *testing.T) {
	got := resolveThemeSpecTransportName("wifi", "/dev/cu.usbserial-10", false)
	if got != "usb" {
		t.Fatalf("expected port-only theme command to use usb, got %q", got)
	}

	got = resolveThemeSpecTransportName("wifi", "/dev/cu.usbserial-10", true)
	if got != "wifi" {
		t.Fatalf("expected explicit transport to win, got %q", got)
	}
}

func TestThemeApplySupportsWiFiTransport(t *testing.T) {
	specPath := writeTestThemeSpec(t)
	var gotFrame struct {
		V         int             `json:"v"`
		Theme     string          `json:"theme"`
		ThemeSpec json.RawMessage `json:"themeSpec"`
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hello":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"supportedProtocolVersions":[2,1],"preferredProtocolVersion":2,"board":"esp8266-smalltv-st7789","features":["theme","theme-spec-v1"],"maxFrameBytes":1024,"capabilities":{"theme":{"supportsThemeSpecV1":true,"maxThemeSpecBytes":900,"maxThemePrimitives":8,"builtinThemes":["mini","classic"]},"transport":{"active":"wifi","supported":["wifi","usb"]}}}`))
		case "/frame":
			body, err := io.ReadAll(r.Body)
			if err != nil {
				t.Fatalf("read frame body: %v", err)
			}
			if err := json.Unmarshal(body, &gotFrame); err != nil {
				t.Fatalf("decode frame body %q: %v", string(body), err)
			}
			w.WriteHeader(http.StatusOK)
		default:
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
	}))
	defer server.Close()

	err := runThemeApply([]string{
		"--transport", "wifi",
		"--target", server.URL,
		"--spec", specPath,
	})
	if err != nil {
		t.Fatalf("runThemeApply returned error: %v", err)
	}
	if gotFrame.V != 2 {
		t.Fatalf("expected v2 frame, got %d", gotFrame.V)
	}
	if gotFrame.Theme != "mini" {
		t.Fatalf("expected fallback mini theme, got %q", gotFrame.Theme)
	}
	if !strings.Contains(string(gotFrame.ThemeSpec), `"themeId":"codex-test"`) {
		t.Fatalf("expected themeSpec payload, got %s", string(gotFrame.ThemeSpec))
	}
}

func TestThemeValidateSupportsWiFiTransport(t *testing.T) {
	specPath := writeTestThemeSpec(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/hello" {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"supportedProtocolVersions":[2,1],"preferredProtocolVersion":2,"board":"esp8266-smalltv-st7789","features":["theme-spec-v1"],"maxFrameBytes":1024,"capabilities":{"theme":{"supportsThemeSpecV1":true,"maxThemeSpecBytes":900,"maxThemePrimitives":8,"builtinThemes":["mini"]},"transport":{"active":"wifi","supported":["wifi"]}}}`))
	}))
	defer server.Close()

	err := runThemeValidate([]string{
		"--transport", "wifi",
		"--target", server.URL,
		"--spec", specPath,
	})
	if err != nil {
		t.Fatalf("runThemeValidate returned error: %v", err)
	}
}

func TestThemePackInstallSupportsPackURL(t *testing.T) {
	packZip := buildTestThemePackZip(t)
	downloadedPack := false
	firmwareUpdated := false
	uploaded := map[string]bool{}
	activated := false
	sentFrame := false
	previousFirmwareUpdate := themePackInstallFirmwareUpdateFn
	t.Cleanup(func() {
		themePackInstallFirmwareUpdateFn = previousFirmwareUpdate
	})
	themePackInstallFirmwareUpdateFn = func(target, manifestURL string) error {
		firmwareUpdated = true
		return nil
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/cozy-meadow.zip":
			downloadedPack = true
			w.Header().Set("Content-Type", "application/zip")
			_, _ = w.Write(packZip)
		case "/hello":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"supportedProtocolVersions":[2,1],"preferredProtocolVersion":2,"board":"esp8266-smalltv-st7789","features":["theme","theme-spec-v1"],"maxFrameBytes":2048,"capabilities":{"theme":{"supportsThemeSpecV1":true,"maxThemeSpecBytes":1200,"maxThemePrimitives":8,"builtinThemes":["mini","classic"]},"transport":{"active":"wifi","supported":["wifi","usb"]}}}`))
		case "/assets":
			if !firmwareUpdated {
				t.Fatalf("expected firmware update before theme asset upload")
			}
			if r.Method != http.MethodPost {
				t.Fatalf("expected POST /assets, got %s", r.Method)
			}
			devicePath := r.URL.Query().Get("path")
			if devicePath == "" {
				t.Fatalf("missing asset path query")
			}
			uploaded[devicePath] = true
			w.WriteHeader(http.StatusOK)
		case "/theme/active":
			body, err := io.ReadAll(r.Body)
			if err != nil {
				t.Fatalf("read activation body: %v", err)
			}
			if !strings.Contains(string(body), `"/themes/u/cm.json"`) {
				t.Fatalf("unexpected activation body %s", string(body))
			}
			activated = true
			w.WriteHeader(http.StatusOK)
		case "/frame":
			sentFrame = true
			w.WriteHeader(http.StatusOK)
		default:
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
	}))
	defer server.Close()

	err := runThemePackInstall([]string{
		"--pack", server.URL + "/cozy-meadow.zip",
		"--target", server.URL,
	})
	if err != nil {
		t.Fatalf("runThemePackInstall returned error: %v", err)
	}
	if !downloadedPack {
		t.Fatalf("expected theme pack URL to be downloaded")
	}
	if !firmwareUpdated {
		t.Fatalf("expected firmware update before theme pack install")
	}
	if !uploaded["/themes/u/cm.cbi"] || !uploaded["/themes/u/cm.json"] {
		t.Fatalf("expected asset and theme spec uploads, got %#v", uploaded)
	}
	if !activated {
		t.Fatalf("expected stored theme activation")
	}
	if !sentFrame {
		t.Fatalf("expected live frame after activation")
	}
}

func TestThemePackInstallSupportsCatalogTheme(t *testing.T) {
	packZip := buildTestThemePackZip(t)
	downloadedCatalog := false
	downloadedPack := false
	firmwareUpdated := false
	uploaded := map[string]bool{}
	activated := false
	sentFrame := false
	previousFirmwareUpdate := themePackInstallFirmwareUpdateFn
	t.Cleanup(func() {
		themePackInstallFirmwareUpdateFn = previousFirmwareUpdate
	})
	themePackInstallFirmwareUpdateFn = func(target, manifestURL string) error {
		firmwareUpdated = true
		return nil
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/catalog.json":
			downloadedCatalog = true
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"schemaVersion":1,"themes":[{"id":"cozy-meadow","title":"Cozy Meadow","themeRev":1,"downloadAsset":"cozy-meadow.zip"}]}`))
		case "/cozy-meadow.zip":
			downloadedPack = true
			w.Header().Set("Content-Type", "application/zip")
			_, _ = w.Write(packZip)
		case "/hello":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"supportedProtocolVersions":[2,1],"preferredProtocolVersion":2,"board":"esp8266-smalltv-st7789","features":["theme","theme-spec-v1"],"maxFrameBytes":2048,"capabilities":{"theme":{"supportsThemeSpecV1":true,"maxThemeSpecBytes":1200,"maxThemePrimitives":8,"builtinThemes":["mini","classic"]},"transport":{"active":"wifi","supported":["wifi","usb"]}}}`))
		case "/assets":
			if !firmwareUpdated {
				t.Fatalf("expected firmware update before theme asset upload")
			}
			uploaded[r.URL.Query().Get("path")] = true
			w.WriteHeader(http.StatusOK)
		case "/theme/active":
			activated = true
			w.WriteHeader(http.StatusOK)
		case "/frame":
			sentFrame = true
			w.WriteHeader(http.StatusOK)
		default:
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
	}))
	defer server.Close()

	err := runThemePackInstall([]string{
		"--catalog", server.URL + "/catalog.json",
		"--theme", "cozy-meadow",
		"--target", server.URL,
	})
	if err != nil {
		t.Fatalf("runThemePackInstall returned error: %v", err)
	}
	if !downloadedCatalog || !downloadedPack {
		t.Fatalf("expected catalog and pack downloads, catalog=%t pack=%t", downloadedCatalog, downloadedPack)
	}
	if !firmwareUpdated {
		t.Fatalf("expected firmware update before theme pack install")
	}
	if !uploaded["/themes/u/cm.cbi"] || !uploaded["/themes/u/cm.json"] {
		t.Fatalf("expected asset and theme spec uploads, got %#v", uploaded)
	}
	if !activated || !sentFrame {
		t.Fatalf("expected activation and frame, activated=%t sentFrame=%t", activated, sentFrame)
	}
}

func writeTestThemeSpec(t *testing.T) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "theme.json")
	spec := `{
  "themeSpecVersion": 1,
  "themeId": "codex-test",
  "themeRev": 1,
  "fallbackTheme": "mini",
  "primitives": [
    {"type": "rect", "x": 0, "y": 0, "width": 240, "height": 240, "color": "#000000"},
    {"type": "text", "x": 8, "y": 8, "text": "{label}", "fontSize": 2, "color": "#CCFF00"}
  ]
}`
	if err := os.WriteFile(path, []byte(spec), 0o644); err != nil {
		t.Fatalf("write test theme spec: %v", err)
	}
	return path
}

func buildTestThemePackZip(t *testing.T) []byte {
	t.Helper()
	spec := `{"v":1,"id":"cozy-meadow","rev":1,"fb":"mini","p":[{"t":"sp","x":0,"y":0,"w":24,"h":24,"a":"/themes/u/cm.cbi"}]}`
	asset := "CBI1\n1 1\n1\n#FFFFFF\na\n"
	manifest := `{"kind":"vibetv-theme-pack","schemaVersion":1,"id":"cozy-meadow","name":"Cozy Meadow","themeSpec":{"path":"/themes/u/cm.json","file":"theme.json"},"assets":[{"path":"/themes/u/cm.cbi","file":"assets/cm.cbi"}]}`

	var buf bytes.Buffer
	writer := zip.NewWriter(&buf)
	for _, file := range []struct {
		name string
		data string
	}{
		{name: "manifest.json", data: manifest},
		{name: "theme.json", data: spec},
		{name: "assets/cm.cbi", data: asset},
	} {
		part, err := writer.Create(file.name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := part.Write([]byte(file.data)); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}
