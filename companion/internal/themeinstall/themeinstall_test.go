package themeinstall

import (
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
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/themespec"
	transportlayer "github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/transport"
)

func TestInstallingThemeSpecIsValidAndCompact(t *testing.T) {
	spec, raw, err := themespec.Parse(installingThemeSpec)
	if err != nil {
		t.Fatalf("Parse returned error: %v", err)
	}
	if err := themespec.Validate(spec); err != nil {
		t.Fatalf("Validate returned error: %v", err)
	}
	frame := protocol.Frame{
		V:         protocol.ProtocolVersionV2,
		Provider:  "vibetv",
		Label:     "Installing",
		Session:   45,
		Weekly:    45,
		UsageMode: "remaining",
		ThemeSpec: raw,
	}
	line, err := frame.MarshalLine()
	if err != nil {
		t.Fatalf("MarshalLine returned error: %v", err)
	}
	if len(strings.TrimSpace(string(line))) > protocol.DefaultMaxFrameBytes {
		t.Fatalf("installing frame is too large: size=%d limit=%d", len(strings.TrimSpace(string(line))), protocol.DefaultMaxFrameBytes)
	}
}

func TestSendInstallingThemeFramePostsFrame(t *testing.T) {
	var gotBody string
	var gotToken string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/frame" {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		gotToken = r.Header.Get("X-VibeTV-Token")
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Fatalf("read body: %v", err)
		}
		gotBody = string(body)
		if strings.ContainsAny(gotBody, "\r\n") {
			t.Fatalf("frame body should not include a newline: %q", gotBody)
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	wifi := transportlayer.NewWiFiTransportWithClient(server.Client())
	caps := FallbackThemeSpecCapabilities()
	caps.ActiveTransport = "wifi"
	caps.MaxFrameBytes = protocol.DefaultMaxFrameBytes
	if err := sendInstallingThemeFrame(wifi, server.URL+"?token=pair-token-123", caps); err != nil {
		t.Fatalf("sendInstallingThemeFrame returned error: %v", err)
	}
	if gotToken != "pair-token-123" {
		t.Fatalf("unexpected token %q", gotToken)
	}
	var frame protocol.Frame
	if err := json.Unmarshal([]byte(gotBody), &frame); err != nil {
		t.Fatalf("unmarshal frame: %v", err)
	}
	if frame.Label != "Installing" || !strings.Contains(string(frame.ThemeSpec), `"id":"installing"`) {
		t.Fatalf("unexpected installing frame: %+v body=%s", frame, gotBody)
	}
}

func TestSendLiveThemeFramePostsCurrentUsage(t *testing.T) {
	var gotBody string
	var gotToken string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/frame" {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		gotToken = r.Header.Get("X-VibeTV-Token")
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Fatalf("read body: %v", err)
		}
		gotBody = string(body)
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	wifi := transportlayer.NewWiFiTransportWithClient(server.Client())
	caps := FallbackThemeSpecCapabilities()
	caps.ActiveTransport = "wifi"
	caps.MaxFrameBytes = protocol.DefaultMaxFrameBytes
	err := sendLiveThemeFrame(context.Background(), wifi, server.URL+"?token=pair-token-456", caps, func(context.Context) (protocol.Frame, error) {
		return protocol.Frame{
			V:                     protocol.ProtocolVersionV1,
			Provider:              "claude",
			Label:                 "Claude",
			Session:               87,
			Weekly:                54,
			UsageMode:             "remaining",
			Activity:              "coding",
			Theme:                 "mini",
			ThemeSpec:             installingThemeSpec,
			ConfirmClearThemeSpec: true,
		}, nil
	})
	if err != nil {
		t.Fatalf("sendLiveThemeFrame returned error: %v", err)
	}
	if gotToken != "pair-token-456" {
		t.Fatalf("unexpected token %q", gotToken)
	}
	var frame protocol.Frame
	if err := json.Unmarshal([]byte(gotBody), &frame); err != nil {
		t.Fatalf("unmarshal frame: %v", err)
	}
	if frame.Provider != "claude" || frame.Label != "Claude" || frame.Session != 87 || frame.Weekly != 54 || frame.Activity != "coding" {
		t.Fatalf("unexpected live frame: %+v body=%s", frame, gotBody)
	}
	if frame.V != protocol.ProtocolVersionV2 {
		t.Fatalf("expected negotiated protocol version, got %d", frame.V)
	}
	if frame.Theme != "" || len(frame.ThemeSpec) > 0 || frame.ConfirmClearThemeSpec {
		t.Fatalf("live frame must not carry theme override fields: %+v body=%s", frame, gotBody)
	}
}

