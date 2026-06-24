package transport

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestDiscoverWiFiDeviceTriesCandidates(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/hello" {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":2,"board":"esp8266-smalltv-st7789","capabilities":{"transport":{"active":"wifi"}}}`))
	}))
	defer server.Close()

	result, err := DiscoverWiFiDevice(context.Background(), WiFiDiscoveryOptions{
		Candidates: []string{server.URL},
		Client:     server.Client(),
		Timeout:    time.Second,
	})
	if err != nil {
		t.Fatalf("DiscoverWiFiDevice returned error: %v", err)
	}
	if result.Target != server.URL || result.Source != "candidate" {
		t.Fatalf("unexpected discovery result: %+v", result)
	}
	if result.Hello.Board != "esp8266-smalltv-st7789" {
		t.Fatalf("unexpected hello: %+v", result.Hello)
	}
}

func TestDiscoverWiFiDeviceRejectsNonVibeHello(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"kind":"hello","protocolVersion":1,"board":"printer"}`))
	}))
	defer server.Close()

	_, err := DiscoverWiFiDevice(context.Background(), WiFiDiscoveryOptions{
		Candidates: []string{server.URL},
		Client:     server.Client(),
		Timeout:    time.Second,
	})
	if err == nil {
		t.Fatal("expected non-VibeTV hello to be rejected")
	}
}

func TestLocalIPv4DiscoveryTargetsFromAddrsScansHostSubnet(t *testing.T) {
	_, ipNet, err := net.ParseCIDR("192.168.178.42/24")
	if err != nil {
		t.Fatal(err)
	}
	ipNet.IP = net.ParseIP("192.168.178.42")
	targets := localIPv4DiscoveryTargetsFromAddrs([]net.Addr{ipNet})

	if !containsString(targets, "http://192.168.178.159") {
		t.Fatalf("expected subnet target in scan list")
	}
	if containsString(targets, "http://192.168.178.42") {
		t.Fatalf("expected own host IP to be skipped")
	}
}
