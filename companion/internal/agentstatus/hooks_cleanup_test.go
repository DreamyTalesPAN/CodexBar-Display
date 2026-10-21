package agentstatus

import (
	"bytes"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"unicode/utf16"
)

// Commands exactly as integrations/clawd/src/integrations.cjs entryFor writes
// them for Claude Code (#851 guarded form).
const (
	realMacCommand        = "[ -x '/Applications/VibeTV Control Center.app/Contents/Helpers/agent-engine/node' ] && [ -f '/Applications/VibeTV Control Center.app/Contents/Helpers/agent-engine/src/vibetv-observe.cjs' ] || exit 0; '/Applications/VibeTV Control Center.app/Contents/Helpers/agent-engine/node' '/Applications/VibeTV Control Center.app/Contents/Helpers/agent-engine/src/vibetv-observe.cjs' '/Users/a/Library/Application Support/codexbar-display/agent-engine' 'claude-code' 'SessionStart'"
	realMacApostrophe     = "[ -x '/Users/o'\\''neil/Apps/VibeTV.app/Contents/Helpers/agent-engine/node' ] && [ -f '/Users/o'\\''neil/Apps/VibeTV.app/Contents/Helpers/agent-engine/src/vibetv-observe.cjs' ] || exit 0; '/Users/o'\\''neil/Apps/VibeTV.app/Contents/Helpers/agent-engine/node' '/Users/o'\\''neil/Apps/VibeTV.app/Contents/Helpers/agent-engine/src/vibetv-observe.cjs' '/Users/o'\\''neil/rt' 'claude-code' 'Stop'"
	realWindowsPowerShell = "C:\\Windows/System32/WindowsPowerShell/v1.0/powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand aQBmACAAKAAoAFQAZQBzAHQALQBQAGEAdABoACAALQBMAGkAdABlAHIAYQBsAFAAYQB0AGgAIAAnAEMAOgBcAFUAcwBlAHIAcwBcAEEAIABCAFwAQQBwAHAARABhAHQAYQBcAEwAbwBjAGEAbABcAFYAaQBiAGUAVABWACAAQwBvAG4AdAByAG8AbAAgAEMAZQBuAHQAZQByAFwAYQBnAGUAbgB0AC0AZQBuAGcAaQBuAGUALwBuAG8AZABlAC4AZQB4AGUAJwAgAC0AUABhAHQAaABUAHkAcABlACAATABlAGEAZgApACAALQBhAG4AZAAgACgAVABlAHMAdAAtAFAAYQB0AGgAIAAtAEwAaQB0AGUAcgBhAGwAUABhAHQAaAAgACcAQwA6AFwAVQBzAGUAcgBzAFwAQQAgAEIAXABBAHAAcABEAGEAdABhAFwATABvAGMAYQBsAFwAVgBpAGIAZQBUAFYAIABDAG8AbgB0AHIAbwBsACAAQwBlAG4AdABlAHIAXABhAGcAZQBuAHQALQBlAG4AZwBpAG4AZQAvAHMAcgBjAC8AdgBpAGIAZQB0AHYALQBvAGIAcwBlAHIAdgBlAC4AYwBqAHMAJwAgAC0AUABhAHQAaABUAHkAcABlACAATABlAGEAZgApACkAIAB7ACAAJgAgACcAQwA6AFwAVQBzAGUAcgBzAFwAQQAgAEIAXABBAHAAcABEAGEAdABhAFwATABvAGMAYQBsAFwAVgBpAGIAZQBUAFYAIABDAG8AbgB0AHIAbwBsACAAQwBlAG4AdABlAHIAXABhAGcAZQBuAHQALQBlAG4AZwBpAG4AZQAvAG4AbwBkAGUALgBlAHgAZQAnACAAJwBDADoAXABVAHMAZQByAHMAXABBACAAQgBcAEEAcABwAEQAYQB0AGEAXABMAG8AYwBhAGwAXABWAGkAYgBlAFQAVgAgAEMAbwBuAHQAcgBvAGwAIABDAGUAbgB0AGUAcgBcAGEAZwBlAG4AdAAtAGUAbgBnAGkAbgBlAC8AcwByAGMALwB2AGkAYgBlAHQAdgAtAG8AYgBzAGUAcgB2AGUALgBjAGoAcwAnACAAJwBDADoAXABVAHMAZQByAHMAXABBACAAQgBcAEEAcABwAEQAYQB0AGEAXABSAG8AYQBtAGkAbgBnAFwAYwBvAGQAZQB4AGIAYQByAC0AZABpAHMAcABsAGEAeQBcAGEAZwBlAG4AdAAtAGUAbgBnAGkAbgBlACcAIAAnAGMAbABhAHUAZABlAC0AYwBvAGQAZQAnACAAJwBTAGUAcwBzAGkAbwBuAFMAdABhAHIAdAAnACAAfQA="
	// Written by test builds before the guard: what broke Paul's sessions.
	unguardedMacCommand = "'/Applications/VibeTV Control Center.app/Contents/Helpers/agent-engine/node' '/Applications/VibeTV Control Center.app/Contents/Helpers/agent-engine/src/vibetv-observe.cjs' '/Users/a/rt' 'claude-code' 'UserPromptSubmit'"
)

