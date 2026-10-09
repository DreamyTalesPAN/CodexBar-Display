package codexbar

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/writerlock"
)

// configWriteMu serializes the Companion's own changes to CodexBar's config:
// a sign-in lifting a saved cookie and a provider switch toggle.
var configWriteMu sync.Mutex

// beforeConfigReplace runs between reading the config and replacing it. Tests
// use it to change the file the way CodexBar itself might at that moment.
var beforeConfigReplace = func() {}

var errConfigChanged = errors.New("CodexBar config kept changing while switching to browser cookies")

// UseBrowserCookies switches a provider whose CodexBar config pins a saved
// cookie (cookieSource "manual") back to CodexBar's automatic browser import.
// A pinned cookie keeps CodexBar from ever reading the browser, so once it
// expires a fresh browser sign-in changes nothing (Mac, 2026-10-09). The saved
// cookie stays in the file; only the source changes. It reports whether the
// config changed. A missing config is left alone, and so is Windows:
// Win-CodexBar keeps pasted cookies in a file of its own and the VibeTV app
// offers no way to paste one. A config that is not JSON is an error, because
// the pin it may hold could not be lifted.
func UseBrowserCookies(home, providerID string) (bool, error) {
	if runtime.GOOS == "windows" {
		return false, nil
	}
	path, err := macConfigPath(home)
	if err != nil {
		return false, err
	}
	configWriteMu.Lock()
	defer configWriteMu.Unlock()
	if _, err := os.Stat(path); errors.Is(err, os.ErrNotExist) {
		return false, nil
	}
	// CodexBar's app and CLI from 0.71.0 on publish this file under an flock on
	// config.json.lock. Holding the same lock keeps them out of the whole
	// read-modify-write. The bundled 0.63.0 writes without it, so when the
	// file changed between our read and our replace, start over from its new
	// content.
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	lock, err := writerlock.AcquireAtContext(ctx, path+".lock")
	if err != nil {
		return false, fmt.Errorf("lock CodexBar config: %w", err)
	}
	defer lock.Release()
	// The lock stays where CodexBar takes it; a symlinked config is replaced
	// at its target, so the link and whatever manages it stay in place.
	target, err := filepath.EvalSymlinks(path)
	if err != nil {
		return false, err
	}
	for attempt := 0; attempt < 3; attempt++ {
		changed, err := switchCookieSource(target, providerID)
		if !errors.Is(err, errConfigChanged) {
			return changed, err
		}
	}
	return false, errConfigChanged
}

func switchCookieSource(path, providerID string) (bool, error) {
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
	if err := decoder.Decode(&config); err != nil {
		return false, fmt.Errorf("CodexBar config is not valid JSON: %w", err)
	}
	if _, err := decoder.Token(); !errors.Is(err, io.EOF) {
		return false, errors.New("CodexBar config has data after its JSON object")
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
	beforeConfigReplace()
	current, err := os.ReadFile(path)
	if err != nil {
		return false, err
	}
	if !bytes.Equal(current, raw) {
		return false, errConfigChanged
	}
	return true, os.Rename(tmpPath, path)
}
