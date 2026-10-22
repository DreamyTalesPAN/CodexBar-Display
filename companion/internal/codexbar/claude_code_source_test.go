package codexbar

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

// #834 (Mac side of #650): with a browser signed in to a second claude.ai
// account, the Mac engine's Auto showed that account instead of Claude Code's.
// While Claude Code is signed in and the customer chose no Claude source, the
// Companion points Claude at Claude Code's login; after a sign-out the field
// goes again, and a source or accounts the customer chose stay untouched.
func TestEnsureConfigPrefersClaudeCodeWhileSignedIn(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Win-CodexBar orders Claude's sources itself (Win-CodexBar #10)")
	}
	t.Setenv("CODEXBAR_CONFIG", "")
	t.Setenv("XDG_CONFIG_HOME", "")
	t.Setenv("CLAUDE_CONFIG_DIR", "")
	keychain := false
	stubClaudeCodeKeychain(t, func() bool { return keychain })

	home := t.TempDir()
	path := filepath.Join(home, ".codexbar", "config.json")
	writeTestConfig(t, path, `{
  "version": 1,
  "providers": [
    {"id": "codex", "enabled": true, "source": "auto"},
    {"id": "claude", "enabled": true, "cookieSource": "auto"}
  ]
}`)
	ensure := func() map[string]any {
		t.Helper()
		resetClaudeCodeSourceCheck(t)
		if _, err := EnsureConfig(home); err != nil {
			t.Fatal(err)
		}
		return testProvider(t, path, "claude")
	}

	if got := ensure(); got["source"] != nil {
		t.Fatalf("no Claude Code login: source = %v, want none", got["source"])
	}

	// Signed in through the keychain item (how Claude Code keeps it on a Mac).
	keychain = true
	if got := ensure(); got["source"] != "oauth" {
		t.Fatalf("Claude Code signed in: source = %v, want oauth", got["source"])
	}
	if got := testProvider(t, path, "codex"); got["source"] != "auto" {
		t.Fatalf("other provider changed: %v", got)
	}

	// Signed out: the field goes again, the rest stays.
	keychain = false
	got := ensure()
	if _, has := got["source"]; has {
		t.Fatalf("signed out: source = %v, want the field removed", got["source"])
	}
	if got["cookieSource"] != "auto" || got["enabled"] != true {
		t.Fatalf("other Claude fields changed: %v", got)
	}

	// Signed in through the credentials file counts the same.
	credentials := filepath.Join(home, ".claude", ".credentials.json")
	if err := os.MkdirAll(filepath.Dir(credentials), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(credentials, []byte("{}"), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := ensure(); got["source"] != "oauth" {
		t.Fatalf("credentials file: source = %v, want oauth", got["source"])
	}
}

func TestEnsureConfigLeavesTheCustomersClaudeChoice(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Win-CodexBar orders Claude's sources itself (Win-CodexBar #10)")
	}
	t.Setenv("CODEXBAR_CONFIG", "")
	t.Setenv("XDG_CONFIG_HOME", "")
	t.Setenv("CLAUDE_CONFIG_DIR", "")
	for name, claude := range map[string]string{
		"own source":   `{"id": "claude", "enabled": true, "source": "web"}`,
		"own accounts": `{"id": "claude", "enabled": true, "tokenAccounts": {"activeIndex": 0, "accounts": [{"label": "A", "token": "sessionKey=a"}]}}`,
	} {
		t.Run(name, func(t *testing.T) {
			stubClaudeCodeKeychain(t, func() bool { return true })
			home := t.TempDir()
			path := filepath.Join(home, ".codexbar", "config.json")
			original := `{"version": 1, "providers": [` + claude + `]}`
			writeTestConfig(t, path, original)
			resetClaudeCodeSourceCheck(t)
			if _, err := EnsureConfig(home); err != nil {
				t.Fatal(err)
			}
			raw, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			if string(raw) != original {
				t.Fatalf("customer's choice rewritten:\n%s", raw)
			}
		})
	}
}

func writeTestConfig(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
}

func testProvider(t *testing.T, path, id string) map[string]any {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var config struct {
		Providers []map[string]any `json:"providers"`
	}
	if err := json.Unmarshal(raw, &config); err != nil {
		t.Fatalf("config is no longer JSON: %v\n%s", err, raw)
	}
	for _, provider := range config.Providers {
		if provider["id"] == id {
			return provider
		}
	}
	t.Fatalf("provider %s missing:\n%s", id, raw)
	return nil
}

func stubClaudeCodeKeychain(t *testing.T, fn func() bool) {
	t.Helper()
	previous := claudeCodeKeychainHasLoginFn
	claudeCodeKeychainHasLoginFn = fn
	t.Cleanup(func() { claudeCodeKeychainHasLoginFn = previous })
}

func resetClaudeCodeSourceCheck(t *testing.T) {
	t.Helper()
	claudeCodeSourceSync = true
	t.Cleanup(func() { claudeCodeSourceSync = false })
	claudeCodeSourceCheck.mu.Lock()
	claudeCodeSourceCheck.at = time.Time{}
	claudeCodeSourceCheck.mu.Unlock()
}
