package codexbar

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

// claudeCredentialsFlag is Win-CodexBar's consent switch for reading Claude
// Code's OAuth credentials. It defaults to off and Win-CodexBar exposes it only
// in its own settings window, which VibeTV customers never see. Switching
// Claude on in the Control Center is that consent, so Windows sets the flag at
// the same time. macOS needs nothing here: the Mac CLI reads the keychain and
// macOS itself asks the customer for permission.
const claudeCredentialsFlag = "claude_allow_reading_claude_code_credentials"

var grantClaudeCredentialsFn = grantClaudeCredentials

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
	data = bytes.TrimPrefix(bytes.TrimSpace(data), []byte("\xef\xbb\xbf"))
	var envelope map[string]json.RawMessage
	if err := json.Unmarshal(data, &envelope); err != nil {
		return nil, fmt.Errorf("parse CodexBar settings: %w", err)
	}
	var format string
	if raw, ok := envelope["format"]; ok {
		_ = json.Unmarshal(raw, &format)
	}
	if format != "codexbar.secure-file" {
		return setJSONFlag(envelope)
	}
	var encoded string
	if err := json.Unmarshal(envelope["payload"], &encoded); err != nil {
		return nil, fmt.Errorf("parse CodexBar settings payload: %w", err)
	}
	protected, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return nil, fmt.Errorf("decode CodexBar settings payload: %w", err)
	}
	plain, err := codec.unprotect(protected)
	if err != nil {
		return nil, fmt.Errorf("unprotect CodexBar settings: %w", err)
	}
	var settings map[string]json.RawMessage
	if err := json.Unmarshal(plain, &settings); err != nil {
		return nil, fmt.Errorf("parse protected CodexBar settings: %w", err)
	}
	updated, err := setJSONFlag(settings)
	if err != nil {
		return nil, err
	}
	reprotected, err := codec.protect(updated)
	if err != nil {
		return nil, fmt.Errorf("protect CodexBar settings: %w", err)
	}
	envelope["payload"], _ = json.Marshal(base64.StdEncoding.EncodeToString(reprotected))
	return json.Marshal(envelope)
}

func setJSONFlag(settings map[string]json.RawMessage) ([]byte, error) {
	if settings == nil {
		return nil, errors.New("CodexBar settings are empty")
	}
	settings[claudeCredentialsFlag] = json.RawMessage("true")
	return json.Marshal(settings)
}

// rewriteSettingsFile applies allowClaudeCredentials to the file at path and
// replaces it atomically.
func rewriteSettingsFile(path string, codec settingsCodec) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	updated, err := allowClaudeCredentials(data, codec)
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
