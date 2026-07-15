package themeinstall

import (
	"bytes"
	"compress/lzw"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
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
	got := stripTargetCredentials("http://192.0.2.10?token=secret")
	if got != "http://192.0.2.10" {
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

func TestCleanupThemeUserAssetsDeletesOnlyUserThemeFiles(t *testing.T) {
	var deleted []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/assets" {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		switch r.Method {
		case http.MethodGet:
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"assets":[{"path":"/themes/u/old.cba","sizeBytes":12000},{"path":"/themes/u/old.json","sizeBytes":900},{"path":"/themes/mini/mini.gif","sizeBytes":14336}]}`))
		case http.MethodDelete:
			deleted = append(deleted, r.URL.Query().Get("path"))
			w.WriteHeader(http.StatusOK)
		default:
			t.Fatalf("unexpected assets method %s", r.Method)
		}
	}))
	defer server.Close()

	wifi := transportlayer.NewWiFiTransportWithClient(server.Client())
	target := server.URL
	var out bytes.Buffer
	cleanupThemeUserAssets(wifi, &target, nil, &out, nil)

	if strings.Join(deleted, ",") != "/themes/u/old.cba,/themes/u/old.json" {
		t.Fatalf("unexpected deleted paths: %v", deleted)
	}
	if !strings.Contains(out.String(), "Cleaning old theme files") {
		t.Fatalf("missing cleanup log: %s", out.String())
	}
}

func TestCleanupThemeUserAssetsKeepsInstalledThemeFiles(t *testing.T) {
	var deleted []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/assets" {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		switch r.Method {
		case http.MethodGet:
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"assets":[{"path":"/themes/u/new.json","sizeBytes":900},{"path":"/themes/u/new.cbi","sizeBytes":12000},{"path":"/themes/u/old.json","sizeBytes":900}]}`))
		case http.MethodDelete:
			deleted = append(deleted, r.URL.Query().Get("path"))
			w.WriteHeader(http.StatusOK)
		default:
			t.Fatalf("unexpected assets method %s", r.Method)
		}
	}))
	defer server.Close()

	wifi := transportlayer.NewWiFiTransportWithClient(server.Client())
	target := server.URL
	var out bytes.Buffer
	cleanupThemeUserAssets(wifi, &target, nil, &out, map[string]bool{
		"/themes/u/new.json": true,
		"/themes/u/new.cbi":  true,
	})

	if strings.Join(deleted, ",") != "/themes/u/old.json" {
		t.Fatalf("unexpected deleted paths: %v", deleted)
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

func TestInstallEnforcesGIFLZWCapabilityBeforeUpload(t *testing.T) {
	packDir := writeGIFThemePack(t, makeTwelveBitGIF(t))

	t.Run("advertised eleven bit limit rejects before upload", func(t *testing.T) {
		var uploadAttempts atomic.Int32
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/hello" {
				writeThemeHelloWithLZWLimit(t, w, ptrTo(11))
				return
			}
			if r.URL.Path == "/assets" && r.Method == http.MethodPost {
				uploadAttempts.Add(1)
			}
			http.Error(w, "request must not pass capability preflight", http.StatusInternalServerError)
		}))
		defer server.Close()

		_, err := Install(context.Background(), Options{
			PackURL:            packDir,
			Target:             server.URL,
			SkipFirmwareUpdate: true,
			HTTPClient:         server.Client(),
		})
		if err == nil || !strings.Contains(err.Error(), "requires LZW code width 12 bits") {
			t.Fatalf("expected 12-bit GIF capability error, got %v", err)
		}
		if got := uploadAttempts.Load(); got != 0 {
			t.Fatalf("expected capability rejection before upload, got %d upload attempts", got)
		}
	})

	t.Run("legacy hello without limit remains compatible", func(t *testing.T) {
		withFastActivationRetries(t)
		var uploadAttempts atomic.Int32
		uploadedAssets := make(map[string]int)
		activePath := ""
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			switch r.URL.Path {
			case "/hello":
				writeThemeHelloWithLZWLimit(t, w, nil)
			case "/health":
				w.Header().Set("Content-Type", "application/json")
				if err := json.NewEncoder(w).Encode(map[string]any{
					"ok": true,
					"display": map[string]any{
						"activeTheme": "wide-gif",
						"themeSpec": map[string]any{
							"active":   activePath != "",
							"path":     activePath,
							"renderOk": true,
						},
						"gif": map[string]any{
							"activePath":       "/themes/u/wide.gif",
							"filePresent":      true,
							"decoderAllocated": true,
							"decoderOpen":      true,
						},
					},
				}); err != nil {
					t.Fatal(err)
				}
			case "/frame":
				_, _ = io.Copy(io.Discard, r.Body)
				w.WriteHeader(http.StatusOK)
			case "/assets":
				switch r.Method {
				case http.MethodPost:
					uploadAttempts.Add(1)
					uploadedAssets[r.URL.Query().Get("path")] = readUploadedAssetSize(t, r)
					w.WriteHeader(http.StatusOK)
				case http.MethodGet:
					writeAssetList(t, w, uploadedAssets)
				default:
					http.Error(w, "unexpected assets method", http.StatusMethodNotAllowed)
				}
			case "/theme/active":
				var payload struct {
					Path string `json:"path"`
				}
				if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
					t.Fatal(err)
				}
				activePath = payload.Path
				w.WriteHeader(http.StatusOK)
			default:
				http.Error(w, "unexpected path", http.StatusNotFound)
			}
		}))
		defer server.Close()

		result, err := Install(context.Background(), Options{
			PackURL:            packDir,
			Target:             server.URL,
			SkipFirmwareUpdate: true,
			HTTPClient:         server.Client(),
			UploadSettleDelay:  -1,
			FetchLiveFrame:     testLiveFrame,
		})
		if err != nil {
			t.Fatalf("legacy hello must not impose the new width limit: %v", err)
		}
		if result.ThemeID != "wide-gif" || activePath != "/themes/u/wide.json" {
			t.Fatalf("expected successful legacy install, got result=%+v activePath=%q", result, activePath)
		}
		if got := uploadAttempts.Load(); got != 2 {
			t.Fatalf("expected GIF and theme spec uploads, got %d", got)
		}
	})
}

