package companionapi

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"testing/fstest"
)

func TestSingleProviderThemeUsesExactLiveSpec(t *testing.T) {
	raw, err := os.ReadFile("../../../dist/theme-packs/render/token-counter.json")
	if err != nil {
		t.Fatal(err)
	}
	var pack themeRenderPack
	if err := json.Unmarshal(raw, &pack); err != nil {
		t.Fatal(err)
	}
	name := "theme-packs/render/token-counter/" + filepath.Base(pack.SpecPath)
	server := &Server{home: t.TempDir(), controlCenterFS: fstest.MapFS{name: &fstest.MapFile{Data: raw}}}
	var health deviceHealth
	health.Display.ActiveTheme = "token-counter"
	health.Display.ThemeSpec.Active = true
	health.Display.ThemeSpec.Path, health.Display.ThemeSpec.Hash = pack.SpecPath, pack.SpecHash
	if !server.singleProviderThemeFromHealth(health) {
		t.Fatal("Token Counter capability missing")
	}
	health.Display.ThemeSpec.Hash = "00000000"
	if server.singleProviderThemeFromHealth(health) {
		t.Fatal("used a different revision")
	}
	health.Standby = &deviceStandbyInfo{Active: true, LiveThemePath: pack.SpecPath}
	health.Display.ActiveTheme, health.Display.ThemeSpec.Path = "night-clock", "/themes/s/night.json"
	if !server.singleProviderThemeFromHealth(health) {
		t.Fatal("screensaver hid the live theme capability")
	}
	health.Standby = nil
	if server.singleProviderThemeFromHealth(health) {
		t.Fatal("kept the old theme restriction")
	}
	server.controlCenterFS = fstest.MapFS{}
	if err := writeThemeRenderPackFile(server.themeRenderPackRevisionPath("token-counter", pack.SpecPath), raw); err != nil {
		t.Fatal(err)
	}
	health.Display.ThemeSpec.Path, health.Display.ThemeSpec.Hash = pack.SpecPath, pack.SpecHash
	if !server.singleProviderThemeFromHealth(health) {
		t.Fatal("installed custom pack capability missing")
	}
}
