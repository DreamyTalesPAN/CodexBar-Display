package runtimepaths

import (
	"os"
	"path/filepath"
	"strings"
)

// Root is the single per-user Companion directory. An explicit alternate home
// retains the existing isolated-home contract used by setup and tests. Normal
// callers pass the current home (or empty), so UserConfigDir remains authoritative,
// including APPDATA and XDG_CONFIG_HOME.
func Root(home string) string {
	config, err := os.UserConfigDir()
	if err != nil {
		return ""
	}
	current, _ := os.UserHomeDir()
	if home = strings.TrimSpace(home); home != "" && filepath.Clean(home) != filepath.Clean(current) {
		rel, err := filepath.Rel(current, config)
		if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
			// An explicit sandbox must never escape into an external config directory.
			config = home
		} else {
			config = filepath.Join(home, rel)
		}
	}
	return filepath.Join(config, "codexbar-display")
}

// Path must not turn an unavailable config root into a working-directory path.
func Path(home string, parts ...string) string {
	root := Root(home)
	if root == "" {
		return ""
	}
	return filepath.Join(append([]string{root}, parts...)...)
}
