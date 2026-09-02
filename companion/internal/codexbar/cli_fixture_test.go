package codexbar

import (
	"os"
	"path/filepath"
	"testing"

	dashboardusage "github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar/dashboard"
)

// TestCLIFixtures runs the real parsing paths against recorded CLI output.
// Each directory under testdata/cli holds one CodexBar build's recordings
// (issue #357 compares the macOS CodexBar CLI with the Win-CodexBar CLI).
func TestCLIFixtures(t *testing.T) {
	dirs, err := filepath.Glob(filepath.Join("testdata", "cli", "*"))
	if err != nil || len(dirs) == 0 {
		t.Skip("no CLI fixtures recorded")
	}
	for _, dir := range dirs {
		dir := dir
		t.Run(filepath.Base(dir), func(t *testing.T) {
			read := func(name string) []byte {
				raw, err := os.ReadFile(filepath.Join(dir, name))
				if err != nil {
					t.Fatalf("read %s: %v", name, err)
				}
				return raw
			}

			t.Run("usage-all", func(t *testing.T) {
				frames, err := parseAllProviders(read("usage-all.json"))
				if err != nil {
					t.Fatalf("parseAllProviders: %v", err)
				}
				byProvider := map[string]ParsedFrame{}
				for _, frame := range frames {
					byProvider[frame.Provider] = frame
				}
				for _, id := range []string{"codex", "claude"} {
					frame, ok := byProvider[id]
					if !ok {
						t.Fatalf("provider %q missing from %d parsed frames", id, len(frames))
					}
					if len(frame.Meta.Windows) == 0 {
						t.Fatalf("provider %q parsed without usage windows", id)
					}
					for _, window := range frame.Meta.Windows {
						t.Logf("%s window id=%q label=%q used=%d resetSec=%d windowMinutes=%d", id, window.ID, window.Label, window.UsedPercent, window.ResetSec, window.WindowMinutes)
					}
				}
				t.Logf("%d providers parsed", len(frames))
			})

			for _, name := range []string{"usage-codex.json", "usage-claude.json"} {
				name := name
				t.Run(name, func(t *testing.T) {
					frame, err := parseUsageJSON(read(name))
					if err != nil {
						t.Fatalf("parseUsageJSON: %v", err)
					}
					if len(frame.Meta.Windows) == 0 {
						t.Fatalf("no usage windows parsed for %s", frame.Provider)
					}
				})
			}

			t.Run("config-providers", func(t *testing.T) {
				settings, err := parseProviderSettings(read("config-providers.json"))
				if err != nil {
					t.Fatalf("parseProviderSettings: %v", err)
				}
				seen := map[string]bool{}
				for _, setting := range settings {
					seen[setting.ID] = true
				}
				for _, id := range []string{"codex", "claude"} {
					if !seen[id] {
						t.Fatalf("provider %q missing from inventory of %d", id, len(settings))
					}
				}
			})

			t.Run("serve", func(t *testing.T) {
				snapshot, err := dashboardusage.DecodeSnapshot(read("serve-snapshot.json"))
				if err != nil {
					t.Fatalf("DecodeSnapshot: %v", err)
				}
				usage, err := dashboardusage.DecodeUsage(read("serve-usage.json"))
				if err != nil {
					t.Fatalf("DecodeUsage: %v", err)
				}
				normalized := 0
				for _, provider := range snapshot.Providers {
					u, _ := dashboardusage.UsageForProvider(usage, provider.ID)
					out := dashboardusage.NormalizeProvider(provider, u)
					if out.Unavailable {
						continue
					}
					if len(out.Windows) == 0 {
						t.Fatalf("dashboard provider %q normalized to zero windows", provider.ID)
					}
					normalized++
					for _, window := range out.Windows {
						t.Logf("%s dashboard window id=%q label=%q used=%.1f", provider.ID, window.ID, window.Label, window.UsedPercent)
					}
				}
				if normalized == 0 {
					t.Fatalf("no dashboard provider normalized (schemaVersion=%d, %d providers)", snapshot.SchemaVersion, len(snapshot.Providers))
				}
			})
		})
	}
}