func posixWord(value string) string {
	return "'" + strings.ReplaceAll(value, "'", `'''`) + "'"
}

// hookCommand builds the guarded POSIX command for an engine directory.
func hookCommand(directory, event string) string {
	node, observer := posixWord(filepath.Join(directory, "node")), posixWord(filepath.Join(directory, "src", "vibetv-observe.cjs"))
	return "[ -x " + node + " ] && [ -f " + observer + " ] || exit 0; " + node + " " + observer + " '/rt' 'claude-code' " + posixWord(event)
}

func encodePowerShell(script string) string {
	units := utf16.Encode([]rune(script))
	data := make([]byte, 2*len(units))
	for i, unit := range units {
		binary.LittleEndian.PutUint16(data[2*i:], unit)
	}
	return "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand " + base64.StdEncoding.EncodeToString(data)
}

func installedEngine(t *testing.T, directory string) string {
	t.Helper()
	engine := filepath.Join(directory, "agent-engine")
	if err := os.MkdirAll(filepath.Join(engine, "src"), 0o755); err != nil {
		t.Fatal(err)
	}
	for _, file := range []string{"node", "node.exe", filepath.Join("src", "vibetv-observe.cjs")} {
		if err := os.WriteFile(filepath.Join(engine, file), nil, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	return engine
}

func hook(command string) map[string]any {
	return map[string]any{"type": "command", "command": command, "timeout": 5}
}

func writeSettings(t *testing.T, path string, value any) []byte {
	t.Helper()
	// Like Claude Code: literal &, < and > in commands.
	var buffer bytes.Buffer
	encoder := json.NewEncoder(&buffer)
	encoder.SetEscapeHTML(false)
	encoder.SetIndent("", "    ")
	if err := encoder.Encode(value); err != nil {
		t.Fatal(err)
	}
	data := buffer.Bytes()
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatal(err)
	}
	return data
}

func TestObserverPathReadsRealHookCommands(t *testing.T) {
	cases := map[string]string{
		realMacCommand:        "/Applications/VibeTV Control Center.app/Contents/Helpers/agent-engine/src/vibetv-observe.cjs",
		realMacApostrophe:     "/Users/o'neil/Apps/VibeTV.app/Contents/Helpers/agent-engine/src/vibetv-observe.cjs",
		realWindowsPowerShell: "C:\\Users\\A B\\AppData\\Local\\VibeTV Control Center\\agent-engine/src/vibetv-observe.cjs",
		unguardedMacCommand:   "/Applications/VibeTV Control Center.app/Contents/Helpers/agent-engine/src/vibetv-observe.cjs",
		encodePowerShell("& 'C:\\Program Files\\It''s VibeTV\\agent-engine\\node.exe' 'C:\\Program Files\\It''s VibeTV\\agent-engine\\src\\vibetv-observe.cjs' 'C:\\rt' 'claude-code' 'Stop'"): "C:\\Program Files\\It's VibeTV\\agent-engine\\src\\vibetv-observe.cjs",
		"'C:/Program Files/VibeTV/agent-engine/node.exe' 'C:/Program Files/VibeTV/agent-engine/src/vibetv-observe.cjs' 'C:/rt' 'qoder' 'Stop'":                                                 "C:/Program Files/VibeTV/agent-engine/src/vibetv-observe.cjs",
		// Customer hooks, including other tools and a developer's own observer
		// checkout, are never ours.
		"my-hook && echo '<ok>'": "",
		"node '/repo/integrations/clawd/src/vibetv-observe.cjs' 'claude-code'": "",
		"'/opt/agent-engine/node' '/opt/agent-engine/src/other.cjs'":           "",
		encodePowerShell("Write-Output 'agent-engine'"):                        "",
	}
	for command, want := range cases {
		if got := observerPath(command); got != want {
			t.Errorf("observerPath(%q) = %q, want %q", command, got, want)
		}
	}
}

func TestRemoveObsoleteHooksRemovesOnlyVibeTVHooksWhoseObserverIsGone(t *testing.T) {
	dir := t.TempDir()
	live := installedEngine(t, filepath.Join(dir, "other VibeTV copy"))
	gone := filepath.Join(dir, "replaced app", "agent-engine")
	foreign := "my-hook && echo '<ok>'"
	settingsPath := filepath.Join(dir, "settings.json")
	// A struct keeps this non-alphabetical key order in the file.
	type settings struct {
		Permissions any `json:"permissions"`
		Hooks       any `json:"hooks"`
		StatusLine  any `json:"statusLine"`
	}
	original := writeSettings(t, settingsPath, settings{
		Permissions: map[string]any{"allow": []string{"Read"}},
		Hooks: map[string]any{
			"SessionStart": []any{
				map[string]any{"matcher": "", "hooks": []any{hook(hookCommand(gone, "SessionStart")), hook(foreign)}},
				map[string]any{"matcher": "", "hooks": []any{hook(hookCommand(live, "SessionStart"))}},
			},
			"Stop":             []any{map[string]any{"matcher": "", "hooks": []any{hook(realMacApostrophe)}}},
			"UserPromptSubmit": []any{map[string]any{"hooks": []any{hook(unguardedMacCommand)}}},
			"Notification":     []any{map[string]any{"matcher": "", "hooks": []any{map[string]any{"type": "command", "command": realWindowsPowerShell, "shell": "powershell"}}}},
			"PreToolUse":       []any{map[string]any{"matcher": "Bash", "hooks": []any{hook("guard.sh"), map[string]any{"type": "http", "url": "http://localhost/x"}}}},
		},
		StatusLine: map[string]any{"command": "my-status"},
	})

	changed, err := RemoveObsoleteHooks(settingsPath, "")
	if err != nil || !changed {
		t.Fatalf("RemoveObsoleteHooks = %v, %v", changed, err)
	}
	data, _ := os.ReadFile(settingsPath)
	if !bytes.Contains(data, []byte(foreign)) {
		t.Fatalf("customer hook text changed:\n%s", data)
	}
	var got map[string]any
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatal(err)
	}
	want := map[string]any{
		"permissions": map[string]any{"allow": []any{"Read"}},
		"hooks": map[string]any{
			"SessionStart": []any{
				map[string]any{"matcher": "", "hooks": []any{map[string]any{"type": "command", "command": foreign, "timeout": float64(5)}}},
				map[string]any{"matcher": "", "hooks": []any{map[string]any{"type": "command", "command": hookCommand(live, "SessionStart"), "timeout": float64(5)}}},
			},
			"PreToolUse": []any{map[string]any{"matcher": "Bash", "hooks": []any{map[string]any{"type": "command", "command": "guard.sh", "timeout": float64(5)}, map[string]any{"type": "http", "url": "http://localhost/x"}}}},
		},
		"statusLine": map[string]any{"command": "my-status"},
	}
	gotJSON, _ := json.Marshal(got)
	wantJSON, _ := json.Marshal(want)
	if !bytes.Equal(gotJSON, wantJSON) {
		t.Fatalf("settings after cleanup:\n%s\nwant:\n%s", gotJSON, wantJSON)
	}
	if order := []string{`"permissions"`, `"hooks"`, `"statusLine"`}; !(bytes.Index(data, []byte(order[0])) < bytes.Index(data, []byte(order[1])) && bytes.Index(data, []byte(order[1])) < bytes.Index(data, []byte(order[2]))) {
		t.Fatalf("key order changed:\n%s", data)
	}
	if backup, _ := os.ReadFile(settingsPath + ".vibetv-backup"); !bytes.Equal(backup, original) {
		t.Fatal("backup does not hold the original settings")
	}
	if info, _ := os.Stat(settingsPath); runtime.GOOS != "windows" && info.Mode().Perm() != 0o600 {
		t.Fatalf("mode = %v, want 0600", info.Mode().Perm())
	}
	if changed, err := RemoveObsoleteHooks(settingsPath, ""); changed || err != nil {
		t.Fatalf("second run = %v, %v; want no change", changed, err)
	}
}

