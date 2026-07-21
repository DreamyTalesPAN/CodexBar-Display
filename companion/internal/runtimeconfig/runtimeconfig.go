package runtimeconfig

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/theme"
)

const (
	configFileName                 = "config.json"
	deviceSelectionJournalFileName = "device-selection-pending.json"
	defaultTheme                   = "mini"
	privateConfigDirMode           = 0o700
	privateConfigFileMode          = 0o600
)

var configBackupFilePatterns = []string{
	"config.before-*.json",
	"config.backup-*.json",
	"config.json.backup-*",
}

type Config struct {
	Theme        string        `json:"theme,omitempty"`
	DeviceTarget string        `json:"deviceTarget,omitempty"`
	DeviceToken  string        `json:"deviceToken,omitempty"`
	DeviceID     string        `json:"deviceId,omitempty"`
	KnownDevices []KnownDevice `json:"knownDevices,omitempty"`
}

type KnownDevice struct {
	DeviceID    string `json:"deviceId"`
	Target      string `json:"target"`
	DeviceToken string `json:"deviceToken,omitempty"`
}

func NormalizeTheme(raw string) string {
	return theme.Normalize(raw)
}

func DefaultTheme() string {
	return defaultTheme
}

func ClearThemeValue(raw string) bool {
	switch strings.TrimSpace(strings.ToLower(raw)) {
	case "", "none", "off", "auto", "default":
		return true
	default:
		return false
	}
}

func ConfigPath(home string) string {
	return filepath.Join(home, "Library", "Application Support", "codexbar-display", configFileName)
}

func deviceSelectionJournalPath(home string) string {
	return filepath.Join(home, "Library", "Application Support", "codexbar-display", deviceSelectionJournalFileName)
}

func Load(home string) (Config, error) {
	home = strings.TrimSpace(home)
	if home == "" {
		return Config{}, errors.New("home directory is empty")
	}

	path := ConfigPath(home)
	if err := RestrictPermissions(home); err != nil {
		return Config{}, err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return Config{}, nil
		}
		return Config{}, fmt.Errorf("read runtime config: %w", err)
	}
	if len(data) == 0 {
		return Config{}, nil
	}

	var cfg Config
	if err := json.Unmarshal(data, &cfg); err != nil {
		return Config{}, fmt.Errorf("parse runtime config: %w", err)
	}
	cfg.Normalize()
	return cfg, nil
}

// RestrictPermissions migrates an existing secret-bearing runtime config
// before any caller reads it. Missing paths are valid for first-run installs.
func RestrictPermissions(home string) error {
	home = strings.TrimSpace(home)
	if home == "" {
		return errors.New("home directory is empty")
	}
	configPath := ConfigPath(home)
	configDir := filepath.Dir(configPath)
	if err := os.Chmod(configDir, privateConfigDirMode); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("restrict runtime config dir permissions: %w", err)
	}
	for _, path := range []string{configPath, deviceSelectionJournalPath(home)} {
		if err := restrictExistingConfigFilePermissions(path); err != nil {
			return err
		}
	}
	for _, pattern := range ConfigBackupFilePatterns() {
		matches, err := filepath.Glob(filepath.Join(configDir, pattern))
		if err != nil {
			return fmt.Errorf("find runtime config backups: %w", err)
		}
		for _, match := range matches {
			if err := restrictExistingConfigFilePermissions(match); err != nil {
				return err
			}
		}
	}
	return nil
}

// ConfigBackupFilePatterns returns the recognized secret-bearing recovery
// files. Callers use the same allowlist for recovery and permission migration.
func ConfigBackupFilePatterns() []string {
	return append([]string(nil), configBackupFilePatterns...)
}

func Save(home string, cfg Config) error {
	home = strings.TrimSpace(home)
	if home == "" {
		return errors.New("home directory is empty")
	}

	cfg.Normalize()

	path := ConfigPath(home)
	if err := ensurePrivateConfigDir(filepath.Dir(path)); err != nil {
		return fmt.Errorf("create config dir: %w", err)
	}

	payload, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal runtime config: %w", err)
	}
	payload = append(payload, '\n')

	tmpPath := fmt.Sprintf("%s.tmp-%d", path, time.Now().UnixNano())
	if err := os.WriteFile(tmpPath, payload, privateConfigFileMode); err != nil {
		return fmt.Errorf("write temp runtime config: %w", err)
	}
	if err := os.Rename(tmpPath, path); err != nil {
		_ = os.Remove(tmpPath)
		return fmt.Errorf("replace runtime config: %w", err)
	}
	return os.Chmod(path, privateConfigFileMode)
}

