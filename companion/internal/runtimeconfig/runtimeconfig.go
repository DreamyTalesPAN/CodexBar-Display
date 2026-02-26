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

const (
	configFileName = "config.json"
)

type Config struct {
	Theme string `json:"theme,omitempty"`
}

func NormalizeTheme(raw string) string {
	switch strings.TrimSpace(strings.ToLower(raw)) {
	case "classic":
		return "classic"
	case "crt":
		return "crt"
	default:
		return ""
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
	return filepath.Join(home, "Library", "Application Support", "vibeblock", configFileName)
}

func Load(home string) (Config, error) {
	home = strings.TrimSpace(home)
	if home == "" {
		return Config{}, errors.New("home directory is empty")
	}

	path := ConfigPath(home)
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
	cfg.Theme = NormalizeTheme(cfg.Theme)
	return cfg, nil
}

func Save(home string, cfg Config) error {
	home = strings.TrimSpace(home)
	if home == "" {
		return errors.New("home directory is empty")
	}

	cfg.Theme = NormalizeTheme(cfg.Theme)

	path := ConfigPath(home)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("create config dir: %w", err)
	}

	payload, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal runtime config: %w", err)
	}
	payload = append(payload, '\n')

	tmpPath := fmt.Sprintf("%s.tmp-%d", path, time.Now().UnixNano())
	if err := os.WriteFile(tmpPath, payload, 0o644); err != nil {
		return fmt.Errorf("write temp runtime config: %w", err)
	}
	if err := os.Rename(tmpPath, path); err != nil {
		_ = os.Remove(tmpPath)
		return fmt.Errorf("replace runtime config: %w", err)
	}
	return os.Chmod(path, 0o644)
}
