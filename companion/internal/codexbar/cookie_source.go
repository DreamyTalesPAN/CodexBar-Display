package codexbar

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"runtime"
)

// UseBrowserCookies switches a provider whose CodexBar config pins a saved
// cookie (cookieSource "manual") back to CodexBar's automatic browser import.
// A pinned cookie keeps CodexBar from ever reading the browser, so once it
// expires a fresh browser sign-in changes nothing (Mac, 2026-10-09). The saved
// cookie stays in the file; only the source changes. It reports whether the
// config changed. A missing config or any other shape is left alone, and so
// is Windows: Win-CodexBar keeps pasted cookies in a file of its own and the
// VibeTV app offers no way to paste one.
func UseBrowserCookies(home, providerID string) (bool, error) {
	if runtime.GOOS == "windows" {
		return false, nil
	}
	path, err := macConfigPath(home)
	if err != nil {
		return false, err
	}
	raw, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	} else if err != nil {
		return false, err
	}
	info, err := os.Stat(path)
	if err != nil {
		return false, err
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var config map[string]any
	if decoder.Decode(&config) != nil {
		return false, nil
	}
	providers, _ := config["providers"].([]any)
	changed := false
	for _, item := range providers {
		provider, _ := item.(map[string]any)
		if provider["id"] == providerID && provider["cookieSource"] == "manual" {
			provider["cookieSource"] = "auto"
			changed = true
		}
	}
	if !changed {
		return false, nil
	}
	var out bytes.Buffer
	encoder := json.NewEncoder(&out)
	encoder.SetEscapeHTML(false)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(config); err != nil {
		return false, err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".vibetv-config-*")
	if err != nil {
		return false, err
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)
	if err := tmp.Chmod(info.Mode().Perm()); err != nil {
		_ = tmp.Close()
		return false, err
	}
	if _, err := tmp.Write(out.Bytes()); err != nil {
		_ = tmp.Close()
		return false, err
	}
	if err := tmp.Close(); err != nil {
		return false, err
	}
	return true, os.Rename(tmpPath, path)
}
