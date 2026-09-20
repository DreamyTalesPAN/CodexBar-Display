package codexbar

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
)

// claudeCredentialsFlag is Win-CodexBar's consent switch for reading Claude
// Code's OAuth credentials. It defaults to off and Win-CodexBar exposes it only
// in its own settings window, which VibeTV customers never see. Switching
// Claude on in the Control Center is that consent, so Windows sets the flag at
// the same time. macOS needs nothing here: the Mac CLI reads the keychain and
// macOS itself asks the customer for permission.
const claudeCredentialsFlag = "claude_allow_reading_claude_code_credentials"

var grantClaudeCredentialsFn = grantClaudeCredentials

// Serialize Companion-owned settings writes, including CLI provider toggles.
var windowsSettingsMu sync.Mutex

// settingsCodec wraps and unwraps the Win-CodexBar settings payload. Windows
// uses DPAPI; tests substitute a reversible stand-in.
type settingsCodec struct {
	unprotect func([]byte) ([]byte, error)
	protect   func([]byte) ([]byte, error)
}

// allowClaudeCredentials returns settings with the consent flag switched on.
// It accepts both shapes Win-CodexBar 0.56.8 writes: the plain JSON the VibeTV
// bootstrap seeds and the "codexbar.secure-file" envelope Win-CodexBar
// rewrites on its first save. A UTF-8 BOM makes Win-CodexBar ignore the file
// silently, so one is stripped on read and never written.
func allowClaudeCredentials(data []byte, codec settingsCodec) ([]byte, error) {
	return updateWindowsSettings(data, codec, func(settings map[string]json.RawMessage) {
		settings[claudeCredentialsFlag] = json.RawMessage("true")
	})
}

// Decode once for both the consent flag and the upstream display preference.
// Unknown settings and secure-file envelope fields survive each update.
func decodeWindowsSettings(data []byte, codec settingsCodec) (map[string]json.RawMessage, map[string]json.RawMessage, error) {
	data = bytes.TrimPrefix(bytes.TrimSpace(data), []byte("\xef\xbb\xbf"))
	var envelope map[string]json.RawMessage
	if err := json.Unmarshal(data, &envelope); err != nil {
		return nil, nil, err
	}
	if envelope == nil {
		return nil, nil, errors.New("CodexBar settings are empty")
	}
	var format string
	_ = json.Unmarshal(envelope["format"], &format)
	if format != "codexbar.secure-file" {
		return envelope, nil, nil
	}
	var encoded string
	if err := json.Unmarshal(envelope["payload"], &encoded); err != nil {
		return nil, nil, err
	}
	protected, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return nil, nil, err
	}
	plain, err := codec.unprotect(protected)
	if err != nil {
		return nil, nil, fmt.Errorf("unprotect CodexBar settings: %w", err)
	}
	var settings map[string]json.RawMessage
	if err := json.Unmarshal(plain, &settings); err != nil {
		return nil, nil, err
	}
	if settings == nil {
		return nil, nil, errors.New("CodexBar settings are empty")
	}
	return settings, envelope, nil
}

func updateWindowsSettings(data []byte, codec settingsCodec, update func(map[string]json.RawMessage)) ([]byte, error) {
	settings, envelope, err := decodeWindowsSettings(data, codec)
	if err != nil {
		return nil, err
	}
	update(settings)
	updated, err := json.Marshal(settings)
	if err != nil || envelope == nil {
		return updated, err
	}
	protected, err := codec.protect(updated)
	if err != nil {
		return nil, err
	}
	envelope["payload"], _ = json.Marshal(base64.StdEncoding.EncodeToString(protected))
	return json.Marshal(envelope)
}

// rewriteSettingsFile applies allowClaudeCredentials to the file at path and
// replaces it atomically.
func rewriteSettingsFile(path string, codec settingsCodec) error {
	return rewriteWindowsSettingsFile(path, codec, func(settings map[string]json.RawMessage) {
		settings[claudeCredentialsFlag] = json.RawMessage("true")
	})
}

func rewriteWindowsSettingsFile(path string, codec settingsCodec, update func(map[string]json.RawMessage)) error {
	windowsSettingsMu.Lock()
	defer windowsSettingsMu.Unlock()

	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	updated, err := updateWindowsSettings(data, codec, update)
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".vibetv-settings-*")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)
	if _, err := tmp.Write(updated); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmpPath, path)
}
