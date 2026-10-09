package codexbar

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

// The Mac on 2026-10-09: Claude pinned to an expired saved cookie, so a fresh
// browser sign-in changed nothing. Switching it back to the browser must leave
// everything else in the file as it was.
func TestUseBrowserCookiesHandsAPinnedProviderBackToTheBrowser(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Win-CodexBar keeps saved cookies in a file of its own")
	}
	t.Setenv("CODEXBAR_CONFIG", "")
	home := t.TempDir()
	path := filepath.Join(home, ".codexbar", "config.json")
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	original := `{
  "version": 1,
  "providers": [
    {"id": "codex", "enabled": true, "source": "auto"},
    {"id": "claude", "enabled": true, "cookieSource": "manual", "cookieHeader": "sessionKey=old"},
    {"id": "cursor", "enabled": true, "cookieSource": "manual", "cookieHeader": "WorkosCursorSessionToken=x"}
  ],
  "refreshSeconds": 300000000000
}`
	if err := os.WriteFile(path, []byte(original), 0o600); err != nil {
		t.Fatal(err)
	}

	changed, err := UseBrowserCookies(home, "claude")
	if err != nil || !changed {
		t.Fatalf("changed=%v err=%v", changed, err)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var config struct {
		Version        int              `json:"version"`
		RefreshSeconds json.Number      `json:"refreshSeconds"`
		Providers      []map[string]any `json:"providers"`
	}
	if err := json.Unmarshal(raw, &config); err != nil {
		t.Fatalf("config is no longer JSON: %v\n%s", err, raw)
	}
	if config.Version != 1 || config.RefreshSeconds != "300000000000" || len(config.Providers) != 3 {
		t.Fatalf("the rest of the config changed:\n%s", raw)
	}
	claude, cursor := config.Providers[1], config.Providers[2]
	if claude["cookieSource"] != "auto" || claude["cookieHeader"] != "sessionKey=old" {
		t.Fatalf("claude must read the browser and keep its saved cookie: %v", claude)
	}
	if cursor["cookieSource"] != "manual" {
		t.Fatalf("only the provider asked for changes: %v", cursor)
	}
	if info, err := os.Stat(path); err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("the config must stay private: %v %v", info.Mode(), err)
	}

	if changed, err := UseBrowserCookies(home, "claude"); err != nil || changed {
		t.Fatalf("a provider already on the browser is left alone: changed=%v err=%v", changed, err)
	}
}

func TestUseBrowserCookiesLeavesAMissingConfigAlone(t *testing.T) {
	t.Setenv("CODEXBAR_CONFIG", "")
	home := t.TempDir()
	if changed, err := UseBrowserCookies(home, "claude"); err != nil || changed {
		t.Fatalf("changed=%v err=%v", changed, err)
	}
	if _, err := os.Stat(filepath.Join(home, ".codexbar")); !os.IsNotExist(err) {
		t.Fatalf("no config may be created: %v", err)
	}
}
