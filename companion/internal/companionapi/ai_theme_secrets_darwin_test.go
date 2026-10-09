//go:build darwin

package companionapi

import (
	"fmt"
	"os"
	"testing"
)

func TestKeychainAIThemeSecretsRoundTrip(t *testing.T) {
	store := keychainAIThemeSecrets{service: fmt.Sprintf("%s.test-%d", aiThemeKeychainService, os.Getpid())}
	t.Cleanup(func() { _ = store.Delete("openai") })
	if err := store.Set("openai", "fixture-key_not-a.secret"); err != nil {
		t.Skip("no usable login keychain here")
	}
	if key, err := store.Get("openai"); err != nil || key != "fixture-key_not-a.secret" {
		t.Fatalf("got %q, %v", key, err)
	}
	if err := store.Set("openai", "fixture-key-replaced"); err != nil {
		t.Fatal(err)
	}
	if key, _ := store.Get("openai"); key != "fixture-key-replaced" {
		t.Fatalf("replacement not stored: %q", key)
	}
	if store.Set("openai", "has a space") == nil {
		t.Fatal("a key the tool would split was accepted")
	}
	if err := store.Delete("openai"); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Get("openai"); err == nil {
		t.Fatal("deleted key still readable")
	}
}
