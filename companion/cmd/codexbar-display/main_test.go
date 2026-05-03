package main

import "testing"

func TestParseDaemonOptionsWiFiTarget(t *testing.T) {
	opts, err := parseDaemonOptions([]string{
		"--transport", "wifi",
		"--target", "http://192.168.178.123",
		"--once",
	})
	if err != nil {
		t.Fatalf("parseDaemonOptions returned error: %v", err)
	}
	if opts.Transport != "wifi" {
		t.Fatalf("expected wifi transport, got %q", opts.Transport)
	}
	if opts.Target != "http://192.168.178.123" {
		t.Fatalf("unexpected target %q", opts.Target)
	}
	if !opts.Once {
		t.Fatalf("expected once option")
	}
}

func TestParseDaemonOptionsDefaultsToWiFi(t *testing.T) {
	opts, err := parseDaemonOptions(nil)
	if err != nil {
		t.Fatalf("parseDaemonOptions returned error: %v", err)
	}
	if opts.Transport != "wifi" {
		t.Fatalf("expected wifi transport default, got %q", opts.Transport)
	}
	if opts.Target != "http://vibetv.local" {
		t.Fatalf("expected default WiFi target, got %q", opts.Target)
	}
}