func TestInstallRejectsTruncatedUploadedAsset(t *testing.T) {
	withFastUploadVerification(t)
	packDir := writeMinimalThemePack(t)
	const previousPath = "/themes/u/claude.json"
	uploadedAssets := make(map[string]int)
	var uploadAttempts int
	var restoredPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hello":
			writeThemeHello(t, w)
		case "/health":
			writeThemeHealth(t, w, previousPath)
		case "/frame":
			_, _ = io.Copy(io.Discard, r.Body)
			w.WriteHeader(http.StatusOK)
		case "/assets":
			switch r.Method {
			case http.MethodPost:
				uploadAttempts++
				size := readUploadedAssetSize(t, r)
				uploadedAssets[r.URL.Query().Get("path")] = size - 1
				w.WriteHeader(http.StatusOK)
			case http.MethodGet:
				writeAssetList(t, w, uploadedAssets)
			default:
				t.Fatalf("unexpected assets method %s", r.Method)
			}
		case "/theme/active":
			var payload struct {
				Path string `json:"path"`
			}
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Fatalf("decode activation: %v", err)
			}
			restoredPath = payload.Path
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
		t.Fatal("expected truncated asset install error")
	}
	if !strings.Contains(err.Error(), "has size") || !strings.Contains(err.Error(), "expected") {
		t.Fatalf("expected asset size mismatch error, got %v", err)
	}
	if uploadAttempts != uploadVerifyAttempts {
		t.Fatalf("expected upload verification retries, got %d", uploadAttempts)
	}
	if restoredPath != previousPath {
		t.Fatalf("expected previous theme restore %q, got %q", previousPath, restoredPath)
	}
	if !strings.Contains(out.String(), "Upload verification failed, retrying") {
		t.Fatalf("missing upload verification retry log:\n%s", out.String())
	}
}

