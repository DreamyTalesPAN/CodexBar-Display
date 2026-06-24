package themeinstall

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

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
