package codexbar

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
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

func writePinnedConfig(t *testing.T, content string) (string, string) {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("Win-CodexBar keeps saved cookies in a file of its own")
	}
	t.Setenv("CODEXBAR_CONFIG", "")
	home := t.TempDir()
	path := filepath.Join(home, ".codexbar", "config.json")
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	return home, path
}

const twoPinnedProviders = `{"providers": [
  {"id": "codex", "enabled": true},
  {"id": "claude", "enabled": true, "cookieSource": "manual", "cookieHeader": "sessionKey=old"},
  {"id": "cursor", "enabled": true, "cookieSource": "manual", "cookieHeader": "WorkosCursorSessionToken=x"}
]}`

func providersIn(t *testing.T, path string) map[string]map[string]any {
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
	byID := map[string]map[string]any{}
	for _, provider := range config.Providers {
		byID[provider["id"].(string)] = provider
	}
	return byID
}

// A config the sign-in cannot read may still pin the provider, so the sign-in
// must report it instead of answering as if the pin were gone.
func TestUseBrowserCookiesReportsAConfigThatIsNotJSON(t *testing.T) {
	for name, broken := range map[string]string{
		"cut off":          `{"providers": [{"id": "claude", "cookieSource": "manual"`,
		"data after it":    `{"providers": [{"id": "claude", "cookieSource": "manual"}]} {"providers": []}`,
		"garbage after it": `{"providers": [{"id": "claude", "cookieSource": "manual"}]}x`,
	} {
		t.Run(name, func(t *testing.T) {
			home, path := writePinnedConfig(t, broken)
			if changed, err := UseBrowserCookies(home, "claude"); err == nil || changed {
				t.Fatalf("a config that is not one JSON object must be an error: changed=%v err=%v", changed, err)
			}
			if raw, _ := os.ReadFile(path); string(raw) != broken {
				t.Fatalf("the config must stay as it was:\n%s", raw)
			}
		})
	}
}

// CodexBar writes its config without the Companion's lock. A change it makes
// while the sign-in is switching the cookie source must survive.
func TestUseBrowserCookiesKeepsAChangeCodexBarMadeMeanwhile(t *testing.T) {
	home, path := writePinnedConfig(t, twoPinnedProviders)
	writes := 0
	beforeConfigReplace = func() {
		if writes > 0 {
			return
		}
		writes++
		codexOff := strings.Replace(twoPinnedProviders, `"id": "codex", "enabled": true`, `"id": "codex", "enabled": false`, 1)
		if err := os.WriteFile(path, []byte(codexOff), 0o600); err != nil {
			t.Error(err)
		}
	}
	t.Cleanup(func() { beforeConfigReplace = func() {} })

	if changed, err := UseBrowserCookies(home, "claude"); err != nil || !changed {
		t.Fatalf("changed=%v err=%v", changed, err)
	}
	providers := providersIn(t, path)
	if providers["codex"]["enabled"] != false {
		t.Fatalf("CodexBar's own change was lost: %v", providers["codex"])
	}
	if providers["claude"]["cookieSource"] != "auto" {
		t.Fatalf("claude must read the browser: %v", providers["claude"])
	}
}

// Two sign-ins at once must both keep their switch.
func TestUseBrowserCookiesKeepsBothOfTwoSignInsAtOnce(t *testing.T) {
	for round := 0; round < 20; round++ {
		home, path := writePinnedConfig(t, twoPinnedProviders)
		var wg sync.WaitGroup
		for _, id := range []string{"claude", "cursor"} {
			wg.Add(1)
			go func(id string) {
				defer wg.Done()
				if _, err := UseBrowserCookies(home, id); err != nil {
					t.Error(err)
				}
			}(id)
		}
		wg.Wait()
		providers := providersIn(t, path)
		if providers["claude"]["cookieSource"] != "auto" || providers["cursor"]["cookieSource"] != "auto" {
			t.Fatalf("round %d lost a switch: claude=%v cursor=%v", round, providers["claude"], providers["cursor"])
		}
	}
}
