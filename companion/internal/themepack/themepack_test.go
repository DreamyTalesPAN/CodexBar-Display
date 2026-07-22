package themepack

import (
	"archive/zip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
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

func TestLoadZipBytesThemePack(t *testing.T) {
	dir := writeThemePack(t, "")
	zipPath := filepath.Join(t.TempDir(), "cozy-meadow.zip")
	writeZipFromDir(t, zipPath, dir)
	zipBytes, err := os.ReadFile(zipPath)
	if err != nil {
		t.Fatal(err)
	}

	pack, err := LoadZipBytes(zipBytes)
	if err != nil {
		t.Fatalf("LoadZipBytes returned error: %v", err)
	}
	if pack.Manifest.ID != "cozy-meadow" || pack.ThemeSpecFile.Entry.Path != "/themes/u/cm.json" {
		t.Fatalf("unexpected pack: %+v", pack.Manifest)
	}
}

func TestLoadZipBytesRejectsEmptyMalformedAndOversizedData(t *testing.T) {
	tests := []struct {
		name string
		data []byte
		want string
	}{
		{name: "empty", data: []byte{}, want: "empty"},
		{name: "malformed", data: []byte("not a zip"), want: "open theme pack zip"},
		{name: "oversized", data: make([]byte, MaxZipBytes+1), want: "too large"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := LoadZipBytes(test.data)
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("expected %q error, got %v", test.want, err)
			}
		})
	}
}

func TestValidateZipEntriesRejectsUncompressedZipBombs(t *testing.T) {
	tests := []struct {
		name  string
		files []*zip.File
		want  string
	}{
		{
			name: "single oversized entry",
			files: []*zip.File{{FileHeader: zip.FileHeader{
				Name:               "theme.json",
				UncompressedSize64: 11,
			}}},
			want: "entry theme.json is too large",
		},
		{
			name: "cumulative expansion",
			files: []*zip.File{
				{FileHeader: zip.FileHeader{Name: "manifest.json", UncompressedSize64: 6}},
				{FileHeader: zip.FileHeader{Name: "theme.json", UncompressedSize64: 5}},
			},
			want: "expands beyond limit",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := validateZipEntries(test.files, 10)
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("expected %q error, got %v", test.want, err)
			}
		})
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

	digest := sha256.Sum256(zipData)
	pack, err := loadRemoteZipWithClient(server.Client(), server.URL+"/cozy-meadow.zip", hex.EncodeToString(digest[:]), int64(len(zipData)))
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

	_, err := loadRemoteZipWithClient(server.Client(), server.URL+"/missing.zip", strings.Repeat("a", 64), 1)
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
		_, _ = w.Write([]byte(`{"schemaVersion":1,"themes":[{"id":"cozy-meadow","title":"Cozy Meadow","themeRev":1,"downloadAsset":"vibetv-theme-cozy-meadow.zip","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","bytes":905}]}`))
	}))
	defer server.Close()

	catalogURL := server.URL + "/assets/vibetv-theme-packs.json"
	raw, err := readRemoteCatalog(server.Client(), catalogURL)
	if err != nil {
		t.Fatalf("readRemoteCatalog returned error: %v", err)
	}
	var catalog Catalog
	if err := json.Unmarshal(raw, &catalog); err != nil {
		t.Fatalf("parse catalog: %v", err)
	}
	if err := validateCatalog(catalog); err != nil {
		t.Fatalf("validate catalog: %v", err)
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

func TestValidateAgainstCapabilitiesRejectsOversizedGIFAsset(t *testing.T) {
	spec := `{"v":1,"id":"cozy-meadow","rev":1,"fb":"mini","p":[{"t":"g","x":0,"y":0,"w":80,"h":80,"a":"/themes/u/cm.gif"}]}`
	dir := writeThemePackWithSpec(t, spec, []themePackTestAsset{
		{path: "/themes/u/cm.gif", file: "assets/cm.gif", data: strings.Repeat("x", 9)},
	})

	pack, err := Load(dir)
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}
	err = pack.ValidateAgainstCapabilities(protocol.DeviceCapabilities{
		Known:               true,
		SupportsThemeSpecV1: true,
		MaxThemeSpecBytes:   4096,
		MaxThemePrimitives:  32,
		MaxThemeGifAssets:   1,
		MaxThemeGifBytes:    8,
		MaxThemeGifWidth:    80,
		MaxThemeGifHeight:   80,
		MaxThemeGifPixels:   6400,
		BuiltinThemes:       []string{"mini"},
	})
	if err == nil || !strings.Contains(err.Error(), "GIF asset") {
		t.Fatalf("expected GIF asset limit error, got %v", err)
	}
}

func TestValidateAgainstCapabilitiesUsesStoredThemeSpecLimit(t *testing.T) {
	spec := `{"v":1,"id":"cozy-meadow","rev":1,"fb":"mini","p":[{"t":"tx","x":0,"y":0,"v":"OK","s":1}]}`
	spec += strings.Repeat(" ", 2300-len(spec))
	dir := writeThemePackWithSpec(t, spec, nil)

	pack, err := Load(dir)
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}
	caps := protocol.DeviceCapabilities{
		Known:                   true,
		SupportsThemeSpecV1:     true,
		SupportsStoredThemes:    true,
		MaxThemeSpecBytes:       2048,
		MaxStoredThemeSpecBytes: 4096,
		MaxThemePrimitives:      32,
		BuiltinThemes:           []string{"mini"},
	}
	if err := pack.ValidateAgainstCapabilities(caps); err != nil {
		t.Fatalf("expected stored theme spec to use 4096-byte limit: %v", err)
	}

	caps.MaxStoredThemeSpecBytes = 2048
	if err := pack.ValidateAgainstCapabilities(caps); err == nil {
		t.Fatalf("expected stored theme spec above 2048 bytes to be rejected")
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

func TestLoadRejectsMalformedSpriteAsset(t *testing.T) {
	spec := `{"v":1,"id":"cozy-meadow","rev":1,"fb":"mini","p":[{"t":"sp","x":0,"y":0,"w":2,"h":1,"a":"/themes/u/bad.cbi"}]}`
	dir := writeThemePackWithSpec(t, spec, []themePackTestAsset{
		{path: "/themes/u/bad.cbi", file: "assets/bad.cbi", data: "CBI1\n2 1\n1\n#FFFFFF\na\n"},
	})

	_, err := Load(dir)
	if err == nil || !strings.Contains(err.Error(), "row 0 has width") {
		t.Fatalf("expected malformed sprite asset error, got %v", err)
	}
}

func TestRepositoryThemePacksLoadWithRenderableAssets(t *testing.T) {
	root := filepath.Join("..", "..", "..", "theme-packs")
	entries, err := os.ReadDir(root)
	if err != nil {
		t.Fatal(err)
	}

	loaded := 0
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		dir := filepath.Join(root, entry.Name())
		if _, err := os.Stat(filepath.Join(dir, "manifest.json")); err != nil {
			continue
		}
		t.Run(entry.Name(), func(t *testing.T) {
			if _, err := Load(dir); err != nil {
				t.Fatalf("theme pack should load with renderable assets: %v", err)
			}
		})
		loaded++
	}
	if loaded == 0 {
		t.Fatal("no repository theme packs were tested")
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
