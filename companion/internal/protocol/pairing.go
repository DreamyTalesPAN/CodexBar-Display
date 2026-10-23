package protocol

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
)

// NewPairingToken creates the 128-bit device key on the computer. A nil source
// uses the operating system CSPRNG; callers may inject a reader in tests.
func NewPairingToken(source io.Reader) (string, error) {
	if source == nil {
		source = rand.Reader
	}
	var key [16]byte
	if _, err := io.ReadFull(source, key[:]); err != nil {
		return "", fmt.Errorf("create device pairing key: %w", err)
	}
	return hex.EncodeToString(key[:]), nil
}
