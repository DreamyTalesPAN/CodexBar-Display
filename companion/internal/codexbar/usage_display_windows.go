package codexbar

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
)

// Win-CodexBar v0.60.3-vibetv.3 owns show_as_used (default true).
// Its CLI has no setter, so reuse the existing secure-settings adapter.
func windowsUsageBarsShowUsed() bool {
	data, err := os.ReadFile(filepath.Join(os.Getenv("APPDATA"), "CodexBar", "settings.json"))
	if err != nil {
		return true
	}
	settings, _, err := decodeWindowsSettings(data, settingsCodec{unprotect: dpapiUnprotect, protect: dpapiProtect})
	if err != nil {
		return true
	}
	value := true
	_ = json.Unmarshal(settings["show_as_used"], &value)
	return value
}

func setWindowsUsageBarsShowUsed(showUsed bool) error {
	path, err := ensureWindowsConfigDir()
	if err != nil {
		return err
	}
	err = rewriteWindowsSettingsFile(path, settingsCodec{unprotect: dpapiUnprotect, protect: dpapiProtect}, func(settings map[string]json.RawMessage) {
		settings["show_as_used"], _ = json.Marshal(showUsed)
	})
	if err != nil {
		return err
	}
	if windowsUsageBarsShowUsed() != showUsed {
		return errors.New("usage display preference was not applied")
	}
	return nil
}