func TestRemoveObsoleteHooksOnUninstallRemovesThisInstallationOnly(t *testing.T) {
	dir := t.TempDir()
	uninstalling := installedEngine(t, filepath.Join(dir, "VibeTV Control Center"))
	other := installedEngine(t, filepath.Join(dir, "second copy"))
	settingsPath := filepath.Join(dir, "settings.json")
	writeSettings(t, settingsPath, map[string]any{"hooks": map[string]any{
		"Stop": []any{map[string]any{"hooks": []any{hook(hookCommand(uninstalling, "Stop"))}}},
		"SessionEnd": []any{
			map[string]any{"hooks": []any{hook(hookCommand(other, "SessionEnd"))}},
			map[string]any{"hooks": []any{hook(encodePowerShell("& " + posixWord(filepath.Join(uninstalling, "node.exe")) + " " + posixWord(filepath.Join(uninstalling, "src", "vibetv-observe.cjs"))))}},
		},
	}})
	if changed, err := RemoveObsoleteHooks(settingsPath, uninstalling); err != nil || !changed {
		t.Fatalf("RemoveObsoleteHooks = %v, %v", changed, err)
	}
	var got struct {
		Hooks map[string][]struct {
			Hooks []struct{ Command string } `json:"hooks"`
		} `json:"hooks"`
	}
	data, _ := os.ReadFile(settingsPath)
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatal(err)
	}
	if len(got.Hooks) != 1 || len(got.Hooks["SessionEnd"]) != 1 || got.Hooks["SessionEnd"][0].Hooks[0].Command != hookCommand(other, "SessionEnd") {
		t.Fatalf("expected only the second copy's hook to remain:\n%s", data)
	}
}

