package main

import "testing"

func TestParsePinnedPortFromLaunchAgentPlist(t *testing.T) {
	t.Run("unpinned", func(t *testing.T) {
		plist := `<plist><dict><key>ProgramArguments</key><array><string>codexbar-display</string></array></dict></plist>`
		if got := parsePinnedPortFromLaunchAgentPlist(plist); got != "" {
			t.Fatalf("expected no pinned port, got %q", got)
		}
	})

	t.Run("pinned", func(t *testing.T) {
		plist := `<plist><dict><array><string>daemon</string><string>--port</string><string>/dev/cu.usbserial-10</string></array></dict></plist>`
		if got := parsePinnedPortFromLaunchAgentPlist(plist); got != "/dev/cu.usbserial-10" {
			t.Fatalf("expected pinned port, got %q", got)
		}
	})

	t.Run("malformed", func(t *testing.T) {
		plist := `<plist><dict><array><string>daemon</string><string>--port</string></array></dict></plist>`
		if got := parsePinnedPortFromLaunchAgentPlist(plist); got != "" {
			t.Fatalf("expected no pinned port for malformed plist, got %q", got)
		}
	})
}

func TestContainsPort(t *testing.T) {
	ports := []string{"/dev/cu.usbmodem101", "/dev/cu.usbserial-10"}
	if !containsPort(ports, "/dev/cu.usbserial-10") {
		t.Fatalf("expected exact port match")
	}
	if containsPort(ports, "/dev/cu.usbserial-11") {
		t.Fatalf("did not expect unknown port to match")
	}
}

func TestFallbackThemeSpecCapabilities(t *testing.T) {
	caps := fallbackThemeSpecCapabilities()
	if !caps.Known {
		t.Fatalf("expected fallback capabilities to be known")
	}
	if !caps.SupportsThemeSpecV1 {
		t.Fatalf("expected fallback profile to support ThemeSpec v1")
	}
	if caps.NegotiatedProtocolVersion != 2 {
		t.Fatalf("expected protocol v2 fallback, got %d", caps.NegotiatedProtocolVersion)
	}
	if caps.MaxThemeSpecBytes <= 0 || caps.MaxThemePrimitives <= 0 {
		t.Fatalf("expected positive fallback limits, got bytes=%d primitives=%d", caps.MaxThemeSpecBytes, caps.MaxThemePrimitives)
	}
}