func ensurePrivateConfigDir(path string) error {
	if err := os.MkdirAll(path, privateConfigDirMode); err != nil {
		return err
	}
	return os.Chmod(path, privateConfigDirMode)
}

func restrictExistingConfigFilePermissions(path string) error {
	if err := os.Chmod(path, privateConfigFileMode); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("restrict runtime config file permissions: %w", err)
	}
	return nil
}

// BeginDeviceSelection records the last committed configuration before a
// candidate device is staged. If the Companion process exits before the
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

func CommitDeviceSelection(home string) error {
	home = strings.TrimSpace(home)
	if home == "" {
		return errors.New("home directory is empty")
	}
	err := os.Remove(deviceSelectionJournalPath(home))
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("remove device selection journal: %w", err)
	}
	return nil
}

func RecoverPendingDeviceSelection(home string) (bool, error) {
	home = strings.TrimSpace(home)
	if home == "" {
		return false, errors.New("home directory is empty")
	}
	if err := RestrictPermissions(home); err != nil {
		return false, err
	}
	path := deviceSelectionJournalPath(home)
	payload, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("read device selection journal: %w", err)
	}
	var previous Config
	if err := json.Unmarshal(payload, &previous); err != nil {
		return false, fmt.Errorf("parse device selection journal: %w", err)
	}
	if err := Save(home, previous); err != nil {
		return false, fmt.Errorf("restore device selection config: %w", err)
	}
	if err := CommitDeviceSelection(home); err != nil {
		return false, err
	}
	return true, nil
}

func (cfg Config) KnownDevice(deviceID string) (KnownDevice, bool) {
	deviceID = strings.TrimSpace(deviceID)
	if deviceID == "" {
		return KnownDevice{}, false
	}
	for _, device := range cfg.KnownDevices {
		if strings.EqualFold(device.DeviceID, deviceID) {
			return device, true
		}
	}
	return KnownDevice{}, false
}

func (cfg *Config) Normalize() {
	cfg.Theme = NormalizeTheme(cfg.Theme)
	cfg.DeviceTarget = strings.TrimSpace(cfg.DeviceTarget)
	cfg.DeviceToken = strings.TrimSpace(cfg.DeviceToken)
	cfg.DeviceID = strings.TrimSpace(cfg.DeviceID)
	cfg.normalizeKnownDevices()
}

func (cfg *Config) SetActiveDevice(device KnownDevice) {
	device = normalizeKnownDevice(device)
	cfg.DeviceID = device.DeviceID
	cfg.DeviceTarget = device.Target
	cfg.DeviceToken = device.DeviceToken
	cfg.upsertKnownDevice(device)
}

func (cfg *Config) ClearDevices() {
	cfg.DeviceTarget = ""
	cfg.DeviceToken = ""
	cfg.DeviceID = ""
	cfg.KnownDevices = nil
}

func (cfg *Config) normalizeKnownDevices() {
	devices := append([]KnownDevice(nil), cfg.KnownDevices...)
	cfg.KnownDevices = nil
	for _, device := range devices {
		cfg.upsertKnownDevice(device)
	}
	if strings.TrimSpace(cfg.DeviceID) != "" {
		cfg.upsertKnownDevice(KnownDevice{
			DeviceID:    cfg.DeviceID,
			Target:      cfg.DeviceTarget,
			DeviceToken: cfg.DeviceToken,
		})
	}
}

func (cfg *Config) upsertKnownDevice(device KnownDevice) {
	device = normalizeKnownDevice(device)
	if device.DeviceID == "" {
		return
	}
	for i := range cfg.KnownDevices {
		if !strings.EqualFold(cfg.KnownDevices[i].DeviceID, device.DeviceID) {
			continue
		}
		if device.Target == "" {
			device.Target = cfg.KnownDevices[i].Target
		}
		if device.DeviceToken == "" {
			device.DeviceToken = cfg.KnownDevices[i].DeviceToken
		}
		cfg.KnownDevices[i] = device
		return
	}
	cfg.KnownDevices = append(cfg.KnownDevices, device)
}

func normalizeKnownDevice(device KnownDevice) KnownDevice {
	device.DeviceID = strings.TrimSpace(device.DeviceID)
	device.Target = strings.TrimSpace(device.Target)
	device.DeviceToken = strings.TrimSpace(device.DeviceToken)
	return device
}
