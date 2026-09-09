package companionapi

import (
	"os"
	"path/filepath"
	"testing"
)

func TestWindowsShellAppPathRequiresShellExecutable(t *testing.T) {
	dir := t.TempDir()
	if got := windowsShellAppPath(dir); got != "" {
		t.Fatalf("app path without shell = %q, want empty", got)
	}
	if err := os.WriteFile(filepath.Join(dir, windowsShellExecutable), []byte("MZ"), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := windowsShellAppPath(dir); got != filepath.Clean(dir) {
		t.Fatalf("app path with shell = %q, want %q", got, dir)
	}
}
