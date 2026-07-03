package themeinstall

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	transportlayer "github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/transport"
)

func TestResolveSourceAllowsThemeIDWithExplicitPackURL(t *testing.T) {
	got, err := ResolveSource("https://example.com/theme.zip", "", "mini-classic")
	if err != nil {
		t.Fatalf("ResolveSource returned error: %v", err)
	}
	if got != "https://example.com/theme.zip" {
		t.Fatalf("unexpected source %q", got)
	}
}

func TestResolveSourceRejectsPackAndCatalog(t *testing.T) {
	_, err := ResolveSource("https://example.com/theme.zip", "https://example.com/catalog.json", "")
	if err == nil {
		t.Fatal("expected error for packUrl plus catalogUrl")
	}
}

func TestStripTargetCredentialsRemovesTokenQuery(t *testing.T) {
	got := stripTargetCredentials("http://vibetv.local?token=secret")
	if got != "http://vibetv.local" {
		t.Fatalf("unexpected stripped target %q", got)
	}
}

func TestAuthRequiredDetectsPairingFailures(t *testing.T) {
	for _, msg := range []string{
		`post frame: status=401 body="pairing token required"`,
		"unauthorized",
	} {
		if !authRequired(errors.New(msg)) {
			t.Fatalf("expected authRequired for %q", msg)
		}
	}
}

func TestPairThemeInstallTargetStoresTokenAndReturnsTokenizedTarget(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/pair" {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true,"token":"pair-token-new"}`))
	}))
	defer server.Close()

	wifi := transportlayer.NewWiFiTransportWithClient(server.Client())
	var storedTarget string
	var storedToken string
	got, err := pairThemeInstallTarget(wifi, server.URL+"?token=old-token", func(target, token string) error {
		storedTarget = target
		storedToken = token
		return nil
	})
	if err != nil {
		t.Fatalf("pairThemeInstallTarget returned error: %v", err)
	}
	if got != server.URL+"?token=pair-token-new" {
		t.Fatalf("unexpected paired target %q", got)
	}
	if storedTarget != server.URL || storedToken != "pair-token-new" {
		t.Fatalf("unexpected stored pairing target=%q token=%q", storedTarget, storedToken)
	}
}

