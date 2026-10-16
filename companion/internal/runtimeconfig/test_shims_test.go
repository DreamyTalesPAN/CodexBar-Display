package runtimeconfig

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// BeginDeviceSelection writes a journal as releases v1.0.47 to v1.0.50 did
// before a candidate device was staged. If the Companion process exits before the
// selection is committed, RecoverPendingDeviceSelection restores this exact
// configuration on the next startup.
func BeginDeviceSelection(home string, previous Config) error {
	home = strings.TrimSpace(home)
	if home == "" {
		return errors.New("home directory is empty")
	}
	previous.Normalize()
	path := deviceSelectionJournalPath(home)
	if err := ensurePrivateConfigDir(filepath.Dir(path)); err != nil {
		return fmt.Errorf("create config dir: %w", err)
	}
	payload, err := json.MarshalIndent(previous, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal device selection journal: %w", err)
	}
	payload = append(payload, '\n')
	tmpPath := fmt.Sprintf("%s.tmp-%d", path, time.Now().UnixNano())
	if err := os.WriteFile(tmpPath, payload, privateConfigFileMode); err != nil {
		return fmt.Errorf("write device selection journal: %w", err)
	}
	if err := os.Rename(tmpPath, path); err != nil {
		_ = os.Remove(tmpPath)
		return fmt.Errorf("replace device selection journal: %w", err)
	}
	return os.Chmod(path, privateConfigFileMode)
}
