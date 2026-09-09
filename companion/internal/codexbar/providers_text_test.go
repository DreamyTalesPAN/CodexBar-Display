package codexbar

import "testing"

// Win-CodexBar 0.56.8 "config providers" output (no JSON inventory yet, #415).
const winCodexBarTextInventory = "codex: enabled default (Codex)\r\n" +
	"claude: enabled default (Claude)\r\n" +
	"cursor: disabled default (Cursor)\r\n" +
	"factory: disabled (Factory)\r\n" +
	"kimik2: disabled (Kimi K2 (removed))\r\n" +
	"qwen-cloud: disabled (Qwen Cloud)\r\n"

func TestParseProviderSettingsFallsBackToText(t *testing.T) {
	settings, err := parseProviderSettings([]byte(winCodexBarTextInventory))
	if err != nil {
		t.Fatal(err)
	}
	if len(settings) != 6 {
		t.Fatalf("expected 6 providers, got %d: %+v", len(settings), settings)
	}
	want := []struct {
		id, label          string
		enabled, byDefault bool
	}{
		{"codex", "Codex", true, true},
		{"claude", "Claude", true, true},
		{"cursor", "Cursor", false, true},
		{"factory", "Factory", false, false},
		{"kimik2", "Kimi K2 (removed)", false, false},
		{"qwen-cloud", "Qwen Cloud", false, false},
	}
	for i, w := range want {
		got := settings[i]
		if got.ID != w.id || got.Label != w.label || got.Enabled != w.enabled || got.DefaultEnabled != w.byDefault {
			t.Fatalf("provider %d: got %+v, want %+v", i, got, w)
		}
	}
}

func TestParseProviderSettingsRejectsGarbage(t *testing.T) {
	if _, err := parseProviderSettings([]byte("error: unexpected argument '--json' found\n")); err == nil {
		t.Fatal("expected error for non-inventory output")
	}
}