func TestVerifyThemeInstallHealthRejectsGIFDecoderFailure(t *testing.T) {
	withFastRenderHealthCheck(t)
	server := healthServer(t, `{
		"ok": true,
		"display": {
			"activeTheme": "mini-classic",
			"themeSpec": {"active": true, "path": "/themes/u/mini.json", "renderOk": true},
			"gif": {"activePath": "/themes/mini/mini.gif", "filePresent": true, "decoderAllocated": false, "decoderOpen": false, "lastError": "decoder_alloc"}
		}
	}`)
	defer server.Close()

	wifi := transportlayer.NewWiFiTransportWithClient(server.Client())
	err := verifyThemeInstallHealth(wifi, server.URL, "/themes/u/mini.json", []string{"/themes/mini/mini.gif"})
	if err == nil {
		t.Fatal("expected GIF decoder health failure")
	}
	if !strings.Contains(err.Error(), "gif playback not healthy") || !strings.Contains(err.Error(), "decoder_alloc") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestVerifyThemeInstallHealthAcceptsOpenGIFDecoder(t *testing.T) {
	withFastRenderHealthCheck(t)
	server := healthServer(t, `{
		"ok": true,
		"display": {
			"activeTheme": "mini-classic",
			"themeSpec": {"active": true, "path": "/themes/u/mini.json", "renderOk": true},
			"gif": {"activePath": "/themes/mini/mini.gif", "filePresent": true, "decoderAllocated": true, "decoderOpen": true, "lastError": null}
		}
	}`)
	defer server.Close()

	wifi := transportlayer.NewWiFiTransportWithClient(server.Client())
	if err := verifyThemeInstallHealth(wifi, server.URL, "/themes/u/mini.json", []string{"/themes/mini/mini.gif"}); err != nil {
		t.Fatalf("verifyThemeInstallHealth returned error: %v", err)
	}
}

func TestVerifyThemeInstallHealthIgnoresGIFStatusForNonGIFThemes(t *testing.T) {
	withFastRenderHealthCheck(t)
	server := healthServer(t, `{
		"ok": true,
		"display": {
			"activeTheme": "cozy-meadow",
			"themeSpec": {"active": true, "path": "/themes/u/cozy.json", "renderOk": true},
			"gif": {"activePath": "/themes/mini/mini.gif", "filePresent": true, "decoderAllocated": false, "decoderOpen": false, "lastError": "decoder_alloc"}
		}
	}`)
	defer server.Close()

	wifi := transportlayer.NewWiFiTransportWithClient(server.Client())
	if err := verifyThemeInstallHealth(wifi, server.URL, "/themes/u/cozy.json", nil); err != nil {
		t.Fatalf("verifyThemeInstallHealth returned error: %v", err)
	}
}

func TestInstallRetriesTransientThemeActivationFailure(t *testing.T) {
	withFastActivationRetries(t)
	packDir := writeMinimalThemePack(t)
	const activePath = "/themes/u/synth.json"
	var activationAttempts int
	currentActivePath := "/themes/u/claude.json"
	server := themeInstallDeviceServer(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/theme/active":
			activationAttempts++
			if activationAttempts == 1 {
				http.Error(w, "try again", http.StatusServiceUnavailable)
				return
			}
			currentActivePath = activePath
			w.WriteHeader(http.StatusOK)
		case "/health":
			writeThemeHealth(t, w, currentActivePath)
		}
	})
	defer server.Close()

	var out bytes.Buffer
	result, err := Install(context.Background(), Options{
		PackURL:            packDir,
		Target:             server.URL,
		SkipFirmwareUpdate: true,
		Out:                &out,
		HTTPClient:         server.Client(),
		UploadSettleDelay:  -1,
		FetchLiveFrame:     testLiveFrame,
	})
	if err != nil {
		t.Fatalf("Install returned error: %v\nlogs:\n%s", err, out.String())
	}
	if result.ThemeID != "synthwave" {
		t.Fatalf("unexpected theme result: %+v", result)
	}
	if activationAttempts != 2 {
		t.Fatalf("expected activation retry, got attempts=%d", activationAttempts)
	}
	if !strings.Contains(out.String(), "Theme activation interrupted, retrying") ||
		!strings.Contains(out.String(), "Theme activation retry 2/3") {
		t.Fatalf("missing retry log:\n%s", out.String())
	}
}

func TestInstallReactivatesWhenHealthStillShowsPreviousTheme(t *testing.T) {
	withFastActivationRetries(t)
	packDir := writeMinimalThemePack(t)
	const activePath = "/themes/u/synth.json"
	var activationAttempts int
	currentActivePath := "/themes/u/claude.json"
	server := themeInstallDeviceServer(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/theme/active":
			activationAttempts++
			if activationAttempts >= 2 {
				currentActivePath = activePath
			}
			w.WriteHeader(http.StatusOK)
		case "/health":
			writeThemeHealth(t, w, currentActivePath)
		}
	})
	defer server.Close()

	var out bytes.Buffer
	_, err := Install(context.Background(), Options{
		PackURL:            packDir,
		Target:             server.URL,
		SkipFirmwareUpdate: true,
		Out:                &out,
		HTTPClient:         server.Client(),
		UploadSettleDelay:  -1,
		FetchLiveFrame:     testLiveFrame,
	})
	if err != nil {
		t.Fatalf("Install returned error: %v\nlogs:\n%s", err, out.String())
	}
	if activationAttempts != 2 {
		t.Fatalf("expected activation to be retried after stale health, got attempts=%d", activationAttempts)
	}
	if !strings.Contains(out.String(), "Theme activation did not settle, retrying") {
		t.Fatalf("missing stale-health retry log:\n%s", out.String())
	}
}

