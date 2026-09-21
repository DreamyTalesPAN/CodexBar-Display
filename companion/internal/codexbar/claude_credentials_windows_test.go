package codexbar

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"testing"
)

func TestDPAPIRoundTrip(t *testing.T) {
	plain := []byte(`{"claude_allow_reading_claude_code_credentials":false}`)
	protected, err := dpapiProtect(plain)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(protected, []byte("claude_allow")) {
		t.Fatal("payload must be opaque")
	}
	back, err := dpapiUnprotect(protected)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(back, plain) {
		t.Fatalf("round trip mismatch: %s", back)
	}
}

func TestWindowsUsageDisplayRoundTripWithDPAPI(t *testing.T) {
	t.Setenv("APPDATA", t.TempDir())
	t.Setenv("CODEXBAR_DISPLAY_USAGE_MODE", "")
	config, err := ensureWindowsConfigDir()
	if err != nil {
		t.Fatal(err)
	}
	if !UsageBarsShowUsed() {
		t.Fatal("upstream default is used")
	}
	for _, secured := range []bool{false, true} {
		data := []byte(`{"show_as_used":true,"enabled_providers":["codex"]}`)
		if secured {
			protected, err := dpapiProtect(data)
			if err != nil {
				t.Fatal(err)
			}
			data, _ = json.Marshal(map[string]any{"format": "codexbar.secure-file", "version": 1, "payload": protected})
		}
		if err := os.WriteFile(config, data, 0600); err != nil {
			t.Fatal(err)
		}
		for _, value := range []bool{false, true} {
			if err := SetUsageBarsShowUsed(context.Background(), value); err != nil {
				t.Fatal(err)
			}
			if UsageBarsShowUsed() != value {
				t.Fatal("readback differs")
			}
		}
	}
}
