//go:build !darwin && !windows

package companionapi

// NewDurableAIThemeSecrets has no protected store on this platform: the key
// stays in memory.
func NewDurableAIThemeSecrets(string) SecretStore { return nil }
