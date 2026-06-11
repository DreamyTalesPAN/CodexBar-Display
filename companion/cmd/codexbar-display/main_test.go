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
	"time"
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
			if len(uploaded) == 0 {
				time.Sleep(6 * time.Second)
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

	output, err := captureStdout(t, func() error {
		return runThemePackInstall([]string{
			"--pack", server.URL + "/cozy-meadow.zip",
			"--target", server.URL,
		})
	})
	if err != nil {
		t.Fatalf("runThemePackInstall returned error: %v", err)
	}
	for _, want := range []string{
		"Preparing theme: Cozy Meadow",
		"Checking device...",
		"Uploading theme files...",
		"Activating theme...",
		"Done: theme cozy-meadow installed on " + server.URL,
	} {
		if !strings.Contains(output, want) {
			t.Fatalf("expected output to contain %q, got:\n%s", want, output)
		}
	}
	for _, noisy := range []string{"uploaded asset:", "uploaded theme spec:", "activePath="} {
		if strings.Contains(output, noisy) {
			t.Fatalf("expected quiet install output not to contain %q, got:\n%s", noisy, output)
		}
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
	if sentFrame {
		t.Fatalf("expected theme install not to send demo live frame")
	}
}

func TestThemePackInstallLogsConciseRetry(t *testing.T) {
	packZip := buildTestThemePackZip(t)
	assetAttempts := 0

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/cozy-meadow.zip":
			w.Header().Set("Content-Type", "application/zip")
			_, _ = w.Write(packZip)
		case "/hello":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"supportedProtocolVersions":[2,1],"preferredProtocolVersion":2,"board":"esp8266-smalltv-st7789","features":["theme","theme-spec-v1"],"maxFrameBytes":2048,"capabilities":{"theme":{"supportsThemeSpecV1":true,"maxThemeSpecBytes":1200,"maxThemePrimitives":8,"builtinThemes":["mini","classic"]},"transport":{"active":"wifi","supported":["wifi","usb"]}}}`))
		case "/assets":
			if r.URL.Query().Get("path") == "/themes/u/cm.cbi" {
				assetAttempts++
				if assetAttempts == 1 {
					w.WriteHeader(http.StatusServiceUnavailable)
					_, _ = w.Write([]byte("upload busy"))
					return
				}
			}
			w.WriteHeader(http.StatusOK)
		case "/theme/active", "/frame":
			w.WriteHeader(http.StatusOK)
		default:
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
	}))
	defer server.Close()

	output, err := captureStdout(t, func() error {
		return runThemePackInstall([]string{
			"--pack", server.URL + "/cozy-meadow.zip",
			"--target", server.URL,
			"--skip-firmware-update",
		})
	})
	if err != nil {
		t.Fatalf("runThemePackInstall returned error: %v", err)
	}
	if assetAttempts != 2 {
		t.Fatalf("expected one retry for asset upload, got %d attempts", assetAttempts)
	}
	if got := strings.Count(output, "Upload interrupted, retrying..."); got != 1 {
		t.Fatalf("expected one concise retry line, got %d in:\n%s", got, output)
	}
	if strings.Contains(output, "status=503") || strings.Contains(output, "upload busy") {
		t.Fatalf("expected quiet retry output to hide raw server details, got:\n%s", output)
	}
	if !strings.Contains(output, "Done: theme cozy-meadow installed on "+server.URL) {
		t.Fatalf("expected done line, got:\n%s", output)
	}
}

func TestThemePackInstallWrapsUploadFailureForCustomers(t *testing.T) {
	packZip := buildTestThemePackZip(t)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/cozy-meadow.zip":
			w.Header().Set("Content-Type", "application/zip")
			_, _ = w.Write(packZip)
		case "/hello":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"supportedProtocolVersions":[2,1],"preferredProtocolVersion":2,"board":"esp8266-smalltv-st7789","features":["theme","theme-spec-v1"],"maxFrameBytes":2048,"capabilities":{"theme":{"supportsThemeSpecV1":true,"maxThemeSpecBytes":1200,"maxThemePrimitives":8,"builtinThemes":["mini","classic"]},"transport":{"active":"wifi","supported":["wifi","usb"]}}}`))
		case "/assets":
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = w.Write([]byte("raw device failure"))
		default:
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
	}))
	defer server.Close()

	output, err := captureStdout(t, func() error {
		return runThemePackInstall([]string{
			"--pack", server.URL + "/cozy-meadow.zip",
			"--target", server.URL,
			"--skip-firmware-update",
		})
	})
	if err == nil {
		t.Fatalf("expected upload failure")
	}
	if !strings.Contains(output, "Upload interrupted, retrying...") {
		t.Fatalf("expected concise retry output, got:\n%s", output)
	}
	msg := err.Error()
	if !strings.Contains(msg, "theme-pack/upload: theme upload did not finish for /themes/u/cm.cbi") {
		t.Fatalf("expected customer-friendly upload error, got %q", msg)
	}
	for _, raw := range []string{"status=503", "raw device failure", "post asset"} {
		if strings.Contains(msg, raw) {
			t.Fatalf("expected non-verbose error to hide raw %q detail, got %q", raw, msg)
		}
	}
}

func TestThemePackInstallVerboseShowsDetails(t *testing.T) {
	packZip := buildTestThemePackZip(t)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/cozy-meadow.zip":
			w.Header().Set("Content-Type", "application/zip")
			_, _ = w.Write(packZip)
		case "/hello":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"supportedProtocolVersions":[2,1],"preferredProtocolVersion":2,"board":"esp8266-smalltv-st7789","features":["theme","theme-spec-v1"],"maxFrameBytes":2048,"capabilities":{"theme":{"supportsThemeSpecV1":true,"maxThemeSpecBytes":1200,"maxThemePrimitives":8,"builtinThemes":["mini","classic"]},"transport":{"active":"wifi","supported":["wifi","usb"]}}}`))
		case "/assets", "/theme/active", "/frame":
			w.WriteHeader(http.StatusOK)
		default:
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
	}))
	defer server.Close()

	output, err := captureStdout(t, func() error {
		return runThemePackInstall([]string{
			"--pack", server.URL + "/cozy-meadow.zip",
			"--target", server.URL,
			"--skip-firmware-update",
			"--verbose",
		})
	})
	if err != nil {
		t.Fatalf("runThemePackInstall returned error: %v", err)
	}
	for _, want := range []string{
		"Theme source:",
		"Firmware check: skipped",
		"Device: board=esp8266-smalltv-st7789",
		"Uploaded asset: /themes/u/cm.cbi",
		"Uploaded theme spec: /themes/u/cm.json",
		"Active theme path: /themes/u/cm.json themeId=cozy-meadow rev=1",
	} {
		if !strings.Contains(output, want) {
			t.Fatalf("expected verbose output to contain %q, got:\n%s", want, output)
		}
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
	if !activated {
		t.Fatalf("expected activation")
	}
	if sentFrame {
		t.Fatalf("expected theme install not to send demo live frame")
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

func captureStdout(t *testing.T, fn func() error) (string, error) {
	t.Helper()
	old := os.Stdout
	reader, writer, err := os.Pipe()
	if err != nil {
		t.Fatalf("create stdout pipe: %v", err)
	}
	os.Stdout = writer
	defer func() {
		os.Stdout = old
	}()

	runErr := fn()
	if closeErr := writer.Close(); closeErr != nil {
		t.Fatalf("close stdout pipe: %v", closeErr)
	}
	out, readErr := io.ReadAll(reader)
	if readErr != nil {
		t.Fatalf("read stdout pipe: %v", readErr)
	}
	return string(out), runErr
}
