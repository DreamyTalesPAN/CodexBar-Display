//go:build windows

package companionapi

import (
	"bytes"
	"os"
	"testing"
)

func TestProtectedFileAIThemeSecretsRoundTrip(t *testing.T) {
	store := protectedFileAIThemeSecrets{dir: t.TempDir()}
	if err := store.Set("openai", "fixture-key_not-a.secret"); err != nil {
		t.Fatal(err)
	}
	sealed, err := os.ReadFile(store.path("openai"))
	if err != nil || bytes.Contains(sealed, []byte("fixture-key")) {
		t.Fatalf("key file missing or readable: %v", err)
	}
	if key, err := store.Get("openai"); err != nil || key != "fixture-key_not-a.secret" {
		t.Fatalf("got %q, %v", key, err)
	}
	if err := store.Delete("openai"); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Get("openai"); err == nil {
		t.Fatal("deleted key still readable")
	}
}
