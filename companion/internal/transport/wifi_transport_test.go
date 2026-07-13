package transport

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestWiFiTransportDeviceCapabilitiesReadsHello(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/hello" {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"supportedProtocolVersions":[2,1],"preferredProtocolVersion":2,"board":"esp8266-smalltv-st7789","features":["theme"],"maxFrameBytes":1024,"capabilities":{"transport":{"active":"wifi","supported":["usb","wifi"]}}}`))
	}))
	defer server.Close()

	transport := NewWiFiTransportWithClient(server.Client())
	caps, err := transport.DeviceCapabilities(server.URL)
	if err != nil {
		t.Fatalf("DeviceCapabilities returned error: %v", err)
	}
	if !caps.Known || caps.Board != "esp8266-smalltv-st7789" {
		t.Fatalf("unexpected capabilities: %+v", caps)
	}
	if caps.ActiveTransport != "wifi" || len(caps.SupportedTransportChannels) != 2 {
		t.Fatalf("unexpected transport capabilities: %+v", caps)
	}
}

func TestWiFiTransportSendLinePostsFrame(t *testing.T) {
	var gotBody string
	var gotToken string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/frame" {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		gotToken = r.Header.Get(deviceAuthHeader)
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Fatalf("read request body: %v", err)
		}
		gotBody = string(body)
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	transport := NewWiFiTransportWithClient(server.Client())
	line := []byte(`{"provider":"codex","session":12}` + "\n")
	if err := transport.SendLine(server.URL+"/?token=pair-token-123", line); err != nil {
		t.Fatalf("SendLine returned error: %v", err)
	}
	if gotBody != string(line) {
		t.Fatalf("unexpected body %q", gotBody)
	}
	if gotToken != "pair-token-123" {
		t.Fatalf("unexpected auth token %q", gotToken)
	}
}

func TestWiFiTransportDeviceHealthReadsHealth(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/health" {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		if !r.Close {
			t.Fatalf("expected health request to close connection")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer server.Close()

	transport := NewWiFiTransportWithClient(server.Client())
	if err := transport.DeviceHealth(server.URL); err != nil {
		t.Fatalf("DeviceHealth returned error: %v", err)
	}
}

func TestWiFiTransportDeviceHealthSnapshotReadsGIFLastError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/health" {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true,"display":{"activeTheme":"mini-classic","themeSpec":{"active":true,"path":"/themes/u/mini.json","renderOk":true},"gif":{"activePath":"/themes/mini/mini.gif","filePresent":true,"decoderAllocated":true,"decoderOpen":false,"lastError":"decoder_alloc"}}}`))
	}))
	defer server.Close()

	transport := NewWiFiTransportWithClient(server.Client())
	health, err := transport.DeviceHealthSnapshot(server.URL)
	if err != nil {
		t.Fatalf("DeviceHealthSnapshot returned error: %v", err)
	}
	if health.Display.GIF.LastError != "decoder_alloc" {
		t.Fatalf("unexpected GIF lastError %q", health.Display.GIF.LastError)
	}
	if health.Display.GIF.DecoderOpen {
		t.Fatal("expected closed GIF decoder")
	}
	if !health.Display.GIF.DecoderAllocated {
		t.Fatal("expected allocated GIF decoder")
	}
}

func TestWiFiTransportDeviceAssetsReadsAssetSizes(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/assets" {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"assets":[{"path":"/themes/u/cp-i.cba","sizeBytes":14336}]}`))
	}))
	defer server.Close()

	transport := NewWiFiTransportWithClient(server.Client())
	assets, err := transport.DeviceAssets(server.URL)
	if err != nil {
		t.Fatalf("DeviceAssets returned error: %v", err)
	}
	if got, ok := assets.AssetSize("/themes/u/cp-i.cba"); !ok || got != 14336 {
		t.Fatalf("unexpected asset size got=%d ok=%t", got, ok)
	}
	if _, ok := assets.AssetSize("/missing"); ok {
		t.Fatal("unexpected asset match for missing path")
	}
	paths := assets.PathsWithPrefix("/themes/u/")
	if len(paths) != 1 || paths[0] != "/themes/u/cp-i.cba" {
		t.Fatalf("unexpected prefixed paths: %v", paths)
	}
}