func TestInstallRefreshesLiveUsageAfterActivatingTheme(t *testing.T) {
	packDir := newMinimalThemePack(t)
	var frames []protocol.Frame
	activated := false
	liveFrameAfterActivation := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hello":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"board":"esp8266-smalltv-st7789","features":["theme","theme-spec-v1"],"capabilities":{"theme":{"supportsThemeSpecV1":true,"maxThemeSpecBytes":2048,"maxThemePrimitives":32,"builtinThemes":["mini"]},"transport":{"active":"wifi"},"frame":{"maxBytes":2048}}}`))
		case "/frame":
			var frame protocol.Frame
			if err := json.NewDecoder(r.Body).Decode(&frame); err != nil {
				t.Fatalf("decode frame: %v", err)
			}
			if activated && frame.Provider == "claude" {
				liveFrameAfterActivation = true
			}
			frames = append(frames, frame)
			w.WriteHeader(http.StatusOK)
		case "/assets":
			w.WriteHeader(http.StatusOK)
		case "/health":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true}`))
		case "/theme/active":
			activated = true
			w.WriteHeader(http.StatusOK)
		default:
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
	}))
	defer server.Close()

	_, err := Install(context.Background(), Options{
		PackURL:            packDir,
		Target:             server.URL + "?token=pair-token-789",
		SkipFirmwareUpdate: true,
		Out:                io.Discard,
		HTTPClient:         server.Client(),
		UploadSettleDelay:  -1,
		FetchLiveFrame: func(context.Context) (protocol.Frame, error) {
			return protocol.Frame{
				Provider:  "claude",
				Label:     "Claude",
				Session:   87,
				Weekly:    54,
				UsageMode: "remaining",
				Activity:  "coding",
			}, nil
		},
	})
	if err != nil {
		t.Fatalf("Install returned error: %v", err)
	}
	if len(frames) != 2 {
		t.Fatalf("expected install and live frames, got %+v", frames)
	}
	if frames[0].Label != "Installing" || !strings.Contains(string(frames[0].ThemeSpec), `"id":"installing"`) {
		t.Fatalf("first frame should show install screen, got %+v", frames[0])
	}
	if !liveFrameAfterActivation {
		t.Fatalf("expected live frame after theme activation, frames=%+v", frames)
	}
	if frames[1].Provider != "claude" || frames[1].Label != "Claude" || frames[1].Session != 87 || frames[1].Weekly != 54 || len(frames[1].ThemeSpec) > 0 {
		t.Fatalf("second frame should be current usage without install spec, got %+v", frames[1])
	}
}

func TestInstallDoesNotFailWhenLiveUsageRefreshFails(t *testing.T) {
	packDir := newMinimalThemePack(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hello":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"board":"esp8266-smalltv-st7789","features":["theme","theme-spec-v1"],"capabilities":{"theme":{"supportsThemeSpecV1":true,"maxThemeSpecBytes":2048,"maxThemePrimitives":32,"builtinThemes":["mini"]},"transport":{"active":"wifi"},"frame":{"maxBytes":2048}}}`))
		case "/frame", "/assets", "/health", "/theme/active":
			w.WriteHeader(http.StatusOK)
		default:
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
	}))
	defer server.Close()

	var out strings.Builder
	_, err := Install(context.Background(), Options{
		PackURL:            packDir,
		Target:             server.URL,
		SkipFirmwareUpdate: true,
		Out:                &out,
		HTTPClient:         server.Client(),
		UploadSettleDelay:  -1,
		FetchLiveFrame: func(context.Context) (protocol.Frame, error) {
			return protocol.Frame{}, errors.New("codexbar unavailable")
		},
	})
	if err != nil {
		t.Fatalf("Install should not fail when live frame refresh fails: %v", err)
	}
	if !strings.Contains(out.String(), "Live usage frame: skipped") {
		t.Fatalf("expected skipped live frame log, got %q", out.String())
	}
}

func TestResolveSourceAllowsThemeIDWithExplicitPackURL(t *testing.T) {
	got, err := ResolveSource("https://example.com/theme.zip", "", "mini-classic")
	if err != nil {
		t.Fatalf("ResolveSource returned error: %v", err)
	}
	if got != "https://example.com/theme.zip" {
		t.Fatalf("unexpected source %q", got)
	}
}

func newMinimalThemePack(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	themeRaw := []byte(`{"v":1,"id":"test-live","rev":1,"fb":"mini","p":[{"t":"tx","x":0,"y":0,"v":"{label}","s":1,"c":"#FFFFFF"}]}`)
	manifestRaw := []byte(`{"kind":"vibetv-theme-pack","schemaVersion":1,"id":"test-live","name":"Test Live","version":"1.0.0","themeSpec":{"path":"/themes/u/test-live.json","file":"theme.json","contentType":"application/json"},"assets":[]}`)
	if err := os.WriteFile(filepath.Join(dir, "theme.json"), themeRaw, 0o644); err != nil {
		t.Fatalf("write theme: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "manifest.json"), manifestRaw, 0o644); err != nil {
		t.Fatalf("write manifest: %v", err)
	}
	return dir
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

func TestStripURLCredentialsRemovesSignedSourceDetails(t *testing.T) {
	got := stripURLCredentials("https://user:secret@example.com/theme.zip?X-Amz-Signature=abc#frag")
	if got != "https://example.com/theme.zip" {
		t.Fatalf("unexpected stripped source %q", got)
	}
}
