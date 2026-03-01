package main

import "testing"

func TestParsePinnedPortFromLaunchAgentPlist(t *testing.T) {
	t.Run("unpinned", func(t *testing.T) {
		plist := `<plist><dict><key>ProgramArguments</key><array><string>vibeblock</string></array></dict></plist>`
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
