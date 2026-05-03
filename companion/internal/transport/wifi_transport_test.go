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
