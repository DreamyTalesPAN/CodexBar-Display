//go:build darwin

package companionapi

import (
	"bytes"
	"errors"
	"os/exec"
	"strings"
)

const aiThemeKeychainService = "shop.vibetv.control-center.ai-theme"

// The verified OpenAI key in the login keychain. It goes through the system's
// security tool so that a rebuilt or re-signed app can still read the item it
// stored; the key is passed on standard input, never as an argument.
type keychainAIThemeSecrets struct{ service string }

// NewDurableAIThemeSecrets keeps the key across restarts of the Mac App.
func NewDurableAIThemeSecrets(string) SecretStore {
	return keychainAIThemeSecrets{service: aiThemeKeychainService}
}

func (k keychainAIThemeSecrets) Get(provider string) (string, error) {
	out, err := exec.Command("/usr/bin/security", "find-generic-password", "-s", k.service, "-a", provider, "-w").Output()
	key := strings.TrimSpace(string(out))
	if err != nil || key == "" {
		return "", ErrSecretNotFound
	}
	return key, nil
}

func (k keychainAIThemeSecrets) Set(provider, key string) error {
	// The interactive mode splits its input like a shell would.
	if strings.ContainsAny(key, " \t\r\n'\"\\") {
		return errors.New("credential cannot be stored")
	}
	cmd := exec.Command("/usr/bin/security", "-i")
	cmd.Stdin = strings.NewReader("add-generic-password -U -s " + k.service + " -a " + provider + " -w " + key + "\n")
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil || stderr.Len() > 0 {
		return errors.New("credential cannot be stored")
	}
	return nil
}

func (k keychainAIThemeSecrets) Delete(provider string) error {
	if exec.Command("/usr/bin/security", "delete-generic-password", "-s", k.service, "-a", provider).Run() != nil {
		return ErrSecretNotFound
	}
	return nil
}
