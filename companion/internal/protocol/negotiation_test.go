package protocol

import "testing"

func TestNegotiateProtocolVersionPrefersV2WhenAvailable(t *testing.T) {
	got := NegotiateProtocolVersion([]int{1, 2}, 2, 1)
	if got != ProtocolVersionV2 {
		t.Fatalf("expected protocol 2, got %d", got)
	}
}

func TestNegotiateProtocolVersionFallsBackToV1(t *testing.T) {
	got := NegotiateProtocolVersion(nil, 0, 1)
	if got != ProtocolVersionV1 {
		t.Fatalf("expected protocol 1 fallback, got %d", got)
	}
}

func TestNegotiateProtocolVersionIgnoresUnsupportedValues(t *testing.T) {
	got := NegotiateProtocolVersion([]int{4, 7}, 7, 4)
	if got != ProtocolVersionV1 {
		t.Fatalf("expected protocol 1 fallback for unsupported versions, got %d", got)
	}
}
