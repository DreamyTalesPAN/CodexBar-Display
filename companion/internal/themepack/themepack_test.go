package themepack

import (
	"archive/zip"
	"net/http"
	"net/http/httptest"
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

func TestLoadHTTPZipThemePack(t *testing.T) {
	dir := writeThemePack(t, "")
	zipPath := filepath.Join(t.TempDir(), "cozy-meadow.zip")
	writeZipFromDir(t, zipPath, dir)
	zipData, err := os.ReadFile(zipPath)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/cozy-meadow.zip" {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/zip")
		_, _ = w.Write(zipData)
	}))
	defer server.Close()

	pack, err := Load(server.URL + "/cozy-meadow.zip")
	if err != nil {
		t.Fatalf("Load http zip returned error: %v", err)
	}
	if pack.Manifest.ID != "cozy-meadow" || pack.ThemeSpecFile.Entry.Path != "/themes/u/cm.json" {
		t.Fatalf("unexpected pack: %+v", pack.Manifest)
	}
}

func TestLoadHTTPZipRejectsBadStatus(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "not found", http.StatusNotFound)
	}))
	defer server.Close()

	_, err := Load(server.URL + "/missing.zip")
	if err == nil || !strings.Contains(err.Error(), "status=404") {
		t.Fatalf("expected http status error, got %v", err)
	}
}

func TestLoadCatalogResolvesRelativeDownloadAsset(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/assets/vibetv-theme-packs.json" {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"schemaVersion":1,"themes":[{"id":"cozy-meadow","title":"Cozy Meadow","themeRev":1,"downloadAsset":"vibetv-theme-cozy-meadow.zip","bytes":905}]}`))
	}))
	defer server.Close()

	catalogURL := server.URL + "/assets/vibetv-theme-packs.json"
	catalog, err := LoadCatalog(catalogURL)
	if err != nil {
		t.Fatalf("LoadCatalog returned error: %v", err)
	}
	theme, err := catalog.FindTheme("cozy-meadow")
	if err != nil {
		t.Fatalf("FindTheme returned error: %v", err)
	}
	downloadURL, err := ResolveThemeDownload(catalogURL, theme)
	if err != nil {
		t.Fatalf("ResolveThemeDownload returned error: %v", err)
	}
	if want := server.URL + "/assets/vibetv-theme-cozy-meadow.zip"; downloadURL != want {
		t.Fatalf("unexpected download URL %q, want %q", downloadURL, want)
	}
}

func TestLoadRejectsMissingReferencedAsset(t *testing.T) {
	dir := writeThemePack(t, `"assets":[]`)

	_, err := Load(dir)
	if err == nil || !strings.Contains(err.Error(), "manifest assets do not include") {
		t.Fatalf("expected missing asset error, got %v", err)
	}
}

func TestLoadDirectoryThemePackWithStateAssets(t *testing.T) {
	spec := `{"v":1,"id":"cozy-meadow","rev":1,"fb":"mini","p":[{"t":"sp","x":0,"y":0,"w":24,"h":24,"sa":{"idle":"/themes/u/idle.cbi","coding":"/themes/u/code.cbi"}}]}`
	dir := writeThemePackWithSpec(t, spec, []themePackTestAsset{
		{path: "/themes/u/idle.cbi", file: "assets/idle.cbi", data: "CBI1\n1 1\n1\n#FFFFFF\na\n"},
		{path: "/themes/u/code.cbi", file: "assets/code.cbi", data: "CBI1\n1 1\n1\n#000000\na\n"},
	})

	pack, err := Load(dir)
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}
	if got := pack.ThemeSpec.Primitives[0].StateAssets["coding"]; got != "/themes/u/code.cbi" {
		t.Fatalf("stateAssets were not loaded: %q", got)
	}
}

func TestLoadRejectsMissingStateAsset(t *testing.T) {
	spec := `{"v":1,"id":"cozy-meadow","rev":1,"fb":"mini","p":[{"t":"sp","x":0,"y":0,"w":24,"h":24,"sa":{"idle":"/themes/u/idle.cbi","coding":"/themes/u/code.cbi"}}]}`
	dir := writeThemePackWithSpec(t, spec, []themePackTestAsset{
		{path: "/themes/u/idle.cbi", file: "assets/idle.cbi", data: "CBI1\n1 1\n1\n#FFFFFF\na\n"},
	})

	_, err := Load(dir)
	if err == nil || !strings.Contains(err.Error(), "stateAssets[coding]") {
		t.Fatalf("expected missing state asset error, got %v", err)
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

type themePackTestAsset struct {
	path string
	file string
	data string
}

func writeThemePackWithSpec(t *testing.T, spec string, assets []themePackTestAsset) string {
	t.Helper()
	dir := t.TempDir()
	if err := os.Mkdir(filepath.Join(dir, "assets"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "theme.json"), []byte(spec), 0o644); err != nil {
		t.Fatal(err)
	}

	assetEntries := make([]string, 0, len(assets))
	for _, asset := range assets {
		if err := os.WriteFile(filepath.Join(dir, filepath.FromSlash(asset.file)), []byte(asset.data), 0o644); err != nil {
			t.Fatal(err)
		}
		assetEntries = append(assetEntries, `{"path":"`+asset.path+`","file":"`+asset.file+`"}`)
	}

	manifest := `{"kind":"vibetv-theme-pack","schemaVersion":1,"id":"cozy-meadow","name":"Cozy Meadow",` +
		`"themeSpec":{"path":"/themes/u/cm.json","file":"theme.json"},` +
		`"assets":[` + strings.Join(assetEntries, ",") + `]}`
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
