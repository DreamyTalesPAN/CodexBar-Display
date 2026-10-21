package protocol

import (
	"bytes"
	"encoding/hex"
	"strings"
	"testing"
)

func TestNewPairingTokenUsesExactly16SourceBytes(t *testing.T) {
	source := bytes.NewReader([]byte("0123456789abcdefunused"))
	token, err := NewPairingToken(source)
	if err != nil {
		t.Fatal(err)
	}
	if token != hex.EncodeToString([]byte("0123456789abcdef")) || source.Len() != len("unused") {
		t.Fatal("pairing key did not use exactly 16 source bytes")
	}
}

func TestNewPairingTokenRejectsShortEntropy(t *testing.T) {
	token, err := NewPairingToken(strings.NewReader("short"))
	if err == nil || token != "" {
		t.Fatalf("got %q, %v", token, err)
	}
}

func TestNewPairingTokenDefaultsToFreshRandomBytes(t *testing.T) {
	first, err := NewPairingToken(nil)
	if err != nil {
		t.Fatal(err)
	}
	second, err := NewPairingToken(nil)
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := hex.DecodeString(first)
	if err != nil || len(decoded) != 16 || len(second) != 32 || first == second {
		t.Fatal("default source did not produce fresh 128-bit keys")
	}
}
