//go:build darwin

package companionapi

import (
	"fmt"
	"os"
	"testing"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/testenv"
)

// keychainTestEnv opts into the one test that uses the real login keychain.
// Run it alone and with the real HOME:
// VIBETV_TEST_KEYCHAIN=1 go test -run '^TestKeychainAIThemeSecretsRoundTrip$' ./internal/companionapi
const keychainTestEnv = "VIBETV_TEST_KEYCHAIN"

// By default the package's tests never reach the real login keychain and use a
// temporary home (#932). A temporary home alone is not enough: the keychain
// tool then misses the login keychain and macOS asks the user to reset it.
func TestMain(m *testing.M) {
	if os.Getenv(keychainTestEnv) == "1" {
		os.Exit(m.Run())
	}
	securityTool = ""
	os.Exit(testenv.Main(m))
}

func TestPackageTestsCannotReachKeychain(t *testing.T) {
	if os.Getenv(keychainTestEnv) == "1" {
		t.Skip("keychain opted in")
	}
	if securityTool != "" {
		t.Fatalf("package tests would run %q against the real login keychain", securityTool)
	}
	if _, err := NewDurableAIThemeSecrets("").Get("openai"); err != ErrSecretNotFound {
		t.Fatalf("Get = %v, want ErrSecretNotFound without a keychain", err)
	}
}

func TestKeychainAIThemeSecretsRoundTrip(t *testing.T) {
	if os.Getenv(keychainTestEnv) != "1" {
		t.Skip("uses the real login keychain; set " + keychainTestEnv + "=1 to run it")
	}
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
