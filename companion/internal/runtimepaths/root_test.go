package runtimepaths

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestRootUsesUserConfigDir(t *testing.T) {
	config, err := os.UserConfigDir()
	if err != nil {
		t.Fatal(err)
	}
	home, err := os.UserHomeDir()
	if err != nil {
		t.Fatal(err)
	}
	for _, h := range []string{"", home} {
		if got, want := Root(h), filepath.Join(config, "codexbar-display"); got != want {
			t.Fatalf("Root(%q)=%q want %q", h, got, want)
		}
	}
	if runtime.GOOS == "darwin" && Root(home) != filepath.Join(home, "Library", "Application Support", "codexbar-display") {
		t.Fatal("Mac path changed; migration would be required")
	}
}

func TestRootExplicitHomeDoesNotEscape(t *testing.T) {
	home := t.TempDir()
	root := Root(home)
	rel, err := filepath.Rel(home, root)
	if err != nil || rel == ".." || filepath.IsAbs(rel) {
		t.Fatalf("sandbox escaped: %s", root)
	}
}
