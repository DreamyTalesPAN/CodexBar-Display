package companionapi

import (
	"fmt"
	"os"
	"runtime"
	"testing"
	"time"
)

func TestAIThemeKeychainSmoke(t *testing.T) {
	if runtime.GOOS != "darwin" || os.Getenv("VIBETV_KEYCHAIN_SMOKE") != "1" {
		t.Skip("set VIBETV_KEYCHAIN_SMOKE=1 on macOS to exercise Keychain")
	}
	store := keyringSecretStore{}
	account := fmt.Sprintf("codex-smoke-%d", time.Now().UnixNano())
	secret := "temporary-non-customer-smoke-value"
	if err := store.Set(account, secret); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Delete(account) })
	got, err := store.Get(account)
	if err != nil {
		t.Fatal(err)
	}
	if got != secret {
		t.Fatal("Keychain returned a different value")
	}
	if err := store.Delete(account); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Get(account); err != ErrSecretNotFound {
		t.Fatalf("deleted credential still available: %v", err)
	}
}
