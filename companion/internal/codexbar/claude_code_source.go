package codexbar

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
)

// Claude Code's login before the browser (#834, the Mac side of #650).
//
// The Mac engine is upstream CodexBar. In its CLI and in serve, Claude's Auto
// asks the claude.ai browser session first and Claude Code only after it;
// Claude Code's own login (OAuth) is not in that order at all. A browser
// signed in to a second claude.ai account then shows that account's usage.
// Windows fixed this in its engine (Win-CodexBar #10): while Claude Code is
// signed in, its login answers before the browser. Serve takes a provider's
// source only from the config, so on the Mac the Companion applies the same
// rule there: while Claude Code is signed in and the customer chose no Claude
// source, the source is Claude Code's login. Once Claude Code is signed out,
// the field goes again and Auto (the browser) is back.
//
// The config is shared with the customer's own CodexBar app, so only this one
// field changes, only while nothing the customer chose is in it (no source of
// their own, no saved accounts), and the write is the same locked replace as
// UseBrowserCookies.
const (
	claudeCodeSource          = "oauth"
	claudeCodeKeychainService = "Claude Code-credentials"
	claudeCodeSourceInterval  = time.Minute
)

var (
	// claudeCodeSourceSync is off in this package's tests (TestMain), so no
	// test touches a config through the shared paths; the tests of this file
	// switch it on.
	claudeCodeSourceSync = true

	claudeCodeKeychainHasLoginFn = claudeCodeKeychainHasLogin

	claudeCodeSourceCheck struct {
		mu sync.Mutex
		at time.Time
	}
)

// maybePreferClaudeCode runs preferClaudeCode at most once a minute, the
// refresh interval of serve; serve's health check and every CLI start come
// through here far more often.
func maybePreferClaudeCode(home, path string) {
	if runtime.GOOS == "windows" || !claudeCodeSourceSync {
		return
	}
	claudeCodeSourceCheck.mu.Lock()
	if !claudeCodeSourceCheck.at.IsZero() && time.Since(claudeCodeSourceCheck.at) < claudeCodeSourceInterval {
		claudeCodeSourceCheck.mu.Unlock()
		return
	}
	claudeCodeSourceCheck.at = time.Now()
	claudeCodeSourceCheck.mu.Unlock()
	// Best effort: a config that cannot be read or locked right now keeps
	// what it has, and the next check tries again.
	_, _ = preferClaudeCode(home, path)
}

func preferClaudeCode(home, path string) (bool, error) {
	if strings.TrimSpace(home) == "" {
		var err error
		if home, err = os.UserHomeDir(); err != nil {
			return false, err
		}
	}
	if strings.TrimSpace(path) == "" {
		var err error
		if path, err = macConfigPath(home); err != nil {
			return false, err
		}
	}
	signedIn := claudeCodeSignedIn(home)
	edit := func(provider map[string]any) bool {
		return setClaudeCodeSource(provider, signedIn)
	}
	// Reading first keeps the lock and the rewrite for the rare change.
	if !configProvidersNeedEdit(path, edit) {
		return false, nil
	}
	return editConfigProviders(path, edit)
}

func setClaudeCodeSource(provider map[string]any, signedIn bool) bool {
	if provider["id"] != "claude" || hasSavedAccounts(provider) {
		return false
	}
	raw, has := provider["source"]
	source, isString := raw.(string)
	if has && !isString {
		return false
	}
	switch {
	case signedIn && (source == "" || source == "auto"):
		provider["source"] = claudeCodeSource
		return true
	case !signedIn && source == claudeCodeSource:
		delete(provider, "source")
		return true
	}
	return false
}

func hasSavedAccounts(provider map[string]any) bool {
	accounts, ok := provider["tokenAccounts"].(map[string]any)
	if !ok {
		return false
	}
	list, _ := accounts["accounts"].([]any)
	return len(list) > 0
}

// claudeCodeSignedIn is the Mac's counterpart of Win-CodexBar's "Claude Code
// is signed in": a stored Claude Code login exists. Claude Code keeps it in
// the login keychain, or in .credentials.json where it has no keychain.
func claudeCodeSignedIn(home string) bool {
	dir := strings.TrimSpace(os.Getenv("CLAUDE_CONFIG_DIR"))
	if dir == "" {
		dir = filepath.Join(home, ".claude")
	} else {
		dir = withHome(home, dir)
	}
	if info, err := os.Stat(filepath.Join(dir, ".credentials.json")); err == nil && info.Mode().IsRegular() && info.Size() > 0 {
		return true
	}
	return claudeCodeKeychainHasLoginFn()
}

// claudeCodeKeychainHasLogin asks only whether Claude Code's keychain item
// exists. Without -w or -g, security prints the item's attributes, never the
// secret, and macOS asks the customer nothing.
func claudeCodeKeychainHasLogin() bool {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "/usr/bin/security", "find-generic-password", "-s", claudeCodeKeychainService)
	return cmd.Run() == nil
}

// configProvidersNeedEdit reports whether edit would change any provider of
// the config at path, without writing. A config that cannot be read is left
// to the locked path's own errors.
func configProvidersNeedEdit(path string, edit func(map[string]any) bool) bool {
	raw, err := os.ReadFile(path)
	if err != nil {
		return false
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var config map[string]any
	if decoder.Decode(&config) != nil {
		return false
	}
	providers, _ := config["providers"].([]any)
	for _, item := range providers {
		if provider, ok := item.(map[string]any); ok && edit(provider) {
			return true
		}
	}
	return false
}
