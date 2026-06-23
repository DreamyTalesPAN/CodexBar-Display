package themeinstall

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
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

func TestStripURLCredentialsRemovesSignedSourceDetails(t *testing.T) {
	got := stripURLCredentials("https://user:secret@example.com/theme.zip?X-Amz-Signature=abc#frag")
	if got != "https://example.com/theme.zip" {
		t.Fatalf("unexpected stripped source %q", got)
	}
}