func TestWiFiTransportDeleteAssetSendsDELETE(t *testing.T) {
	var gotPath string
	var gotToken string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/assets" {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		if r.Method != http.MethodDelete {
			t.Fatalf("expected DELETE /assets, got %s", r.Method)
		}
		gotToken = r.Header.Get(deviceAuthHeader)
		gotPath = r.URL.Query().Get("path")
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	transport := NewWiFiTransportWithClient(server.Client())
	if err := transport.DeleteAsset(server.URL+"?token=pair-token-123", "/themes/u/old.cba"); err != nil {
		t.Fatalf("DeleteAsset returned error: %v", err)
	}
	if gotPath != "/themes/u/old.cba" {
		t.Fatalf("unexpected delete path %q", gotPath)
	}
	if gotToken != "pair-token-123" {
		t.Fatalf("unexpected auth token %q", gotToken)
	}
}

func TestWiFiTransportPairDevicePostsPairingAPI(t *testing.T) {
	var gotBody string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/pair" {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		if r.Method != http.MethodPost {
			t.Fatalf("expected POST /api/pair, got %s", r.Method)
		}
		if got := r.URL.Query().Get("api"); got != "1" {
			t.Fatalf("expected api=1 query, got %q", got)
		}
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Fatalf("read request body: %v", err)
		}
		gotBody = string(body)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true,"token":"pair-token-abc"}`))
	}))
	defer server.Close()

	transport := NewWiFiTransportWithClient(server.Client())
	token, err := transport.PairDevice(server.URL)
	if err != nil {
		t.Fatalf("PairDevice returned error: %v", err)
	}
	if token != "pair-token-abc" {
		t.Fatalf("unexpected token %q", token)
	}
	if gotBody != "" {
		t.Fatalf("unexpected pair body %q", gotBody)
	}
}

func TestWiFiTransportPairDeviceRetriesLostResponses(t *testing.T) {
	oldDelay := pairDeviceRetryDelay
	pairDeviceRetryDelay = 0
	t.Cleanup(func() { pairDeviceRetryDelay = oldDelay })

	var attempts atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempt := attempts.Add(1)
		if r.Method != http.MethodPost || r.URL.Path != "/api/pair" || r.URL.Query().Get("api") != "1" {
			t.Errorf("unexpected pair request method=%s url=%s", r.Method, r.URL.String())
		}
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Errorf("read pair body: %v", err)
		}
		if len(body) != 0 {
			t.Errorf("pair body=%q want empty", body)
		}
		w.Header().Set("Content-Type", "application/json")
		if attempt < pairDeviceAttempts {
			_, _ = w.Write([]byte(`{"ok":`))
			return
		}
		_, _ = w.Write([]byte(`{"ok":true,"token":"pair-token-final"}`))
	}))
	defer server.Close()

	transport := NewWiFiTransportWithClient(server.Client())
	token, err := transport.PairDevice(server.URL)
	if err != nil {
		t.Fatalf("PairDevice returned error: %v", err)
	}
	if token != "pair-token-final" || attempts.Load() != pairDeviceAttempts {
		t.Fatalf("token=%q attempts=%d want final token after %d attempts", token, attempts.Load(), pairDeviceAttempts)
	}
}

func TestWiFiTransportResolveTargetAddsHTTPDefault(t *testing.T) {
	transport := NewWiFiTransportWithClient(nil)
	target, err := transport.ResolvePort("192.168.178.123")
	if err != nil {
		t.Fatalf("ResolvePort returned error: %v", err)
	}
	if target != "http://192.168.178.123" {
		t.Fatalf("unexpected target %q", target)
	}
}

func TestWiFiTransportResolveTargetPreservesPairingToken(t *testing.T) {
	transport := NewWiFiTransportWithClient(nil)
	target, err := transport.ResolvePort("192.168.178.123?token=pair-token-123&debug=1")
	if err != nil {
		t.Fatalf("ResolvePort returned error: %v", err)
	}
	if target != "http://192.168.178.123?token=pair-token-123" {
		t.Fatalf("unexpected target %q", target)
	}
}

func TestWiFiTransportUploadAssetPostsMultipart(t *testing.T) {
	var gotPath string
	var gotFilename string
	var gotBody string
	var gotToken string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/assets" {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		gotToken = r.Header.Get(deviceAuthHeader)
		gotPath = r.URL.Query().Get("path")
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
		gotFilename = part.FileName()
		body, err := io.ReadAll(part)
		if err != nil {
			t.Fatalf("read part: %v", err)
		}
		gotBody = string(body)
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	t.Setenv(deviceAuthEnv, "env-token-456")
	transport := NewWiFiTransportWithClient(server.Client())
	if err := transport.UploadAsset(server.URL, "/themes/u/cm.cbi", "cm.cbi", []byte("CBI1\n")); err != nil {
		t.Fatalf("UploadAsset returned error: %v", err)
	}
	if gotPath != "/themes/u/cm.cbi" || gotFilename != "cm.cbi" || gotBody != "CBI1\n" {
		t.Fatalf("unexpected upload path=%q filename=%q body=%q", gotPath, gotFilename, gotBody)
	}
	if gotToken != "env-token-456" {
		t.Fatalf("unexpected auth token %q", gotToken)
	}
}

func TestWiFiTransportUploadAssetRetriesTimeout(t *testing.T) {
	oldDelay := assetUploadRetryDelay
	assetUploadRetryDelay = 0
	defer func() {
		assetUploadRetryDelay = oldDelay
	}()

	var attempts int
	var retries int
	transport := NewWiFiTransportWithClient(&http.Client{
		Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
			attempts++
			if attempts == 1 {
				return nil, context.DeadlineExceeded
			}
			return &http.Response{
				StatusCode: http.StatusOK,
				Body:       io.NopCloser(strings.NewReader("")),
			}, nil
		}),
	}).WithAssetUploadRetryObserver(func(retry AssetUploadRetry) {
		retries++
		if retry.DevicePath != "/themes/u/cm.cbi" || retry.Attempt != 1 || retry.MaxAttempts != assetUploadAttempts || retry.Err == nil {
			t.Fatalf("unexpected retry event: %+v", retry)
		}
	})

	if err := transport.UploadAsset("http://vibetv.local", "/themes/u/cm.cbi", "cm.cbi", []byte("CBI1\n")); err != nil {
		t.Fatalf("UploadAsset returned error: %v", err)
	}
	if attempts != 2 {
		t.Fatalf("expected retry after timeout, got attempts=%d", attempts)
	}
	if retries != 1 {
		t.Fatalf("expected one retry event, got %d", retries)
	}
}

func TestWiFiTransportUploadAssetExtendsTimeoutForRateLimitedUploads(t *testing.T) {
	var gotDeadline time.Time
	transport := NewWiFiTransportWithClient(&http.Client{
		Timeout: defaultWiFiTimeout,
		Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
			deadline, ok := req.Context().Deadline()
			if !ok {
				t.Fatal("expected upload request context deadline")
			}
			gotDeadline = deadline
			return &http.Response{
				StatusCode: http.StatusOK,
				Body:       io.NopCloser(strings.NewReader("")),
			}, nil
		}),
	})

	if err := transport.UploadAsset("http://vibetv.local", "/themes/u/big.cba", "big.cba", bytes.Repeat([]byte("x"), 20*1024)); err != nil {
		t.Fatalf("UploadAsset returned error: %v", err)
	}
	if remaining := time.Until(gotDeadline); remaining < 25*time.Second {
		t.Fatalf("expected extended upload timeout, remaining=%s", remaining)
	}
}

func TestWiFiTransportUploadAssetDoesNotRetryConnectionReset(t *testing.T) {
	var attempts int
	transport := NewWiFiTransportWithClient(&http.Client{
		Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
			attempts++
			return nil, errors.New("read tcp 192.168.178.172:55149->192.168.178.163:80: read: connection reset by peer")
		}),
	})

	err := transport.UploadAsset("http://vibetv.local", "/themes/u/cm.cbi", "cm.cbi", []byte("CBI1\n"))
	if err == nil || !strings.Contains(err.Error(), "connection reset by peer") {
		t.Fatalf("expected connection reset error, got %v", err)
	}
	if attempts != 1 {
		t.Fatalf("expected no retry after connection reset, got attempts=%d", attempts)
	}
}

func TestWiFiTransportActivateStoredThemePostsPath(t *testing.T) {
	var gotBody string
	var gotToken string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/theme/active" {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		gotToken = r.Header.Get(deviceAuthHeader)
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Fatalf("read request body: %v", err)
		}
		gotBody = string(body)
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	transport := NewWiFiTransportWithClient(server.Client())
	if err := transport.ActivateStoredTheme(server.URL+"?token=pair-token-789", "/themes/u/cm.json"); err != nil {
		t.Fatalf("ActivateStoredTheme returned error: %v", err)
	}
	if gotBody != `{"path":"/themes/u/cm.json"}` {
		t.Fatalf("unexpected body %q", gotBody)
	}
	if gotToken != "pair-token-789" {
		t.Fatalf("unexpected auth token %q", gotToken)
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (fn roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return fn(req)
}