func TestRemoveObsoleteHooksLeavesOtherFilesUntouched(t *testing.T) {
	dir := t.TempDir()
	if changed, err := RemoveObsoleteHooks(filepath.Join(dir, "missing.json"), ""); changed || err != nil {
		t.Fatalf("missing file = %v, %v", changed, err)
	}
	for name, content := range map[string]string{
		"foreign.json": "{\n    \"hooks\": {\"Stop\": [{\"hooks\": [{\"type\": \"command\", \"command\": \"my-hook\"}]}]},\n    \"env\": {\"A\": \"1\"}\n}\n",
		"empty.json":   "{\"hooks\": {}}",
		"invalid.json": "{\"hooks\": ",
	} {
		path := filepath.Join(dir, name)
		if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
		changed, err := RemoveObsoleteHooks(path, "")
		if changed || (err != nil) != (name == "invalid.json") {
			t.Errorf("%s: changed=%v err=%v", name, changed, err)
		}
		if data, _ := os.ReadFile(path); string(data) != content {
			t.Errorf("%s was rewritten", name)
		}
		if _, err := os.Stat(path + ".vibetv-backup"); err == nil {
			t.Errorf("%s got a backup without a change", name)
		}
	}
}

func TestRemoveObsoleteHooksDropsHooksKeyItEmptied(t *testing.T) {
	dir := t.TempDir()
	settingsPath := filepath.Join(dir, "settings.json")
	if err := os.WriteFile(settingsPath, []byte(`{"model":"opus","hooks":{"Stop":[{"matcher":"","hooks":[{"type":"command","command":`+mustJSON(unguardedMacCommand)+`}]}]}}`+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if changed, err := RemoveObsoleteHooks(settingsPath, ""); err != nil || !changed {
		t.Fatalf("RemoveObsoleteHooks = %v, %v", changed, err)
	}
	if data, _ := os.ReadFile(settingsPath); string(data) != "{\n  \"model\": \"opus\"\n}\n" {
		t.Fatalf("settings = %q", data)
	}
}

func mustJSON(value string) string {
	data, _ := json.Marshal(value)
	return string(data)
}

func TestBundleMissing(t *testing.T) {
	dir := t.TempDir()
	if !BundleMissing(filepath.Join(dir, "agent-engine")) {
		t.Fatal("absent engine must count as missing")
	}
	if BundleMissing(installedEngine(t, dir)) {
		t.Fatal("installed engine reported missing")
	}
}
