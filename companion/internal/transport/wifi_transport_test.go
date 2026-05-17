package transport

import (
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
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
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/frame" {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
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
	if err := transport.SendLine(server.URL+"/", line); err != nil {
		t.Fatalf("SendLine returned error: %v", err)
	}
	if gotBody != string(line) {
		t.Fatalf("unexpected body %q", gotBody)
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

func TestWiFiTransportUploadAssetPostsMultipart(t *testing.T) {
	var gotPath string
	var gotFilename string
	var gotBody string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/assets" {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
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

	transport := NewWiFiTransportWithClient(server.Client())
	if err := transport.UploadAsset(server.URL, "/themes/u/cm.cbi", "cm.cbi", []byte("CBI1\n")); err != nil {
		t.Fatalf("UploadAsset returned error: %v", err)
	}
	if gotPath != "/themes/u/cm.cbi" || gotFilename != "cm.cbi" || gotBody != "CBI1\n" {
		t.Fatalf("unexpected upload path=%q filename=%q body=%q", gotPath, gotFilename, gotBody)
	}
}

func TestWiFiTransportActivateStoredThemePostsPath(t *testing.T) {
	var gotBody string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/theme/active" {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Fatalf("read request body: %v", err)
		}
		gotBody = string(body)
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	transport := NewWiFiTransportWithClient(server.Client())
	if err := transport.ActivateStoredTheme(server.URL, "/themes/u/cm.json"); err != nil {
		t.Fatalf("ActivateStoredTheme returned error: %v", err)
	}
	if gotBody != `{"path":"/themes/u/cm.json"}` {
		t.Fatalf("unexpected body %q", gotBody)
	}
}