func TestInstallRestoresPreviousThemeWhenUploadFailsAfterInstallScreen(t *testing.T) {
	packDir := writeMinimalThemePack(t)
	const previousPath = "/themes/u/claude.json"
	var frames []protocol.Frame
	var activatedPaths []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hello":
			writeThemeHello(t, w)
		case "/health":
			writeThemeHealth(t, w, previousPath)
		case "/frame":
			var frame protocol.Frame
			if err := json.NewDecoder(r.Body).Decode(&frame); err != nil {
				t.Fatalf("decode frame: %v", err)
			}
			frames = append(frames, frame)
			w.WriteHeader(http.StatusOK)
		case "/assets":
			_, _ = io.Copy(io.Discard, r.Body)
			http.Error(w, "upload failed", http.StatusBadRequest)
		case "/theme/active":
			var payload struct {
				Path string `json:"path"`
			}
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Fatalf("decode activation: %v", err)
			}
			activatedPaths = append(activatedPaths, payload.Path)
			w.WriteHeader(http.StatusOK)
		default:
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
	}))
	defer server.Close()

	var out bytes.Buffer
	_, err := Install(context.Background(), Options{
		PackURL:            packDir,
		Target:             server.URL,
		SkipFirmwareUpdate: true,
		Out:                &out,
		HTTPClient:         server.Client(),
		UploadSettleDelay:  -1,
		FetchLiveFrame:     testLiveFrame,
	})
	if err == nil {
		t.Fatal("expected install error")
	}
	if len(frames) < 2 {
		t.Fatalf("expected install screen and restore live frame, got %d frames", len(frames))
	}
	if !strings.Contains(string(frames[0].ThemeSpec), `"id":"installing"`) {
		t.Fatalf("expected first frame to show install screen, got themeSpec=%s", string(frames[0].ThemeSpec))
	}
	if got := frames[len(frames)-1].ThemeSpec; len(got) != 0 {
		t.Fatalf("expected restored live frame without inline theme spec, got %s", string(got))
	}
	if len(activatedPaths) != 1 || activatedPaths[0] != previousPath {
		t.Fatalf("expected previous theme activation %q, got %#v", previousPath, activatedPaths)
	}
	if !strings.Contains(out.String(), "Restoring previous theme") ||
		!strings.Contains(out.String(), "Restore previous theme: activated") {
		t.Fatalf("missing restore logs:\n%s", out.String())
	}
}

