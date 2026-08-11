package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// A device with the A-MSDU black hole answers small requests and never
// responds to larger bodies. The probe must call that out and fail; a device
// that answers everything must pass. Any HTTP status counts as delivery —
// the real endpoint rejects the probe body with 400/401.

func newFakeVibeTV(t *testing.T, dropBodiesAbove int) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/health" {
			w.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(w, `{"ok":true,"firmware":"1.0.39"}`)
			return
		}
		body, _ := io.ReadAll(r.Body)
		if dropBodiesAbove > 0 && len(body) > dropBodiesAbove {
			// Simulate the black hole: the request never completes.
			<-r.Context().Done()
			return
		}
		w.WriteHeader(http.StatusBadRequest)
		_, _ = io.WriteString(w, `{"error":"invalid theme"}`)
	}))
}

func withFastNetProbeTimeout(t *testing.T) {
	t.Helper()
	prev := netProbeStepTimeout
	netProbeStepTimeout = 200 * time.Millisecond
	t.Cleanup(func() { netProbeStepTimeout = prev })
}

func TestNetProbeDetectsLargeBodyBlackhole(t *testing.T) {
	withFastNetProbeTimeout(t)
	device := newFakeVibeTV(t, 512)
	defer device.Close()

	err := runNetProbe([]string{"--target", device.URL})
	if err == nil || !strings.Contains(err.Error(), "black hole") {
		t.Fatalf("expected black-hole verdict, got %v", err)
	}
}

func TestNetProbePassesOnHealthyDevice(t *testing.T) {
	withFastNetProbeTimeout(t)
	device := newFakeVibeTV(t, 0)
	defer device.Close()

	if err := runNetProbe([]string{"--target", device.URL}); err != nil {
		t.Fatalf("expected clean verdict, got %v", err)
	}
}

func TestNetProbeReportsUnreachableDeviceAsInconclusive(t *testing.T) {
	withFastNetProbeTimeout(t)
	device := newFakeVibeTV(t, 0)
	device.Close()

	err := runNetProbe([]string{"--target", device.URL})
	if err == nil || strings.Contains(err.Error(), "black hole") {
		t.Fatalf("an unreachable device must not produce a black-hole verdict, got %v", err)
	}
}
