// Package testenv provides isolated process environments for cross-platform tests.
package testenv

import (
	"path/filepath"
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