func TestInstallClearsInstallScreenWhenNoPreviousThemePath(t *testing.T) {
	packDir := writeMinimalThemePack(t)
	var frames []protocol.Frame
	var activatedPaths []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hello":
			writeThemeHello(t, w)
		case "/health":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true,"display":{"activeTheme":"installing","themeSpec":{"active":true,"path":"","renderOk":true}}}`))
		case "/frame":
			var frame protocol.Frame
			if err := json.NewDecoder(r.Body).Decode(&frame); err != nil {
				t.Fatalf("decode frame: %v", err)
			}
			frames = append(frames, frame)
			w.WriteHeader(http.StatusOK)
		case "/assets":
			_, _ = io.Copy(io.Discard, r.Body)
			http.Error(w, "upload failed", http.StatusBadRequest)
		case "/theme/active":
			var payload struct {
				Path string `json:"path"`
			}
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Fatalf("decode activation: %v", err)
			}
			activatedPaths = append(activatedPaths, payload.Path)
			w.WriteHeader(http.StatusOK)
		default:
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
	}))
	defer server.Close()

	var out bytes.Buffer
	_, err := Install(context.Background(), Options{
		PackURL:            packDir,
		Target:             server.URL,
		SkipFirmwareUpdate: true,
		Out:                &out,
		HTTPClient:         server.Client(),
		UploadSettleDelay:  -1,
		FetchLiveFrame:     testLiveFrame,
	})
	if err == nil {
		t.Fatal("expected install error")
	}
	if len(activatedPaths) != 0 {
		t.Fatalf("expected no stored theme activation, got %#v", activatedPaths)
	}
	if len(frames) < 2 {
		t.Fatalf("expected install screen and clear frame, got %d frames", len(frames))
	}
	clearFrame := frames[len(frames)-1]
	if strings.TrimSpace(string(clearFrame.ThemeSpec)) != "null" || !clearFrame.ConfirmClearThemeSpec {
		t.Fatalf("expected confirmed themeSpec clear, got themeSpec=%s confirm=%t", string(clearFrame.ThemeSpec), clearFrame.ConfirmClearThemeSpec)
	}
	if !strings.Contains(out.String(), "Clear install screen: refreshed") {
		t.Fatalf("missing clear log:\n%s", out.String())
	}
}

func withFastRenderHealthCheck(t *testing.T) {
	t.Helper()
	oldAttempts := renderHealthAttempts
	oldDelay := renderHealthDelay
	renderHealthAttempts = 1
	renderHealthDelay = 0
	t.Cleanup(func() {
		renderHealthAttempts = oldAttempts
		renderHealthDelay = oldDelay
	})
}

func withFastActivationRetries(t *testing.T) {
	t.Helper()
	oldRenderAttempts := renderHealthAttempts
	oldRenderDelay := renderHealthDelay
	oldActivationAttempts := activationAttempts
	oldActivationDelay := activationRetryDelay
	renderHealthAttempts = 1
	renderHealthDelay = 0
	activationAttempts = 3
	activationRetryDelay = 0
	t.Cleanup(func() {
		renderHealthAttempts = oldRenderAttempts
		renderHealthDelay = oldRenderDelay
		activationAttempts = oldActivationAttempts
		activationRetryDelay = oldActivationDelay
	})
}

func healthServer(t *testing.T, body string) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/health" {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(body))
	}))
}

func writeMinimalThemePack(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	spec := `{"v":1,"id":"synthwave","rev":1,"fb":"mini","p":[{"t":"tx","x":0,"y":0,"v":"OK","s":1}]}`
	manifest := `{
		"kind":"vibetv-theme-pack",
		"schemaVersion":1,
		"id":"synthwave",
		"name":"Synthwave",
		"themeSpec":{"path":"/themes/u/synth.json","file":"theme.json"}
	}`
	if err := os.WriteFile(filepath.Join(dir, "manifest.json"), []byte(manifest), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "theme.json"), []byte(spec), 0o644); err != nil {
		t.Fatal(err)
	}
	return dir
}

func themeInstallDeviceServer(t *testing.T, handle func(http.ResponseWriter, *http.Request)) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hello":
			writeThemeHello(t, w)
		case "/assets":
			if r.URL.Query().Get("path") != "/themes/u/synth.json" {
				t.Fatalf("unexpected asset path %q", r.URL.Query().Get("path"))
			}
			_, _ = io.Copy(io.Discard, r.Body)
			w.WriteHeader(http.StatusOK)
		case "/frame":
			_, _ = io.Copy(io.Discard, r.Body)
			w.WriteHeader(http.StatusOK)
		case "/theme/active", "/health":
			handle(w, r)
		default:
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
	}))
}

func writeThemeHello(t *testing.T, w http.ResponseWriter) {
	t.Helper()
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(`{
		"kind":"hello",
		"protocolVersion":2,
		"board":"esp8266-smalltv-st7789",
		"firmware":"1.0.33",
		"features":["theme","theme-spec-v1"],
		"maxFrameBytes":1024,
		"capabilities":{
			"theme":{"supportsThemeSpecV1":true,"maxThemeSpecBytes":4096,"maxThemePrimitives":32},
			"transport":{"active":"wifi"}
		}
	}`))
}

func writeThemeHealth(t *testing.T, w http.ResponseWriter, activePath string) {
	t.Helper()
	activeTheme := "claude-creature"
	if activePath == "/themes/u/synth.json" {
		activeTheme = "synthwave"
	}
	payload := map[string]any{
		"ok": true,
		"display": map[string]any{
			"activeTheme": activeTheme,
			"themeSpec": map[string]any{
				"active":   true,
				"path":     activePath,
				"renderOk": true,
			},
		},
	}
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		t.Fatal(err)
	}
}

func testLiveFrame(context.Context) (protocol.Frame, error) {
	return protocol.Frame{
		V:         protocol.ProtocolVersionV2,
		Provider:  "codex",
		Label:     "Codex",
		Session:   74,
		Weekly:    80,
		UsageMode: "remaining",
	}, nil
}
