package runtimeconfig

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
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

type permissionMigrationState struct {
	mu       sync.Mutex
	complete bool
}

type permissionMigrationCache struct {
	states  sync.Map
	migrate func(home, configPath, configDir string) error
}

var processPermissionMigrations permissionMigrationCache
var configTransactionLocks sync.Map

type Config struct {
	Theme                          string                 `json:"theme,omitempty"`
	ConnectionMode                 string                 `json:"connectionMode,omitempty"`
	DeviceTarget                   string                 `json:"deviceTarget,omitempty"`
	DeviceToken                    string                 `json:"deviceToken,omitempty"`
	DeviceID                       string                 `json:"deviceId,omitempty"`
	DeviceTransports               []string               `json:"deviceTransports,omitempty"`
	KnownDevices                   []KnownDevice          `json:"knownDevices,omitempty"`
	CableAutoBindDisabled          bool                   `json:"cableAutoBindDisabled,omitempty"`
	ConnectionModeChoiceRequired   bool                   `json:"connectionModeChoiceRequired,omitempty"`
	ProviderDisplay                *ProviderDisplayConfig `json:"providerDisplay,omitempty"`
	ProviderSelectionSetupComplete *bool                  `json:"providerSelectionSetupComplete,omitempty"`
}

type ProviderDisplayConfig struct {
	Mode        string   `json:"mode"`
	ProviderIDs []string `json:"providerIds"`
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

func NormalizeConnectionMode(raw string) string {
	switch strings.TrimSpace(strings.ToLower(raw)) {
	case "cable":
		return "cable"
	case "wifi":
		return "wifi"
	default:
		return ""
	}
}

func ActiveTransport(cfg Config) string {
	if cfg.WiFiTransitionPending() {
		return "usb"
	}
	switch NormalizeConnectionMode(cfg.ConnectionMode) {
	case "wifi":
		return "wifi"
	case "cable":
		return "usb"
	default:
		if strings.TrimSpace(cfg.DeviceTarget) != "" {
			return "wifi"
		}
		return "usb"
	}
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

// WithConfigLock serializes in-process read-modify-write transactions for one
// runtime config across the Companion API and its display worker.
func WithConfigLock(home string, run func() error) error {
	if run == nil {
		return nil
	}
	key := ConfigPath(strings.TrimSpace(home))
	lockValue, _ := configTransactionLocks.LoadOrStore(key, &sync.Mutex{})
	lock := lockValue.(*sync.Mutex)
	lock.Lock()
	defer lock.Unlock()
	return run()
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
	return processPermissionMigrations.ensure(home, configPath, configDir)
}

func (c *permissionMigrationCache) ensure(home, configPath, configDir string) error {
	if existing, ok := c.states.Load(configDir); ok {
		return existing.(*permissionMigrationState).ensure(c.migration(), home, configPath, configDir)
	}
	state := &permissionMigrationState{}
	actual, _ := c.states.LoadOrStore(configDir, state)
	return actual.(*permissionMigrationState).ensure(c.migration(), home, configPath, configDir)
}

func (c *permissionMigrationCache) migration() func(string, string, string) error {
	if c.migrate != nil {
		return c.migrate
	}
	return restrictPermissions
}

func (s *permissionMigrationState) ensure(
	migrate func(string, string, string) error,
	home,
	configPath,
	configDir string,
) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.complete {
		return nil
	}
	if err := migrate(home, configPath, configDir); err != nil {
		return err
	}
	s.complete = true
	return nil
}

func restrictPermissions(home, configPath, configDir string) error {
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
	cfg.ConnectionMode = NormalizeConnectionMode(cfg.ConnectionMode)
	cfg.DeviceTarget = strings.TrimSpace(cfg.DeviceTarget)
	cfg.DeviceToken = strings.TrimSpace(cfg.DeviceToken)
	cfg.DeviceID = strings.TrimSpace(cfg.DeviceID)
	if cfg.ProviderDisplay != nil {
		cfg.ProviderDisplay.Normalize()
	}
	for index := range cfg.DeviceTransports {
		cfg.DeviceTransports[index] = strings.TrimSpace(strings.ToLower(cfg.DeviceTransports[index]))
	}
	cfg.normalizeKnownDevices()
}

func (cfg *ProviderDisplayConfig) Normalize() {
	if cfg == nil {
		return
	}
	cfg.Mode = strings.TrimSpace(strings.ToLower(cfg.Mode))
	seen := make(map[string]struct{}, len(cfg.ProviderIDs))
	providerIDs := make([]string, 0, len(cfg.ProviderIDs))
	for _, raw := range cfg.ProviderIDs {
		providerID := strings.TrimSpace(strings.ToLower(raw))
		if providerID == "" {
			continue
		}
		if _, ok := seen[providerID]; ok {
			continue
		}
		seen[providerID] = struct{}{}
		providerIDs = append(providerIDs, providerID)
	}
	cfg.ProviderIDs = providerIDs
}

// ProviderSelectionSetupIsComplete preserves completed legacy installations
// while requiring the provider step for a new or explicitly restarted setup.
func (cfg Config) ProviderSelectionSetupIsComplete() bool {
	if cfg.ProviderSelectionSetupComplete != nil {
		return *cfg.ProviderSelectionSetupComplete
	}
	return cfg.hasPairedDevice()
}

// hasPairedDevice reports whether this config was already set up, before the
// completion flag existed to say so. The device id is the modern answer, but a
// VibeTV that never reported one leaves the target and token behind -- and
// reading that as "never set up" sends a customer who has been using VibeTV for
// months back through onboarding on the update that adds the flag.
//
// The token is what makes the target proof. Discovery writes a target of its
// own before pairing has produced anything, so a setup abandoned after the
// search leaves one behind too -- and counting that as finished carried the
// customer past the provider and display steps, or, with no provider able to
// render usage yet, held them on the device step with nothing that could
// release it.
func (cfg Config) hasPairedDevice() bool {
	if strings.TrimSpace(cfg.DeviceID) != "" {
		return true
	}
	return strings.TrimSpace(cfg.DeviceTarget) != "" &&
		strings.TrimSpace(cfg.DeviceToken) != ""
}

// ProviderDisplayPredatesSetup reports an installation that was set up before
// the display choice existed to be made. It has no selection stored and never
// had a step that could store one, and rule 4 of
// docs/control-center-ui-principles.md says an existing healthy setup opens
// Overview without extra confirmation -- so it is not asked for one now. A new
// customer has neither the flag nor a paired VibeTV, and a reset clears both,
// so a setup that is actually being run still asks.
func (cfg Config) ProviderDisplayPredatesSetup() bool {
	return cfg.ProviderDisplay == nil &&
		cfg.ProviderSelectionSetupComplete == nil &&
		cfg.hasPairedDevice()
}

func (cfg *Config) SetProviderSelectionSetupComplete(complete bool) {
	if cfg == nil {
		return
	}
	cfg.ProviderSelectionSetupComplete = new(bool)
	*cfg.ProviderSelectionSetupComplete = complete
}

func (cfg *Config) SetActiveDevice(device KnownDevice) {
	device = normalizeKnownDevice(device)
	// Stamping the flag for the first time must not overwrite what the config
	// already implied: a legacy install being pinned to a stable identity has a
	// target and no id, and writing false here made the loss permanent.
	if cfg.ProviderSelectionSetupComplete == nil && !cfg.hasPairedDevice() {
		cfg.SetProviderSelectionSetupComplete(false)
	}
	cfg.CableAutoBindDisabled = false
	cfg.ConnectionModeChoiceRequired = false
	cfg.DeviceID = device.DeviceID
	cfg.DeviceTarget = device.Target
	cfg.DeviceToken = device.DeviceToken
	cfg.upsertKnownDevice(device)
}

func (cfg Config) WiFiTransitionPending() bool {
	return NormalizeConnectionMode(cfg.ConnectionMode) == "" &&
		cfg.CableAutoBindDisabled &&
		!cfg.ConnectionModeChoiceRequired &&
		strings.TrimSpace(cfg.DeviceID) != ""
}

func (cfg *Config) RememberDevice(device KnownDevice) {
	cfg.upsertKnownDevice(device)
}

func (cfg *Config) ResetDeviceBinding() {
	retryingWiFi := cfg.WiFiTransitionPending()
	retryingDeviceID := strings.TrimSpace(cfg.DeviceID)
	if strings.TrimSpace(cfg.DeviceID) != "" {
		cfg.RememberDevice(KnownDevice{
			DeviceID:    cfg.DeviceID,
			Target:      cfg.DeviceTarget,
			DeviceToken: cfg.DeviceToken,
		})
	}
	cfg.CableAutoBindDisabled = true
	cfg.ConnectionModeChoiceRequired = true
	cfg.DeviceTarget = ""
	cfg.DeviceToken = ""
	cfg.DeviceID = ""
	cfg.DeviceTransports = nil
	if retryingWiFi {
		for index := range cfg.KnownDevices {
			if strings.EqualFold(cfg.KnownDevices[index].DeviceID, retryingDeviceID) {
				cfg.KnownDevices[index].Target = ""
			}
		}
	}
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
