package codexbar

import (
	"bytes"
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
