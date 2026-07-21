package companionapi

import (
	"errors"

	keyring "github.com/zalando/go-keyring"
)

const aiThemeKeyringService = "shop.vibetv.control-center.ai-theme"

var ErrSecretNotFound = errors.New("secret not found")

// SecretStore keeps provider credentials outside browser and theme data. The
// interface is intentionally platform-neutral; go-keyring uses Keychain on
// macOS and Credential Manager on Windows.
type SecretStore interface {
	Set(account, secret string) error
	Get(account string) (string, error)
	Delete(account string) error
}

type keyringSecretStore struct{}

func (keyringSecretStore) Set(account, secret string) error {
	return keyring.Set(aiThemeKeyringService, account, secret)
}

func (keyringSecretStore) Get(account string) (string, error) {
	secret, err := keyring.Get(aiThemeKeyringService, account)
	if errors.Is(err, keyring.ErrNotFound) {
		return "", ErrSecretNotFound
	}
	return secret, err
}

func (keyringSecretStore) Delete(account string) error {
	err := keyring.Delete(aiThemeKeyringService, account)
	if errors.Is(err, keyring.ErrNotFound) {
		return ErrSecretNotFound
	}
	return err
}
