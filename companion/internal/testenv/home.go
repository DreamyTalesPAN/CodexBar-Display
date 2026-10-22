// Package testenv provides isolated process environments for cross-platform tests.
package testenv

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func Home(t testing.TB, home string) {
	t.Helper()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	if home == "" {
		t.Setenv("APPDATA", "")
		t.Setenv("XDG_CONFIG_HOME", "")
		return
	}
	t.Setenv("APPDATA", filepath.Join(home, "AppData", "Roaming"))
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(home, ".config"))
}

// Main runs a package's tests with HOME and the Windows and XDG config folders
// pointing at a fresh temporary folder, so no test of the package reads or
// writes the real user's app data (#932). Use it as os.Exit(testenv.Main(m)).
func Main(m *testing.M) int {
	home, err := os.MkdirTemp("", "companion-test-home-")
	if err != nil {
		fmt.Fprintln(os.Stderr, "testenv: create temporary home:", err)
		return 1
	}
	defer os.RemoveAll(home)
	for key, value := range map[string]string{
		"HOME":            home,
		"USERPROFILE":     home,
		"APPDATA":         filepath.Join(home, "AppData", "Roaming"),
		"XDG_CONFIG_HOME": filepath.Join(home, ".config"),
	} {
		if err := os.Setenv(key, value); err != nil {
			fmt.Fprintln(os.Stderr, "testenv: set", key+":", err)
			return 1
		}
	}
	return m.Run()
}

// RequireTempPath fails the test unless path lies inside the system's
// temporary folder, i.e. away from the real user's files.
func RequireTempPath(t testing.TB, path string) {
	t.Helper()
	rel, err := filepath.Rel(os.TempDir(), path)
	if path == "" || err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) || filepath.IsAbs(rel) {
		t.Fatalf("test path %q is outside the temporary folder %q; it would touch the real user's files", path, os.TempDir())
	}
}
