package setup

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestTargetWithSetupTokenAddsOrReplacesTokenQuery(t *testing.T) {
	tests := []struct {
		name   string
		target string
		token  string
		want   string
	}{
		{name: "blank token keeps trimmed target", target: "  http://192.0.2.10  ", token: "   ", want: "http://192.0.2.10"},
		{name: "adds token query", target: "http://192.0.2.10", token: "abc123", want: "http://192.0.2.10?token=abc123"},
		{name: "replaces existing token and keeps other queries", target: "http://192.0.2.10/?token=old&x=1", token: "new", want: "http://192.0.2.10/?token=new&x=1"},
		{name: "token is query escaped", target: "http://192.0.2.10", token: "a b&c", want: "http://192.0.2.10?token=a+b%26c"},
		{name: "unparseable target is returned trimmed", target: " http://[::1 ", token: "abc", want: "http://[::1"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := targetWithSetupToken(tt.target, tt.token); got != tt.want {
				t.Fatalf("targetWithSetupToken(%q, %q)=%q, expected %q", tt.target, tt.token, got, tt.want)
			}
		})
	}
}

func TestWriteFileAtomicReplacesContentAndLeavesNoTempFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.json")
	if err := os.WriteFile(path, []byte("old"), 0o644); err != nil {
		t.Fatal(err)
	}

	if err := writeFileAtomic(path, []byte("new"), 0o600); err != nil {
		t.Fatalf("writeFileAtomic returned error: %v", err)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "new" {
		t.Fatalf("content=%q, expected %q", got, "new")
	}
	if info, err := os.Stat(path); err != nil {
		t.Fatal(err)
	} else if runtime.GOOS != "windows" && info.Mode().Perm() != 0o600 {
		t.Fatalf("mode=%v, expected 0600", info.Mode().Perm())
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].Name() != "config.json" {
		t.Fatalf("expected only config.json in dir, got %d entries", len(entries))
	}
}

func TestWriteFileAtomicFailsWithoutLeavingTempFile(t *testing.T) {
	t.Run("missing directory", func(t *testing.T) {
		path := filepath.Join(t.TempDir(), "missing", "config.json")
		if err := writeFileAtomic(path, []byte("data"), 0o600); err == nil {
			t.Fatal("expected error when the directory does not exist")
		}
	})

	t.Run("target is a directory", func(t *testing.T) {
		dir := t.TempDir()
		target := filepath.Join(dir, "config.json")
		if err := os.Mkdir(target, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := writeFileAtomic(target, []byte("data"), 0o600); err == nil {
			t.Fatal("expected error when the target path is a directory")
		}
		entries, err := os.ReadDir(dir)
		if err != nil {
			t.Fatal(err)
		}
		if len(entries) != 1 || entries[0].Name() != "config.json" {
			t.Fatalf("expected only the existing directory, got %d entries", len(entries))
		}
	})
}
