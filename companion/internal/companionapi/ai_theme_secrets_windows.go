//go:build windows

package companionapi

import (
	"os"
	"path/filepath"
	"unsafe"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimepaths"
	"golang.org/x/sys/windows"
)

// The verified OpenAI key in a file that only this Windows user can decrypt
// (Data Protection API). The file never holds the key itself.
type protectedFileAIThemeSecrets struct{ dir string }

// NewDurableAIThemeSecrets keeps the key across restarts of the app.
func NewDurableAIThemeSecrets(home string) SecretStore {
	return protectedFileAIThemeSecrets{dir: runtimepaths.Root(home)}
}

func (p protectedFileAIThemeSecrets) path(provider string) string {
	return filepath.Join(p.dir, "ai-theme-"+provider+".key")
}

func (p protectedFileAIThemeSecrets) Get(provider string) (string, error) {
	sealed, err := os.ReadFile(p.path(provider))
	if err != nil || len(sealed) == 0 || p.dir == "" {
		return "", ErrSecretNotFound
	}
	in := windows.DataBlob{Size: uint32(len(sealed)), Data: &sealed[0]}
	var out windows.DataBlob
	if windows.CryptUnprotectData(&in, nil, nil, 0, nil, windows.CRYPTPROTECT_UI_FORBIDDEN, &out) != nil || out.Size == 0 {
		return "", ErrSecretNotFound
	}
	defer windows.LocalFree(windows.Handle(unsafe.Pointer(out.Data)))
	return string(unsafe.Slice(out.Data, out.Size)), nil
}

func (p protectedFileAIThemeSecrets) Set(provider, key string) error {
	if p.dir == "" || key == "" {
		return ErrSecretNotFound
	}
	plain := []byte(key)
	in := windows.DataBlob{Size: uint32(len(plain)), Data: &plain[0]}
	var out windows.DataBlob
	if err := windows.CryptProtectData(&in, nil, nil, 0, nil, windows.CRYPTPROTECT_UI_FORBIDDEN, &out); err != nil {
		return err
	}
	defer windows.LocalFree(windows.Handle(unsafe.Pointer(out.Data)))
	if err := os.MkdirAll(p.dir, 0o700); err != nil {
		return err
	}
	return os.WriteFile(p.path(provider), unsafe.Slice(out.Data, out.Size), 0o600)
}

func (p protectedFileAIThemeSecrets) Delete(provider string) error {
	err := os.Remove(p.path(provider))
	if os.IsNotExist(err) {
		return ErrSecretNotFound
	}
	return err
}
