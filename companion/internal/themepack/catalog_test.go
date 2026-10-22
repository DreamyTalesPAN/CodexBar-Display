package themepack

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoadCatalogIgnoresUnknownTags(t *testing.T) {
	catalog := `{
  "schemaVersion": 1,
  "themes": [{
    "id": "night-clock",
    "title": "Night Clock",
    "downloadAsset": "vibetv-theme-night-clock-v0.2.0.zip",
    "sha256": "` + strings.Repeat("a", 64) + `",
    "bytes": 1024,
    "tags": ["clock", "tag-from-a-newer-catalog"]
  }]
}`
	path := filepath.Join(t.TempDir(), "catalog.json")
	if err := os.WriteFile(path, []byte(catalog), 0o600); err != nil {
		t.Fatal(err)
	}

	loaded, err := LoadCatalog(path)
	if err != nil {
		t.Fatalf("LoadCatalog rejected a catalog with an unknown tag: %v", err)
	}
	theme, err := loaded.FindTheme("night-clock")
	if err != nil {
		t.Fatal(err)
	}
	if len(theme.Tags) != 2 || theme.Tags[0] != "clock" {
		t.Fatalf("tags = %v, want the catalog's tags kept as data", theme.Tags)
	}
}
