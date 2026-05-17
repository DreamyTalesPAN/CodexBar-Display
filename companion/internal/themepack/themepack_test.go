package themepack

import (
	"archive/zip"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoadDirectoryThemePack(t *testing.T) {
	dir := writeThemePack(t, "")

	pack, err := Load(dir)
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}
	if pack.Manifest.ID != "cozy-meadow" || pack.ThemeSpec.ThemeID != "cozy-meadow" {
		t.Fatalf("unexpected pack: %+v spec=%+v", pack.Manifest, pack.ThemeSpec)
	}
	if len(pack.Assets) != 1 || string(pack.Assets[0].Data) == "" {
		t.Fatalf("asset was not loaded: %+v", pack.Assets)
	}
}

func TestLoadZipThemePack(t *testing.T) {
	dir := writeThemePack(t, "")
	zipPath := filepath.Join(t.TempDir(), "cozy-meadow.zip")
	writeZipFromDir(t, zipPath, dir)

	pack, err := Load(zipPath)
	if err != nil {
		t.Fatalf("Load zip returned error: %v", err)
	}
	if pack.ThemeSpecFile.Entry.Path != "/themes/u/cm.json" {
		t.Fatalf("unexpected theme spec path %s", pack.ThemeSpecFile.Entry.Path)
	}
}

func TestLoadRejectsMissingReferencedAsset(t *testing.T) {
	dir := writeThemePack(t, `"assets":[]`)

	_, err := Load(dir)
	if err == nil || !strings.Contains(err.Error(), "manifest assets do not include") {
		t.Fatalf("expected missing asset error, got %v", err)
	}
}

func TestLoadRejectsUnsafePackFile(t *testing.T) {
	dir := writeThemePack(t, `"themeSpec":{"path":"/themes/u/cm.json","file":"../theme.json"}`)

	_, err := Load(dir)
	if err == nil || !strings.Contains(err.Error(), "unsafe file path") {
		t.Fatalf("expected unsafe file path error, got %v", err)
	}
}

func TestLoadRejectsLongDevicePath(t *testing.T) {
	dir := writeThemePack(t, `"themeSpec":{"path":"/themes/u/this-path-is-far-too-long.json","file":"theme.json"}`)

	_, err := Load(dir)
	if err == nil || !strings.Contains(err.Error(), "device path too long") {
		t.Fatalf("expected long path error, got %v", err)
	}
}

func writeThemePack(t *testing.T, override string) string {
	t.Helper()
	dir := t.TempDir()
	if err := os.Mkdir(filepath.Join(dir, "assets"), 0o755); err != nil {
		t.Fatal(err)
	}
	spec := `{"v":1,"id":"cozy-meadow","rev":1,"fb":"mini","p":[{"t":"sp","x":0,"y":0,"w":24,"h":24,"a":"/themes/u/cm.cbi"}]}`
	asset := "CBI1\n1 1\n1\n#FFFFFF\na\n"
	if err := os.WriteFile(filepath.Join(dir, "theme.json"), []byte(spec), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "assets", "cm.cbi"), []byte(asset), 0o644); err != nil {
		t.Fatal(err)
	}

	themeSpec := `"themeSpec":{"path":"/themes/u/cm.json","file":"theme.json"}`
	assets := `"assets":[{"path":"/themes/u/cm.cbi","file":"assets/cm.cbi"}]`
	if override != "" {
		if strings.HasPrefix(override, `"themeSpec"`) {
			themeSpec = override
		} else {
			assets = override
		}
	}
	manifest := `{"kind":"vibetv-theme-pack","schemaVersion":1,"id":"cozy-meadow","name":"Cozy Meadow",` + themeSpec + `,` + assets + `}`
	if err := os.WriteFile(filepath.Join(dir, "manifest.json"), []byte(manifest), 0o644); err != nil {
		t.Fatal(err)
	}
	return dir
}

func writeZipFromDir(t *testing.T, zipPath, dir string) {
	t.Helper()
	out, err := os.Create(zipPath)
	if err != nil {
		t.Fatal(err)
	}
	defer out.Close()

	writer := zip.NewWriter(out)
	defer writer.Close()

	for _, name := range []string{"manifest.json", "theme.json", "assets/cm.cbi"} {
		data, err := os.ReadFile(filepath.Join(dir, filepath.FromSlash(name)))
		if err != nil {
			t.Fatal(err)
		}
		file, err := writer.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := file.Write(data); err != nil {
			t.Fatal(err)
		}
	}
}
