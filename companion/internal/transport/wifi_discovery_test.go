package transport

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestScanWiFiTargetsKeepsSuccessfulResult(t *testing.T) {
	client := &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(strings.NewReader(`{"kind":"hello","deviceId":"expected-device","board":"esp8266-smalltv-st7789","capabilities":{"transport":{"active":"wifi"}}}`)),
			Header:     make(http.Header),
		}, nil
	})}
	targets := make([]string, wifiDiscoveryWorkers)
	for i := range targets {
		targets[i] = "http://vibetv.test"
	}
	for attempt := 0; attempt < 1000; attempt++ {
		result, err := scanWiFiTargets(context.Background(), client, targets, "expected-device")
		if err != nil {
			t.Fatalf("scan %d discarded a successful hello: %v", attempt, err)
		}
		if result.Hello.DeviceID != "expected-device" || result.Source != "network-scan" {
			t.Fatalf("unexpected discovery result: %+v", result)
		}
	}
}

func TestScanWiFiTargetsCancelsRemainingProbesAfterSuccess(t *testing.T) {
	slowStarted := make(chan struct{})
	slowCanceled := make(chan struct{})
	client := &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if req.URL.Host == "slow.test" {
			close(slowStarted)
			<-req.Context().Done()
			close(slowCanceled)
			return nil, req.Context().Err()
		}
		select {
		case <-slowStarted:
		case <-req.Context().Done():
			return nil, req.Context().Err()
		}
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(strings.NewReader(`{"kind":"hello","deviceId":"expected-device","board":"esp8266-smalltv-st7789","capabilities":{"transport":{"active":"wifi"}}}`)),
			Header:     make(http.Header),
		}, nil
	})}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	result, err := scanWiFiTargets(ctx, client, []string{"http://slow.test", "http://found.test"}, "expected-device")
	if err != nil || result.Target != "http://found.test" {
		t.Fatalf("successful probe: result=%+v err=%v", result, err)
	}
	select {
	case <-slowCanceled:
	case <-ctx.Done():
		t.Fatal("successful scan did not cancel the remaining probe")
	}
}

func TestScanWiFiTargetsNoMatch(t *testing.T) {
	client := &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(strings.NewReader(`{"kind":"hello","deviceId":"other-device","board":"esp8266-smalltv-st7789","capabilities":{"transport":{"active":"wifi"}}}`)),
			Header:     make(http.Header),
		}, nil
	})}
	_, err := scanWiFiTargets(context.Background(), client, []string{"http://vibetv.test"}, "expected-device")
	if err == nil || !strings.Contains(err.Error(), "no VibeTV device found") {
		t.Fatalf("expected no matching device, got %v", err)
	}
}

func TestScanWiFiTargetsHonorsCallerCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	client := &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		cancel()
		<-req.Context().Done()
		return nil, req.Context().Err()
	})}
	_, err := scanWiFiTargets(ctx, client, []string{"http://vibetv.test"}, "")
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected caller cancellation, got %v", err)
	}
}

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

func TestDiscoverWiFiDeviceRequiresExpectedDeviceID(t *testing.T) {
	device := func(id string) *httptest.Server {
		return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"kind":"hello","deviceId":"` + id + `","protocolVersion":2,"board":"esp8266-smalltv-st7789","capabilities":{"transport":{"active":"wifi"}}}`))
		}))
	}
	wrong := device("wrong-device")
	defer wrong.Close()
	expected := device("expected-device")
	defer expected.Close()

	result, err := DiscoverWiFiDevice(context.Background(), WiFiDiscoveryOptions{
		Candidates:       []string{wrong.URL, expected.URL},
		Client:           expected.Client(),
		Timeout:          time.Second,
		ExpectedDeviceID: "EXPECTED-device",
	})
	if err != nil {
		t.Fatalf("DiscoverWiFiDevice returned error: %v", err)
	}
	if result.Target != expected.URL || result.Hello.DeviceID != "expected-device" {
		t.Fatalf("discovery accepted the wrong VibeTV identity: %+v", result)
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