func TestInstallRestoresPreviousThemeWhenUploadFailsAfterInstallScreen(t *testing.T) {
	packDir := writeMinimalThemePack(t)
	const previousPath = "/themes/u/claude.json"
	var frames []protocol.Frame
	var activatedPaths []string
	var deletedPaths []string
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
			switch r.Method {
			case http.MethodGet:
				writeAssetList(t, w, map[string]int{
					previousPath:           900,
					"/themes/u/claude.cbi": 12000,
				})
			case http.MethodDelete:
				deletedPaths = append(deletedPaths, r.URL.Query().Get("path"))
				w.WriteHeader(http.StatusOK)
			case http.MethodPost:
				_, _ = io.Copy(io.Discard, r.Body)
				http.Error(w, "upload failed", http.StatusBadRequest)
			default:
				t.Fatalf("unexpected assets method %s", r.Method)
			}
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
	if len(deletedPaths) != 0 {
		t.Fatalf("install failure should not delete previous theme files, deleted %#v", deletedPaths)
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

func withFastUploadVerification(t *testing.T) {
	t.Helper()
	oldDelay := uploadVerifyRetryDelay
	uploadVerifyRetryDelay = 0
	t.Cleanup(func() {
		uploadVerifyRetryDelay = oldDelay
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

func writeGIFThemePack(t *testing.T, gif []byte) string {
	t.Helper()
	dir := t.TempDir()
	spec := `{"v":1,"id":"wide-gif","rev":1,"fb":"mini","p":[{"t":"g","x":0,"y":0,"w":80,"h":80,"a":"/themes/u/wide.gif"}]}`
	manifest := `{
		"kind":"vibetv-theme-pack",
		"schemaVersion":1,
		"id":"wide-gif",
		"name":"Wide GIF",
		"themeSpec":{"path":"/themes/u/wide.json","file":"theme.json"},
		"assets":[{"path":"/themes/u/wide.gif","file":"wide.gif"}]
	}`
	if err := os.WriteFile(filepath.Join(dir, "manifest.json"), []byte(manifest), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "theme.json"), []byte(spec), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "wide.gif"), gif, 0o644); err != nil {
		t.Fatal(err)
	}
	return dir
}

func makeTwelveBitGIF(t *testing.T) []byte {
	t.Helper()
	const width, height = 50, 40
	pixels := make([]byte, width*height)
	var random uint32 = 0x9e3779b9
	for i := range pixels {
		random ^= random << 13
		random ^= random >> 17
		random ^= random << 5
		pixels[i] = byte(random)
	}

	var compressed bytes.Buffer
	writer := lzw.NewWriter(&compressed, lzw.LSB, 8)
	if _, err := writer.Write(pixels); err != nil {
		t.Fatalf("encode test GIF pixels: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("finish test GIF LZW stream: %v", err)
	}

	gif := []byte("GIF89a")
	gif = append(gif,
		width, 0, height, 0,
		0x80, 0, 0,
		0, 0, 0, 0xff, 0xff, 0xff,
		0x2c, 0, 0, 0, 0, width, 0, height, 0, 0,
		8,
	)
	data := compressed.Bytes()
	for len(data) > 0 {
		size := len(data)
		if size > 255 {
			size = 255
		}
		gif = append(gif, byte(size))
		gif = append(gif, data[:size]...)
		data = data[size:]
	}
	return append(gif, 0, 0x3b)
}

func themeInstallDeviceServer(t *testing.T, handle func(http.ResponseWriter, *http.Request)) *httptest.Server {
	t.Helper()
	uploadedAssets := make(map[string]int)
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hello":
			writeThemeHello(t, w)
		case "/assets":
			switch r.Method {
			case http.MethodGet:
				writeAssetList(t, w, uploadedAssets)
			case http.MethodPost:
				if r.URL.Query().Get("path") != "/themes/u/synth.json" {
					t.Fatalf("unexpected asset path %q", r.URL.Query().Get("path"))
				}
				size := readUploadedAssetSize(t, r)
				uploadedAssets[r.URL.Query().Get("path")] = size
				w.WriteHeader(http.StatusOK)
			default:
				t.Fatalf("unexpected assets method %s", r.Method)
			}
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

func writeAssetList(t *testing.T, w http.ResponseWriter, assets map[string]int) {
	t.Helper()
	w.Header().Set("Content-Type", "application/json")
	var out strings.Builder
	out.WriteString(`{"assets":[`)
	first := true
	for path, size := range assets {
		if !first {
			out.WriteByte(',')
		}
		first = false
		out.WriteString(`{"path":`)
		encoded, err := json.Marshal(path)
		if err != nil {
			t.Fatalf("encode asset path: %v", err)
		}
		out.Write(encoded)
		out.WriteString(`,"sizeBytes":`)
		out.WriteString(fmt.Sprintf("%d", size))
		out.WriteByte('}')
	}
	out.WriteString(`]}`)
	_, _ = w.Write([]byte(out.String()))
}

func readUploadedAssetSize(t *testing.T, r *http.Request) int {
	t.Helper()
	reader, err := r.MultipartReader()
	if err != nil {
		t.Fatalf("MultipartReader returned error: %v", err)
	}
	part, err := reader.NextPart()
	if err != nil {
		t.Fatalf("NextPart returned error: %v", err)
	}
	if part.FormName() != "asset" {
		t.Fatalf("unexpected form field %s", part.FormName())
	}
	body, err := io.ReadAll(part)
	if err != nil {
		t.Fatalf("read asset part: %v", err)
	}
	return len(body)
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

func writeThemeHelloWithLZWLimit(t *testing.T, w http.ResponseWriter, maxBits *int) {
	t.Helper()
	themeCapabilities := map[string]any{
		"supportsThemeSpecV1": true,
		"maxThemeSpecBytes":   4096,
		"maxThemePrimitives":  32,
		"maxThemeGifAssets":   1,
		"maxThemeGifBytes":    1 << 20,
		"maxThemeGifWidth":    80,
		"maxThemeGifHeight":   80,
		"maxThemeGifPixels":   6400,
	}
	if maxBits != nil {
		themeCapabilities["maxThemeGifLzwBits"] = *maxBits
	}
	payload := map[string]any{
		"kind":            "hello",
		"protocolVersion": 2,
		"board":           "esp8266-smalltv-st7789",
		"firmware":        "1.0.36",
		"features":        []string{"theme", "theme-spec-v1"},
		"maxFrameBytes":   1024,
		"capabilities": map[string]any{
			"theme":     themeCapabilities,
			"transport": map[string]any{"active": "wifi"},
		},
	}
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		t.Fatal(err)
	}
}

func ptrTo(value int) *int {
	return &value
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
